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
//
// Two separate maps per mode — same pattern as adjacency.js Bug-A fix.
// Physical and topological callers must not poison each other's cells.
// Plaster Pass 2 (physical-only, default) and built-up loop tracing
// (topological, needs virtual walls visible) interleave in the same
// session; without per-mode isolation, whichever runs first wins.
const _segmentCountsPhysical    = new Map()
const _segmentCountsTopological = new Map()

function _cellsForMode(mode) {
  return mode === 'topological' ? _segmentCountsTopological : _segmentCountsPhysical
}

function _buildSegmentCountsForFloor(state, floorId, mode) {
  const graph = getFloorWallPerimeterGraph(state, floorId, { mode })
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

function _getSegmentCounts(state, floorId, mode) {
  const cells = _cellsForMode(mode)
  const cell = cells.get(floorId)
  // Memo invalidates when any of (rooms, walls, nodes) reference changes.
  if (
    cell &&
    cell.rooms === state.rooms &&
    cell.walls === state.walls &&
    cell.nodes === state.nodes
  ) {
    return cell.counts
  }
  const counts = _buildSegmentCountsForFloor(state, floorId, mode)
  cells.set(floorId, {
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
 *
 * Mode (built-up support, 2026-05-28):
 *   'physical'    — graph excludes virtual walls (default). Plaster
 *                   Pass 2 and any other consumer that classifies by
 *                   physical adjacency.
 *   'topological' — graph includes virtual walls. Built-up boundary
 *                   tracing uses this so a virtual edge bounding an
 *                   open verandah is reported alongside physical
 *                   externals.
 */
export function classifySegment(state, floorId, edgeKey, opts = {}) {
  const mode = opts.mode ?? 'physical'
  if (mode !== 'physical' && mode !== 'topological') {
    throw new Error(`classifySegment: invalid mode "${mode}"`)
  }
  const fid = floorId ?? state.currentFloorId ?? 'F1'
  const counts = _getSegmentCounts(state, fid, mode)
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
export function* iterateSegmentsWithClassification(state, floorId, opts = {}) {
  const mode = opts.mode ?? 'physical'
  if (mode !== 'physical' && mode !== 'topological') {
    throw new Error(`iterateSegmentsWithClassification: invalid mode "${mode}"`)
  }
  const fid = floorId ?? state.currentFloorId ?? 'F1'
  const graph = getFloorWallPerimeterGraph(state, fid, { mode })
  const counts = _getSegmentCounts(state, fid, mode)
  for (const edge of Object.values(graph.edges)) {
    const c = counts[edge.id] ?? 0
    const classification = c === 0 ? 'UNREFERENCED' : c === 1 ? 'EXTERNAL' : 'PARTITION'
    yield { ...edge, classification }
  }
}

// Test seam — verify scripts use this to reset between sections.
export function _resetSegmentClassifyCaches() {
  _segmentCountsPhysical.clear()
  _segmentCountsTopological.clear()
}
