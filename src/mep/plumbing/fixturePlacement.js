// Plumbing fixture placement helper — snap a free (x,y) to the nearest wall
// on the fixture's floor and resolve the containing room.
//
// Pure read of state; no mutation. Used by:
//   - suggestions.js (when catalog defaults don't specify a wallId)
//   - panels (when the user drops a fixture on the canvas)
//   - routing.js (to back-fill fixture.wallId when null)

import {
  getNearestWallToPoint,
  getWallIdsOnFloor,
} from '../../topology/index.js'
import { pointInRoom } from '../shared/geometry.js'

const DEFAULT_FLOOR_ID = 'F1'

// Returns { wallId, wallT, projected:{x,y}, roomId } | null
// opts.floorId — defaults to state.currentFloorId
export function snapFixtureToWall(state, type, x, y, opts = {}) {
  void type
  if (!state) return null
  const floorId = opts.floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  const candidateIds = getWallIdsOnFloor(state, floorId)
  const snap = getNearestWallToPoint(state, { x, y }, candidateIds)
  if (!snap) return null
  const roomId = pointInRoom(state, x, y, floorId)
  return {
    wallId: snap.wallId,
    wallT: snap.t,
    projected: snap.projected,
    roomId,
  }
}
