// Cloud connection — per-project ERP link persisted inside the IDB
// PROJECTS record under the optional `cloud` field.
//
// Record shape (stored on project record):
//   cloud: { erpUrl: string, editorProjectId: string, apiKey: string }
//
// Token cache is in-memory only — never persisted, never logged.

import { DB_STORES } from './storage/indexedDb.js'

// ── In-memory token cache ────────────────────────────────────────────────────
// Keyed by `${erpUrl}::${editorProjectId}` so different projects/servers
// each get an independent cache slot.
const _tokenCache = new Map()
// { accessToken: string, expEpochMs: number }

// Refresh 60 s before actual expiry so callers never get a stale token
// in the middle of a request.
const REFRESH_AHEAD_MS = 60_000

function _cacheKey(conn) {
  return `${conn.erpUrl}::${conn.editorProjectId}`
}

// The cloud connection is stored under its OWN METADATA key — NOT on the
// PROJECTS record. The manager rewrites the PROJECTS record on its async write
// queue (createProject's full `put`, saveCurrent's read-modify-write); storing
// `cloud` there raced with / was clobbered by those writes (esp. the deep-link
// new-project handoff), so the connection vanished and autosave never synced.
// METADATA is owned solely by cloudConn → the connection can't be lost.
function _cloudKey(projectId) {
  return `cloud::${projectId}`
}

// ── Persistence helpers ──────────────────────────────────────────────────────
// manager.js exposes its _persistence only during the boot sequence and
// doesn't re-export the storage adapter. We reach it by importing the
// module-level `_persistence` getter instead. However, that would require
// reaching into manager internals. Instead we use the same
// `getAssetStorage()` path that manager.js uses to obtain the underlying
// storage adapter — giving us direct IDB access without going through the
// write queue.

let _storage = null
async function _getStorage() {
  if (_storage) return _storage
  const { getAssetStorage } = await import('./storage/getAssetStorage.js')
  _storage = getAssetStorage()
  return _storage
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the cloud connection record for a project, or null if none set.
 * @param {string} projectId
 * @returns {Promise<{erpUrl:string,editorProjectId:string,apiKey:string}|null>}
 */
export async function getCloudConn(projectId) {
  if (!projectId) return null
  const storage = await _getStorage()
  const rec = await storage.get(DB_STORES.METADATA, _cloudKey(projectId))
  const conn = rec?.value ?? null
  // TEMP debug trace — remove after verifying the connect→sync chain.
  console.log('[cloudConn] getCloudConn', projectId, '→', conn ? 'CONNECTED' : 'null')
  return conn
}

/**
 * Persists the cloud connection on the project IDB record.
 * @param {string} projectId
 * @param {{erpUrl:string,editorProjectId:string,apiKey:string}} conn
 */
export async function setCloudConn(projectId, conn) {
  const storage = await _getStorage()
  // Independent of the PROJECTS record's lifecycle: survives createProject /
  // saveCurrent and never throws on a not-yet-persisted project (the deep-link
  // new-project handoff case).
  await storage.put(DB_STORES.METADATA, _cloudKey(projectId), { value: conn })
  // TEMP debug trace — remove after verifying the connect→sync chain.
  console.log('[cloudConn] setCloudConn', projectId, '→ saved')
}

/**
 * Removes the cloud connection from the project IDB record and clears the
 * in-memory token cache for that connection.
 * @param {string} projectId
 */
export async function clearCloudConn(projectId) {
  const storage = await _getStorage()
  const existing = await storage.get(DB_STORES.METADATA, _cloudKey(projectId))
  const conn = existing?.value
  if (conn) _tokenCache.delete(_cacheKey(conn))
  await storage.delete(DB_STORES.METADATA, _cloudKey(projectId))
}

/**
 * Returns a valid access token for the given connection, refreshing via
 * POST {erpUrl}/api/v1/editor-projects/auth-token when the cached token
 * is missing or within REFRESH_AHEAD_MS of expiry.
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

  const { accessToken, expiresIn } = await res.json()
  if (!accessToken) throw new Error('Auth response missing accessToken')

  const expEpochMs = now + (expiresIn ?? 3600) * 1000
  _tokenCache.set(key, { accessToken, expEpochMs })

  return accessToken
}
