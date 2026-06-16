// Deep-link auto-connect handoff.
//
// On app load the ERP can hand the editor off via a URL *fragment*:
//   #connect?erp=<ERP_BASE>&pid=<editorProjectId>&code=<oneTimeCode>
//
// This module parses that fragment, exchanges the one-time code for the
// durable connection record (POST {erp}/api/v1/editor-projects/connect-exchange),
// attaches the connection to a local editor project, and pulls the cloud
// snapshot so the editor opens showing the synced model.
//
// The one-time `code` must never linger in history — the caller strips the
// fragment via history.replaceState as soon as it is parsed (see
// parseConnectHash + the runConnectHandoff flow below).
//
// Pure parse helper is exported separately so it can be unit-tested without a
// browser.

import { setCloudConn } from './cloudConn.js'
import { pullFromCloud } from './cloudSync.js'
import { getCloudConn } from './cloudConn.js'

/**
 * Parse a `#connect?...` fragment. Returns { erp, pid, code } when the
 * fragment is a well-formed connect deep link, else null.
 *
 * @param {string} hash  window.location.hash (may include the leading '#')
 * @returns {{erp:string, pid:string, code:string}|null}
 */
export function parseConnectHash(hash) {
  if (!hash) return null
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw.startsWith('connect?')) return null
  const params = new URLSearchParams(raw.slice('connect?'.length))
  const erp = params.get('erp')
  const pid = params.get('pid')
  const code = params.get('code')
  if (!erp || !pid || !code) return null
  return { erp: erp.replace(/\/$/, ''), pid, code }
}

/**
 * Exchange a one-time connect code for the durable connection record.
 * @returns {Promise<{erpUrl,editorProjectId,apiKey}>}
 * @throws on any non-2xx / malformed response.
 */
async function exchangeCode(erp, pid, code) {
  const url = `${erp.replace(/\/$/, '')}/api/v1/editor-projects/connect-exchange`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, pid }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`connect-exchange failed (${res.status}): ${body.slice(0, 200)}`)
  }
  const data = await res.json()
  if (!data?.erpUrl || !data?.editorProjectId || !data?.apiKey) {
    throw new Error('connect-exchange response missing fields')
  }
  return {
    erpUrl: String(data.erpUrl).replace(/\/$/, ''),
    editorProjectId: String(data.editorProjectId),
    apiKey: String(data.apiKey),
  }
}

/**
 * Run the deep-link auto-connect flow exactly once on load.
 *
 * Wiring is injected (not imported) so this module stays free of React and of
 * the store/UI — the caller (ErpConnection) supplies the manager + store +
 * toast seams it already holds. This keeps the flow DRY (one code path) and
 * testable.
 *
 * Steps (mirrors the prompt contract):
 *   1. parse the fragment; bail if it isn't a connect link.
 *   2. strip the fragment immediately (one-time code must not linger).
 *   3. POST connect-exchange → { erpUrl, editorProjectId, apiKey }.
 *   4. resolve a local project (reuse current, else create+open one).
 *   5. setCloudConn(localProjectId, conn).
 *   6. pull the snapshot and loadProject(snapshot) so the model shows.
 *   7. toast.success; refresh the badge's conn state.
 *
 * @param {object} deps
 * @param {() => string|null} deps.getCurrentProjectId
 * @param {(name:string, type?:string) => {id:string}} deps.createProject
 * @param {(id:string) => any} deps.openProject
 * @param {(id:string) => void} deps.setCurrentProjectId
 * @param {(data:any) => void} deps.loadProject
 * @param {{success:Function, error:Function}} deps.toast
 * @param {(conn:any) => void} [deps.onConnected]
 * @returns {Promise<boolean>} true if a connect link was handled (success OR
 *          handled-failure), false if no connect link was present.
 */
// One-time guard: React StrictMode (dev) mounts effects twice, and the App
// connect effect would otherwise invoke this twice. The `code` is single-use
// and the hash is stripped before the first await, so a second invocation would
// 401 and toast a false error. Cache the in-flight promise so both callers
// await the SAME exchange. Module-scoped → reset on a real page reload.
let _handoffPromise = null

export function runConnectHandoff(deps) {
  if (_handoffPromise) return _handoffPromise
  _handoffPromise = _runConnectHandoff(deps)
  return _handoffPromise
}

async function _runConnectHandoff(deps) {
  const {
    getCurrentProjectId,
    createProject,
    openProject,
    setCurrentProjectId,
    loadProject,
    toast,
    onConnected,
  } = deps

  const parsed = parseConnectHash(
    typeof window !== 'undefined' ? window.location.hash : '',
  )
  if (!parsed) return false

  // 2 — strip the one-time code from the URL + history immediately, before any
  //     await, so it never lingers in browser history.
  try {
    const { pathname, search } = window.location
    window.history.replaceState(null, '', pathname + search)
  } catch { /* non-browser / blocked — best effort */ }

  let conn
  try {
    conn = await exchangeCode(parsed.erp, parsed.pid, parsed.code)
  } catch {
    toast.error('Could not connect — the link may have expired. Please reopen from the ERP.')
    return true
  }

  // 4 — resolve a local project to attach the connection to.
  let localProjectId = getCurrentProjectId()
  if (!localProjectId) {
    const rec = createProject(`ERP — ${conn.editorProjectId}`, 'Residential')
    if (!rec) {
      toast.error('Could not connect — failed to create a local project.')
      return true
    }
    localProjectId = rec.id
    openProject(rec.id)
    setCurrentProjectId(rec.id)
  }

  // 5 — persist the global connection, binding it to this local project.
  try {
    await setCloudConn({ ...conn, localProjectId })
  } catch {
    toast.error('Could not connect — failed to save the connection.')
    return true
  }

  // 6 — pull the cloud snapshot so the editor opens showing the synced model.
  //     Pull failure is non-fatal: the connection is set, autosave will push.
  try {
    const pulled = await pullFromCloud(conn)
    if (pulled.ok && pulled.snapshot && pulled.snapshot.projectSettings != null) {
      loadProject(pulled.snapshot)
    }
  } catch { /* non-fatal — connection is set, editor stays on local model */ }

  // 7 — surface the connection + refresh the badge.
  onConnected?.(await getCloudConn().catch(() => conn))
  toast.success(`Connected to ${conn.editorProjectId}`)
  return true
}
