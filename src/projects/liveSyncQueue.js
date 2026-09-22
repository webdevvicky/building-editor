// liveSyncQueue.js — durable transactional outbox for live ERP geometry sync.
//
// THE single seam every sync path uses: enqueueGeometryOps([{opType,payload}]).
// A single worker drains FIFO + sequentially (await per op) so emission order ==
// execution order. That gives parent-before-child ordering and id-map threading
// for as long as the head keeps moving — but NOT once an op stops being
// dispatchable (it dead-lettered, or the queue was persisted and reloaded into a
// session whose id map starts empty). A child dispatched past its parent resolves
// the parent to null, which is how `/geometry/walls/null/openings` was sent.
// So ordering is stated as well as implied: each op declares what it needs and
// what it will produce (liveSync's `opDependency`), and the drain gate below
// dispatches / waits / drops on that. Ops persist to IDB (survives crash /
// reload / offline). Retries use exponential backoff; 4xx validation errors
// dead-letter (won't fix on retry).
//
// Runs ENTIRELY off the render path. A sync failure never throws into, blocks,
// or rolls back local editor state — it lands in the queue and surfaces on the
// status badge. Only active between init…teardown (ERP-launch mode only).

import { getAssetStorage } from './storage/getAssetStorage.js'
import { DB_STORES } from './storage/indexedDb.js'
import { fireLiveOp, opDependency, resolveErpId } from './liveSync.js'

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
      // Prune stale dead/failed DELETE_* artifacts left by the old /null bug: a
      // DELETE whose target id never resolved used to request /geometry/.../null →
      // 404 → dead-lettered. Deletes are idempotent no-ops (deleting a row that
      // doesn't exist is success), so these are not real failures — drop them.
      _queue = _queue.filter((o) =>
        !((o.status === 'dead' || o.status === 'failed') && String(o.opType).startsWith('DELETE_')))
      // Anything mid-flight when we last died resumes as pending. So does
      // anything that was blocked: this session has a fresh id map (seeded from
      // the ERP), so every dependency is re-asked rather than assumed.
      for (const o of _queue) if (o.status === 'inflight' || o.status === 'blocked') o.status = 'pending'
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
let _statusCache = { active: false, draining: false, pending: 0, failed: 0, blocked: 0, total: 0 }

export function getSyncStatus() {
  let pending = 0, failed = 0, blocked = 0
  for (const o of _queue) {
    if (o.status === 'failed' || o.status === 'dead') failed++
    else { pending++; if (o.status === 'blocked') blocked++ }
  }
  const c = _statusCache
  if (c.active === _active && c.draining === _draining
    && c.pending === pending && c.failed === failed && c.blocked === blocked
    && c.total === _queue.length) {
    return c
  }
  _statusCache = { active: _active, draining: _draining, pending, failed, blocked, total: _queue.length }
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
  // Only genuine "won't fix on retry" validation failures dead-letter. 401/403 are
  // transient auth (token expiry / refresh), 408/429 are backpressure, and 5xx are
  // server-side — all of those MUST retry, never drop the op (Phase 0: no silent
  // data loss). Permanent ⇔ 400 (bad request), 404 (gone), 409 (conflict), 422.
  return code === 400 || code === 404 || code === 409 || code === 422
}

// ── Dependency gate ──────────────────────────────────────────────────────────
//
// FIFO + one-at-a-time is the ordering concept, and for a healthy queue it is
// enough: a child is enqueued behind its parent, so the parent's id is already
// registered by the time the child is dispatched. It stops being enough the
// moment the head stops moving in step — the old picker took the first *pending*
// op, which SKIPS a parent sitting in `failed`/`dead` and dispatched the child
// anyway, with its parent id resolving to null (`/geometry/walls/null/openings`).
// A persisted queue reloaded into a fresh session (initLiveSync clears the id
// map) is the same situation.
//
// So a child now states its dependency (opDependency) and the queue answers it
// against the SAME id map the dispatcher will use:
//   • resolved            → dispatch, exactly as before
//   • a queued op will produce it → WAIT (blocked, keeps its place in the queue)
//   • nothing can produce it      → DROP with a reason (never retried for ever)
const _isTerminal = (o) => o.status === 'failed' || o.status === 'dead'

function _dependencyVerdict(item) {
  const { needs } = opDependency(item.opType, item.payload)
  for (const need of needs) {
    if (resolveErpId(need.editorId)) continue

    // Its parent is being deleted in this same queue — the child can never land.
    const deleted = _queue.some(
      (o) => o !== item && opDependency(o.opType, o.payload).destroys.includes(need.editorId),
    )
    if (deleted) {
      return { action: 'drop', reason: `its ${need.kind} "${need.editorId}" is being deleted in this same batch` }
    }

    // Some other op will register that id when it succeeds — wait for it.
    const producer = _queue.some(
      (o) => o !== item && opDependency(o.opType, o.payload).produces === need.editorId,
    )
    if (producer) {
      return { action: 'wait', reason: `waiting for its ${need.kind} "${need.editorId}" to be created` }
    }

    return {
      action: 'drop',
      reason: `its ${need.kind} "${need.editorId}" has no server id and no queued op will create one (deleted, or it never synced)`,
    }
  }
  return { action: 'dispatch' }
}

// The first op that can actually be sent. Blocked ops keep their queue position
// and are re-evaluated on every pass, so a parent succeeding unblocks its child
// without any extra signalling.
function _pickNext() {
  for (const item of _queue) {
    if (item.status !== 'pending' && item.status !== 'blocked') continue
    const verdict = _dependencyVerdict(item)
    if (verdict.action === 'dispatch') return { item, verdict }
    if (verdict.action === 'drop') return { item, verdict }
    item.status = 'blocked'
    item.error = verdict.reason
  }
  return null
}

async function _drain() {
  if (_draining || !_active) return
  _draining = true; _notify()
  try {
    while (_active) {
      const next = _pickNext()
      if (!next) break
      const { item, verdict } = next

      if (verdict.action === 'drop') {
        console.warn(`[liveSyncQueue] ${item.opType} dropped — ${verdict.reason}`)
        _queue = _queue.filter((o) => o.id !== item.id)
        await _persist(); _notify()
        continue
      }

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
    if (_isTerminal(o)) { o.status = 'pending'; o.attempts = 0; o.error = null }
  }
  // A blocked op is not a failure and keeps its attempt count, but it must be
  // re-evaluated: the op it was waiting for may be the one just revived.
  for (const o of _queue) if (o.status === 'blocked') o.status = 'pending'
  _persist(); _notify(); _drain()
}

export function resyncAll() {
  if (!_resyncBuilder) return
  let ops = []
  try { ops = _resyncBuilder() || [] } catch (e) { console.warn('[liveSyncQueue] resync build failed', e) }
  enqueueGeometryOps(ops)
}
