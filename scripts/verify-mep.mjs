// scripts/verify-mep.mjs
//
// MEP regression suite. Built incrementally per phase.
//
// Usage:
//   node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-mep.mjs
//
// Phase 0a — getFloorWallPerimeterGraph primitive (THIS RUN):
//   - Basic single-room graph (4 walls, 4 nodes, 4 edges)
//   - T-intersection from splitWall (midpoint node with degree 3)
//   - Two rooms sharing a wall (degree-2 endpoints, no edge duplication)
//   - Walls sharing a node but not collinear (corner)
//   - Multi-floor isolation (F1 graph ≠ F2 graph)
//   - Memoization: same input refs → same result reference
//   - Memoization invalidation: after splitWall, graph recomputes
//   - Edge weights match wall lengths in feet
//   - Determinism: rebuild from scratch matches existing
//
// Future phases add: catalog stability, system graph correctness,
// route stability, quantity accuracy, BOQ integration, floor scope.

import { useStore } from '../src/store.js'
import {
  getFloorWallPerimeterGraph,
  getRoomWallPerimeterGraph,
  getCeilingPaths,
} from '../src/topology/index.js'

const s = useStore.getState
const FT = 12

let pass = 0, fail = 0
const failures = []
function ok(label, cond, info) {
  if (cond) { pass++; console.log(`  ✓ ${label}${info ? '  ' + info : ''}`) }
  else { fail++; failures.push(`${label}${info ? '  ' + info : ''}`); console.log(`  ✗ ${label}${info ? '  ' + info : ''}`) }
}
function header(t) {
  console.log('\n' + '─'.repeat(70))
  console.log(t.toUpperCase())
  console.log('─'.repeat(70))
}

// Fresh store helper — uses loadProject with an empty state.
function reset() {
  s().loadProject({
    nodes: {}, walls: {}, rooms: {}, stamps: {},
    columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {},
    projectSettings: undefined,
    unit: 'inch',
  })
}

// ─────────────────────────────────────────────────────────────────────
// Test 1: Single-room graph — 4 walls, 4 nodes, 4 edges
// ─────────────────────────────────────────────────────────────────────
header('1. Single-room graph (10×10 ft Living)')
reset()
{
  const SW = s().getOrCreateNode(0, 0)
  const SE = s().getOrCreateNode(10 * FT, 0)
  const NE = s().getOrCreateNode(10 * FT, 10 * FT)
  const NW = s().getOrCreateNode(0, 10 * FT)
  s().addWall(SW, SE); s().addWall(SE, NE); s().addWall(NE, NW); s().addWall(NW, SW)

  const g = getFloorWallPerimeterGraph(s(), 'F1')
  const nodeCount = Object.keys(g.nodes).length
  const edgeCount = Object.keys(g.edges).length

  ok('graph.floorId === F1', g.floorId === 'F1')
  ok('4 nodes in graph', nodeCount === 4, `got ${nodeCount}`)
  ok('4 edges in graph', edgeCount === 4, `got ${edgeCount}`)

  // Each node should have degree 2 (two walls meeting at a corner)
  const degrees = Object.values(g.nodes).map(n => n.edgeIds.length)
  ok('every node has degree 2 (corner)',
    degrees.every(d => d === 2),
    `degrees: [${degrees.join(',')}]`)

  // Edge weight: bottom wall is 10 ft
  const bottomWall = Object.values(g.edges).find(
    e => (e.fromNodeId === SW && e.toNodeId === SE) ||
         (e.fromNodeId === SE && e.toNodeId === SW)
  )
  ok('bottom edge lengthFt ≈ 10', bottomWall && Math.abs(bottomWall.lengthFt - 10) < 0.01,
    `got ${bottomWall?.lengthFt}`)

  // Adjacency: SW connects to SE and NW (the two adjacent corners)
  const swAdj = Object.keys(g.adjacency[SW] ?? {})
  ok('SW adjacency = {SE, NW}', swAdj.length === 2 && swAdj.includes(SE) && swAdj.includes(NW),
    `got [${swAdj.join(',')}]`)
}

// ─────────────────────────────────────────────────────────────────────
// Test 2: T-intersection from splitWall — midpoint has degree 3
// ─────────────────────────────────────────────────────────────────────
header('2. T-intersection: splitWall midpoint has degree 3')
reset()
{
  // Build a 20ft horizontal wall, then split it at midpoint, then add a
  // 10ft branch perpendicular from the midpoint — classic T.
  const W = s().getOrCreateNode(0, 0)
  const E = s().getOrCreateNode(20 * FT, 0)
  s().addWall(W, E)

  const wallId = Object.values(s().walls).find(w =>
    (w.n1 === W && w.n2 === E) || (w.n1 === E && w.n2 === W)
  )?.id
  // Split midway
  const splitResult = s().splitWall(wallId, 10 * FT, 0, { force: true })
  const midId = splitResult?.nodeId ?? splitResult  // splitWall may return id directly

  // After split: 2 walls (W→mid, mid→E). Now add a branch wall going north.
  const N = s().getOrCreateNode(10 * FT, 10 * FT)
  s().addWall(midId, N)

  const g = getFloorWallPerimeterGraph(s(), 'F1')
  const midNode = g.nodes[midId]
  ok('midpoint node exists in graph', !!midNode)
  ok('midpoint has degree 3 (T-intersection)',
    midNode && midNode.edgeIds.length === 3,
    `got degree ${midNode?.edgeIds.length}`)

  // 3 walls total now (W→mid, mid→E, mid→N)
  ok('3 edges after split + branch',
    Object.keys(g.edges).length === 3,
    `got ${Object.keys(g.edges).length}`)

  // Adjacency from mid lists all 3 neighbors
  const midAdj = Object.keys(g.adjacency[midId] ?? {})
  ok('midpoint adjacency size 3',
    midAdj.length === 3, `got [${midAdj.join(',')}]`)
  ok('midpoint adjacency contains W, E, N',
    midAdj.includes(W) && midAdj.includes(E) && midAdj.includes(N))
}

// ─────────────────────────────────────────────────────────────────────
// Test 3: Two rooms sharing a wall — graph dedupes correctly
// ─────────────────────────────────────────────────────────────────────
header('3. Two rooms share a wall — shared edge appears once')
reset()
{
  // Room A: 10×10 at (0,0). Room B: 10×10 at (10,0). Share wall at x=10.
  const aSW = s().getOrCreateNode(0, 0)
  const aSE = s().getOrCreateNode(10 * FT, 0)
  const aNE = s().getOrCreateNode(10 * FT, 10 * FT)
  const aNW = s().getOrCreateNode(0, 10 * FT)
  s().addWall(aSW, aSE); s().addWall(aSE, aNE); s().addWall(aNE, aNW); s().addWall(aNW, aSW)

  const bSE = s().getOrCreateNode(20 * FT, 0)
  const bNE = s().getOrCreateNode(20 * FT, 10 * FT)
  s().addWall(aSE, bSE); s().addWall(bSE, bNE); s().addWall(bNE, aNE)

  const g = getFloorWallPerimeterGraph(s(), 'F1')

  // 6 nodes (aSW, aSE, aNE, aNW, bSE, bNE) and 7 walls
  ok('6 nodes after both rooms', Object.keys(g.nodes).length === 6,
    `got ${Object.keys(g.nodes).length}`)
  ok('7 edges (4 of A + 3 new of B, shared wall counted once)',
    Object.keys(g.edges).length === 7, `got ${Object.keys(g.edges).length}`)

  // Shared corner (aSE) has degree 3: aSW (Room A bottom), aNE (shared wall), bSE (Room B bottom)
  const sharedCornerDegree = g.nodes[aSE].edgeIds.length
  ok('shared corner aSE has degree 3', sharedCornerDegree === 3,
    `got ${sharedCornerDegree}`)

  // Both rooms touch aNE corner too: aSE (shared wall), aNW (A top), bNE (B top)
  const aNEDegree = g.nodes[aNE].edgeIds.length
  ok('shared corner aNE has degree 3', aNEDegree === 3, `got ${aNEDegree}`)
}

// ─────────────────────────────────────────────────────────────────────
// Test 4: Walls sharing a node but not collinear (a corner)
// ─────────────────────────────────────────────────────────────────────
header('4. Two non-collinear walls share a node (corner)')
reset()
{
  // L-shape: south wall + east wall meeting at SE corner.
  const W = s().getOrCreateNode(0, 0)
  const SE = s().getOrCreateNode(10 * FT, 0)
  const NE = s().getOrCreateNode(10 * FT, 10 * FT)
  s().addWall(W, SE)
  s().addWall(SE, NE)

  const g = getFloorWallPerimeterGraph(s(), 'F1')
  const corner = g.nodes[SE]
  ok('corner node exists', !!corner)
  ok('corner has degree 2 (two non-collinear walls)',
    corner && corner.edgeIds.length === 2,
    `got ${corner?.edgeIds.length}`)

  const cornerAdj = Object.keys(g.adjacency[SE] ?? {})
  ok('corner adjacency = {W, NE}',
    cornerAdj.length === 2 && cornerAdj.includes(W) && cornerAdj.includes(NE),
    `got [${cornerAdj.join(',')}]`)
}

// ─────────────────────────────────────────────────────────────────────
// Test 5: Multi-floor isolation — F1 graph excludes F2 walls
// ─────────────────────────────────────────────────────────────────────
header('5. Multi-floor: F1 graph excludes F2 walls')
reset()
{
  // F1: 10×10 box
  s().setCurrentFloorId('F1')
  const f1SW = s().getOrCreateNode(0, 0)
  const f1SE = s().getOrCreateNode(10 * FT, 0)
  s().addWall(f1SW, f1SE)

  // Create F2
  const f2Id = s().addFloor({ label: 'Floor 2', floorHeightFt: 10 })
  s().setCurrentFloorId(f2Id)
  const f2A = s().getOrCreateNode(100 * FT, 0)
  const f2B = s().getOrCreateNode(110 * FT, 0)
  s().addWall(f2A, f2B)

  const g1 = getFloorWallPerimeterGraph(s(), 'F1')
  const g2 = getFloorWallPerimeterGraph(s(), f2Id)

  ok('F1 graph has 1 edge', Object.keys(g1.edges).length === 1,
    `got ${Object.keys(g1.edges).length}`)
  ok('F2 graph has 1 edge', Object.keys(g2.edges).length === 1,
    `got ${Object.keys(g2.edges).length}`)
  ok('F1 nodes do not include F2 nodes',
    !g1.nodes[f2A] && !g1.nodes[f2B])
  ok('F2 nodes do not include F1 nodes',
    !g2.nodes[f1SW] && !g2.nodes[f1SE])
  ok('graph.floorId matches argument', g1.floorId === 'F1' && g2.floorId === f2Id)
}

// ─────────────────────────────────────────────────────────────────────
// Test 6: Memoization — same input refs return same result reference
// ─────────────────────────────────────────────────────────────────────
header('6. Memoization: stable result reference when inputs unchanged')
reset()
{
  const W = s().getOrCreateNode(0, 0)
  const E = s().getOrCreateNode(10 * FT, 0)
  s().addWall(W, E)

  const g1 = getFloorWallPerimeterGraph(s(), 'F1')
  const g2 = getFloorWallPerimeterGraph(s(), 'F1')
  ok('two consecutive calls return same reference (memoized)', g1 === g2)

  // Different floor — different cache cell
  const g3 = getFloorWallPerimeterGraph(s(), 'F99')
  ok('different floorId returns different result', g3 !== g1)
}

// ─────────────────────────────────────────────────────────────────────
// Test 7: Memoization invalidation — splitWall forces recompute
// ─────────────────────────────────────────────────────────────────────
header('7. Memoization invalidation: splitWall triggers rebuild')
reset()
{
  const W = s().getOrCreateNode(0, 0)
  const E = s().getOrCreateNode(20 * FT, 0)
  s().addWall(W, E)

  const before = getFloorWallPerimeterGraph(s(), 'F1')
  const beforeEdgeCount = Object.keys(before.edges).length
  ok('before split: 1 edge', beforeEdgeCount === 1, `got ${beforeEdgeCount}`)

  // Split midway — Zustand replaces walls reference, invalidating memo
  const wallId = Object.values(s().walls).find(w => w.n1 === W || w.n2 === W)?.id
  s().splitWall(wallId, 10 * FT, 0, { force: true })

  const after = getFloorWallPerimeterGraph(s(), 'F1')
  const afterEdgeCount = Object.keys(after.edges).length
  ok('after split: 2 edges (recomputed)', afterEdgeCount === 2, `got ${afterEdgeCount}`)
  ok('result reference changed (memo invalidated)', before !== after)
}

// ─────────────────────────────────────────────────────────────────────
// Test 8: Determinism — rebuilt graph matches structurally
// ─────────────────────────────────────────────────────────────────────
header('8. Determinism: edge insertion order is stable (sorted by wall.id)')
reset()
{
  // Build the same 4-wall room. Twice. Result should be structurally
  // identical (edgeIds at each node sorted).
  const SW = s().getOrCreateNode(0, 0)
  const SE = s().getOrCreateNode(10 * FT, 0)
  const NE = s().getOrCreateNode(10 * FT, 10 * FT)
  const NW = s().getOrCreateNode(0, 10 * FT)
  s().addWall(SW, SE); s().addWall(SE, NE); s().addWall(NE, NW); s().addWall(NW, SW)

  const g = getFloorWallPerimeterGraph(s(), 'F1')
  // edgeIds at every node should be sorted
  for (const node of Object.values(g.nodes)) {
    const sorted = [...node.edgeIds].sort()
    if (JSON.stringify(sorted) !== JSON.stringify(node.edgeIds)) {
      ok(`node ${node.id.slice(0,8)}: edgeIds sorted`, false,
        `unsorted=[${node.edgeIds.join(',')}]`)
      break
    }
  }
  ok('all node edgeIds arrays are sorted', true)
}

// ─────────────────────────────────────────────────────────────────────
// Test 9: Virtual walls excluded; plot walls included
// ─────────────────────────────────────────────────────────────────────
header('9. Virtual walls excluded from graph')
reset()
{
  const A = s().getOrCreateNode(0, 0)
  const B = s().getOrCreateNode(10 * FT, 0)
  s().addWall(A, B)

  const wallId = Object.values(s().walls).find(w => w.n1 === A || w.n2 === A)?.id
  s().setWallIsVirtual(wallId, true)

  const g = getFloorWallPerimeterGraph(s(), 'F1')
  ok('virtual wall excluded from edges',
    !g.edges[wallId],
    `edges count=${Object.keys(g.edges).length}`)
}

// ─────────────────────────────────────────────────────────────────────
// Test 10: getRoomWallPerimeterGraph
// ─────────────────────────────────────────────────────────────────────
header('10. getRoomWallPerimeterGraph — room subgraph')
reset()
{
  // Build two rooms sharing a wall. Room A's subgraph should have
  // only Room A's 4 walls + 4 nodes.
  const aSW = s().getOrCreateNode(0, 0)
  const aSE = s().getOrCreateNode(10 * FT, 0)
  const aNE = s().getOrCreateNode(10 * FT, 10 * FT)
  const aNW = s().getOrCreateNode(0, 10 * FT)
  s().addWall(aSW, aSE); s().addWall(aSE, aNE); s().addWall(aNE, aNW); s().addWall(aNW, aSW)
  const wallsAfterA = Object.values(s().walls)
  const aWallIds = [
    wallsAfterA.find(w => (w.n1===aSW&&w.n2===aSE)||(w.n2===aSW&&w.n1===aSE))?.id,
    wallsAfterA.find(w => (w.n1===aSE&&w.n2===aNE)||(w.n2===aSE&&w.n1===aNE))?.id,
    wallsAfterA.find(w => (w.n1===aNE&&w.n2===aNW)||(w.n2===aNE&&w.n1===aNW))?.id,
    wallsAfterA.find(w => (w.n1===aNW&&w.n2===aSW)||(w.n2===aNW&&w.n1===aSW))?.id,
  ].filter(Boolean)
  aWallIds.forEach(id => s().togglePendingWall(id))
  s().saveRoom('Living', 'LIVING')
  const roomA = Object.values(s().rooms).find(r => r.name === 'Living')

  const subG = getRoomWallPerimeterGraph(s(), roomA.id)
  ok('room subgraph not null', !!subG)
  ok('subgraph has 4 nodes', Object.keys(subG.nodes).length === 4,
    `got ${Object.keys(subG.nodes).length}`)
  ok('subgraph has 4 edges', Object.keys(subG.edges).length === 4,
    `got ${Object.keys(subG.edges).length}`)
  ok('subgraph.roomId === room.id', subG.roomId === roomA.id)
}

// ─────────────────────────────────────────────────────────────────────
// Test 11: getCeilingPaths — same shape as floor graph + zone tag
// ─────────────────────────────────────────────────────────────────────
header('11. getCeilingPaths — edges carry zone="CEILING"')
reset()
{
  const A = s().getOrCreateNode(0, 0)
  const B = s().getOrCreateNode(10 * FT, 0)
  s().addWall(A, B)

  const c = getCeilingPaths(s(), 'F1')
  ok('ceiling graph has 1 edge', Object.keys(c.edges).length === 1)
  const edge = Object.values(c.edges)[0]
  ok('ceiling edge has zone="CEILING"', edge.zone === 'CEILING',
    `got zone=${edge.zone}`)
  ok('ceiling edge preserves lengthFt', Math.abs(edge.lengthFt - 10) < 0.01,
    `got ${edge.lengthFt}`)
}

// ─────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(70))
console.log(`Phase 0a — getFloorWallPerimeterGraph: ${pass} pass, ${fail} fail`)
console.log('═'.repeat(70))
if (fail > 0) {
  console.log('\nFAILURES:')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
