// Generic binary asset storage primitive — Phase 4 Tier-2 ADD 4.
//
// The single, deliberately generic path for storing large per-project blobs:
// underlay PDFs/images, future DXF imports, IFC files, attached photos,
// material textures. Every consumer routes through this module — no
// feature-specific "underlay-storage helpers" or "dxf-import helpers".
//
// Built over the same storage adapter facade as indexedDb.js
// (createPersistence). Real IDB in the browser; the in-memory mock from
// indexedDb.js drives Node verify scripts. Switching backends never
// touches consumers.
//
// Public API (all async):
//   storeAsset(storage, projectId, assetType, blob, opts?) → key
//   getAsset (storage, key)                                → record | null
//   deleteAsset(storage, key)                              → boolean
//   deleteProjectAssets(storage, projectId)                → number of deleted keys
//
// assetType is open-ended ('underlay' | 'dxf' | 'ifc' | 'photo' | …).
// New consumers add a string; no schema change here.
//
// Key shape (single source of truth):
//   `${projectId}::${assetType}::${assetId}`
//
// The composite key supports `deleteProjectAssets` via prefix scan (no
// secondary index needed). The `::` separator is conservative — IDB keys
// don't need it, but it makes the key trivially parseable by hand in
// DevTools.

import { uid } from '../../lib/ids.js'
import { DB_STORES } from './indexedDb.js'

// Phase 4 Tier-2 Step 12: multi-tab notification. When an asset is
// stored/deleted in one tab, peers receive `{ type, key }` and can
// invalidate their in-memory caches. BroadcastChannel is browser-only.
// Node leaves _channel null because an open BroadcastChannel keeps the
// event loop alive forever, hanging verify scripts.
function _isBrowser() {
  return typeof globalThis !== 'undefined'
    && typeof globalThis.window !== 'undefined'
    && typeof globalThis.BroadcastChannel === 'function'
}
const _channel = _isBrowser()
  ? new globalThis.BroadcastChannel('boq-assets')
  : null

function _notifyAssets(type, key) {
  if (!_channel) return
  try { _channel.postMessage({ type, key }) } catch { /* swallow */ }
}

export function subscribeAssetEvents(handler) {
  if (!_channel || typeof handler !== 'function') return () => {}
  const wrapped = (ev) => handler(ev.data)
  _channel.addEventListener('message', wrapped)
  return () => _channel.removeEventListener('message', wrapped)
}

export const ASSET_TYPES = Object.freeze({
  UNDERLAY: 'underlay',
  DXF:      'dxf',
  IFC:      'ifc',
  PHOTO:    'photo',
  TEXTURE:  'texture',
})

function _assetKey(projectId, assetType, assetId) {
  return `${projectId}::${assetType}::${assetId}`
}

function _isProjectPrefix(key, projectId) {
  return typeof key === 'string' && key.startsWith(`${projectId}::`)
}

// Store a binary asset and return its key. `blob` is either:
//   - a Blob / File           (browser)
//   - an ArrayBuffer          (browser worker)
//   - a string (data URL)     (browser PDF render → toDataURL)
//   - a Uint8Array            (Node tests)
// The mime type is captured for round-trip render decisions.
export async function storeAsset(storage, projectId, assetType, blob, opts = {}) {
  if (!storage) throw new TypeError('storeAsset: storage required')
  if (!projectId) throw new TypeError('storeAsset: projectId required')
  if (!assetType) throw new TypeError('storeAsset: assetType required')
  const assetId = opts.assetId ?? uid()
  const key = _assetKey(projectId, assetType, assetId)
  const record = Object.freeze({
    key,
    projectId,
    assetType,
    assetId,
    mimeType:    opts.mimeType   ?? null,
    originalFileName: opts.originalFileName ?? null,
    naturalSize: opts.naturalSize ?? null,   // { wPx, hPx } if image
    blob,
    createdAt:   Date.now(),
  })
  await storage.put(DB_STORES.ASSETS, key, record)
  _notifyAssets('stored', key)
  return key
}

export async function getAsset(storage, key) {
  if (!storage || !key) return null
  return storage.get(DB_STORES.ASSETS, key)
}

export async function deleteAsset(storage, key) {
  if (!storage || !key) return false
  const existing = await storage.get(DB_STORES.ASSETS, key)
  if (!existing) return false
  await storage.delete(DB_STORES.ASSETS, key)
  _notifyAssets('deleted', key)
  return true
}

// Called when a project is deleted. Walks the ASSETS store for any record
// whose key has the project prefix and drops them all. Returns the
// dropped count.
export async function deleteProjectAssets(storage, projectId) {
  if (!storage || !projectId) return 0
  const all = await storage.getAll(DB_STORES.ASSETS)
  let n = 0
  for (const rec of all) {
    if (_isProjectPrefix(rec.key, projectId)) {
      await storage.delete(DB_STORES.ASSETS, rec.key)
      n++
    }
  }
  return n
}

// Optional helper — list every asset of a given type for a project.
// Underlay UI uses this when restoring an opened project's underlay
// pointer (state.projectSettings.underlay carries the storageKey only;
// the blob is fetched on first render).
export async function listProjectAssets(storage, projectId, assetType = null) {
  if (!storage || !projectId) return []
  const all = await storage.getAll(DB_STORES.ASSETS)
  return all.filter(rec =>
    _isProjectPrefix(rec.key, projectId) &&
    (assetType == null || rec.assetType === assetType),
  )
}

// Exposed for callers building keys without first storing (rare — most
// callers receive the key from storeAsset).
export { _assetKey as buildAssetKey }
