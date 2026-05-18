// Distribution-board placement heuristic.
//
// Phase 1: pure function — does NOT mutate the store. Returns a suggested
// (x, y, wallId, wallT) the caller can pass to addElectricalPoint when
// they want to materialize an auto-placed DB.
//
// Heuristic:
//   1. Compute centroid of all floor-scoped electrical points (real ones
//      — not DBs themselves).
//   2. Prefer an external wall that bears a door (service-entry rule —
//      meter + DB must be reachable from outside).
//   3. Snap the centroid onto the nearest matching wall.
//
// If no points exist OR no walls match, return null.

import {
  getExternalAccessibleWalls,
  getNearestWallToPoint,
  getWallIdsOnFloor,
} from '../../topology/index.js'

const DEFAULT_FLOOR_ID = 'F1'

export function placeDefaultDb(state, floorId) {
  if (!state) return null
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID

  // Real electrical points on this floor (exclude DB / SUB_DB / METER —
  // the placement heuristic looks at *load* points, not infrastructure).
  const loadPoints = Object.values(state.electricalPoints ?? {})
    .filter(p => p
      && (p.floorId ?? DEFAULT_FLOOR_ID) === fid
      && p.type !== 'DB'
      && p.type !== 'SUB_DB'
      && p.type !== 'ENERGY_METER')

  if (loadPoints.length === 0) return null

  // Centroid (mean of x, y — deterministic).
  let cx = 0, cy = 0
  for (const p of loadPoints) { cx += p.x; cy += p.y }
  cx /= loadPoints.length
  cy /= loadPoints.length

  // Prefer external-with-door walls; fall back to any floor wall.
  const externalAccessible = getExternalAccessibleWalls(state, fid)
  let candidateIds
  if (externalAccessible.length > 0) {
    candidateIds = new Set(externalAccessible.map(w => w.id))
  } else {
    candidateIds = getWallIdsOnFloor(state, fid)
    if (!candidateIds || (candidateIds instanceof Set && candidateIds.size === 0)) {
      return null
    }
  }

  const snap = getNearestWallToPoint(state, { x: cx, y: cy }, candidateIds)
  if (!snap) return null

  return {
    x: snap.projected.x,
    y: snap.projected.y,
    wallId: snap.wallId,
    wallT: snap.t,
    floorId: fid,
  }
}
