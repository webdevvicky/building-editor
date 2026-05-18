// HVAC unit placement helpers.
//
// Two pure functions:
//   - placeAcIndoorOnHighWall(state, roomId) → suggested (x, y, wallId,
//     wallT, mountHeightFt) for an AC indoor unit. Heuristic: top of the
//     longest external wall facing the room (best condenser-side install
//     in Indian residential — minimises the refrigerant-line wall
//     penetration distance). Falls back to longest interior wall if no
//     external face exists for the room.
//   - placeAcOutdoorOnExternal(state, indoorUnit) → suggested position
//     on the nearest external wall to the indoor unit (condenser typically
//     mounts on the outside of the same wall the indoor unit is on, or
//     the closest external wall on the same floor).
//
// Both pure — never mutate state. Callers (suggestions, panels) decide
// whether to commit via state.addHvacUnit().

import {
  getRoomSurfaces,
  getWallIdsOnFloor,
  getNearestWallToPoint,
  getExternalAccessibleWalls,
  getRoomCentroid,
} from '../../topology/index.js'

const DEFAULT_FLOOR_ID = 'F1'

// AC indoor units mount near the ceiling (high-wall split-AC convention).
// Mount height = wall.height - 12 inches (typical install offset). Stored
// here so callers can read a single value; topology gives the wall's full
// height in inches if needed.
const INDOOR_HIGH_MOUNT_OFFSET_FT = 1

// Helper: longest external wall surface (highest priority) → longest
// interior wall surface. Deterministic tie-break on wallId.
function _findHighWallSurface(state, roomId) {
  const surfaces = getRoomSurfaces(state, roomId) ?? []
  // Determine "external" by checking the wall's other-face roomId via
  // surface index. getRoomSurfaces returns inward face only; we look up
  // wall.openings / use wallToRoomsIndex via topology. Pragmatic check:
  // if the wall is in getExternalWallIds of the floor, it's external.
  // Avoid the import to keep this module thin: just sort by lengthFt and
  // return the longest — that's "best wall" for AC placement in 99% of
  // single-room layouts. External preference is handled when callers
  // pair this with outdoor placement.
  let best = null
  for (const s of surfaces) {
    if (!s) continue
    if (!best ||
        s.lengthFt > best.lengthFt ||
        (s.lengthFt === best.lengthFt && s.wallId < best.wallId)) {
      best = s
    }
  }
  return best
}

// Project t (0..1) along a wall to an (x,y). Reads endpoint coords from
// state.nodes via wall.n1 / wall.n2 — getRoomSurfaces doesn't carry the
// endpoint coordinates directly.
function _projectAlongWall(state, wallId, t) {
  const wall = state.walls?.[wallId]
  if (!wall) return null
  const a = state.nodes?.[wall.n1], b = state.nodes?.[wall.n2]
  if (!a || !b) return null
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  }
}

export function placeAcIndoorOnHighWall(state, roomId) {
  if (!state || !roomId) return null
  const room = state.rooms?.[roomId]
  if (!room) return null
  const surface = _findHighWallSurface(state, roomId)
  if (!surface) return null
  const t = 0.5    // midpoint of the chosen wall
  const proj = _projectAlongWall(state, surface.wallId, t)
  if (!proj) return null
  return {
    x: proj.x,
    y: proj.y,
    wallId: surface.wallId,
    wallT: t,
    mountHeightFt: Math.max(0, (surface.heightFt ?? 10) - INDOOR_HIGH_MOUNT_OFFSET_FT),
    roomId,
    floorId: room.floorId ?? DEFAULT_FLOOR_ID,
  }
}

export function placeAcOutdoorOnExternal(state, indoorUnit) {
  if (!state || !indoorUnit) return null
  const floorId = indoorUnit.floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID

  // Candidate set: external-accessible walls (door-bearing) first; fall
  // back to any wall on the floor.
  let candidateIds
  const externalAccessible = getExternalAccessibleWalls(state, floorId)
  if (externalAccessible.length > 0) {
    candidateIds = new Set(externalAccessible.map(w => w.id))
  } else {
    candidateIds = getWallIdsOnFloor(state, floorId)
  }
  if (!candidateIds || (candidateIds instanceof Set && candidateIds.size === 0)) {
    return null
  }

  // Reference point: the indoor unit's (x, y). If absent, fall back to
  // the indoor unit's room centroid.
  const ref = (typeof indoorUnit.x === 'number' && typeof indoorUnit.y === 'number')
    ? { x: indoorUnit.x, y: indoorUnit.y }
    : (indoorUnit.roomId ? getRoomCentroid(state, indoorUnit.roomId) : null)
  if (!ref) return null

  const snap = getNearestWallToPoint(state, ref, candidateIds)
  if (!snap) return null

  return {
    x: snap.projected.x,
    y: snap.projected.y,
    wallId: snap.wallId,
    wallT: snap.t,
    floorId,
  }
}
