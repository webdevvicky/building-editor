import assert from 'node:assert/strict'
import { fireLiveOp, GEOMETRY_OPS, registerErpId, seedIdMapFromState, knownRowVersion } from '../src/projects/liveSync.js'
import { isEditorHardReadOnly, _resetEditorWriteGuard } from '../src/projects/editorWriteGuard.js'

// ── Mock fetch ────────────────────────────────────────────────────────────────
const fetchCalls = []
globalThis.fetch = async (url, opts) => {
  fetchCalls.push({ url, method: opts?.method ?? 'GET', body: opts?.body })
  return {
    ok: true,
    json: async () => ({ data: { id: `erpId_${fetchCalls.length}` } }),
    text: async () => '',
  }
}

// ── Pre-seed idMap ────────────────────────────────────────────────────────────
// Test cases pass EDITOR ids (wallIfcId / roomIfcId) and let liveSync resolve them
// through this map, because that is what the emitters actually produce. Handing a
// case a pre-resolved `*ErpId` tests a payload shape no emitter emits: it is how
// the ADD_OPENING `/geometry/walls/null/openings` defect passed this script for
// months. Only use an `*ErpId` in a case where the emitter really supplies one.
registerErpId('WallIfc000000000000001', 'erpWall1')
registerErpId('RoomIfc000000000000001', 'erpRoom1')
registerErpId('NodeIfc000000000000001', 'erpNode1')
registerErpId('ColmIfc000000000000001', 'erpCol1')
registerErpId('BeamIfc000000000000001', 'erpBeam1')
registerErpId('SlabIfc000000000000001', 'erpSlab1')
registerErpId('OpenIfc000000000000001', 'erpOpen1')
registerErpId('ElemIfc000000000000001', 'erpElem1')
registerErpId('Wall2Ifc00000000000001', 'erpWall2')
// Row versions, as GET /state hands them over (CONC-27): a room/wall shape PATCH must
// carry the version this editor last saw.
seedIdMapFromState({
  rooms: [{ id: 'erpRoom1', sourceEditorId: 'RoomIfc000000000000001', version: 3 }],
  walls: [{ id: 'erpWall1', sourceEditorId: 'WallIfc000000000000001', version: 5, openings: [] }],
})

// ── Mock conn ─────────────────────────────────────────────────────────────────
const mockConn = {
  erpUrl: 'https://erp.test',
  buildingId: 'erpBldg1',
  floorIds: { F1: 'erpFloor1' },
  getToken: async () => 'mock-jwt-token',
}

// Ops that intentionally fire NO REST call (handled client-side as a no-op).
const NOOP_OPS = new Set()

// ── Test cases ────────────────────────────────────────────────────────────────
const OP_TEST_CASES = [
  // Floors
  ['ADD_FLOOR',         { ifcGlobalId: 'floor-uid-000000000002', floorNumber: 2, floorHeight: 10 }],
  ['UPDATE_FLOOR',      { ifcGlobalId: 'F1', floorNumber: 1, floorHeight: 11, plinthHeight: 2 }],
  ['DELETE_FLOOR',      { ifcGlobalId: 'F1' }], // resolves via mockConn.floorIds.F1 → erpFloor1
  // Walls
  ['ADD_WALL',          { ifcGlobalId: 'WallIfc000000000000002', materialKey: 'IS_MODULAR_BRICK', height: 120, thickness: 9, roomIfcId: 'RoomIfc000000000000001' }],
  ['UPDATE_WALL',       { ifcGlobalId: 'WallIfc000000000000001', wallErpId: 'erpWall1', height: 130 }],
  ['DELETE_WALL',       { ifcGlobalId: 'WallIfc000000000000001', wallErpId: 'erpWall1' }],
  ['SPLIT_WALL',        { ifcGlobalId: 'WallIfc000000000000001', newWalls: [{ ifcGlobalId: 'WallIfc000000000000002', lengthMm: 1200, height: 120, thickness: 9, orientation: 'NORTH', roomIfcIds: ['RoomIfc000000000000001'] }, { ifcGlobalId: 'WallIfc000000000000003', lengthMm: 1200, height: 120, thickness: 9, orientation: 'NORTH', roomIfcIds: [] }] }],
  ['JOIN_WALLS',        { wallIfcIds: ['WallIfc000000000000001', 'Wall2Ifc00000000000001'], mergedIfcGlobalId: 'WallIfc000000000000004', height: 120, thickness: 9 }],
  // Openings
  ['ADD_OPENING',       { ifcGlobalId: 'OpenIfc000000000000002', wallIfcId: 'WallIfc000000000000001', type: 'window', width: 36, height: 48 }],
  ['UPDATE_OPENING',    { ifcGlobalId: 'OpenIfc000000000000001', width: 40, height: 50, offset: 12, heightFromFloor: 36, count: 1 }],
  ['DELETE_OPENING',    { ifcGlobalId: 'OpenIfc000000000000001', openingErpId: 'erpOpen1' }],
  // Rooms
  ['ADD_ROOM',          { ifcGlobalId: 'RoomIfc000000000000002', floorId: 'F1', roomShape: 'POLYGON' }],
  ['UPDATE_ROOM',       { ifcGlobalId: 'RoomIfc000000000000001', roomErpId: 'erpRoom1', posXMm: 100, posYMm: 200 }],
  ['DELETE_ROOM',       { ifcGlobalId: 'RoomIfc000000000000001', roomErpId: 'erpRoom1' }],
  ['SAVE_ROOM_VERTICES',{ roomIfcId: 'RoomIfc000000000000001', roomErpId: 'erpRoom1', vertices: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 120 }, { x: 0, y: 120 }] }],
  // Nodes
  ['ADD_NODE',          { ifcGlobalId: 'NodeIfc000000000000002', x: 0, y: 0, kind: 'CORNER' }],
  ['UPDATE_NODE',       { ifcGlobalId: 'NodeIfc000000000000001', nodeErpId: 'erpNode1', x: 10, y: 20 }],
  ['DELETE_NODE',       { ifcGlobalId: 'NodeIfc000000000000001', nodeErpId: 'erpNode1' }],
  // Generic elements
  ['ADD_ELEMENT',       { ifcGlobalId: 'ElemIfc000000000000002', kind: 'FOUNDATION', posXMm: 100, posYMm: 200 }],
  ['UPDATE_ELEMENT',    { ifcGlobalId: 'ElemIfc000000000000001', elementErpId: 'erpElem1', posXMm: 150 }],
  ['DELETE_ELEMENT',    { ifcGlobalId: 'ElemIfc000000000000001', elementErpId: 'erpElem1' }],
]

// ── Run tests ─────────────────────────────────────────────────────────────────
const passed = []
const failed = []

for (const [opType, payload] of OP_TEST_CASES) {
  fetchCalls.length = 0
  let threw = false
  let throwMsg = ''
  try {
    await fireLiveOp(opType, payload, mockConn)
  } catch (e) {
    threw = true
    throwMsg = e.message
  }
  const expected = NOOP_OPS.has(opType) ? 0 : 1
  if (threw) {
    failed.push(`${opType}: threw — ${throwMsg}`)
  } else if (fetchCalls.length !== expected) {
    failed.push(`${opType}: expected exactly ${expected} fetch call(s), got ${fetchCalls.length}`)
  } else if (expected === 0) {
    passed.push(`${opType}: → no-op (no REST call, by design)`)
  } else {
    passed.push(`${opType}: → ${fetchCalls[0].method} ${fetchCalls[0].url.replace('https://erp.test/api/v1', '')}`)
  }
}

// ── Coverage check ────────────────────────────────────────────────────────────
const testedOps = new Set(OP_TEST_CASES.map(([op]) => op))
for (const op of GEOMETRY_OPS) {
  if (!testedOps.has(op)) {
    failed.push(`${op}: listed in GEOMETRY_OPS but has no test case — coverage gap`)
  }
}
for (const [op] of OP_TEST_CASES) {
  if (!GEOMETRY_OPS.includes(op)) {
    failed.push(`${op}: in test cases but NOT in GEOMETRY_OPS — register it`)
  }
}

// ── CONC-27: shape PATCHes carry the row version; a clash latches read-only ──────
{
  fetchCalls.length = 0
  await fireLiveOp('UPDATE_WALL', { ifcGlobalId: 'WallIfc000000000000001', height: 130 }, mockConn)
  const body = JSON.parse(fetchCalls[0].body)
  if (body.version !== 5) failed.push(`UPDATE_WALL: expected version 5 in the body, got ${body.version}`)
  else passed.push('UPDATE_WALL carries the row version this editor last saw (5)')

  let unknownThrew = ''
  try { await fireLiveOp('UPDATE_WALL', { ifcGlobalId: 'Wall2Ifc00000000000001', height: 130 }, mockConn) } catch (e) { unknownThrew = e.message }
  if (!/→ 400:/.test(unknownThrew)) failed.push('UPDATE_WALL with no known version must refuse (permanent 400), not send an unchecked change')
  else passed.push('UPDATE_WALL with no known version is refused, never sent unchecked')

  // The response's version becomes the next one sent.
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, opts) => {
    fetchCalls.push({ url, method: opts?.method ?? 'GET', body: opts?.body })
    return { ok: true, json: async () => ({ data: { id: 'erpWall1', version: 6 } }), text: async () => '' }
  }
  await fireLiveOp('UPDATE_WALL', { ifcGlobalId: 'WallIfc000000000000001', height: 131 }, mockConn)
  if (knownRowVersion('erpWall1') !== 6) failed.push('UPDATE_WALL response version was not recorded')
  else passed.push('the PATCH response version is recorded for the next change')

  // Someone else changed the wall: 409 → read-only latch, the op is not re-sent.
  _resetEditorWriteGuard()
  globalThis.fetch = async (url, opts) => {
    fetchCalls.push({ url, method: opts?.method ?? 'GET', body: opts?.body })
    return { ok: false, status: 409, json: async () => ({}), text: async () => 'version' }
  }
  fetchCalls.length = 0
  let clashThrew = false
  try { await fireLiveOp('UPDATE_WALL', { ifcGlobalId: 'WallIfc000000000000001', height: 132 }, mockConn) } catch { clashThrew = true }
  if (!clashThrew || !isEditorHardReadOnly() || fetchCalls.length !== 1) {
    failed.push('a 409 on a shape PATCH must throw once and latch the editor read-only')
  } else passed.push('a version clash on a shape PATCH latches read-only (no re-send)')
  _resetEditorWriteGuard()
  globalThis.fetch = realFetch
}

// ── Wire bodies of the wall / opening / floor ops (XR-07, XR-08, XR-11, XR-12, XR-17) ──
{
  const sent = async (opType, payload) => {
    fetchCalls.length = 0
    await fireLiveOp(opType, payload, mockConn)
    const c = fetchCalls[0]
    return { method: c.method, path: c.url.replace('https://erp.test/api/v1', ''), body: c.body ? JSON.parse(c.body) : undefined }
  }
  const check = (label, cond, detail) => (cond ? passed : failed).push(cond ? label : `${label} — ${detail}`)

  // XR-11: a wall no room owns goes on its floor.
  let r = await sent('ADD_WALL', { ifcGlobalId: 'WallIfc000000000000009', floorId: 'F1', height: 120, thickness: 9, lengthMm: 3000, orientation: 'EAST' })
  check('a wall no room owns is POSTed on its floor', r.method === 'POST' && r.path === '/geometry/floors/erpFloor1/walls', JSON.stringify(r))
  check('… and carries no room or exterior face', r.body.isExterior === false && !('roomId' in r.body), JSON.stringify(r.body))

  // XR-12: a floor edit is a PATCH of the row, never a create replay.
  r = await sent('UPDATE_FLOOR', { ifcGlobalId: 'F1', floorNumber: 1, floorHeight: 11, plinthHeight: 2 })
  check('UPDATE_FLOOR PATCHes the floor row', r.method === 'PATCH' && r.path === '/geometry/floors/erpFloor1', JSON.stringify(r))
  check('… with height and plinth, and nothing staff-owned',
    JSON.stringify(r.body) === JSON.stringify({ floorNumber: 1, floorHeight: 11, plinthHeight: 2 }), JSON.stringify(r.body))
  r = await sent('ADD_FLOOR', { ifcGlobalId: 'F3', floorNumber: 3, floorHeight: 10, plinthHeight: 0 })
  check('ADD_FLOOR sends the plinth too', r.body.plinthHeight === 0 && !('floorLength' in r.body), JSON.stringify(r.body))

  // XR-07 / XR-17: sill height and count reach the ERP on add and update.
  r = await sent('ADD_OPENING', { ifcGlobalId: 'OpenIfc000000000000003', wallIfcId: 'WallIfc000000000000001', type: 'WINDOW', width: 48, height: 48, offset: 24, heightFromFloor: 36, count: 1 })
  check('ADD_OPENING sends the sill (mm) and count', r.body.heightFromFloorMm === 914 && r.body.count === 1, JSON.stringify(r.body))
  r = await sent('UPDATE_OPENING', { ifcGlobalId: 'OpenIfc000000000000001', width: 40, height: 50, offset: 12, heightFromFloor: 36, count: 1 })
  check('UPDATE_OPENING PATCHes size, position, sill and count (no version: the ERP opening has none)',
    r.method === 'PATCH' && r.path === '/geometry/openings/erpOpen1'
      && JSON.stringify(Object.keys(r.body).sort()) === JSON.stringify(['count', 'heightFromFloorMm', 'heightMm', 'offsetFromStartMm', 'widthMm']),
    JSON.stringify(r))

  // XR-08: a split names each piece's rooms by ERP id.
  r = await sent('SPLIT_WALL', { ifcGlobalId: 'WallIfc000000000000001', newWalls: [{ ifcGlobalId: 'WallIfc00000000000000A', lengthMm: 1200, height: 120, thickness: 9, orientation: 'EAST', roomIfcIds: ['RoomIfc000000000000001'] }] })
  check('SPLIT_WALL sends each piece with its rooms (ERP ids)', JSON.stringify(r.body.newWalls[0].roomIds) === JSON.stringify(['erpRoom1']) && !('atFractions' in r.body), JSON.stringify(r.body))

  // XR-16: a join merges EVERY wall it names, with the merged wall's nodes.
  r = await sent('JOIN_WALLS', { mergedIfcGlobalId: 'WallIfc000000000000001', wallIfcIds: ['WallIfc000000000000001', 'Wall2Ifc00000000000001'], n1IfcId: 'NodeIfc000000000000001', height: 120, thickness: 9, lengthMm: 4000, orientation: 'EAST' })
  check('JOIN_WALLS sends every wall id and the merged node', JSON.stringify(r.body.wallIds) === JSON.stringify(['erpWall1', 'erpWall2']) && r.body.merged.n1NodeId === 'erpNode1', JSON.stringify(r.body))

  // XR-09: the ERP ids of every room — never a list that lost one.
  r = await sent('ADD_ELEMENT', { ifcGlobalId: 'ElemIfc000000000000003', kind: 'SLAB', roomIds: ['RoomIfc000000000000001'] })
  check('an element\'s rooms go as ERP ids', JSON.stringify(r.body.roomIds) === JSON.stringify(['erpRoom1']), JSON.stringify(r.body))
  r = await sent('UPDATE_ELEMENT', { ifcGlobalId: 'ElemIfc000000000000001', roomIds: ['RoomIfc000000000000001'] })
  check('UPDATE_ELEMENT resolves its rooms too (it used to send editor ids → 400)', JSON.stringify(r.body.roomIds) === JSON.stringify(['erpRoom1']), JSON.stringify(r.body))
  let partial = ''
  try { await fireLiveOp('ADD_ELEMENT', { ifcGlobalId: 'ElemIfc000000000000004', kind: 'SLAB', roomIds: ['RoomIfc000000000000001', 'RoomNeverSynced000001'] }, mockConn) } catch (e) { partial = e.message }
  check('one unresolved room refuses the op (permanent 400), never a partial list', /→ 400:/.test(partial), partial || 'did not throw')
}

// ── Report ────────────────────────────────────────────────────────────────────
console.log(`\nPASSED: ${passed.length}`)
for (const p of passed) console.log(`   ✓ ${p}`)
if (failed.length > 0) {
  console.log(`\nFAILED:`)
  for (const f of failed) console.log(`   ✗ ${f}`)
  process.exit(1)
}
console.log('\n✓ verify-live-sync passed — every geometry op fires exactly one REST call.')
