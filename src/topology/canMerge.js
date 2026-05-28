// Phase W — Manual Join predicate.
//
// canMergeWalls(state, w1Id, w2Id) → { ok: boolean, reason?: string }
//
// Conservative gate: returns ok=true ONLY when every safety condition
// holds. False negatives are acceptable (the user can keep walls
// separate intentionally). False positives are FORBIDDEN — would merge
// user-intended distinct walls and silently lose intent.
//
// Used exclusively by the Manual Join tool. No automatic merge
// elsewhere in the codebase.
//
// PURITY
//   Pure & Node-testable. No React, no DOM, no Zustand dispatches.

import { SNAP_IN } from '../geometry.js'
import { getOrderedWallJunctions } from './junctions.js'

// Tolerance for collinearity check. Two walls are collinear if their
// direction unit vectors' cross product is below this epsilon.
const COLLINEAR_EPS = 1e-3

function _crossZ(ax, ay, bx, by) {
  return ax * by - ay * bx
}

// Find a node that's at one of w1's endpoints AND one of w2's endpoints.
// Returns the shared nodeId or null.
function _findSharedEndpoint(w1, w2) {
  if (w1.n1 === w2.n1 || w1.n1 === w2.n2) return w1.n1
  if (w1.n2 === w2.n1 || w1.n2 === w2.n2) return w1.n2
  return null
}

// Compute the degree of a node in the wall graph: how many walls
// reference it as n1 or n2. (Junctions on this node — i.e., the node
// appearing in some wall's junctions[] — are counted separately and not
// included here; INV-W2 forbids that scenario for CORNER nodes anyway.)
function _nodeDegreeFromWalls(state, nodeId, floorId) {
  let count = 0
  for (const w of Object.values(state.walls ?? {})) {
    if (w.isVirtual) continue
    if ((w.floorId ?? 'F1') !== floorId) continue
    if (w.n1 === nodeId || w.n2 === nodeId) count++
  }
  return count
}

/**
 * Returns true ONLY when every safety condition holds. Each returned
 * `reason` is suitable for UI display ("Cannot join — different
 * thicknesses (9in vs 6in)").
 */
export function canMergeWalls(state, w1Id, w2Id) {
  const w1 = state.walls?.[w1Id]
  const w2 = state.walls?.[w2Id]
  if (!w1 || !w2) return { ok: false, reason: 'wall-not-found' }
  if (w1Id === w2Id) return { ok: false, reason: 'same-wall' }

  // Same floor.
  if ((w1.floorId ?? 'F1') !== (w2.floorId ?? 'F1')) {
    return { ok: false, reason: 'different-floors' }
  }

  // Same isVirtual / isPlot.
  if ((w1.isVirtual ?? false) !== (w2.isVirtual ?? false)) {
    return { ok: false, reason: 'isVirtual-mismatch' }
  }
  if ((w1.isPlot ?? false) !== (w2.isPlot ?? false)) {
    return { ok: false, reason: 'isPlot-mismatch' }
  }

  // Must share exactly one endpoint.
  const sharedNodeId = _findSharedEndpoint(w1, w2)
  if (!sharedNodeId) return { ok: false, reason: 'no-shared-endpoint' }

  // The shared node must have degree 2 in the wall graph (only these
  // two walls meet there — no third wall makes it a real T-junction).
  const floorId = w1.floorId ?? 'F1'
  if (_nodeDegreeFromWalls(state, sharedNodeId, floorId) !== 2) {
    return { ok: false, reason: 'shared-node-has-third-wall' }
  }

  // The shared node must not appear in any OTHER wall's junctions[] —
  // a TJUNCTION attached to a third wall would be an unrelated topology
  // we don't want to silently absorb.
  for (const w of Object.values(state.walls ?? {})) {
    if (w.id === w1Id || w.id === w2Id) continue
    if ((w.junctions ?? []).includes(sharedNodeId)) {
      return { ok: false, reason: 'shared-node-is-tjunction-of-third-wall' }
    }
  }

  // Collinearity check via cross product of direction vectors.
  const n1a = state.nodes?.[w1.n1]
  const n1b = state.nodes?.[w1.n2]
  const n2a = state.nodes?.[w2.n1]
  const n2b = state.nodes?.[w2.n2]
  if (!n1a || !n1b || !n2a || !n2b) {
    return { ok: false, reason: 'missing-endpoint-node' }
  }
  const d1x = n1b.x - n1a.x, d1y = n1b.y - n1a.y
  const d2x = n2b.x - n2a.x, d2y = n2b.y - n2a.y
  const len1 = Math.hypot(d1x, d1y)
  const len2 = Math.hypot(d2x, d2y)
  if (len1 === 0 || len2 === 0) return { ok: false, reason: 'zero-length-wall' }
  const cross = Math.abs(_crossZ(d1x / len1, d1y / len1, d2x / len2, d2y / len2))
  if (cross > COLLINEAR_EPS) {
    return { ok: false, reason: 'not-collinear' }
  }

  // Property equality (material, height, thickness, classification, beams).
  if ((w1.materialKey ?? 'IS_MODULAR_BRICK') !== (w2.materialKey ?? 'IS_MODULAR_BRICK')) {
    return { ok: false, reason: 'material-mismatch' }
  }
  if (w1.height !== w2.height) return { ok: false, reason: 'height-mismatch' }
  if (w1.thickness !== w2.thickness) return { ok: false, reason: 'thickness-mismatch' }
  if ((w1.classification ?? null) !== (w2.classification ?? null)) {
    return { ok: false, reason: 'classification-mismatch' }
  }
  if ((w1.hasPlinthBeam ?? null) !== (w2.hasPlinthBeam ?? null)) {
    return { ok: false, reason: 'hasPlinthBeam-mismatch' }
  }
  if ((w1.hasLintelBeam ?? null) !== (w2.hasLintelBeam ?? null)) {
    return { ok: false, reason: 'hasLintelBeam-mismatch' }
  }
  if ((w1.hasRoofBeam ?? null) !== (w2.hasRoofBeam ?? null)) {
    return { ok: false, reason: 'hasRoofBeam-mismatch' }
  }

  // No opening within SNAP_IN of either wall's shared-endpoint side.
  // After merge, openings whose offsets are within SNAP_IN of the
  // boundary could straddle ambiguously.
  for (const [w, sharedIsN1] of [
    [w1, w1.n1 === sharedNodeId],
    [w2, w2.n1 === sharedNodeId],
  ]) {
    const wallLenIn = w === w1 ? len1 : len2
    for (const op of (w.openings ?? [])) {
      const opCenter = (op.offset ?? 0) + ((op.width ?? 0) / 2)
      // Distance from shared endpoint to opening center (in inches along the wall).
      const distFromShared = sharedIsN1 ? opCenter : (wallLenIn - opCenter)
      if (distFromShared < SNAP_IN) {
        return { ok: false, reason: 'opening-near-merge-point' }
      }
    }
  }

  return { ok: true, reason: null, sharedNodeId }
}
