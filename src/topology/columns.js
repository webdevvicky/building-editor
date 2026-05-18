// Topology — column position + node↔column index.
//
// Source of truth for "where is column C in world coords?" and "is there a
// column at node N?" Used by beam endpoint resolution and (eventually) MEP
// obstacle maps for slab penetrations.

import { GRID_IN } from '../geometry.js'
import { getColumnAreaFt2, getColumnPerimeterFt } from '../lib/columnShapes.js'
import { createMemo } from './cache.js'

const _nodeToColumnMemo = createMemo()

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

// Column height — depends on projectSettings.floors[] span and the slab
// thickness above. Pure on its inputs. Used by structural BOQ and (eventually)
// MEP service-stack height calculations.
export function getColumnHeightFt(state, column) {
  const { projectSettings } = state
  const { floors = [], slabSettings } = projectSettings
  if (floors.length === 0) {
    const h = projectSettings.heights
    return h.plinthHeightFt + h.floorHeightFt + (slabSettings.mainThicknessIn / GRID_IN)
  }
  const sorted = [...floors].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
  const baseId = column.baseFloorId ?? sorted[0].id
  const topId  = column.topFloorId  ?? baseId
  const baseIdx = sorted.findIndex(f => f.id === baseId)
  const topIdx  = sorted.findIndex(f => f.id === topId)
  if (baseIdx === -1 || topIdx === -1) {
    const h = projectSettings.heights
    return h.plinthHeightFt + h.floorHeightFt + (slabSettings.mainThicknessIn / GRID_IN)
  }
  const lo = Math.min(baseIdx, topIdx), hi = Math.max(baseIdx, topIdx)
  let h = sorted[lo].plinthHeightFt || 0
  for (let i = lo; i <= hi; i++) h += sorted[i].floorHeightFt || 0
  h += slabSettings.mainThicknessIn / GRID_IN
  return h
}
