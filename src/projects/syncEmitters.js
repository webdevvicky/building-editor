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
import { getWallSurfaces } from '../topology/surfaces.js'

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
// The editor owns a floor's place in the stack, its height and its plinth (feet);
// the floor's length/width, name and label are staff-authored in the ERP and never
// sent. A floor has no per-room height in the editor: a room's height is its
// walls' height (BuildingWall.heightMm), so BuildingRoom.height is not sent.
function _floorPayload(floor) {
  return {
    ifcGlobalId: floor.id,
    floorNumber: (floor.sequence ?? 0) + 1,
    floorHeight: floor.floorHeightFt ?? 10,
    ...(typeof floor.plinthHeightFt === 'number' ? { plinthHeight: floor.plinthHeightFt } : {}),
  }
}
export function floorAddOp(floor) {
  return { opType: 'ADD_FLOOR', payload: _floorPayload(floor) }
}
export function floorUpdateOp(floor) {
  return { opType: 'UPDATE_FLOOR', payload: _floorPayload(floor) }
}
// A floor removed mid-session. ifcGlobalId is the floor's editor id (== the
// c.floorIds / _idMap key ADD_FLOOR registered under), so the dispatch resolves a
// real floorErpId. Ordered LAST in the ops array (after child deletes) so the
// floor row is dropped only AFTER its rooms/walls/openings are gone.
export function floorDeleteOp(floor) {
  return { opType: 'DELETE_FLOOR', payload: { ifcGlobalId: floor.id } }
}
// Change signature over a floor's synced fields (excludes label/meta/underlay) —
// drives whether a mutated floor emits UPDATE_FLOOR.
export function floorSignature(floor) {
  return `${floor.sequence ?? 0},${floor.floorHeightFt ?? 10},${floor.plinthHeightFt ?? ''}`
}

// The editor is the source of truth for room type (a physical classification):
// `room.roomTypeCode` is a canonical RoomTypeCode the editor fetched from the ERP
// taxonomy, so it syncs VERBATIM (no mapping). Omitted only if unauthored (the ERP
// then defaults to OTHER); the editor makes it mandatory before sync. The idempotent
// ADD/replay updates the ERP room type only when a code is present (never clobbers).
export function roomAddOp(room) {
  return { opType: 'ADD_ROOM', payload: { ifcGlobalId: room.ifcGlobalId, floorId: room.floorId ?? 'F1', roomShape: 'POLYGON', ...(room.roomTypeCode ? { roomTypeCode: room.roomTypeCode } : {}), ...(room.name ? { name: room.name } : {}) } }
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

// A wall goes under the room that owns it (`roomIfcId`), or — when no room owns it —
// on its floor (XR-11); the ERP gives it faces once a room it bounds is added.
export function wallAddOp(state, wall, roomIfcId) {
  const n1 = state.nodes?.[wall.n1]
  const n2 = state.nodes?.[wall.n2]
  // A wall is a perimeter (exterior) wall when one of its two faces is open to
  // outside (owned by no room). The ERP uses this to author a WALL_EXTERIOR surface
  // for the owner room — the source-of-truth for elevation work.
  const surf = getWallSurfaces(state, wall.id)
  const isExterior = !!surf && (surf.faceA.roomId === null || surf.faceB.roomId === null)
  return {
    opType: 'ADD_WALL',
    payload: {
      ifcGlobalId: wall.ifcGlobalId,
      ...(roomIfcId ? { roomIfcId } : { floorId: wall.floorId ?? 'F1' }),
      n1IfcId: n1?.ifcGlobalId ?? null,
      n2IfcId: n2?.ifcGlobalId ?? null,
      lengthMm: M.edgeLengthMm(n1, n2),
      height: wall.height,
      thickness: wall.thickness,
      materialKey: M.wallMaterial(wall.materialKey),
      orientation: M.wallOrientation(n1, n2),
      isExterior: roomIfcId ? isExterior : false,
    },
  }
}
// A wall's shape changed (its nodes, height, thickness or material): ONE op.
export function wallUpdateOp(state, wall) {
  const n1 = state.nodes?.[wall.n1]
  const n2 = state.nodes?.[wall.n2]
  return {
    opType: 'UPDATE_WALL',
    payload: {
      ifcGlobalId: wall.ifcGlobalId,
      n1IfcId: n1?.ifcGlobalId ?? null,
      n2IfcId: n2?.ifcGlobalId ?? null,
      height: wall.height,
      thickness: wall.thickness,
      materialKey: M.wallMaterial(wall.materialKey),
      orientation: M.wallOrientation(n1, n2),
      lengthMm: M.edgeLengthMm(n1, n2),
    },
  }
}
// The change signature of a wall's own shape (openings are diffed one by one).
export function wallShapeSignature(wall) {
  return `${wall.n1},${wall.n2},${wall.height},${wall.thickness},${wall.materialKey}`
}
export function wallDeleteOp(ifcGlobalId) {
  return { opType: 'DELETE_WALL', payload: { ifcGlobalId } }
}

// The full shape of a wall written by a split or join (same fields as ADD_WALL).
function _wallSpec(state, wall) {
  const n1 = state.nodes?.[wall.n1]
  const n2 = state.nodes?.[wall.n2]
  return {
    n1IfcId: n1?.ifcGlobalId ?? null,
    n2IfcId: n2?.ifcGlobalId ?? null,
    lengthMm: M.edgeLengthMm(n1, n2),
    height: wall.height,
    thickness: wall.thickness,
    materialKey: M.wallMaterial(wall.materialKey),
    orientation: M.wallOrientation(n1, n2),
  }
}

// The rooms a wall really bounds, by editor id. `room.wallIds` names whole walls,
// and after a split every affected room lists BOTH pieces even when its boundary
// runs along only one (a T-junction room). So a listed room counts only when the
// wall's midpoint lies on the room's polygon (its nodeOrder ring).
const ON_EDGE_IN = 1
function _onSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y) <= ON_EDGE_IN
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  if (t < 0 || t > 1) return false
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y) <= ON_EDGE_IN
}
export function roomsBoundingWall(state, wall) {
  const a = state.nodes?.[wall.n1]
  const b = state.nodes?.[wall.n2]
  if (!a || !b) return []
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const out = []
  for (const room of Object.values(state.rooms ?? {})) {
    if (!(room.wallIds ?? []).includes(wall.id)) continue
    const ring = (room.nodeOrder ?? []).map((nid) => state.nodes?.[nid]).filter(Boolean)
    const onRing = ring.length >= 3 && ring.some((p, i) => _onSegment(mid, p, ring[(i + 1) % ring.length]))
    if (onRing) out.push(room.ifcGlobalId)
  }
  return out
}

// The editor's Split tool cut `wall` into `pieces` (in order along the wall). The
// ERP moves each face of the old wall to the piece that bounds its room (XR-08).
export function splitWallOp(state, wall, pieces) {
  return {
    opType: 'SPLIT_WALL',
    payload: {
      ifcGlobalId: wall.ifcGlobalId,
      newWalls: pieces.map((w) => ({
        ifcGlobalId: w.ifcGlobalId,
        ..._wallSpec(state, w),
        roomIfcIds: roomsBoundingWall(state, w),
      })),
    },
  }
}

// Walls merged into `merged` — the Join tool's survivor (one of `sources`) or a
// wall an undo brought back over the pieces it was split into.
export function joinWallsOp(state, merged, sources) {
  return {
    opType: 'JOIN_WALLS',
    payload: {
      mergedIfcGlobalId: merged.ifcGlobalId,
      wallIfcIds: sources.map((w) => w.ifcGlobalId),
      ..._wallSpec(state, merged),
    },
  }
}

// Shared wall: the wall already exists (owned by another room); add a second
// WallSurface for this room via the adjacent-surface route.
export function adjacentSurfaceOp(wall, room) {
  return { opType: 'ADD_WALL_SURFACE', payload: { wallIfcId: wall.ifcGlobalId, roomIfcId: room.ifcGlobalId } }
}

// ── Openings ─────────────────────────────────────────────────────────────────
// Each editor opening is ONE physical door or window (count 1). Its sill height
// (heightFromFloor, inches above the floor): a door stands on the floor (0); a
// window carries the sill the user set (`sillHeight`) — omitted while unset, so the
// ERP keeps whatever it holds (absent is not null).
function _sillOf(opening) {
  if (opening.type === 'door') return 0
  return typeof opening.sillHeight === 'number' ? opening.sillHeight : undefined
}
function _openingShape(opening) {
  const sill = _sillOf(opening)
  return {
    width: opening.width,
    height: opening.height,
    offset: opening.offset,
    ...(sill !== undefined ? { heightFromFloor: sill } : {}),
    count: 1,
  }
}
// ADD names the wall the opening is on NOW: the ERP moves a live opening that the
// editor carried onto another wall (split / join), and sets its type.
export function openingAddOp(wall, opening) {
  return {
    opType: 'ADD_OPENING',
    payload: {
      wallIfcId: wall.ifcGlobalId,
      ifcGlobalId: opening.ifcGlobalId,
      type: M.openingType(opening.type, opening.subtype),
      ..._openingShape(opening),
    },
  }
}
// A resize / move along the wall / sill change of an opening that stays on its wall
// and keeps its type (XR-17). The PATCH carries shape only; a type change re-sends
// the ADD (the ERP's type-setting path, as for a room type).
export function openingUpdateOp(opening) {
  return { opType: 'UPDATE_OPENING', payload: { ifcGlobalId: opening.ifcGlobalId, ..._openingShape(opening) } }
}
export function openingDeleteOp(ifcGlobalId) {
  return { opType: 'DELETE_OPENING', payload: { ifcGlobalId } }
}
export function openingTypeSignature(opening) {
  return M.openingType(opening.type, opening.subtype)
}
export function openingShapeSignature(opening) {
  const o = _openingShape(opening)
  return `${o.width},${o.height},${o.offset},${o.heightFromFloor ?? ''}`
}

// ── Structural elements ──────────────────────────────────────────────────────

// ── Elements (registry-driven — NO per-kind branches here) ───────────────────
// All element kinds go through the generic ADD/UPDATE_ELEMENT op; the registry
// entry owns the field+coordinate mapping and supplies `erpKind`.
export function elementAddOp(state, entry, el) {
  // The element's EDITOR floor id (columns span floors via baseFloorId; every
  // other kind carries a single floorId). Lives ONLY on the ADD payload (resolved
  // to BuildingElement.floorId at send time) — NOT in toErpPayload, so it never
  // leaks into the SHAPE-only UPDATE body or the change signature. Omitted (never
  // null) if an element genuinely has no floor.
  const floorId = el.baseFloorId ?? el.floorId ?? null
  return { opType: entry.erpOpType, payload: { ...entry.toErpPayload(el, state), kind: entry.erpKind, ...(floorId ? { floorId } : {}) } }
}
export function elementUpdateOp(state, entry, el) {
  // UPDATE body is SHAPE-only — must NOT carry `kind` (not whitelisted by PATCH).
  return { opType: 'UPDATE_ELEMENT', payload: entry.toErpPayload(el, state) }
}
export function elementDeleteOp(ifcGlobalId) {
  return { opType: 'DELETE_ELEMENT', payload: { ifcGlobalId } }
}

// ── Per-collection change signature (excludes volatile labelNo/meta) ─────────
// Nodes sign on position + kind. Element collections sign on their full
// toErpPayload (the synced fields) read against the state the element belongs to,
// so a change that lives in the state — a slab's rooms, a beam's endpoints — is a
// change (KD-37). The caller passes the previous state for the previous element.
export function signature(collection, e, state = {}) {
  if (collection === 'nodes') return `${e.x},${e.y},${e.kind ?? 'CORNER'}`
  const entry = entryForCollection(collection)
  if (entry) return JSON.stringify(entry.toErpPayload(e, state))
  return JSON.stringify(e)
}

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
    ops.push(wallAddOp(state, w, wallRoom.get(w.id)?.ifcGlobalId ?? null))
    for (const o of (w.openings ?? [])) ops.push(openingAddOp(w, o))
  }
  // Shared walls: the second room's face, exactly as the live engine emits it — without
  // it a resynced projection would not know the wall bounds that room (G17).
  for (const r of Object.values(state.rooms ?? {})) {
    for (const wid of (r.wallIds ?? [])) {
      const owner = wallRoom.get(wid)
      if (owner && owner.id !== r.id && state.walls?.[wid]) ops.push(adjacentSurfaceOp(state.walls[wid], r))
    }
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
