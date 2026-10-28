import { enqueueGeometryOps } from './liveSyncQueue.js'
import { buildFullSyncOps } from './syncEmitters.js'
// The sole store subscriber: persist the exact canonical snapshot locally, then
// durably enqueue its projection batch. The queue uploads that snapshot, declares
// server lineage, executes acknowledged mutations and seals the checkpoint.

import { buildSnapshotDoc } from './canonicalDoc.js'
import { getAssetStorage } from './storage/getAssetStorage.js'
import { DB_STORES } from './storage/indexedDb.js'
import { noteCanonicalDirty } from './canonicalSyncQueue.js'
import { flushSyncEngine, reconcileSyncEngine } from './syncEngine.js'
import { isEditorHardReadOnly } from './editorWriteGuard.js'

let _store = null
let _buildingId = null
let _active = false
let _unsub = null
let _scheduled = false
let _running = false
let _rerun = false
let _fullSyncRequested = false

export function startSyncCoordinator(store, buildingId) {
  if (_active) return
  _store = store
  _buildingId = buildingId
  _active = true
  _unsub = store.subscribe(() => _schedule())
}

export function stopSyncCoordinator() {
  if (_unsub) { _unsub(); _unsub = null }
  _store = null; _buildingId = null; _active = false
  _scheduled = false; _running = false; _rerun = false; _fullSyncRequested = false
}

function _schedule() {
  if (!_active || _scheduled) return
  _scheduled = true
  queueMicrotask(_tick)
}

async function _tick() {
  _scheduled = false
  if (!_active || !_store) return
  // HARD write gate ONLY: a failed reopen (integrity) or a diverged base (stale base)
  // blocks ALL writes so a blank/partial or diverged canvas can never overwrite good
  // canonical data. NOT gated on mere connection loss — offline edits MUST still be
  // accepted to the local IDB snapshot (offline-first durability); the upload outbox
  // pauses instead and replays on reconnect. No accept, no emit only when HARD.
  if (isEditorHardReadOnly()) return
  const st = _store.getState()
  if (st._inBatch) { _schedule(); return } // wait until the atomic batch closes
  if (_running) { _rerun = true; return }   // a change arrived mid-accept → re-run after
  _running = true
  const fullSync = _fullSyncRequested
  _fullSyncRequested = false
  try {
    // (1) ACCEPT — durable LOCAL canonical persistence + enqueue upload. Pinned to
    //     `st` so accept + emit describe the exact same committed state.
    const doc = await buildSnapshotDoc(st)
    await getAssetStorage().put(DB_STORES.SNAPSHOTS, `${_buildingId}`, doc)
    noteCanonicalDirty()
    // (2) EMIT — the projection diff, only now that acceptance is durable (#5).
    if (fullSync) {
      await enqueueGeometryOps(buildFullSyncOps(st), doc)
      reconcileSyncEngine(st)
    } else {
      await flushSyncEngine(st, doc)
    }
  } catch (e) {
    if (fullSync) _fullSyncRequested = true
    // Acceptance failed → the projection is NOT emitted (#5). Do NOT hot-reschedule
    // (that would spin on a persistent failure); the next committed change
    // re-accepts. `_shadow` is only advanced on a successful emit, so no diff is
    // lost across changes.
    console.warn('[syncCoordinator] canonical write tick failed — projection withheld', e)
  } finally {
    _running = false
    if (_rerun) { _rerun = false; _schedule() } // a change that arrived mid-tick
  }
}

// Test seam — run one accept→emit tick deterministically (no microtask wait).
export async function _tickForTest() { await _tick() }

/** Resync uses the same serialized snapshot acceptance as incremental edits. */
export function requestFullSync() {
  _fullSyncRequested = true
  _schedule()
}
