// Cloud connection — a SINGLE global ERP link for the editor installation.
//
// One editor = one ERP connection at a time. The connection is NOT per local
// project: it lives under one global METADATA key. Which local project's edits
// sync to the connected ERP project is a separate, explicit binding carried on
// the record as `localProjectId`.
//
// Record shape (global, METADATA key `cloud:connection`):
//   {
//     erpUrl:          string,
//     editorProjectId: string,        // ERP-side editor project id
//     apiKey:          string,        // long-lived editor API key (browser only)
//     projectName:     string | null, // ERP project display name (for the badge)
//     localProjectId:  string | null, // which local project is bound to sync
//     connectedAt:     string,        // ISO
//   }
//
// An in-memory mirror (`_connCache`) is the synchronous read surface for the
// hot paths (autosave on every edit, the badge render). It is hydrated once at
// boot via hydrateConnCache() and kept in lock-step with every set/clear.
//
// The auth-token cache is in-memory only — never persisted, never logged.

import { DB_STORES } from './storage/indexedDb.js'
import { unwrapErpResponse } from './erpEnvelope.js'

// ── Global storage key ───────────────────────────────────────────────────────
const GLOBAL_CONN_KEY = 'cloud:connection'

// ── In-memory connection mirror + subscribers ────────────────────────────────
// `_connCache` mirrors the persisted record so autosave/badge can read it
// synchronously. `undefined` = not yet hydrated; `null` = hydrated, no link.
let _connCache = undefined
const _connListeners = new Set()

function _emit() {
  for (const fn of _connListeners) {
    try { fn(_connCache ?? null) } catch { /* swallow */ }
  }
}

/**
 * Subscribe to connection changes. Immediately calls fn with the current cached
 * connection (or null). Returns an unsubscribe function. Mirrors the manager.js
 * subscribe pattern so React can drive a useSyncExternalStore off it.
 * @param {(conn:object|null)=>void} fn
 * @returns {()=>void}
 */
export function subscribe(fn) {
  _connListeners.add(fn)
  fn(_connCache ?? null)
  return () => { _connListeners.delete(fn) }
}

/**
 * Synchronous read of the in-memory connection mirror. Returns null when there
 * is no connection (or before hydration). Hot-path callers (autosave, badge)
 * use this to avoid an IDB await per edit/render.
 * @returns {object|null}
 */
export function getCachedConn() {
  return _connCache ?? null
}

// ── In-memory token cache ────────────────────────────────────────────────────
// Keyed by `${erpUrl}::${editorProjectId}` so different projects/servers each
// get an independent cache slot.
const _tokenCache = new Map()
// { accessToken: string, expEpochMs: number }

// Refresh 60 s before actual expiry so callers never get a stale token in the
// middle of a request.
const REFRESH_AHEAD_MS = 60_000

function _cacheKey(conn) {
  return `${conn.erpUrl}::${conn.editorProjectId}`
}

// ── Persistence helper ───────────────────────────────────────────────────────
// We use the same getAssetStorage() adapter manager.js uses, giving direct IDB
// access to the METADATA store without going through the project write queue.
let _storage = null
async function _getStorage() {
  if (_storage) return _storage
  const { getAssetStorage } = await import('./storage/getAssetStorage.js')
  _storage = getAssetStorage()
  return _storage
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Hydrate the in-memory mirror from IDB. Call once during boot (after
 * bootPersistence) so getCachedConn()/subscribe() are correct before render.
 * @returns {Promise<object|null>}
 */
export async function hydrateConnCache() {
  try {
    const storage = await _getStorage()
    const rec = await storage.get(DB_STORES.METADATA, GLOBAL_CONN_KEY)
    _connCache = rec?.value ?? null
  } catch {
    _connCache = null
  }
  _emit()
  return _connCache
}

/**
 * Returns the global cloud connection record, or null if none set. Reads the
 * in-memory mirror once hydrated; otherwise falls back to IDB.
 * @returns {Promise<object|null>}
 */
export async function getCloudConn() {
  if (_connCache !== undefined) return _connCache
  return hydrateConnCache()
}

/**
 * Persist (or replace) the global cloud connection and update the mirror.
 * One editor = one connection: this overwrites any previous record.
 * @param {{erpUrl:string,editorProjectId:string,apiKey:string,projectName?:string|null,localProjectId?:string|null,connectedAt?:string}} conn
 * @returns {Promise<object>} the stored record
 */
export async function setCloudConn(conn) {
  const storage = await _getStorage()
  const record = {
    erpUrl: conn.erpUrl,
    editorProjectId: conn.editorProjectId,
    apiKey: conn.apiKey,
    projectName: conn.projectName ?? null,
    localProjectId: conn.localProjectId ?? null,
    connectedAt: conn.connectedAt ?? new Date().toISOString(),
  }
  await storage.put(DB_STORES.METADATA, GLOBAL_CONN_KEY, { value: record })
  _connCache = record
  _emit()
  return record
}

/**
 * Patch fields on the existing global connection (e.g. refresh projectName, bind
 * localProjectId) without rebuilding the whole record. No-op if not connected.
 * @param {Partial<object>} partial
 * @returns {Promise<object|null>}
 */
export async function patchCloudConn(partial) {
  const current = await getCloudConn()
  if (!current) return null
  return setCloudConn({ ...current, ...partial })
}

/**
 * Remove the global cloud connection, clear the mirror, and drop the cached
 * token for that connection.
 * @returns {Promise<void>}
 */
export async function clearCloudConn() {
  const storage = await _getStorage()
  const current = await getCloudConn()
  if (current) _tokenCache.delete(_cacheKey(current))
  await storage.delete(DB_STORES.METADATA, GLOBAL_CONN_KEY)
  _connCache = null
  _emit()
}

/**
 * Returns a valid access token for the given connection, refreshing via
 * POST {erpUrl}/api/v1/editor-projects/auth-token when the cached token is
 * missing or within REFRESH_AHEAD_MS of expiry. Refreshes the cached
 * projectName from the auth response so the badge stays current.
 *
 * Never logs the apiKey or the accessToken.
 *
 * @param {{erpUrl:string,editorProjectId:string,apiKey:string}} conn
 * @returns {Promise<string>} accessToken
 * @throws if the auth endpoint returns a non-2xx response
 */
export async function getValidAccessToken(conn) {
  const key = _cacheKey(conn)
  const cached = _tokenCache.get(key)
  const now = Date.now()

  if (cached && cached.expEpochMs - now > REFRESH_AHEAD_MS) {
    return cached.accessToken
  }

  // Refresh — never log the api key value.
  const url = `${conn.erpUrl.replace(/\/$/, '')}/api/v1/editor-projects/auth-token`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-editor-api-key': conn.apiKey,
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Auth token exchange failed (${res.status}): ${body.slice(0, 200)}`)
  }

  const envelope = await res.json()
  const { accessToken, expiresIn, projectName } = unwrapErpResponse(envelope)
  if (!accessToken) throw new Error('Auth response missing accessToken')

  const expEpochMs = now + (expiresIn ?? 3600) * 1000
  _tokenCache.set(key, { accessToken, expEpochMs })

  // Keep the badge name fresh if the ERP renamed the project. Only patch when
  // the refreshed connection is the one we have cached globally.
  if (projectName != null && _connCache && _connCache.editorProjectId === conn.editorProjectId
      && _connCache.projectName !== projectName) {
    patchCloudConn({ projectName }).catch(() => { /* non-fatal */ })
  }

  return accessToken
}
