// liveSync.js — REST middleware for live ERP sync (Phase E)
// Lives behind a liveMode flag; blob sync (cloudSync.js) continues unchanged.

const IN_TO_MM = 25.4
function inToMm(v) { return Math.round(v * IN_TO_MM) }

let _liveMode = false
let _conn = null
const _idMap = new Map()

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
//              `erpField` is the escape hatch: a payload that already carries the
//              resolved server id has no dependency at all.
//   produces — the editor id this op registers a server id for when it succeeds.
//   destroys — the editor ids this op removes, so a child waiting on one can be
//              dropped instead of waiting for ever.
const WALL_PARENT = { idField: 'wallIfcId', erpField: 'wallErpId', kind: 'wall' }
const ROOM_PARENT = { idField: 'roomIfcId', erpField: 'roomErpId', kind: 'room' }

const OP_DEPENDENCY = {
  ADD_WALL: { parents: [ROOM_PARENT], produces: 'ifcGlobalId' },
  SPLIT_WALL: { parents: [{ idField: 'ifcGlobalId', erpField: 'wallErpId', kind: 'wall' }] },
  ADD_OPENING: { parents: [WALL_PARENT], produces: 'ifcGlobalId' },
  ADD_WALL_SURFACE: { parents: [WALL_PARENT, ROOM_PARENT] },
  SAVE_ROOM_VERTICES: { parents: [ROOM_PARENT] },

  ADD_FLOOR: { produces: 'ifcGlobalId' },
  ADD_ROOM: { produces: 'ifcGlobalId' },
  ADD_NODE: { produces: 'ifcGlobalId' },
  ADD_COLUMN: { produces: 'ifcGlobalId' },
  ADD_BEAM: { produces: 'ifcGlobalId' },
  ADD_SLAB: { produces: 'ifcGlobalId' },
  ADD_ELEMENT: { produces: 'ifcGlobalId' },

  DELETE_WALL: { destroys: ['ifcGlobalId', 'id'] },
  DELETE_ROOM: { destroys: ['ifcGlobalId'] },
  DELETE_FLOOR: { destroys: ['ifcGlobalId'] },
  DELETE_NODE: { destroys: ['ifcGlobalId'] },
  DELETE_OPENING: { destroys: ['ifcGlobalId'] },
  DELETE_COLUMN: { destroys: ['ifcGlobalId'] },
  DELETE_BEAM: { destroys: ['ifcGlobalId'] },
  DELETE_SLAB: { destroys: ['ifcGlobalId'] },
  DELETE_ELEMENT: { destroys: ['ifcGlobalId'] },
}

/**
 * What this op needs before it can be sent, and what it will provide.
 *
 * @returns {{ needs: Array<{editorId: string, field: string, kind: string}>,
 *             produces: string|null, destroys: string[] }}
 */
export function opDependency(opType, payload = {}) {
  const spec = OP_DEPENDENCY[opType]
  if (!spec) return { needs: [], produces: null, destroys: [] }

  const needs = []
  for (const p of spec.parents ?? []) {
    if (payload[p.erpField]) continue          // already resolved — nothing to wait for
    const editorId = payload[p.idField]
    if (!editorId) continue                    // nothing to wait ON; _requireId reports it
    needs.push({ editorId, field: p.idField, kind: p.kind })
  }

  const destroys = []
  for (const f of spec.destroys ?? []) {
    if (payload[f]) destroys.push(payload[f])
  }

  return { needs, produces: (spec.produces && payload[spec.produces]) || null, destroys }
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
  _conn = conn
  _liveMode = true
  console.log('[LIVE] _liveMode set to true')
}

export function teardownLiveSync() {
  _conn = null
  _liveMode = false
  _idMap.clear()
}

export function registerErpId(editorIfcId, erpId) {
  _idMap.set(editorIfcId, erpId)
}

export function resolveErpId(editorIfcId, conn) {
  return _resolveId(editorIfcId, conn)
}

export const GEOMETRY_OPS = [
  'ADD_WALL', 'UPDATE_WALL', 'DELETE_WALL', 'SET_WALL_MATERIAL', 'SET_WALL_HEIGHT',
  'SPLIT_WALL', 'JOIN_WALLS',
  'ADD_OPENING', 'UPDATE_OPENING', 'DELETE_OPENING',
  'ADD_FLOOR', 'UPDATE_FLOOR', 'DELETE_FLOOR',
  'ADD_ROOM', 'UPDATE_ROOM', 'DELETE_ROOM', 'SAVE_ROOM_VERTICES',
  'ADD_NODE', 'UPDATE_NODE', 'DELETE_NODE',
  'ADD_COLUMN', 'UPDATE_COLUMN', 'DELETE_COLUMN',
  'ADD_BEAM', 'UPDATE_BEAM', 'DELETE_BEAM',
  'ADD_SLAB', 'UPDATE_SLAB', 'DELETE_SLAB',
  'ADD_ELEMENT', 'UPDATE_ELEMENT', 'DELETE_ELEMENT',
]

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function _request(method, path, body, conn) {
  const c = conn ?? _conn
  const token = await c.getToken()
  const url = `${c.erpUrl.replace(/\/$/, '')}/api/v1${path}`
  const res = await fetch(url, {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`[liveSync] ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

function _resolveId(ifcId, conn) {
  if (conn?.resolveErpId) return conn.resolveErpId(ifcId)
  return _idMap.get(ifcId) ?? null
}

function _registerId(ifcId, erpId, conn) {
  if (conn?.registerErpId) { conn.registerErpId(ifcId, erpId); return }
  _idMap.set(ifcId, erpId)
}

function _extractErpId(res) {
  return res?.data?.id ?? res?.id ?? null
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

// Map editor room ifcGlobalIds → ERP room UUIDs (slab/element roomIds are
// @IsUUID on the backend, so unresolved editor ids must be dropped).
function _resolveRoomIds(roomIfcIds, conn) {
  if (!Array.isArray(roomIfcIds)) return []
  return roomIfcIds.map((ifc) => _resolveId(ifc, conn)).filter(Boolean)
}

// ─── Main dispatch ────────────────────────────────────────────────────────────

export async function fireLiveOp(opType, payload, conn) {
  const c = conn ?? _conn
  if (!c) throw new Error('[liveSync] fireLiveOp: no conn available')

  let res
  switch (opType) {

    // ── Walls ────────────────────────────────────────────────────────────────
    case 'ADD_WALL': {
      const roomErpId = _requireId('ADD_WALL', 'roomId',
        payload.roomErpId ?? _resolveId(payload.roomIfcId, c), payload.roomIfcId)
      res = await _request('POST', `/geometry/rooms/${roomErpId}/walls`, {
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
      const erpId = _extractErpId(res)
      if (erpId && payload.ifcGlobalId) _registerId(payload.ifcGlobalId, erpId, c)
      break
    }

    case 'UPDATE_WALL':
    case 'SET_WALL_MATERIAL':
    case 'SET_WALL_HEIGHT': {
      const wallErpId = payload.wallErpId ?? _resolveId(payload.ifcGlobalId ?? payload.id, c)
      if (!wallErpId) { res = _skipUnresolved('UPDATE_WALL', payload.ifcGlobalId ?? payload.id); break }
      const body = {}
      if (payload.materialKey !== undefined) body.wallMaterial = payload.materialKey
      if (payload.height !== undefined) body.heightMm = inToMm(payload.height)
      if (payload.thickness !== undefined) body.thicknessMm = inToMm(payload.thickness)
      if (payload.orientation !== undefined) body.orientation = payload.orientation
      if (payload.angleDeg !== undefined) body.angleDeg = payload.angleDeg
      if (payload.version !== undefined) body.version = payload.version
      if (payload.lengthMm !== undefined) body.lengthMm = payload.lengthMm
      res = await _request('PATCH', `/geometry/walls/${wallErpId}`, body, c)
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

    case 'SPLIT_WALL': {
      const wallErpId = _requireId('SPLIT_WALL', 'wallId',
        payload.wallErpId ?? _resolveId(payload.ifcGlobalId, c), payload.ifcGlobalId)
      const body = {
        atFractions: payload.atFractions,
        ...(payload.atNodeIfcId ? { atNodeId: _resolveId(payload.atNodeIfcId, c) } : {}),
        newWalls: (payload.newWalls ?? []).map(w => ({
          sourceEditorId: w.ifcGlobalId,
          lengthMm: w.lengthMm ?? 0,
          heightMm: inToMm(w.height ?? 120),
          thicknessMm: inToMm(w.thickness ?? 9),
          orientation: w.orientation ?? 'INTERNAL',
          ...(w.materialKey ? { wallMaterial: w.materialKey } : {}),
          ...(w.angleDeg !== undefined ? { angleDeg: w.angleDeg } : {}),
          ...(w.n1IfcId ? { n1NodeId: _resolveId(w.n1IfcId, c) } : {}),
          ...(w.n2IfcId ? { n2NodeId: _resolveId(w.n2IfcId, c) } : {}),
        })),
      }
      res = await _request('POST', `/geometry/walls/${wallErpId}/split`, body, c)
      break
    }

    case 'JOIN_WALLS': {
      const body = {
        wallIds: (payload.wallIfcIds ?? []).map(ifc => _resolveId(ifc, c)).filter(Boolean),
        merged: {
          sourceEditorId: payload.mergedIfcGlobalId,
          lengthMm: payload.lengthMm ?? 0,
          heightMm: inToMm(payload.height ?? 120),
          thicknessMm: inToMm(payload.thickness ?? 9),
          orientation: payload.orientation ?? 'INTERNAL',
          ...(payload.materialKey ? { wallMaterial: payload.materialKey } : {}),
          ...(payload.angleDeg !== undefined ? { angleDeg: payload.angleDeg } : {}),
        },
      }
      res = await _request('POST', `/geometry/walls/join`, body, c)
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
      const erpId = _extractErpId(res)
      if (erpId && payload.ifcGlobalId) _registerId(payload.ifcGlobalId, erpId, c)
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
      if (payload.version !== undefined) body.version = payload.version
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
    // that follows resolves a real floorErpId. Register the returned id in BOTH
    // _idMap (the _resolveId fallback) and c.floorIds (the primary ADD_ROOM lookup,
    // which is the SAME conn object the new-building F1 bootstrap seeds).
    case 'ADD_FLOOR': {
      const body = {
        floorNumber: payload.floorNumber ?? 1,
        sourceEditorId: payload.ifcGlobalId,
        ...(payload.floorHeight !== undefined ? { floorHeight: payload.floorHeight } : {}),
        ...(payload.floorLength !== undefined ? { floorLength: payload.floorLength } : {}),
        ...(payload.floorWidth !== undefined ? { floorWidth: payload.floorWidth } : {}),
      }
      res = await _request('POST', `/geometry/buildings/${c.buildingId}/floors`, body, c)
      const erpId = _extractErpId(res)
      if (erpId && payload.ifcGlobalId) {
        _registerId(payload.ifcGlobalId, erpId, c)
        if (c) { c.floorIds = c.floorIds ?? {}; c.floorIds[payload.ifcGlobalId] = erpId }
      }
      break
    }

    // No PATCH route exists on /geometry for floors (only POST + GET state), and a
    // floor's synced fields (height/dims) aren't load-bearing for room attachment,
    // so a floor change is a projection no-op rather than a 404.
    case 'UPDATE_FLOOR': {
      res = { ok: true, noop: true }
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
      const erpId = _extractErpId(res)
      if (erpId && payload.ifcGlobalId) _registerId(payload.ifcGlobalId, erpId, c)
      break
    }

    case 'UPDATE_ROOM': {
      const roomErpId = payload.roomErpId ?? _resolveId(payload.ifcGlobalId, c)
      if (!roomErpId) { res = _skipUnresolved('UPDATE_ROOM', payload.ifcGlobalId); break }
      const body = { ...payload }
      delete body.ifcGlobalId
      delete body.roomErpId
      res = await _request('PATCH', `/geometry/rooms/${roomErpId}`, body, c)
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

    // ── Columns ───────────────────────────────────────────────────────────────
    case 'ADD_COLUMN': {
      const buildingId = c?.buildingId
      const body = {
        sourceEditorId: payload.ifcGlobalId,
        kind: 'COLUMN',
        posXMm: inToMm(payload.x ?? 0),
        posYMm: inToMm(payload.y ?? 0),
        ...(payload.sectionShape !== undefined ? { sectionShape: payload.sectionShape } : {}),
        ...(payload.sectionWidthMm !== undefined ? { sectionWidthMm: payload.sectionWidthMm } : {}),
        ...(payload.sectionDepthMm !== undefined ? { sectionDepthMm: payload.sectionDepthMm } : {}),
        ...(payload.diameterMm !== undefined ? { diameterMm: payload.diameterMm } : {}),
        ...(payload.heightMm !== undefined ? { heightMm: payload.heightMm } : {}),
        ...(payload.structuralLevel !== undefined ? { structuralLevel: payload.structuralLevel } : {}),
      }
      res = await _request('POST', `/geometry/buildings/${buildingId}/elements`, body, c)
      const erpId = _extractErpId(res)
      if (erpId && payload.ifcGlobalId) _registerId(payload.ifcGlobalId, erpId, c)
      break
    }

    case 'UPDATE_COLUMN': {
      const erpId = payload.elementErpId ?? _resolveId(payload.ifcGlobalId, c)
      if (!erpId) { res = _skipUnresolved(opType, payload.ifcGlobalId); break }
      const body = {}
      if (payload.x !== undefined) body.posXMm = inToMm(payload.x)
      if (payload.y !== undefined) body.posYMm = inToMm(payload.y)
      if (payload.sectionShape !== undefined) body.sectionShape = payload.sectionShape
      if (payload.sectionWidthMm !== undefined) body.sectionWidthMm = payload.sectionWidthMm
      if (payload.sectionDepthMm !== undefined) body.sectionDepthMm = payload.sectionDepthMm
      if (payload.diameterMm !== undefined) body.diameterMm = payload.diameterMm
      if (payload.heightMm !== undefined) body.heightMm = payload.heightMm
      if (payload.structuralLevel !== undefined) body.structuralLevel = payload.structuralLevel
      if (payload.version !== undefined) body.version = payload.version
      res = await _request('PATCH', `/geometry/elements/${erpId}`, body, c)
      break
    }

    case 'DELETE_COLUMN': {
      const erpId = payload.elementErpId ?? _resolveId(payload.ifcGlobalId, c)
      if (!erpId) { res = _skipUnresolved(opType, payload.ifcGlobalId); break }
      // Unresolved id → no projection row exists to delete: a delete of a
      // non-existent row is a successful no-op (never request /geometry/.../null).
      if (!erpId) { res = { ok: true, noop: true }; break }
      res = await _request('DELETE', `/geometry/elements/${erpId}`, undefined, c)
      break
    }

    // ── Beams ─────────────────────────────────────────────────────────────────
    case 'ADD_BEAM': {
      const buildingId = c?.buildingId
      const body = {
        sourceEditorId: payload.ifcGlobalId,
        kind: 'BEAM',
        ...(payload.spanMm !== undefined ? { spanMm: payload.spanMm } : {}),
        ...(payload.heightMm !== undefined ? { heightMm: payload.heightMm } : {}),
        ...(payload.sectionWidthMm !== undefined ? { sectionWidthMm: payload.sectionWidthMm } : {}),
        ...(payload.fromXMm !== undefined ? { fromXMm: payload.fromXMm } : {}),
        ...(payload.fromYMm !== undefined ? { fromYMm: payload.fromYMm } : {}),
        ...(payload.toXMm !== undefined ? { toXMm: payload.toXMm } : {}),
        ...(payload.toYMm !== undefined ? { toYMm: payload.toYMm } : {}),
        ...(payload.structuralLevel !== undefined ? { structuralLevel: payload.structuralLevel } : {}),
      }
      res = await _request('POST', `/geometry/buildings/${buildingId}/elements`, body, c)
      const erpId = _extractErpId(res)
      if (erpId && payload.ifcGlobalId) _registerId(payload.ifcGlobalId, erpId, c)
      break
    }

    case 'UPDATE_BEAM': {
      const erpId = payload.elementErpId ?? _resolveId(payload.ifcGlobalId, c)
      if (!erpId) { res = _skipUnresolved(opType, payload.ifcGlobalId); break }
      const body = {}
      if (payload.spanMm !== undefined) body.spanMm = payload.spanMm
      if (payload.heightMm !== undefined) body.heightMm = payload.heightMm
      if (payload.version !== undefined) body.version = payload.version
      res = await _request('PATCH', `/geometry/elements/${erpId}`, body, c)
      break
    }

    case 'DELETE_BEAM': {
      const erpId = payload.elementErpId ?? _resolveId(payload.ifcGlobalId, c)
      if (!erpId) { res = _skipUnresolved(opType, payload.ifcGlobalId); break }
      // Unresolved id → no projection row exists to delete: a delete of a
      // non-existent row is a successful no-op (never request /geometry/.../null).
      if (!erpId) { res = { ok: true, noop: true }; break }
      res = await _request('DELETE', `/geometry/elements/${erpId}`, undefined, c)
      break
    }

    // ── Slabs ─────────────────────────────────────────────────────────────────
    case 'ADD_SLAB': {
      const buildingId = c?.buildingId
      const body = {
        sourceEditorId: payload.ifcGlobalId,
        kind: payload.slabKind ?? 'SLAB',
        ...(payload.thicknessMm !== undefined ? { thicknessMm: payload.thicknessMm } : {}),
        ...(payload.areaSqft !== undefined ? { areaSqft: payload.areaSqft } : {}),
        ...(payload.slabRole !== undefined ? { slabRole: payload.slabRole } : {}),
        ...(payload.slabType !== undefined ? { slabType: payload.slabType } : {}),
      }
      const slabRoomIds = _resolveRoomIds(payload.roomIds, c)
      if (slabRoomIds.length) body.roomIds = slabRoomIds
      res = await _request('POST', `/geometry/buildings/${buildingId}/elements`, body, c)
      const erpId = _extractErpId(res)
      if (erpId && payload.ifcGlobalId) _registerId(payload.ifcGlobalId, erpId, c)
      break
    }

    case 'UPDATE_SLAB': {
      const erpId = payload.elementErpId ?? _resolveId(payload.ifcGlobalId, c)
      if (!erpId) { res = _skipUnresolved(opType, payload.ifcGlobalId); break }
      const body = {}
      if (payload.thicknessMm !== undefined) body.thicknessMm = payload.thicknessMm
      if (payload.areaSqft !== undefined) body.areaSqft = payload.areaSqft
      if (payload.version !== undefined) body.version = payload.version
      res = await _request('PATCH', `/geometry/elements/${erpId}`, body, c)
      break
    }

    case 'DELETE_SLAB': {
      const erpId = payload.elementErpId ?? _resolveId(payload.ifcGlobalId, c)
      if (!erpId) { res = _skipUnresolved(opType, payload.ifcGlobalId); break }
      // Unresolved id → no projection row exists to delete: a delete of a
      // non-existent row is a successful no-op (never request /geometry/.../null).
      if (!erpId) { res = { ok: true, noop: true }; break }
      res = await _request('DELETE', `/geometry/elements/${erpId}`, undefined, c)
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
        ...(payload.posXMm !== undefined ? { posXMm: payload.posXMm } : {}),
        ...(payload.posYMm !== undefined ? { posYMm: payload.posYMm } : {}),
        ...(payload.heightMm !== undefined ? { heightMm: payload.heightMm } : {}),
        ...(payload.thicknessMm !== undefined ? { thicknessMm: payload.thicknessMm } : {}),
        ...(payload.spanMm !== undefined ? { spanMm: payload.spanMm } : {}),
        ...(payload.fromXMm !== undefined ? { fromXMm: payload.fromXMm } : {}),
        ...(payload.fromYMm !== undefined ? { fromYMm: payload.fromYMm } : {}),
        ...(payload.toXMm !== undefined ? { toXMm: payload.toXMm } : {}),
        ...(payload.toYMm !== undefined ? { toYMm: payload.toYMm } : {}),
        ...(payload.sectionWidthMm !== undefined ? { sectionWidthMm: payload.sectionWidthMm } : {}),
        ...(payload.sectionDepthMm !== undefined ? { sectionDepthMm: payload.sectionDepthMm } : {}),
        ...(payload.diameterMm !== undefined ? { diameterMm: payload.diameterMm } : {}),
        ...(payload.structuralLevel !== undefined ? { structuralLevel: payload.structuralLevel } : {}),
        ...(payload.areaSqft !== undefined ? { areaSqft: payload.areaSqft } : {}),
        ...(payload.concreteM3 !== undefined ? { concreteM3: payload.concreteM3 } : {}),
        ...(payload.slabRole !== undefined ? { slabRole: payload.slabRole } : {}),
        ...(payload.slabType !== undefined ? { slabType: payload.slabType } : {}),
        ...(payload.bars !== undefined ? { bars: payload.bars } : {}),
        // Editor room ifcGlobalId (resolved to BuildingElement.roomId server-side) so
        // placed MEP points count per room under the geometry-first resolver.
        ...(payload.roomIfcId ? { roomIfcId: payload.roomIfcId } : {}),
        // Stream 2: canonical MEP point classification. Whitelisted on the ERP element
        // DTO (accepted-and-ignored until the deferred subtype routing lands).
        ...(payload.pointType ? { pointType: payload.pointType } : {}),
      }
      const elemRoomIds = _resolveRoomIds(payload.roomIds, c)
      if (elemRoomIds.length) body.roomIds = elemRoomIds
      res = await _request('POST', `/geometry/buildings/${buildingId}/elements`, body, c)
      const erpId = _extractErpId(res)
      if (erpId && payload.ifcGlobalId) _registerId(payload.ifcGlobalId, erpId, c)
      break
    }

    case 'UPDATE_ELEMENT': {
      const erpId = payload.elementErpId ?? _resolveId(payload.ifcGlobalId, c)
      if (!erpId) { res = _skipUnresolved(opType, payload.ifcGlobalId); break }
      const body = { ...payload }
      delete body.ifcGlobalId
      delete body.elementErpId
      res = await _request('PATCH', `/geometry/elements/${erpId}`, body, c)
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

  const seed = (arr) => {
    for (const e of arr ?? []) if (e?.sourceEditorId && e?.id) _idMap.set(e.sourceEditorId, e.id)
  }
  seed(state.nodes); seed(state.rooms); seed(state.walls); seed(state.elements); seed(state.floors)
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
