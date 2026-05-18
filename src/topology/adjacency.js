// Topology — room adjacency graph.
//
// Two rooms are "adjacent" if they share at least one wall. They are
// "connected" if they share a wall AND that wall has at least one door
// opening. Used by MEP duct routing, drainage-stack siting, and the
// corridor/passage-discovery step in interior layout engines.

import { createMemo } from './cache.js'
import { getWallToRoomsIndex } from './walls.js'

const _adjacencyMemo   = createMemo()
const _connectivityMemo = createMemo()

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
