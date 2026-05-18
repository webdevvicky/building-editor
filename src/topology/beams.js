// Topology — beam endpoint resolution + wall-derived beam synthesis.
//
// SINGLE home for the endpointPos function that was duplicated 5× across
// structuralSlice / boq/scope / quantities/bbs. Also owns wall-derived beam
// synthesis (was duplicated between structuralSlice and boq/scope).

import { GRID_IN } from '../geometry.js'
import { BEAM_LEVEL_REGISTRY } from '../constants/structural.js'
import { createMemo } from './cache.js'
import { getNodeToColumnIndex } from './columns.js'
import { classifyWallBeamFlags } from './walls.js'

const _derivedBeamsMemo = createMemo()
const _allBeamsMemo     = createMemo()

// Resolves a beam endpoint reference to world coords. Handles both kinds:
//   { type: 'COLUMN', columnId } — position derived from columns[columnId]
//     (and the column's attachedNodeId if present)
//   { type: 'POINT',  x, y }     — absolute world coords
// Returns null if the column reference is dangling.
export function resolveBeamEndpoint(state, endpointRef) {
  if (!endpointRef) return null
  if (endpointRef.type === 'COLUMN') {
    const col = state.columns[endpointRef.columnId]
    if (!col) return null
    if (col.attachedNodeId) {
      const node = state.nodes[col.attachedNodeId]
      return node ?? null
    }
    return { x: col.x, y: col.y }
  }
  return { x: endpointRef.x, y: endpointRef.y }
}

// Returns beam length in feet, or 0 if either endpoint is dangling.
export function getBeamLengthFt(state, beam) {
  const from = resolveBeamEndpoint(state, beam.endpoints?.from)
  const to   = resolveBeamEndpoint(state, beam.endpoints?.to)
  if (!from || !to) return 0
  return Math.hypot(to.x - from.x, to.y - from.y) / GRID_IN
}

// Returns in-memory WALL_DERIVED beam entities (NOT persisted in store).
// Single canonical implementation — replaces the duplicate in boq/scope.
// Memoized on {walls, nodes, columns, rooms} reference equality. Scoped
// callers (boq/scope) pass in a state shim with floor-filtered collections,
// so the memo cell naturally distinguishes scoped vs unscoped via the
// reference of the rooms map (different objects).
export function getDerivedWallBeams(state) {
  const { walls, nodes, columns, rooms } = state
  return _derivedBeamsMemo([walls, nodes, columns, rooms], () => {
    const nodeToColId = getNodeToColumnIndex(state)
    const result = []
    for (const wall of Object.values(walls)) {
      if (wall.isVirtual || wall.isPlot) continue
      const flags = classifyWallBeamFlags(state, wall.id)
      const n1 = nodes[wall.n1], n2 = nodes[wall.n2]
      if (!n1 || !n2) continue
      for (const lvl of BEAM_LEVEL_REGISTRY) {
        if (!flags[lvl.flagName]) continue
        const fromRef = nodeToColId[wall.n1]
          ? { type: 'COLUMN', columnId: nodeToColId[wall.n1] }
          : { type: 'POINT', x: n1.x, y: n1.y }
        const toRef = nodeToColId[wall.n2]
          ? { type: 'COLUMN', columnId: nodeToColId[wall.n2] }
          : { type: 'POINT', x: n2.x, y: n2.y }
        result.push({
          id: `derived_${wall.id}_${lvl.id}`,
          endpoints: { from: fromRef, to: toRef },
          level: lvl.id,
          source: 'WALL_DERIVED',
          sourceWallId: wall.id,
        })
      }
    }
    return result
  })
}

// Merges EXPLICIT (persisted) + WALL_DERIVED (in-memory) beams into one list.
// All BOQ, canvas render, and CSV export consume this — single code path.
export function getAllBeams(state) {
  const beams = state.beams
  const derived = getDerivedWallBeams(state)
  return _allBeamsMemo([beams, derived], () => [...Object.values(beams), ...derived])
}
