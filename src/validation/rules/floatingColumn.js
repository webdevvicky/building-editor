// Rule: a column should sit at a node shared by ≥1 wall, or be a foundation column.
// Standalone columns far from any wall are valid but suspicious — flagged as warning.

import { getColumnPosition } from '../../topology/columns.js'

const NEAR_IN = 24  // 2 ft

export const floatingColumn = {
  id: 'floating_column',
  severity: 'warning',
  category: 'structural',
  message: 'Column has no adjacent walls — verify it is intentional.',
  check(state) {
    const { columns, walls, nodes } = state
    const wallNodeIds = new Set()
    for (const w of Object.values(walls)) { wallNodeIds.add(w.n1); wallNodeIds.add(w.n2) }
    const issues = []
    for (const col of Object.values(columns)) {
      if (col.attachedNodeId && wallNodeIds.has(col.attachedNodeId)) continue
      // Standalone column: check if any wall node lies within NEAR_IN of the
      // column's resolved world position.
      const pos = getColumnPosition(state, col.id)
      if (!pos) continue
      let near = false
      for (const nid of wallNodeIds) {
        const n = nodes[nid]
        if (!n) continue
        if (Math.hypot(n.x - pos.x, n.y - pos.y) < NEAR_IN) { near = true; break }
      }
      if (!near) issues.push({ entityType: 'column', entityId: col.id })
    }
    return { ok: issues.length === 0, issues }
  },
}
