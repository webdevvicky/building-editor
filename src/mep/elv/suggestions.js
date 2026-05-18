// ELV device auto-suggestions per room type.
//
// Reads ROOM_ELV_DEFAULTS for the room's type and emits suggestion entries
// suitable for state.addElvDevice / state.applyRoomMepDefaults.
//
// All suggested devices sit at the room centroid in Phase 1 — the user
// drags them to a precise spot. The ELV_RACK and CCTV cameras are
// building-level (placeElvRack / placeCctvCamera) rather than room-level
// and are NOT emitted from this room suggestion engine.
//
// Pure: never mutates state.

import { ROOM_ELV_DEFAULTS } from '../catalogs/elvDefaults.js'
import { getElvDevice } from '../catalogs/elvDevices.js'
import { getRoomCentroid } from '../../topology/index.js'

const DEFAULT_FLOOR_ID = 'F1'

function _toAddDeviceShape(s) {
  const cat = getElvDevice(s.type)
  return {
    type: s.type,
    x: s.suggestedX,
    y: s.suggestedY,
    wallId: s.suggestedWallId ?? null,
    wallT:  s.suggestedWallT  ?? null,
    mountHeightFt: s.mountHeightFt ?? cat?.mountHeightFt ?? null,
  }
}

export function suggestElvDevicesForRoom(state, roomId) {
  if (!state || !roomId) return []
  const room = state.rooms?.[roomId]
  if (!room) return []
  const roomType = room.type ?? 'OTHER'
  const defaults = ROOM_ELV_DEFAULTS[roomType] ?? ROOM_ELV_DEFAULTS.OTHER ?? []
  if (!defaults || defaults.length === 0) return []

  const floorId = room.floorId ?? DEFAULT_FLOOR_ID
  void floorId
  const centroid = getRoomCentroid(state, roomId)
  const entries = []

  for (const def of defaults) {
    const count = Math.max(1, def.n ?? 1)
    const cat = getElvDevice(def.type)
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
