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

// CANONICAL ACCESSOR (locked rule) — the single home for resolving a beam
// endpoint reference to world coords. EVERY consumer of beam-endpoint geometry
// (BBS, BOQ, shuttering, canvas render, validation) MUST call this; no direct
// endpoint coordinate access anywhere in the codebase.
//
// Endpoint types:
//   { type: 'COLUMN', columnId }            — column position (or its attachedNodeId)
//   { type: 'BEAM',   beamId, t }           — point at parameter t∈[0,1] along that
//                                             primary beam (recursive; cycle-guarded)
//   { type: 'WALL',   wallId, t }           — point at parameter t∈[0,1] along n1→n2
//   { type: 'POINT',  x, y, detachedFrom? } — absolute world coords (free / cantilever
//                                             / detached-by-parent-delete)
// Returns null for a dangling ref, a cycle, an out-of-graph ref, or an unknown
// type — NEVER {x: undefined} (no silent NaN downstream).
//
// `opts.seen` is the internal cycle guard (Set of beamIds visited this resolve).
export function resolveBeamEndpoint(state, endpointRef, opts = {}) {
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
  if (endpointRef.type === 'POINT') {
    return { x: endpointRef.x, y: endpointRef.y }
  }
  if (endpointRef.type === 'BEAM') {
    const seen = opts.seen ?? new Set()
    if (seen.has(endpointRef.beamId)) return null   // cycle — refuse, no NaN
    const beam = state.beams?.[endpointRef.beamId]
    if (!beam) return null
    seen.add(endpointRef.beamId)
    const a = resolveBeamEndpoint(state, beam.endpoints?.from, { seen })
    const b = resolveBeamEndpoint(state, beam.endpoints?.to,   { seen })
    if (!a || !b) return null
    const t = _clamp01(endpointRef.t)
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  }
  if (endpointRef.type === 'WALL') {
    const wall = state.walls?.[endpointRef.wallId]
    if (!wall) return null
    const n1 = state.nodes?.[wall.n1], n2 = state.nodes?.[wall.n2]
    if (!n1 || !n2) return null
    const t = _clamp01(endpointRef.t)
    return { x: n1.x + (n2.x - n1.x) * t, y: n1.y + (n2.y - n1.y) * t }
  }
  return null   // unknown type — refuse rather than emit {x: undefined}
}

function _clamp01(t) {
  const n = Number(t)
  if (!Number.isFinite(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
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
