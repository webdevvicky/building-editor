// Phase W — T-junction helpers.
//
// A T-junction node sits on the centerline of a parent wall mid-span and
// does NOT terminate it. The parent wall's `n1` and `n2` remain its only
// true termini (INV-W1, INV-W2). A T-junction node has:
//   - kind === 'TJUNCTION'
//   - onWallId === <parent wall's id>
//   - position (x, y) within SNAP_IN perpendicular of the wall's segment
//
// `wall.junctions` stores UNORDERED node id membership. Geometric order
// along the wall is computed dynamically via getOrderedWallJunctions —
// storing sorted order is a cache-invalidation trap (any future
// endpoint-drag operation would require resort everywhere).
//
// INV-W10: Two junctions on the same wall must be ≥ SNAP_IN apart along
// the wall (no zero-length segments). The existing-junction snap in
// getOrCreateNode enforces this at creation time; verifyIntegrity asserts
// it at the schema-validation boundary.
//
// PURITY
//   Pure & Node-testable. No React, no DOM, no Zustand dispatches.

import { SNAP_IN } from '../geometry.js'

const DEFAULT_FLOOR_ID = 'F1'

// Project a point P onto the line through A→B. Returns the parametric
// position t ∈ [0, 1] (clamped) and the projected coordinates.
//
// Used as the canonical projection primitive for:
//   - getOrderedWallJunctions (each junction's t along its parent wall)
//   - createTjunction (positions the new node exactly on the wall centerline)
function _projectPointOntoSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { t: 0, x: ax, y: ay, distanceIn: Math.hypot(px - ax, py - ay) }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const x = ax + t * dx
  const y = ay + t * dy
  return { t, x, y, distanceIn: Math.hypot(px - x, py - y) }
}

// Return the wall's length in inches (n1 → n2 Euclidean).
function _wallLengthIn(state, wallId) {
  const w = state.walls?.[wallId]
  if (!w) return 0
  const a = state.nodes?.[w.n1]
  const b = state.nodes?.[w.n2]
  if (!a || !b) return 0
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/**
 * Return the T-junctions on a wall, ordered by parametric position t
 * (from n1 toward n2). Each entry: { nodeId, t, x, y }.
 *
 * Empty array if the wall has no junctions or doesn't exist.
 * Stable across runs: junctions with equal t (impossible in valid state
 * per INV-W10, but defensive) tiebreak on nodeId lex-asc.
 */
export function getOrderedWallJunctions(state, wallId) {
  const wall = state.walls?.[wallId]
  if (!wall) return []
  const junctionIds = wall.junctions ?? []
  if (junctionIds.length === 0) return []
  const a = state.nodes?.[wall.n1]
  const b = state.nodes?.[wall.n2]
  if (!a || !b) return []

  const out = []
  for (const jId of junctionIds) {
    const j = state.nodes?.[jId]
    if (!j) continue
    const proj = _projectPointOntoSegment(j.x, j.y, a.x, a.y, b.x, b.y)
    out.push({ nodeId: jId, t: proj.t, x: proj.x, y: proj.y })
  }
  out.sort((p, q) => {
    if (p.t !== q.t) return p.t - q.t
    return p.nodeId < q.nodeId ? -1 : p.nodeId > q.nodeId ? 1 : 0
  })
  return out
}

/**
 * Probe: is the geometric point (px, py) on the centerline of wallId
 * within SNAP_IN perpendicular tolerance, AND beyond SNAP_IN of both
 * endpoints (so a CORNER snap would not coalesce)?
 *
 * Returns { onCenterline: true, t, x, y } if eligible for T-junction
 * insertion; { onCenterline: false } otherwise.
 *
 * Used by getOrCreateNode's mid-span branch.
 */
export function probeWallForMidSpan(state, wallId, px, py) {
  const wall = state.walls?.[wallId]
  if (!wall || wall.isVirtual || wall.isPlot) return { onCenterline: false }
  const a = state.nodes?.[wall.n1]
  const b = state.nodes?.[wall.n2]
  if (!a || !b) return { onCenterline: false }

  const proj = _projectPointOntoSegment(px, py, a.x, a.y, b.x, b.y)
  if (proj.distanceIn > SNAP_IN) return { onCenterline: false }

  const lenIn = Math.hypot(b.x - a.x, b.y - a.y)
  if (lenIn < SNAP_IN * 2) return { onCenterline: false }

  // Must be beyond SNAP_IN from BOTH endpoints (otherwise Phase A
  // CORNER snap would have caught it before this code path runs).
  const fromN1In = proj.t * lenIn
  const fromN2In = (1 - proj.t) * lenIn
  if (fromN1In < SNAP_IN || fromN2In < SNAP_IN) return { onCenterline: false }

  return { onCenterline: true, t: proj.t, x: proj.x, y: proj.y }
}

/**
 * Locate the nearest existing T-junction within `radiusIn` of (px, py)
 * on the current floor.
 *
 * Returns { nodeId, x, y, distanceIn } or null. The matching node is
 * always kind === 'TJUNCTION' (CORNER nodes are looked up by NODE snap
 * target, not WALL_JUNCTION).
 */
export function findNearestTjunction(state, px, py, radiusIn) {
  const fid = state.currentFloorId ?? DEFAULT_FLOOR_ID
  let best = null
  for (const node of Object.values(state.nodes ?? {})) {
    if ((node.kind ?? 'CORNER') !== 'TJUNCTION') continue
    if (!Array.isArray(node.floorIds) || !node.floorIds.includes(fid)) continue
    const d = Math.hypot(node.x - px, node.y - py)
    if (d > radiusIn) continue
    if (!best || d < best.distanceIn) {
      best = { nodeId: node.id, x: node.x, y: node.y, distanceIn: d }
    }
  }
  return best
}

// Distance along wall (in inches) between two parametric positions.
// Used by the SNAP_IN spacing guard for new junction insertion.
export function junctionSpacingIn(state, wallId, t1, t2) {
  return Math.abs(t1 - t2) * _wallLengthIn(state, wallId)
}

// Probe: would inserting a new junction at parametric t violate INV-W10
// (within SNAP_IN of an existing junction or an endpoint)?
//
// Returns the existing junction node id to coalesce to, or null if no
// violation (safe to insert).
export function findCoalescingJunction(state, wallId, t) {
  const ordered = getOrderedWallJunctions(state, wallId)
  const lenIn = _wallLengthIn(state, wallId)
  for (const j of ordered) {
    if (Math.abs(j.t - t) * lenIn < SNAP_IN) return j.nodeId
  }
  return null
}
