// syncEmitters.js — pure builders that turn editor entities into liveSync ops.
//
// Each builder returns { opType, payload } (or arrays) shaped for fireLiveOp,
// which performs the unit conversion + ifcGlobalId→ERP-id resolution at send
// time. Emitters NEVER touch the network or the store — they are pure functions
// of (state, entity). All ERP-enum/unit translation lives in syncMappers.
//
// Dependency rule encoded here: a room's batch emits NODE(new) → ROOM →
// WALL(new) / WALL_SURFACE(shared), in that order, so the sequential queue
// drains parent-before-child and the id-map threads automatically.

import * as M from './syncMappers.js'
import { ELEMENT_ENTRIES, ELEMENT_COLLECTIONS, entryForCollection } from './elementRegistry.js'

export { ELEMENT_ENTRIES, ELEMENT_COLLECTIONS }

// ── Single-entity op builders ────────────────────────────────────────────────

export function nodeAddOp(node) {
  return { opType: 'ADD_NODE', payload: { ifcGlobalId: node.ifcGlobalId, x: node.x, y: node.y, kind: node.kind ?? 'CORNER' } }
}
export function nodeUpdateOp(node) {
  return { opType: 'UPDATE_NODE', payload: { ifcGlobalId: node.ifcGlobalId, x: node.x, y: node.y, kind: node.kind ?? 'CORNER' } }
}
export function nodeDeleteOp(ifcGlobalId) {
  return { opType: 'DELETE_NODE', payload: { ifcGlobalId } }
}

// ── Floors ───────────────────────────────────────────────────────────────────
// Floors live in projectSettings.floors[] (NOT a synced store collection), so the
// sync engine special-cases them. The floor's editor `id` IS the floor identity
// used end-to-end: it is exactly room.floorId (the key ADD_ROOM resolves against),
// the `sourceEditorId` the ERP stores + round-trips, and the key c.floorIds /
// _idMap register + resolve under. The default floor's id is DEFAULT_FLOOR_ID
// ('F1'), matching the new-building F1 bootstrap in erpSession._buildFloorIdsMap.
// floorNumber is 1-based (editor sequence 0 → ERP floorNumber 1, same as bootstrap).
function _floorPayload(floor) {
  return {
    ifcGlobalId: floor.id,
    floorNumber: (floor.sequence ?? 0) + 1,
    floorHeight: floor.floorHeightFt ?? 10,
    ...(floor.floorLength !== undefined ? { floorLength: floor.floorLength } : {}),
    ...(floor.floorWidth !== undefined ? { floorWidth: floor.floorWidth } : {}),
  }
}
export function floorAddOp(floor) {
  return { opType: 'ADD_FLOOR', payload: _floorPayload(floor) }
}
export function floorUpdateOp(floor) {
  return { opType: 'UPDATE_FLOOR', payload: _floorPayload(floor) }
}
// Change signature over a floor's synced fields (excludes label/meta/underlay) —
// drives whether a mutated floor emits UPDATE_FLOOR.
export function floorSignature(floor) {
  return `${floor.sequence ?? 0},${floor.floorHeightFt ?? 10},${floor.floorLength ?? ''},${floor.floorWidth ?? ''}`
}

// roomShape is the only whitelisted shape enum we can assert; roomTypeCode is
// intentionally omitted (editor types ≠ taxonomy codes → would 422). The ERP
// defaults the room type to OTHER; staff set it there.
export function roomAddOp(room) {
  return { opType: 'ADD_ROOM', payload: { ifcGlobalId: room.ifcGlobalId, floorId: room.floorId ?? 'F1', roomShape: 'POLYGON' } }
}
export function roomDeleteOp(ifcGlobalId) {
  return { opType: 'DELETE_ROOM', payload: { ifcGlobalId } }
}

// Room polygon vertices (from the room's ordered node loop) → RoomVertex rows.
// Without these the ERP floor-plan viewer has no coordinates to place the room
// (roomRing() returns null) and shows it as "not placed". Emitted right after
// ADD_ROOM so the room exists when the vertices land.
export function roomVerticesOp(state, room) {
  const vertices = []
  ;(room.nodeOrder ?? []).forEach((nid, i) => {
    const n = state.nodes?.[nid]
    if (n) vertices.push({ x: n.x, y: n.y, sortOrder: i })
  })
  if (vertices.length < 3) return null
  return { opType: 'SAVE_ROOM_VERTICES', payload: { roomIfcId: room.ifcGlobalId, vertices } }
}

export function wallAddOp(state, wall, roomIfcId) {
  const n1 = state.nodes?.[wall.n1]
  const n2 = state.nodes?.[wall.n2]
  return {
    opType: 'ADD_WALL',
    payload: {
      ifcGlobalId: wall.ifcGlobalId,
      roomIfcId,
      n1IfcId: n1?.ifcGlobalId ?? null,
      n2IfcId: n2?.ifcGlobalId ?? null,
      lengthMm: M.edgeLengthMm(n1, n2),
      height: wall.height,
      thickness: wall.thickness,
      materialKey: M.wallMaterial(wall.materialKey),
      orientation: M.wallOrientation(n1, n2),
    },
  }
}
export function wallUpdateOp(state, wall) {
  const n1 = state.nodes?.[wall.n1]
  const n2 = state.nodes?.[wall.n2]
  return {
    opType: 'UPDATE_WALL',
    payload: {
      ifcGlobalId: wall.ifcGlobalId,
      height: wall.height,
      thickness: wall.thickness,
      materialKey: M.wallMaterial(wall.materialKey),
      orientation: M.wallOrientation(n1, n2),
      lengthMm: M.edgeLengthMm(n1, n2),
    },
  }
}
export function wallDeleteOp(ifcGlobalId) {
  return { opType: 'DELETE_WALL', payload: { ifcGlobalId } }
}

// Shared wall: the wall already exists (owned by another room); add a second
// WallSurface for this room via the adjacent-surface route.
export function adjacentSurfaceOp(wall, room) {
  return { opType: 'ADD_WALL_SURFACE', payload: { wallIfcId: wall.ifcGlobalId, roomIfcId: room.ifcGlobalId } }
}

export function openingAddOp(wall, opening) {
  return {
    opType: 'ADD_OPENING',
    payload: {
      wallIfcId: wall.ifcGlobalId,
      ifcGlobalId: opening.ifcGlobalId,
      type: M.openingType(opening.type, opening.subtype),
      width: opening.width,
      height: opening.height,
      offset: opening.offset,
    },
  }
}
export function openingDeleteOp(ifcGlobalId) {
  return { opType: 'DELETE_OPENING', payload: { ifcGlobalId } }
}

// ── Structural elements ──────────────────────────────────────────────────────

// ── Elements (registry-driven — NO per-kind branches here) ───────────────────
// All element kinds go through the generic ADD/UPDATE_ELEMENT op; the registry
// entry owns the field+coordinate mapping and supplies `erpKind`.
export function elementAddOp(state, entry, el) {
  return { opType: entry.erpOpType, payload: { ...entry.toErpPayload(el, state), kind: entry.erpKind } }
}
export function elementUpdateOp(state, entry, el) {
  // UPDATE body is SHAPE-only — must NOT carry `kind` (not whitelisted by PATCH).
  return { opType: 'UPDATE_ELEMENT', payload: entry.toErpPayload(el, state) }
}
export function elementDeleteOp(ifcGlobalId) {
  return { opType: 'DELETE_ELEMENT', payload: { ifcGlobalId } }
}

// ── Per-collection change signature (excludes volatile labelNo/meta) ─────────
// Element collections sign on their full toErpPayload (the synced fields).
export function signature(collection, e) {
  if (collection === 'nodes') return `${e.x},${e.y},${e.kind ?? 'CORNER'}`
  if (collection === 'walls') {
    const ops = (e.openings ?? []).map((o) => `${o.ifcGlobalId}:${o.type}:${o.width}:${o.height}:${o.offset}`).join('|')
    return `${e.n1},${e.n2},${e.height},${e.thickness},${e.materialKey}#${ops}`
  }
  if (collection === 'rooms') return (e.wallIds ?? []).slice().sort().join(',')
  const entry = entryForCollection(collection)
  if (entry) return JSON.stringify(entry.toErpPayload(e, _SIG_STATE))
  return JSON.stringify(e)
}
// Signature is a pure change-detector; toErpPayload only reads state for slab
// roomIds / beam endpoints, irrelevant to detecting a moved element → empty state.
const _SIG_STATE = {}

// ── Full re-sync (resyncAll) — rebuild every op from current state ────────────
// Order: nodes → rooms → walls → elements. Idempotent via sourceEditorId.
export function buildFullSyncOps(state) {
  const ops = []
  // Floors FIRST — a room's POST targets /geometry/floors/:id/rooms, so the floor
  // must exist (and be id-mapped) before any room ADD.
  for (const f of (state.projectSettings?.floors ?? [])) ops.push(floorAddOp(f))
  for (const n of Object.values(state.nodes ?? {})) ops.push(nodeAddOp(n))
  for (const r of Object.values(state.rooms ?? {})) {
    ops.push(roomAddOp(r))
    const v = roomVerticesOp(state, r)
    if (v) ops.push(v)
  }
  const wallRoom = _wallOwnerRoom(state)
  for (const w of Object.values(state.walls ?? {})) {
    const room = wallRoom.get(w.id)
    if (!room) continue // standalone walls have no ERP home
    ops.push(wallAddOp(state, w, room.ifcGlobalId))
    for (const o of (w.openings ?? [])) ops.push(openingAddOp(w, o))
  }
  for (const entry of ELEMENT_ENTRIES) {
    for (const el of Object.values(state[entry.collection] ?? {})) ops.push(elementAddOp(state, entry, el))
  }
  return ops
}

// First room (by insertion) that lists a wall is its owner; later rooms get an
// adjacent WallSurface.
export function _wallOwnerRoom(state) {
  const owner = new Map()
  for (const room of Object.values(state.rooms ?? {})) {
    for (const wid of (room.wallIds ?? [])) if (!owner.has(wid)) owner.set(wid, room)
  }
  return owner
}
