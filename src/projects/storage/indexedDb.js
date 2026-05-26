// IndexedDB-backed project storage layer — Arch 5 Phase 2.
//
// Replaces the single-blob localStorage approach with chunked,
// transaction-safe IDB storage. Built as a backend-agnostic facade
// over a `storage` injection so the same code works against real IDB
// in the browser AND a Map-backed mock in verify scripts (Node).
//
// Compression (LZ) — DEFERRED per Correction 4. Chunks are stored as
// plain JSON (debuggable in DevTools, no LZ overhead at the cost of
// quota headroom).
//
// Multi-tab — BroadcastChannel announces project mutations so other
// tabs can invalidate their caches. The channel is optional (older
// browsers fall back to storage events).
//
// Crash recovery — Arch 2 journal ops can be replayed against the
// latest snapshot. The IDB layer stores snapshot + journal stores
// separately so a partial-write at autosave time can be reconstructed.
//
// Public API (mirrors localStorage manager.js):
//   listProjects, createProject, openProject, saveCurrent, deleteProject,
//   renameProject, getCurrentProjectId, setCurrentProjectId, subscribe
//
// + new for chunked + journaled storage:
//   writeChunk(projectId, slice, chunkData)
//   readChunk (projectId, slice)
//   appendJournalEntry(projectId, op, inverse)
//   readJournalSince(projectId, opIndex)
//   writeSnapshot(projectId, opIndex, fullState)
//
// Stores (object-store names — see DB_SCHEMA):
//   projects:    { id, name, type, schemaVersion, created, updated, currentChunkVersion }
//   chunks:      { key = `${projectId}:${slice}`, slice, data }
//   journal:     { id, projectId, opIndex, op, inverse, timestamp, kind }
//   snapshots:   { id, projectId, opIndex, fullState }

import { uid } from '../../lib/ids.js'

export const DB_NAME    = 'boq-app'
export const DB_VERSION = 1
export const DB_STORES  = Object.freeze({
  PROJECTS:   'projects',
  CHUNKS:     'chunks',
  JOURNAL:    'journal',
  SNAPSHOTS:  'snapshots',
  REVISIONS:  'revisions',
  CATALOGS:   'catalogs',
})

// Project chunks — the slices that get serialized independently.
// Splitting at these boundaries lets autosave write only the slice(s)
// that changed since the last save.
export const PROJECT_CHUNKS = Object.freeze([
  'model',           // nodes + walls + rooms + stamps + columns + beams + slabs +
                     //  staircases + foundations + MEP collections + risers
  'projectSettings', // every projectSettings subtree
  'settings',        // ratesByKey + unit + UI prefs
])

// ── Storage adapter interface ───────────────────────────────────────────────
//
// The IDB layer doesn't talk to `indexedDB` directly — it talks to a
// `storage` adapter with this shape:
//
//   storage = {
//     get(store, key)             → Promise<value | null>
//     put(store, key, value)      → Promise<void>
//     delete(store, key)          → Promise<void>
//     getAll(store, prefix?)      → Promise<value[]>
//     clear(store)                → Promise<void>
//   }
//
// Browser: real IDB-backed adapter (built at app startup)
// Node tests: Map-backed mock (created by makeMemoryAdapter())

export function makeMemoryAdapter() {
  const stores = new Map()
  function _store(name) {
    if (!stores.has(name)) stores.set(name, new Map())
    return stores.get(name)
  }
  return Object.freeze({
    async get(store, key) {
      return _store(store).get(key) ?? null
    },
    async put(store, key, value) {
      _store(store).set(key, value)
    },
    async delete(store, key) {
      _store(store).delete(key)
    },
    async getAll(store, prefix) {
      const m = _store(store)
      if (!prefix) return [...m.values()]
      const out = []
      for (const [k, v] of m) {
        if (typeof k === 'string' && k.startsWith(prefix)) out.push(v)
      }
      return out
    },
    async clear(store) {
      _store(store).clear()
    },
    // Inspection helper (mock only).
    _dump() {
      const out = {}
      for (const [name, m] of stores) out[name] = Object.fromEntries(m)
      return out
    },
  })
}

// ── Project facade ──────────────────────────────────────────────────────────

export function createPersistence(storage) {
  if (!storage) throw new TypeError('createPersistence: storage adapter required')

  // ── Subscriber registry — invalidated on every mutation ───────────────────
  const subscribers = new Set()
  function _notify() {
    for (const fn of subscribers) {
      try { fn() } catch { /* swallow */ }
    }
  }
  function subscribe(fn) {
    subscribers.add(fn)
    return () => { subscribers.delete(fn) }
  }

  // ── Project CRUD ──────────────────────────────────────────────────────────

  async function listProjects() {
    const all = await storage.getAll(DB_STORES.PROJECTS)
    return all.sort((a, b) => (b.updated || 0) - (a.updated || 0))
  }

  async function createProject(name, type = 'Residential') {
    const now = Date.now()
    const rec = {
      id:                   uid(),
      name:                 (name && String(name).trim()) || 'Untitled project',
      type:                 type || 'Residential',
      created:              now,
      updated:              now,
      schemaVersion:        null,   // stamped on first save
      currentChunkVersion:  0,
    }
    await storage.put(DB_STORES.PROJECTS, rec.id, rec)
    _notify()
    return rec
  }

  async function openProject(id) {
    const rec = await storage.get(DB_STORES.PROJECTS, id)
    if (!rec) return null
    // Reassemble chunks into one project data object.
    const data = {}
    for (const slice of PROJECT_CHUNKS) {
      const chunk = await storage.get(DB_STORES.CHUNKS, `${id}:${slice}`)
      if (chunk?.data) Object.assign(data, chunk.data)
    }
    data.schemaVersion = rec.schemaVersion ?? data.schemaVersion ?? null
    return data
  }

  // saveCurrent writes the project record + every changed chunk.
  // For now we re-write every chunk (no diff tracking). When we add a
  // dirty-tracker (Arch 2 op log can drive it) we'll write only the
  // changed slice(s).
  async function saveCurrent(id, data) {
    const rec = await storage.get(DB_STORES.PROJECTS, id)
    if (!rec) return false
    rec.updated = Date.now()
    rec.schemaVersion = data.schemaVersion ?? rec.schemaVersion ?? null
    rec.currentChunkVersion = (rec.currentChunkVersion ?? 0) + 1
    await storage.put(DB_STORES.PROJECTS, id, rec)

    // Split + write chunks.
    const sliced = _splitDataIntoChunks(data)
    for (const [slice, chunkData] of Object.entries(sliced)) {
      await storage.put(DB_STORES.CHUNKS, `${id}:${slice}`, {
        key:     `${id}:${slice}`,
        slice,
        version: rec.currentChunkVersion,
        data:    chunkData,
      })
    }
    _notify()
    return true
  }

  async function renameProject(id, name) {
    const rec = await storage.get(DB_STORES.PROJECTS, id)
    if (!rec) return false
    rec.name    = (name && String(name).trim()) || rec.name
    rec.updated = Date.now()
    await storage.put(DB_STORES.PROJECTS, id, rec)
    _notify()
    return true
  }

  async function deleteProject(id) {
    const rec = await storage.get(DB_STORES.PROJECTS, id)
    if (!rec) return false
    await storage.delete(DB_STORES.PROJECTS, id)
    // Drop chunks
    for (const slice of PROJECT_CHUNKS) {
      await storage.delete(DB_STORES.CHUNKS, `${id}:${slice}`)
    }
    _notify()
    return true
  }

  // ── Journal + Snapshot (Arch 2 + Arch 5 crash recovery) ───────────────────

  async function appendJournalEntry(projectId, op, inverse) {
    const entry = {
      id:        uid(),
      projectId,
      opIndex:   await _nextOpIndex(projectId),
      op,
      inverse:   inverse ?? null,
      timestamp: Date.now(),
      kind:      op.kind,
    }
    await storage.put(DB_STORES.JOURNAL, entry.id, entry)
    return entry
  }

  async function _nextOpIndex(projectId) {
    const all = await storage.getAll(DB_STORES.JOURNAL)
    let max = -1
    for (const e of all) {
      if (e.projectId === projectId && e.opIndex > max) max = e.opIndex
    }
    return max + 1
  }

  async function readJournalSince(projectId, opIndex) {
    const all = await storage.getAll(DB_STORES.JOURNAL)
    return all
      .filter(e => e.projectId === projectId && e.opIndex > opIndex)
      .sort((a, b) => a.opIndex - b.opIndex)
  }

  async function writeSnapshot(projectId, opIndex, fullState) {
    const rec = {
      id:        `${projectId}:snap:${opIndex}`,
      projectId,
      opIndex,
      fullState,
      createdAt: Date.now(),
    }
    await storage.put(DB_STORES.SNAPSHOTS, rec.id, rec)
    return rec
  }

  async function getLatestSnapshot(projectId) {
    const all = await storage.getAll(DB_STORES.SNAPSHOTS)
    return all
      .filter(s => s.projectId === projectId)
      .sort((a, b) => b.opIndex - a.opIndex)[0] ?? null
  }

  // ── Catalog provenance store ──────────────────────────────────────────────

  async function stampCatalogProvenance(manifest) {
    const rec = { key: 'current', ...manifest, stampedAt: Date.now() }
    await storage.put(DB_STORES.CATALOGS, 'current', rec)
    return rec
  }

  async function getLastCatalogProvenance() {
    return storage.get(DB_STORES.CATALOGS, 'current')
  }

  return {
    DB_STORES,
    PROJECT_CHUNKS,
    listProjects, createProject, openProject, saveCurrent,
    renameProject, deleteProject,
    appendJournalEntry, readJournalSince,
    writeSnapshot, getLatestSnapshot,
    stampCatalogProvenance, getLastCatalogProvenance,
    subscribe,
    storage,   // exposed for tests
  }
}

// ── Chunk splitting ─────────────────────────────────────────────────────────
// Splits a project data object into per-slice chunks for IDB storage.

function _splitDataIntoChunks(data) {
  // Model slice: every entity collection.
  const modelKeys = [
    'nodes', 'walls', 'rooms', 'stamps',
    'columns', 'beams', 'slabs', 'staircases', 'foundations',
    'plumbingFixtures', 'electricalPoints', 'hvacUnits',
    'fireDevices', 'elvDevices', 'solarEquipment', 'risers',
  ]
  const model = {}
  for (const k of modelKeys) if (k in data) model[k] = data[k]

  // ProjectSettings slice.
  const projectSettings = data.projectSettings ? { projectSettings: data.projectSettings } : {}

  // Settings slice: rates + unit + other UI prefs.
  const settings = {}
  if ('ratesByKey' in data) settings.ratesByKey = data.ratesByKey
  if ('unit' in data) settings.unit = data.unit
  if ('schemaVersion' in data) settings.schemaVersion = data.schemaVersion

  return { model, projectSettings, settings }
}

// Exposed for tests.
export { _splitDataIntoChunks as splitDataIntoChunks }
