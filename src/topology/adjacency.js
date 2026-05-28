// Topology — room adjacency graph + floor wall-perimeter graph.
//
// Two rooms are "adjacent" if they share at least one wall. They are
// "connected" if they share a wall AND that wall has at least one door
// opening. Used by MEP duct routing, drainage-stack siting, and the
// corridor/passage-discovery step in interior layout engines.
//
// The wall-perimeter graph is THE load-bearing primitive for MEP
// routing — every discipline BFS's over it to compute pipe / wire
// polylines along wall lines.

import { createMemo } from './cache.js'
import { getWallToRoomsIndex } from './walls.js'

const DEFAULT_FLOOR_ID = 'F1'

const _adjacencyMemo    = createMemo()
const _connectivityMemo = createMemo()

// Per-floor memo cells for the wall-perimeter graph. One cell per floorId.
// Cell invalidates when state.walls or state.nodes reference changes —
// which Zustand does on every store mutation. Multi-cell because the
// function takes a floorId parameter; createMemo() is single-cell.
const _floorWallPerimeterCells = new Map()
const _roomWallPerimeterCells  = new Map()

// Returns string[] of wallIds that appear in BOTH wallIdsA and wallIdsB.
// Pure helper. Most callers go through getRoomsBorderingRoom or the graph
// builders; this is exported for one-off comparisons.
export function findSharedWalls(wallIdsA, wallIdsB) {
  const setB = new Set(wallIdsB)
  return wallIdsA.filter(w => setB.has(w))
}

// Builds the room adjacency graph: { [roomId]: Set<roomId> }.
// Symmetric (A in adj[B] iff B in adj[A]). Edge exists iff the two rooms
// share at least one wall — independent of openings, finishes, or floor.
//
// Cross-floor adjacency: two rooms on different floors share NO walls by
// design (walls are floor-owned), so the graph naturally partitions by
// floor without an explicit filter.
export function getRoomAdjacencyGraph(state) {
  const rooms = state.rooms
  return _adjacencyMemo([rooms], () => {
    const idx = getWallToRoomsIndex(state)
    const graph = {}
    for (const rid of Object.keys(rooms)) graph[rid] = new Set()
    for (const wallRooms of Object.values(idx)) {
      if (wallRooms.length < 2) continue
      for (let i = 0; i < wallRooms.length; i++) {
        for (let j = i + 1; j < wallRooms.length; j++) {
          graph[wallRooms[i].id].add(wallRooms[j].id)
          graph[wallRooms[j].id].add(wallRooms[i].id)
        }
      }
    }
    return graph
  })
}

export function getRoomsBorderingRoom(state, roomId) {
  const graph = getRoomAdjacencyGraph(state)
  const ids = graph[roomId] ?? new Set()
  return [...ids].map(id => state.rooms[id]).filter(Boolean)
}

// Connectivity graph — like adjacency but only counts shared walls that
// carry a door opening. This is the graph a corridor-finder or pipe-router
// traverses when it needs human-passable connections.
export function getRoomConnectivityGraph(state) {
  const rooms = state.rooms
  const walls = state.walls
  return _connectivityMemo([rooms, walls], () => {
    const idx = getWallToRoomsIndex(state)
    const graph = {}
    for (const rid of Object.keys(rooms)) graph[rid] = new Set()
    for (const [wid, wallRooms] of Object.entries(idx)) {
      if (wallRooms.length < 2) continue
      const wall = walls[wid]
      if (!wall) continue
      const hasDoor = (wall.openings ?? []).some(o => o.type === 'door')
      if (!hasDoor) continue
      for (let i = 0; i < wallRooms.length; i++) {
        for (let j = i + 1; j < wallRooms.length; j++) {
          graph[wallRooms[i].id].add(wallRooms[j].id)
          graph[wallRooms[j].id].add(wallRooms[i].id)
        }
      }
    }
    return graph
  })
}

// Given a room and a specific opening on one of its walls, returns the room
// on the OTHER side of that door (or null if the door is external).
export function getRoomNeighbourThroughDoor(state, roomId, openingId) {
  const room = state.rooms[roomId]
  if (!room) return null
  for (const wid of (room.wallIds ?? [])) {
    const wall = state.walls[wid]
    if (!wall) continue
    const op = (wall.openings ?? []).find(o => o.id === openingId)
    if (!op) continue
    // Wall found — locate the other room that owns it
    const idx = getWallToRoomsIndex(state)
    const wallRooms = idx[wid] ?? []
    for (const r of wallRooms) if (r.id !== roomId) return r
    return null  // external door
  }
  return null
}

// ── Wall-perimeter graph (load-bearing for MEP routing) ─────────────────────
//
// Builds a node-edge graph over the floor's walls. Nodes are existing
// state.nodes (wall endpoints + splitWall midpoints — both are real
// node entities). Edges are walls, weighted by lengthFt. MEP routing
// engines BFS over this graph to compute wall-following polylines.
//
// Returned shape:
//   {
//     floorId,
//     nodes:     { [nodeId]: { id, x, y, edgeIds: string[] } },
//     edges:     { [wallId]: { id, wallId, fromNodeId, toNodeId, lengthIn, lengthFt } },
//     adjacency: { [nodeId]: { [adjacentNodeId]: wallId } },
//   }
//
// Invariants:
//   - Only walls with (floorId ?? 'F1') === floorId are included.
//   - Virtual walls (w.isVirtual) are excluded — they're not physical paths.
//   - Plot walls (w.isPlot) are INCLUDED — site-boundary walls are routable.
//   - Only nodes that are endpoints of at least one included wall appear.
//   - Edges are inserted in deterministic order (sorted by wall.id) so
//     downstream consumers can produce stable hashes.
//   - T-intersections from splitWall(): the midpoint node is a real
//     state.nodes entry; it appears with the natural degree (3+ if a
//     branch wall meets there). No special handling needed.
//   - Walls sharing a node but not collinear (a corner): both walls list
//     the shared node in their edgeIds and the node's adjacency map
//     points to both via the appropriate wallIds. No special handling.
//
// Memoization:
//   - Per-floor cache in _floorWallPerimeterCells (Map<floorId, cell>).
//   - Cell invalidates when state.walls OR state.nodes reference changes
//     (Zustand replaces both on every mutation), forcing a recompute.
//   - Result reference is stable within a memoized window so React/Zustand
//     selectors don't trigger spurious re-renders.

// Phase W — buildFloorWallPerimeterGraph EXPANDED.
//
// Walls with T-junctions expand into multiple graph edges. Each edge
// carries a unique `edgeKey = ${wallId}::${segmentIndex}::${fromNodeId}::${toNodeId}`.
// Face traversal / canonicalization MUST use edgeKey, not wallId alone
// (multiple edges share a wallId after expansion).
//
// Pre-Phase-W walls (no junctions / junctions=[]) produce exactly one
// edge per wall — backward-compatible by construction.
function buildFloorWallPerimeterGraph(walls, nodes, floorId) {
  // First pass: collect floor-scoped walls. Sort by id for determinism.
  const floorWalls = []
  for (const w of Object.values(walls)) {
    if (w.isVirtual) continue
    if ((w.floorId ?? DEFAULT_FLOOR_ID) !== floorId) continue
    floorWalls.push(w)
  }
  floorWalls.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

  // Second pass: collect used nodes (wall endpoints + T-junctions on walls)
  const graphNodes = {}
  for (const w of floorWalls) {
    for (const nid of [w.n1, w.n2]) {
      const n = nodes[nid]
      if (!n) continue
      if (!graphNodes[nid]) graphNodes[nid] = { id: nid, x: n.x, y: n.y, edgeIds: [] }
    }
    // T-junctions attached to this wall are also graph nodes.
    for (const jId of (w.junctions ?? [])) {
      const j = nodes[jId]
      if (!j) continue
      if (!graphNodes[jId]) graphNodes[jId] = { id: jId, x: j.x, y: j.y, edgeIds: [] }
    }
  }

  // Third pass: build edges + adjacency. Each wall expands into one or
  // more segments based on its junctions list (ordered along the wall).
  const graphEdges = {}
  const adjacency = {}
  for (const nid of Object.keys(graphNodes)) adjacency[nid] = {}

  for (const w of floorWalls) {
    const a = graphNodes[w.n1]
    const b = graphNodes[w.n2]
    if (!a || !b) continue
    const wDx = b.x - a.x, wDy = b.y - a.y
    const wLen2 = wDx * wDx + wDy * wDy
    if (wLen2 === 0) continue

    // Order junctions along the wall by parametric t (projection onto n1→n2).
    const junctionEntries = []
    for (const jId of (w.junctions ?? [])) {
      const j = nodes[jId]
      if (!j) continue
      const t = ((j.x - a.x) * wDx + (j.y - a.y) * wDy) / wLen2
      junctionEntries.push({ nodeId: jId, t })
    }
    junctionEntries.sort((p, q) => {
      if (p.t !== q.t) return p.t - q.t
      return p.nodeId < q.nodeId ? -1 : p.nodeId > q.nodeId ? 1 : 0
    })

    // Walk: n1 → j1 → j2 → ... → n2. Each consecutive pair is a segment.
    const ordered = [w.n1, ...junctionEntries.map(e => e.nodeId), w.n2]
    for (let i = 0; i < ordered.length - 1; i++) {
      const fromId = ordered[i]
      const toId   = ordered[i + 1]
      const fromN  = graphNodes[fromId]
      const toN    = graphNodes[toId]
      if (!fromN || !toN) continue
      const dx = toN.x - fromN.x, dy = toN.y - fromN.y
      const lengthIn = Math.hypot(dx, dy)
      const lengthFt = lengthIn / 12
      const edgeKey = `${w.id}::${i}::${fromId}::${toId}`
      graphEdges[edgeKey] = {
        id:           edgeKey,
        wallId:       w.id,
        segmentIndex: i,
        fromNodeId:   fromId,
        toNodeId:     toId,
        lengthIn,
        lengthFt,
      }
      fromN.edgeIds.push(edgeKey)
      toN.edgeIds.push(edgeKey)
      adjacency[fromId][toId] = edgeKey
      adjacency[toId][fromId] = edgeKey
    }
  }

  // Sort edgeIds per node for determinism
  for (const n of Object.values(graphNodes)) {
    n.edgeIds.sort()
  }

  return { floorId, nodes: graphNodes, edges: graphEdges, adjacency }
}

/**
 * Phase W — resolve the parent wall id for an edge between two nodes.
 * Returns the parent wallId (string) or null if no edge connects the
 * nodes in the current expanded graph for the relevant floor.
 *
 * The floor is derived from either node's floorIds (first entry).
 */
export function findWallContainingEdge(state, fromNodeId, toNodeId) {
  const fromNode = state.nodes?.[fromNodeId]
  if (!fromNode) return null
  const floorId = fromNode.floorIds?.[0] ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  const graph = getFloorWallPerimeterGraph(state, floorId)
  const edgeKey = graph.adjacency?.[fromNodeId]?.[toNodeId]
  if (!edgeKey) return null
  return graph.edges[edgeKey]?.wallId ?? null
}

/**
 * Phase W — look up the full edge record for a node pair.
 * Returns { id (edgeKey), wallId, segmentIndex, ..., lengthIn, lengthFt }
 * or null.
 */
export function findExpandedEdge(state, fromNodeId, toNodeId) {
  const fromNode = state.nodes?.[fromNodeId]
  if (!fromNode) return null
  const floorId = fromNode.floorIds?.[0] ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  const graph = getFloorWallPerimeterGraph(state, floorId)
  const edgeKey = graph.adjacency?.[fromNodeId]?.[toNodeId]
  if (!edgeKey) return null
  return graph.edges[edgeKey] ?? null
}

export function getFloorWallPerimeterGraph(state, floorId) {
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  const walls = state.walls
  const nodes = state.nodes
  const cell = _floorWallPerimeterCells.get(fid)
  if (cell && cell.walls === walls && cell.nodes === nodes) return cell.result
  const result = buildFloorWallPerimeterGraph(walls, nodes, fid)
  _floorWallPerimeterCells.set(fid, { walls, nodes, result })
  return result
}

// Room sub-graph — same node/edge shape, but restricted to the wallIds
// referenced by a specific room. Used by within-room electrical routing
// (switchboard → light/fan) and sprinkler branch coverage.
//
// Per-room memo cell keyed on (rooms, walls, nodes) references.

function buildRoomWallPerimeterGraph(room, walls, nodes) {
  const wallIdSet = new Set(room.wallIds ?? [])
  const graphNodes = {}
  const graphEdges = {}
  const adjacency = {}

  const roomWalls = []
  for (const wid of wallIdSet) {
    const w = walls[wid]
    if (!w || w.isVirtual) continue
    roomWalls.push(w)
  }
  roomWalls.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

  for (const w of roomWalls) {
    for (const nid of [w.n1, w.n2]) {
      const n = nodes[nid]
      if (!n) continue
      if (!graphNodes[nid]) graphNodes[nid] = { id: nid, x: n.x, y: n.y, edgeIds: [] }
    }
  }
  for (const nid of Object.keys(graphNodes)) adjacency[nid] = {}

  for (const w of roomWalls) {
    const a = graphNodes[w.n1]
    const b = graphNodes[w.n2]
    if (!a || !b) continue
    const lengthIn = Math.hypot(b.x - a.x, b.y - a.y)
    const lengthFt = lengthIn / 12
    graphEdges[w.id] = {
      id: w.id, wallId: w.id,
      fromNodeId: w.n1, toNodeId: w.n2,
      lengthIn, lengthFt,
    }
    a.edgeIds.push(w.id)
    b.edgeIds.push(w.id)
    adjacency[w.n1][w.n2] = w.id
    adjacency[w.n2][w.n1] = w.id
  }
  for (const n of Object.values(graphNodes)) n.edgeIds.sort()

  return { roomId: room.id, nodes: graphNodes, edges: graphEdges, adjacency }
}

export function getRoomWallPerimeterGraph(state, roomId) {
  const room = state.rooms[roomId]
  if (!room) return null
  const walls = state.walls
  const nodes = state.nodes
  const rooms = state.rooms
  const cell = _roomWallPerimeterCells.get(roomId)
  if (cell && cell.walls === walls && cell.nodes === nodes && cell.rooms === rooms) {
    return cell.result
  }
  const result = buildRoomWallPerimeterGraph(room, walls, nodes)
  _roomWallPerimeterCells.set(roomId, { walls, nodes, rooms, result })
  return result
}

// Ceiling-path graph. In Phase 1 the ceiling path geometry is identical
// to the wall perimeter (MEP runs along ceiling lines that follow walls
// from above), but the zone tag is 'CEILING' so quantity engines apply
// the ceiling multiplier. Same memoized graph, returned as a different
// shape so callers don't accidentally treat it as wall geometry.
export function getCeilingPaths(state, floorId) {
  const g = getFloorWallPerimeterGraph(state, floorId)
  return {
    floorId: g.floorId,
    nodes: g.nodes,
    edges: Object.fromEntries(
      Object.entries(g.edges).map(([k, e]) => [k, { ...e, zone: 'CEILING' }])
    ),
    adjacency: g.adjacency,
  }
}
