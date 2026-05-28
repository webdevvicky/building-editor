// Phase W — per-segment adjacency classification.
//
// In the T-junction model, a single parent wall may have segments with
// different external/partition status. Example (stacked rooms):
//   Room 3 has an 11ft top wall with a T-junction at offset 10ft.
//   Segment [0, 10ft] is referenced by Room 3 AND by Room 2 → PARTITION.
//   Segment [10ft, 11ft] is referenced only by Room 3 → EXTERNAL.
//
// Classification operates on EXPANDED graph edges (edgeKey), not on
// parent walls. A room "references" a segment iff the segment's
// (fromNodeId, toNodeId) appears as a consecutive pair in the room's
// nodeOrder (in either direction).
//
// BOQ aggregators that classify by adjacency (plaster Pass 2, slab-edge
// shuttering, parapet) switch to segment iteration after Phase W.
//
// PURITY
//   Pure & Node-testable. Memoized per (state.rooms, state.walls,
//   state.nodes) reference triple.

import { getFloorWallPerimeterGraph } from './adjacency.js'

// Per-floor cache of "edge → count of rooms whose nodeOrder includes it."
const _segmentCountsByFloor = new Map()

function _buildSegmentCountsForFloor(state, floorId) {
  const graph = getFloorWallPerimeterGraph(state, floorId)
  const counts = {}

  // Initialize counter for every expanded edge on this floor.
  for (const edgeKey of Object.keys(graph.edges)) {
    counts[edgeKey] = 0
  }

  // For each room on this floor, walk its nodeOrder and count
  // consecutive-pair memberships.
  for (const room of Object.values(state.rooms ?? {})) {
    if ((room.floorId ?? 'F1') !== floorId) continue
    const order = room.nodeOrder ?? []
    if (order.length < 3) continue
    for (let i = 0; i < order.length; i++) {
      const a = order[i]
      const b = order[(i + 1) % order.length]
      // Either direction of the edge counts.
      const edgeKey = graph.adjacency?.[a]?.[b]
      if (edgeKey && counts[edgeKey] != null) counts[edgeKey]++
    }
  }
  return counts
}

function _getSegmentCounts(state, floorId) {
  const cellKey = floorId
  const cell = _segmentCountsByFloor.get(cellKey)
  // Memo invalidates when any of (rooms, walls, nodes) reference changes.
  if (
    cell &&
    cell.rooms === state.rooms &&
    cell.walls === state.walls &&
    cell.nodes === state.nodes
  ) {
    return cell.counts
  }
  const counts = _buildSegmentCountsForFloor(state, floorId)
  _segmentCountsByFloor.set(cellKey, {
    rooms: state.rooms, walls: state.walls, nodes: state.nodes, counts,
  })
  return counts
}

/**
 * Classify a single expanded-graph segment as 'EXTERNAL' or 'PARTITION'.
 *
 * EXTERNAL: exactly one room's nodeOrder includes this edge (the
 *           opposite side faces outside the building).
 * PARTITION: two or more rooms reference it (shared boundary).
 *
 * Returns 'EXTERNAL' if the count is exactly 1.
 * Returns 'PARTITION' if the count is ≥ 2.
 * Returns 'UNREFERENCED' if no room references it (e.g., a wall not
 * yet bound to any room — typical during draw before saveRoom).
 */
export function classifySegment(state, floorId, edgeKey) {
  const fid = floorId ?? state.currentFloorId ?? 'F1'
  const counts = _getSegmentCounts(state, fid)
  const c = counts[edgeKey] ?? 0
  if (c === 0) return 'UNREFERENCED'
  if (c === 1) return 'EXTERNAL'
  return 'PARTITION'
}

/**
 * Iterate all segments on a floor with their classification. Useful
 * for plaster Pass 2 / slab-edge / parapet aggregators.
 *
 * Yields: { edgeKey, wallId, segmentIndex, fromNodeId, toNodeId,
 *           lengthIn, lengthFt, classification }
 */
export function* iterateSegmentsWithClassification(state, floorId) {
  const fid = floorId ?? state.currentFloorId ?? 'F1'
  const graph = getFloorWallPerimeterGraph(state, fid)
  const counts = _getSegmentCounts(state, fid)
  for (const edge of Object.values(graph.edges)) {
    const c = counts[edge.id] ?? 0
    const classification = c === 0 ? 'UNREFERENCED' : c === 1 ? 'EXTERNAL' : 'PARTITION'
    yield { ...edge, classification }
  }
}

// Test seam — verify scripts use this to reset between sections.
export function _resetSegmentClassifyCaches() {
  _segmentCountsByFloor.clear()
}
