// ELV device placement helpers.
//
// All pure — return suggested (x, y, wallId, wallT, ...) tuples that the
// caller can pass to addElvDevice. Never mutate state.
//
//   - placeElvRack(state, floorId): centralizes the ELV rack near the
//     service-entry external-accessible wall (same heuristic as the main
//     DB / fire alarm panel — the rack sits beside incoming utility risers).
//   - placeCctvCamera(state, externalCornerNodeId): mounts an outdoor
//     camera at an external corner node, at the catalog mount height.
//     Caller picks which external corner (the suggestions engine offers
//     centroid-of-external-wall as a fallback).

import {
  getExternalAccessibleWalls,
  getNearestWallToPoint,
  getWallIdsOnFloor,
  getRoomCentroid,
  getRoomsOnFloor,
  getExternalWallIds,
} from '../../topology/index.js'
import { getElvDevice } from '../catalogs/elvDevices.js'

const DEFAULT_FLOOR_ID = 'F1'

// ─────────────────────────────────────────────────────────────────────────
// ELV equipment rack — service-entry placement (same heuristic as DB)
// ─────────────────────────────────────────────────────────────────────────

export function placeElvRack(state, floorId) {
  if (!state) return null
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  const cat = getElvDevice('ELV_RACK')

  // Centroid of every ELV device on this floor — fall back to centroid
  // of every room on the floor if there are no devices yet.
  const devices = Object.values(state.elvDevices ?? {})
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

  // Prefer external-with-door walls (service entry — incoming ISP /
  // fibre / CCTV cable lands here); fall back to any wall.
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
// CCTV camera — mount at an external corner (Phase 1 — caller supplies
// the externalCornerNodeId).
// ─────────────────────────────────────────────────────────────────────────

export function placeCctvCamera(state, externalCornerNodeId) {
  if (!state || !externalCornerNodeId) return null
  const node = state.nodes?.[externalCornerNodeId]
  if (!node) return null
  const cat = getElvDevice('CCTV_CAMERA')

  // Determine the floor of the corner node (length-1 floorIds is the
  // current schema; we read the first id).
  const floorIds = Array.isArray(node.floorIds) ? node.floorIds : []
  const floorId = floorIds[0] ?? state.currentFloorId ?? DEFAULT_FLOOR_ID

  // Confirm at least one external wall touches this node — otherwise
  // it's an interior corner and we refuse to place outside on it.
  const externalIds = getExternalWallIds(state)
  let wallId = null
  for (const w of Object.values(state.walls ?? {})) {
    if (!w) continue
    if (!externalIds.has(w.id)) continue
    if (w.aNodeId !== externalCornerNodeId && w.bNodeId !== externalCornerNodeId) continue
    if (!wallId || w.id < wallId) wallId = w.id     // deterministic tie-break
  }
  if (!wallId) return null

  return {
    x: node.x,
    y: node.y,
    wallId,
    wallT: null,             // corner-mounted — not along a wall span
    mountHeightFt: cat?.mountHeightFt ?? null,
    floorId,
    nodeId: externalCornerNodeId,
  }
}
