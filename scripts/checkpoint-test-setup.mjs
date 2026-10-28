// Protocol fixture for geometry-diff harnesses. The dedicated checkpoint harness tests server receipts/replays.
import { getAssetStorage } from '../src/projects/storage/getAssetStorage.js'
import { DB_STORES } from '../src/projects/storage/indexedDb.js'
import { computeChecksum } from '../src/projects/canonicalDoc.js'
import { initCanonicalSyncQueue, teardownCanonicalSyncQueue } from '../src/projects/canonicalSyncQueue.js'
let wrapper
let original
export async function initCheckpointTest(conn, buildingId) {
  teardownCanonicalSyncQueue()
  const payload = { version: 7 }
  const checksum = await computeChecksum(JSON.stringify(payload))
  await getAssetStorage().put(DB_STORES.SNAPSHOTS, buildingId, { schemaVersion: 7, checksum, payload })
  if (globalThis.fetch !== wrapper) original = globalThis.fetch
  let version = 0
  wrapper = async (url, options = {}) => {
    const value = String(url)
    if (value.includes('/building-structure/') && (value.endsWith('/document') || value.includes('/checkpoints'))) {
      const data = value.endsWith('/document') ? { snapshotVersion: ++version, checksum, payload } : { status: 'COMPLETE' }
      return { ok: true, status: 200, json: async () => ({ data }), text: async () => '' }
    }
    return original(url, options)
  }
  globalThis.fetch = wrapper
  await initCanonicalSyncQueue(conn, buildingId, { knownBaseVersion: 0, deferUpload: true })
}
