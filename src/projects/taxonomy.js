// taxonomy.js — the editor CONSUMES the ERP's canonical RoomType taxonomy.
//
// Taxonomy source-of-truth invariant: `RoomTypeCode` is authored EXACTLY ONCE, in
// the ERP taxonomy (`GET /api/v1/room-types`). The editor fetches it on connect,
// caches it in IDB METADATA so it survives offline, and exposes it synchronously
// for the room-type picker. The editor NEVER defines its own canonical RoomType
// list — the 17 `roomPresets` are UI/geometry shortcuts, NOT a taxonomy.
//
// Mirrors the cloudConn cache pattern: in-memory mirror + subscribe (for
// useSyncExternalStore) + IDB-backed persistence + refresh-on-connect.

import { DB_STORES } from './storage/indexedDb.js'
import { unwrapErpResponse } from './erpEnvelope.js'
import { getErpConnection, subscribeErpConnection } from './erpConnection.js'

const ROOM_TYPES_KEY = 'cloud:roomTypes'

// undefined = not yet hydrated; array (possibly empty) = the cached tenant list.
let _cache = undefined
const _listeners = new Set()
function _emit() {
  for (const fn of _listeners) {
    try { fn(_cache ?? []) } catch { /* swallow */ }
  }
}

// Last taxonomy-load error (null = none). Surfaced so a failed room-types fetch is
// NEVER invisible (Defect C) — the room-type picker shows it, and it is logged.
let _error = null
const _errorListeners = new Set()
function _emitError() {
  for (const fn of _errorListeners) {
    try { fn(_error) } catch { /* swallow */ }
  }
}

/** Subscribe to taxonomy-load-error changes (drives useSyncExternalStore). */
export function subscribeRoomTypesError(fn) {
  _errorListeners.add(fn)
  fn(_error)
  return () => { _errorListeners.delete(fn) }
}

/** Synchronous read of the last taxonomy-load error message (or null). */
export function getRoomTypesError() {
  return _error
}

/**
 * Subscribe to room-type cache changes. Immediately calls fn with the current
 * list (possibly []). Returns an unsubscribe fn. Drives useSyncExternalStore.
 * @param {(list:Array<{code:string,label:string,category:string|null}>)=>void} fn
 * @returns {()=>void}
 */
export function subscribeRoomTypes(fn) {
  _listeners.add(fn)
  fn(_cache ?? [])
  return () => { _listeners.delete(fn) }
}

/** Synchronous read of the cached tenant RoomType list (possibly []). */
export function getCachedRoomTypes() {
  return _cache ?? []
}

let _storage = null
async function _getStorage() {
  if (_storage) return _storage
  const { getAssetStorage } = await import('./storage/getAssetStorage.js')
  _storage = getAssetStorage()
  return _storage
}

/** Hydrate the in-memory mirror from IDB. Call once during boot. */
export async function hydrateRoomTypesCache() {
  try {
    const storage = await _getStorage()
    const rec = await storage.get(DB_STORES.METADATA, ROOM_TYPES_KEY)
    _cache = Array.isArray(rec?.value) ? rec.value : []
  } catch {
    _cache = []
  }
  _emit()
  return _cache
}

/**
 * Fetch the tenant's active RoomTypes from the ERP and refresh the cache. Called
 * whenever an authenticated ERP connection becomes available — regardless of which
 * launch path provided it (the connection carries its own `erpUrl` + `getToken`,
 * so this is launch-mechanism-agnostic). On failure the existing cache is left
 * untouched (offline resilience) and the error is recorded (never swallowed).
 * Returns the current list.
 * @param {object|null} conn
 */
export async function refreshRoomTypes(conn = getErpConnection()) {
  if (!conn) return _cache ?? []
  const token = await conn.getToken()
  const url = `${conn.erpUrl.replace(/\/$/, '')}/api/v1/room-types`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`room-types fetch failed (${res.status})`)
  const list = unwrapErpResponse(await res.json())
  const normalized = (Array.isArray(list) ? list : []).map((rt) => ({
    code: rt.code,
    label: rt.label ?? rt.code,
    category: rt.category ?? null,
    // The room-type STANDARD (defaults) — reference data for Ghost suggestions +
    // the Standard-vs-Actual comparison. NEVER a BOQ quantity (the ERP severs it).
    defaultFixtureSpec: rt.defaultFixtureSpec ?? {},
    defaultElectricalPointCount: rt.defaultElectricalPointCount ?? 0,
  }))
  const storage = await _getStorage()
  await storage.put(DB_STORES.METADATA, ROOM_TYPES_KEY, { value: normalized })
  _cache = normalized
  _emit()
  // A successful refresh clears any prior error surface.
  if (_error !== null) { _error = null; _emitError() }
  return normalized
}

/**
 * Record a taxonomy-load failure so it is NEVER invisible (Defect C): log it for
 * developers and expose a message the room-type picker surfaces to the user.
 */
function _reportRoomTypesError(err) {
  const message = err?.message ? String(err.message) : 'Could not load room types from the ERP.'
  console.error('[taxonomy] room-types refresh failed:', err)
  _error = message
  _emitError()
}

// Refresh whenever an authenticated ERP connection appears — from ANY launch path
// (legacy connect OR #erpLaunch). subscribeErpConnection fires immediately with the
// current connection, so a live connection refreshes at wire time. Idempotent —
// safe to call once at boot. No launch-specific wiring lives here.
let _wired = false
export function initRoomTypesSync() {
  if (_wired) return
  _wired = true
  subscribeErpConnection((conn) => {
    if (conn) refreshRoomTypes(conn).catch(_reportRoomTypesError)
  })
}
