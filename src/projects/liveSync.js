// liveSync.js — REST middleware for live ERP sync (Phase E)
// Lives behind a liveMode flag; blob sync (cloudSync.js) continues unchanged.

const IN_TO_MM = 25.4
function inToMm(v) { return Math.round(v * IN_TO_MM) }

let _liveMode = false
let _conn = null
const _idMap = new Map()
let _pollInterval = null

// ─── Public API ───────────────────────────────────────────────────────────────

export function getLiveMode() { return _liveMode }
export function getLiveConn() { return _conn }

export function initLiveSync(conn) {
  _conn = conn
  _liveMode = true
}

export function teardownLiveSync() {
  _conn = null
  _liveMode = false
  _idMap.clear()
  stopStatePolling()
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
        orientation: payload.orientation ?? 'UNSPECIFIED',
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
          orientation: w.orientation ?? 'UNSPECIFIED',
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
          orientation: payload.orientation ?? 'UNSPECIFIED',
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
      res = await _request('DELETE', `/geometry/openings/${openingErpId}`, undefined, c)
      break
    }

    // ── Rooms ─────────────────────────────────────────────────────────────────
    case 'ADD_ROOM': {
      const floorErpId = payload.floorErpId ?? c?.floorIds?.[payload.floorId ?? 'F1']
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
        ...(payload.roomIds !== undefined ? { roomIds: payload.roomIds } : {}),
      }
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
        ...(payload.areaSqft !== undefined ? { areaSqft: payload.areaSqft } : {}),
        ...(payload.concreteM3 !== undefined ? { concreteM3: payload.concreteM3 } : {}),
        ...(payload.roomIds !== undefined ? { roomIds: payload.roomIds } : {}),
        ...(payload.slabRole !== undefined ? { slabRole: payload.slabRole } : {}),
        ...(payload.slabType !== undefined ? { slabType: payload.slabType } : {}),
        ...(payload.bars !== undefined ? { bars: payload.bars } : {}),
      }
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
      res = await _request('DELETE', `/geometry/elements/${erpId}`, undefined, c)
      break
    }

    default:
      throw new Error('[liveSync] fireLiveOp: unknown op type: ' + opType)
  }

  return res
}

// ─── Hydration & polling ──────────────────────────────────────────────────────

export async function hydrateFromErp(conn, setState) {
  const c = conn ?? _conn
  const data = await _request('GET', `/geometry/buildings/${c.buildingId}/state`, undefined, c)
  // Populate idMap from response sourceEditorId → id mappings
  const entities = data?.data ?? data ?? {}
  function _walkEntities(obj) {
    if (!obj || typeof obj !== 'object') return
    if (Array.isArray(obj)) { obj.forEach(_walkEntities); return }
    if (obj.sourceEditorId && obj.id) {
      _idMap.set(obj.sourceEditorId, obj.id)
    }
    Object.values(obj).forEach(_walkEntities)
  }
  _walkEntities(entities)
  if (typeof setState === 'function') {
    setState({ erpStateOverlay: entities })
  }
  return entities
}

export function startStatePolling(conn, setState, intervalMs = 30000) {
  stopStatePolling()
  _pollInterval = setInterval(() => {
    hydrateFromErp(conn, setState).catch(err => console.error('[liveSync] poll error:', err))
  }, intervalMs)
}

export function stopStatePolling() {
  if (_pollInterval != null) {
    clearInterval(_pollInterval)
    _pollInterval = null
  }
}
