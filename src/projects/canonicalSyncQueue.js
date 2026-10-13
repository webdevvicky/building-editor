// canonicalSyncQueue.js — Phase 1: durable upload outbox for the canonical
// Building Document, plus the ERP-mode autosave installer.
//
// Latest-wins, single-slot semantics: only the newest snapshot matters, so the
// queue tracks a single "dirty" doc (held in the IDB SNAPSHOTS store keyed by
// buildingId) plus the baseVersion. On a store change the autosave writes the doc
// to IDB and marks the queue dirty; the queue uploads it with the baseVersion,
// advances baseVersion from the PUT response and retries transient failures with
// backoff.
//
// THE SAVE RULE (XR-05, XR-15): `baseVersion` is the server document version the
// canvas content DESCENDS FROM — set only when the canvas is loaded from a server
// document (reopen) or by this queue's own accepted PUT. It is never re-seeded
// from a server fetch, so an upload can only ever land on the version it was
// edited from. A 409 (stale base) is never answered by re-sending on the newer
// number (that was last-writer-wins): if the server's document is byte-identical to
// ours (checksum) it was our own write whose response was lost, and we adopt its
// number; otherwise another writer is ahead — the local copy is kept aside
// (`keepClashCopy`, the server also quarantined it), the editor latches read-only
// and the user reloads to open the newer version.
//
// Durable: { baseVersion, dirty } persists to IDB METADATA so an unsent snapshot
// survives a refresh / browser restart; reopen (canonicalReopen) decides from it
// whether that snapshot is the newest copy (same base as the server) or a clash.
//
// Off the render path, fail-soft: a sync failure never throws into the store. It
// NEVER touches liveSyncQueue or the PostgreSQL projection (separate path).

import { getAssetStorage } from './storage/getAssetStorage.js'
import { DB_STORES } from './storage/indexedDb.js'
import {
  buildSnapshotDoc,
  putCanonicalDocument,
  getCanonicalDocument,
  statusCodeFromError,
} from './canonicalDoc.js'
import { isEditorReadOnly, engageEditorReadOnly } from './editorWriteGuard.js'

const MAX_ATTEMPTS = 5
const BACKOFF_MS = [1000, 2000, 4000, 4000]

let _active = false
let _conn = null
let _buildingId = null
let _baseVersion = 0
let _dirty = false
let _dirtySeq = 0
let _inflight = false
let _failed = false
let _attempts = 0
let _lastError = null
let _pumping = false
const _listeners = new Set()

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function _snapKey() { return `${_buildingId}` }
function _metaKeyFor(buildingId) { return `canonicalSyncQueue:${buildingId}` }
function _metaKey() { return _metaKeyFor(_buildingId) }

// ── Status pub/sub (for an optional badge; no UI is wired in Phase 1) ────────
let _statusCache = { active: false, inflight: false, dirty: false, failed: false, baseVersion: 0 }
export function getCanonicalSyncStatus() {
  const c = _statusCache
  if (c.active === _active && c.inflight === _inflight && c.dirty === _dirty
    && c.failed === _failed && c.baseVersion === _baseVersion) {
    return c
  }
  _statusCache = {
    active: _active, inflight: _inflight, dirty: _dirty,
    failed: _failed, baseVersion: _baseVersion, lastError: _lastError,
  }
  return _statusCache
}
export function subscribeCanonicalSyncStatus(fn) { _listeners.add(fn); return () => _listeners.delete(fn) }
function _notify() { const s = getCanonicalSyncStatus(); for (const fn of _listeners) { try { fn(s) } catch { /* */ } } }

// ── Persistence ──────────────────────────────────────────────────────────────
async function _persist() {
  if (!_buildingId) return
  try {
    await getAssetStorage().put(DB_STORES.METADATA, _metaKey(), {
      value: { baseVersion: _baseVersion, dirty: _dirty },
    })
  } catch (e) { console.warn('[canonicalSyncQueue] persist failed', e) }
}
async function _loadPersisted() {
  const meta = await readCanonicalQueueMeta(_buildingId)
  if (meta) {
    _baseVersion = meta.baseVersion
    _dirty = meta.dirty
  }
}

/**
 * The durable queue state of a building — `{ baseVersion, dirty }` (the server version
 * the local snapshot descends from, and whether it is unsent) — or null. Read by
 * reopen BEFORE the queue starts, to tell an unsent newest copy from a clash.
 */
export async function readCanonicalQueueMeta(buildingId) {
  try {
    const rec = await getAssetStorage().get(DB_STORES.METADATA, _metaKeyFor(buildingId))
    if (rec && rec.value) return { baseVersion: rec.value.baseVersion ?? 0, dirty: !!rec.value.dirty }
  } catch (e) { console.warn('[canonicalSyncQueue] load failed', e) }
  return null
}

/** Overwrite a building's durable queue state (reopen does this when it resolves a clash). */
export async function writeCanonicalQueueMeta(buildingId, { baseVersion, dirty }) {
  await getAssetStorage().put(DB_STORES.METADATA, _metaKeyFor(buildingId), { value: { baseVersion, dirty } })
}

/**
 * Keep a local snapshot that lost a version clash, so the user's work is never
 * destroyed (the server also quarantined it on the refused PUT). Stored beside the
 * live snapshot under a key nothing loads automatically.
 */
export async function keepClashCopy(buildingId, doc, baseVersion) {
  try {
    await getAssetStorage().put(DB_STORES.SNAPSHOTS, `${buildingId}:clash:v${baseVersion}:${Date.now()}`, doc)
  } catch (e) { console.warn('[canonicalSyncQueue] keeping the clash copy failed', e) }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
/**
 * Start the upload queue for a building. `opts.knownBaseVersion` is the server
 * version the canvas was just loaded from (reopen's `snapshotVersion`); without it
 * the persisted base stands (an offline reopen of the local copy) or 0 (a new
 * building). The base is NEVER taken from a fresh server fetch — that would let an
 * old local copy upload on a newer number (XR-15).
 */
export async function initCanonicalSyncQueue(conn, buildingId, opts = {}) {
  _conn = conn
  _buildingId = buildingId
  _active = true
  _failed = false
  _attempts = 0
  _lastError = null
  _baseVersion = 0
  _dirty = false
  await _loadPersisted() // restores baseVersion + any unsent-dirty flag from a prior session
  if (typeof opts.knownBaseVersion === 'number') _baseVersion = opts.knownBaseVersion
  await _persist()
  _notify()
  if (_dirty) _pump() // resume an unsent snapshot that reopen confirmed descends from the server's version
}

export function teardownCanonicalSyncQueue() {
  _active = false
  _conn = null
  _buildingId = null
  _dirty = false
  _failed = false
  _inflight = false
  _pumping = false
  _listeners.clear()
}

export function getCanonicalBaseVersion() { return _baseVersion }
export function isCanonicalDirty() { return _dirty }

// Test seam — mark dirty WITHOUT kicking the production pump, so verify scripts
// can drive sync() deterministically (no timers). Not used by production code.
export function _setDirtyForTest() { _dirty = true; _dirtySeq++ }

/** Mark the IDB-held snapshot as needing upload (called by the autosave). */
export function markSnapshotDirty() {
  if (!_active) return
  _dirty = true
  _dirtySeq++
  _failed = false
  _attempts = 0
  _persist()
  _notify()
  _pump()
}

export function retryCanonicalUpload() {
  _failed = false
  _attempts = 0
  _notify()
  _pump()
}

/**
 * Phase 2.5A (#5) — mark the IDB-held snapshot as ACCEPTED (durably persisted +
 * enqueued for upload) WITHOUT kicking the upload pump. The sync coordinator
 * schedules the debounced upload itself, decoupling canonical acceptance from R2
 * completion. Same durable dirty/persist semantics as markSnapshotDirty, minus
 * the immediate _pump().
 */
export function noteCanonicalDirty() {
  if (!_active) return
  _dirty = true
  _dirtySeq++
  _failed = false
  _attempts = 0
  _persist()
  _notify()
}

/** Kick the upload worker — the coordinator's debounced upload + unload flush. */
export function pumpCanonicalUpload() { _pump() }

// ── Worker ───────────────────────────────────────────────────────────────────

function _isPermanentStatus(status) {
  // 409 is handled separately (stale base). 401/403/408/429/5xx/network retry.
  return status === 400 || status === 404 || status === 422
}
function _backoff(n) { return BACKOFF_MS[Math.min(Math.max(n - 1, 0), BACKOFF_MS.length - 1)] }

const CLASH_MESSAGE =
  'Someone else saved a newer version of this design while you were editing. Your changes were kept ' +
  'aside and have NOT overwritten theirs. Editing is paused — reload to open the newer version.'

/**
 * A 409: the server's document is not the version we edited from. Never re-send on
 * its number. Either the server holds OUR document (an earlier PUT landed and its
 * response was lost — same checksum) and we adopt its version, or another writer is
 * ahead and this is a clash: keep the copy aside, stop, and make the user reload.
 */
async function _onStaleBase(doc, seqAtStart) {
  let server = null
  try { server = await getCanonicalDocument(_conn, _buildingId) } catch { /* offline — cannot tell yet */ }
  if (!server || typeof server.snapshotVersion !== 'number') {
    _attempts++
    if (_attempts >= MAX_ATTEMPTS) { _failed = true; _lastError = 'conflict-unverified' }
    await _persist()
    _notify()
    return _failed ? 'failed' : 'retry'
  }
  if (server.checksum && server.checksum === doc.checksum) {
    _baseVersion = server.snapshotVersion
    _attempts = 0
    if (_dirtySeq === seqAtStart) _dirty = false
    await _persist()
    _notify()
    return 'uploaded'
  }
  await keepClashCopy(_buildingId, doc, _baseVersion)
  _dirty = false // the server quarantined this copy and the clash copy holds it; reload must not re-send it
  _failed = true
  _lastError = 'conflict'
  await _persist()
  _notify()
  engageEditorReadOnly(CLASH_MESSAGE)
  return 'conflict'
}

/**
 * Single upload attempt (also the deterministic test seam — no timers inside).
 * Returns one of: 'idle' | 'uploaded' | 'retry' | 'conflict' | 'failed'.
 */
export async function sync() {
  // Write gate: refuse to upload after a failed reopen — a blank/partial canvas must
  // never overwrite good canonical data (the base-version CAS can't catch this).
  if (!_active || _inflight || _failed || !_dirty || isEditorReadOnly()) return 'idle'
  const seqAtStart = _dirtySeq
  const doc = await getAssetStorage().get(DB_STORES.SNAPSHOTS, _snapKey())
  if (!doc || !doc.payload) { _dirty = false; await _persist(); _notify(); return 'idle' }

  _inflight = true
  _notify()
  try {
    const res = await putCanonicalDocument(_conn, _buildingId, {
      baseVersion: _baseVersion,
      schemaVersion: doc.schemaVersion,
      checksum: doc.checksum,
      payload: doc.payload,
    })
    _inflight = false
    _attempts = 0
    _failed = false
    if (res && typeof res.snapshotVersion === 'number') _baseVersion = res.snapshotVersion
    // Only clear dirty if no newer snapshot was written while this was in flight.
    if (_dirtySeq === seqAtStart) _dirty = false
    await _persist()
    _notify()
    return 'uploaded'
  } catch (err) {
    _inflight = false
    const status = statusCodeFromError(err)
    if (status === 409) return _onStaleBase(doc, seqAtStart)
    if (_isPermanentStatus(status)) {
      _failed = true
      _lastError = String(err?.message ?? err)
      await _persist()
      _notify()
      return 'failed'
    }
    // Transient (network / 401 / 403 / 408 / 429 / 5xx) — retry with backoff.
    _attempts++
    if (_attempts >= MAX_ATTEMPTS) { _failed = true; _lastError = String(err?.message ?? err) }
    await _persist()
    _notify()
    return _failed ? 'failed' : 'retry'
  }
}

// Production scheduler — drives sync() + backoff. Tests call sync() directly.
function _pump() {
  if (_pumping) return
  _pumping = true
  ;(async () => {
    try {
      while (_active && _dirty && !_failed && !_inflight) {
        const r = await sync()
        if (r === 'uploaded') { if (_dirty) continue; else break }
        if (r === 'retry') {
          await _sleep(_backoff(_attempts))
          continue
        }
        break // idle | conflict | failed
      }
    } finally {
      _pumping = false
    }
  })()
}

// ── Autosave installer (Phase 1.4 — ERP-mode IDB autosave keyed by buildingId) ─
//
// Re-enables durable local persistence in ERP mode (where the legacy
// project-id autosave is a no-op). On a debounced store change it writes the
// canonical document to IDB SNAPSHOTS[buildingId] and marks the upload queue
// dirty. Only fires when the store actually changed since the last write, so
// open-without-edit performs no write (no Phase-3 backfill).

const AUTOSAVE_DEBOUNCE_MS = 10_000

export function installCanonicalAutosave(store, buildingId, opts = {}) {
  const debounceMs = opts.debounceMs ?? AUTOSAVE_DEBOUNCE_MS
  let timer = null
  let disposed = false
  let changed = false

  async function flush() {
    timer = null
    if (disposed || !changed) return
    changed = false
    try {
      const doc = await buildSnapshotDoc(store.getState())
      await getAssetStorage().put(DB_STORES.SNAPSHOTS, `${buildingId}`, doc)
      markSnapshotDirty()
    } catch (e) {
      changed = true // keep dirty for the next tick
      console.warn('[canonicalAutosave] flush failed', e)
    }
  }

  function schedule() {
    if (disposed) return
    changed = true
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(flush, debounceMs)
  }

  const unsub = store.subscribe(() => schedule())

  // Best-effort flush on tab close so a refresh/restart never loses edits.
  function onUnload() { if (changed) flush() }
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', onUnload)

  return {
    flushNow: flush, // test seam + explicit flush
    uninstall() {
      disposed = true
      if (timer !== null) { clearTimeout(timer); timer = null }
      if (typeof window !== 'undefined') window.removeEventListener('beforeunload', onUnload)
      unsub()
    },
  }
}
