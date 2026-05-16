// Rule: explicit beams should terminate on columns at both ends.

export const beamNoSupport = {
  id: 'beam_no_support',
  severity: 'warning',
  category: 'structural',
  message: 'Explicit beam endpoint is not a column.',
  check(state) {
    const { beams, columns } = state
    const issues = []
    for (const beam of Object.values(beams)) {
      const from = beam.endpoints?.from
      const to   = beam.endpoints?.to
      const fromOk = from?.type === 'COLUMN' && !!columns[from.columnId]
      const toOk   = to?.type   === 'COLUMN' && !!columns[to.columnId]
      if (!fromOk || !toOk) issues.push({ entityType: 'beam', entityId: beam.id })
    }
    return { ok: issues.length === 0, issues }
  },
}
