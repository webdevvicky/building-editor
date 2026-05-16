// Rule: every slab.roomIds entry must point at a structurally valid room.

export const slabNoEnclosure = {
  id: 'slab_no_enclosure',
  severity: 'error',
  category: 'structural',
  message: 'Slab references a room with no closed polygon.',
  check(state) {
    const { slabs } = state
    const issues = []
    for (const slab of Object.values(slabs)) {
      const bad = (slab.roomIds || []).filter(rid => !state.isRoomStructurallyValid?.(rid))
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
