// scripts/verify-floor-sync.mjs
//
// Floor-sync verification — the missing piece that lets a mid-session floor reach
// the ERP so rooms placed on a NEW floor stop failing with /floors/undefined/rooms.
//
// Floors live in projectSettings.floors[] (NOT a synced store collection). The
// floor's editor `id` is the floor identity used END TO END:
//   • room.floorId (the key ADD_ROOM resolves against)
//   • the sourceEditorId ADD_FLOOR sends + the ERP stores/round-trips
//   • the key c.floorIds / _idMap register + resolve under
// The default floor's id is 'F1' = DEFAULT_FLOOR_ID, matching the new-building
// F1 bootstrap — so this identity is consistent with the existing contract.
//
// Proves:
//   (i)  creating a SECOND floor in the editor state then flushing the sync engine
//        emits exactly ONE ADD_FLOOR op, ordered BEFORE any ADD_ROOM;
//   (ii) a room added on that new floor resolves a REAL floorErpId and POSTs to
//        /geometry/floors/<id>/rooms (never /floors/undefined/rooms);
//   (iii) seedIdMapFromErp populates the floor mapping (_idMap + c.floorIds) from
//        a state.floors payload, so floors from a prior session resolve on reopen.
//
// Pure Node: an in-memory IDB adapter + a fake-backend global fetch recording the
// REST calls in order. Nothing leaves the machine.

import assert from 'node:assert'
import { makeMemoryAdapter } from '../src/projects/storage/indexedDb.js'
import { setAssetStorage } from '../src/projects/storage/getAssetStorage.js'
import {
  initLiveSync, teardownLiveSync, resolveErpId, seedIdMapFromErp,
} from '../src/projects/liveSync.js'
import {
  initLiveSyncQueue, teardownLiveSyncQueue, getSyncStatus,
} from '../src/projects/liveSyncQueue.js'
import {
  startSyncEngine, stopSyncEngine, flushSyncEngine,
} from '../src/projects/syncEngine.js'

let pass = 0, fail = 0
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}
function header(t) { console.log(`\n${t}`) }
const tick = () => new Promise((r) => setTimeout(r, 0))

// ── Fake ERP backend — records every REST call in order ──────────────────────
let calls = []
let stateFloors = []
const okRes = (body) => ({ ok: true, status: 200, text: async () => '', json: async () => body })

globalThis.fetch = async (url, opts = {}) => {
  const method = opts.method ?? 'GET'
  const u = String(url)
  const body = opts.body ? JSON.parse(opts.body) : null
  calls.push({ method, url: u, body })
  if (method === 'POST' && /\/geometry\/buildings\/[^/]+\/floors$/.test(u)) {
    return okRes({ success: true, data: { id: 'erp-floor-2' } })
  }
  if (method === 'POST' && /\/geometry\/floors\/[^/]+\/rooms$/.test(u)) {
    return okRes({ success: true, data: { id: 'erp-room-2' } })
  }
  if (method === 'GET' && u.includes('/state')) {
    return okRes({ success: true, data: { floors: stateFloors, nodes: [], rooms: [], walls: [], elements: [] } })
  }
  return okRes({ success: true, data: { id: 'erp-generic' } })
}

function makeStore(initial) {
  let st = initial
  const subs = new Set()
  return {
    getState: () => st,
    setState: (next) => { st = next; for (const fn of subs) fn() },
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn) },
  }
}

function baseState(floors, rooms = {}, nodes = {}) {
  return {
    nodes, walls: {}, rooms, stamps: {}, columns: {}, beams: {}, slabs: {},
    staircases: {}, foundations: {}, plumbingFixtures: {}, electricalPoints: {},
    hvacUnits: {}, fireDevices: {}, elvDevices: {}, solarEquipment: {}, risers: {},
    ratesByKey: {}, projectSettings: { floors },
  }
}

const F1 = { id: 'F1', label: 'Floor 1', sequence: 0, plinthHeightFt: 1.5, floorHeightFt: 10, meta: null, underlay: null }
// A mid-session floor — its id is a uid (NOT 'F2'), exactly what structuralSlice.addFloor assigns.
const FLOOR2_ID = 'floor-uid-2'
const F2 = { id: FLOOR2_ID, label: 'Floor 2', sequence: 1, plinthHeightFt: 0, floorHeightFt: 10, meta: null, underlay: null }
// A room placed ON the new floor: room.floorId === the new floor's id.
const roomOnF2 = {
  id: 'r2', ifcGlobalId: 'ifc-r2', name: 'Room 2', type: 'OTHER',
  wallIds: [], nodeOrder: [], finishes: null, customType: null,
  floorId: FLOOR2_ID, classification: null, meta: null, labelNo: null,
}

async function drain() {
  for (let i = 0; i < 200 && getSyncStatus().total > 0; i++) await tick()
}

async function main() {
  const BID = 'bld-floor'
  const conn = {
    buildingId: BID,
    floorIds: { F1: 'erp-F1' }, // seeded at connect (new-building bootstrap / reopen)
    erpUrl: 'http://erp.test',
    getToken: async () => 'scoped-token',
  }

  // ── 1. Mid-session floor + room → ADD_FLOOR before ADD_ROOM, real floor id ──
  header('New floor mid-session → ADD_FLOOR (one, ordered first) + room resolves a real floor')
  setAssetStorage(makeMemoryAdapter())
  calls = []
  teardownLiveSync(); initLiveSync(conn)
  await initLiveSyncQueue(BID)
  const store = makeStore(baseState([F1]))      // shadow seeds floors {F1}, rooms {}
  startSyncEngine(store, { coordinated: true })  // coordinated → no self-subscribe; we drive flush
  store.setState(baseState([F1, F2], { r2: roomOnF2 })) // add Floor 2 + a room on it
  flushSyncEngine()                              // coordinator's role, simulated
  await drain()

  const floorPosts = calls.filter((c) => c.method === 'POST' && /\/geometry\/buildings\/[^/]+\/floors$/.test(c.url))
  const roomPosts = calls.filter((c) => c.method === 'POST' && /\/geometry\/floors\/[^/]+\/rooms$/.test(c.url))
  const floorIdx = calls.findIndex((c) => c.method === 'POST' && /\/geometry\/buildings\/[^/]+\/floors$/.test(c.url))
  const roomIdx = calls.findIndex((c) => c.method === 'POST' && /\/geometry\/floors\/[^/]+\/rooms$/.test(c.url))

  ok('exactly ONE ADD_FLOOR POST emitted', floorPosts.length === 1, `count=${floorPosts.length}`)
  ok('ADD_FLOOR sourceEditorId == the floor editor id (consistent identity)', floorPosts[0]?.body?.sourceEditorId === FLOOR2_ID, String(floorPosts[0]?.body?.sourceEditorId))
  ok('ADD_FLOOR floorNumber is 1-based (sequence 1 → 2)', floorPosts[0]?.body?.floorNumber === 2, String(floorPosts[0]?.body?.floorNumber))
  ok('ADD_FLOOR carries floorHeight', floorPosts[0]?.body?.floorHeight === 10)
  ok('ADD_FLOOR ordered BEFORE ADD_ROOM', floorIdx >= 0 && roomIdx >= 0 && floorIdx < roomIdx, `floorIdx=${floorIdx} roomIdx=${roomIdx}`)
  ok('room POSTed to a REAL floor id /geometry/floors/erp-floor-2/rooms', roomPosts.length === 1 && roomPosts[0].url.includes('/geometry/floors/erp-floor-2/rooms'), roomPosts[0]?.url)
  ok('NEVER requested /floors/undefined/rooms (the bug)', !calls.some((c) => c.url.includes('/floors/undefined/rooms')))
  ok('new floor registered in _idMap (resolveErpId)', resolveErpId(FLOOR2_ID, conn) === 'erp-floor-2')
  ok('new floor registered in c.floorIds (same conn the bootstrap seeds)', conn.floorIds[FLOOR2_ID] === 'erp-floor-2')
  ok('queue fully drained (no stuck/failed ops)', getSyncStatus().total === 0)

  stopSyncEngine(); teardownLiveSyncQueue(); teardownLiveSync()

  // ── 2. Re-flush is idempotent — an unchanged floor does NOT re-emit ─────────
  header('Re-flush with no floor change → no second ADD_FLOOR (shadow tracks floors)')
  setAssetStorage(makeMemoryAdapter())
  calls = []
  teardownLiveSync(); initLiveSync(conn)
  await initLiveSyncQueue(BID)
  const store2 = makeStore(baseState([F1, F2], { r2: roomOnF2 })) // shadow already has F1+F2
  startSyncEngine(store2, { coordinated: true })
  flushSyncEngine() // no change since seed
  await drain()
  ok('no ADD_FLOOR re-emitted for an already-synced floor', !calls.some((c) => c.method === 'POST' && /\/floors$/.test(c.url)))
  stopSyncEngine(); teardownLiveSyncQueue(); teardownLiveSync()

  // ── 3. seedIdMapFromErp hydrates the floor map from a state.floors payload ──
  header('seedIdMapFromErp populates floor mapping from state.floors (reopen path)')
  setAssetStorage(makeMemoryAdapter())
  calls = []
  const conn2 = { buildingId: BID, floorIds: {}, erpUrl: 'http://erp.test', getToken: async () => 'scoped-token' }
  teardownLiveSync(); initLiveSync(conn2)
  stateFloors = [{ id: 'erp-floor-9', sourceEditorId: 'floor-uid-9', floorNumber: 2, floorHeight: 10, floorLength: null, floorWidth: null }]
  const seeded = await seedIdMapFromErp(conn2)
  ok('getBuildingState returned the floors payload', Array.isArray(seeded.floors) && seeded.floors.length === 1)
  ok('floor sourceEditorId → ERP id seeded into _idMap', resolveErpId('floor-uid-9', conn2) === 'erp-floor-9')
  ok('c.floorIds rebuilt from state.floors (existing floor resolves on reopen)', conn2.floorIds['floor-uid-9'] === 'erp-floor-9')
  teardownLiveSync()

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${fail === 0 ? '✓ PASS' : '✗ FAIL'} — ${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
