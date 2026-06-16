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
import { getCloudConn } from './cloudConn.js'
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

    // Fire-and-forget cloud push AFTER local save succeeds.
    // Failures are captured inside syncToCloud and surfaced via the
    // sync-status store (SyncStatusBadge). We never await this here.
    if (ok !== false) {
      getCloudConn(id).then((conn) => {
        // TEMP debug trace — remove after verifying the connect→sync chain.
        console.log('[autosave] getCloudConn →', conn ? 'CONNECTED → syncing' : 'null → skip sync')
        if (!conn) return
        cloudSync.syncToCloud(state, conn)
      }).catch(() => { /* getCloudConn errors are non-fatal for autosave */ })
    }
  }

  function schedule() {
    if (disposed) return
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
