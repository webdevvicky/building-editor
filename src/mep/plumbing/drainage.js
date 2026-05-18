// Plumbing drainage helpers — soil-stack discovery + auto-location heuristic.
//
// All deterministic; sort comparators are explicit.

import {
  getRoomsForWall,
  getWallAdjacencyCount,
  getRoomsOnFloor,
} from '../../topology/index.js'
import { RISER_KINDS } from '../shared/risers.js'

const DEFAULT_FLOOR_ID = 'F1'

// Drainage gradients (rise/run) per IS 1742 / NBC 2016 — soil 1:80, waste 1:40.
const DRAIN_GRADIENTS = Object.freeze({
  SOIL:  1 / 80,
  WASTE: 1 / 40,
})

export function getDrainGradient(systemType) {
  if (systemType === 'SOIL_DRAIN' || systemType === 'SOIL') return DRAIN_GRADIENTS.SOIL
  if (systemType === 'WASTE' || systemType === 'WASTE_DRAIN') return DRAIN_GRADIENTS.WASTE
  // Default to soil — conservative (gentler slope, longer pipe headroom).
  return DRAIN_GRADIENTS.SOIL
}

// Find the soil-stack riser nearest to a fixture. Returns riserId | null.
// Phase 1: nearest by Euclidean distance among SOIL_STACK risers that
// span the fixture's floor. Sort tie-break by riser id.
export function findNearestSoilStack(state, fixtureId) {
  const fx = state.plumbingFixtures?.[fixtureId]
  if (!fx) return null
  const floorId = fx.floorId ?? DEFAULT_FLOOR_ID
  const risers = state.risers ?? {}
  const candidates = []
  for (const r of Object.values(risers)) {
    if (!r || r.kind !== RISER_KINDS.SOIL_STACK) continue
    // Crude spans-floor check: from/to floor inclusive.
    if (r.fromFloorId !== floorId && r.toFloorId !== floorId) continue
    candidates.push(r)
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => {
    const da = Math.hypot((a.x ?? 0) - fx.x, (a.y ?? 0) - fx.y)
    const db = Math.hypot((b.x ?? 0) - fx.x, (b.y ?? 0) - fx.y)
    if (da !== db) return da - db
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return candidates[0].id
}

// Infer a default location for a logical soil stack inside a wet room.
//
// Heuristic (deterministic): pick the room's longest external wall; place
// the stack at the corner farthest from that wall's midpoint. If no
// external wall exists, fall back to the longest wall overall.
//
// Returns { x, y, wallId } | null
export function inferSoilStackLocation(state, wetRoomId) {
  const room = state.rooms?.[wetRoomId]
  if (!room || !room.wallIds || room.wallIds.length === 0) return null
  const adj = getWallAdjacencyCount(state)
  const walls = state.walls ?? {}
  const nodes = state.nodes ?? {}

  // Sort: external first, then lengthFt desc, then wallId asc.
  const candidates = []
  for (const wid of room.wallIds) {
    const w = walls[wid]
    if (!w || w.isVirtual) continue
    const a = nodes[w.n1], b = nodes[w.n2]
    if (!a || !b) continue
    const lenFt = Math.hypot(b.x - a.x, b.y - a.y) / 12
    const isExternal = (adj[wid] ?? 0) === 1
    candidates.push({ wallId: wid, lenFt, isExternal, a, b })
  }
  if (candidates.length === 0) return null
  candidates.sort((p, q) => {
    if (p.isExternal !== q.isExternal) return p.isExternal ? -1 : 1
    if (p.lenFt !== q.lenFt) return q.lenFt - p.lenFt
    return p.wallId < q.wallId ? -1 : p.wallId > q.wallId ? 1 : 0
  })
  const pick = candidates[0]
  // Place the stack at the lower-id endpoint of the picked wall — deterministic.
  const endpoint = pick.a // wall is from n1 → n2; n1 is the canonical first node
  return { x: endpoint.x, y: endpoint.y, wallId: pick.wallId }
}

// Convenience: returns the wet rooms on a floor that border the given wall.
// Used during routing when a fixture has no explicit wallId.
export function getWetRoomsBorderingWall(state, wallId) {
  const rooms = getRoomsForWall(state, wallId)
  return rooms.filter(r => ['TOILET', 'KITCHEN', 'UTILITY', 'BATHROOM'].includes(r.type))
}

// Helper used by routing — enumerates wet rooms on a floor in deterministic order.
export function getWetRoomsOnFloor(state, floorId) {
  const rooms = getRoomsOnFloor(state, floorId)
  return rooms
    .filter(r => ['TOILET', 'KITCHEN', 'UTILITY', 'BATHROOM'].includes(r.type))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
