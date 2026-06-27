// Project manager — IDB-canonical with a synchronous read cache.
//
// Phase 4 Tier-2 (Phase B). Replaces the localStorage-only manager. IDB is
// now the canonical source of truth; localStorage data is migrated on
// first boot and kept in place as a release-cycle safety net.
//
// SYNC API CONTRACT (preserved):
//   listProjects()           → array (stable ref across calls until change)
//   createProject(name, t?)  → record (sync; IDB write fires async)
//   openProject(id)          → record.data | null (from cache)
//   saveCurrent(id, data)    → true (queued; async IDB write)
//   renameProject(id, name)  → boolean
//   deleteProject(id)        → boolean
//   getCurrentProjectId()    → string | null
//   setCurrentProjectId(id)  → boolean
//   subscribe(fn)            → unsubscribe()
//
// Background:
//   - Underlying IDB layer is fully async via createPersistence(idbStorage).
//   - manager.js maintains a synchronous in-memory cache; reads hit cache,
//     writes update cache synchronously and fire async IDB writes.
//   - BroadcastChannel 'boq-projects' synchronises across tabs — every
//     write posts a message; the listener refreshes cache from IDB and
//     notifies React subscribers.
//   - Boot sequence (bootPersistence) runs migration + cache hydration
//     before App.jsx renders. ProjectsPanel's useSyncExternalStore falls
//     back to empty array until boot completes (React re-renders on the
//     notify() that boot fires).
//
// Migration:
//   - On first boot, every project under localStorage['boq_projects'] is
//     copied into IDB. The migration flag is stored in IDB METADATA store
//     under key 'localStorage-migrated' so it runs exactly once.
//   - localStorage data is NOT deleted — kept for one release cycle as a
//     safety net.

import { uid } from '../lib/ids.js'
import {
  createPersistence, DB_STORES,
} from './storage/indexedDb.js'
import { getAssetStorage } from './storage/getAssetStorage.js'
import { getErpLaunchContext } from './erpLaunchContext.js'

const LEGACY_STORAGE_KEY = 'boq_projects'
const LEGACY_CURRENT_KEY = 'boq_current_project_id'
const CURRENT_ID_META_KEY  = 'current-project-id'
const MIGRATION_META_KEY   = 'localStorage-migrated'

// ── Cache + pub/sub ─────────────────────────────────────────────────────────
const listeners = new Set()
let _booted = false
let _projectsCache = []            // stable-ref array (sorted updated DESC)
let _currentIdCache = null         // string | null
let _projectDataCache = new Map()  // id → reassembled data shape (for openProject)
let _persistence = null            // createPersistence(idbStorage) instance

// Serializing write queue — fire-and-forget IDB writes are chained so a
// `await flushPendingWrites()` in tests drains everything. Production
// code never awaits this; the queue serves to prevent races between
// fast-fire calls (createProject → saveCurrent on the same id) where the
// underlying persistence.saveCurrent reads the PROJECTS record set by a
// prior put that hasn't landed yet.
let _writeQueue = Promise.resolve()
function _enqueueWrite(fn) {
  _writeQueue = _writeQueue.then(fn).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[manager] queued write failed', err)
  })
  return _writeQueue
}
export function flushPendingWrites() { return _writeQueue }

function _isBrowser() {
  return typeof globalThis !== 'undefined'
    && typeof globalThis.window !== 'undefined'
}

// BroadcastChannel — browser-only. Node verify scripts skip to avoid
// keeping the event loop open.
const _channel = (_isBrowser() && typeof globalThis.BroadcastChannel === 'function')
  ? new globalThis.BroadcastChannel('boq-projects')
  : null

function _notify() {
  for (const fn of listeners) {
    try { fn() } catch { /* swallow */ }
  }
}

function _broadcast(type, payload) {
  if (!_channel) return
  try { _channel.postMessage({ type, ...payload }) } catch { /* swallow */ }
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

// ── Boot sequence (called once from main.jsx) ───────────────────────────────
//
// 1. createPersistence(idbStorage) — get the async API
// 2. Run localStorage → IDB migration if not done already
// 3. Hydrate cache from IDB
// 4. Wire BroadcastChannel listener
// 5. notify() so any React subscribers re-render
//
// Returns a Promise<void>. Callers can await before rendering, or fire-
// and-forget (the empty-array fallback in useSyncExternalStore handles
// the gap).
export async function bootPersistence() {
  if (_booted) return
  _persistence = createPersistence(getAssetStorage())
  await _migrateLocalStorageIfNeeded()
  await _hydrateCache()
  _wireBroadcastChannel()
  // Area 2C Step 8/9 — template store shares the same storage adapter.
  // Lazy-imported to avoid an import-cycle (templates.js imports nothing
  // from manager.js, but the seam is established here so the templates
  // module can be wired without exposing _persistence publicly).
  try {
    const { _setTemplateStorage } = await import('./templates.js')
    _setTemplateStorage(_persistence.storage)
  } catch { /* templates module is optional at boot */ }
  _booted = true
  _notify()
}

export function _isBooted() { return _booted }

// ── Migration (one-shot) ────────────────────────────────────────────────────
async function _migrateLocalStorageIfNeeded() {
  if (!_isBrowser()) return  // Node verify scripts skip
  const storage = _persistence.storage
  const metaRec = await storage.get(DB_STORES.METADATA, MIGRATION_META_KEY)
  if (metaRec?.done) return
  let legacyMap = null
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    legacyMap = raw ? JSON.parse(raw) : null
  } catch { /* swallow */ }
  if (legacyMap && typeof legacyMap === 'object') {
    let migratedCount = 0
    for (const [id, rec] of Object.entries(legacyMap)) {
      if (!rec || typeof rec !== 'object') continue
      // Check whether IDB already has this project (avoid clobbering newer
      // data if migration ran partially on a previous boot).
      const existing = await storage.get(DB_STORES.PROJECTS, id)
      if (existing) continue
      const projectRec = {
        id,
        name:    rec.name    ?? 'Untitled project',
        type:    rec.type    ?? 'Residential',
        created: rec.created ?? Date.now(),
        updated: rec.updated ?? Date.now(),
        schemaVersion:       rec.data?.version ?? null,
        currentChunkVersion: 1,
      }
      await storage.put(DB_STORES.PROJECTS, id, projectRec)
      // Chunked write via the persistence layer's saveCurrent (consistent
      // with the chunk shape new saves use).
      if (rec.data) {
        await _persistence.saveCurrent(id, rec.data)
      }
      migratedCount++
    }
    if (migratedCount > 0) {
      // eslint-disable-next-line no-console
      console.info(`[manager] migrated ${migratedCount} project(s) from localStorage to IDB`)
    }
  }
  // Also migrate the current-project-id sentinel.
  try {
    const curLs = localStorage.getItem(LEGACY_CURRENT_KEY)
    if (curLs) {
      await storage.put(DB_STORES.METADATA, CURRENT_ID_META_KEY, { value: curLs })
    }
  } catch { /* swallow */ }
  await storage.put(DB_STORES.METADATA, MIGRATION_META_KEY, {
    done: true, migratedAt: Date.now(),
  })
}

// ── Cache hydration ─────────────────────────────────────────────────────────
async function _hydrateCache() {
  const storage = _persistence.storage
  const records = await _persistence.listProjects()
  _projectsCache = records.sort((a, b) => (b.updated || 0) - (a.updated || 0))
  // Reassemble project data for every cached record. Keeps openProject sync.
  _projectDataCache = new Map()
  for (const rec of _projectsCache) {
    const data = await _persistence.openProject(rec.id)
    _projectDataCache.set(rec.id, data ?? null)
  }
  // ERP-driven launch: the editor is bound to the ERP building, not a local IDB
  // project. Do NOT restore the persisted current-project id — leaving it null
  // keeps the Projects dialog closed (ProjectsPanel) and autosave a no-op, so a
  // stale local project never shadows the live ERP session.
  if (getErpLaunchContext()) {
    _currentIdCache = null
    return
  }
  const cur = await storage.get(DB_STORES.METADATA, CURRENT_ID_META_KEY)
  _currentIdCache = cur?.value ?? null
}

// ── BroadcastChannel ────────────────────────────────────────────────────────
function _wireBroadcastChannel() {
  if (!_channel) return
  _channel.addEventListener('message', (ev) => {
    // Any cross-tab event invalidates the cache. Re-hydrate then notify.
    ;(async () => {
      await _hydrateCache()
      _notify()
    })().catch(() => { /* swallow */ })
    void ev
  })
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function _resort() {
  // Rebuild stable ref so useSyncExternalStore sees a new identity.
  _projectsCache = _projectsCache
    .slice()
    .sort((a, b) => (b.updated || 0) - (a.updated || 0))
}

function _emptyProjectData() {
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
    plumbingFixtures: {}, electricalPoints: {}, hvacUnits: {},
    fireDevices: {}, elvDevices: {}, solarEquipment: {}, risers: {},
    ratesByKey:      {},
    projectSettings: null,
  }
}
export { _emptyProjectData as emptyProjectData }

// ── Public API ──────────────────────────────────────────────────────────────

export function listProjects() {
  return _projectsCache
}

export function getCurrentProjectId() {
  return _currentIdCache
}

export function createProject(name, type = 'Residential') {
  const now = Date.now()
  const rec = {
    id:      uid(),
    name:    (name && String(name).trim()) || 'Untitled project',
    type:    type || 'Residential',
    created: now,
    updated: now,
    schemaVersion: null,
    currentChunkVersion: 0,
  }
  // Synchronously update cache + reassembled-data map so openProject works
  // immediately.
  _projectsCache = [{ ...rec, data: undefined }, ..._projectsCache]
  _resort()
  const blank = _emptyProjectData()
  _projectDataCache.set(rec.id, blank)
  _notify()
  // Async IDB write — caller doesn't need to await. Serialized via queue
  // so subsequent saveCurrent on the same id sees this record's PUT.
  if (_persistence) {
    _enqueueWrite(async () => {
      await _persistence.storage.put(DB_STORES.PROJECTS, rec.id, rec)
      await _persistence.saveCurrent(rec.id, blank)
      _broadcast('project-created', { id: rec.id })
    })
  }
  return rec
}

export function openProject(id) {
  const rec = _projectsCache.find(p => p.id === id)
  if (!rec) return null
  // Update current-id cache + IDB metadata.
  _currentIdCache = id
  _notify()
  if (_persistence) {
    _enqueueWrite(async () => {
      await _persistence.storage.put(
        DB_STORES.METADATA, CURRENT_ID_META_KEY, { value: id },
      )
      _broadcast('current-changed', { id })
    })
  }
  return _projectDataCache.get(id) ?? _emptyProjectData()
}

export function saveCurrent(id, data) {
  if (!id) return false
  const rec = _projectsCache.find(p => p.id === id)
  if (!rec) return false
  rec.updated = Date.now()
  _projectDataCache.set(id, data)
  _resort()
  _notify()
  if (_persistence) {
    _enqueueWrite(async () => {
      await _persistence.saveCurrent(id, data)
      _broadcast('project-saved', { id })
    })
  }
  return true
}

export function renameProject(id, name) {
  const rec = _projectsCache.find(p => p.id === id)
  if (!rec) return false
  rec.name = (name && String(name).trim()) || rec.name
  rec.updated = Date.now()
  _resort()
  _notify()
  if (_persistence) {
    _enqueueWrite(async () => {
      await _persistence.renameProject(id, rec.name)
      _broadcast('project-renamed', { id, name: rec.name })
    })
  }
  return true
}

export function deleteProject(id) {
  const idx = _projectsCache.findIndex(p => p.id === id)
  if (idx < 0) return false
  _projectsCache = _projectsCache.slice(0, idx).concat(_projectsCache.slice(idx + 1))
  _projectDataCache.delete(id)
  if (_currentIdCache === id) _currentIdCache = null
  _notify()
  if (_persistence) {
    _enqueueWrite(async () => {
      await _persistence.deleteProject(id)
      // Also drop any underlay / asset blobs the project owned.
      const { deleteProjectAssets } = await import('./storage/assets.js')
      await deleteProjectAssets(_persistence.storage, id)
      if (_currentIdCache === null) {
        await _persistence.storage.put(
          DB_STORES.METADATA, CURRENT_ID_META_KEY, { value: null },
        )
      }
      _broadcast('project-deleted', { id })
    })
  }
  return true
}

export function setCurrentProjectId(id) {
  _currentIdCache = id || null
  _notify()
  if (_persistence) {
    _enqueueWrite(async () => {
      await _persistence.storage.put(
        DB_STORES.METADATA, CURRENT_ID_META_KEY, { value: id || null },
      )
      _broadcast('current-changed', { id: id || null })
    })
  }
  return true
}

// ── Test seam ───────────────────────────────────────────────────────────────
// Verify scripts inject a memory adapter and call _bootForTest({ adapter,
// legacyData? }) to hydrate from a known starting point.
export async function _bootForTest({ persistence, legacyProjects, legacyCurrentId }) {
  _booted = false
  _persistence = persistence
  _projectsCache = []
  _projectDataCache = new Map()
  _currentIdCache = null
  if (legacyProjects) {
    for (const [id, rec] of Object.entries(legacyProjects)) {
      const projectRec = {
        id, name: rec.name ?? 'P', type: rec.type ?? 'Residential',
        created: rec.created ?? Date.now(), updated: rec.updated ?? Date.now(),
        schemaVersion: null, currentChunkVersion: 1,
      }
      await persistence.storage.put(DB_STORES.PROJECTS, id, projectRec)
      if (rec.data) await persistence.saveCurrent(id, rec.data)
    }
  }
  if (legacyCurrentId) {
    await persistence.storage.put(
      DB_STORES.METADATA, CURRENT_ID_META_KEY, { value: legacyCurrentId },
    )
  }
  await persistence.storage.put(DB_STORES.METADATA, MIGRATION_META_KEY, {
    done: true, migratedAt: Date.now(),
  })
  await _hydrateCache()
  _booted = true
  _notify()
}

export function _resetForTest() {
  _booted = false
  _persistence = null
  _projectsCache = []
  _projectDataCache = new Map()
  _currentIdCache = null
  listeners.clear()
}
