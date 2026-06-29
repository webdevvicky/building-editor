// scripts/verify-floor-delete.mjs
//
// Floor-DELETE verification — the additive completion that lets a floor removed
// mid-session reach the ERP as a DELETE, ordered AFTER its child rooms/walls so
// the FK (room.floorId → floor) is never violated.
//
// The floor's editor `id` is the floor identity end to end (== room.floorId, the
// sourceEditorId the ERP round-trips, the c.floorIds / _idMap key). DELETE_FLOOR
// resolves that id to a real floorErpId and DELETEs /geometry/floors/<id>.
//
// Proves:
//   (i)   deleting a floor (its rooms/walls also gone from state) emits exactly
//         ONE DELETE_FLOOR, ordered AFTER that floor's DELETE_ROOM + DELETE_WALL;
//   (ii)  DELETE_FLOOR resolves a REAL floorErpId and DELETEs /geometry/floors/<id>
//         (never /geometry/floors/null);
//   (iii) the canonical removeFloor action removes that floor's rooms from state
//         (so the diff above can emit the child DELETE_ROOMs).
//
// In-memory IDB adapter + a fake-backend global fetch recording the REST calls in
// order, plus a direct invocation of the real removeFloor action. Because it
// imports the store slice (Vite-style extension-less specifiers), run it via the
// resolver hook:
//   node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-floor-delete.mjs

import assert from 'node:assert'
import { makeMemoryAdapter } from '../src/projects/storage/indexedDb.js'
import { setAssetStorage } from '../src/projects/storage/getAssetStorage.js'
import {
  initLiveSync, teardownLiveSync, registerErpId, resolveErpId,
} from '../src/projects/liveSync.js'
import {
  initLiveSyncQueue, teardownLiveSyncQueue, getSyncStatus,
} from '../src/projects/liveSyncQueue.js'
import {
  startSyncEngine, stopSyncEngine, flushSyncEngine,
} from '../src/projects/syncEngine.js'
import { createStructuralSlice, DEFAULT_FLOOR_ID } from '../src/structuralSlice.js'

let pass = 0, fail = 0
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}
function header(t) { console.log(`\n${t}`) }
const tick = () => new Promise((r) => setTimeout(r, 0))

// ── Fake ERP backend — records every REST call in order ──────────────────────
let calls = []
const okRes = (body) => ({ ok: true, status: 200, text: async () => '', json: async () => body })

globalThis.fetch = async (url, opts = {}) => {
  const method = opts.method ?? 'GET'
  const u = String(url)
  const body = opts.body ? JSON.parse(opts.body) : null
  calls.push({ method, url: u, body })
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

function baseState(floors, rooms = {}, walls = {}, nodes = {}) {
  return {
    nodes, walls, rooms, stamps: {}, columns: {}, beams: {}, slabs: {},
    staircases: {}, foundations: {}, plumbingFixtures: {}, electricalPoints: {},
    hvacUnits: {}, fireDevices: {}, elvDevices: {}, solarEquipment: {}, risers: {},
    ratesByKey: {}, projectSettings: { floors },
  }
}

const F1 = { id: 'F1', label: 'Floor 1', sequence: 0, plinthHeightFt: 1.5, floorHeightFt: 10, meta: null, underlay: null }
const FLOOR2_ID = 'floor-uid-2'
const F2 = { id: FLOOR2_ID, label: 'Floor 2', sequence: 1, plinthHeightFt: 0, floorHeightFt: 10, meta: null, underlay: null }
const roomOnF2 = {
  id: 'r2', ifcGlobalId: 'ifc-r2', name: 'Room 2', type: 'OTHER',
  wallIds: ['w2'], nodeOrder: [], finishes: null, customType: null,
  floorId: FLOOR2_ID, classification: null, meta: null, labelNo: null,
}
const wallOnF2 = {
  id: 'w2', ifcGlobalId: 'ifc-w2', n1: null, n2: null, height: 120, thickness: 9,
  materialKey: 'IS_MODULAR_BRICK', openings: [], floorId: FLOOR2_ID,
}

async function drain() {
  for (let i = 0; i < 200 && getSyncStatus().total > 0; i++) await tick()
}

async function main() {
  const BID = 'bld-floor-del'
  const conn = {
    buildingId: BID,
    floorIds: { F1: 'erp-F1', [FLOOR2_ID]: 'erp-floor-2' }, // seeded at connect / mid-session ADD_FLOOR
    erpUrl: 'http://erp.test',
    getToken: async () => 'scoped-token',
  }

  // ── 1. Delete a floor → ONE DELETE_FLOOR, ordered AFTER its room/wall deletes ─
  header('Delete a floor (+ its room/wall) → ONE DELETE_FLOOR ordered LAST (children-first)')
  setAssetStorage(makeMemoryAdapter())
  calls = []
  teardownLiveSync(); initLiveSync(conn)
  await initLiveSyncQueue(BID)
  // Register the room + wall erp ids so their DELETEs fire a REAL REST call (an
  // unresolved id is a no-op with no call, which would defeat the ordering proof).
  registerErpId('ifc-r2', 'erp-room-2')
  registerErpId('ifc-w2', 'erp-wall-2')

  const store = makeStore(baseState([F1, F2], { r2: roomOnF2 }, { w2: wallOnF2 })) // shadow seeds F1+F2, room+wall
  startSyncEngine(store, { coordinated: true })
  // Floor 2 removed: its room + wall are also gone (what removeFloor + the engine produce).
  store.setState(baseState([F1], {}, {}))
  flushSyncEngine()
  await drain()

  const floorDeletes = calls.filter((c) => c.method === 'DELETE' && /\/geometry\/floors\/[^/]+$/.test(c.url))
  const floorDelIdx = calls.findIndex((c) => c.method === 'DELETE' && /\/geometry\/floors\/[^/]+$/.test(c.url))
  const roomDelIdx = calls.findIndex((c) => c.method === 'DELETE' && /\/geometry\/rooms\/[^/]+$/.test(c.url))
  const wallDelIdx = calls.findIndex((c) => c.method === 'DELETE' && /\/geometry\/walls\/[^/]+$/.test(c.url))

  ok('exactly ONE DELETE_FLOOR emitted', floorDeletes.length === 1, `count=${floorDeletes.length}`)
  ok('DELETE_FLOOR hit a REAL floor id /geometry/floors/erp-floor-2', floorDeletes[0]?.url.includes('/geometry/floors/erp-floor-2'), floorDeletes[0]?.url)
  ok('NEVER requested /geometry/floors/null', !calls.some((c) => c.url.includes('/geometry/floors/null')))
  ok('child DELETE_ROOM was issued', roomDelIdx >= 0, `idx=${roomDelIdx}`)
  ok('child DELETE_WALL was issued', wallDelIdx >= 0, `idx=${wallDelIdx}`)
  ok('DELETE_FLOOR ordered AFTER its DELETE_ROOM', floorDelIdx > roomDelIdx, `floor=${floorDelIdx} room=${roomDelIdx}`)
  ok('DELETE_FLOOR ordered AFTER its DELETE_WALL', floorDelIdx > wallDelIdx, `floor=${floorDelIdx} wall=${wallDelIdx}`)
  ok('queue fully drained (no stuck/failed ops)', getSyncStatus().total === 0)

  stopSyncEngine(); teardownLiveSyncQueue(); teardownLiveSync()

  // ── 2. Unresolved floor id → no-op (never /geometry/floors/null) ─────────────
  header('Delete an UNKNOWN floor → DELETE_FLOOR is a no-op (no /floors/null request)')
  setAssetStorage(makeMemoryAdapter())
  calls = []
  const connNoF2 = { buildingId: BID, floorIds: { F1: 'erp-F1' }, erpUrl: 'http://erp.test', getToken: async () => 'scoped-token' }
  teardownLiveSync(); initLiveSync(connNoF2)
  await initLiveSyncQueue(BID)
  const store2 = makeStore(baseState([F1, F2])) // F2 was NEVER synced (no erp id)
  startSyncEngine(store2, { coordinated: true })
  store2.setState(baseState([F1]))
  flushSyncEngine()
  await drain()
  ok('no /geometry/floors/null request for an unresolved floor', !calls.some((c) => c.url.includes('/geometry/floors/null')))
  ok('no DELETE issued at all for an unsynced floor', !calls.some((c) => c.method === 'DELETE'))
  ok('queue fully drained', getSyncStatus().total === 0)
  stopSyncEngine(); teardownLiveSyncQueue(); teardownLiveSync()

  // ── 3. removeFloor (real action) removes the floor's rooms from state ────────
  header('removeFloor cascades the floor\'s rooms out of canonical state')
  let testState = {
    ...baseState([F1, F2], {
      r1: { ...roomOnF2, id: 'r1', ifcGlobalId: 'ifc-r1', floorId: DEFAULT_FLOOR_ID, wallIds: [] }, // on F1 → stays
      r2: roomOnF2,                                                                                  // on F2 → removed
    }),
    walls: {
      w1: { id: 'w1', ifcGlobalId: 'ifc-w1', floorId: DEFAULT_FLOOR_ID }, // F1 → stays
      w2: { id: 'w2', ifcGlobalId: 'ifc-w2', floorId: FLOOR2_ID },        // F2 → removed
    },
    nodes: {
      n1: { id: 'n1', ifcGlobalId: 'ifc-n1', floorIds: [DEFAULT_FLOOR_ID] }, // F1 → stays
      n2: { id: 'n2', ifcGlobalId: 'ifc-n2', floorIds: [FLOOR2_ID] },        // F2 only → removed
      ns: { id: 'ns', ifcGlobalId: 'ifc-ns', floorIds: [DEFAULT_FLOOR_ID, FLOOR2_ID] }, // shared → kept
    },
    currentFloorId: DEFAULT_FLOOR_ID,
  }
  const set = (updater) => {
    const patch = typeof updater === 'function' ? updater(testState) : updater
    testState = { ...testState, ...patch }
  }
  const get = () => testState
  const uid = () => 'uid-x'
  const slice = createStructuralSlice(set, get, uid)
  slice.removeFloor(FLOOR2_ID)
  ok('floor removed from projectSettings.floors', !testState.projectSettings.floors.some((f) => f.id === FLOOR2_ID))
  ok('room ON the deleted floor removed from state.rooms', testState.rooms.r2 === undefined)
  ok('room on a SURVIVING floor untouched', testState.rooms.r1 !== undefined)
  ok('wall ON the deleted floor removed from state.walls', testState.walls.w2 === undefined)
  ok('wall on a SURVIVING floor untouched', testState.walls.w1 !== undefined)
  ok('node ONLY on the deleted floor removed from state.nodes', testState.nodes.n2 === undefined)
  ok('node on a SURVIVING floor untouched', testState.nodes.n1 !== undefined)
  ok('node SHARED across floors kept (not exclusively on deleted floor)', testState.nodes.ns !== undefined)

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${fail === 0 ? '✓ PASS' : '✗ FAIL'} — ${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
