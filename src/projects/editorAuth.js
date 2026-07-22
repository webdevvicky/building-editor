// editorAuth.js — keeps the building-scoped editor ACCESS token fresh in-session.
//
// The ERP launch link carries a short-lived access token (15 min) AND a long-lived
// refresh token (12 h). Without in-session refresh, a long editing session silently
// stops persisting once the access token expires — every /geometry and canonical PUT
// 401s (planning doc 25, Fix 3). This module holds the current access token and
// proactively refreshes it shortly BEFORE expiry via
//   POST /api/v1/auth/editor-session/refresh { refreshToken } → { token, expiresAt }
// The 12h refresh token itself is unchanged by a refresh, so this sustains a session
// up to the refresh-token lifetime. `getEditorToken()` always returns the live token,
// so every write path (liveSyncQueue, canonicalSyncQueue) picks up the new one.

const REFRESH_SKEW_MS = 60_000        // refresh ~1 min before expiry
const DEFAULT_TTL_MS = 15 * 60 * 1000 // mirror of the server EDITOR_ACCESS_TTL
const MIN_DELAY_MS = 10_000           // never busy-loop if expiry is near/passed
const RETRY_MS = 30_000               // transient failure → retry (queue 401s also retry)

let _erpUrl = null
let _token = null
let _refreshToken = null
let _timer = null

function _unwrap(env) { return env && env.data !== undefined ? env.data : env }

/** Seed the token manager from the launch context and start proactive refresh. */
export function initEditorAuth({ erpUrl, token, refreshToken, expiresAt }) {
  _erpUrl = erpUrl ? erpUrl.replace(/\/$/, '') : null
  _token = token ?? null
  _refreshToken = refreshToken ?? null
  if (_timer) { clearTimeout(_timer); _timer = null }
  // No refresh token (e.g. an older ERP that didn't forward one) → keep the single
  // access token; the session still works until it expires, as before.
  if (_refreshToken && _erpUrl) _scheduleRefresh(expiresAt)
}

/** The current (possibly-refreshed) access token. */
export function getEditorToken() { return _token }

export function teardownEditorAuth() {
  if (_timer) { clearTimeout(_timer); _timer = null }
  _erpUrl = null; _token = null; _refreshToken = null
}

/** Test seam — run one refresh synchronously (no timer wait), then cancel any reschedule. */
export async function _refreshForTest() {
  if (_timer) { clearTimeout(_timer); _timer = null }
  await _refresh()
  if (_timer) { clearTimeout(_timer); _timer = null }
}

function _delayUntil(expiresAt) {
  const exp = expiresAt ? Date.parse(expiresAt) : NaN
  const base = Number.isFinite(exp) ? exp : Date.now() + DEFAULT_TTL_MS
  return Math.max(MIN_DELAY_MS, base - Date.now() - REFRESH_SKEW_MS)
}

function _scheduleRefresh(expiresAt) {
  if (_timer) clearTimeout(_timer)
  _timer = setTimeout(_refresh, _delayUntil(expiresAt))
}

async function _refresh() {
  _timer = null
  if (!_refreshToken || !_erpUrl) return
  try {
    const res = await fetch(`${_erpUrl}/api/v1/auth/editor-session/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: _refreshToken }),
    })
    if (!res.ok) throw new Error(`refresh ${res.status}`)
    const data = _unwrap(await res.json())
    if (!data || !data.token) throw new Error('refresh: no token in response')
    _token = data.token
    _scheduleRefresh(data.expiresAt) // schedule the next refresh off the new expiry
  } catch (err) {
    // Transient outage, or the 12h refresh token finally expired. Retry on a short
    // delay; the write queues carry their own 401 retries so a brief gap self-heals.
    // SECURITY: never log tokens.
    console.warn('[editorAuth] token refresh failed — will retry', err?.message ?? err)
    _timer = setTimeout(_refresh, RETRY_MS)
  }
}
