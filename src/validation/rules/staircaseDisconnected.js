// Rule: staircase must connect two distinct floors (only meaningful when multi-floor).

export const staircaseDisconnected = {
  id: 'staircase_disconnected',
  severity: 'warning',
  category: 'structural',
  message: 'Staircase has same from/to floor — should connect distinct floors.',
  check(state) {
    const floors = state.projectSettings?.floors ?? []
    if (floors.length <= 1) return { ok: true, issues: [] }   // not actionable with one floor
    const issues = []
    for (const sc of Object.values(state.staircases ?? {})) {
      if ((sc.fromFloorId ?? null) === (sc.toFloorId ?? null)) {
        issues.push({ entityType: 'staircase', entityId: sc.id })
      }
    }
    return { ok: issues.length === 0, issues }
  },
}
