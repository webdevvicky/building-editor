// Rule: a column must be vertically continuous to the ground — its base must
// sit on the lowest floor, OR it must rest on a foundation. A column whose
// baseFloorId is above the lowest floor and is not foundation-supported is
// "floating" in the air (no structural support beneath). Flagged as a
// dismissable warning (Phase ColumnStack, fork #3): existing/imported data may
// legitimately be mid-edit, so this never blocks the workflow.
//
// Placement-time enforcement (Phase 2 Canvas) prevents NEW floating columns by
// refusing upper-floor clicks with no stack below; this rule is the seatbelt
// for legacy/imported state.

import { sortedFloorList } from '../../topology/floor.js'

export const columnUnsupported = {
  id: 'column_unsupported',
  severity: 'warning',
  category: 'structural',
  version: 1,
  order: 110,
  scope: 'structural',
  affectedBy: ['columns', 'foundations', 'projectSettings'],
  dismissable: true,
  message: 'Column base is above the lowest floor with no support beneath — verify it rests on a column or foundation below.',
  check(state) {
    const sorted = sortedFloorList(state)
    if (sorted.length === 0) return { ok: true, issues: [] }
    const lowestId = sorted[0].id

    // Columns attached to any foundation are supported.
    const foundationColumnIds = new Set()
    for (const f of Object.values(state.foundations ?? {})) {
      for (const cid of (f.columnIds ?? [])) foundationColumnIds.add(cid)
    }

    const issues = []
    for (const col of Object.values(state.columns ?? {})) {
      const baseId = col.baseFloorId ?? lowestId
      if (baseId === lowestId) continue                  // reaches the ground
      if (foundationColumnIds.has(col.id)) continue      // rests on a foundation
      issues.push({ entityType: 'column', entityId: col.id })
    }
    return { ok: issues.length === 0, issues }
  },
}

export default columnUnsupported
