// Fire device placement helpers.
//
// All pure — return suggested (x, y, wallId, wallT, ...) tuples that the
// caller can pass to addFireDevice. Never mutate state.
//
//   - placeFireAlarmPanel(state, floorId): mounts the panel near the floor's
//     service-entry (external-accessible door wall) — same heuristic as
//     placeDefaultDb. Visible from outside per NBC 2016.
//   - placeSprinklerHeadsForRoom(state, roomId): uniform grid of head
//     positions sized to the catalog's coverageAreaFt2 (130 ft² per head).
//     One head per cell, placed at cell centers, clipped to the room
//     polygon.
//   - placeManualCallPoint(state, floorId): at the staircase exit (room
//     of type STAIRCASE) or at the ENTRY room as a fallback. Mount on the
//     room's longest interior wall at the device's catalog mount height.

import {
  getExternalAccessibleWalls,
  getNearestWallToPoint,
  getWallIdsOnFloor,
  getRoomCentroid,
  getRoomPolygon,
  getRoomArea,
  getRoomSurfaces,
  getRoomsOnFloor,
} from '../../topology/index.js'
import { getFireDevice } from '../catalogs/fireDevices.js'
import { pointInPolygon } from '../../geometry.js'

const DEFAULT_FLOOR_ID = 'F1'

// Inches per foot — single conversion.
const IN_PER_FT = 12

function _projectAlongSurface(surface, t) {
  if (!surface || !surface.a || !surface.b) return null
  return {
    x: surface.a.x + (surface.b.x - surface.a.x) * t,
    y: surface.a.y + (surface.b.y - surface.a.y) * t,
  }
}

function _findLongestInteriorSurface(state, roomId) {
  const surfaces = getRoomSurfaces(state, roomId) ?? []
  let best = null
  for (const s of surfaces) {
    if (!s) continue
    if (s.otherRoomId == null) continue   // interior preferred
    if (!best ||
        s.lengthIn > best.lengthIn ||
        (s.lengthIn === best.lengthIn && s.wallId < best.wallId)) {
      best = s
    }
  }
  if (!best) {
    for (const s of surfaces) {
      if (!s) continue
      if (!best ||
          s.lengthIn > best.lengthIn ||
          (s.lengthIn === best.lengthIn && s.wallId < best.wallId)) {
        best = s
      }
    }
  }
  return best
}

// ─────────────────────────────────────────────────────────────────────────
// Fire alarm panel — service-entry placement
// ─────────────────────────────────────────────────────────────────────────

export function placeFireAlarmPanel(state, floorId) {
  if (!state) return null
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  const cat = getFireDevice('FIRE_ALARM_PANEL')

  // Centroid of every fire device on this floor — fall back to centroid
  // of every room on the floor if there are no devices yet.
  const devices = Object.values(state.fireDevices ?? {})
    .filter(d => d && (d.floorId ?? DEFAULT_FLOOR_ID) === fid)

  let cx, cy
  if (devices.length > 0) {
    cx = 0; cy = 0
    for (const d of devices) { cx += d.x; cy += d.y }
    cx /= devices.length; cy /= devices.length
  } else {
    const rooms = getRoomsOnFloor(state, fid) ?? []
    if (rooms.length === 0) return null
    cx = 0; cy = 0; let n = 0
    for (const r of rooms) {
      const c = getRoomCentroid(state, r.id)
      if (!c) continue
      cx += c.x; cy += c.y; n++
    }
    if (n === 0) return null
    cx /= n; cy /= n
  }

  // Prefer external-with-door walls (service entry); fall back to any wall.
  const externalAccessible = getExternalAccessibleWalls(state, fid)
  let candidateIds
  if (externalAccessible.length > 0) {
    candidateIds = new Set(externalAccessible.map(w => w.id))
  } else {
    candidateIds = getWallIdsOnFloor(state, fid)
    if (!candidateIds || (candidateIds instanceof Set && candidateIds.size === 0)) {
      return null
    }
  }

  const snap = getNearestWallToPoint(state, { x: cx, y: cy }, candidateIds)
  if (!snap) return null

  return {
    x: snap.projected.x,
    y: snap.projected.y,
    wallId: snap.wallId,
    wallT: snap.t,
    mountHeightFt: cat?.mountHeightFt ?? null,
    floorId: fid,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Sprinkler heads — uniform grid across the room polygon
// ─────────────────────────────────────────────────────────────────────────

export function placeSprinklerHeadsForRoom(state, roomId) {
  if (!state || !roomId) return []
  const room = state.rooms?.[roomId]
  if (!room) return []
  const cat = getFireDevice('SPRINKLER_HEAD')
  const coverageFt2 = cat?.coverageAreaFt2
  if (!coverageFt2 || coverageFt2 <= 0) return []

  const areaFt2 = getRoomArea(state, roomId)
  if (areaFt2 <= 0) return []

  const poly = getRoomPolygon(state, roomId)
  if (!poly || poly.length < 3) return []

  // Square spacing derived from coverage area — head spacing ft = √coverage.
  const spacingFt = Math.sqrt(coverageFt2)
  const spacingIn = spacingFt * IN_PER_FT

  // Polygon bounding box (inches — storage units).
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of poly) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const widthIn  = maxX - minX
  const heightIn = maxY - minY
  if (widthIn <= 0 || heightIn <= 0) return []

  // Number of heads along each axis: ceil(dim / spacing). Always at least 1.
  const cols = Math.max(1, Math.ceil(widthIn  / spacingIn))
  const rows = Math.max(1, Math.ceil(heightIn / spacingIn))

  // Place at the CENTER of each cell — symmetric inset by half a cell.
  const cellW = widthIn  / cols
  const cellH = heightIn / rows

  const out = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = minX + (c + 0.5) * cellW
      const y = minY + (r + 0.5) * cellH
      if (!pointInPolygon(x, y, poly)) continue
      out.push({
        x, y,
        wallId: null, wallT: null,
        mountHeightFt: cat.mountHeightFt ?? null,
        roomId,
        floorId: room.floorId ?? DEFAULT_FLOOR_ID,
        gridIndex: r * cols + c,
      })
    }
  }

  // Deterministic order — already in (row, col) order; explicit sort for
  // future-proofing.
  out.sort((a, b) => a.gridIndex - b.gridIndex)
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// Manual call point — at staircase / entry
// ─────────────────────────────────────────────────────────────────────────

export function placeManualCallPoint(state, floorId) {
  if (!state) return null
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  const cat = getFireDevice('MANUAL_CALL_POINT')

  const rooms = getRoomsOnFloor(state, fid) ?? []
  if (rooms.length === 0) return null

  // Prefer STAIRCASE → ENTRY → any. Deterministic tie-break by id.
  const priorityTypes = ['STAIRCASE', 'ENTRY']
  let target = null
  for (const t of priorityTypes) {
    const matches = rooms.filter(r => r.type === t)
      .sort((a, b) => a.id < b.id ? -1 : 1)
    if (matches.length > 0) { target = matches[0]; break }
  }
  if (!target) {
    // Fall back to the largest room on the floor (deterministic tie by id).
    const sized = rooms.map(r => ({ r, area: getRoomArea(state, r.id) }))
      .sort((a, b) => b.area - a.area || (a.r.id < b.r.id ? -1 : 1))
    target = sized[0]?.r ?? null
  }
  if (!target) return null

  const surface = _findLongestInteriorSurface(state, target.id)
  if (!surface) {
    const c = getRoomCentroid(state, target.id)
    return c ? {
      x: c.x, y: c.y,
      wallId: null, wallT: null,
      mountHeightFt: cat?.mountHeightFt ?? null,
      roomId: target.id,
      floorId: fid,
    } : null
  }
  const t = 0.5
  const proj = _projectAlongSurface(surface, t)
  if (!proj) return null
  return {
    x: proj.x,
    y: proj.y,
    wallId: surface.wallId,
    wallT: t,
    mountHeightFt: cat?.mountHeightFt ?? null,
    roomId: target.id,
    floorId: fid,
  }
}
