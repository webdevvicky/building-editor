// Rule: every slab.roomIds entry must point at a structurally valid room.

import { isRoomStructurallyValid } from '../../topology/rooms.js'

export const slabNoEnclosure = {
  id: 'slab_no_enclosure',
  severity: 'error',
  category: 'structural',
  message: 'Slab references a room with no closed polygon.',
  check(state) {
    const issues = []
    for (const slab of Object.values(state.slabs)) {
      const bad = (slab.roomIds || []).filter(rid => !isRoomStructurallyValid(state, rid))
      for (const rid of bad) {
        issues.push({
          entityType: 'slab',
          entityId:   slab.id,
          message:    `Slab "${slab.type}" references invalid room ${rid}.`,
        })
      }
    }
    return { ok: issues.length === 0, issues }
  },
}
