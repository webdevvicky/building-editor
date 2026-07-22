// scripts/verify-editor-auth.mjs
//
// Verifies the editor access-token refresh (Fix 3, planning doc 25):
//   - getEditorToken() returns the seed token immediately after init
//   - a refresh POSTs { refreshToken } to /auth/editor-session/refresh and swaps in
//     the new access token (so long sessions keep persisting)
//   - no refresh token → no refresh call; the single access token is retained
//   - a failed refresh keeps the last good token (never nulls auth mid-session)
//
// Pure Node: a fake backend records the refresh request and returns a rotated token.

import {
  initEditorAuth, getEditorToken, teardownEditorAuth, _refreshForTest,
} from '../src/projects/editorAuth.js'

let pass = 0, fail = 0
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}`) }
}
function header(t) { console.log(`\n${t}`) }

let refreshCalls = 0
let lastBody = null
let mode = 'ok' // 'ok' | 'fail'
const okRes = (body) => ({ ok: true, status: 200, text: async () => '', json: async () => body })
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url)
  if (u.includes('/auth/editor-session/refresh')) {
    refreshCalls++
    lastBody = JSON.parse(opts.body)
    if (mode === 'fail') return { ok: false, status: 401, text: async () => 'expired', json: async () => ({}) }
    return okRes({ success: true, data: { token: `access-${refreshCalls}`, expiresAt: new Date(Date.now() + 9e5).toISOString() } })
  }
  return { ok: false, status: 404, json: async () => ({}), text: async () => 'nf' }
}

async function main() {
  // ── 1. Seed + proactive refresh swaps the token ───────────────────────────
  header('Refresh swaps the access token')
  refreshCalls = 0; mode = 'ok'
  initEditorAuth({
    erpUrl: 'http://erp.test',
    token: 'access-0',
    refreshToken: 'refresh-abc',
    expiresAt: new Date(Date.now() + 9e5).toISOString(),
  })
  ok("seed token returned before any refresh", getEditorToken() === 'access-0')
  await _refreshForTest()
  ok('refresh endpoint called once', refreshCalls === 1)
  ok('sent the refresh token in the body', lastBody && lastBody.refreshToken === 'refresh-abc')
  ok('live token swapped to the refreshed one', getEditorToken() === 'access-1')
  teardownEditorAuth()

  // ── 2. No refresh token → no refresh, keep the access token ───────────────
  header('No refresh token → single access token retained')
  refreshCalls = 0
  initEditorAuth({ erpUrl: 'http://erp.test', token: 'access-only', refreshToken: null, expiresAt: null })
  await _refreshForTest() // no-op (no refresh token)
  ok('no refresh call made', refreshCalls === 0)
  ok('access token retained', getEditorToken() === 'access-only')
  teardownEditorAuth()

  // ── 3. Failed refresh keeps the last good token ───────────────────────────
  header('Failed refresh keeps the last good token')
  refreshCalls = 0; mode = 'fail'
  initEditorAuth({
    erpUrl: 'http://erp.test',
    token: 'access-good',
    refreshToken: 'refresh-xyz',
    expiresAt: new Date(Date.now() + 9e5).toISOString(),
  })
  await _refreshForTest()
  ok('refresh attempted', refreshCalls === 1)
  ok('token NOT nulled on failure (session survives)', getEditorToken() === 'access-good')
  teardownEditorAuth()

  console.log(`\n${fail === 0 ? '✓ PASS' : '✗ FAIL'} — ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
