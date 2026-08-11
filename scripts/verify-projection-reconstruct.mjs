// verify-projection-reconstruct.mjs — the projection→canvas reverse mapping.
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
      n1: { sourceEditorId: 'nA' }, n2: { sourceEditorId: 'nB' },
      openings: [{ sourceEditorId: 'opD', openingType: 'DOOR', widthMm: 914.4, heightMm: 2133.6, offsetFromStartMm: 508 }],
      wallSurfaces: [{ room: { sourceEditorId: 'roomX' } }] },
    { sourceEditorId: 'wBC', heightMm: 3048, thicknessMm: 228.6, wallMaterial: 'AAC_BLOCK_200MM',
      n1: { sourceEditorId: 'nB' }, n2: { sourceEditorId: 'nC' },
      openings: [], wallSurfaces: [{ room: { sourceEditorId: 'roomX' } }] },
    { sourceEditorId: 'wCD', heightMm: 3048, thicknessMm: 228.6, wallMaterial: 'RED_BRICK_9_INCH',
      n1: { sourceEditorId: 'nC' }, n2: { sourceEditorId: 'nD' },
      openings: [], wallSurfaces: [{ room: { sourceEditorId: 'roomX' } }] },
    { sourceEditorId: 'wDA', heightMm: 3048, thicknessMm: 228.6, wallMaterial: 'RED_BRICK_9_INCH',
      n1: { sourceEditorId: 'nD' }, n2: { sourceEditorId: 'nA' },
      openings: [], wallSurfaces: [{ room: { sourceEditorId: 'roomX' } }] },
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
  console.log('✓ A. editor-born graph reconstruction')
}

// ── B. seed-born: rectangle synthesis, creation-order wall pairing ──────────
const seedState = {
  floors: [{ id: 'f-seed', sourceEditorId: null, floorNumber: 0 }],
  nodes: [],
  walls: ['N', 'S', 'E', 'W'].map((d, i) => ({
    sourceEditorId: `seed-wall-${d}`, heightMm: 3048, thicknessMm: 115, wallMaterial: 'RED_BRICK_4_5_INCH',
    n1: null, n2: null, openings: [], wallSurfaces: [{ room: { sourceEditorId: 'seed-room' } }],
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

console.log('✓ verify-projection-reconstruct passed')
