// Revision system — localStorage-backed named snapshots per project.
//
// Storage layout: one key per project.
//   boq_revisions:<projectId>   →   RevisionRecord[]   (newest first)
//
// Each RevisionRecord is created via snapshot.js (snapshot + boqSummary +
// validationSummary frozen at creation time) and is treated as immutable.
//
// Public API matches the projects/manager.js style — pub/sub via subscribe(),
// snapshots cached so useSyncExternalStore can read stable references.

import { uid } from '../lib/ids.js'

const REVISION_KEY_PREFIX = 'boq_revisions:'
const MAX_REVISIONS_PER_PROJECT = 30
export const REVISION_SCHEMA_VERSION = 1

// ── pub/sub ──────────────────────────────────────────────────────────────────
const listeners = new Set()
// Cache: projectId → stable revision array. useSyncExternalStore demands
// reference stability between getSnapshot() calls when nothing has changed,
// or React infinite-loops with the "should be cached" error. Invalidation
// happens up-front in notify() before listener fan-out (same pattern as
// projects/manager.js).
const _cache = new Map()

function invalidate(projectId) {
  if (projectId) _cache.delete(projectId)
  else _cache.clear()
}

function notify(projectId) {
  invalidate(projectId)
  for (const fn of listeners) {
    try { fn() } catch { /* swallow listener errors */ }
  }
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

// ── localStorage IO (defensive: quota, private mode, corruption) ─────────────
function key(projectId) { return REVISION_KEY_PREFIX + projectId }

function readAll(projectId) {
  try {
    const raw = localStorage.getItem(key(projectId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(projectId, list) {
  try {
    localStorage.setItem(key(projectId), JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

// Route through the canonical id factory (Arch 6 Rule 2). No local fallback
// — crypto.randomUUID is universally available in modern browsers + Node 16+,
// which is the supported target.
function uuid() {
  return uid()
}

// ── retention policy ─────────────────────────────────────────────────────────
// 30 revisions per project; over the cap, prune the oldest AUTO revisions
// first (the "auto-saved before restore" safety snapshots), then fall back
// to oldest manual ones. Sort criteria: createdAt ascending.
function pruneOverCap(list) {
  if (list.length <= MAX_REVISIONS_PER_PROJECT) return list
  const sorted = [...list].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  const target = MAX_REVISIONS_PER_PROJECT
  const removable = []
  // Prefer auto revs as removable.
  for (const r of sorted) if (r.isAuto) removable.push(r)
  for (const r of sorted) if (!r.isAuto && !removable.includes(r)) removable.push(r)
  const toRemove = new Set()
  let overflow = list.length - target
  for (const r of removable) {
    if (overflow <= 0) break
    toRemove.add(r.id)
    overflow--
  }
  return list.filter(r => !toRemove.has(r.id))
}

// ── public API ───────────────────────────────────────────────────────────────

// Singleton empty array — keeps useSyncExternalStore happy when no
// projectId is set (returning a fresh [] each call triggers React's
// infinite-loop guard).
const _EMPTY = Object.freeze([])

// Returns newest-first array of revisions. Caches by projectId for stable refs.
export function listRevisions(projectId) {
  if (!projectId) return _EMPTY
  const cached = _cache.get(projectId)
  if (cached) return cached
  const all = readAll(projectId)
  const sorted = [...all].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  _cache.set(projectId, sorted)
  return sorted
}

export function getRevision(projectId, revisionId) {
  return listRevisions(projectId).find(r => r.id === revisionId) ?? null
}

// Creates a new revision record. `record` is the body from buildRevisionSnapshot
// — this function adds id/projectId/createdAt fields and persists.
// Returns the full record on success, or null on failure (quota etc.).
export function createRevision(projectId, record) {
  if (!projectId || !record) return null
  const now = Date.now()
  const full = {
    id:                      uuid(),
    projectId,
    createdAt:               now,
    revisionSchemaVersion:   REVISION_SCHEMA_VERSION,
    ...record,
  }
  const all = readAll(projectId)
  all.push(full)
  const pruned = pruneOverCap(all)
  const ok = writeAll(projectId, pruned)
  if (!ok) return null
  notify(projectId)
  return full
}

export function deleteRevision(projectId, revisionId) {
  if (!projectId || !revisionId) return false
  const all = readAll(projectId)
  const next = all.filter(r => r.id !== revisionId)
  if (next.length === all.length) return false
  const ok = writeAll(projectId, next)
  if (ok) notify(projectId)
  return ok
}

export function deleteAllRevisionsForProject(projectId) {
  if (!projectId) return false
  try {
    localStorage.removeItem(key(projectId))
    notify(projectId)
    return true
  } catch {
    return false
  }
}

export function countRevisions(projectId) {
  return readAll(projectId).length
}

// Export retention limit so the panel can warn users.
export const REVISION_CAP = MAX_REVISIONS_PER_PROJECT
