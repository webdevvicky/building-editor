// Topology — floor-scoped entity selectors.
//
// Single home for "which entities belong to floor F?" Replaces:
//   - store.getActiveFloorNodes/Walls (action-side snap scoping)
//   - structuralSlice.getColumnsOnFloor / getWallsOnFloor / getRoomsOnFloor /
//     getStampsOnFloor / getBeamsOnFloor / getSlabsOnFloor /
//     getStaircasesOnFloor / getNodeIdsByFloor / getWallIdsByFloor /
//     getEntitiesOnFloor
//   - boq/scope.isColumnOnFloor (column-span predicate)
//
// Topology principle: a column belongs to a floor iff that floor is in its
// [baseFloorId, topFloorId] span in sequence order. Walls/rooms/stamps/beams/
// slabs/foundations belong to exactly one floor via .floorId. Staircases
// belong to BOTH .fromFloorId and .toFloorId (visible on both ends). Nodes
// carry .floorIds[] — length 1 today, future-proof for vertical shafts.

const DEFAULT_FLOOR_ID = 'F1'

// ── Sorted floor list (sequence-ascending) ──────────────────────────────────

export function sortedFloorList(state) {
  return [...(state.projectSettings?.floors ?? [])]
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
}

// ── Column-floor span ───────────────────────────────────────────────────────

// Pure: a column belongs to a floor iff floor ∈ [base,top] in sequence.
// `sortedFloors` is the result of sortedFloorList(state) — passed in so
// callers iterating over many columns don't re-sort per column.
export function isColumnOnFloor(column, floorId, sortedFloors) {
  const baseIdx = sortedFloors.findIndex(f => f.id === (column.baseFloorId ?? floorId))
  const topIdx  = sortedFloors.findIndex(f => f.id === (column.topFloorId  ?? column.baseFloorId ?? floorId))
  const cIdx    = sortedFloors.findIndex(f => f.id === floorId)
  if (baseIdx === -1 || topIdx === -1 || cIdx === -1) {
    return (column.baseFloorId ?? DEFAULT_FLOOR_ID) === floorId
  }
  return cIdx >= Math.min(baseIdx, topIdx) && cIdx <= Math.max(baseIdx, topIdx)
}

// ── Entity-by-floor selectors ───────────────────────────────────────────────

export function getNodesOnFloor(state, floorId) {
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  return Object.values(state.nodes).filter(n =>
    (n.floorIds ?? [DEFAULT_FLOOR_ID]).includes(fid)
  )
}

export function getWallsOnFloor(state, floorId) {
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  return Object.values(state.walls).filter(w => (w.floorId ?? DEFAULT_FLOOR_ID) === fid)
}

export function getRoomsOnFloor(state, floorId) {
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  return Object.values(state.rooms).filter(r => (r.floorId ?? DEFAULT_FLOOR_ID) === fid)
}

export function getStampsOnFloor(state, floorId) {
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  return Object.values(state.stamps).filter(s => (s.floorId ?? DEFAULT_FLOOR_ID) === fid)
}

export function getBeamsOnFloor(state, floorId) {
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  return Object.values(state.beams).filter(b => (b.floorId ?? DEFAULT_FLOOR_ID) === fid)
}

export function getSlabsOnFloor(state, floorId) {
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  return Object.values(state.slabs).filter(s => (s.floorId ?? DEFAULT_FLOOR_ID) === fid)
}

export function getFoundationsOnFloor(state, floorId) {
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  return Object.values(state.foundations).filter(f => (f.floorId ?? DEFAULT_FLOOR_ID) === fid)
}

export function getStaircasesOnFloor(state, floorId) {
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  return Object.values(state.staircases).filter(sc =>
    (sc.fromFloorId ?? DEFAULT_FLOOR_ID) === fid ||
    (sc.toFloorId   ?? DEFAULT_FLOOR_ID) === fid
  )
}

export function getColumnsOnFloor(state, floorId) {
  const sorted = sortedFloorList(state)
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  return Object.values(state.columns).filter(col => isColumnOnFloor(col, fid, sorted))
}

// ── Set-returning fast-path (used by store actions during draw/snap) ────────

export function getNodeIdsOnFloor(state, floorId) {
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  const out = new Set()
  for (const [id, node] of Object.entries(state.nodes)) {
    const ids = node.floorIds ?? [DEFAULT_FLOOR_ID]
    if (ids.includes(fid)) out.add(id)
  }
  return out
}

export function getWallIdsOnFloor(state, floorId) {
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  const out = new Set()
  for (const [id, w] of Object.entries(state.walls)) {
    if ((w.floorId ?? DEFAULT_FLOOR_ID) === fid) out.add(id)
  }
  return out
}

// Map-returning variants used by store action helpers (snap + auto-split).
// Returns the FULL maps for single-floor projects so single-floor behavior is
// byte-identical to pre-Phase-1.7.2.

export function getActiveFloorNodes(state, floorId) {
  const floors = state.projectSettings?.floors ?? []
  if (floors.length <= 1) return state.nodes
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  const out = {}
  for (const [id, node] of Object.entries(state.nodes)) {
    const ids = node.floorIds ?? [DEFAULT_FLOOR_ID]
    if (ids.includes(fid)) out[id] = node
  }
  return out
}

export function getActiveFloorWalls(state, floorId) {
  const floors = state.projectSettings?.floors ?? []
  if (floors.length <= 1) return state.walls
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  const out = {}
  for (const [id, w] of Object.entries(state.walls)) {
    if ((w.floorId ?? DEFAULT_FLOOR_ID) === fid) out[id] = w
  }
  return out
}

// ── Aggregate ───────────────────────────────────────────────────────────────

export function getEntitiesOnFloor(state, floorId) {
  return {
    nodes:       getNodesOnFloor(state, floorId),
    walls:       getWallsOnFloor(state, floorId),
    rooms:       getRoomsOnFloor(state, floorId),
    stamps:      getStampsOnFloor(state, floorId),
    columns:     getColumnsOnFloor(state, floorId),
    beams:       getBeamsOnFloor(state, floorId),
    slabs:       getSlabsOnFloor(state, floorId),
    staircases:  getStaircasesOnFloor(state, floorId),
    foundations: getFoundationsOnFloor(state, floorId),
  }
}
