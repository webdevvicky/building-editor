// liveSync.js — REST middleware for live ERP sync (Phase E)
// Lives behind a liveMode flag; blob sync (cloudSync.js) continues unchanged.

const IN_TO_MM = 25.4
function inToMm(v) { return Math.round(v * IN_TO_MM) }

import { engageEditorReadOnly } from './editorWriteGuard.js'

let _liveMode = false
let _conn = null
const _idMap = new Map()

// Row versions (ERP id → `version`) of the rooms and walls this session knows, for the
// version-checked shape PATCH (CONC-27: the ERP refuses a room/wall shape change without
// the version it was made against). Seeded from GET /state and refreshed from every
// room/wall response, so the version sent is always the one this editor last saw. A 409
// means someone else changed the row since: the editor latches read-only and reloads —
// it never re-sends on the newer version.
const _versionMap = new Map()

const VERSION_CLASH_MESSAGE =
  'Someone else changed this design while you were editing, so your change was not saved over theirs. ' +
  'Editing is paused — reload to open the newer version.'

function _noteVersion(res) {
  const row = res?.data ?? res
  if (row?.id && typeof row.version === 'number') _versionMap.set(row.id, row.version)
}

function _statusOf(err) {
  const m = String(err?.message ?? '').match(/→ (\d{3}):/)
  return m ? Number(m[1]) : null
}

// A shape PATCH carries the row version this editor last saw; without one it is not sent
// (permanent `→ 400:` — never a last-write-wins write).
function _requireVersion(opType, erpId) {
  const version = _versionMap.get(erpId)
  if (typeof version === 'number') return version
  throw new Error(`[liveSync] ${opType} → 400: no known row version for ${erpId} — refusing an unchecked shape change.`)
}

async function _versionedPatch(path, body, c) {
  try {
    const res = await _request('PATCH', path, body, c)
    _noteVersion(res)
    return res
  } catch (err) {
    if (_statusOf(err) === 409) engageEditorReadOnly(VERSION_CLASH_MESSAGE)
    throw err
  }
}

// A PATCH/DELETE whose target id never resolved must NOT reach the wire as `/null`:
// one such op is rejected by the backend and its failure lands on the status badge.
// Skipping is safe — the canonical document is the source of truth and Resync-all
// reconciles the projection.
function _skipUnresolved(kind, editorId) {
  console.warn(`[liveSync] ${kind} with unresolved server id — skipped`, editorId)
  return { ok: true, noop: true }
}

// The LAST line of defence before an id reaches a URL. Ordering is the real
// mechanism (see opDependency + liveSyncQueue's dependency gate); this exists so
// that a call site added later cannot silently interpolate `null` into a path —
// `/geometry/walls/null/openings` reached the ERP as the literal string "null"
// and came back 500. Thrown with the `→ 400:` shape the queue reads as PERMANENT,
// because no retry can invent an id that was never assigned.
function _requireId(opType, fieldName, erpId, editorId) {
  if (erpId) return erpId
  throw new Error(
    `[liveSync] ${opType} ${fieldName} → 400: unresolved server id for editor id "${editorId ?? '(none)'}" — refusing to request a /null path.`,
  )
}

// ─── Op dependency table (the ONE declaration of parent-before-child) ─────────
//
// The queue is FIFO and drains one op at a time, so a child normally follows its
// parent naturally. That guarantee lapses the moment a parent op stops being
// dispatchable (it failed, or it belongs to an earlier session whose id map is
// gone), and the child then resolves its parent to null. This table is what lets
// the queue SEE that edge instead of discovering it on the wire:
//
//   parents  — the editor ids this op must have resolved before it can be sent.
//              `one(idField, kind, erpField)` names a single id; `erpField` is the
//              escape hatch (a payload that already carries the resolved server id
//              has no dependency). `many(idsField, kind)` names a LIST of ids (a
//              slab's rooms, the walls a join merges): every one must resolve — an
//              unresolved id never silently drops out of the list (XR-09).
//   produces — the editor ids this op registers server ids for when it succeeds.
//   destroys — the editor ids this op removes, so a child waiting on one can be
//              dropped instead of waiting for ever.
const one = (idField, kind, erpField) => ({
  kind, field: idField,
  pick: (p) => (erpField && p[erpField]) || !p[idField] ? [] : [p[idField]],
})
const many = (idsField, kind) => ({
  kind, field: idsField,
  pick: (p) => (Array.isArray(p[idsField]) ? p[idsField].filter(Boolean) : []),
})
const ownId = (p) => (p.ifcGlobalId ? [p.ifcGlobalId] : [])

const WALL_PARENT = one('wallIfcId', 'wall', 'wallErpId')
const ROOM_PARENT = one('roomIfcId', 'room', 'roomErpId')
const FLOOR_PARENT = one('floorId', 'floor', 'floorErpId')
const SELF_WALL = one('ifcGlobalId', 'wall', 'wallErpId')
const ROOMS_PARENT = many('roomIds', 'room')

const OP_DEPENDENCY = {
  ADD_WALL: { parents: [ROOM_PARENT, FLOOR_PARENT], produces: ownId },
  UPDATE_WALL: { parents: [SELF_WALL] },
  SPLIT_WALL: {
    parents: [
      SELF_WALL,
      { kind: 'room', field: 'newWalls[].roomIfcIds', pick: (p) => (p.newWalls ?? []).flatMap((w) => w.roomIfcIds ?? []) },
    ],
    produces: (p) => (p.newWalls ?? []).map((w) => w.ifcGlobalId).filter(Boolean),
    destroys: ['ifcGlobalId'],
  },
  JOIN_WALLS: {
    parents: [many('wallIfcIds', 'wall')],
    produces: (p) => (p.mergedIfcGlobalId ? [p.mergedIfcGlobalId] : []),
  },
  ADD_OPENING: { parents: [WALL_PARENT], produces: ownId },
  UPDATE_OPENING: { parents: [one('ifcGlobalId', 'opening', 'openingErpId')] },
  ADD_WALL_SURFACE: { parents: [WALL_PARENT, ROOM_PARENT] },
  SAVE_ROOM_VERTICES: { parents: [ROOM_PARENT] },

  ADD_FLOOR: { produces: ownId },
  UPDATE_FLOOR: { parents: [one('ifcGlobalId', 'floor', 'floorErpId')] },
  ADD_ROOM: { produces: ownId },
  ADD_NODE: { produces: ownId },
  ADD_ELEMENT: { parents: [ROOM_PARENT, FLOOR_PARENT, ROOMS_PARENT], produces: ownId },
  UPDATE_ELEMENT: { parents: [ROOMS_PARENT] },

  DELETE_WALL: { destroys: ['ifcGlobalId', 'id'] },
  DELETE_ROOM: { destroys: ['ifcGlobalId'] },
  DELETE_FLOOR: { destroys: ['ifcGlobalId'] },
  DELETE_NODE: { destroys: ['ifcGlobalId'] },
  DELETE_OPENING: { destroys: ['ifcGlobalId'] },
  DELETE_ELEMENT: { destroys: ['ifcGlobalId'] },
}

/**
 * What this op needs before it can be sent, and what it will provide.
 *
 * @returns {{ needs: Array<{editorId: string, field: string, kind: string}>,
 *             produces: string[], destroys: string[] }}
 */
export function opDependency(opType, payload = {}) {
  const spec = OP_DEPENDENCY[opType]
  if (!spec) return { needs: [], produces: [], destroys: [] }

  const needs = []
  for (const parent of spec.parents ?? []) {
    for (const editorId of parent.pick(payload)) needs.push({ editorId, field: parent.field, kind: parent.kind })
  }

  const destroys = []
  for (const f of spec.destroys ?? []) {
    if (payload[f]) destroys.push(payload[f])
  }

  return { needs, produces: spec.produces ? spec.produces(payload) : [], destroys }
}


// ─── Public API ───────────────────────────────────────────────────────────────

export function getLiveMode() { return _liveMode }
export function getLiveConn() { return _conn }

export function initLiveSync(conn) {
  console.log('[LIVE] initLiveSync called with:', conn)
  // Defensive: ALWAYS start a live-sync session from a clean slate. _idMap is
  // module-scoped and otherwise survives across project/building/tab/launch
  // switches, leaking another building's floor/room ids into this session
  // (cross-building write → backend 403). Never rely on teardownLiveSync()
  // having run between launches.
  _idMap.clear()
  _versionMap.clear()
  _conn = conn
  _liveMode = true
  console.log('[LIVE] _liveMode set to true')
}

export function teardownLiveSync() {
  _conn = null
  _liveMode = false
  _idMap.clear()
  _versionMap.clear()
}

/** The row version this session last saw for an ERP room/wall id (test seam + diagnostics). */
export function knownRowVersion(erpId) {
  return _versionMap.get(erpId)
}

export function registerErpId(editorIfcId, erpId) {
  _idMap.set(editorIfcId, erpId)
}

export function resolveErpId(editorIfcId, conn) {
  return _resolveId(editorIfcId, conn)
}

export const GEOMETRY_OPS = [
  'ADD_WALL', 'UPDATE_WALL', 'DELETE_WALL',
  'SPLIT_WALL', 'JOIN_WALLS',
  'ADD_OPENING', 'UPDATE_OPENING', 'DELETE_OPENING',
  'ADD_FLOOR', 'UPDATE_FLOOR', 'DELETE_FLOOR',
  'ADD_ROOM', 'UPDATE_ROOM', 'DELETE_ROOM', 'SAVE_ROOM_VERTICES',
  'ADD_NODE', 'UPDATE_NODE', 'DELETE_NODE',
  'ADD_ELEMENT', 'UPDATE_ELEMENT', 'DELETE_ELEMENT',
]

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function _request(method, path, body, conn) {
  const c = conn ?? _conn
  if (c.drawingLineage?.wire) {
    ({ method, path, body } = c.drawingLineage.wire)
  } else if (c.drawingLineage?.saveWire) {
    await c.drawingLineage.saveWire({ method, path, body })
  }
  const token = await c.getToken()
  const url = `${c.erpUrl.replace(/\/$/, '')}/api/v1${path}`
  const res = await fetch(url, {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...(c.drawingLineage ? { 'x-drawing-checkpoint': c.drawingLineage.checkpointId, 'x-drawing-mutation': c.drawingLineage.mutationId } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`[liveSync] ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

// Editor id → ERP id. Floors are keyed by their editor floor id ('F1', 'F2', …) in
// THIS connection's per-building `floorIds` map (seeded at launch, extended by
// ADD_FLOOR); everything else by its ifcGlobalId in the id map. The two key
// spaces never collide (a floor id is never a 22-char IFC GUID).
function _resolveId(ifcId, conn) {
  if (!ifcId) return null
  const c = conn ?? _conn
  if (c?.resolveErpId) return c.resolveErpId(ifcId)
  return _idMap.get(ifcId) ?? c?.floorIds?.[ifcId] ?? null
}

function _registerId(ifcId, erpId, conn) {
  if (conn?.registerErpId) { conn.registerErpId(ifcId, erpId); return }
  _idMap.set(ifcId, erpId)
}

function _extractErpId(res) {
  return res?.data?.id ?? res?.id ?? null
}

// The ONE rule for what a successful response registers: the server id of every
// editor id the op `produces` (opDependency) and the row version of every room or
// wall it returns. Used by the live dispatch and by a replayed request alike.
function _registerProduced(opType, payload, res, c) {
  const body = res?.data ?? res
  if (opType === 'SPLIT_WALL') {
    for (const w of body?.walls ?? []) {
      if (w?.sourceEditorId && w?.id) _registerId(w.sourceEditorId, w.id, c)
      _noteVersion(w)
    }
    return
  }
  if (opType === 'JOIN_WALLS') {
    const merged = body?.wall
    if (merged?.id && payload.mergedIfcGlobalId) _registerId(payload.mergedIfcGlobalId, merged.id, c)
    _noteVersion(merged)
    return
  }
  _noteVersion(res)
  const erpId = _extractErpId(res)
  if (!erpId || !payload.ifcGlobalId || !opDependency(opType, payload).produces.includes(payload.ifcGlobalId)) return
  _registerId(payload.ifcGlobalId, erpId, c)
  if (opType === 'ADD_FLOOR') { c.floorIds = c.floorIds ?? {}; c.floorIds[payload.ifcGlobalId] = erpId }
}

// Floor ids are BUILDING-SCOPED. A room MUST resolve its floor only from THIS
// connection's per-building floorIds map (seeded at launch by _buildFloorIdsMap
// / ADD_FLOOR). It must NEVER fall back to the global _idMap — that map can hold
// another building's floor id and a cross-building write is rejected by the
// backend EditorSessionGuard (403). If the current building has no mapped floor
// for this key, create it under the CURRENT building (idempotent by
// sourceEditorId server-side) and cache it; fail loudly if that is impossible.
async function _ensureFloorErpId(floorKey, c) {
  const key = floorKey ?? 'F1'
  const existing = c?.floorIds?.[key]
  if (existing) return existing
  if (!c?.buildingId) {
    throw new Error(`[liveSync] ADD_ROOM: no building bound on the connection; cannot resolve floor "${key}". Refusing to guess a floor id across buildings.`)
  }
  console.warn(`[liveSync] ADD_ROOM: floor "${key}" not in this building's floorIds map — creating it under building ${c.buildingId} and retrying.`)
  const res = await _request(
    'POST', `/geometry/buildings/${c.buildingId}/floors`,
    { floorNumber: 1, sourceEditorId: key, floorHeight: 10 }, c,
  )
  const erpId = _extractErpId(res)
  if (!erpId) {
    throw new Error(`[liveSync] ADD_ROOM: failed to create floor "${key}" for building ${c.buildingId}; got no id back.`)
  }
  c.floorIds = c.floorIds ?? {}
  c.floorIds[key] = erpId
  return erpId
}

// Map editor room ifcGlobalIds → ERP room UUIDs. EVERY id must resolve: a list
// with a room silently missing would tell the ERP the element covers fewer rooms
// than it does (XR-09). The dependency gate makes the op wait for its rooms; this
// is the backstop, thrown as a permanent `→ 400:` (no retry can invent the id).
function _resolveRoomIds(opType, roomIfcIds, conn) {
  if (!Array.isArray(roomIfcIds)) return []
  return roomIfcIds.map((ifc) => _requireId(opType, 'roomIds', _resolveId(ifc, conn), ifc))
}

// The ONE element body. ADD_ELEMENT and UPDATE_ELEMENT send the same shape — the
// registry's `toErpPayload` (sizes, grades, bars, room, point type, spec) — and the
// ERP create and patch element DTOs accept the same fields (XR-03). Editor room ids
// are resolved here for both: a slab's `roomIds` as ERP room uuids (XR-09); a point's
// `roomIfcId` stays an editor id, which the ERP writer resolves. Identity (`ifcGlobalId`,
// `elementErpId`), `kind` and the floor are ADD-only and never part of a patch.
function _elementBody(opType, payload, c) {
  // eslint-disable-next-line no-unused-vars -- identity, kind and floor are stripped from the shape
  const { ifcGlobalId, elementErpId, kind, floorId, roomIds, ...shape } = payload
  return roomIds === undefined ? shape : { ...shape, roomIds: _resolveRoomIds(opType, roomIds, c) }
}

// ─── Main dispatch ────────────────────────────────────────────────────────────

export async function fireLiveOp(opType, payload, conn) {
  const c = conn ?? _conn
  if (!c) throw new Error('[liveSync] fireLiveOp: no conn available')

  if (c.drawingLineage?.wire) {
    const { method, path, body } = c.drawingLineage.wire
    const replay = await _request(method, path, body, c)
    _registerProduced(opType, payload, replay, c)
    return replay
  }
  let res
  switch (opType) {

    // ── Walls ────────────────────────────────────────────────────────────────
    // A wall a room owns goes under that room (the ERP adds the room's faces); a wall
    // that bounds no room goes on its floor (XR-11) and gets faces when a room it
    // bounds is added (the engine then re-sends it under that room).
    case 'ADD_WALL': {
      const path = payload.roomIfcId || payload.roomErpId
        ? `/geometry/rooms/${_requireId('ADD_WALL', 'roomId', payload.roomErpId ?? _resolveId(payload.roomIfcId, c), payload.roomIfcId)}/walls`
        : `/geometry/floors/${_requireId('ADD_WALL', 'floorId', payload.floorErpId ?? _resolveId(payload.floorId, c), payload.floorId)}/walls`
      res = await _request('POST', path, {
        sourceEditorId: payload.ifcGlobalId,
        wallMaterial: payload.materialKey ?? null,
        orientation: payload.orientation ?? 'INTERNAL',
        lengthMm: payload.lengthMm ?? 0,
        heightMm: inToMm(payload.height ?? 120),
        thicknessMm: inToMm(payload.thickness ?? 9),
        n1NodeId: payload.n1IfcId ? _resolveId(payload.n1IfcId, c) : null,
        n2NodeId: payload.n2IfcId ? _resolveId(payload.n2IfcId, c) : null,
        // Perimeter flag → the ERP gives the owner room a WALL_EXTERIOR surface too,
        // so elevation work anchors correctly and interior-only rooms emit no exterior.
        isExterior: payload.isExterior ?? false,
      }, c)
      _registerProduced(opType, payload, res, c)
      break
    }

    case 'UPDATE_WALL': {
      const wallErpId = payload.wallErpId ?? _resolveId(payload.ifcGlobalId ?? payload.id, c)
      if (!wallErpId) { res = _skipUnresolved('UPDATE_WALL', payload.ifcGlobalId ?? payload.id); break }
      const body = {}
      if (payload.materialKey !== undefined) body.wallMaterial = payload.materialKey
      if (payload.height !== undefined) body.heightMm = inToMm(payload.height)
      if (payload.thickness !== undefined) body.thicknessMm = inToMm(payload.thickness)
      if (payload.orientation !== undefined) body.orientation = payload.orientation
      if (payload.angleDeg !== undefined) body.angleDeg = payload.angleDeg
      if (payload.lengthMm !== undefined) body.lengthMm = payload.lengthMm
      if (payload.n1IfcId) { const id = _resolveId(payload.n1IfcId, c); if (id) body.n1NodeId = id }
      if (payload.n2IfcId) { const id = _resolveId(payload.n2IfcId, c); if (id) body.n2NodeId = id }
      body.version = _requireVersion(opType, wallErpId)
      res = await _versionedPatch(`/geometry/walls/${wallErpId}`, body, c)
      break
    }

    case 'DELETE_WALL': {
      const wallErpId = payload.wallErpId ?? _resolveId(payload.ifcGlobalId ?? payload.id, c)
      // Unresolved id → no projection row exists to delete: a delete of a
      // non-existent row is a successful no-op (never request /geometry/.../null).
      if (!wallErpId) { res = { ok: true, noop: true }; break }
      res = await _request('DELETE', `/geometry/walls/${wallErpId}`, undefined, c)
      break
    }

    // The editor cut a wall into pieces. Each piece names the rooms it bounds, so
    // the ERP gives each face of the old wall to the piece it lies on (XR-08).
    case 'SPLIT_WALL': {
      const wallErpId = _requireId('SPLIT_WALL', 'wallId',
        payload.wallErpId ?? _resolveId(payload.ifcGlobalId, c), payload.ifcGlobalId)
      const body = {
        newWalls: (payload.newWalls ?? []).map(w => ({
          sourceEditorId: w.ifcGlobalId,
          lengthMm: w.lengthMm ?? 0,
          heightMm: inToMm(w.height ?? 120),
          thicknessMm: inToMm(w.thickness ?? 9),
          orientation: w.orientation ?? 'INTERNAL',
          ...(w.materialKey ? { wallMaterial: w.materialKey } : {}),
          ...(w.n1IfcId && _resolveId(w.n1IfcId, c) ? { n1NodeId: _resolveId(w.n1IfcId, c) } : {}),
          ...(w.n2IfcId && _resolveId(w.n2IfcId, c) ? { n2NodeId: _resolveId(w.n2IfcId, c) } : {}),
          roomIds: _resolveRoomIds('SPLIT_WALL', w.roomIfcIds ?? [], c),
        })),
      }
      res = await _request('POST', `/geometry/walls/${wallErpId}/split`, body, c)
      _registerProduced(opType, payload, res, c)
      break
    }

    // The editor merged walls into one (its Join survivor, or an undo of a split).
    // Every wall must resolve — a join of fewer walls than the editor merged would
    // leave one standing in the ERP.
    case 'JOIN_WALLS': {
      const body = {
        wallIds: (payload.wallIfcIds ?? []).map(ifc => _requireId('JOIN_WALLS', 'wallIds', _resolveId(ifc, c), ifc)),
        merged: {
          sourceEditorId: payload.mergedIfcGlobalId,
          lengthMm: payload.lengthMm ?? 0,
          heightMm: inToMm(payload.height ?? 120),
          thicknessMm: inToMm(payload.thickness ?? 9),
          orientation: payload.orientation ?? 'INTERNAL',
          ...(payload.materialKey ? { wallMaterial: payload.materialKey } : {}),
          ...(payload.n1IfcId && _resolveId(payload.n1IfcId, c) ? { n1NodeId: _resolveId(payload.n1IfcId, c) } : {}),
          ...(payload.n2IfcId && _resolveId(payload.n2IfcId, c) ? { n2NodeId: _resolveId(payload.n2IfcId, c) } : {}),
        },
      }
      res = await _request('POST', `/geometry/walls/join`, body, c)
      _registerProduced(opType, payload, res, c)
      break
    }

    // ── Openings ──────────────────────────────────────────────────────────────
    case 'ADD_OPENING': {
      const wallErpId = _requireId('ADD_OPENING', 'wallId',
        payload.wallErpId ?? _resolveId(payload.wallIfcId, c), payload.wallIfcId)
      const body = {
        ...(payload.ifcGlobalId ? { sourceEditorId: payload.ifcGlobalId } : {}),
        openingType: payload.type ?? 'WINDOW',
        widthMm: inToMm(payload.width ?? 36),
        heightMm: inToMm(payload.height ?? 48),
        ...(payload.offset !== undefined ? { offsetFromStartMm: inToMm(payload.offset) } : {}),
        ...(payload.heightFromFloor !== undefined ? { heightFromFloorMm: inToMm(payload.heightFromFloor) } : {}),
        ...(payload.count !== undefined ? { count: payload.count } : {}),
      }
      res = await _request('POST', `/geometry/walls/${wallErpId}/openings`, body, c)
      _registerProduced(opType, payload, res, c)
      break
    }

    case 'UPDATE_OPENING': {
      const openingErpId = payload.openingErpId ?? _resolveId(payload.ifcGlobalId, c)
      if (!openingErpId) { res = _skipUnresolved('UPDATE_OPENING', payload.ifcGlobalId); break }
      const body = {}
      if (payload.width !== undefined) body.widthMm = inToMm(payload.width)
      if (payload.height !== undefined) body.heightMm = inToMm(payload.height)
      if (payload.offset !== undefined) body.offsetFromStartMm = inToMm(payload.offset)
      if (payload.heightFromFloor !== undefined) body.heightFromFloorMm = inToMm(payload.heightFromFloor)
      if (payload.count !== undefined) body.count = payload.count
      res = await _request('PATCH', `/geometry/openings/${openingErpId}`, body, c)
      break
    }

    case 'DELETE_OPENING': {
      const openingErpId = payload.openingErpId ?? _resolveId(payload.ifcGlobalId, c)
      // Unresolved id → no projection row exists to delete: a delete of a
      // non-existent row is a successful no-op (never request /geometry/.../null).
      if (!openingErpId) { res = { ok: true, noop: true }; break }
      res = await _request('DELETE', `/geometry/openings/${openingErpId}`, undefined, c)
      break
    }

    // ── Floors ──────────────────────────────────────────────────────────────
    // A floor created mid-session (editor addFloor → projectSettings.floors[])
    // must reach the ERP before any room is placed on it. payload.ifcGlobalId is
    // the floor's editor id (== room.floorId == the c.floorIds key), so the room
    // that follows resolves a real floorErpId. The returned id is registered in
    // BOTH _idMap and c.floorIds (the primary ADD_ROOM lookup, which is the SAME
    // conn object the new-building F1 bootstrap seeds).
    case 'ADD_FLOOR': {
      const body = {
        floorNumber: payload.floorNumber ?? 1,
        sourceEditorId: payload.ifcGlobalId,
        ...(payload.floorHeight !== undefined ? { floorHeight: payload.floorHeight } : {}),
        ...(payload.plinthHeight !== undefined ? { plinthHeight: payload.plinthHeight } : {}),
      }
      res = await _request('POST', `/geometry/buildings/${c.buildingId}/floors`, body, c)
      _registerProduced(opType, payload, res, c)
      break
    }

    // A floor the editor changed (height, plinth, its place in the stack): PATCH
    // THE row (XR-12) — never a create replay.
    case 'UPDATE_FLOOR': {
      const floorErpId = _requireId('UPDATE_FLOOR', 'floorId',
        payload.floorErpId ?? _resolveId(payload.ifcGlobalId, c), payload.ifcGlobalId)
      const body = {
        ...(payload.floorNumber !== undefined ? { floorNumber: payload.floorNumber } : {}),
        ...(payload.floorHeight !== undefined ? { floorHeight: payload.floorHeight } : {}),
        ...(payload.plinthHeight !== undefined ? { plinthHeight: payload.plinthHeight } : {}),
      }
      res = await _request('PATCH', `/geometry/floors/${floorErpId}`, body, c)
      break
    }

    // A floor removed mid-session. payload.ifcGlobalId is the floor's editor id
    // (the c.floorIds / _idMap key ADD_FLOOR registered under). Emitted AFTER its
    // child room/wall/opening deletes, so the cascade order satisfies the FK.
    case 'DELETE_FLOOR': {
      const floorErpId = payload.floorErpId ?? c?.floorIds?.[payload.ifcGlobalId] ?? _resolveId(payload.ifcGlobalId, c)
      // Unresolved id → no projection row exists to delete: a delete of a
      // non-existent row is a successful no-op (never request /geometry/.../null).
      if (!floorErpId) { res = { ok: true, noop: true }; break }
      res = await _request('DELETE', `/geometry/floors/${floorErpId}`, undefined, c)
      break
    }

    // ── Rooms ─────────────────────────────────────────────────────────────────
    case 'ADD_ROOM': {
      // Building-scoped only — never resolve a floor through the global _idMap
      // (cross-building reuse). Missing → create under THIS building and retry.
      const floorErpId = payload.floorErpId ?? await _ensureFloorErpId(payload.floorId ?? 'F1', c)
      const body = {
        sourceEditorId: payload.ifcGlobalId,
        ...(payload.roomTypeCode ? { roomTypeCode: payload.roomTypeCode } : {}),
        ...(payload.length !== undefined ? { length: payload.length } : {}),
        ...(payload.width !== undefined ? { width: payload.width } : {}),
        ...(payload.height !== undefined ? { height: payload.height } : {}),
        ...(payload.posXMm !== undefined ? { posXMm: payload.posXMm } : {}),
        ...(payload.posYMm !== undefined ? { posYMm: payload.posYMm } : {}),
        roomShape: payload.roomShape ?? 'POLYGON',
        ...(payload.name ? { name: payload.name } : {}),
        ...(payload.computedAreaSqft !== undefined ? { computedAreaSqft: payload.computedAreaSqft } : {}),
      }
      res = await _request('POST', `/geometry/floors/${floorErpId}/rooms`, body, c)
      _registerProduced(opType, payload, res, c)
      break
    }

    case 'UPDATE_ROOM': {
      const roomErpId = payload.roomErpId ?? _resolveId(payload.ifcGlobalId, c)
      if (!roomErpId) { res = _skipUnresolved('UPDATE_ROOM', payload.ifcGlobalId); break }
      const body = { ...payload }
      delete body.ifcGlobalId
      delete body.roomErpId
      body.version = _requireVersion(opType, roomErpId)
      res = await _versionedPatch(`/geometry/rooms/${roomErpId}`, body, c)
      break
    }

    case 'DELETE_ROOM': {
      const roomErpId = payload.roomErpId ?? _resolveId(payload.ifcGlobalId, c)
      // Unresolved id → no projection row exists to delete: a delete of a
      // non-existent row is a successful no-op (never request /geometry/.../null).
      if (!roomErpId) { res = { ok: true, noop: true }; break }
      res = await _request('DELETE', `/geometry/rooms/${roomErpId}`, undefined, c)
      break
    }

    case 'SAVE_ROOM_VERTICES': {
      const roomErpId = payload.roomErpId ?? _resolveId(payload.roomIfcId, c)
      // Defensive (mirrors DELETE_ROOM): an unresolved room id means the room's
      // ADD_ROOM never succeeded. Do NOT POST to /geometry/rooms/null/vertices —
      // that hits the backend with an invalid UUID and cascades into a 500. No-op,
      // but log loudly so the REAL upstream failure (the failed ADD_ROOM) stays
      // visible rather than being masked.
      if (!roomErpId) {
        console.error(`[liveSync] SAVE_ROOM_VERTICES: unresolved room id for "${payload.roomIfcId}" — skipping (its ADD_ROOM did not succeed).`)
        res = { ok: true, noop: true }
        break
      }
      const body = {
        vertices: (payload.vertices ?? []).map((v, i) => ({
          xMm: inToMm(v.x ?? 0),
          yMm: inToMm(v.y ?? 0),
          sortOrder: v.sortOrder ?? i,
        })),
      }
      res = await _request('POST', `/geometry/rooms/${roomErpId}/vertices`, body, c)
      break
    }

    // ── Nodes ─────────────────────────────────────────────────────────────────
    case 'ADD_NODE': {
      const buildingId = c?.buildingId
      const body = {
        sourceEditorId: payload.ifcGlobalId,
        xMm: inToMm(payload.x ?? 0),
        yMm: inToMm(payload.y ?? 0),
        ...(payload.z !== undefined ? { zMm: inToMm(payload.z) } : {}),
        kind: payload.kind ?? 'CORNER',
        ...(payload.onWallIfcId ? { onWallId: _resolveId(payload.onWallIfcId, c) } : {}),
      }
      res = await _request('POST', `/geometry/buildings/${buildingId}/nodes`, body, c)
      const erpId = _extractErpId(res)
      if (erpId && payload.ifcGlobalId) _registerId(payload.ifcGlobalId, erpId, c)
      break
    }

    case 'UPDATE_NODE': {
      const nodeErpId = payload.nodeErpId ?? _resolveId(payload.ifcGlobalId, c)
      // Unresolved id → the projection has no row to PATCH. PATCHing `null` was a real
      // outage: one such op 500s, and because the queue blocks on a failed op, EVERY
      // wall and room behind it silently never syncs ("1 failed", 40 retries, zero rows
      // in the ERP after an hour of tracing). The server creates nodes idempotently by
      // sourceEditorId, so the healing move is to CREATE with the full state we have —
      // which also repairs the missing id mapping for every later op on this node.
      if (!nodeErpId) {
        if (payload.x === undefined || payload.y === undefined || !payload.ifcGlobalId || !c?.buildingId) {
          // Not enough state to create (kind-only tweak on an unknown node): skip rather
          // than poison the queue. Resync-all replays canonical state and reconciles.
          console.warn('[liveSync] UPDATE_NODE with unresolved id and no coords — skipped', payload.ifcGlobalId)
          res = { ok: true, noop: true }
          break
        }
        const createBody = {
          sourceEditorId: payload.ifcGlobalId,
          xMm: inToMm(payload.x),
          yMm: inToMm(payload.y),
          ...(payload.z !== undefined ? { zMm: inToMm(payload.z) } : {}),
          kind: payload.kind ?? 'CORNER',
        }
        res = await _request('POST', `/geometry/buildings/${c.buildingId}/nodes`, createBody, c)
        const healedId = _extractErpId(res)
        if (healedId) _registerId(payload.ifcGlobalId, healedId, c)
        break
      }
      const body = {}
      if (payload.x !== undefined) body.xMm = inToMm(payload.x)
      if (payload.y !== undefined) body.yMm = inToMm(payload.y)
      if (payload.z !== undefined) body.zMm = inToMm(payload.z)
      if (payload.kind !== undefined) body.kind = payload.kind
      res = await _request('PATCH', `/geometry/nodes/${nodeErpId}`, body, c)
      break
    }

    case 'DELETE_NODE': {
      const nodeErpId = payload.nodeErpId ?? _resolveId(payload.ifcGlobalId, c)
      // Unresolved id → no projection row exists to delete: a delete of a
      // non-existent row is a successful no-op (never request /geometry/.../null).
      if (!nodeErpId) { res = { ok: true, noop: true }; break }
      res = await _request('DELETE', `/geometry/nodes/${nodeErpId}`, undefined, c)
      break
    }

    // ── Generic elements ──────────────────────────────────────────────────────
    case 'ADD_ELEMENT': {
      const buildingId = c?.buildingId
      // Resolve the element's editor floor id → ERP floor uuid (floors are emitted
      // before elements, so this resolves). Omit (never send null) if unresolved.
      const elemFloorErpId = payload.floorId
        ? (c?.floorIds?.[payload.floorId] ?? _resolveId(payload.floorId, c))
        : null
      const body = {
        sourceEditorId: payload.ifcGlobalId,
        kind: payload.kind,
        ...(elemFloorErpId ? { floorId: elemFloorErpId } : {}),
        ..._elementBody(opType, payload, c),
      }
      res = await _request('POST', `/geometry/buildings/${buildingId}/elements`, body, c)
      const erpId = _extractErpId(res)
      if (erpId && payload.ifcGlobalId) _registerId(payload.ifcGlobalId, erpId, c)
      break
    }

    case 'UPDATE_ELEMENT': {
      const erpId = payload.elementErpId ?? _resolveId(payload.ifcGlobalId, c)
      if (!erpId) { res = _skipUnresolved(opType, payload.ifcGlobalId); break }
      res = await _request('PATCH', `/geometry/elements/${erpId}`, _elementBody(opType, payload, c), c)
      break
    }

    case 'DELETE_ELEMENT': {
      const erpId = payload.elementErpId ?? _resolveId(payload.ifcGlobalId, c)
      if (!erpId) { res = _skipUnresolved(opType, payload.ifcGlobalId); break }
      // Unresolved id → no projection row exists to delete: a delete of a
      // non-existent row is a successful no-op (never request /geometry/.../null).
      if (!erpId) { res = { ok: true, noop: true }; break }
      res = await _request('DELETE', `/geometry/elements/${erpId}`, undefined, c)
      break
    }

    // ── Shared wall: second WallSurface for an adjacent room ────────────────────
    case 'ADD_WALL_SURFACE': {
      const wallErpId = _requireId('ADD_WALL_SURFACE', 'wallId',
        payload.wallErpId ?? _resolveId(payload.wallIfcId, c), payload.wallIfcId)
      const adjacentRoomId = _requireId('ADD_WALL_SURFACE', 'adjacentRoomId',
        payload.roomErpId ?? _resolveId(payload.roomIfcId, c), payload.roomIfcId)
      const body = {
        adjacentRoomId,
        ...(payload.segmentLengthMm !== undefined ? { segmentLengthMm: payload.segmentLengthMm } : {}),
      }
      res = await _request('POST', `/geometry/walls/${wallErpId}/surfaces/adjacent`, body, c)
      break
    }

    default:
      throw new Error('[liveSync] fireLiveOp: unknown op type: ' + opType)
  }

  return res
}

// ─── ID-map seeding ───────────────────────────────────────────────────────────

// Seed the id-map (sourceEditorId → ERP id) from the live geometry projection so
// subsequent edits resolve to UPDATE (never a duplicate ADD). It reads the
// projection for ID RESOLUTION only and NEVER loads the canvas (the canonical
// document drives reopen). Returns the raw state for callers that want it.
/**
 * Register an editor-id → ERP-id mapping directly. Used by the projection
 * reconstruction for entities whose ERP rows carry NO sourceEditorId (seed-born
 * geometry): their canvas ids are synthesized, so without this registration a
 * later UPDATE/DELETE of the reconstructed entity could never resolve its ERP
 * row and the projection would silently keep it.
 */
export function registerIdMapping(editorId, erpId) {
  if (editorId && erpId) _idMap.set(editorId, erpId)
}

/** Raw projection state for a building — used by the projection-mismatch guard. */
export async function fetchBuildingState(conn) {
  const c = conn ?? _conn
  const data = await _request('GET', `/geometry/buildings/${c.buildingId}/state`, undefined, c)
  return data?.data ?? data ?? {}
}

export async function seedIdMapFromErp(conn) {
  const c = conn ?? _conn
  const data = await _request('GET', `/geometry/buildings/${c.buildingId}/state`, undefined, c)
  const state = data?.data ?? data ?? {}
  return seedIdMapFromState(state, c)
}

/**
 * Seed the id-map, the row versions and the floor map from a GET /state payload (the
 * projection contract). Shared by reopen and "Load from ERP", which both read /state.
 */
export function seedIdMapFromState(state, conn) {
  const c = conn ?? _conn
  const seed = (arr) => {
    for (const e of arr ?? []) if (e?.sourceEditorId && e?.id) _idMap.set(e.sourceEditorId, e.id)
  }
  seed(state.nodes); seed(state.rooms); seed(state.walls); seed(state.elements); seed(state.floors)
  for (const row of [...(state.rooms ?? []), ...(state.walls ?? [])]) {
    if (row?.id && typeof row.version === 'number') _versionMap.set(row.id, row.version)
  }
  // Openings live nested under walls[].openings[] (no top-level array), so iterate
  // walls and seed each opening (sourceEditorId → id) so reopened openings
  // round-trip to UPDATE/DELETE instead of a duplicate ADD.
  for (const w of state.walls ?? []) seed(w.openings)

  // Rebuild/merge the floor map (sourceEditorId → ERP id) so floors created in a
  // prior session resolve after reopen. A mid-session ADD_FLOOR already populates
  // c.floorIds + _idMap; this re-hydrates them on a fresh reopen from getBuildingState.
  if (c && Array.isArray(state.floors)) {
    c.floorIds = c.floorIds ?? {}
    for (const f of state.floors) if (f?.sourceEditorId && f?.id) c.floorIds[f.sourceEditorId] = f.id
  }
  return state
}

export async function requestDrawingCheckpoint(action, body) {
  const path = `/building-structure/buildings/${_conn.buildingId}/checkpoints${action ? `/${action}` : ''}`
  const response = await _request('POST', path, body, _conn)
  return response?.data ?? response
}
