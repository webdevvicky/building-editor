// Rule: every wet room (TOILET / BATHROOM / KITCHEN / UTILITY) must have
// at least one FLOOR_TRAP fixture. Surfaces as a validation warning in
// the BOQ footer.
//
// Wet-room set: matches the topology `WET_ROOM_TYPES` plus BATHROOM
// (which uses TOILET semantics in older save formats). The catalog
// fixture id is FLOOR_TRAP (sit-flush trap) — FLOOR_DRAIN is a related
// but distinct fixture; the rule treats only FLOOR_TRAP as the
// required sanitary device, in line with IS 2065 §6 and NBC 2016.

import { getWetRoomIds } from '../../../topology/index.js'

const WET_ROOM_TYPES_FOR_TRAP = new Set(['TOILET', 'BATHROOM', 'KITCHEN', 'UTILITY'])

export const mepNoFloorTrap = {
  id: 'mep_no_floor_trap',
  severity: 'warning',
  category: 'mep',
  version: 1,
  order: 200,
  scope: 'mep',
  affectedBy: ['rooms', 'plumbingFixtures'],
  dismissable: true,
  message: 'Wet room has no floor trap — drainage will not pass inspection.',
  check(state) {
    if (!state) return { ok: true, issues: [] }
    const issues = []
    const rooms = state.rooms ?? {}
    const fixtures = Object.values(state.plumbingFixtures ?? {})

    // Set of room ids that contain at least one FLOOR_TRAP.
    const haveTrap = new Set()
    for (const fx of fixtures) {
      if (fx.type !== 'FLOOR_TRAP') continue
      if (fx.roomId) haveTrap.add(fx.roomId)
    }

    const wetIds = new Set(getWetRoomIds(state))
    // Also include BATHROOM (not in topology WET_ROOM_TYPES but treated
    // identically for plumbing drainage).
    for (const r of Object.values(rooms)) {
      if (WET_ROOM_TYPES_FOR_TRAP.has(r.type)) wetIds.add(r.id)
    }

    for (const rid of [...wetIds].sort()) {
      if (haveTrap.has(rid)) continue
      const room = rooms[rid]
      if (!room) continue
      issues.push({
        entityType: 'PLUMBING',
        entityId:   rid,
        message:    `Wet room "${room.name ?? rid}" has no floor trap`,
      })
    }
    return { ok: issues.length === 0, issues }
  },
}
