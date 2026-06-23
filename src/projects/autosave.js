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
    if (ok !== false) toast.info('Auto-saved', { duration: 1500 })

    // DATA SAFETY: autosave writes to LOCAL IDB ONLY. It must NEVER push to the
    // ERP cloud — an automatic push here was firing on every store change once a
    // connection was bound (incl. during the connect handoff, before the remote
    // snapshot was adopted), overwriting the real R2 snapshot with the empty
    // canvas and wiping the DB on re-import. Cloud sync is now EXPLICIT only:
    // `schedule()` flags the badge unsynced, and the user pushes via the
    // "Sync Now" button (SyncStatusBadge → syncToCloud). The connect handoff
    // pulls/adopts and likewise never pushes.
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
