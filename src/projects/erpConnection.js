// erpConnection.js — the SINGLE authenticated ERP connection registry.
//
// The ERP-driven `#erpLaunch` session (erpSession) PUSHES its ready connection
// here via setErpConnection(); every authenticated service (the room-type
// taxonomy today; catalogs / reference data tomorrow) READS/SUBSCRIBES here and
// never knows how the editor was launched.
//
// Connection shape:
//   {
//     erpUrl:   string,                          // ERP API base
//     getToken: () => Promise<string> | string,  // resolve a fresh access token
//     buildingId?: string,
//   }

let _conn = null
const _listeners = new Set()

function _emit() {
  for (const fn of _listeners) {
    try { fn(_conn) } catch { /* a listener error never blocks the registry */ }
  }
}

/** Register (or replace) the active authenticated ERP connection. */
export function setErpConnection(conn) {
  _conn = conn ?? null
  _emit()
}

/** Synchronous read of the current connection (or null). */
export function getErpConnection() {
  return _conn
}

/** The current ERP API base, or null when not connected. */
export function getErpApiBase() {
  return _conn?.erpUrl ?? null
}

/** Resolve a fresh authenticated access token. Throws if not connected. */
export async function getErpAccessToken() {
  if (!_conn) throw new Error('No authenticated ERP connection')
  return _conn.getToken()
}

/**
 * Subscribe to connection changes. Fires IMMEDIATELY with the current connection
 * (or null), then on every change. Returns an unsubscribe fn. This is what lets an
 * authenticated service auto-refresh the moment a connection becomes available.
 * @param {(conn:object|null)=>void} fn
 * @returns {()=>void}
 */
export function subscribeErpConnection(fn) {
  _listeners.add(fn)
  try { fn(_conn) } catch { /* */ }
  return () => { _listeners.delete(fn) }
}

/** Test/reset seam — not used by production code. */
export function _resetErpConnection() {
  _conn = null
  _listeners.clear()
}
