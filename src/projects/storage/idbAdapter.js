// Real IndexedDB adapter — Phase 4 Tier-2 Steps 8 + 9 (ADD 5).
//
// Browser-only. Implements the same async storage facade as
// `makeMemoryAdapter()` in indexedDb.js so the facade + assets.js + all
// downstream consumers work against either backend by injection.
//
// Single open() promise — concurrent calls share the same connection.
// Upgrade runs onupgradeneeded once per DB_VERSION bump and creates any
// missing object stores. IDB_SCHEMA_VERSION lives in METADATA{key:'meta'}
// and is read at boot for forward migrations (no migrations defined yet).

import {
  DB_NAME, DB_VERSION, DB_STORES,
  IDB_SCHEMA_VERSION, IDB_MIGRATIONS,
} from './indexedDb.js'

function _hasIndexedDB() {
  return typeof globalThis !== 'undefined'
    && typeof globalThis.indexedDB !== 'undefined'
}

function _allStoreNames() {
  return Object.values(DB_STORES)
}

// Promise-wrap an IDBRequest.
function _wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

let _dbPromise = null

function _openDb() {
  if (_dbPromise) return _dbPromise
  if (!_hasIndexedDB()) {
    return Promise.reject(new Error('IndexedDB not available in this environment'))
  }
  _dbPromise = new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (ev) => {
      const db = req.result
      // Create any stores not present on the existing connection.
      for (const name of _allStoreNames()) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name)
        }
      }
    }
    req.onblocked = () => {
      // Another tab is holding the DB open at an older version. Surface
      // as a rejection so the boot sequence can retry / warn.
      reject(new Error('IDB upgrade blocked by another tab'))
    }
    req.onsuccess = async () => {
      const db = req.result
      try {
        await _runForwardMigrations(db)
        resolve(db)
      } catch (err) { reject(err) }
    }
    req.onerror = () => reject(req.error)
  })
  return _dbPromise
}

// Phase 4 Tier-2 ADD 5: run any registered forward migrations whose
// `from` matches the stored schema version. After successful application
// the metadata record is bumped to the new schema version.
async function _runForwardMigrations(db) {
  const tx = db.transaction([DB_STORES.METADATA], 'readwrite')
  const store = tx.objectStore(DB_STORES.METADATA)
  const existing = await _wrap(store.get('meta'))
  let current = existing?.schemaVersion ?? 0

  for (const m of IDB_MIGRATIONS) {
    if (m.from === current) {
      await m.migrate(db)
      current = m.to
    }
  }

  if (!existing || existing.schemaVersion !== IDB_SCHEMA_VERSION) {
    await _wrap(store.put({ schemaVersion: IDB_SCHEMA_VERSION, stampedAt: Date.now() }, 'meta'))
  }
}

// Adapter — same interface as makeMemoryAdapter().
export function makeIdbAdapter() {
  async function _tx(storeName, mode) {
    const db = await _openDb()
    const tx = db.transaction([storeName], mode)
    return tx.objectStore(storeName)
  }
  return Object.freeze({
    async get(store, key) {
      const os = await _tx(store, 'readonly')
      const result = await _wrap(os.get(key))
      return result ?? null
    },
    async put(store, key, value) {
      const os = await _tx(store, 'readwrite')
      await _wrap(os.put(value, key))
    },
    async delete(store, key) {
      const os = await _tx(store, 'readwrite')
      await _wrap(os.delete(key))
    },
    async getAll(store, prefix) {
      const os = await _tx(store, 'readonly')
      const all = await _wrap(os.getAll())
      if (!prefix) return all
      // Filter by key prefix — we don't open a cursor since the assets +
      // chunks stores stay small enough (kept under low-thousands).
      const keys = await _wrap(os.getAllKeys())
      return all.filter((_, i) =>
        typeof keys[i] === 'string' && keys[i].startsWith(prefix),
      )
    },
    async clear(store) {
      const os = await _tx(store, 'readwrite')
      await _wrap(os.clear())
    },
  })
}

// Test-only — reset the cached DB connection (used by integration tests
// that close + re-open the database).
export function _resetIdbAdapterForTests() {
  _dbPromise = null
}
