// liveSyncQueue.js — durable transactional outbox for live ERP geometry sync.
//
// THE single seam every sync path uses: enqueueGeometryOps([{opType,payload}]).
// A single worker drains FIFO + sequentially (await per op) so emission order ==
// execution order — parent-before-child dependency and id-map threading fall out
// for free. Ops persist to IDB (survives crash/reload/offline). Retries use
// exponential backoff; 4xx validation errors dead-letter (won't fix on retry).
//
// Runs ENTIRELY off the render path. A sync failure never throws into, blocks,
// or rolls back local editor state — it lands in the queue and surfaces on the
// status badge. Only active between init…teardown (ERP-launch mode only).

import { getAssetStorage } from './storage/getAssetStorage.js'
import { DB_STORES } from './storage/indexedDb.js'
import { fireLiveOp } from './liveSync.js'

const MAX_ATTEMPTS = 5
const BACKOFF_MS = [1000, 2000, 4000, 4000] // 1s → 2s → 4s (cap), 4 waits ⇒ 5 attempts

let _buildingId = null
let _active = false
let _queue = []        // [{ id, opType, payload, attempts, status, error }]
let _draining = false
let _seq = 0
let _resyncBuilder = null
const _listeners = new Set()

function _idbKey() { return `liveSyncQueue:${_buildingId}` }

async function _persist() {
  if (!_buildingId) return
  try { await getAssetStorage().put(DB_STORES.METADATA, _idbKey(), { value: _queue }) }
  catch (e) { console.warn('[liveSyncQueue] persist failed', e) }
}

async function _loadPersisted() {
  try {
    const rec = await getAssetStorage().get(DB_STORES.METADATA, _idbKey())
    if (rec && Array.isArray(rec.value)) {
      _queue = rec.value
      // Anything mid-flight when we last died resumes as pending.
      for (const o of _queue) if (o.status === 'inflight') o.status = 'pending'
    }
  } catch (e) { console.warn('[liveSyncQueue] load failed', e) }
}

// ── Status pub/sub (drives SyncStatusBadge) ──────────────────────────────────

// Memoised snapshot: getSyncStatus is the getSnapshot for useSyncExternalStore,
// which compares snapshots with Object.is. Returning a fresh object literal on
// every call would signal "changed" on every render → infinite re-render
// ("Maximum update depth exceeded"). We recompute the primitive fields, and
// only allocate a NEW object when one of them actually changes — otherwise the
// previous reference is returned so React sees a stable snapshot.
let _statusCache = { active: false, draining: false, pending: 0, failed: 0, total: 0 }

export function getSyncStatus() {
  let pending = 0, failed = 0
  for (const o of _queue) {
    if (o.status === 'failed' || o.status === 'dead') failed++
    else pending++
  }
  const c = _statusCache
  if (c.active === _active && c.draining === _draining
    && c.pending === pending && c.failed === failed && c.total === _queue.length) {
    return c
  }
  _statusCache = { active: _active, draining: _draining, pending, failed, total: _queue.length }
  return _statusCache
}
export function subscribeSyncStatus(fn) { _listeners.add(fn); return () => _listeners.delete(fn) }
function _notify() { const s = getSyncStatus(); for (const fn of _listeners) { try { fn(s) } catch { /* */ } } }

// ── Lifecycle ────────────────────────────────────────────────────────────────

export async function initLiveSyncQueue(buildingId) {
  _buildingId = buildingId
  _active = true
  _queue = []
  await _loadPersisted()
  _notify()
  _drain() // resume persisted work
}

export function teardownLiveSyncQueue() {
  _active = false; _buildingId = null; _queue = []; _draining = false
  _resyncBuilder = null; _listeners.clear()
}

export function isQueueActive() { return _active }

/** resyncAll re-emits the whole building from current store state. */
export function setResyncBuilder(fn) { _resyncBuilder = fn }

// ── Enqueue (the single seam) ────────────────────────────────────────────────

export function enqueueGeometryOps(ops) {
  if (!_active || !ops || ops.length === 0) return
  for (const op of ops) {
    if (!op || !op.opType) continue
    _queue.push({ id: `op_${++_seq}`, opType: op.opType, payload: op.payload ?? {}, attempts: 0, status: 'pending', error: null })
  }
  _persist(); _notify(); _drain()
}

// ── Worker ───────────────────────────────────────────────────────────────────

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function _isPermanent(err) {
  const m = String(err?.message ?? '')
  const match = m.match(/→ (\d{3}):/) // liveSync throws "… → <status>: <body>"
  if (!match) return false // network/unknown → retryable
  const code = Number(match[1])
  return code >= 400 && code < 500 && code !== 408 && code !== 429
}

async function _drain() {
  if (_draining || !_active) return
  _draining = true; _notify()
  try {
    while (_active) {
      const item = _queue.find((o) => o.status === 'pending')
      if (!item) break
      item.status = 'inflight'
      try {
        await fireLiveOp(item.opType, item.payload) // uses the conn from initLiveSync
        _queue = _queue.filter((o) => o.id !== item.id) // success → drop
        await _persist(); _notify()
      } catch (err) {
        item.attempts += 1
        item.error = String(err?.message ?? err)
        if (_isPermanent(err)) {
          item.status = 'dead'
          await _persist(); _notify()
        } else if (item.attempts >= MAX_ATTEMPTS) {
          item.status = 'failed'
          await _persist(); _notify()
        } else {
          item.status = 'pending' // retry in place — preserves order
          await _persist(); _notify()
          await _sleep(BACKOFF_MS[Math.min(item.attempts - 1, BACKOFF_MS.length - 1)])
        }
      }
    }
  } finally {
    _draining = false; _notify()
  }
}

// ── Recovery actions (badge buttons) ─────────────────────────────────────────

export function retryFailed() {
  for (const o of _queue) {
    if (o.status === 'failed' || o.status === 'dead') { o.status = 'pending'; o.attempts = 0; o.error = null }
  }
  _persist(); _notify(); _drain()
}

export function resyncAll() {
  if (!_resyncBuilder) return
  let ops = []
  try { ops = _resyncBuilder() || [] } catch (e) { console.warn('[liveSyncQueue] resync build failed', e) }
  enqueueGeometryOps(ops)
}
