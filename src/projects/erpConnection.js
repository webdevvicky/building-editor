// erpConnection.js — the SINGLE source-agnostic authenticated ERP connection.
//
// The editor can be launched more than one way — the legacy manual "Connect to
// ERP" dialog (cloudConn) and the ERP-driven `#erpLaunch` session (erpSession).
// Authenticated services (the room-type taxonomy today; catalogs / reference data
// tomorrow) MUST NOT know or care which launch path is active. Each launch path
// PUSHES its ready connection here via setErpConnection(); every authenticated
// service READS/SUBSCRIBES here. One registry, zero launch-specific wiring in the
// services — that is the coupling this module exists to eliminate.
//
// Connection shape:
//   {
//     erpUrl:   string,                          // ERP API base
//     getToken: () => Promise<string> | string,  // resolve a fresh access token
//     buildingId?: string,
//     source:   'erpLaunch' | 'cloudConn',       // which launch path registered it
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

/**
 * Clear the connection. When `source` is given, clears ONLY if it matches the
 * current connection's source — so a legacy disconnect can never wipe an active
 * `#erpLaunch` connection (and vice-versa).
 */
export function clearErpConnection(source) {
  if (_conn === null) return
  if (source && _conn.source !== source) return
  _conn = null
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
 * authenticated service auto-refresh the moment a connection becomes available,
 * regardless of which launch path provided it.
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
