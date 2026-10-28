import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { makeMemoryAdapter, DB_STORES } from '../src/projects/storage/indexedDb.js'
import { setAssetStorage, getAssetStorage } from '../src/projects/storage/getAssetStorage.js'
import { initLiveSync, teardownLiveSync } from '../src/projects/liveSync.js'
import { initCanonicalSyncQueue, teardownCanonicalSyncQueue } from '../src/projects/canonicalSyncQueue.js'
import { initLiveSyncQueue, teardownLiveSyncQueue, enqueueGeometryOps, retryFailed, getSyncStatus } from '../src/projects/liveSyncQueue.js'
import { computeChecksum } from '../src/projects/canonicalDoc.js'

const buildingId = randomUUID()
const conn = { buildingId, erpUrl: 'https://erp.test', floorIds: {}, getToken: async () => 'test' }
setAssetStorage(makeMemoryAdapter())
const payload = { version: 7, nodes: { first: { x: 0, y: 0 }, second: { x: 100, y: 0 } } }
const doc = { schemaVersion: 7, payload, checksum: await computeChecksum(JSON.stringify(payload)) }
await getAssetStorage().put(DB_STORES.SNAPSHOTS, buildingId, doc)
const receipts = new Map()
const manifests = new Map()
let version = 0, seals = 0, writes = 0, failSecond = true, loseFirstResponse = true
const response = (body, status = 200) => ({ ok: status === 200, status, json: async () => ({ data: body }), text: async () => JSON.stringify(body) })
globalThis.fetch = async (url, options) => {
  const body = options.body ? JSON.parse(options.body) : null
  if (url.endsWith('/document')) {
    assert.equal(body.baseVersion, version)
    assert.equal(body.checksum, doc.checksum)
    version++
    return response({ snapshotVersion: version })
  }
  if (url.endsWith('/checkpoints')) {
    assert.equal(body.snapshotVersion, version)
    manifests.set(body.checkpointId, body.mutationIds)
    return response({ id: body.checkpointId })
  }
  if (url.endsWith('/seal')) {
    const id = url.split('/').at(-2)
    assert(manifests.get(id).every(mutation => receipts.has(mutation)))
    seals++
    return response({ status: 'COMPLETE' })
  }
  const id = options.headers['x-drawing-mutation']
  const checkpoint = options.headers['x-drawing-checkpoint']
  assert(manifests.get(checkpoint).includes(id), 'mutation must have a declared server lineage')
  const wire = JSON.stringify([options.method, url, body])
  if (receipts.has(id)) {
    assert.equal(receipts.get(id).wire, wire, 'replay must retain its exact request')
    return response(receipts.get(id).result)
  }
  if (body.sourceEditorId === 'second' && failSecond) return response({ message: 'invalid geometry' }, 400)
  const result = { id: randomUUID(), version: 1 }
  receipts.set(id, { wire, result }); writes++
  if (loseFirstResponse) { loseFirstResponse = false; throw new Error('response lost after commit') }
  return response(result)
}
const waitUntil = async predicate => {
  const deadline = Date.now() + 6000
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
  assert(predicate(), JSON.stringify(getSyncStatus()))
}
initLiveSync(conn)
await initCanonicalSyncQueue(conn, buildingId, { deferUpload: true })
await initLiveSyncQueue(buildingId)
await enqueueGeometryOps(['first', 'second'].map(id => ({ opType: 'ADD_NODE', payload: { ifcGlobalId: id, x: 0, y: 0 } })), doc)
await waitUntil(() => getSyncStatus().failed === 1 && !getSyncStatus().draining)
assert.equal(writes, 1, 'lost response replay executes once')
assert.equal(seals, 0, 'failed/interrupted projection never seals')
const persisted = await getAssetStorage().get(DB_STORES.METADATA, `liveSyncQueue:${buildingId}`)
assert(persisted.value.some(item => item.wire && item.status === 'dead'))
teardownLiveSyncQueue(); teardownCanonicalSyncQueue()
await initCanonicalSyncQueue(conn, buildingId, { deferUpload: true })
await initLiveSyncQueue(buildingId)
assert.equal(seals, 0, 'reopening does not discard failed lineage')
failSecond = false
retryFailed()
await waitUntil(() => getSyncStatus().total === 0 && !getSyncStatus().draining)
assert.equal(writes, 2)
assert.equal(seals, 1)
await enqueueGeometryOps([{ opType: 'ADD_OPENING', payload: { ifcGlobalId: 'orphan', wallIfcId: 'missing' } }], doc)
await waitUntil(() => getSyncStatus().failed === 1 && !getSyncStatus().draining)
assert.equal(seals, 1, 'unresolved dependency remains unsealed')
teardownLiveSyncQueue(); teardownCanonicalSyncQueue(); teardownLiveSync()
console.log('PASS: canonical manifest, exact-wire replay, durable failure/reopen, resume, and unresolved-dependency checkpoint proof')
