// Topology — wall-surface ownership.
//
// A wall has two faces. Each face is owned by at most one room, or open to
// outside. Face identity is established by probing each room's centroid
// relative to the wall's perpendicular: the room whose centroid lies on the
// "left" side of n1→n2 owns faceA; the "right" side owns faceB.
//
// This API is what prevents interior-paint, exterior-paint, tiling, MEP
// switch-placement, and electrical-conduit engines from each guessing the
// face↔room mapping. Returns null faces for openings to outside.

import { createMemo } from './cache.js'
import { getWallToRoomsIndex } from './walls.js'
import { getRoomPolygon, getRoomArea } from './rooms.js'

const _surfacesMemo = createMemo()

// Builds the full wall-surface index once per {walls, rooms, nodes}. Returned
// as { [wallId]: WallSurfaceInfo }.
function buildSurfacesIndex(state) {
  const { walls, rooms, nodes } = state
  return _surfacesMemo([walls, rooms, nodes], () => {
    const wallToRooms = getWallToRoomsIndex(state)
    const out = {}
    for (const wall of Object.values(walls)) {
      const n1 = nodes[wall.n1], n2 = nodes[wall.n2]
      if (!n1 || !n2) {
        out[wall.id] = {
          wallId: wall.id,
          faceA: { roomId: null, normal: { x: 0, y: 0 }, side: 'left' },
          faceB: { roomId: null, normal: { x: 0, y: 0 }, side: 'right' },
        }
        continue
      }
      // Wall direction vector
      const dx = n2.x - n1.x, dy = n2.y - n1.y
      const len = Math.hypot(dx, dy) || 1
      // Perpendicular pointing to the LEFT (rotate +90°): (-dy, dx)/len
      const leftN  = { x: -dy / len, y:  dx / len }
      const rightN = { x:  dy / len, y: -dx / len }

      const ownersOfWall = wallToRooms[wall.id] ?? []
      let leftRoom = null, rightRoom = null
      for (const room of ownersOfWall) {
        const c = roomCentroid(state, room.id)
        if (!c) continue
        // Midpoint of the wall
        const mx = (n1.x + n2.x) / 2, my = (n1.y + n2.y) / 2
        // Sign of cross product (n2-n1) × (centroid - midpoint)
        const cross = dx * (c.y - my) - dy * (c.x - mx)
        if (cross > 0) leftRoom = room
        else if (cross < 0) rightRoom = room
        // cross === 0 (centroid on wall line) — ambiguous; skip silently
      }
      out[wall.id] = {
        wallId: wall.id,
        faceA: { roomId: leftRoom?.id  ?? null, normal: leftN,  side: 'left'  },
        faceB: { roomId: rightRoom?.id ?? null, normal: rightN, side: 'right' },
      }
    }
    return out
  })
}

function roomCentroid(state, roomId) {
  const poly = getRoomPolygon(state, roomId)
  if (!poly || poly.length === 0) return null
  let cx = 0, cy = 0
  for (const p of poly) { cx += p.x; cy += p.y }
  return { x: cx / poly.length, y: cy / poly.length }
}

// ── Public APIs ─────────────────────────────────────────────────────────────

export function getWallSurfaces(state, wallId) {
  return buildSurfacesIndex(state)[wallId] ?? null
}

// Returns the inward-facing surfaces of a room: every wall that bounds the
// room, with the face that points INTO the room marked.
export function getRoomSurfaces(state, roomId) {
  const room = state.rooms[roomId]
  if (!room) return []
  const idx = buildSurfacesIndex(state)
  const out = []
  for (const wid of (room.wallIds ?? [])) {
    const info = idx[wid]
    if (!info) continue
    const inwardFace = info.faceA.roomId === roomId ? 'A'
                    : info.faceB.roomId === roomId ? 'B'
                    : null
    if (!inwardFace) continue
    const face = inwardFace === 'A' ? info.faceA : info.faceB
    const wall = state.walls[wid]
    out.push({
      wallId: wid,
      face: inwardFace,
      normal: face.normal,
      lengthFt: state.getWallLength?.(wid) ?? 0,
      heightFt: (wall.height ?? 120) / 12,
      openings: wall.openings ?? [],
    })
  }
  return out
}

// Returns the external (outside-facing) faces — face that points to no room.
// Optionally scoped to a floor's walls. The "wall, face, normal" triple is
// what façade / external-paint / cladding engines consume.
export function getExteriorFaces(state, floorId) {
  const idx = buildSurfacesIndex(state)
  const out = []
  for (const info of Object.values(idx)) {
    const wall = state.walls[info.wallId]
    if (!wall) continue
    if (floorId && (wall.floorId ?? 'F1') !== floorId) continue
    if (wall.isVirtual) continue
    if (info.faceA.roomId === null) {
      out.push({ wallId: info.wallId, face: 'A', normal: info.faceA.normal, lengthFt: state.getWallLength?.(info.wallId) ?? 0 })
    }
    if (info.faceB.roomId === null) {
      out.push({ wallId: info.wallId, face: 'B', normal: info.faceB.normal, lengthFt: state.getWallLength?.(info.wallId) ?? 0 })
    }
  }
  return out
}

// Inward face area (ft²) of a room, summed across all walls that bound it
// (gross — does NOT subtract openings; callers gate on opening totals
// separately via topology/openings.js if needed).
export function getInteriorFaceArea(state, roomId) {
  const surfaces = getRoomSurfaces(state, roomId)
  let total = 0
  for (const s of surfaces) total += s.lengthFt * s.heightFt
  return Math.round(total * 100) / 100
}
