import assert from 'node:assert/strict'
import { fireLiveOp, GEOMETRY_OPS, registerErpId } from '../src/projects/liveSync.js'

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
registerErpId('WallIfc000000000000001', 'erpWall1')
registerErpId('RoomIfc000000000000001', 'erpRoom1')
registerErpId('NodeIfc000000000000001', 'erpNode1')
registerErpId('ColmIfc000000000000001', 'erpCol1')
registerErpId('BeamIfc000000000000001', 'erpBeam1')
registerErpId('SlabIfc000000000000001', 'erpSlab1')
registerErpId('OpenIfc000000000000001', 'erpOpen1')
registerErpId('ElemIfc000000000000001', 'erpElem1')
registerErpId('Wall2Ifc00000000000001', 'erpWall2')

// ── Mock conn ─────────────────────────────────────────────────────────────────
const mockConn = {
  erpUrl: 'https://erp.test',
  buildingId: 'erpBldg1',
  floorIds: { F1: 'erpFloor1' },
  getToken: async () => 'mock-jwt-token',
}

// ── Test cases ────────────────────────────────────────────────────────────────
const OP_TEST_CASES = [
  // Walls
  ['ADD_WALL',          { ifcGlobalId: 'WallIfc000000000000002', materialKey: 'IS_MODULAR_BRICK', height: 120, thickness: 9, roomErpId: 'erpRoom1' }],
  ['UPDATE_WALL',       { ifcGlobalId: 'WallIfc000000000000001', wallErpId: 'erpWall1', height: 130 }],
  ['DELETE_WALL',       { ifcGlobalId: 'WallIfc000000000000001', wallErpId: 'erpWall1' }],
  ['SET_WALL_MATERIAL', { ifcGlobalId: 'WallIfc000000000000001', wallErpId: 'erpWall1', materialKey: 'AAC_BLOCK' }],
  ['SET_WALL_HEIGHT',   { ifcGlobalId: 'WallIfc000000000000001', wallErpId: 'erpWall1', height: 110 }],
  ['SPLIT_WALL',        { ifcGlobalId: 'WallIfc000000000000001', wallErpId: 'erpWall1', atFractions: [0.5], newWalls: [{ ifcGlobalId: 'WallIfc000000000000002', lengthMm: 1200, height: 120, thickness: 9, orientation: 'N' }, { ifcGlobalId: 'WallIfc000000000000003', lengthMm: 1200, height: 120, thickness: 9, orientation: 'N' }] }],
  ['JOIN_WALLS',        { wallIfcIds: ['WallIfc000000000000001', 'Wall2Ifc00000000000001'], mergedIfcGlobalId: 'WallIfc000000000000004', height: 120, thickness: 9 }],
  // Openings
  ['ADD_OPENING',       { ifcGlobalId: 'OpenIfc000000000000002', wallErpId: 'erpWall1', type: 'window', width: 36, height: 48 }],
  ['UPDATE_OPENING',    { ifcGlobalId: 'OpenIfc000000000000001', openingErpId: 'erpOpen1', width: 40, height: 50 }],
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
  // Columns
  ['ADD_COLUMN',        { ifcGlobalId: 'ColmIfc000000000000002', x: 0, y: 0 }],
  ['UPDATE_COLUMN',     { ifcGlobalId: 'ColmIfc000000000000001', elementErpId: 'erpCol1', x: 10, y: 10 }],
  ['DELETE_COLUMN',     { ifcGlobalId: 'ColmIfc000000000000001', elementErpId: 'erpCol1' }],
  // Beams
  ['ADD_BEAM',          { ifcGlobalId: 'BeamIfc000000000000002', spanMm: 3000 }],
  ['UPDATE_BEAM',       { ifcGlobalId: 'BeamIfc000000000000001', elementErpId: 'erpBeam1', spanMm: 3500 }],
  ['DELETE_BEAM',       { ifcGlobalId: 'BeamIfc000000000000001', elementErpId: 'erpBeam1' }],
  // Slabs
  ['ADD_SLAB',          { ifcGlobalId: 'SlabIfc000000000000002', thicknessMm: 125 }],
  ['UPDATE_SLAB',       { ifcGlobalId: 'SlabIfc000000000000001', elementErpId: 'erpSlab1', thicknessMm: 150 }],
  ['DELETE_SLAB',       { ifcGlobalId: 'SlabIfc000000000000001', elementErpId: 'erpSlab1' }],
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
  if (threw) {
    failed.push(`${opType}: threw — ${throwMsg}`)
  } else if (fetchCalls.length !== 1) {
    failed.push(`${opType}: expected exactly 1 fetch call, got ${fetchCalls.length}`)
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

// ── Report ────────────────────────────────────────────────────────────────────
console.log(`\nPASSED: ${passed.length}`)
for (const p of passed) console.log(`   ✓ ${p}`)
if (failed.length > 0) {
  console.log(`\nFAILED:`)
  for (const f of failed) console.log(`   ✗ ${f}`)
  process.exit(1)
}
console.log('\n✓ verify-live-sync passed — every geometry op fires exactly one REST call.')
