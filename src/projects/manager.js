// Phase 2.0 — localStorage-backed project manager.
//
// Storage keys:
//   boq_projects             → { [uuid]: { id, name, type, created, updated, data } }
//   boq_current_project_id   → string | absent
//
// Public API:
//   listProjects()                       → sorted-by-updated-desc array
//   createProject(name, type?)           → record (also persisted)
//   openProject(id)                      → record.data (suitable for store.loadProject)
//   saveCurrent(id, data)                → boolean (false if quota exceeded)
//   renameProject(id, name)
//   deleteProject(id)
//   getCurrentProjectId()                → string | null
//   subscribe(fn)                        → unsubscribe()

import { uid } from '../lib/ids.js'

const STORAGE_KEY = 'boq_projects'
const CURRENT_KEY = 'boq_current_project_id'

// ── pub/sub ──────────────────────────────────────────────────────────────────
const listeners = new Set()
// Cached snapshot for useSyncExternalStore — must keep the same reference
// across consecutive getSnapshot() calls when nothing changed, or React
// infinite-loops with "The result of getSnapshot should be cached".
let _projectsCache = null
let _currentIdCache = undefined   // undefined = unread; null = explicitly absent
function invalidateCache() { _projectsCache = null; _currentIdCache = undefined }
function notify() {
  invalidateCache()
  for (const fn of listeners) {
    try { fn() } catch { /* swallow listener errors */ }
  }
}
export function subscribe(fn) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

// ── localStorage IO (defensive: private mode, quota, JSON corruption) ────────
function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAll(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
    return true
  } catch {
    // QuotaExceededError, security errors, anything else → caller decides.
    return false
  }
}

// Route through the canonical id factory (Arch 6 Rule 2). No local fallback
// — crypto.randomUUID is universally available in modern browsers + Node 16+,
// which is the supported target.
function uuid() {
  return uid()
}

// Empty project shape — matches Toolbar.handleSave / store.loadProject.
function emptyProjectData() {
  return {
    version:         7,
    unit:            'inch',
    nodes:           {},
    walls:           {},
    rooms:           {},
    stamps:          {},
    columns:         {},
    beams:           {},
    slabs:           {},
    staircases:      {},
    foundations:     {},
    ratesByKey:      {},
    projectSettings: null, // store.loadProject seeds DEFAULT_PROJECT_SETTINGS when null
  }
}

// ── public API ───────────────────────────────────────────────────────────────

export function listProjects() {
  if (_projectsCache !== null) return _projectsCache
  const map = readAll()
  _projectsCache = Object.values(map).sort((a, b) => (b.updated || 0) - (a.updated || 0))
  return _projectsCache
}

export function createProject(name, type = 'Residential') {
  const map = readAll()
  const now = Date.now()
  const rec = {
    id:      uuid(),
    name:    (name && String(name).trim()) || 'Untitled project',
    type:    type || 'Residential',
    created: now,
    updated: now,
    data:    emptyProjectData(),
  }
  map[rec.id] = rec
  writeAll(map)
  notify()
  return rec
}

export function openProject(id) {
  const map = readAll()
  const rec = map[id]
  if (!rec) return null
  try { localStorage.setItem(CURRENT_KEY, id) } catch { /* ignore */ }
  notify()
  return rec.data
}

export function saveCurrent(id, data) {
  if (!id) return false
  const map = readAll()
  const rec = map[id]
  if (!rec) return false
  rec.data    = data
  rec.updated = Date.now()
  map[id]     = rec
  const ok = writeAll(map)
  if (ok) notify()
  return ok
}

export function renameProject(id, name) {
  const map = readAll()
  const rec = map[id]
  if (!rec) return false
  rec.name    = (name && String(name).trim()) || rec.name
  rec.updated = Date.now()
  map[id]     = rec
  const ok = writeAll(map)
  if (ok) notify()
  return ok
}

export function deleteProject(id) {
  const map = readAll()
  if (!map[id]) return false
  delete map[id]
  writeAll(map)
  try {
    const cur = localStorage.getItem(CURRENT_KEY)
    if (cur === id) localStorage.removeItem(CURRENT_KEY)
  } catch { /* ignore */ }
  notify()
  return true
}

export function getCurrentProjectId() {
  if (_currentIdCache !== undefined) return _currentIdCache
  try {
    const id = localStorage.getItem(CURRENT_KEY)
    _currentIdCache = id || null
  } catch {
    _currentIdCache = null
  }
  return _currentIdCache
}

export function setCurrentProjectId(id) {
  try {
    if (id) localStorage.setItem(CURRENT_KEY, id)
    else    localStorage.removeItem(CURRENT_KEY)
    notify()
    return true
  } catch {
    return false
  }
}

// Exported for tests / callers that need the canonical empty shape.
export { emptyProjectData }
