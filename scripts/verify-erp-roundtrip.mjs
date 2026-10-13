// scripts/verify-erp-roundtrip.mjs — G17 guarantee: editor document → ERP → "Load from ERP"
// gives back the same document, with delete/undo and every element kind.
//
//   1. A two-room building (shared wall, door) with ONE element of EVERY registry kind is
//      pushed through the real emitters (buildFullSyncOps) and the real dispatcher
//      (fireLiveOp) into an in-memory ERP that applies the ERP's editor-identity rule
//      (one row per editor id; an ADD on a retired row REVIVES it — GeometryLiveService).
//   2. Delete then undo: a wall and a room are deleted and added back with their ids —
//      the ERP keeps ONE row each, revived (BLD-G01), never a refused duplicate.
//   3. GET /state (served in the projection contract shape, erp-saas
//      GeometryLiveService.getBuildingState) → reconstructFromProjection → the rebuilt
//      document equals the original (ids are ifcGlobalIds; references follow them).
//   4. Syncing the rebuilt document back changes no row count (XR-01: no duplicate walls).
//
// Two savers on the canonical document are verify-canonical-sync §5 (a clash is never
// re-sent) and verify-canonical-reopen §6–7 (a stale local copy is never uploaded).
//
// Pure Node, mocked fetch. Run with the resolver hook:
//   node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-erp-roundtrip.mjs

import assert from 'node:assert'
import { initLiveSync, teardownLiveSync, fireLiveOp } from '../src/projects/liveSync.js'
import { buildFullSyncOps, wallAddOp, wallDeleteOp, roomAddOp, roomDeleteOp, roomVerticesOp, adjacentSurfaceOp } from '../src/projects/syncEmitters.js'
import { reconstructFromProjection } from '../src/projects/projectionReconstruct.js'
import { ELEMENT_ENTRIES } from '../src/projects/elementRegistry.js'

let pass = 0, fail = 0
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.05

// ── In-memory ERP: /geometry/* with the editor-identity rule ─────────────────
const BUILDING = 'erp-building'
const db = { floors: [], nodes: [], rooms: [], walls: [], faces: [], openings: [], elements: [] }
let seq = 0
const live = (r) => r && !r.deletedAt
function upsertBySid(table, sid, scope, data, onRevive = {}) {
  const row = sid ? db[table].find((r) => r.sourceEditorId === sid && Object.entries(scope).every(([k, v]) => r[k] === v)) : null
  if (row) {
    Object.assign(row, data, row.deletedAt ? { deletedAt: null, ...onRevive } : {})
    return row
  }
  const created = { id: `erp-${table}-${++seq}`, sourceEditorId: sid ?? null, version: 0, deletedAt: null, ...scope, ...onRevive, ...data }
  db[table].push(created)
  return created
}
function ensureFace(wallId, roomId) {
  const face = db.faces.find((f) => f.wallId === wallId && f.roomId === roomId)
  if (face) { face.deletedAt = null; return face }
  const f = { id: `erp-face-${++seq}`, wallId, roomId, deletedAt: null }
  db.faces.push(f)
  return f
}
const byId = (table, id) => db[table].find((r) => r.id === id)

function state() {
  const rooms = db.rooms.filter(live)
  const sidOf = (table, id) => byId(table, id)?.sourceEditorId ?? null
  return {
    floors: db.floors.filter(live).map((f) => ({ id: f.id, sourceEditorId: f.sourceEditorId, floorNumber: f.floorNumber, floorHeight: String(f.floorHeight ?? 10), floorLength: null, floorWidth: null })),
    nodes: db.nodes.filter(live).map((n) => ({ id: n.id, sourceEditorId: n.sourceEditorId, xMm: n.xMm, yMm: n.yMm, kind: n.kind, onWallSourceEditorId: n.onWallId ? sidOf('walls', n.onWallId) : null })),
    rooms: rooms.map((r) => ({ id: r.id, sourceEditorId: r.sourceEditorId, version: r.version, name: r.name, floorId: r.floorId, roomType: r.roomTypeCode ? { code: r.roomTypeCode } : null, posXMm: null, posYMm: null, length: null, width: null, roomShape: 'POLYGON', vertices: r.vertices ?? [], hasClientSelection: false })),
    walls: db.walls.filter(live).map((w) => ({
      id: w.id, sourceEditorId: w.sourceEditorId, version: w.version,
      n1NodeSourceEditorId: w.n1NodeId ? sidOf('nodes', w.n1NodeId) : null,
      n2NodeSourceEditorId: w.n2NodeId ? sidOf('nodes', w.n2NodeId) : null,
      lengthMm: w.lengthMm, heightMm: w.heightMm, thicknessMm: w.thicknessMm, wallMaterial: w.wallMaterial,
      roomSourceEditorIds: [...new Set([w.roomId, ...db.faces.filter((f) => live(f) && f.wallId === w.id).map((f) => f.roomId)]
        .filter((rid) => live(byId('rooms', rid))).map((rid) => sidOf('rooms', rid)))],
      openings: db.openings.filter((o) => live(o) && o.wallId === w.id).map((o) => ({ id: o.id, sourceEditorId: o.sourceEditorId, openingType: o.openingType, widthMm: o.widthMm, heightMm: o.heightMm, offsetFromStartMm: o.offsetFromStartMm ?? null, heightFromFloorMm: null })),
      completionPct: null,
    })),
    elements: db.elements.filter(live).map((e) => ({
      id: e.id, sourceEditorId: e.sourceEditorId, kind: e.kind, status: 'PLANNED', mepPointType: e.pointType ?? null,
      floorId: e.floorId ?? null, roomSourceEditorId: e.roomId ? sidOf('rooms', e.roomId) : null,
      posXMm: e.posXMm ?? null, posYMm: e.posYMm ?? null, fromXMm: e.fromXMm ?? null, fromYMm: e.fromYMm ?? null,
      toXMm: e.toXMm ?? null, toYMm: e.toYMm ?? null, sectionShape: null, sectionWidthMm: null, sectionDepthMm: null,
      diameterMm: null, heightMm: e.heightMm ?? null, spanMm: e.spanMm ?? null, thicknessMm: e.thicknessMm ?? null,
      structuralLevel: e.structuralLevel ?? null, slabRole: e.slabRole ?? null, slabType: e.slabType ?? null,
      spec: e.spec ?? null, roomSourceEditorIds: (e.roomIds ?? []).map((rid) => sidOf('rooms', rid)).filter(Boolean),
    })),
  }
}

function route(method, path, body) {
  let m
  if (method === 'GET' && (m = path.match(/^\/geometry\/buildings\/([^/]+)\/state$/))) return state()
  if (method === 'POST' && (m = path.match(/^\/geometry\/buildings\/([^/]+)\/floors$/))) {
    const { sourceEditorId, ...data } = body
    return upsertBySid('floors', sourceEditorId, { buildingId: m[1] }, data)
  }
  if (method === 'POST' && (m = path.match(/^\/geometry\/buildings\/([^/]+)\/nodes$/))) {
    const { sourceEditorId, ...data } = body
    return upsertBySid('nodes', sourceEditorId, { buildingId: m[1] }, data)
  }
  if (method === 'POST' && (m = path.match(/^\/geometry\/floors\/([^/]+)\/rooms$/))) {
    const { sourceEditorId, ...data } = body
    return upsertBySid('rooms', sourceEditorId, {}, data, { floorId: m[1] })
  }
  if (method === 'POST' && (m = path.match(/^\/geometry\/rooms\/([^/]+)\/vertices$/))) {
    const room = byId('rooms', m[1]); room.vertices = body.vertices; return room
  }
  if (method === 'POST' && (m = path.match(/^\/geometry\/rooms\/([^/]+)\/walls$/))) {
    const { sourceEditorId, isExterior: _ext, ...data } = body
    const wall = upsertBySid('walls', sourceEditorId, {}, data, { roomId: m[1] })
    ensureFace(wall.id, m[1])
    return wall
  }
  if (method === 'POST' && (m = path.match(/^\/geometry\/walls\/([^/]+)\/surfaces\/adjacent$/))) return ensureFace(m[1], body.adjacentRoomId)
  if (method === 'POST' && (m = path.match(/^\/geometry\/walls\/([^/]+)\/openings$/))) {
    const { sourceEditorId, ...data } = body
    return upsertBySid('openings', sourceEditorId, {}, data, { wallId: m[1] })
  }
  if (method === 'POST' && (m = path.match(/^\/geometry\/buildings\/([^/]+)\/elements$/))) {
    const { sourceEditorId, roomIfcId, ...data } = body
    const room = roomIfcId ? db.rooms.find((r) => live(r) && r.sourceEditorId === roomIfcId) : null
    return upsertBySid('elements', sourceEditorId, { buildingId: m[1] }, { ...data, ...(roomIfcId ? { roomId: room?.id ?? null } : {}) })
  }
  if (method === 'PATCH' && (m = path.match(/^\/geometry\/(walls|rooms|nodes|elements|openings)\/([^/]+)$/))) {
    const row = byId(m[1], m[2])
    if (body.version !== undefined) { if (body.version !== row.version) return { __status: 409 }; delete body.version }
    Object.assign(row, body, { version: row.version + 1 })
    return row
  }
  if (method === 'DELETE' && (m = path.match(/^\/geometry\/(walls|rooms|nodes|elements|openings|floors)\/([^/]+)$/))) {
    const row = byId(m[1], m[2]); row.deletedAt = new Date(); return row
  }
  return { __status: 404 }
}

globalThis.fetch = async (url, opts = {}) => {
  const path = String(url).replace('http://erp.test/api/v1', '')
  const out = route(opts.method ?? 'GET', path, opts.body ? JSON.parse(opts.body) : undefined)
  const status = out?.__status ?? 200
  return { ok: status < 300, status, json: async () => ({ success: true, data: out }), text: async () => (status < 300 ? '' : 'refused') }
}

// ── The editor document: two rooms, a shared wall, a door, one of every element kind ──
const node = (id, x, y) => ({ id, ifcGlobalId: `ifc-${id}`, x, y, floorIds: ['F1'], kind: 'CORNER', onWallId: null })
const wall = (id, n1, n2, openings = []) => ({
  id, ifcGlobalId: `ifc-${id}`, n1, n2, height: 120, thickness: 9, materialKey: 'IS_MODULAR_BRICK', isPlot: false,
  isVirtual: false, openings, floorId: 'F1', classification: null, meta: null, junctions: [],
})
const room = (id, name, wallIds, nodeOrder) => ({
  id, ifcGlobalId: `ifc-${id}`, name, type: 'BEDROOM', roomTypeCode: 'BEDROOM', wallIds, nodeOrder, floorId: 'F1',
  customType: null, classification: null, meta: null,
})
const mep = (id, type, extra = {}) => ({ id, ifcGlobalId: `ifc-${id}`, type, x: 30, y: 40, floorId: 'F1', roomId: 'r1', wallId: null, wallT: null, rotationDeg: 0, ...extra })

const doc = {
  nodes: { n1: node('n1', 0, 0), n2: node('n2', 120, 0), n3: node('n3', 120, 120), n4: node('n4', 0, 120), n5: node('n5', 240, 0), n6: node('n6', 240, 120) },
  walls: {
    w1: wall('w1', 'n1', 'n2', [{ id: 'o1', ifcGlobalId: 'ifc-o1', type: 'door', subtype: 'INTERNAL_DOOR', width: 35, height: 85, offset: 20, orient: 0 }]),
    w2: wall('w2', 'n2', 'n3'), w3: wall('w3', 'n3', 'n4'), w4: wall('w4', 'n4', 'n1'),
    w5: wall('w5', 'n2', 'n5'), w6: wall('w6', 'n5', 'n6'), w7: wall('w7', 'n6', 'n3'),
  },
  rooms: {
    r1: room('r1', 'Bed 1', ['w1', 'w2', 'w3', 'w4'], ['n1', 'n2', 'n3', 'n4']),
    r2: room('r2', 'Bed 2', ['w5', 'w6', 'w7', 'w2'], ['n2', 'n5', 'n6', 'n3']),
  },
  stamps: {},
  columns: { c1: { id: 'c1', ifcGlobalId: 'ifc-c1', x: 120, y: 0, columnTypeId: 'CT1', baseFloorId: 'F1', topFloorId: 'F1', position: null, classification: null } },
  beams: { b1: { id: 'b1', ifcGlobalId: 'ifc-b1', endpoints: { from: { type: 'COLUMN', columnId: 'c1' }, to: { type: 'POINT', x: 240, y: 0 } }, level: 'lintel', source: 'EXPLICIT', floorId: 'F1' } },
  slabs: { s1: { id: 's1', ifcGlobalId: 'ifc-s1', type: 'MAIN', roomIds: ['r1'], thicknessIn: 5, sinkDepthIn: 0, grade: 'M25', role: 'ROOF', roleSource: 'AUTO', classification: null, floorId: 'F1' } },
  staircases: { st1: { id: 'st1', ifcGlobalId: 'ifc-st1', type: 'STRAIGHT', flightCount: 1, stepsPerFlight: 14, floorId: 'F1', fromFloorId: 'F1', toFloorId: 'F1' } },
  foundations: { f1: { id: 'f1', ifcGlobalId: 'ifc-f1', type: 'ISOLATED', columnIds: ['c1'], wallIds: [], geometry: { lengthFt: 4 }, floorId: 'F1' } },
  risers: { rs1: { id: 'rs1', ifcGlobalId: 'ifc-rs1', kind: 'SOIL_STACK', discipline: 'PLUMBING', x: 5, y: 5, fromFloorId: 'F1', toFloorId: 'F1' } },
  plumbingFixtures: { p1: mep('p1', 'WC', { wallId: 'w1', wallT: 0.5, rotationDeg: 90 }) },
  electricalPoints: { e1: mep('e1', 'POINT', { pointType: 'AC' }) },
  hvacUnits: { h1: mep('h1', 'SPLIT_AC') },
  fireDevices: { fd1: mep('fd1', 'SMOKE_DETECTOR') },
  elvDevices: { ev1: mep('ev1', 'CCTV') },
  solarEquipment: { so1: mep('so1', 'PANEL') },
  ratesByKey: {},
  projectSettings: { name: 'Karthik Villa — Main Block', floors: [{ id: 'F1', label: 'Ground', sequence: 0, plinthHeightFt: 1.5, floorHeightFt: 10, meta: null, underlay: null }] },
}

const conn = { erpUrl: 'http://erp.test', buildingId: BUILDING, floorIds: {}, getToken: async () => 'scoped-token' }
const fire = async (ops) => { for (const op of ops) if (op) await fireLiveOp(op.opType, op.payload, conn) }
const rowCounts = () => Object.fromEntries(Object.entries(db).map(([t, rows]) => [t, rows.length]))

async function main() {
  teardownLiveSync(); initLiveSync(conn)

  console.log('\n1. Editor document → ERP')
  await fire(buildFullSyncOps(doc))
  ok('every room and wall reached the ERP once', db.rooms.length === 2 && db.walls.length === 7)
  ok('the shared wall bounds BOTH rooms (owner face + adjacent face)', db.faces.filter((f) => f.wallId === db.walls.find((w) => w.sourceEditorId === 'ifc-w2').id).length === 2)
  ok('one ERP element per editor element (every kind)', db.elements.length === ELEMENT_ENTRIES.length, `${db.elements.length}/${ELEMENT_ENTRIES.length}`)

  console.log('\n2. Delete then undo (the same editor ids come back)')
  const wallRow = db.walls.find((w) => w.sourceEditorId === 'ifc-w2')
  const roomRow = db.rooms.find((r) => r.sourceEditorId === 'ifc-r2')
  await fire([wallDeleteOp('ifc-w2'), roomDeleteOp('ifc-r2')])
  ok('deleted rows are retired, not removed', !!wallRow.deletedAt && !!roomRow.deletedAt)
  await fire([roomAddOp(doc.rooms.r2), roomVerticesOp(doc, doc.rooms.r2), wallAddOp(doc, doc.walls.w2, 'ifc-r1'), adjacentSurfaceOp(doc.walls.w2, doc.rooms.r2)])
  ok('undo REVIVES the same wall row (BLD-G01), no second row', db.walls.filter((w) => w.sourceEditorId === 'ifc-w2').length === 1 && !wallRow.deletedAt)
  ok('undo REVIVES the same room row', db.rooms.filter((r) => r.sourceEditorId === 'ifc-r2').length === 1 && !roomRow.deletedAt)

  console.log('\n3. GET /state → Load from ERP → the same document')
  const before = rowCounts()
  const { payload, skipped } = reconstructFromProjection(state(), { projectSettings: doc.projectSettings, stamps: doc.stamps, ratesByKey: doc.ratesByKey })
  const ifc = (coll) => Object.values(doc[coll]).map((e) => e.ifcGlobalId).sort()
  ok('same nodes', JSON.stringify(Object.keys(payload.nodes).sort()) === JSON.stringify(ifc('nodes')))
  ok('same walls — none duplicated (XR-01)', JSON.stringify(Object.keys(payload.walls).sort()) === JSON.stringify(ifc('walls')))
  ok('same rooms', JSON.stringify(Object.keys(payload.rooms).sort()) === JSON.stringify(ifc('rooms')))
  for (const w of Object.values(doc.walls)) {
    const r = payload.walls[w.ifcGlobalId]
    ok(`wall ${w.id}: same endpoints, height, openings`, r && r.n1 === doc.nodes[w.n1].ifcGlobalId && r.n2 === doc.nodes[w.n2].ifcGlobalId
      && near(r.height, w.height) && near(r.thickness, w.thickness)
      && JSON.stringify(r.openings.map((o) => o.ifcGlobalId)) === JSON.stringify(w.openings.map((o) => o.ifcGlobalId)))
  }
  for (const rm of Object.values(doc.rooms)) {
    const r = payload.rooms[rm.ifcGlobalId]
    ok(`room ${rm.id}: same walls and closed outline`, r && JSON.stringify([...r.wallIds].sort()) === JSON.stringify(rm.wallIds.map((id) => doc.walls[id].ifcGlobalId).sort()) && r.nodeOrder.length === 4 && r.floorId === 'F1')
  }
  ok('no element kind skipped', skipped.elements.length === 0)
  for (const entry of ELEMENT_ENTRIES) {
    ok(`${entry.collection}: same elements`, JSON.stringify(Object.keys(payload[entry.collection]).sort()) === JSON.stringify(ifc(entry.collection)))
  }
  ok('column type and position', payload.columns['ifc-c1'].columnTypeId === 'CT1' && near(payload.columns['ifc-c1'].x, 120))
  ok('beam still frames into its column', JSON.stringify(payload.beams['ifc-b1'].endpoints.from) === JSON.stringify({ type: 'COLUMN', columnId: 'ifc-c1' }) && payload.beams['ifc-b1'].level === 'lintel')
  ok('slab covers its room', JSON.stringify(payload.slabs['ifc-s1'].roomIds) === JSON.stringify(['ifc-r1']) && payload.slabs['ifc-s1'].grade === 'M25')
  ok('foundation keeps its column', JSON.stringify(payload.foundations['ifc-f1'].columnIds) === JSON.stringify(['ifc-c1']))
  ok('staircase, riser keep their type', payload.staircases['ifc-st1'].type === 'STRAIGHT' && payload.risers['ifc-rs1'].kind === 'SOIL_STACK')
  ok('MEP keeps type, room, wall, point type', payload.plumbingFixtures['ifc-p1'].type === 'WC' && payload.plumbingFixtures['ifc-p1'].roomId === 'ifc-r1'
    && payload.plumbingFixtures['ifc-p1'].wallId === 'ifc-w1' && payload.electricalPoints['ifc-e1'].pointType === 'AC')
  ok('settings kept, floors from the ERP', payload.projectSettings.name === doc.projectSettings.name && payload.projectSettings.floors[0].label === 'Ground')

  console.log('\n4. The rebuilt document synced back changes nothing (no duplicates)')
  await fire(buildFullSyncOps(payload))
  ok('row counts unchanged', JSON.stringify(rowCounts()) === JSON.stringify(before), JSON.stringify(rowCounts()))

  teardownLiveSync()
  console.log(`\n${fail === 0 ? '✓ PASS' : '✗ FAIL'} — ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
