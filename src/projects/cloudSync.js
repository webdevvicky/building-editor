// Cloud sync — push/pull snapshots to/from the ERP.
//
// syncToCloud: build snapshot → exchange token → PUT to ERP. Never throws
//   to the caller — returns { ok, snapshotVersion, lastSyncedAt } or
//   { ok: false, error }.
//
// pullFromCloud: GET snapshot JSON from ERP.
//
// Module-level sync-status store (subscribable):
//   status: 'idle' | 'syncing' | 'synced' | 'unsynced' | 'error'
//   lastError: string | null
//   lastSyncedAt: string | null   (ISO, from ERP response)
//
// SyncStatusBadge subscribes to this store to update its indicator.

import { buildSnapshot } from './_snapshot.js'
import { buildPackage } from '../boq/buildPackage.js'
import { getValidAccessToken } from './cloudConn.js'

// ── Sync-status store ────────────────────────────────────────────────────────

const _state = {
  status: 'idle',
  lastError: null,
  lastSyncedAt: null,
}
const _listeners = new Set()

function _setState(partial) {
  Object.assign(_state, partial)
  for (const fn of _listeners) {
    try { fn({ ..._state }) } catch { /* swallow */ }
  }
}

/**
 * Subscribe to sync-status changes. Immediately calls fn with the current
 * state. Returns an unsubscribe function.
 * @param {(state:{status,lastError,lastSyncedAt})=>void} fn
 * @returns {()=>void}
 */
export function subscribeSyncStatus(fn) {
  _listeners.add(fn)
  fn({ ..._state })
  return () => { _listeners.delete(fn) }
}

/**
 * Returns a snapshot of the current sync status.
 * @returns {{status:string,lastError:string|null,lastSyncedAt:string|null}}
 */
export function getSyncStatus() {
  return { ..._state }
}

// ── Push ─────────────────────────────────────────────────────────────────────

/**
 * Serialise the store state and PUT it to the ERP. Never throws — any
 * failure is captured and returned as { ok: false, error }.
 *
 * @param {object} state  Zustand store state (useStore.getState())
 * @param {{erpUrl:string,editorProjectId:string,apiKey:string}} conn
 * @returns {Promise<{ok:true,snapshotVersion:number,lastSyncedAt:string}|{ok:false,error:string}>}
 */
export async function syncToCloud(state, conn) {
  _setState({ status: 'syncing', lastError: null })
  try {
    // snapshot = full editor model (cloud backup + restore); package = the
    // BuildingModelPackage the ERP import engine consumes. Sending both lets the
    // ERP auto-publish the building model while preserving a full restore copy.
    const snapshot = buildSnapshot(state)
    let buildingPackage = null
    try { buildingPackage = buildPackage(state) } catch { buildingPackage = null }
    const accessToken = await getValidAccessToken(conn)

    const url = `${conn.erpUrl.replace(/\/$/, '')}/api/v1/editor-projects/${conn.editorProjectId}/snapshot`
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ snapshot, package: buildingPackage }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const error = `Push failed (${res.status}): ${body.slice(0, 200)}`
      _setState({ status: 'error', lastError: error })
      return { ok: false, error }
    }

    const { snapshotVersion, lastSyncedAt } = await res.json()
    _setState({ status: 'synced', lastError: null, lastSyncedAt: lastSyncedAt ?? null })
    return { ok: true, snapshotVersion, lastSyncedAt }
  } catch (err) {
    const error = err?.message ?? String(err)
    _setState({ status: 'error', lastError: error })
    return { ok: false, error }
  }
}

// ── Pull ─────────────────────────────────────────────────────────────────────

/**
 * Fetch the latest snapshot from the ERP.
 *
 * @param {{erpUrl:string,editorProjectId:string,apiKey:string}} conn
 * @returns {Promise<{ok:true,snapshot:object}|{ok:false,error:string}>}
 */
export async function pullFromCloud(conn) {
  try {
    const accessToken = await getValidAccessToken(conn)

    const url = `${conn.erpUrl.replace(/\/$/, '')}/api/v1/editor-projects/${conn.editorProjectId}/snapshot`
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `Pull failed (${res.status}): ${body.slice(0, 200)}` }
    }

    const body = await res.json()
    // The stored payload is { snapshot, package }; older payloads were the bare snapshot.
    const snapshot = body?.snapshot ?? body
    return { ok: true, snapshot }
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) }
  }
}

/**
 * Mark the local project as unsynced (call when the user makes edits after
 * the last successful push, so the badge reflects the true state).
 */
export function markUnsynced() {
  if (_state.status !== 'syncing') {
    _setState({ status: 'unsynced' })
  }
}

/**
 * Mark synced without performing a push — used when the editor ADOPTS the ERP
 * snapshot on connect (ERP is the source of truth, so local already matches the
 * remote). syncToCloud handles the synced state for actual pushes.
 * @param {string|null} [lastSyncedAt]
 */
export function markSynced(lastSyncedAt = null) {
  _setState({ status: 'synced', lastError: null, lastSyncedAt })
}

/**
 * Reset the badge to idle — used when the active project is no longer the one
 * bound to the cloud connection (or the connection was cleared).
 */
export function markIdle() {
  _setState({ status: 'idle', lastError: null })
}
