// Topology — wall-side relationships.
//
// Wall adjacency = how many rooms reference each wall. From this single
// invariant we derive external/partition classification, beam-flag
// resolution, and the external-wall set used by parapet, slab edge,
// and (eventually) MEP service-entry placement.

import { BEAM_LEVEL_REGISTRY } from '../constants/structural.js'
import { createMemo } from './cache.js'

const _wallAdjMemo  = createMemo()
const _wallToRoomsMemo = createMemo()

// ── Adjacency ───────────────────────────────────────────────────────────────

// Returns { [wallId]: count } — how many rooms reference each wall.
// Used to auto-classify external (count=1) vs partition (count=2) walls.
// Memoized on state.rooms reference.
export function getWallAdjacencyCount(state) {
  const rooms = state.rooms
  return _wallAdjMemo([rooms], () => {
    const count = {}
    for (const room of Object.values(rooms)) {
      for (const wid of (room.wallIds || [])) {
        count[wid] = (count[wid] || 0) + 1
      }
    }
    return count
  })
}

// Returns { [wallId]: Room[] } — every room that references each wall.
// Strictly richer than getWallAdjacencyCount; cached separately because not
// every consumer wants the full Room[].
export function getWallToRoomsIndex(state) {
  const rooms = state.rooms
  return _wallToRoomsMemo([rooms], () => {
    const out = {}
    for (const room of Object.values(rooms)) {
      for (const wid of (room.wallIds || [])) {
        if (!out[wid]) out[wid] = []
        out[wid].push(room)
      }
    }
    return out
  })
}

// Returns the rooms that own wallId (length 0, 1, or 2).
export function getRoomsForWall(state, wallId) {
  return getWallToRoomsIndex(state)[wallId] ?? []
}

// ── Classification ──────────────────────────────────────────────────────────

export function isExternalWall(state, wallId) {
  return (getWallAdjacencyCount(state)[wallId] ?? 0) === 1
}

export function isPartitionWall(state, wallId) {
  return (getWallAdjacencyCount(state)[wallId] ?? 0) === 2
}

// Returns the set of wall ids that are external (adjacency exactly 1).
// Plot walls and virtual walls are filtered out — they're not building
// envelope candidates.
export function getExternalWallIds(state, opts = {}) {
  const adj = getWallAdjacencyCount(state)
  const out = new Set()
  for (const w of Object.values(state.walls)) {
    if (w.isVirtual) continue
    if (opts.includePlotWalls !== true && w.isPlot) continue
    if ((adj[w.id] ?? 0) !== 1) continue
    out.add(w.id)
  }
  return out
}

// ── Beam-flag resolution ────────────────────────────────────────────────────

// Resolves null beam flags to auto-derived booleans from room adjacency.
// External (count=1): plinth + lintel + roof; Partition (count=2): lintel
// only; Unclassified: none. Per-wall overrides win over auto-derivation.
export function classifyWallBeamFlags(state, wallId) {
  const wall = state.walls[wallId]
  if (!wall) {
    return Object.fromEntries(BEAM_LEVEL_REGISTRY.map(lvl => [lvl.flagName, false]))
  }
  const adjCount = getWallAdjacencyCount(state)
  const cnt   = adjCount[wallId] ?? 0
  const isExt  = cnt === 1
  const isPart = cnt === 2
  const result = {}
  for (const lvl of BEAM_LEVEL_REGISTRY) {
    const override = wall[lvl.flagName]
    result[lvl.flagName] = override !== null
      ? override
      : (lvl.autoExternal && isExt) || (lvl.autoPartition && isPart)
  }
  return result
}
