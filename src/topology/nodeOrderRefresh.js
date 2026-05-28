// Phase W — authoritative source for room.nodeOrder.
//
// recomputeRoomNodeOrder(state, roomId) returns a fresh closed-polygon
// node sequence by walking the EXPANDED wall graph (junctions included).
// The result is canonicalized identically to Phase R1's face shape:
//   - Rotated so the lexicographically-smallest nodeId is at index 0.
//   - CCW winding (positive signed area in world coords).
//
// STRICTNESS CONTRACT
//   - Derives ordering from expanded graph traversal ONLY.
//   - Uses geometric winding consistency (CCW) for direction.
//   - Canonicalizes start node + direction deterministically.
//   - NEVER infers ordering from room.wallIds. room.wallIds is semantic
//     membership only — order in the array is meaningless and may be
//     rotated by future operations.
//   - Re-walks the wall graph from scratch on every invocation; does
//     not consult stale room.nodeOrder.
//
// Why: room.wallIds is exposed to consumers as an unordered set;
// future operations (Manual Join, future endpoint drag) may rotate or
// reorder the array. Inferring ordering from wallIds would couple
// refresh logic to an undocumented array-position contract and break
// silently when consumers reorder.
//
// PURITY
//   Pure & Node-testable. No React, no DOM, no Zustand.

import { getFloorWallPerimeterGraph } from './adjacency.js'
import { enumerateFloorFaces } from './faces.js'

const DEFAULT_FLOOR_ID = 'F1'

function _signedAreaFt2(polygon) {
  let a = 0
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length
    a += polygon[i].x * polygon[j].y - polygon[j].x * polygon[i].y
  }
  return a / 2 / 144
}

/**
 * Compute the canonical closed-polygon nodeOrder for an arbitrary set
 * of parent wallIds on a given floor.
 *
 * Used by:
 *   - recomputeRoomNodeOrder (delegates here)
 *   - saveRoom (computes nodeOrder for the candidate room BEFORE it
 *     is committed; no roomId exists yet)
 *
 * Algorithm: see recomputeRoomNodeOrder header. Pure function over
 * (state, wallIds, floorId) — does not consult any room.* state.
 */
export function computeNodeOrderForWallIds(state, wallIds, floorId) {
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  const wallIdSet = new Set(wallIds ?? [])
  if (wallIdSet.size < 3) return []

  // Phase W — face enumeration is the authoritative graph traversal.
  // A room's polygon corresponds to exactly one of the floor's
  // enumerated faces — the one whose parent wallIds (canonical set)
  // matches the room's wallIds. Multiple segments of the same parent
  // wall map to the same wallId in the face's canonical set, so the
  // match is robust even when a room touches a parent wall via one
  // T-junctioned segment while the rest of that wall belongs to a
  // different face.
  const faces = enumerateFloorFaces(state, fid)
  for (const face of faces) {
    const faceWallSet = new Set(face.wallIds)
    if (faceWallSet.size !== wallIdSet.size) continue
    let allMatch = true
    for (const wId of faceWallSet) {
      if (!wallIdSet.has(wId)) { allMatch = false; break }
    }
    if (!allMatch) continue
    // Match found — face.nodeOrder is already canonicalized
    // (rotate-smallest-first, CCW). Return a fresh array.
    return [...face.nodeOrder]
  }

  // No matching face — room is malformed (open chain or wallIds
  // doesn't correspond to a single closed face). Return empty.
  return []
}

/**
 * Compute the canonical closed-polygon nodeOrder for a room.
 *
 * Algorithm:
 *  1. Resolve the room's floor + its parent wallIds (semantic membership).
 *  2. Restrict the expanded graph's adjacency to edges whose parent
 *     wallId is in the room's wallIds.
 *  3. From the lex-smallest nodeId in the restricted subgraph, BFS-walk
 *     for a closed cycle (every node has degree 2 in the restricted
 *     adjacency for a well-formed room).
 *  4. Canonicalize: rotate to lex-smallest first; force CCW winding.
 *
 * Returns string[] (the closed sequence) or [] if the room is malformed
 * (open chain, missing nodes, degenerate area, etc.).
 *
 * NEVER infers ordering from room.wallIds; delegates to
 * computeNodeOrderForWallIds which uses the expanded graph only.
 *
 * EMPTY-RETURN CONTRACT (Bug B, 2026-05-28)
 *   When closure fails this function returns the empty array `[]`.
 *   Consumers MUST interpret an empty result as "this room no longer
 *   has a closed polygon" and act on it explicitly:
 *
 *     - `deleteWall` is the SOLE site that converts an empty result
 *       into a destructive purge (auto-removes the room from
 *       `state.rooms`, emits a `room_orphaned_by_wall_delete`
 *       validationEvent, and reports the purge to the UI caller for
 *       the persistent-toast hint).
 *
 *     - Every OTHER consumer (saveRoom, splitWall, joinWalls, future
 *       endpoint-drag etc.) MUST NOT silently store `[]` and leave
 *       the room visible — that produces ghost rooms that render at
 *       garbage centroids and break `isRoomStructurallyValid` /
 *       `verifyIntegrity` downstream. Either:
 *         (a) refuse the operation that would orphan the room, OR
 *         (b) plumb the orphan back to a caller that performs the
 *             explicit purge.
 *
 *   This contract makes `[]` the universal "I cannot recover ordering"
 *   sentinel without forcing this helper to know about purge policy.
 */
export function recomputeRoomNodeOrder(state, roomId) {
  const room = state.rooms?.[roomId]
  if (!room) return []
  return computeNodeOrderForWallIds(state, room.wallIds ?? [], room.floorId)
}

/**
 * Convenience: refresh nodeOrder for a single room and produce the
 * new state.rooms[roomId] object.
 */
export function refreshRoomNodeOrderInState(state, roomId) {
  const room = state.rooms?.[roomId]
  if (!room) return null
  const newOrder = recomputeRoomNodeOrder(state, roomId)
  return { ...room, nodeOrder: newOrder }
}
