// Plumbing fixture auto-suggestions per room type.
//
// Reads ROOM_PLUMBING_DEFAULTS for the room's type, runs the generic
// applyRoomDefaults placement engine, and returns Suggestion[] suitable
// for state.applyRoomMepDefaults({ plumbing: [...] }).
//
// Pure: never mutates state.

import { ROOM_PLUMBING_DEFAULTS } from '../catalogs/plumbingDefaults.js'
import { applyRoomDefaults } from '../shared/suggestions.js'

// applyRoomDefaults emits entries shaped { type, suggestedX, suggestedY,
// suggestedWallId, suggestedWallT }. Map to the addPlumbingFixture
// signature used by applyRoomMepDefaults: { type, x, y, wallId, wallT }.
function _toAddFixtureShape(s) {
  return {
    type: s.type,
    x: s.suggestedX,
    y: s.suggestedY,
    wallId: s.suggestedWallId ?? null,
    wallT:  s.suggestedWallT  ?? null,
  }
}

// Convert the defaults table — entries are { type, n } — into the shape
// expected by applyRoomDefaults: { type, count, placement? }. Placement
// strategy defaults are picked by applyRoomDefaults from its registry;
// we pass `count = n` so the same fixture type can spawn multiple
// instances along the longest wall.
function _expandedDefaults() {
  const out = {}
  for (const [roomType, entries] of Object.entries(ROOM_PLUMBING_DEFAULTS)) {
    out[roomType] = entries.map(e => ({
      type: e.type,
      count: e.n ?? 1,
      // FLOOR_TRAP wants to sit at the room centroid (drainage low point);
      // suggestions's _strategyFor falls through to ROOM_CENTROID for any
      // type not in its registry. No override needed.
    }))
  }
  return out
}

const _EXPANDED = _expandedDefaults()

export function suggestPlumbingFixturesForRoom(state, roomId) {
  if (!state || !roomId) return []
  const entries = applyRoomDefaults(state, roomId, _EXPANDED)
  return entries.map(_toAddFixtureShape)
}
