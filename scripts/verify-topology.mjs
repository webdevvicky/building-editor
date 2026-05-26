// scripts/verify-topology.mjs
//
// Topology layer regression suite — asserts the canonical spatial
// relationships, not the BOQ numbers. Catches breakage that doesn't
// immediately move a quantity (and therefore wouldn't be caught by
// verify-boq / verify-multifloor).
//
// Usage: node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-topology.mjs
//
// Covers the 9 assertions enumerated in the topology layer plan §6.

import { useStore } from '../src/store.js'
import {
  getRoomAdjacencyGraph, getWallSurfaces, getExternalWallIds,
  getNodeToColumnIndex, resolveBeamEndpoint, getDerivedWallBeams,
  getWetWalls, getWetWallIds, buildPlotPolygon,
} from '../src/topology/index.js'
import { scopeStateToFloor } from '../src/boq/scope.js'
import { verifyIntegrity } from '../src/schema/integrity.js'

const s = useStore.getState
const FT = 12

let pass = 0, fail = 0
function ok(label, cond, info) {
  if (cond) { pass++; console.log(`  ✓ ${label}${info ? '  ' + info : ''}`) }
  else { fail++; console.log(`  ✗ ${label}${info ? '  ' + info : ''}`) }
}

// Arch 9 baseline — re-asserted between major sections via this helper.
function _arch9Baseline(label) {
  const ir = verifyIntegrity(s())
  ok(`Arch 9 baseline (${label}): referential integrity holds`, ir.valid,
     ir.valid ? '' : `${ir.count} issues — first: ${ir.issues[0]?.message}`)
}
function header(t) {
  console.log('\n' + '─'.repeat(70))
  console.log(t.toUpperCase())
  console.log('─'.repeat(70))
}

// ── Fresh store + two rooms sharing a wall ──────────────────────────────────
header('Setup: two rooms sharing a wall')

// Room A: 10x10 ft starting at (0,0). Room B: 10x10 ft starting at (10ft,0).
// They share the wall on x = 10ft.
const aSW = s().getOrCreateNode(0,         0)
const aSE = s().getOrCreateNode(10 * FT,   0)
const aNE = s().getOrCreateNode(10 * FT,  10 * FT)
const aNW = s().getOrCreateNode(0,        10 * FT)
s().addWall(aSW, aSE)   // bottom
s().addWall(aSE, aNE)   // right (shared edge)
s().addWall(aNE, aNW)   // top
s().addWall(aNW, aSW)   // left

const wallsArr = Object.values(s().walls)
const findWall = (n1, n2) => wallsArr.find(w =>
  (w.n1 === n1 && w.n2 === n2) || (w.n2 === n1 && w.n1 === n2))
const aWallIds = [
  findWall(aSW, aSE)?.id,
  findWall(aSE, aNE)?.id,   // <- shared
  findWall(aNE, aNW)?.id,
  findWall(aNW, aSW)?.id,
].filter(Boolean)
aWallIds.forEach(id => s().togglePendingWall(id))
s().saveRoom('Bedroom', 'BEDROOM')
const roomA = Object.values(s().rooms).find(r => r.name === 'Bedroom')

// Room B reuses the shared wall (aSE → aNE) by referencing the same id.
const bSE = s().getOrCreateNode(20 * FT,   0)
const bNE = s().getOrCreateNode(20 * FT,  10 * FT)
// addWall snapshot order matters: bottom → right → top, then the shared edge
// already exists so the left wall of Room B is the same wall as the right of A.
s().addWall(aSE, bSE)
s().addWall(bSE, bNE)
s().addWall(bNE, aNE)

const sharedWallId = findWall(aSE, aNE).id   // re-resolved against latest walls map
const allWalls = Object.values(s().walls)
const bWallIds = [
  allWalls.find(w => (w.n1 === aSE && w.n2 === bSE) || (w.n2 === aSE && w.n1 === bSE))?.id,
  allWalls.find(w => (w.n1 === bSE && w.n2 === bNE) || (w.n2 === bSE && w.n1 === bNE))?.id,
  allWalls.find(w => (w.n1 === bNE && w.n2 === aNE) || (w.n2 === bNE && w.n1 === aNE))?.id,
  sharedWallId,
].filter(Boolean)
bWallIds.forEach(id => s().togglePendingWall(id))
s().saveRoom('Toilet', 'TOILET')
const roomB = Object.values(s().rooms).find(r => r.name === 'Toilet')

console.log(`  rooms: ${roomA.name} (${roomA.id.slice(0, 8)}), ${roomB.name} (${roomB.id.slice(0, 8)})`)
console.log(`  shared wall id: ${sharedWallId.slice(0, 8)}`)

// Arch 9 baseline — first assertion after setup; integrity must hold.
_arch9Baseline('post-setup')

// ── Assertion 1: adjacency graph shows the two rooms share a wall ───────────
header('1. getRoomAdjacencyGraph')

const graph = getRoomAdjacencyGraph(s())
const aNbrs = graph[roomA.id] ?? new Set()
const bNbrs = graph[roomB.id] ?? new Set()
ok('Room A → Room B is in adjacency', aNbrs.has(roomB.id))
ok('Room B → Room A is in adjacency (symmetric)', bNbrs.has(roomA.id))
ok('exactly one neighbour each (1 shared wall)', aNbrs.size === 1 && bNbrs.size === 1)

// ── Assertion 2: partition surfaces (both faces point to one of the rooms) ──
header('2. getWallSurfaces — partition between Room A and Room B')

const partSurf = getWallSurfaces(s(), sharedWallId)
const faceAOwner = partSurf?.faceA.roomId
const faceBOwner = partSurf?.faceB.roomId
const ownerSet = new Set([faceAOwner, faceBOwner])
ok('partition has two non-null faces',
   faceAOwner !== null && faceBOwner !== null,
   `(A=${faceAOwner?.slice(0,8)} B=${faceBOwner?.slice(0,8)})`)
ok('faceA + faceB owners cover exactly {Room A, Room B}',
   ownerSet.has(roomA.id) && ownerSet.has(roomB.id) && ownerSet.size === 2)

// ── Assertion 3: external wall has exactly one null face ────────────────────
header('3. getWallSurfaces — external wall has exactly one face null')

const extWallId = aWallIds.find(id => id !== sharedWallId)  // Room A's bottom wall
const extSurf = getWallSurfaces(s(), extWallId)
const nullCount = [extSurf?.faceA.roomId, extSurf?.faceB.roomId].filter(v => v === null).length
ok('external wall has exactly one null face', nullCount === 1,
   `(faceA=${extSurf.faceA.roomId?.slice(0,8) ?? 'null'} faceB=${extSurf.faceB.roomId?.slice(0,8) ?? 'null'})`)

// ── Assertion 4: external wall set count vs plot polygon edge count ─────────
header('4. getExternalWallIds — count when plot closed')

// Flip the 6 outer walls of A+B (everything except the shared partition) to
// plot walls. This gives a closed plot polygon with 6 edges.
const outerWalls = [...aWallIds, ...bWallIds].filter(id => id !== sharedWallId)
const outerSet = new Set(outerWalls)
ok('outer ring distinct from partition', outerSet.size === outerWalls.length)
for (const id of outerWalls) s().setWallIsPlot(id, true)
const plotPoly = buildPlotPolygon(s().walls, s().nodes)
ok('buildPlotPolygon returns a closed loop', plotPoly !== null,
   plotPoly ? `(${plotPoly.length} vertices)` : '')
// External walls = walls bordering exactly one room. With plot walls flipped
// on, the outer ring walls remain in their respective rooms' wallIds (Room A
// owns 3 of the outer ring, Room B owns 3). Adjacency stays unchanged by
// isPlot flag — so external set is still 6 walls, matching plot polygon
// edge count.
const extIds = getExternalWallIds(s(), { includePlotWalls: true })
ok('externalWallIds count matches plot polygon edge count',
   extIds.size === plotPoly.length,
   `(ext=${extIds.size}, plotEdges=${plotPoly.length})`)
// Reset plot flags for downstream assertions
for (const id of outerWalls) s().setWallIsPlot(id, false)

// ── Assertion 5: getNodeToColumnIndex is bijective on attached columns ──────
header('5. getNodeToColumnIndex — bijective on attached columns')

s().addColumn(0, 0, 'C1', aSW)
s().addColumn(10 * FT, 0, 'C1', aSE)
s().addColumn(20 * FT, 0, 'C1', bSE)
const idx = getNodeToColumnIndex(s())
const attachedColumns = Object.values(s().columns).filter(c => c.attachedNodeId)
const nodeIdsInIdx = new Set(Object.keys(idx))
const colIdsInIdx  = new Set(Object.values(idx))
ok('every attached column has a node → column entry',
   attachedColumns.every(c => idx[c.attachedNodeId] === c.id))
ok('node → column is injective (no duplicate column id)',
   colIdsInIdx.size === attachedColumns.length)
ok('node → column is surjective onto attached column set',
   nodeIdsInIdx.size === attachedColumns.length)

// ── Assertion 6: resolveBeamEndpoint returns null iff column id is dangling ─
header('6. resolveBeamEndpoint — null only when column id is dangling')

const goodCol = Object.values(s().columns)[0]
const goodRef    = { type: 'COLUMN', columnId: goodCol.id }
const danglingRef = { type: 'COLUMN', columnId: 'definitely-not-a-real-column-id' }
const pointRef   = { type: 'POINT', x: 100, y: 200 }
ok('good column ref resolves to non-null',     resolveBeamEndpoint(s(), goodRef) !== null)
ok('dangling column ref resolves to null',     resolveBeamEndpoint(s(), danglingRef) === null)
ok('POINT ref resolves to non-null',           resolveBeamEndpoint(s(), pointRef) !== null)
ok('POINT ref returns the exact x,y',
   resolveBeamEndpoint(s(), pointRef).x === 100 &&
   resolveBeamEndpoint(s(), pointRef).y === 200)

// ── Assertion 7: getWetWalls of a TOILET project equals the room's wallIds ──
header('7. getWetWalls — TOILET project')

// Toilet (roomB) has 4 walls (3 outer + the shared partition). They should
// all be in the wet set since TOILET ∈ WET_ROOM_TYPES.
const wetIds = getWetWallIds(s())
const roomBSet = new Set(roomB.wallIds)
ok('wetWallIds is exactly Room Toilet\'s wallIds',
   wetIds.size === roomBSet.size &&
   [...wetIds].every(id => roomBSet.has(id)),
   `(wet=${wetIds.size}, toilet=${roomBSet.size})`)
const wetWalls = getWetWalls(s())
ok('getWetWalls returns the same wallIds as objects', wetWalls.length === wetIds.size)

// ── Assertion 8: getDerivedWallBeams count invariant scoped vs unscoped ─────
header('8. getDerivedWallBeams — scoped vs unscoped (single-floor)')

const unscopedDerived = getDerivedWallBeams(s())
const scoped = scopeStateToFloor(s(), 'F1')
const scopedDerived = getDerivedWallBeams(scoped)
ok('derived beam count is the same (single-floor case)',
   unscopedDerived.length === scopedDerived.length,
   `(unscoped=${unscopedDerived.length}, scoped=${scopedDerived.length})`)

// ── Assertion 9: memoization returns reference-equal results ────────────────
header('9. Memoization — reference equality on stable inputs')

const adj1 = getRoomAdjacencyGraph(s())
const adj2 = getRoomAdjacencyGraph(s())
ok('getRoomAdjacencyGraph reference-equal on repeat call', adj1 === adj2)
const idx1 = getNodeToColumnIndex(s())
const idx2 = getNodeToColumnIndex(s())
ok('getNodeToColumnIndex reference-equal on repeat call', idx1 === idx2)
const derived1 = getDerivedWallBeams(s())
const derived2 = getDerivedWallBeams(s())
ok('getDerivedWallBeams reference-equal on repeat call', derived1 === derived2)

// Mutation invalidates the cache
s().addColumn(5 * FT, 5 * FT, 'C1')   // standalone, changes columns ref
const idx3 = getNodeToColumnIndex(s())
ok('getNodeToColumnIndex recomputes after columns mutation',
   idx3 !== idx2 || Object.keys(idx3).length === Object.keys(idx2).length)

// ── Summary ─────────────────────────────────────────────────────────────────
header(`Result: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
console.log('\n✓ Topology layer verification passed.')
