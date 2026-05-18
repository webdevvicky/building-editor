// Phase 2.0 — debounced autosave from the Zustand store into localStorage.
//
// installAutosave(store, getProjectId) returns an uninstaller. The store
// subscription fires on every state change; we debounce writes by 30 s so
// rapid edits coalesce into a single persistence write.
//
// Snapshot shape matches the canonical save format (version: 7 here).

import { saveCurrent } from './manager'
import { toast } from '../components/ui/Toast'

const DEBOUNCE_MS = 30_000

// Build the snapshot to save. Pure function of the store state.
function buildSnapshot(s) {
  return {
    version:         7,
    nodes:           s.nodes,
    walls:           s.walls,
    rooms:           s.rooms,
    stamps:          s.stamps,
    columns:         s.columns,
    beams:           s.beams,
    slabs:           s.slabs,
    staircases:      s.staircases,
    foundations:     s.foundations,
    ratesByKey:      s.ratesByKey ?? {},
    projectSettings: s.projectSettings,
  }
}

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
  }

  function schedule() {
    if (disposed) return
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(flush, DEBOUNCE_MS)
  }

  // Zustand subscribe returns its own unsubscribe.
  const unsub = store.subscribe(() => { schedule() })

  // Best-effort flush on tab close.
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
