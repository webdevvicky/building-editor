// syncCoordinator.js — Phase 2.5A (Invariants #5/#7): the ONE ordered editor
// write pipeline.
//
// Replaces the two previously-independent store subscriptions (syncEngine
// self-subscribe + canonicalAutosave debounce) with a single coordinator so that,
// on every committed change:
//   (1) ACCEPT — the canonical snapshot is durably persisted to the LOCAL store
//       (IDB SNAPSHOTS) and enqueued for upload (dirty flag persisted to METADATA),
//   (2) EMIT  — only THEN does the projection diff enter the live-sync queue.
// The R2 upload stays asynchronous + debounced. A projection op can therefore
// never precede canonical acceptance (#5), and each accepted mutation yields
// exactly one canonical lineage + one projection lineage (#7).
//
// ONLY the ordering between canonical acceptance and projection emission changes.
// The diff algorithm, queue semantics, liveSync behavior, projection behavior,
// checksum, canonical snapshot format, and upload logic are all UNCHANGED.
//
// "Accept" = canonical snapshot durably persisted locally AND an upload durably
// enqueued — NOT remote R2 completion.

import { buildSnapshotDoc } from './canonicalDoc.js'
import { getAssetStorage } from './storage/getAssetStorage.js'
import { DB_STORES } from './storage/indexedDb.js'
import { noteCanonicalDirty, pumpCanonicalUpload } from './canonicalSyncQueue.js'
import { flushSyncEngine } from './syncEngine.js'

const UPLOAD_DEBOUNCE_MS = 10_000

let _store = null
let _buildingId = null
let _active = false
let _unsub = null
let _scheduled = false
let _running = false
let _rerun = false
let _uploadTimer = null
let _uploadDebounceMs = UPLOAD_DEBOUNCE_MS

export function startSyncCoordinator(store, buildingId, opts = {}) {
  if (_active) return
  _store = store
  _buildingId = buildingId
  _active = true
  _uploadDebounceMs = opts.uploadDebounceMs ?? UPLOAD_DEBOUNCE_MS
  _unsub = store.subscribe(() => _schedule())
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', _onUnload)
}

export function stopSyncCoordinator() {
  if (_unsub) { _unsub(); _unsub = null }
  if (_uploadTimer !== null) { clearTimeout(_uploadTimer); _uploadTimer = null }
  if (typeof window !== 'undefined') window.removeEventListener('beforeunload', _onUnload)
  _store = null; _buildingId = null; _active = false
  _scheduled = false; _running = false; _rerun = false
}

function _schedule() {
  if (!_active || _scheduled) return
  _scheduled = true
  queueMicrotask(_tick)
}

function _scheduleUpload() {
  if (_uploadTimer !== null) clearTimeout(_uploadTimer)
  _uploadTimer = setTimeout(() => { _uploadTimer = null; pumpCanonicalUpload() }, _uploadDebounceMs)
}

function _onUnload() {
  // Best-effort: push the latest ACCEPTED snapshot immediately on tab close. The
  // dirty flag is already durable in IDB, so a failed unload upload still resumes
  // on next launch.
  if (_uploadTimer !== null) { clearTimeout(_uploadTimer); _uploadTimer = null }
  pumpCanonicalUpload()
}

async function _tick() {
  _scheduled = false
  if (!_active || !_store) return
  const st = _store.getState()
  if (st._inBatch) { _schedule(); return } // wait until the atomic batch closes
  if (_running) { _rerun = true; return }   // a change arrived mid-accept → re-run after
  _running = true
  try {
    // (1) ACCEPT — durable LOCAL canonical persistence + enqueue upload. Pinned to
    //     `st` so accept + emit describe the exact same committed state.
    const doc = await buildSnapshotDoc(st)
    await getAssetStorage().put(DB_STORES.SNAPSHOTS, `${_buildingId}`, doc)
    noteCanonicalDirty()
    _scheduleUpload()
    // (2) EMIT — the projection diff, only now that acceptance is durable (#5).
    flushSyncEngine(st)
  } catch (e) {
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
