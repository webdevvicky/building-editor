// Lazy storage adapter accessor for binary asset operations.
// Phase 4 Tier-2 Steps 10/11 (asset-only IDB integration).
//
// Browser callers obtain the shared IDB-backed adapter on demand. Node
// verify scripts can substitute the in-memory mock via setAssetStorage().
// The full project autosave migration to IDB (Steps 10–12 full scope)
// is deferred — assets are the only path consuming this today.

import { makeIdbAdapter } from './idbAdapter.js'
import { makeMemoryAdapter } from './indexedDb.js'

let _adapter = null

function _hasIndexedDB() {
  return typeof globalThis !== 'undefined'
    && typeof globalThis.indexedDB !== 'undefined'
}

export function getAssetStorage() {
  if (_adapter) return _adapter
  _adapter = _hasIndexedDB() ? makeIdbAdapter() : makeMemoryAdapter()
  return _adapter
}

// Test seam — verify scripts call this to inject the in-memory adapter
// even when IndexedDB IS present (so they exercise the same code path
// deterministically).
export function setAssetStorage(adapter) {
  _adapter = adapter ?? null
}
