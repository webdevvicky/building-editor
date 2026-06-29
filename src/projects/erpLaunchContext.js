// erpLaunchContext.js — ERP-driven launch context.
//
// When the JRM ERP opens the editor for a specific building it appends a URL
// *fragment*:
//   #erpLaunch?buildingId=<id>&token=<jwt>&erpUrl=<erpApiBase>
//
// Why a hash fragment (mirrors connectHandoff.js):
//   - fragments are never sent to the server, so the JWT stays out of access
//     logs / proxies,
//   - the editor already reads window.location.hash on boot (same pattern),
//   - main.jsx strips it immediately (history.replaceState) so the token is
//     never visible in the address bar or bookmarkable.
//
// The parsed context lives module-scoped here and drives ERP-mode boot:
//   - manager.js skips IDB current-project hydration (the editor is bound to the
//     ERP building, not a local project),
//   - ProjectsPanel does not force-open the "new project" dialog,
//   - erpSession.js activates live sync to the ERP building.
//
// parseErpLaunchHash is a pure helper (no window / side effects) so it is
// unit-testable and so main.jsx can decide synchronously whether we are in
// ERP-launch mode.

let _ctx = null

/**
 * Parse a `#erpLaunch?...` fragment. Returns { buildingId, token, erpUrl } when
 * the fragment is a well-formed ERP launch link, else null.
 *
 * @param {string} hash  window.location.hash (may include the leading '#')
 * @returns {{buildingId:string, token:string, erpUrl:string}|null}
 */
export function parseErpLaunchHash(hash) {
  // SECURITY: never log the raw hash — it carries the JWT.
  if (!hash) return null
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw.startsWith('erpLaunch?')) return null
  const params = new URLSearchParams(raw.slice('erpLaunch?'.length))
  const buildingId = params.get('buildingId')
  const token = params.get('token')
  const erpUrl = params.get('erpUrl')
  if (!buildingId || !token || !erpUrl) return null
  // Optional TEMPORARY dev rollback flag: reopen=reconstruct forces the legacy PG
  // reconstruction reopen. Absent → production canonical reopen (R2 → IDB).
  // Removed in Phase 3.
  const reopen = params.get('reopen')
  const result = { buildingId, token, erpUrl: erpUrl.replace(/\/$/, ''), ...(reopen ? { reopen } : {}) }
  // SECURITY: sanitized — never log the token itself.
  console.log('[ERP] parsed launch context', { buildingId, erpUrl: result.erpUrl, hasToken: !!token, reopen: reopen ?? null })
  return result
}

/** Store the parsed launch context (called once on boot, before bootPersistence). */
export function setErpLaunchContext(ctx) { _ctx = ctx }

/** @returns {{buildingId:string, token:string, erpUrl:string}|null} */
export function getErpLaunchContext() { return _ctx }

/** True when the editor was launched from the ERP for a specific building. */
export function isErpLaunchMode() { return _ctx != null }
