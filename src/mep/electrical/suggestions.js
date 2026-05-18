// Electrical point auto-suggestions per room type.
//
// Reads ROOM_ELECTRICAL_DEFAULTS for the room's type, runs the generic
// applyRoomDefaults engine, and returns Suggestion[] suitable for
// state.applyRoomMepDefaults({ electrical: [...] }).
//
// Pure: never mutates state.

import { ROOM_ELECTRICAL_DEFAULTS } from '../catalogs/is732Defaults.js'
import { getPointType } from '../catalogs/pointTypes.js'
import { applyRoomDefaults } from '../shared/suggestions.js'

// Translate applyRoomDefaults Suggestion to the addElectricalPoint signature.
function _toAddPointShape(s) {
  const cat = getPointType(s.type)
  return {
    type: s.type,
    x: s.suggestedX,
    y: s.suggestedY,
    wallId: s.suggestedWallId ?? null,
    wallT:  s.suggestedWallT  ?? null,
    mountHeightFt: cat?.mountHeightFt ?? null,
  }
}

// Convert the defaults table — entries are { type, n } — into the shape
// expected by applyRoomDefaults: { type, count }.
function _expandedDefaults() {
  const out = {}
  for (const [roomType, entries] of Object.entries(ROOM_ELECTRICAL_DEFAULTS)) {
    out[roomType] = entries.map(e => ({ type: e.type, count: e.n ?? 1 }))
  }
  return out
}

const _EXPANDED = _expandedDefaults()

export function suggestElectricalPointsForRoom(state, roomId) {
  if (!state || !roomId) return []
  const entries = applyRoomDefaults(state, roomId, _EXPANDED)
  return entries.map(_toAddPointShape)
}
