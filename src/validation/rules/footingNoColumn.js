// Rule: a foundation entity must own at least one column or wall.
// Empty foundations produce no BOQ contribution and likely indicate a stale state.

export const footingNoColumn = {
  id: 'footing_no_column',
  severity: 'warning',
  category: 'structural',
  version: 1,
  order: 140,
  scope: 'structural',
  affectedBy: ['foundations', 'columns', 'walls'],
  dismissable: true,
  message: 'Foundation has no attached columns or walls.',
  check(state) {
    const issues = []
    for (const f of Object.values(state.foundations ?? {})) {
      const noCols  = !(f.columnIds || []).length
      const noWalls = !(f.wallIds   || []).length
      // RAFT and PILE may have no column attachments by design — still warn for
      // ISOLATED/COMBINED/STRIP that the contractor will need to know which
      // elements the foundation supports.
      if (noCols && noWalls && f.type !== 'RAFT' && f.type !== 'PILE') {
        issues.push({ entityType: 'foundation', entityId: f.id })
      }
    }
    return { ok: issues.length === 0, issues }
  },
}
