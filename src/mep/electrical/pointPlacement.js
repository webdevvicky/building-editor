// Electrical point placement helper — snap a free (x,y) to the nearest
// wall on the point's floor, resolve the containing room, and return the
// catalog mount height for the type.
//
// Pure read of state; no mutation. Used by:
//   - suggestions.js (when catalog defaults don't specify a wallId)
//   - panels (when the user drops a point on the canvas)
//   - routing (no — routing reads point coordinates directly)

import {
  getNearestWallToPoint,
  getWallIdsOnFloor,
} from '../../topology/index.js'
import { pointInRoom } from '../shared/geometry.js'
import { getPointType } from '../catalogs/pointTypes.js'

const DEFAULT_FLOOR_ID = 'F1'

// Returns { wallId, wallT, projected:{x,y}, roomId, mountHeightFt } | null
export function snapPointToWall(state, type, x, y, opts = {}) {
  if (!state) return null
  const floorId = opts.floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  const candidateIds = getWallIdsOnFloor(state, floorId)
  const snap = getNearestWallToPoint(state, { x, y }, candidateIds)
  if (!snap) return null
  const roomId = pointInRoom(state, x, y, floorId)
  const cat = getPointType(type)
  return {
    wallId: snap.wallId,
    wallT: snap.t,
    projected: snap.projected,
    roomId,
    mountHeightFt: cat?.mountHeightFt ?? null,
  }
}
