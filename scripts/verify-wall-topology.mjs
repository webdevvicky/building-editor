// scripts/verify-wall-topology.mjs
//
// Phase W — Wall topology integrity.
//
// Stage 1/2 scope: Sections A, B, H.3, plus bootstrap purity grep.
// Later stages add Sections C (splitWall propagation), D (split
// refusal), E (Manual Join), F (deleteWall junctions), G (multi-floor
// isolation), I (Manual Join provenance), J (snap integration).
//
// Run via:
//   node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-wall-topology.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { useStore } from '../src/store.js'
import {
  getOrderedWallJunctions, findWallContainingEdge,
  findExpandedEdge, getFloorWallPerimeterGraph,
  recomputeRoomNodeOrder, computeNodeOrderForWallIds,
} from '../src/topology/index.js'
import {
  classifySegment, _resetSegmentClassifyCaches,
} from '../src/topology/segmentClassify.js'
import { _resetFaceCaches } from '../src/topology/faces.js'
import { verifyIntegrity } from '../src/schema/integrity.js'

const s = useStore.getState
const FT = 12

let pass = 0, fail = 0
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`) }
  else      { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}
function header(t) {
  console.log('\n' + '─'.repeat(70))
  console.log(t.toUpperCase())
  console.log('─'.repeat(70))
}
function reset() {
  _resetFaceCaches()
  _resetSegmentClassifyCaches()
  s().loadProject({
    nodes: {}, walls: {}, rooms: {}, stamps: {},
    columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {},
    projectSettings: undefined, unit: 'inch',
  })
  // Phase W canary assertions key off centerline wall coordinates at
  // the literal addRectangleRoom drag corners. Lock centerline so the
  // new 'inside_face' default (face-aware draw, 2026-05-28) doesn't
  // shift them; face-aware draw is covered by verify-draw-reference.
  s().setDrawReference('centerline')
}

// ── Helper: addWall by raw coords.
function addWallAt(ax, ay, bx, by) {
  const n1 = s().getOrCreateNode(ax, ay)
  const n2 = s().getOrCreateNode(bx, by)
  s().addWall(n1, n2)
  const w = Object.values(s().walls).find(
    x => (x.n1 === n1 && x.n2 === n2) || (x.n1 === n2 && x.n2 === n1)
  )
  return w?.id ?? null
}

// ── Bootstrap purity grep ───────────────────────────────────────────────

header('Bootstrap — module purity (Phase W topology helpers)')
{
  const __filename = fileURLToPath(import.meta.url)
  const repoRoot   = path.resolve(path.dirname(__filename), '..')
  const filesToScan = [
    'src/topology/junctions.js',
    'src/topology/canMerge.js',
    'src/topology/segmentClassify.js',
    'src/topology/nodeOrderRefresh.js',
  ]
  const forbiddenImports = [
    /from\s+['"]react['"]/,
    /from\s+['"]react-dom['"]/,
  ]
  const forbiddenRefs = [
    /\bwindow\b/,
    /\bdocument\b/,
  ]
  for (const rel of filesToScan) {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf-8')
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map(line => line.replace(/\/\/.*$/, ''))
      .join('\n')
    for (const re of forbiddenImports) {
      ok(`${rel} has no ${re}`, !re.test(stripped))
    }
    for (const re of forbiddenRefs) {
      ok(`${rel} has no ${re} reference`, !re.test(stripped))
    }
  }
}

// ════════════════════════════════════════════════════════════════════════
// SECTION A — T-junction creation primitives
// ════════════════════════════════════════════════════════════════════════

header('Section A — T-junction creation primitives')

// A.1: Insert a T-junction by clicking mid-span on a wall.
reset()
{
  // Draw a single 11ft horizontal wall from (0,0) to (132,0).
  const wId = addWallAt(0, 0, 11*FT, 0)
  ok('A.1a base wall created', !!wId)
  ok('A.1b base wall has empty junctions[]',
     (s().walls[wId].junctions ?? []).length === 0)
  ok('A.1c base wall has splitOrigin "NONE"',
     s().walls[wId].splitOrigin === 'NONE')

  const wallBefore = s().walls[wId]
  const ifcBefore = wallBefore.ifcGlobalId

  // Click mid-span at (60, 0) — should create a TJUNCTION.
  const newId = s().getOrCreateNode(60, 0)
  ok('A.1d getOrCreateNode returned a node id', typeof newId === 'string' && newId.length > 0)

  const newNode = s().nodes[newId]
  ok('A.1e new node has kind TJUNCTION', newNode.kind === 'TJUNCTION')
  ok('A.1f new node onWallId === wId', newNode.onWallId === wId)

  const wallAfter = s().walls[wId]
  ok('A.1g wall identity preserved (same id)', wallAfter.id === wId)
  ok('A.1h ifcGlobalId preserved', wallAfter.ifcGlobalId === ifcBefore)
  ok('A.1i wall n1/n2 unchanged', wallAfter.n1 === wallBefore.n1 && wallAfter.n2 === wallBefore.n2)
  ok('A.1j wall.junctions contains new node',
     (wallAfter.junctions ?? []).includes(newId))
  ok('A.1k wall.junctions has length 1', (wallAfter.junctions ?? []).length === 1)
  ok('A.1l wall.splitOrigin still "NONE"', wallAfter.splitOrigin === 'NONE')

  // Walls count: still 1 (no split happened).
  ok('A.1m walls count remains 1', Object.keys(s().walls).length === 1)
}

// A.2: Coalescence — clicking within SNAP_IN of existing T-junction reuses it.
reset()
{
  const wId = addWallAt(0, 0, 11*FT, 0)
  const j1Id = s().getOrCreateNode(60, 0)
  ok('A.2a junction created', !!j1Id)

  // Now click at (61, 0) — within SNAP_IN of j1.
  const j2Id = s().getOrCreateNode(61, 0)
  ok('A.2b nearby click reuses existing junction (no new node)',
     j2Id === j1Id)
  ok('A.2c walls junctions[] still has just one entry',
     (s().walls[wId].junctions ?? []).length === 1)
  ok('A.2d total TJUNCTION nodes is 1',
     Object.values(s().nodes).filter(n => n.kind === 'TJUNCTION').length === 1)
}

// A.3: Endpoint snap precedence — mid-span click within SNAP_IN of an
// endpoint snaps to the CORNER (no T-junction created).
reset()
{
  const wId = addWallAt(0, 0, 11*FT, 0)
  const wall = s().walls[wId]
  // Click 2in from n2 endpoint at (132, 0).
  const hit = s().getOrCreateNode(11*FT - 2, 0)
  ok('A.3a near-endpoint click returns the endpoint node id (CORNER snap)',
     hit === wall.n2)
  ok('A.3b no T-junction was created',
     Object.values(s().nodes).filter(n => n.kind === 'TJUNCTION').length === 0)
  ok('A.3c wall.junctions remains empty', (s().walls[wId].junctions ?? []).length === 0)
}

// A.4: Integrity passes after T-junction insertion (INV-W1, W2, W3, W10).
reset()
{
  const wId = addWallAt(0, 0, 11*FT, 0)
  s().getOrCreateNode(40, 0)
  s().getOrCreateNode(80, 0)
  s().getOrCreateNode(120, 0)
  const r = verifyIntegrity(s())
  ok('A.4 verifyIntegrity passes after 3 T-junctions added', r.valid,
     r.valid ? '' : `issues: ${r.issues.slice(0, 3).map(i => i.message).join('; ')}`)
}

// ════════════════════════════════════════════════════════════════════════
// SECTION B — Stacked rooms canary (10 walls, 9 nodes, 1 TJUNCTION,
// per-segment PARTITION vs EXTERNAL split)
// ════════════════════════════════════════════════════════════════════════

header('Section B — Stacked rooms canary')

reset()
{
  // Draw Room 1: 11×7 at bottom (corners (0,0), (132,0), (132,84), (0,84)).
  const r1 = s().addRectangleRoom(0, 0, 11*FT, 7*FT, { type: 'OTHER', name: 'Room 1' })
  ok('B.1a Room 1 created', !!r1?.roomId && !r1?.error, JSON.stringify(r1))

  // Draw Room 3: 11×3 stacked on Room 1 (corners (0,84), (132,84), (132,120), (0,120)).
  const r3 = s().addRectangleRoom(0, 7*FT, 11*FT, 10*FT, { type: 'OTHER', name: 'Room 3' })
  ok('B.1b Room 3 created', !!r3?.roomId && !r3?.error, JSON.stringify(r3))

  // Draw Room 2: 10×5 stacked on Room 3, NARROWER on right
  // (corners (0,120), (120,120), (120,180), (0,180)).
  const r2 = s().addRectangleRoom(0, 10*FT, 10*FT, 15*FT, { type: 'OTHER', name: 'Room 2' })
  ok('B.1c Room 2 created', !!r2?.roomId && !r2?.error, JSON.stringify(r2))

  // ── Canonical assertions ──────────────────────────────────────────────
  const wallCount = Object.keys(s().walls).length
  const nodeCount = Object.keys(s().nodes).length
  const tjunctions = Object.values(s().nodes).filter(n => n.kind === 'TJUNCTION')
  const corners = Object.values(s().nodes).filter(n => (n.kind ?? 'CORNER') === 'CORNER')

  ok(`B.2 walls count === 10 (NOT 11 — T-junction model)`,
     wallCount === 10, `got ${wallCount}`)
  ok(`B.3 nodes count === 9`, nodeCount === 9, `got ${nodeCount}`)
  ok(`B.4 TJUNCTION nodes count === 1`, tjunctions.length === 1, `got ${tjunctions.length}`)
  ok(`B.5 CORNER nodes count === 8`, corners.length === 8, `got ${corners.length}`)

  // Identify Room 3's top wall (the parent containing the T-junction).
  // It's the wall whose endpoints are at y=120 and that has junctions.length > 0.
  const room3TopWall = Object.values(s().walls).find(
    w => (w.junctions ?? []).length > 0
  )
  ok(`B.6 Found the parent wall with junctions`, !!room3TopWall)
  ok(`B.7 parent wall has exactly 1 junction`,
     (room3TopWall?.junctions ?? []).length === 1)

  // The T-junction is at (120, 120) — projected onto the wall centerline at y=120.
  const tjId = room3TopWall?.junctions?.[0]
  const tj = tjId ? s().nodes[tjId] : null
  ok(`B.8 T-junction node has kind TJUNCTION + onWallId === parent`,
     tj?.kind === 'TJUNCTION' && tj?.onWallId === room3TopWall.id)
  ok(`B.9 T-junction position is at (120, 120)`,
     tj && Math.abs(tj.x - 120) < 0.01 && Math.abs(tj.y - 120) < 0.01,
     tj ? `got (${tj.x}, ${tj.y})` : 'tj is null')

  // Both Room 3 and Room 2 should reference the parent wall.
  const room3 = s().rooms[r3.roomId]
  const room2 = s().rooms[r2.roomId]
  ok(`B.10 Room 3.wallIds includes parent wall`,
     room3?.wallIds?.includes(room3TopWall.id))
  ok(`B.11 Room 2.wallIds includes parent wall`,
     room2?.wallIds?.includes(room3TopWall.id))

  // Per-segment adjacency classification.
  const graph = getFloorWallPerimeterGraph(s(), 'F1')
  // The parent wall expands into 2 segments at the T-junction.
  const parentEdges = Object.values(graph.edges).filter(e => e.wallId === room3TopWall.id)
  ok(`B.12 parent wall expands into 2 segments`,
     parentEdges.length === 2, `got ${parentEdges.length}`)

  // Identify the segments by length. The [0, 10ft] segment is 120in.
  // The [10ft, 11ft] segment is 12in.
  const segments = parentEdges.sort((a, b) => b.lengthIn - a.lengthIn)
  const longSeg = segments[0]
  const shortSeg = segments[1]
  ok(`B.13 long segment length ~120in (10ft)`,
     Math.abs(longSeg.lengthIn - 120) < 0.5, `got ${longSeg.lengthIn}`)
  ok(`B.14 short segment length ~12in (1ft)`,
     Math.abs(shortSeg.lengthIn - 12) < 0.5, `got ${shortSeg.lengthIn}`)

  const longClassification = classifySegment(s(), 'F1', longSeg.id)
  const shortClassification = classifySegment(s(), 'F1', shortSeg.id)
  ok(`B.15 long segment (Room 3 + Room 2 both reference) is PARTITION`,
     longClassification === 'PARTITION', `got ${longClassification}`)
  ok(`B.16 short segment (Room 3 only) is EXTERNAL`,
     shortClassification === 'EXTERNAL', `got ${shortClassification}`)

  // verifyIntegrity passes.
  const integ = verifyIntegrity(s())
  ok(`B.17 verifyIntegrity passes on stacked-rooms state`,
     integ.valid,
     integ.valid ? '' : `${integ.count} issues; first: ${integ.issues[0]?.message ?? 'none'}`)
}

// ════════════════════════════════════════════════════════════════════════
// SECTION H — room.nodeOrder authority (decoupled from room.wallIds order)
// ════════════════════════════════════════════════════════════════════════

header('Section H — room.nodeOrder strictness')

// H.3: recomputeRoomNodeOrder does NOT depend on room.wallIds array order.
// Build a simple 4-wall room, rotate room.wallIds, recompute nodeOrder,
// assert the recomputed nodeOrder is identical to the original.
reset()
{
  const r = s().addRectangleRoom(0, 0, 10*FT, 10*FT, { type: 'OTHER' })
  ok(`H.3a room created`, !!r?.roomId && !r?.error)
  const room = s().rooms[r.roomId]
  const originalNodeOrder = [...(room.nodeOrder ?? [])]
  const originalWallIds = [...(room.wallIds ?? [])]
  ok(`H.3b nodeOrder is non-empty initially`,
     originalNodeOrder.length >= 3)

  // Rotate room.wallIds by 1 (move first entry to end).
  useStore.setState(state => {
    const r2 = state.rooms[r.roomId]
    return {
      rooms: {
        ...state.rooms,
        [r.roomId]: {
          ...r2,
          wallIds: [...r2.wallIds.slice(1), r2.wallIds[0]],
        },
      },
    }
  })

  // Recompute nodeOrder via the authoritative path.
  const recomputed = recomputeRoomNodeOrder(s(), r.roomId)
  ok(`H.3c recomputed nodeOrder length matches original`,
     recomputed.length === originalNodeOrder.length,
     `original.length=${originalNodeOrder.length} recomputed.length=${recomputed.length}`)
  ok(`H.3d recomputed nodeOrder IS IDENTICAL to original (wallIds rotation had no effect)`,
     JSON.stringify(recomputed) === JSON.stringify(originalNodeOrder),
     `original=${JSON.stringify(originalNodeOrder)} recomputed=${JSON.stringify(recomputed)}`)

  // Rotate by 2 — same expected outcome.
  useStore.setState(state => {
    const r2 = state.rooms[r.roomId]
    const w = r2.wallIds
    return {
      rooms: {
        ...state.rooms,
        [r.roomId]: {
          ...r2,
          wallIds: [...w.slice(2), ...w.slice(0, 2)],
        },
      },
    }
  })
  const recomputed2 = recomputeRoomNodeOrder(s(), r.roomId)
  ok(`H.3e recomputed nodeOrder identical after second rotation`,
     JSON.stringify(recomputed2) === JSON.stringify(originalNodeOrder))

  // Reverse the wallIds — same expected outcome.
  useStore.setState(state => {
    const r2 = state.rooms[r.roomId]
    return {
      rooms: {
        ...state.rooms,
        [r.roomId]: {
          ...r2,
          wallIds: [...r2.wallIds].reverse(),
        },
      },
    }
  })
  const recomputed3 = recomputeRoomNodeOrder(s(), r.roomId)
  ok(`H.3f recomputed nodeOrder identical after wallIds reversal`,
     JSON.stringify(recomputed3) === JSON.stringify(originalNodeOrder))
}

// ════════════════════════════════════════════════════════════════════════
// SECTION C — Explicit splitWall propagation
// ════════════════════════════════════════════════════════════════════════

header('Section C — splitWall full propagation')

// C.1: Split a wall with openings → openings partition by offset.
reset()
{
  // 120in wall from (0,0) to (120,0). Add openings at offset=10in width=20in
  // and offset=80in width=20in.
  const wId = addWallAt(0, 0, 120, 0)
  s().addOpening(wId, { offset: 10, width: 20, height: 84, type: 'door', orient: 0 })
  s().addOpening(wId, { offset: 80, width: 20, height: 60, type: 'window', orient: 0 })
  ok('C.1a base wall has 2 openings', s().walls[wId].openings.length === 2)

  // Split at offset 60in (world x=60).
  const splitResult = s().splitWall(wId, 60, 0)
  ok('C.1b splitWall succeeded', !splitResult?.error,
     `result=${JSON.stringify(splitResult)}`)
  const { w1Id, w2Id } = splitResult
  ok('C.1c original wall removed', !s().walls[wId])
  ok('C.1d w1 has the first opening (offset 10)',
     s().walls[w1Id].openings.length === 1
     && s().walls[w1Id].openings[0].offset === 10)
  ok('C.1e w2 has the second opening rebased (offset 80-60=20)',
     s().walls[w2Id].openings.length === 1
     && s().walls[w2Id].openings[0].offset === 20,
     `w2 openings: ${JSON.stringify(s().walls[w2Id].openings)}`)
  ok('C.1f both sub-walls carry splitOrigin USER_SPLIT',
     s().walls[w1Id].splitOrigin === 'USER_SPLIT'
     && s().walls[w2Id].splitOrigin === 'USER_SPLIT')
  ok('C.1g fresh ifcGlobalIds (not identical, not the original)',
     s().walls[w1Id].ifcGlobalId !== s().walls[w2Id].ifcGlobalId)
}

// C.2: Split a wall with MEP fixtures → wallT rebased.
reset()
{
  const wId = addWallAt(0, 0, 100, 0)
  // Manually inject a plumbing fixture at wallT=0.3 referencing the wall.
  // (Production MEP code is more involved; here we test propagation only.)
  useStore.setState(state => ({
    plumbingFixtures: {
      f1: { id: 'f1', wallId: wId, wallT: 0.3, x: 30, y: 0, type: 'BASIN', floorId: 'F1' },
      f2: { id: 'f2', wallId: wId, wallT: 0.8, x: 80, y: 0, type: 'WC',    floorId: 'F1' },
    },
  }))
  ok('C.2a fixtures injected', Object.keys(s().plumbingFixtures).length === 2)

  // Split at offset 50in (world x=50, splitT=0.5).
  const splitResult = s().splitWall(wId, 50, 0)
  ok('C.2b splitWall succeeded', !splitResult?.error,
     JSON.stringify(splitResult))
  const { w1Id, w2Id } = splitResult

  // f1 was at wallT=0.3 < 0.5 → goes to w1 with new wallT = 0.3/0.5 = 0.6
  const f1 = s().plumbingFixtures.f1
  ok('C.2c f1 moved to w1', f1.wallId === w1Id)
  ok('C.2d f1 wallT rebased to 0.6',
     Math.abs(f1.wallT - 0.6) < 1e-6, `got ${f1.wallT}`)

  // f2 was at wallT=0.8 > 0.5 → goes to w2 with new wallT = (0.8-0.5)/(1-0.5) = 0.6
  const f2 = s().plumbingFixtures.f2
  ok('C.2e f2 moved to w2', f2.wallId === w2Id)
  ok('C.2f f2 wallT rebased to 0.6',
     Math.abs(f2.wallT - 0.6) < 1e-6, `got ${f2.wallT}`)
}

// C.3: Split a wall with junctions → junctions partition.
reset()
{
  const wId = addWallAt(0, 0, 132, 0)   // 11ft wall
  s().getOrCreateNode(36, 0)   // junction at t≈0.27
  s().getOrCreateNode(96, 0)   // junction at t≈0.73
  ok('C.3a wall has 2 junctions',
     (s().walls[wId].junctions ?? []).length === 2)

  // Split at offset 60 (t=60/132≈0.45). First junction goes to w1, second to w2.
  const splitResult = s().splitWall(wId, 60, 0)
  ok('C.3b splitWall succeeded', !splitResult?.error,
     JSON.stringify(splitResult))
  const { w1Id, w2Id } = splitResult

  ok('C.3c w1 inherits 1 junction',
     (s().walls[w1Id].junctions ?? []).length === 1)
  ok('C.3d w2 inherits 1 junction',
     (s().walls[w2Id].junctions ?? []).length === 1)

  // Each junction's onWallId rebased.
  const w1JunctionId = s().walls[w1Id].junctions[0]
  const w2JunctionId = s().walls[w2Id].junctions[0]
  ok('C.3e w1 junction onWallId === w1Id',
     s().nodes[w1JunctionId].onWallId === w1Id)
  ok('C.3f w2 junction onWallId === w2Id',
     s().nodes[w2JunctionId].onWallId === w2Id)
}

// ════════════════════════════════════════════════════════════════════════
// SECTION D — splitWall refusal cases
// ════════════════════════════════════════════════════════════════════════

header('Section D — splitWall refusal cases')

// D.1: Split too close to endpoint.
reset()
{
  const wId = addWallAt(0, 0, 100, 0)
  const result = s().splitWall(wId, 1, 0)   // 1in from n1
  ok('D.1 split too close to endpoint refused',
     result?.error === 'split-too-close-to-endpoint',
     `result=${JSON.stringify(result)}`)
  ok('D.1b wall unchanged', !!s().walls[wId])
}

// D.2: Opening straddles split.
reset()
{
  const wId = addWallAt(0, 0, 100, 0)
  // Opening from offset 40 to 70.
  s().addOpening(wId, { offset: 40, width: 30, height: 84, type: 'door', orient: 0 })
  const result = s().splitWall(wId, 55, 0)   // 55 is mid-opening
  ok('D.2 opening-straddle refusal',
     result?.error === 'opening-straddles-split',
     `result=${JSON.stringify(result)}`)
  ok('D.2b wall unchanged', !!s().walls[wId])
  ok('D.2c opening preserved', s().walls[wId].openings.length === 1)
}

// D.3: Junction near split offset.
reset()
{
  const wId = addWallAt(0, 0, 100, 0)
  s().getOrCreateNode(50, 0)   // junction at offset 50
  // Try to split at offset 52 (within SNAP_IN=4in of junction).
  const result = s().splitWall(wId, 52, 0)
  ok('D.3 junction-near-split refusal',
     result?.error === 'junction-near-split',
     `result=${JSON.stringify(result)}`)
  ok('D.3b wall unchanged', !!s().walls[wId])
}

// ════════════════════════════════════════════════════════════════════════
// SECTION E — Manual Join tool (joinWalls + canMergeWalls)
// ════════════════════════════════════════════════════════════════════════

header('Section E — Manual Join tool')

// E.1: Round-trip — split then join restores a single wall.
reset()
{
  const wId = addWallAt(0, 0, 100, 0)
  const originalIfc = s().walls[wId].ifcGlobalId
  const splitResult = s().splitWall(wId, 50, 0)
  ok('E.1a split succeeded', !splitResult?.error)
  ok('E.1b two walls exist after split', Object.keys(s().walls).length === 2)
  const { w1Id, w2Id } = splitResult
  ok('E.1c both pieces have splitOrigin=USER_SPLIT',
     s().walls[w1Id].splitOrigin === 'USER_SPLIT'
     && s().walls[w2Id].splitOrigin === 'USER_SPLIT')

  const joinResult = s().joinWalls(w1Id, w2Id)
  ok('E.1d join succeeded', !joinResult?.error, JSON.stringify(joinResult))
  ok('E.1e wasSplit hint is true (both were USER_SPLIT)',
     joinResult.wasSplit === true)
  ok('E.1f exactly 1 wall remains after join',
     Object.keys(s().walls).length === 1)
  ok('E.1g surviving wall has splitOrigin=NONE',
     s().walls[joinResult.survivorId].splitOrigin === 'NONE')
  // The surviving wall's id is the lex-smaller of w1Id, w2Id.
  ok('E.1h surviving id is lex-smaller of split pair',
     joinResult.survivorId === (w1Id < w2Id ? w1Id : w2Id))
}

// E.2: Refusal — different materials.
reset()
{
  const w1 = addWallAt(0, 0, 50, 0)
  const w2 = addWallAt(50, 0, 100, 0)
  // Manually change w2's material.
  useStore.setState(state => ({
    walls: { ...state.walls, [w2]: { ...state.walls[w2], materialKey: 'AAC_BLOCK' } },
  }))
  const result = s().joinWalls(w1, w2)
  ok('E.2 material mismatch refusal',
     result?.error === 'material-mismatch',
     JSON.stringify(result))
  ok('E.2b walls unchanged', Object.keys(s().walls).length === 2)
}

// E.3: Refusal — non-collinear walls at shared corner.
reset()
{
  const w1 = addWallAt(0, 0, 100, 0)
  const w2 = addWallAt(100, 0, 100, 50)   // perpendicular at shared corner
  const result = s().joinWalls(w1, w2)
  ok('E.3 non-collinear refusal',
     result?.error === 'not-collinear',
     JSON.stringify(result))
}

// E.4: Refusal — opening near the merge point.
reset()
{
  const wId = addWallAt(0, 0, 100, 0)
  // Opening near offset 48 (just within SNAP_IN of the split point at 50).
  s().addOpening(wId, { offset: 48, width: 4, height: 84, type: 'door', orient: 0 })
  // Try to split — should refuse first because the opening straddles
  // the chosen split. Use a different position to perform the split
  // then attempt join.
  reset()
  const w1 = addWallAt(0, 0, 50, 0)
  const w2 = addWallAt(50, 0, 100, 0)
  // Put an opening on w1 such that its right edge is within SNAP_IN of
  // the shared endpoint (offset 47 width 5 → right edge at offset 52,
  // but wall is only 50in long → this is invalid; use offset 47 width 2).
  s().addOpening(w1, { offset: 47, width: 2, height: 84, type: 'door', orient: 0 })
  const result = s().joinWalls(w1, w2)
  ok('E.4 opening-near-merge refusal',
     result?.error === 'opening-near-merge-point',
     JSON.stringify(result))
}

// E.5: Round-trip preserves total wall length + opening count.
reset()
{
  const wId = addWallAt(0, 0, 120, 0)
  s().addOpening(wId, { offset: 20, width: 10, height: 84, type: 'door', orient: 0 })
  s().addOpening(wId, { offset: 80, width: 10, height: 60, type: 'window', orient: 0 })
  // Split mid-wall.
  const splitResult = s().splitWall(wId, 60, 0)
  ok('E.5a split succeeded', !splitResult?.error)
  const totalOpeningsAfterSplit =
    s().walls[splitResult.w1Id].openings.length
    + s().walls[splitResult.w2Id].openings.length
  ok('E.5b 2 openings preserved across split (1+1)',
     totalOpeningsAfterSplit === 2)

  const joinResult = s().joinWalls(splitResult.w1Id, splitResult.w2Id)
  ok('E.5c join succeeded', !joinResult?.error)
  const survivor = s().walls[joinResult.survivorId]
  ok('E.5d 2 openings restored after join',
     survivor.openings.length === 2, `got ${survivor.openings.length}`)
  // Check offsets — should be original (20 and 80) ± rounding.
  const offsets = survivor.openings.map(o => o.offset).sort((a, b) => a - b)
  ok('E.5e openings re-rebased to original offsets',
     Math.abs(offsets[0] - 20) < 0.01 && Math.abs(offsets[1] - 80) < 0.01,
     `got [${offsets.join(', ')}]`)
}

// ════════════════════════════════════════════════════════════════════════
// SECTION F — deleteWall junction handling
// ════════════════════════════════════════════════════════════════════════

header('Section F — deleteWall junction handling')

// F.1: Delete wall with a junction that's referenced ONLY by this wall.
// Junction node is removed entirely (no other references).
reset()
{
  const wId = addWallAt(0, 0, 100, 0)
  const jId = s().getOrCreateNode(50, 0)
  ok('F.1a junction created on wall', s().nodes[jId].kind === 'TJUNCTION')
  ok('F.1b wall has 1 junction', s().walls[wId].junctions.length === 1)

  s().deleteWall(wId)
  ok('F.1c wall deleted', !s().walls[wId])
  ok('F.1d orphan junction node removed', !s().nodes[jId])
}

// F.2: Delete wall with a junction that's ALSO the endpoint of another wall.
// Junction converts to CORNER; the other wall keeps the node.
reset()
{
  const wA = addWallAt(0, 0, 100, 0)
  const jId = s().getOrCreateNode(50, 0)   // T-junction on wA
  const wB = addWallAt(50, 0, 50, 50)       // perpendicular wall ending at j

  ok('F.2a wB created with jId as endpoint',
     s().walls[wB].n1 === jId || s().walls[wB].n2 === jId)
  ok('F.2b j is TJUNCTION before delete', s().nodes[jId].kind === 'TJUNCTION')

  s().deleteWall(wA)
  ok('F.2c wA deleted', !s().walls[wA])
  ok('F.2d j still exists (referenced by wB)', !!s().nodes[jId])
  ok('F.2e j converted to CORNER', s().nodes[jId].kind === 'CORNER')
  ok('F.2f j onWallId cleared', s().nodes[jId].onWallId == null)
}

// F.4: Stale ownership corruption refusal.
// Synthetic: two walls each claim the same node id in junctions[].
reset()
{
  const wA = addWallAt(0, 0, 100, 0)
  const wB = addWallAt(0, 50, 100, 50)
  const jId = s().getOrCreateNode(50, 0)   // legit junction on wA

  // Synthetic corruption: also add jId to wB's junctions[].
  useStore.setState(state => ({
    walls: { ...state.walls, [wB]: { ...state.walls[wB], junctions: [jId] } },
  }))

  const result = s().deleteWall(wA)
  ok('F.4a deleteWall refused with stale-ownership error',
     result?.error === 'junction-stale-ownership',
     JSON.stringify(result))
  ok('F.4b wA still exists (refused)', !!s().walls[wA])
  ok('F.4c validationEvents has the corruption notice',
     (s().validationEvents ?? []).some(e => e.ruleId === 'wall_junction_stale_ownership'))

  // Symmetric: deleteWall(wB) also surfaces it.
  const result2 = s().deleteWall(wB)
  ok('F.4d deleteWall(wB) also refuses',
     result2?.error === 'junction-stale-ownership')
}

// ════════════════════════════════════════════════════════════════════════
// SECTION G — Multi-floor isolation
// ════════════════════════════════════════════════════════════════════════

header('Section G — Multi-floor isolation')

// G.1: T-junctions on F1 don't appear in F2's expanded graph.
reset()
{
  // F1 wall + T-junction.
  const wF1 = addWallAt(0, 0, 100, 0)
  s().getOrCreateNode(50, 0)
  ok('G.1a F1 has 1 wall + 1 T-junction',
     Object.keys(s().walls).length === 1
     && Object.values(s().nodes).filter(n => n.kind === 'TJUNCTION').length === 1)

  // Add floor F2 and switch.
  s().setProjectSettings({
    floors: [
      ...s().projectSettings.floors,
      { id: 'F2', label: 'Floor 2', sequence: 1, plinthHeightFt: 1.5, floorHeightFt: 10, meta: null, underlay: null },
    ],
  })
  useStore.setState({ currentFloorId: 'F2' })
  ok('G.1b switched to F2', s().currentFloorId === 'F2')

  // Draw an F2 wall at the same coords as F1's wall.
  const wF2 = addWallAt(0, 0, 100, 0)
  ok('G.1c F2 wall created (distinct from F1)', wF2 !== wF1)
  ok('G.1d F2 wall has no junctions',
     (s().walls[wF2].junctions ?? []).length === 0)

  // F1's wall still has its T-junction.
  ok('G.1e F1 wall still has 1 junction',
     (s().walls[wF1].junctions ?? []).length === 1)

  // Expanded graphs are floor-scoped.
  const f1Graph = getFloorWallPerimeterGraph(s(), 'F1')
  const f2Graph = getFloorWallPerimeterGraph(s(), 'F2')
  ok('G.1f F1 graph sees the T-junction (2 segments for wall)',
     Object.values(f1Graph.edges).filter(e => e.wallId === wF1).length === 2)
  ok('G.1g F2 graph has 1 wall, 1 segment (no T-junctions)',
     Object.values(f2Graph.edges).filter(e => e.wallId === wF2).length === 1)
  ok('G.1h F2 graph does NOT contain F1 walls',
     Object.values(f2Graph.edges).every(e => e.wallId !== wF1))
}

// ── Section I — deleteWall room cascade (Bug B) ────────────────────────

header('Section I — deleteWall room cascade (Bug B fix)')

// I.1 — Build a closed 4-wall room, delete a boundary wall, assert
// the room is purged + validationEvent emitted + integrity valid +
// undo restores both atomically.
{
  reset()
  addWallAt(0,     0,      10*FT, 0)
  addWallAt(10*FT, 0,      10*FT, 10*FT)
  addWallAt(10*FT, 10*FT,  0,     10*FT)
  addWallAt(0,     10*FT,  0,     0)

  // Detect + create the face.
  const faces = (await import('../src/topology/faces.js')).enumerateFloorFaces(s(), 'F1')
  ok('I.1a 4-wall closed loop detects 1 face', faces.length === 1)
  s().createRoomFromFace(faces[0], { type: 'TOILET' })
  ok('I.1b Room created', Object.keys(s().rooms).length === 1)
  const roomIdBefore = Object.keys(s().rooms)[0]
  const wallsBefore  = { ...s().walls }
  const wallCountBefore = Object.keys(wallsBefore).length
  ok('I.1c verifyIntegrity valid before delete', verifyIntegrity(s()).valid)

  // Pick the top wall to delete (y=0 → y=0; both endpoints at y=0).
  const topWall = Object.values(s().walls).find(w => {
    const a = s().nodes[w.n1], b = s().nodes[w.n2]
    return a.y === 0 && b.y === 0
  })
  ok('I.1d found top wall to delete', !!topWall)

  const delResult = s().deleteWall(topWall.id)
  ok('I.1e deleteWall ok=true', delResult?.ok === true)
  ok('I.1f deleteWall purged exactly 1 room',
     delResult?.purgedRoomIds?.length === 1,
     `purged=${JSON.stringify(delResult?.purgedRoomIds)}`)
  ok('I.1g purgedRoomIds[0] matches the room id',
     delResult?.purgedRoomIds?.[0] === roomIdBefore)
  ok('I.1h wall removed from state.walls',
     !s().walls[topWall.id] && Object.keys(s().walls).length === wallCountBefore - 1)
  ok('I.1i room removed from state.rooms',
     Object.keys(s().rooms).length === 0)
  ok('I.1j verifyIntegrity remains valid after purge',
     verifyIntegrity(s()).valid)

  // validationEvent surfaced.
  const events = s().validationEvents ?? []
  const purgeEvent = events.find(e => e.ruleId === 'room_orphaned_by_wall_delete' && e.entityId === roomIdBefore)
  ok('I.1k validationEvent room_orphaned_by_wall_delete emitted', !!purgeEvent)
  ok('I.1l validationEvent severity=warning, category=topology',
     purgeEvent?.severity === 'warning' && purgeEvent?.category === 'topology')
  ok('I.1m validationEvent.meta.deletedWallId references the deleted wall',
     purgeEvent?.meta?.deletedWallId === topWall.id)

  // Undo atomicity: one snapshot restores both wall and room.
  s().undo()
  ok('I.1n undo restores the wall',
     !!s().walls[topWall.id] && Object.keys(s().walls).length === wallCountBefore)
  ok('I.1o undo restores the room',
     !!s().rooms[roomIdBefore] && Object.keys(s().rooms).length === 1)
  ok('I.1p verifyIntegrity valid after undo', verifyIntegrity(s()).valid)
}

// ── Section J — Shared-wall multi-room delete (Bug B edge case) ────────

header('Section J — Shared-wall multi-room delete (Bug B edge case)')

// J.1 — Two adjacent rooms share ONE wall. Delete a wall that's only in
// ROOM A → only Room A should purge; Room B survives with its closure
// intact. This is the no-over-purge edge case.
{
  reset()
  // Room A: 0..10 horizontal, 0..10 vertical (left half)
  // Room B: 10..20 horizontal, 0..10 vertical (right half)
  // Shared wall: x=10, y=0..10
  //
  // Walls:
  //   leftA:    (0,0)   → (0,10)
  //   topA:     (0,10)  → (10,10)
  //   shared:   (10,0)  → (10,10)
  //   bottomA:  (0,0)   → (10,0)
  //   topB:     (10,10) → (20,10)
  //   rightB:   (20,0)  → (20,10)
  //   bottomB:  (10,0)  → (20,0)
  addWallAt(0,    0,    0,    10*FT)
  addWallAt(0,    10*FT, 10*FT, 10*FT)
  const sharedW = addWallAt(10*FT, 0, 10*FT, 10*FT)
  addWallAt(0,    0,    10*FT, 0)
  addWallAt(10*FT, 10*FT, 20*FT, 10*FT)
  addWallAt(20*FT, 0,    20*FT, 10*FT)
  addWallAt(10*FT, 0,    20*FT, 0)

  _resetFaceCaches()
  const faces = (await import('../src/topology/faces.js')).enumerateFloorFaces(s(), 'F1')
  ok('J.1a two adjacent rooms detect 2 faces', faces.length === 2)

  // Sort faces by centroid.x so we deterministically create A (left) then B (right).
  const ordered = [...faces].sort((a, b) => a.centroid.x - b.centroid.x)
  s().createRoomFromFace(ordered[0], { type: 'BEDROOM' })
  s().createRoomFromFace(ordered[1], { type: 'BEDROOM' })
  ok('J.1b two rooms created', Object.keys(s().rooms).length === 2)
  ok('J.1c verifyIntegrity valid', verifyIntegrity(s()).valid)

  const roomA = Object.values(s().rooms).find(r => !r.wallIds.some(wid => {
    const n1 = s().nodes[s().walls[wid].n1]
    const n2 = s().nodes[s().walls[wid].n2]
    return n1.x === 20*FT || n2.x === 20*FT
  }))
  const roomB = Object.values(s().rooms).find(r => r.id !== roomA.id)
  ok('J.1d identified room A (left) and room B (right)', !!roomA && !!roomB)
  const roomBwallIdsBefore = [...roomB.wallIds].sort()

  // Find the LEFT wall (in roomA only, NOT in shared).
  const leftA = Object.values(s().walls).find(w => {
    const a = s().nodes[w.n1], b = s().nodes[w.n2]
    return a.x === 0 && b.x === 0
  })
  ok('J.1e located leftA wall', !!leftA)
  ok('J.1f leftA is in roomA.wallIds, NOT in roomB.wallIds',
     roomA.wallIds.includes(leftA.id) && !roomB.wallIds.includes(leftA.id))

  const r1 = s().deleteWall(leftA.id)
  ok('J.1g deleteWall(leftA) reports exactly 1 purged room',
     r1?.purgedRoomIds?.length === 1)
  ok('J.1h purgedRoomIds is roomA, not roomB',
     r1?.purgedRoomIds?.[0] === roomA.id)
  ok('J.1i state.rooms still contains roomB (NOT over-purged)',
     !!s().rooms[roomB.id])
  ok('J.1j state.rooms does NOT contain roomA',
     !s().rooms[roomA.id])
  // Room B's wallIds remain intact (leftA was never a member of B).
  const roomBwallIdsAfter = [...(s().rooms[roomB.id].wallIds ?? [])].sort()
  ok('J.1k roomB.wallIds unchanged (leftA was not a member)',
     JSON.stringify(roomBwallIdsBefore) === JSON.stringify(roomBwallIdsAfter),
     `before=${JSON.stringify(roomBwallIdsBefore)} after=${JSON.stringify(roomBwallIdsAfter)}`)
  ok('J.1l roomB still structurally valid',
     (await import('../src/topology/rooms.js')).isRoomStructurallyValid(s(), roomB.id))
  ok('J.1m verifyIntegrity valid (only invalid rooms purged)',
     verifyIntegrity(s()).valid)
}

// J.2 — Delete the SHARED wall. Both rooms lose closure → both purge.
{
  reset()
  addWallAt(0,    0,    0,    10*FT)
  addWallAt(0,    10*FT, 10*FT, 10*FT)
  const sharedW = addWallAt(10*FT, 0, 10*FT, 10*FT)
  addWallAt(0,    0,    10*FT, 0)
  addWallAt(10*FT, 10*FT, 20*FT, 10*FT)
  addWallAt(20*FT, 0,    20*FT, 10*FT)
  addWallAt(10*FT, 0,    20*FT, 0)

  _resetFaceCaches()
  const faces = (await import('../src/topology/faces.js')).enumerateFloorFaces(s(), 'F1')
  const ordered = [...faces].sort((a, b) => a.centroid.x - b.centroid.x)
  s().createRoomFromFace(ordered[0], { type: 'BEDROOM' })
  s().createRoomFromFace(ordered[1], { type: 'BEDROOM' })
  ok('J.2a two rooms created', Object.keys(s().rooms).length === 2)

  const r2 = s().deleteWall(sharedW)
  ok('J.2b deleteWall(shared) reports 2 purged rooms',
     r2?.purgedRoomIds?.length === 2,
     `purged=${JSON.stringify(r2?.purgedRoomIds)}`)
  ok('J.2c state.rooms is empty (both lost closure)',
     Object.keys(s().rooms).length === 0)
  ok('J.2d verifyIntegrity valid after dual purge',
     verifyIntegrity(s()).valid)

  // Undo restores everything.
  s().undo()
  ok('J.2e undo restores both rooms',
     Object.keys(s().rooms).length === 2)
  ok('J.2f undo restores the shared wall',
     !!s().walls[sharedW])
  ok('J.2g verifyIntegrity valid after undo',
     verifyIntegrity(s()).valid)
}

// ── Summary ────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(70))
console.log(`PASS: ${pass}  FAIL: ${fail}`)
console.log('═'.repeat(70))
if (fail > 0) {
  console.error(`✗ verify-wall-topology FAILED: ${fail} assertions`)
  process.exit(1)
} else {
  console.log(`✓ verify-wall-topology passed (${pass} assertions)`)
}
