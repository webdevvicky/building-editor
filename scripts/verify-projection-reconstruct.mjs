// verify-projection-reconstruct.mjs — the projection→canvas reverse mapping.
//
// Fixtures use the REAL GET /geometry/buildings/:id/state contract (erp-saas
// GeometryLiveService.getBuildingState, pinned by its spec): walls name their nodes as
// n1NodeSourceEditorId/n2NodeSourceEditorId and every room they bound as
// roomSourceEditorIds (XR-01: the old fixtures used a wall shape the ERP never sent).
//
// Covers both reconstruction paths:
//   A. editor-born building (real node graph: walls carry n1/n2 sourceEditorIds)
//   B. seed-born building (no node graph: rectangle synthesized from
//      posXMm + length/width ft, walls paired in creation order N,S,E,W)
// plus identity preservation (ifcGlobalId === sourceEditorId), unit conversion
// (mm → inches), opening mapping, and the mismatch-counts helper.

import assert from 'assert'
import { reconstructFromProjection, projectionCounts } from '../src/projects/projectionReconstruct.js'

// ── A. editor-born: real node graph ─────────────────────────────────────────
const graphState = {
  floors: [{ id: 'f-erp-1', sourceEditorId: 'F1', floorNumber: 1 }],
  nodes: [
    { id: 'n1e', sourceEditorId: 'nA', xMm: 0, yMm: 0, kind: 'CORNER' },
    { id: 'n2e', sourceEditorId: 'nB', xMm: 6096, yMm: 0, kind: 'CORNER' },
    { id: 'n3e', sourceEditorId: 'nC', xMm: 6096, yMm: 9144, kind: 'CORNER' },
    { id: 'n4e', sourceEditorId: 'nD', xMm: 0, yMm: 9144, kind: 'CORNER' },
  ],
  walls: [
    { sourceEditorId: 'wAB', heightMm: 3048, thicknessMm: 228.6, wallMaterial: 'RED_BRICK_9_INCH',
      n1NodeSourceEditorId: 'nA', n2NodeSourceEditorId: 'nB',
      openings: [{ sourceEditorId: 'opD', openingType: 'DOOR', widthMm: 914.4, heightMm: 2133.6, offsetFromStartMm: 508 }],
      roomSourceEditorIds: ['roomX'] },
    { sourceEditorId: 'wBC', heightMm: 3048, thicknessMm: 228.6, wallMaterial: 'AAC_BLOCK_200MM',
      n1NodeSourceEditorId: 'nB', n2NodeSourceEditorId: 'nC',
      openings: [], roomSourceEditorIds: ['roomX'] },
    { sourceEditorId: 'wCD', heightMm: 3048, thicknessMm: 228.6, wallMaterial: 'RED_BRICK_9_INCH',
      n1NodeSourceEditorId: 'nC', n2NodeSourceEditorId: 'nD',
      openings: [], roomSourceEditorIds: ['roomX'] },
    { sourceEditorId: 'wDA', heightMm: 3048, thicknessMm: 228.6, wallMaterial: 'RED_BRICK_9_INCH',
      n1NodeSourceEditorId: 'nD', n2NodeSourceEditorId: 'nA',
      openings: [], roomSourceEditorIds: ['roomX'] },
  ],
  rooms: [{ id: 'r-erp', sourceEditorId: 'roomX', name: 'Living', floorId: 'f-erp-1',
    roomType: { code: 'LIVING_ROOM' }, posXMm: 0, posYMm: 0, length: '30', width: '20',
    roomShape: 'RECTANGULAR', vertices: [] }],
}

{
  const { payload, counts } = reconstructFromProjection(graphState)
  assert.strictEqual(counts.rooms, 1)
  assert.strictEqual(counts.walls, 4)
  // identity preserved
  assert.ok(payload.walls.wAB, 'wall keyed by sourceEditorId')
  assert.strictEqual(payload.walls.wAB.ifcGlobalId, 'wAB')
  assert.strictEqual(payload.rooms.roomX.ifcGlobalId, 'roomX')
  // units: 6096 mm → 240 in; 3048 mm → 120 in; 228.6 mm → 9 in
  assert.strictEqual(payload.nodes.nB.x, 240)
  assert.strictEqual(payload.walls.wAB.height, 120)
  assert.strictEqual(payload.walls.wAB.thickness, 9)
  // wall graph wiring
  assert.strictEqual(payload.walls.wBC.n1, 'nB')
  assert.strictEqual(payload.walls.wBC.n2, 'nC')
  assert.strictEqual(payload.walls.wBC.materialKey, 'AAC_BLOCK')
  // opening mapped to editor shape (inches, lowercase type)
  const op = payload.walls.wAB.openings[0]
  assert.strictEqual(op.type, 'door')
  assert.strictEqual(op.width, 36)
  assert.strictEqual(op.offset, 20)
  // room: walls + closed node loop
  assert.strictEqual(payload.rooms.roomX.wallIds.length, 4)
  assert.strictEqual(payload.rooms.roomX.nodeOrder.length, 4)
  assert.strictEqual(payload.rooms.roomX.type, 'LIVING_ROOM')
  assert.strictEqual(payload.rooms.roomX.roomTypeCode, 'LIVING_ROOM')
  assert.strictEqual(payload.rooms.roomX.floorId, 'F1', 'room lands on its own floor')
  // XR-01: each ERP wall is rebuilt ONCE — no synthesized duplicate beside it.
  assert.deepStrictEqual(Object.keys(payload.walls).sort(), ['wAB', 'wBC', 'wCD', 'wDA'])
  assert.deepStrictEqual(Object.keys(payload.nodes).sort(), ['nA', 'nB', 'nC', 'nD'])
  console.log('✓ A. editor-born graph reconstruction (no duplicate walls)')
}

// ── B. seed-born: rectangle synthesis, creation-order wall pairing ──────────
const seedState = {
  floors: [{ id: 'f-seed', sourceEditorId: null, floorNumber: 0 }],
  nodes: [],
  walls: ['N', 'S', 'E', 'W'].map((d, i) => ({
    sourceEditorId: `seed-wall-${d}`, heightMm: 3048, thicknessMm: 115, wallMaterial: 'RED_BRICK_4_5_INCH',
    n1NodeSourceEditorId: null, n2NodeSourceEditorId: null, openings: [], roomSourceEditorIds: ['seed-room'],
  })),
  rooms: [{ id: 'r-seed', sourceEditorId: 'seed-room', name: 'Bedroom 1', floorId: 'f-seed',
    roomType: { code: 'BEDROOM' }, posXMm: 1000, posYMm: 2000, length: '12', width: '10',
    roomShape: 'RECTANGULAR', vertices: [] }],
}

{
  const { payload, counts, skipped } = reconstructFromProjection(seedState)
  assert.strictEqual(counts.rooms, 1)
  assert.strictEqual(counts.walls, 4)
  assert.strictEqual(skipped.rooms.length, 0)
  const room = payload.rooms['seed-room']
  // creation-order pairing keeps ERP wall identity on synthesized edges
  assert.deepStrictEqual(room.wallIds, ['seed-wall-N', 'seed-wall-S', 'seed-wall-E', 'seed-wall-W'])
  assert.strictEqual(room.nodeOrder.length, 4, 'synthesized rectangle closes')
  // rectangle corners: 10 ft wide → 120 in span from posX 1000mm (39.37in)
  const n0 = payload.nodes[room.nodeOrder[0]]
  assert.ok(Math.abs(n0.x - 1000 / 25.4) < 1e-9)
  // walls carry the ERP row's real thickness (115 mm → ~4.53 in)
  assert.ok(Math.abs(payload.walls['seed-wall-N'].thickness - 115 / 25.4) < 1e-9)
  console.log('✓ B. seed-born rectangle synthesis + identity pairing')
}

// ── counts helper + degenerate room skip ────────────────────────────────────
{
  assert.deepStrictEqual(projectionCounts(graphState), { rooms: 1, walls: 4 })
  const degenerate = {
    floors: [], nodes: [], walls: [],
    rooms: [{ id: 'x', sourceEditorId: 'deg', name: 'NoDims', floorId: null,
      roomType: null, posXMm: 0, posYMm: 0, length: null, width: null, roomShape: 'RECTANGULAR', vertices: [] }],
  }
  const { counts, skipped } = reconstructFromProjection(degenerate)
  assert.strictEqual(counts.rooms, 0)
  assert.deepStrictEqual(skipped.rooms, ['NoDims'])
  console.log('✓ C. counts helper + degenerate-room skip')
}

// ── D. null-sourceEditorId rows get id-map registrations ────────────────────
{
  const nullSidState = {
    floors: [{ id: 'f1', sourceEditorId: null, floorNumber: 0 }],
    nodes: [],
    walls: [0, 1, 2, 3].map((i) => ({
      id: `erp-wall-${i}`, sourceEditorId: null, heightMm: 3048, thicknessMm: 115,
      wallMaterial: 'RED_BRICK_4_5_INCH', n1NodeSourceEditorId: null, n2NodeSourceEditorId: null, openings: [],
      roomSourceEditorIds: ['rm-sid'],
    })),
    rooms: [{ id: 'erp-room-1', sourceEditorId: 'rm-sid', name: 'R', floorId: 'f1',
      roomType: null, posXMm: 0, posYMm: 0, length: '10', width: '10',
      roomShape: 'RECTANGULAR', vertices: [] }],
  }
  const { idMappings, counts } = reconstructFromProjection(nullSidState)
  assert.strictEqual(counts.walls, 4)
  // every null-sid wall row must be mapped: synthesized canvas id → ERP row id
  assert.strictEqual(idMappings.length, 4)
  const erpIds = idMappings.map(([, erpId]) => erpId).sort()
  assert.deepStrictEqual(erpIds, ['erp-wall-0', 'erp-wall-1', 'erp-wall-2', 'erp-wall-3'])
  for (const [editorId] of idMappings) assert.ok(editorId.startsWith('rm-sid-w'))
  console.log('✓ D. null-sourceEditorId rows registered in the id-map')
}

// ── E. XR-10: every element kind is rebuilt, nothing dropped ────────────────
{
  const el = (kind, sid, extra = {}) => ({ id: `erp-${sid}`, sourceEditorId: sid, kind, status: 'PLANNED', floorId: 'f-erp-1',
    mepPointType: null, roomSourceEditorId: null, posXMm: 254, posYMm: 508, fromXMm: null, fromYMm: null, toXMm: null,
    toYMm: null, sectionShape: null, sectionWidthMm: null, sectionDepthMm: null, diameterMm: null, heightMm: null,
    spanMm: null, thicknessMm: null, structuralLevel: null, slabRole: null, slabType: null, spec: null,
    roomSourceEditorIds: [], ...extra })
  const state = {
    ...graphState,
    elements: [
      el('COLUMN', 'col1', { spec: { columnTypeId: 'C1', topFloorId: 'F1', position: null, classification: null } }),
      el('BEAM', 'bm1', { posXMm: null, posYMm: null, fromXMm: 0, fromYMm: 0, toXMm: 2540, toYMm: 0, structuralLevel: 'lintel',
        spec: { source: 'EXPLICIT', from: { type: 'COLUMN', columnIfcId: 'col1' }, to: { type: 'POINT', x: 100, y: 0 } } }),
      el('SLAB', 'sl1', { thicknessMm: 127, slabType: 'MAIN', slabRole: 'ROOF', roomSourceEditorIds: ['roomX'],
        spec: { grade: 'M25', sinkDepthIn: 0, roleSource: 'AUTO', classification: null } }),
      el('STAIRCASE', 'st1', { spec: { type: 'STRAIGHT', flightCount: 1, stepsPerFlight: 14 } }),
      el('FOUNDATION', 'fd1', { spec: { type: 'ISOLATED', columnIfcIds: ['col1'], wallIfcIds: [], geometry: { lengthFt: 4 } } }),
      el('RISER', 'rs1', { spec: { kind: 'SOIL_STACK', discipline: 'PLUMBING', fromFloorId: 'F1', toFloorId: 'F1' } }),
      el('MEP_PLUMBING', 'pl1', { roomSourceEditorId: 'roomX', spec: { type: 'WC', rotationDeg: 90, wallIfcId: 'wAB', wallT: 0.5 } }),
      el('MEP_ELECTRICAL', 'ep1', { roomSourceEditorId: 'roomX', mepPointType: 'AC', spec: { type: 'POINT', rotationDeg: 0, wallIfcId: null, wallT: null } }),
      el('MEP_HVAC', 'hv1', { spec: { type: 'SPLIT_AC' } }),
      el('MEP_FIRE', 'fr1', { spec: { type: 'SMOKE_DETECTOR' } }),
      el('MEP_ELV', 'ev1', { spec: { type: 'CCTV' } }),
      el('MEP_SOLAR', 'so1', { spec: { type: 'PANEL' } }),
    ],
  }
  const { payload, counts, skipped } = reconstructFromProjection(state)
  assert.strictEqual(counts.elements, 12, 'every element kind is rebuilt')
  assert.deepStrictEqual(skipped.elements, [])
  assert.strictEqual(payload.columns.col1.columnTypeId, 'C1')
  assert.strictEqual(payload.columns.col1.x, 10)
  assert.strictEqual(payload.columns.col1.baseFloorId, 'F1')
  assert.deepStrictEqual(payload.beams.bm1.endpoints.from, { type: 'COLUMN', columnId: 'col1' })
  assert.strictEqual(payload.beams.bm1.level, 'lintel')
  assert.strictEqual(payload.slabs.sl1.thicknessIn, 5)
  assert.deepStrictEqual(payload.slabs.sl1.roomIds, ['roomX'])
  assert.strictEqual(payload.slabs.sl1.grade, 'M25')
  assert.strictEqual(payload.staircases.st1.type, 'STRAIGHT')
  assert.strictEqual(payload.staircases.st1.waistSlabIn, 6, 'unset spec fields take the schema default')
  assert.deepStrictEqual(payload.foundations.fd1.columnIds, ['col1'])
  assert.strictEqual(payload.risers.rs1.kind, 'SOIL_STACK')
  assert.strictEqual(payload.plumbingFixtures.pl1.type, 'WC')
  assert.strictEqual(payload.plumbingFixtures.pl1.roomId, 'roomX')
  assert.strictEqual(payload.plumbingFixtures.pl1.wallId, 'wAB')
  assert.strictEqual(payload.electricalPoints.ep1.pointType, 'AC')
  for (const c of ['hvacUnits', 'fireDevices', 'elvDevices', 'solarEquipment']) {
    assert.strictEqual(Object.keys(payload[c]).length, 1, `${c} rebuilt`)
  }
  console.log('✓ E. every element kind rebuilt (XR-10)')
}

// ── F. floors rebuilt from the ERP; editor-only settings kept, never reset ──
{
  const state = {
    ...graphState,
    floors: [
      { id: 'f-erp-2', sourceEditorId: 'F2', floorNumber: 2, floorHeight: '11' },
      { id: 'f-erp-1', sourceEditorId: 'F1', floorNumber: 1, floorHeight: '10' },
    ],
  }
  const projectSettings = {
    name: 'Karthik Villa', drawReference: 'centerline',
    floors: [{ id: 'F1', label: 'Ground', sequence: 0, plinthHeightFt: 2, floorHeightFt: 10, meta: null, underlay: null }],
  }
  const { payload } = reconstructFromProjection(state, { projectSettings, stamps: { s1: { id: 's1' } }, ratesByKey: { k: 1 } })
  assert.strictEqual(payload.projectSettings.name, 'Karthik Villa', 'settings are kept')
  assert.strictEqual(payload.projectSettings.drawReference, 'centerline')
  assert.deepStrictEqual(payload.projectSettings.floors.map((f) => f.id), ['F1', 'F2'])
  assert.strictEqual(payload.projectSettings.floors[0].label, 'Ground', 'editor-only floor label kept')
  assert.strictEqual(payload.projectSettings.floors[0].plinthHeightFt, 2)
  assert.strictEqual(payload.projectSettings.floors[1].floorHeightFt, 11)
  assert.strictEqual(payload.projectSettings.floors[1].sequence, 1)
  assert.deepStrictEqual(payload.stamps, { s1: { id: 's1' } }, 'stamps (editor-only) kept')
  assert.deepStrictEqual(payload.ratesByKey, { k: 1 })
  console.log('✓ F. floors from the ERP, editor-only settings kept')
}

console.log('✓ verify-projection-reconstruct passed')
