// Topology — column position + node↔column index.
//
// Source of truth for "where is column C in world coords?" and "is there a
// column at node N?" Used by beam endpoint resolution and (eventually) MEP
// obstacle maps for slab penetrations.

import { GRID_IN } from '../geometry.js'
import { getColumnAreaFt2, getColumnPerimeterFt } from '../lib/columnShapes.js'
import { createMemo } from './cache.js'
import { isColumnOnFloor, sortedFloorList } from './floor.js'

const _nodeToColumnMemo = createMemo()
const _columnFloorSpansMemo = createMemo()

// Builds nodeId → columnId map for attached columns. Memoized on state.columns.
export function getNodeToColumnIndex(state) {
  const columns = state.columns
  return _nodeToColumnMemo([columns], () => {
    const out = {}
    for (const col of Object.values(columns)) {
      if (col.attachedNodeId) out[col.attachedNodeId] = col.id
    }
    return out
  })
}

// Returns the column attached at nodeId, or null.
export function getColumnAtNode(state, nodeId) {
  const colId = getNodeToColumnIndex(state)[nodeId]
  return colId ? state.columns[colId] ?? null : null
}

// Resolves a column's world-coordinate position. For attached columns, the
// position mirrors the node's coords (live — moves with the node). For
// standalone columns, the column's own {x, y} is authoritative.
export function getColumnPosition(state, columnId) {
  const col = state.columns[columnId]
  if (!col) return null
  if (col.attachedNodeId) {
    const node = state.nodes[col.attachedNodeId]
    if (node) return { x: node.x, y: node.y }
  }
  return { x: col.x, y: col.y }
}

// Re-export column-shape helpers so callers asking topology questions about
// columns don't need a second import.
export { getColumnAreaFt2, getColumnPerimeterFt }

// Per-floor column index. Returns Map<floorId, Set<columnId>> covering
// every column that spans each floor (i.e. floor ∈ [base, top] in
// sequence order). Memoized on { columns, floors } refs. Used by risers
// when they need a column at the riser XY for support placement.
export function getColumnFloorSpans(state) {
  const columns = state.columns
  const floors = state.projectSettings?.floors ?? []
  return _columnFloorSpansMemo([columns, floors], () => {
    const sorted = sortedFloorList(state)
    const out = new Map()
    for (const f of sorted) out.set(f.id, new Set())
    for (const col of Object.values(columns)) {
      for (const f of sorted) {
        if (isColumnOnFloor(col, f.id, sorted)) out.get(f.id).add(col.id)
      }
    }
    return out
  })
}

// Ordered list of floorIds a column spans (lo→hi in sequence order).
// Empty when floors are unconfigured or base/top resolve outside the list.
export function getColumnSpanFloorIds(state, column) {
  const sorted = sortedFloorList(state)
  if (sorted.length === 0) return []
  const baseId = column.baseFloorId ?? sorted[0].id
  const topId  = column.topFloorId  ?? baseId
  const baseIdx = sorted.findIndex(f => f.id === baseId)
  const topIdx  = sorted.findIndex(f => f.id === topId)
  if (baseIdx === -1 || topIdx === -1) return []
  const lo = Math.min(baseIdx, topIdx), hi = Math.max(baseIdx, topIdx)
  return sorted.slice(lo, hi + 1).map(f => f.id)
}

// Per-floor "lift" height (ft) for one floor in a column's span. Decomposition
// (Phase ColumnStack, load-bearing — guarantees Σ lifts == getColumnHeightFt
// AND single-floor byte-identity):
//   plinth  → added on the BASE lift only
//   floorHeight → added on EVERY lift
//   slab    → added on the TOP lift only
// Returns 0 if floorId is not within the column's span.
export function getColumnLiftHeightFt(state, column, floorId) {
  const { projectSettings } = state
  const { slabSettings } = projectSettings
  const sorted = sortedFloorList(state)
  if (sorted.length === 0) return 0
  const baseId = column.baseFloorId ?? sorted[0].id
  const topId  = column.topFloorId  ?? baseId
  const baseIdx = sorted.findIndex(f => f.id === baseId)
  const topIdx  = sorted.findIndex(f => f.id === topId)
  const i       = sorted.findIndex(f => f.id === floorId)
  if (baseIdx === -1 || topIdx === -1 || i === -1) return 0
  const lo = Math.min(baseIdx, topIdx), hi = Math.max(baseIdx, topIdx)
  if (i < lo || i > hi) return 0
  let h = sorted[i].floorHeightFt || 0
  if (i === lo) h += sorted[lo].plinthHeightFt || 0
  if (i === hi) h += slabSettings.mainThicknessIn / GRID_IN
  return h
}

// Column height — sum of per-floor lifts across the span. Pure on its inputs.
// Used by structural BOQ and (eventually) MEP service-stack height calcs.
// Refactored to derive from getColumnLiftHeightFt so the per-floor and
// whole-column heights share ONE decomposition source.
export function getColumnHeightFt(state, column) {
  const { projectSettings } = state
  const { floors = [] } = projectSettings
  const slabSettings = projectSettings.slabSettings
  const fallback = () => {
    const h = projectSettings.heights
    return h.plinthHeightFt + h.floorHeightFt + (slabSettings.mainThicknessIn / GRID_IN)
  }
  if (floors.length === 0) return fallback()
  const spanIds = getColumnSpanFloorIds(state, column)
  if (spanIds.length === 0) return fallback()
  let total = 0
  for (const fid of spanIds) total += getColumnLiftHeightFt(state, column, fid)
  return total
}

// Returns the column whose span top is the floor DIRECTLY BELOW currentFloorId
// and whose resolved position is within tolIn of (x, y) — i.e. the stack a new
// upper-floor lift would extend onto. Null when there's no floor below or no
// column within tolerance. Pure; consumed by Phase 2 Canvas placement.
export function findColumnStackBelow(state, x, y, currentFloorId, tolIn) {
  const sorted = sortedFloorList(state)
  const curIdx = sorted.findIndex(f => f.id === currentFloorId)
  if (curIdx <= 0) return null
  let best = null
  for (const col of Object.values(state.columns)) {
    const topIdx = sorted.findIndex(f => f.id === (col.topFloorId ?? col.baseFloorId))
    if (topIdx !== curIdx - 1) continue   // top must be exactly the floor below
    const pos = getColumnPosition(state, col.id)
    if (!pos) continue
    const d = Math.hypot(pos.x - x, pos.y - y)
    if (d <= tolIn && (!best || d < best.d)) best = { d, col }
  }
  return best ? best.col : null
}
