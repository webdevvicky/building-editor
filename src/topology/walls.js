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

// ── Snap-to-wall (MEP foundation) ───────────────────────────────────────────

// Returns the wall closest to point, projected onto it. Used by every
// fixture / point placement for snap-to-wall behavior.
//
// candidateWallIds: optional Set or Array of wall ids to restrict the
// search to (e.g., walls on the current floor). When omitted, ALL walls
// are searched — including virtual + plot walls — caller filters.
//
// Returns { wallId, projected:{x,y}, distance, t } where t∈[0,1] is the
// parameter along the wall from n1 to n2. distance is in world inches.
// Returns null if there are no candidate walls.
export function getNearestWallToPoint(state, point, candidateWallIds) {
  const ids = candidateWallIds
    ? (candidateWallIds instanceof Set ? [...candidateWallIds] : candidateWallIds)
    : Object.keys(state.walls)
  // Deterministic order — sort ids
  ids.sort()
  let best = null
  for (const wid of ids) {
    const w = state.walls[wid]
    if (!w) continue
    const a = state.nodes[w.n1], b = state.nodes[w.n2]
    if (!a || !b) continue
    const dx = b.x - a.x, dy = b.y - a.y
    const lenSq = dx * dx + dy * dy
    if (lenSq === 0) continue
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq))
    const px = a.x + t * dx, py = a.y + t * dy
    const dist = Math.hypot(point.x - px, point.y - py)
    // Strict < for deterministic tiebreak: first-sorted wins
    if (!best || dist < best.distance) {
      best = { wallId: wid, projected: { x: px, y: py }, distance: dist, t }
    }
  }
  return best
}

// External walls that bear at least one door opening — i.e. service-entry
// candidates for DB placement, fire-alarm-panel placement, energy-meter
// placement (regulatory: must be accessible from outside / common
// circulation). Floor-scoped via the wall.floorId match.
export function getExternalAccessibleWalls(state, floorId) {
  const adj = getWallAdjacencyCount(state)
  const out = []
  for (const w of Object.values(state.walls)) {
    if (w.isVirtual || w.isPlot) continue
    if (floorId && (w.floorId ?? 'F1') !== floorId) continue
    if ((adj[w.id] ?? 0) !== 1) continue  // must be external
    const hasDoor = (w.openings ?? []).some(o => o.type === 'door')
    if (!hasDoor) continue
    out.push(w)
  }
  return out
}
