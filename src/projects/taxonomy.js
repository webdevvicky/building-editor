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
import { getValidAccessToken, getCachedConn, subscribe as subscribeConn } from './cloudConn.js'

const ROOM_TYPES_KEY = 'cloud:roomTypes'

// undefined = not yet hydrated; array (possibly empty) = the cached tenant list.
let _cache = undefined
const _listeners = new Set()
function _emit() {
  for (const fn of _listeners) {
    try { fn(_cache ?? []) } catch { /* swallow */ }
  }
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
 * on connect + on demand. On failure the existing cache is left untouched (offline
 * resilience). Returns the current list.
 * @param {object|null} conn
 */
export async function refreshRoomTypes(conn = getCachedConn()) {
  if (!conn) return _cache ?? []
  const token = await getValidAccessToken(conn)
  const url = `${conn.erpUrl.replace(/\/$/, '')}/api/v1/room-types`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`room-types fetch failed (${res.status})`)
  const list = unwrapErpResponse(await res.json())
  const normalized = (Array.isArray(list) ? list : []).map((rt) => ({
    code: rt.code,
    label: rt.label ?? rt.code,
    category: rt.category ?? null,
  }))
  const storage = await _getStorage()
  await storage.put(DB_STORES.METADATA, ROOM_TYPES_KEY, { value: normalized })
  _cache = normalized
  _emit()
  return normalized
}

// Refresh whenever a connection appears (connect / reconnect). subscribeConn fires
// immediately with the current connection, so a live connection refreshes at wire
// time. Idempotent — safe to call once at boot.
let _wired = false
export function initRoomTypesSync() {
  if (_wired) return
  _wired = true
  subscribeConn((conn) => {
    if (conn) refreshRoomTypes(conn).catch(() => { /* offline / non-fatal */ })
  })
}
