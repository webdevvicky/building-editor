// liveSync.js — REST middleware for live ERP sync (Phase E)
// Lives behind a liveMode flag; blob sync (cloudSync.js) continues unchanged.

const IN_TO_MM = 25.4
function inToMm(v) { return Math.round(v * IN_TO_MM) }

let _liveMode = false
let _conn = null
const _idMap = new Map()

// ─── Public API ───────────────────────────────────────────────────────────────

export function getLiveMode() { return _liveMode }
export function getLiveConn() { return _conn }

export function initLiveSync(conn) {
  console.log('[LIVE] initLiveSync called with:', conn)
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
  'ADD_FLOOR', 'UPDATE_FLOOR',
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
      const roomErpId = payload.roomErpId ?? _resolveId(payload.roomIfcId, c)
      res = await _request('POST', `/geometry/rooms/${roomErpId}/walls`, {
        sourceEditorId: payload.ifcGlobalId,
        wallMaterial: payload.materialKey ?? null,
        orientation: payload.orientation ?? 'INTERNAL',
        lengthMm: payload.lengthMm ?? 0,
        heightMm: inToMm(payload.height ?? 120),
        thicknessMm: inToMm(payload.thickness ?? 9),
        n1NodeId: payload.n1IfcId ? _resolveId(payload.n1IfcId, c) : null,
        n2NodeId: payload.n2IfcId ? _resolveId(payload.n2IfcId, c) : null,
      }, c)
      const erpId = _extractErpId(res)
      if (erpId && payload.ifcGlobalId) _registerId(payload.ifcGlobalId, erpId, c)
      break
    }

    case 'UPDATE_WALL':
    case 'SET_WALL_MATERIAL':
    case 'SET_WALL_HEIGHT': {
      const wallErpId = payload.wallErpId ?? _resolveId(payload.ifcGlobalId ?? payload.id, c)
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
      const wallErpId = payload.wallErpId ?? _resolveId(payload.ifcGlobalId, c)
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
      const wallErpId = payload.wallErpId ?? _resolveId(payload.wallIfcId, c)
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

    // ── Rooms ─────────────────────────────────────────────────────────────────
    case 'ADD_ROOM': {
      const floorErpId = payload.floorErpId ?? c?.floorIds?.[payload.floorId ?? 'F1'] ?? _resolveId(payload.floorId ?? 'F1', c)
      const body = {
        sourceEditorId: payload.ifcGlobalId,
        ...(payload.roomTypeCode ? { roomTypeCode: payload.roomTypeCode } : {}),
        ...(payload.length !== undefined ? { length: payload.length } : {}),
        ...(payload.width !== undefined ? { width: payload.width } : {}),
        ...(payload.height !== undefined ? { height: payload.height } : {}),
        ...(payload.posXMm !== undefined ? { posXMm: payload.posXMm } : {}),
        ...(payload.posYMm !== undefined ? { posYMm: payload.posYMm } : {}),
        roomShape: payload.roomShape ?? 'POLYGON',
        ...(payload.computedAreaSqft !== undefined ? { computedAreaSqft: payload.computedAreaSqft } : {}),
      }
      res = await _request('POST', `/geometry/floors/${floorErpId}/rooms`, body, c)
      const erpId = _extractErpId(res)
      if (erpId && payload.ifcGlobalId) _registerId(payload.ifcGlobalId, erpId, c)
      break
    }

    case 'UPDATE_ROOM': {
      const roomErpId = payload.roomErpId ?? _resolveId(payload.ifcGlobalId, c)
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
      const body = {}
      if (payload.spanMm !== undefined) body.spanMm = payload.spanMm
      if (payload.heightMm !== undefined) body.heightMm = payload.heightMm
      if (payload.version !== undefined) body.version = payload.version
      res = await _request('PATCH', `/geometry/elements/${erpId}`, body, c)
      break
    }

    case 'DELETE_BEAM': {
      const erpId = payload.elementErpId ?? _resolveId(payload.ifcGlobalId, c)
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
      const body = {}
      if (payload.thicknessMm !== undefined) body.thicknessMm = payload.thicknessMm
      if (payload.areaSqft !== undefined) body.areaSqft = payload.areaSqft
      if (payload.version !== undefined) body.version = payload.version
      res = await _request('PATCH', `/geometry/elements/${erpId}`, body, c)
      break
    }

    case 'DELETE_SLAB': {
      const erpId = payload.elementErpId ?? _resolveId(payload.ifcGlobalId, c)
      // Unresolved id → no projection row exists to delete: a delete of a
      // non-existent row is a successful no-op (never request /geometry/.../null).
      if (!erpId) { res = { ok: true, noop: true }; break }
      res = await _request('DELETE', `/geometry/elements/${erpId}`, undefined, c)
      break
    }

    // ── Generic elements ──────────────────────────────────────────────────────
    case 'ADD_ELEMENT': {
      const buildingId = c?.buildingId
      const body = {
        sourceEditorId: payload.ifcGlobalId,
        kind: payload.kind,
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
      const body = { ...payload }
      delete body.ifcGlobalId
      delete body.elementErpId
      res = await _request('PATCH', `/geometry/elements/${erpId}`, body, c)
      break
    }

    case 'DELETE_ELEMENT': {
      const erpId = payload.elementErpId ?? _resolveId(payload.ifcGlobalId, c)
      // Unresolved id → no projection row exists to delete: a delete of a
      // non-existent row is a successful no-op (never request /geometry/.../null).
      if (!erpId) { res = { ok: true, noop: true }; break }
      res = await _request('DELETE', `/geometry/elements/${erpId}`, undefined, c)
      break
    }

    // ── Shared wall: second WallSurface for an adjacent room ────────────────────
    case 'ADD_WALL_SURFACE': {
      const wallErpId = payload.wallErpId ?? _resolveId(payload.wallIfcId, c)
      const adjacentRoomId = payload.roomErpId ?? _resolveId(payload.roomIfcId, c)
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
export async function seedIdMapFromErp(conn) {
  const c = conn ?? _conn
  const data = await _request('GET', `/geometry/buildings/${c.buildingId}/state`, undefined, c)
  const state = data?.data ?? data ?? {}

  const seed = (arr) => {
    for (const e of arr ?? []) if (e?.sourceEditorId && e?.id) _idMap.set(e.sourceEditorId, e.id)
  }
  seed(state.nodes); seed(state.rooms); seed(state.walls); seed(state.elements); seed(state.floors)

  // Rebuild/merge the floor map (sourceEditorId → ERP id) so floors created in a
  // prior session resolve after reopen. A mid-session ADD_FLOOR already populates
  // c.floorIds + _idMap; this re-hydrates them on a fresh reopen from getBuildingState.
  if (c && Array.isArray(state.floors)) {
    c.floorIds = c.floorIds ?? {}
    for (const f of state.floors) if (f?.sourceEditorId && f?.id) c.floorIds[f.sourceEditorId] = f.id
  }
  return state
}
