// scripts/verify-canonical-sync.mjs
//
// Phase 1 (1.3–1.5) verification of the canonical Building Document write path:
//   - checksum generation + validation (deterministic; detects corruption)
//   - CANONICAL DOCUMENT PRESERVATION: a topology with T-junctions, shared walls,
//     openings, onWallId, junctions[], nodeOrder[], wallIds[] survives the full
//     write pipeline (editor → wire → fake backend store/retrieve) byte-for-byte,
//     with NO field lost, reordered, normalized, or reconstructed
//   - durable upload + baseVersion advance
//   - retry after a transient failure
//   - stale baseVersion → 409 → refetch authoritative version, never overwrite
//   - autosave persists to IDB and survives a refresh / browser restart
//
// Pure Node: an in-memory IDB adapter + a fake-backend global fetch. This path
// NEVER touches liveSyncQueue or the PostgreSQL projection.

import assert from 'node:assert'
import { makeMemoryAdapter, DB_STORES } from '../src/projects/storage/indexedDb.js'
import { setAssetStorage } from '../src/projects/storage/getAssetStorage.js'
import { buildSnapshot } from '../src/projects/_snapshot.js'
import {
  computeChecksum, verifyChecksum, buildSnapshotDoc, getCanonicalDocument,
} from '../src/projects/canonicalDoc.js'
import {
  initCanonicalSyncQueue, teardownCanonicalSyncQueue, sync,
  getCanonicalBaseVersion, isCanonicalDirty, installCanonicalAutosave,
  _setDirtyForTest,
} from '../src/projects/canonicalSyncQueue.js'

let pass = 0, fail = 0
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}
function header(t) { console.log(`\n${t}`) }
function deepEq(a, b) { try { assert.deepStrictEqual(a, b); return true } catch { return false } }

// ── Fake ERP backend (stores the document verbatim — a JSON round-trip) ──────
const backend = { version: 0, stored: null }
let putFailsLeft = 0
let force409 = false
let forceGetVersion = null
let lastPutBody = null

globalThis.fetch = async (url, opts = {}) => {
  const method = opts.method ?? 'GET'
  const u = String(url)
  if (!u.includes('/document')) {
    return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' }
  }
  if (method === 'GET') {
    const v = forceGetVersion != null ? forceGetVersion : backend.version
    return {
      ok: true, status: 200, text: async () => '',
      json: async () => ({ success: true, data: { snapshotVersion: v, checksum: backend.stored?.checksum ?? null, payload: backend.stored?.payload ?? null } }),
    }
  }
  // PUT
  if (force409) return { ok: false, status: 409, json: async () => ({}), text: async () => 'stale-base' }
  if (putFailsLeft > 0) { putFailsLeft--; return { ok: false, status: 503, json: async () => ({}), text: async () => 'unavailable' } }
  lastPutBody = JSON.parse(opts.body)
  backend.version = (lastPutBody.baseVersion ?? 0) + 1
  backend.stored = { snapshotVersion: backend.version, checksum: lastPutBody.checksum, payload: lastPutBody.payload }
  return { ok: true, status: 200, text: async () => '', json: async () => ({ success: true, data: { snapshotVersion: backend.version } }) }
}

const conn = { erpUrl: 'http://erp.test', getToken: async () => 'scoped-token' }

function resetBackend() { backend.version = 0; backend.stored = null; putFailsLeft = 0; force409 = false; forceGetVersion = null; lastPutBody = null }

// ── A topology exercising every preservation-critical field ──────────────────
function buildTopologyState() {
  const wall = (id, n1, n2, junctions = [], openings = []) => ({
    id, ifcGlobalId: `ifc-${id}`, n1, n2, height: 120, thickness: 9,
    materialKey: 'IS_MODULAR_BRICK', isPlot: false, isVirtual: false, openings,
    hasPlinthBeam: null, hasLintelBeam: null, hasRoofBeam: null, floorId: 'F1',
    classification: null, meta: null, junctions, splitOrigin: 'NONE', labelNo: null,
  })
  const corner = (id, x, y) => ({ id, ifcGlobalId: `ifc-${id}`, x, y, floorIds: ['F1'], kind: 'CORNER', onWallId: null })
  return {
    nodes: {
      n1: corner('n1', 0, 0), n2: corner('n2', 120, 0), n3: corner('n3', 120, 120), n4: corner('n4', 0, 120),
      n5: corner('n5', 240, 0), n6: corner('n6', 240, 120),
      // T-junction mid-span on the shared wall w2, carrying onWallId + kind:
      tj: { id: 'tj', ifcGlobalId: 'ifc-tj', x: 120, y: 60, floorIds: ['F1'], kind: 'TJUNCTION', onWallId: 'w2' },
    },
    walls: {
      w1: wall('w1', 'n1', 'n2', [], [{ id: 'o1', ifcGlobalId: 'ifc-o1', type: 'door', subtype: 'INTERNAL_DOOR', width: 36, height: 84, offset: 12 }]),
      // shared wall (appears in BOTH rooms' wallIds) WITH a T-junction + a window:
      w2: wall('w2', 'n2', 'n3', ['tj'], [{ id: 'o2', ifcGlobalId: 'ifc-o2', type: 'window', subtype: 'WINDOW', width: 48, height: 48, offset: 30 }]),
      w3: wall('w3', 'n3', 'n4'), w4: wall('w4', 'n4', 'n1'),
      w5: wall('w5', 'n2', 'n5'), w6: wall('w6', 'n5', 'n6'), w7: wall('w7', 'n6', 'n3'),
    },
    rooms: {
      r1: { id: 'r1', ifcGlobalId: 'ifc-r1', name: 'Room 1', type: 'OTHER', wallIds: ['w1', 'w2', 'w3', 'w4'], nodeOrder: ['n1', 'n2', 'tj', 'n3', 'n4'], finishes: null, customType: null, floorId: 'F1', classification: null, meta: null, labelNo: null },
      // shared wall w2 also in r2.wallIds; nodeOrder also walks through tj:
      r2: { id: 'r2', ifcGlobalId: 'ifc-r2', name: 'Room 2', type: 'OTHER', wallIds: ['w5', 'w6', 'w7', 'w2'], nodeOrder: ['n2', 'n5', 'n6', 'n3', 'tj'], finishes: null, customType: null, floorId: 'F1', classification: null, meta: null, labelNo: null },
    },
    stamps: {}, columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {},
    plumbingFixtures: {}, electricalPoints: {}, hvacUnits: {}, fireDevices: {},
    elvDevices: {}, solarEquipment: {}, risers: {}, ratesByKey: {}, projectSettings: null,
  }
}

async function main() {
  // ── 1. Checksum generation + validation ──────────────────────────────────
  header('Checksum generation + validation')
  const c1 = await computeChecksum('{"a":1,"b":[1,2,3]}')
  const c1b = await computeChecksum('{"a":1,"b":[1,2,3]}')
  const c2 = await computeChecksum('{"a":1,"b":[1,2,4]}')
  ok('deterministic (same input → same digest)', c1 === c1b, c1)
  ok('sensitive (changed input → different digest)', c1 !== c2)
  const pl = { nodes: { n: 1 }, walls: {} }
  const cs = await computeChecksum(JSON.stringify(pl))
  ok('verifyChecksum accepts a matching payload', (await verifyChecksum(pl, cs)) === true)
  ok('verifyChecksum rejects a corrupted payload', (await verifyChecksum({ ...pl, nodes: { n: 2 } }, cs)) === false)
  ok('verifyChecksum rejects a missing checksum', (await verifyChecksum(pl, null)) === false)

  // ── 2. Canonical document PRESERVATION (editor → wire) ────────────────────
  header('Canonical document preservation (editor → wire round-trip)')
  const state = buildTopologyState()
  const doc = await buildSnapshotDoc(state)
  const expectedPayload = buildSnapshot(state)
  ok('payload === buildSnapshot(state) (no normalization at build)', deepEq(doc.payload, expectedPayload))
  // Simulate the PUT body serialize + the backend store/retrieve (JSON round-trip):
  const wire = JSON.parse(JSON.stringify({ baseVersion: 0, ...doc }))
  ok('payload deep-equal after wire round-trip', deepEq(wire.payload, doc.payload))
  ok('payload byte-for-byte (JSON string identical → no reorder/normalize)',
    JSON.stringify(wire.payload) === JSON.stringify(doc.payload))
  // The specific topology-critical fields:
  ok('T-junction node preserved (kind + onWallId)',
    wire.payload.nodes.tj.kind === 'TJUNCTION' && wire.payload.nodes.tj.onWallId === 'w2')
  ok('wall.junctions[] preserved', deepEq(wire.payload.walls.w2.junctions, ['tj']))
  ok('room.nodeOrder[] preserved (incl. the T-junction vertex)',
    deepEq(wire.payload.rooms.r1.nodeOrder, ['n1', 'n2', 'tj', 'n3', 'n4']))
  ok('room.wallIds[] preserved', deepEq(wire.payload.rooms.r1.wallIds, ['w1', 'w2', 'w3', 'w4']))
  ok('shared wall present in BOTH rooms’ wallIds',
    wire.payload.rooms.r1.wallIds.includes('w2') && wire.payload.rooms.r2.wallIds.includes('w2'))
  ok('openings preserved (door + window)',
    deepEq(wire.payload.walls.w1.openings[0], { id: 'o1', ifcGlobalId: 'ifc-o1', type: 'door', subtype: 'INTERNAL_DOOR', width: 36, height: 84, offset: 12 }) &&
    wire.payload.walls.w2.openings[0].type === 'window')
  ok('checksum validates the round-tripped payload', (await verifyChecksum(wire.payload, wire.checksum)) === true)

  // ── 3. Preservation THROUGH the real write pipeline (queue → backend → read)
  header('Preservation through the write pipeline (PUT → backend → GET)')
  setAssetStorage(makeMemoryAdapter())
  resetBackend()
  const mem = (await import('../src/projects/storage/getAssetStorage.js')).getAssetStorage()
  await initCanonicalSyncQueue(conn, 'bld-1')
  ok('baseVersion seeded from server (0)', getCanonicalBaseVersion() === 0)
  await mem.put(DB_STORES.SNAPSHOTS, 'bld-1', doc)
  _setDirtyForTest()
  const r3 = await sync()
  ok('upload succeeded', r3 === 'uploaded')
  ok('baseVersion advanced to 1', getCanonicalBaseVersion() === 1)
  ok('PUT carried baseVersion 0 (the guard input)', lastPutBody?.baseVersion === 0)
  const readBack = await getCanonicalDocument(conn, 'bld-1')
  ok('backend returns snapshotVersion 1', readBack.snapshotVersion === 1)
  ok('READ-BACK payload byte-for-byte equals the original (no field lost/reordered/reconstructed)',
    JSON.stringify(readBack.payload) === JSON.stringify(expectedPayload))
  ok('READ-BACK deep-equals the original topology', deepEq(readBack.payload, expectedPayload))

  // ── 4. Retry after a transient failure ────────────────────────────────────
  header('Retry after a transient failure')
  teardownCanonicalSyncQueue(); resetBackend()
  setAssetStorage(makeMemoryAdapter())
  const mem4 = (await import('../src/projects/storage/getAssetStorage.js')).getAssetStorage()
  await initCanonicalSyncQueue(conn, 'bld-1')
  await mem4.put(DB_STORES.SNAPSHOTS, 'bld-1', doc)
  putFailsLeft = 1
  _setDirtyForTest()
  const r4a = await sync()
  ok('first attempt reports retry (transient 503)', r4a === 'retry')
  ok('still dirty after a transient failure (op not dropped)', isCanonicalDirty() === true)
  ok('baseVersion unchanged after transient failure', getCanonicalBaseVersion() === 0)
  const r4b = await sync()
  ok('second attempt uploads', r4b === 'uploaded')
  ok('baseVersion advanced after retry', getCanonicalBaseVersion() === 1)

  // ── 5. Stale baseVersion → 409 → refetch, never overwrite ─────────────────
  header('Stale baseVersion → 409 → refetch authoritative version')
  teardownCanonicalSyncQueue(); resetBackend()
  setAssetStorage(makeMemoryAdapter())
  const mem5 = (await import('../src/projects/storage/getAssetStorage.js')).getAssetStorage()
  backend.version = 2 // server already at v2
  await initCanonicalSyncQueue(conn, 'bld-1')
  ok('baseVersion seeded to server v2', getCanonicalBaseVersion() === 2)
  await mem5.put(DB_STORES.SNAPSHOTS, 'bld-1', doc)
  force409 = true; forceGetVersion = 5 // server advanced to v5 elsewhere
  _setDirtyForTest()
  const r5 = await sync()
  ok('409 reported as conflict-retry (not dropped)', r5 === 'conflict-retry')
  ok('refetched the authoritative baseVersion (5)', getCanonicalBaseVersion() === 5)
  ok('still dirty (will retry at the corrected version)', isCanonicalDirty() === true)

  // ── 6. Autosave persists to IDB and survives a restart ────────────────────
  header('Autosave persists to IDB + survives refresh/restart')
  teardownCanonicalSyncQueue(); resetBackend()
  const memAdapter = makeMemoryAdapter()
  setAssetStorage(memAdapter)
  await initCanonicalSyncQueue(conn, 'bld-auto')
  // Offline for uploads: the autosaved snapshot stays UNSENT, so the durable
  // dirty state is what a restart must recover.
  putFailsLeft = 9999
  const storeStub = (() => {
    const subs = new Set()
    return { getState: () => state, subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn) }, notify: () => { for (const fn of subs) fn() } }
  })()
  const auto = installCanonicalAutosave(storeStub, 'bld-auto', { debounceMs: 50 })
  storeStub.notify()             // a committed store change
  await auto.flushNow()          // deterministic flush (upload will fail → stays dirty)
  const persistedSnap = await memAdapter.get(DB_STORES.SNAPSHOTS, 'bld-auto')
  const persistedMeta = await memAdapter.get(DB_STORES.METADATA, 'canonicalSyncQueue:bld-auto')
  ok('snapshot persisted to IDB SNAPSHOTS[buildingId]', !!persistedSnap?.payload)
  ok('persisted snapshot preserves the topology', deepEq(persistedSnap.payload, expectedPayload))
  ok('dirty flag persisted to IDB METADATA (resumes on restart)', persistedMeta?.value?.dirty === true)
  auto.uninstall()
  // Simulate a restart: tear down, then re-init against the SAME durable IDB
  // (uploads still offline, so the unsent dirty state must survive).
  teardownCanonicalSyncQueue()
  await initCanonicalSyncQueue(conn, 'bld-auto')
  ok('after restart, queue re-loads the unsent-dirty flag', isCanonicalDirty() === true)
  ok('after restart, the snapshot is still in IDB', !!(await memAdapter.get(DB_STORES.SNAPSHOTS, 'bld-auto'))?.payload)
  teardownCanonicalSyncQueue()

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${fail === 0 ? '✓ PASS' : '✗ FAIL'} — ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
