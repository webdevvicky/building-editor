// Debounced autosave from the Zustand store into IDB (via manager.js).
//
// Phase 4 Tier-2 (Phase B). Was localStorage-backed; now writes through
// the IDB-canonical manager facade. The sync `saveCurrent(id, data)` returns
// immediately (queueing the async IDB write); the chunk-split + persist
// happens in createPersistence(idbStorage)::saveCurrent internally so only
// the changed slice writes per autosave tick.
//
// Snapshot shape matches the canonical save format (version: 7 here).

import { saveCurrent } from './manager'
import { buildSnapshot } from './_snapshot.js'
import { toast } from '../components/ui/Toast'
import { getCachedConn } from './cloudConn.js'
import * as cloudSync from './cloudSync.js'

const DEBOUNCE_MS = 30_000

export function installAutosave(store, getProjectId) {
  let timer    = null
  let disposed = false

  function flush() {
    timer = null
    if (disposed) return
    const id = getProjectId()
    if (!id) return
    const state = store.getState()
    const snap  = buildSnapshot(state)
    const ok    = saveCurrent(id, snap)
    // TEMP debug trace — remove after verifying the connect→sync chain.
    console.log('[autosave] fired, projectId=', id, 'savedOk=', ok)
    if (ok !== false) toast.info('Auto-saved', { duration: 1500 })

    // Fire-and-forget cloud push AFTER local save succeeds. The connection is
    // global; only push when it is BOUND to the project we just saved
    // (conn.localProjectId === id) — never push an unrelated local project to
    // the connected ERP project. Failures are captured inside syncToCloud and
    // surfaced via the sync-status store (SyncStatusBadge).
    if (ok !== false) {
      const conn = getCachedConn()
      if (conn && conn.localProjectId === id) {
        cloudSync.syncToCloud(state, conn)
      }
    }
  }

  function schedule() {
    if (disposed) return
    // Reflect pending edits in the badge immediately (the actual push is
    // debounced). Only when a connection is bound to the current project —
    // otherwise the badge stays idle. markUnsynced is a no-op while a push is
    // in flight, so it won't stomp the 'syncing' state.
    const conn = getCachedConn()
    if (conn && conn.localProjectId === getProjectId()) {
      cloudSync.markUnsynced()
    }
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(flush, DEBOUNCE_MS)
  }

  const unsub = store.subscribe(() => { schedule() })

  // Best-effort flush on tab close. IDB writes are fire-and-forget here;
  // most browsers complete pending IDB transactions during unload.
  function onUnload() { flush() }
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', onUnload)
  }

  return function uninstall() {
    disposed = true
    if (timer !== null) { clearTimeout(timer); timer = null }
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', onUnload)
    }
    unsub()
  }
}

// buildSnapshot is re-exported from src/projects/_snapshot.js (extracted
// so Node verify scripts can import without pulling Toast.jsx).
export { buildSnapshot } from './_snapshot.js'
