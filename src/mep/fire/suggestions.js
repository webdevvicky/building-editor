// Fire device auto-suggestions per room type.
//
// Reads ROOM_FIRE_DEFAULTS for the room's type, then for each entry runs
// the appropriate placement heuristic and returns suggestion entries
// suitable for state.addFireDevice / state.applyRoomMepDefaults.
//
// Per task spec:
//   - Every room gets at least one SMOKE_DETECTOR (or HEAT_DETECTOR for
//     KITCHEN — kitchen heat trumps smoke per the room defaults catalog).
//   - STAIRCASE rooms additionally get a MANUAL_CALL_POINT.
//   - The FIRE_ALARM_PANEL is a building-level default (BUILDING_FIRE_DEFAULTS)
//     placed once per floor via placeFireAlarmPanel — NOT emitted per
//     room. Suggestions here only emit room-scoped devices.
//   - FIRE_HOSE_REEL is Phase 2 (building heights ≥ 15 m).
//
// Pure: never mutates state.

import { ROOM_FIRE_DEFAULTS } from '../catalogs/fireDefaults.js'
import { getFireDevice } from '../catalogs/fireDevices.js'
import {
  placeManualCallPoint,
  placeSprinklerHeadsForRoom,
} from './placement.js'
import { getRoomCentroid } from '../../topology/index.js'

const DEFAULT_FLOOR_ID = 'F1'

// Device types handled by dedicated placement helpers — when these appear
// in the room defaults table, we route to the matching helper instead of
// the generic centroid fallback.
const PLACEMENT_BY_TYPE = Object.freeze({
  MANUAL_CALL_POINT: 'STAIR_OR_ENTRY',
  SPRINKLER_HEAD:    'ROOM_GRID',
})

function _toAddDeviceShape(s) {
  const cat = getFireDevice(s.type)
  return {
    type: s.type,
    x: s.suggestedX,
    y: s.suggestedY,
    wallId: s.suggestedWallId ?? null,
    wallT:  s.suggestedWallT  ?? null,
    mountHeightFt: s.mountHeightFt ?? cat?.mountHeightFt ?? null,
  }
}

export function suggestFireDevicesForRoom(state, roomId) {
  if (!state || !roomId) return []
  const room = state.rooms?.[roomId]
  if (!room) return []
  const roomType = room.type ?? 'OTHER'
  const defaults = ROOM_FIRE_DEFAULTS[roomType] ?? ROOM_FIRE_DEFAULTS.OTHER ?? []
  if (!defaults || defaults.length === 0) return []

  const floorId = room.floorId ?? DEFAULT_FLOOR_ID
  const centroid = getRoomCentroid(state, roomId)
  const entries = []

  for (const def of defaults) {
    const placementKey = PLACEMENT_BY_TYPE[def.type] ?? 'ROOM_CENTROID'
    const count = Math.max(1, def.n ?? 1)

    if (placementKey === 'ROOM_GRID') {
      const heads = placeSprinklerHeadsForRoom(state, roomId)
      for (const h of heads) {
        entries.push({
          type: def.type,
          suggestedX: h.x,
          suggestedY: h.y,
          suggestedWallId: null,
          suggestedWallT:  null,
          mountHeightFt: h.mountHeightFt,
        })
      }
      continue
    }

    if (placementKey === 'STAIR_OR_ENTRY') {
      // Manual call point lives on the room's longest interior wall when the
      // room is a STAIRCASE/ENTRY; for other rooms (e.g., this entry came
      // through KITCHEN), fall back to centroid.
      const target = placeManualCallPoint(state, floorId)
      // Only commit the placement if it actually lands in THIS room — otherwise
      // the caller emits a centroid-based fallback so the device stays attached
      // to the room that asked for it.
      if (target && target.roomId === roomId) {
        for (let k = 0; k < count; k++) {
          entries.push({
            type: def.type,
            suggestedX: target.x,
            suggestedY: target.y,
            suggestedWallId: target.wallId,
            suggestedWallT:  target.wallT,
            mountHeightFt: target.mountHeightFt,
          })
        }
        continue
      }
      // Fall-through to centroid below.
    }

    // ROOM_CENTROID default — detectors (smoke/heat) + extinguishers sit at
    // the room centroid in Phase 1; the user drags them to a precise spot.
    const cat = getFireDevice(def.type)
    for (let k = 0; k < count; k++) {
      entries.push({
        type: def.type,
        suggestedX: centroid?.x ?? 0,
        suggestedY: centroid?.y ?? 0,
        suggestedWallId: null,
        suggestedWallT:  null,
        mountHeightFt: cat?.mountHeightFt ?? null,
      })
    }
  }

  // Deterministic output: by (type, x, y).
  entries.sort((a, b) =>
    a.type < b.type ? -1 :
    a.type > b.type ?  1 :
    a.suggestedX - b.suggestedX || a.suggestedY - b.suggestedY
  )
  return entries.map(_toAddDeviceShape)
}
