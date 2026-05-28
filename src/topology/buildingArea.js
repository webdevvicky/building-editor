// Topology — building-level area metrics for BOQ.
//
// Two numbers Indian residential BOQ needs alongside the centerline
// floor-area number that's been mislabeled "built-up" since Phase 1:
//
//   - CARPET AREA — strict inside-wall-face floor area, summed over
//     every structurally valid Room entity. Uses the existing inset
//     kernel via getRoomGeometry(state, id, 'clear_internal').area
//     so we automatically inherit miter-cap handling, virtual-wall
//     zero-thickness, collapse detection, and dimensionMode discipline.
//
//   - BUILT-UP (PLINTH) AREA — outer-face footprint of the building.
//     Computed by:
//       1. Identifying every EXTERNAL expanded-graph edge on the floor
//          via classifySegment(..., { mode: 'topological' }). Virtual
//          walls participate so open-verandah edges are included
//          alongside physical externals.
//       2. Walking those edges into closed loops via the standard
//          rotational-system "next-CCW edge" trick — same pattern
//          enumerateFloorFaces uses in faces.js. The walker selects
//          the next edge at every node by smallest left turn,
//          restricted to the external sub-graph, so corner choice at
//          any node degree (T-junctions on external walls, corner-
//          to-corner attachments, multi-block junctions) resolves
//          correctly. NO degree-2 assumption.
//       3. Orienting each walk so the BUILDING (the room referencing
//          the edge) is on the LEFT — equivalent to picking the
//          direction the room's canonical CCW nodeOrder traverses
//          the edge in. This makes outer perimeters walk CCW
//          (positive signed area = additive footprint) and courtyard
//          perimeters walk CW (negative signed area = subtractive
//          hole), and two disconnected buildings both walk CCW
//          (additive). Aggregation is signed-area sum, never largest-
//          loop-as-outer.
//       4. Offsetting each loop OUTWARD by per-edge halfThickness
//          via _offsetClosedPolygon (the same kernel the room inset
//          uses, called with direction:'outward'). Virtual edges have
//          halfThickness 0 — built-up follows the virtual line itself.
//       5. Shoelacing the offset polygons and summing signed areas.
//
// Untraced enclosed spaces (corridors, ducts, shafts without a Room
// entity) are naturally INSIDE the outer-boundary loop, so built-up
// includes them by construction — the loop is defined by the building
// outline, not by which interior spaces happen to be modeled as rooms.
//
// Incomplete external boundary (degree-1 dead-end on a stub wall, or
// any walk that fails to close) → recorded in `warnings`, the loop
// is dropped from the sum, and `complete: false` is returned. The
// BOQ surface appends an "(incomplete)" hint rather than silently
// reporting a wrong number.
//
// PURITY
//   Pure & Node-testable. No React, no DOM, no Zustand dispatches.
//   verify-building-area.mjs bootstrap grep-checks for forbidden
//   imports just like the snap module + faces module.

import { GRID_IN, DEFAULT_WALL_THICK_IN } from '../geometry.js'
import { safeR2 as r2 } from '../lib/numbers.js'
import { getFloorWallPerimeterGraph } from './adjacency.js'
import { classifySegment } from './segmentClassify.js'
import {
  _offsetClosedPolygon,
  polygonSignedAreaIn2,
  getRoomGeometry,
  getValidRoomIds,
} from './rooms.js'

const DEFAULT_FLOOR_ID = 'F1'

// ── Per-floor memoization ──────────────────────────────────────────────
//
// Two separate Maps — one for built-up, one for carpet — each keyed on
// floorId. Cells invalidate when (state.rooms, state.walls, state.nodes,
// state.projectSettings) reference triple changes (Zustand mutates all
// of these as a group on any meaningful edit).

const _builtUpCells = new Map()
const _carpetCells  = new Map()

function _cellValid(cell, state) {
  return cell
    && cell.rooms          === state.rooms
    && cell.walls          === state.walls
    && cell.nodes          === state.nodes
    && cell.projectSettings === state.projectSettings
}

function _setCell(cells, key, state, result) {
  cells.set(key, {
    rooms:           state.rooms,
    walls:           state.walls,
    nodes:           state.nodes,
    projectSettings: state.projectSettings,
    result,
  })
  return result
}

// ── Loop discovery — angular-continuation rotational system ────────────

/**
 * Identify the closed external-boundary loops on a floor.
 *
 * Returns:
 *   {
 *     loops:    [{ edges: [{ edgeKey, fromNodeId, toNodeId, wallId }] }],
 *     complete: boolean,
 *     warnings: [{ code, ... }],
 *   }
 *
 * Each loop's edges are in walk order with directions oriented so the
 * building interior is on the LEFT of every directed edge. Outer
 * perimeters end up CCW (positive signed area when shoelaced),
 * courtyard perimeters end up CW (negative signed area). Caller
 * shoelaces the polygons and signed-area-sums the loops — outer +
 * courtyard (negative) naturally subtracts the hole.
 */
export function findExternalBoundaryLoops(state, floorId) {
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  const graph = getFloorWallPerimeterGraph(state, fid, { mode: 'topological' })

  // Step 1 — identify EXTERNAL edges + their building-side direction.
  //
  // For each room on this floor with a valid CCW nodeOrder, walk the
  // consecutive pairs. Each pair (a, b) corresponds to one expanded
  // graph edge. If that edge is classified EXTERNAL (count = 1, i.e.
  // exactly one room references it), record:
  //   edgeKey → { roomId, dirA: a, dirB: b }
  // Walking a→b puts the room interior on the left. That IS the
  // building-on-left direction for the boundary walk.
  const externalEdgesByKey = new Map()
  for (const room of Object.values(state.rooms ?? {})) {
    if ((room.floorId ?? DEFAULT_FLOOR_ID) !== fid) continue
    const order = room.nodeOrder ?? []
    if (order.length < 3) continue
    for (let i = 0; i < order.length; i++) {
      const a = order[i]
      const b = order[(i + 1) % order.length]
      const edgeKey = graph.adjacency?.[a]?.[b]
      if (!edgeKey) continue
      if (classifySegment(state, fid, edgeKey, { mode: 'topological' }) !== 'EXTERNAL') continue
      // First-room-wins: if multiple rooms (shouldn't happen for
      // EXTERNAL — classify says count=1) record the first deterministic.
      if (!externalEdgesByKey.has(edgeKey)) {
        externalEdgesByKey.set(edgeKey, { roomId: room.id, dirA: a, dirB: b })
      }
    }
  }

  if (externalEdgesByKey.size === 0) {
    return { loops: [], complete: true, warnings: [] }
  }

  // Step 2 — build per-node sorted-by-angle list of external incident
  // neighbors. SAME PATTERN as faces.js::_enumerateUncached (Phase R1).
  // The angular ordering lets the next-CCW rule pick the correct next
  // edge at any node degree.
  const sortedNeighbors = {}
  for (const nid of Object.keys(graph.nodes)) {
    const node = graph.nodes[nid]
    const entries = []
    for (const [otherNid, edgeKey] of Object.entries(graph.adjacency[nid] ?? {})) {
      if (!externalEdgesByKey.has(edgeKey)) continue
      const other = graph.nodes[otherNid]
      if (!other) continue
      entries.push({
        neighborId: otherNid,
        edgeKey,
        angle: Math.atan2(other.y - node.y, other.x - node.x),
      })
    }
    entries.sort((a, b) => {
      if (a.angle !== b.angle) return a.angle - b.angle
      return a.neighborId < b.neighborId ? -1 : a.neighborId > b.neighborId ? 1 : 0
    })
    sortedNeighbors[nid] = entries
  }

  // At node b, after walking (a→b), return the next edge selected by
  // the next-CCW rule restricted to external edges. This is the
  // standard combinatorial-embedding boundary-tracing rule.
  function nextEdge(a, b) {
    const list = sortedNeighbors[b]
    if (!list || list.length === 0) return null
    const idx = list.findIndex(e => e.neighborId === a)
    if (idx === -1) return null
    const prevIdx = (idx - 1 + list.length) % list.length
    const e = list[prevIdx]
    return { fromNodeId: b, toNodeId: e.neighborId, edgeKey: e.edgeKey }
  }

  // Step 3 — walk closed loops. Start each walk only from a directed
  // edge whose orientation puts building-on-left (the recorded
  // dirA→dirB). visited tracks directed edge keys.
  const visited = new Set()
  const loops = []
  const warnings = []

  const safetyBound = Math.max(64, externalEdgesByKey.size * 4 + 16)
  const startKeys = [...externalEdgesByKey.keys()].sort()

  for (const startEdgeKey of startKeys) {
    const refInfo = externalEdgesByKey.get(startEdgeKey)
    const startA = refInfo.dirA
    const startB = refInfo.dirB
    const startDirKey = `${startA}→${startB}`
    if (visited.has(startDirKey)) continue

    const loopEdges = []
    let cur = { fromNodeId: startA, toNodeId: startB, edgeKey: startEdgeKey }
    let iter = 0
    let closed = false

    while (iter++ < safetyBound) {
      const dirKey = `${cur.fromNodeId}→${cur.toNodeId}`
      if (visited.has(dirKey) && dirKey !== startDirKey) {
        // Walked into territory already covered by a previous loop.
        // Discard this walk — every loop must be reachable from its
        // own start without revisiting.
        loopEdges.length = 0
        break
      }
      visited.add(dirKey)
      loopEdges.push({
        edgeKey:    cur.edgeKey,
        fromNodeId: cur.fromNodeId,
        toNodeId:   cur.toNodeId,
        wallId:     graph.edges[cur.edgeKey]?.wallId ?? null,
      })

      const nxt = nextEdge(cur.fromNodeId, cur.toNodeId)
      if (!nxt) {
        // Degree-1 dead-end in the external sub-graph. The boundary
        // chain is open here — record warning, drop this walk.
        warnings.push({
          code:       'EXTERNAL_LOOP_DEAD_END',
          atNodeId:   cur.toNodeId,
          fromEdgeId: cur.edgeKey,
        })
        loopEdges.length = 0
        break
      }
      if (nxt.fromNodeId === startA && nxt.toNodeId === startB) {
        closed = true
        break
      }
      cur = nxt
    }

    if (!closed) continue
    loops.push({ edges: loopEdges })
  }

  return {
    loops,
    complete: warnings.length === 0,
    warnings,
  }
}

// ── Built-up area ──────────────────────────────────────────────────────

function _resolveHalfThicknessIn(wall) {
  if (!wall) return 0
  if (wall.isVirtual) return 0
  if (wall.isPlot)    return 0
  return (wall.thickness ?? DEFAULT_WALL_THICK_IN) / 2
}

function _computeBuiltUpUncached(state, floorId) {
  const { loops, complete, warnings } = findExternalBoundaryLoops(state, floorId)
  if (loops.length === 0) {
    return { areaSft: 0, complete, warnings, loopCount: 0 }
  }

  let totalAreaIn2 = 0
  for (const loop of loops) {
    // Centerline polygon for this loop (vertices at each fromNodeId).
    const pts = loop.edges.map(e => {
      const n = state.nodes[e.fromNodeId]
      return { x: n.x, y: n.y }
    })
    // Per-edge halfThickness. Virtual / plot edges contribute 0 so
    // built-up follows the virtual line itself at open-verandah edges.
    const halfPerEdge = loop.edges.map(e => _resolveHalfThicknessIn(state.walls[e.wallId]))

    const { newVerts } = _offsetClosedPolygon(pts, halfPerEdge, { direction: 'outward' })

    // Signed area aggregation:
    //   outer loops walked CCW → positive → outer footprint
    //   courtyard loops walked CW → negative → subtracts the hole
    //   two disconnected blocks both CCW → both positive → additive
    // Sign drives the math; loop size does not.
    totalAreaIn2 += polygonSignedAreaIn2(newVerts)
  }

  // Sanity: net area should be positive for any meaningful building.
  // If the loop walker emitted only courtyard loops without their
  // outer perimeter (a structurally impossible-but-not-prevented
  // condition), totalAreaIn2 could be negative. Clamp to 0 and warn.
  if (totalAreaIn2 < 0) {
    warnings.push({
      code:           'BUILT_UP_NEGATIVE_NET_AREA',
      totalAreaIn2:   r2(totalAreaIn2),
      message:        'Net signed area is negative — outer perimeter loop may be missing.',
    })
    return {
      areaSft:   0,
      complete:  false,
      warnings,
      loopCount: loops.length,
    }
  }

  return {
    areaSft:   r2(totalAreaIn2 / (GRID_IN * GRID_IN)),
    complete,
    warnings,
    loopCount: loops.length,
  }
}

export function computeBuiltUpAreaSft(state, floorId) {
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  const cell = _builtUpCells.get(fid)
  if (_cellValid(cell, state)) return cell.result
  const result = _computeBuiltUpUncached(state, fid)
  return _setCell(_builtUpCells, fid, state, result)
}

// ── Carpet area ────────────────────────────────────────────────────────

function _computeCarpetUncached(state, floorId) {
  let total = 0
  for (const roomId of getValidRoomIds(state)) {
    const room = state.rooms[roomId]
    if (!room) continue
    if (floorId && (room.floorId ?? DEFAULT_FLOOR_ID) !== floorId) continue
    // Always uses 'clear_internal' regardless of projectSettings.dimensionMode
    // — carpet is an absolute architectural quantity, not a display preference.
    const geom = getRoomGeometry(state, roomId, 'clear_internal')
    if (!geom || geom.collapsed) continue
    total += geom.area
  }
  return { areaSft: r2(total) }
}

export function computeCarpetAreaSft(state, floorId) {
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  const cell = _carpetCells.get(fid)
  if (_cellValid(cell, state)) return cell.result
  const result = _computeCarpetUncached(state, fid)
  return _setCell(_carpetCells, fid, state, result)
}

// Test seam — verify scripts use this to reset between sections.
export function _resetBuildingAreaCaches() {
  _builtUpCells.clear()
  _carpetCells.clear()
}
