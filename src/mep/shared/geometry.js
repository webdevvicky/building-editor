// MEP shared geometry — composes src/geometry.js (pure math) + topology
// (relationship layer). Discipline-specific network builders consume these.
//
// NOT to be confused with src/geometry.js. This module never duplicates
// pure-math helpers; it routes through them.

import {
  closestPointOnSegment,
  pointInPolygon,
} from '../../geometry.js'
import {
  getFloorWallPerimeterGraph,
  getRoomPolygon,
  getWallsOnFloor,
  // MAIN-THREAD-built; assumed to exist at runtime in topology/index.js.
  // getNearestWallToPoint resolves a (state, point, candidateWallIds?) →
  // { wallId, projected, distance, t } | null lookup.
  getNearestWallToPoint,
} from '../../topology/index.js'
import { fnv1aHash } from './systemGraph.js'

// ── Wall snapping ───────────────────────────────────────────────────────────

// Snap a free point onto the nearest wall. Delegates to topology's
// getNearestWallToPoint which knows the floor-scoped candidate set and the
// projection math. We re-export under the MEP-conventional name so discipline
// callers have a single import surface.
export function snapPointToNearestWall(state, point, candidateWallIds) {
  return getNearestWallToPoint(state, point, candidateWallIds) ?? null
}

// ── Wall-perimeter BFS routing ──────────────────────────────────────────────
//
// Deterministic shortest-edge-count path along the wall-perimeter graph.
// Neighbor iteration is sorted (by adjacent node id) so two runs over the
// same graph always emit the same polyline.

export function walkWallPerimeter(graph, fromNodeId, toNodeId) {
  if (!graph || !graph.nodes || !graph.adjacency) return null
  if (!graph.nodes[fromNodeId] || !graph.nodes[toNodeId]) return null
  if (fromNodeId === toNodeId) {
    const n = graph.nodes[fromNodeId]
    return [{ x: n.x, y: n.y }]
  }

  // BFS, deterministic neighbor order.
  const parent = new Map()
  parent.set(fromNodeId, null)
  const queue = [fromNodeId]
  let found = false
  while (queue.length) {
    const cur = queue.shift()
    if (cur === toNodeId) { found = true; break }
    const adj = graph.adjacency[cur] ?? {}
    const neighbors = Object.keys(adj).sort()
    for (const nid of neighbors) {
      if (parent.has(nid)) continue
      parent.set(nid, cur)
      queue.push(nid)
    }
  }
  if (!found) return null

  // Reconstruct path
  const idPath = []
  for (let cur = toNodeId; cur != null; cur = parent.get(cur)) {
    idPath.push(cur)
  }
  idPath.reverse()
  return idPath.map(id => {
    const n = graph.nodes[id]
    return { x: n.x, y: n.y }
  })
}

// ── Douglas–Peucker simplification ──────────────────────────────────────────

function _perpDistance(p, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  const projX = a.x + t * dx
  const projY = a.y + t * dy
  return Math.hypot(p.x - projX, p.y - projY)
}

function _dpRecurse(points, start, end, epsilon, keep) {
  let maxD = 0
  let maxIdx = -1
  const a = points[start]
  const b = points[end]
  for (let i = start + 1; i < end; i++) {
    const d = _perpDistance(points[i], a, b)
    if (d > maxD) { maxD = d; maxIdx = i }
  }
  if (maxD > epsilon && maxIdx !== -1) {
    _dpRecurse(points, start, maxIdx, epsilon, keep)
    _dpRecurse(points, maxIdx, end, epsilon, keep)
  } else {
    keep.add(end)
  }
}

export function simplifyPolyline(points, epsilonIn = 2) {
  if (!Array.isArray(points) || points.length <= 2) return [...(points ?? [])]
  const keep = new Set([0])
  _dpRecurse(points, 0, points.length - 1, epsilonIn, keep)
  return [...keep].sort((a, b) => a - b).map(i => points[i])
}

// ── Route stability hash ────────────────────────────────────────────────────
//
// Used by verify-mep.mjs: hash before/after a no-op operation must match.

function _polylineHashStr(points) {
  // Round to nearest 0.001 inch — sub-thou drift from float math should
  // not flip the hash, but real geometric changes should.
  return points
    .map(p => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`)
    .join(';')
}

export function routeStableHash(routes) {
  if (!Array.isArray(routes)) return fnv1aHash('')
  const parts = []
  for (const r of routes) {
    if (!r) continue
    const size = r.diameterMm != null ? `d${r.diameterMm}` : `g${r.gaugeMm2 ?? ''}`
    const zones = Array.isArray(r.zonesPerSegment) ? r.zonesPerSegment.join('/') : ''
    const poly = _polylineHashStr(r.polyline ?? [])
    parts.push(`${r.id}|${size}|${zones}|${poly}`)
  }
  parts.sort()
  return fnv1aHash(parts.join('\n'))
}

// ── Polyline metrics ────────────────────────────────────────────────────────

export function polylineLengthFt(points) {
  if (!Array.isArray(points) || points.length < 2) return 0
  let totalIn = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    totalIn += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return totalIn / 12
}

// ── Zone transitions ────────────────────────────────────────────────────────
//
// fittingCounter uses this to count elbows at wall→ceiling, ceiling→shaft
// transitions, etc. Inputs: polyline of N points, zone array of length N-1.

export function classifyZoneTransitions(polyline, zonePerSegment) {
  const transitions = []
  if (!Array.isArray(polyline) || polyline.length < 3) return { transitions }
  if (!Array.isArray(zonePerSegment) || zonePerSegment.length !== polyline.length - 1) {
    return { transitions }
  }
  for (let i = 1; i < zonePerSegment.length; i++) {
    const fromZone = zonePerSegment[i - 1]
    const toZone = zonePerSegment[i]
    if (fromZone !== toZone) {
      transitions.push({ at: polyline[i], fromZone, toZone })
    }
  }
  return { transitions }
}

// ── Room containment ────────────────────────────────────────────────────────

export function pointInRoom(state, x, y, floorId) {
  const fid = floorId ?? state.currentFloorId ?? 'F1'
  // Deterministic iteration order: sort room ids.
  const roomIds = Object.keys(state.rooms ?? {}).sort()
  for (const rid of roomIds) {
    const room = state.rooms[rid]
    if (!room) continue
    if ((room.floorId ?? 'F1') !== fid) continue
    const poly = getRoomPolygon(state, rid)
    if (!poly || poly.length < 3) continue
    if (pointInPolygon(x, y, poly)) return rid
  }
  return null
}

// ── Wall centerline projection ──────────────────────────────────────────────

export function projectToWallCenterline(wallStart, wallEnd, point) {
  return closestPointOnSegment(
    point.x, point.y,
    wallStart.x, wallStart.y,
    wallEnd.x, wallEnd.y,
  )
}

// Internal — exposed so other shared modules (e.g. risers.js, suggestions.js)
// don't re-import from src/topology/index.js separately.
export { getFloorWallPerimeterGraph, getWallsOnFloor }
