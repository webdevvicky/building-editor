// scripts/verify-room-type-sync.mjs
//
// A room-TYPE change on an ALREADY-synced room must project to the ERP
// INCREMENTALLY — without "Resync all". roomTypeCode rides ONLY on ADD_ROOM
// (PATCH /geometry/rooms is SHAPE-only by design), and the ERP createRoom is
// idempotent by sourceEditorId with a replay branch that updates roomTypeId when
// the payload carries roomTypeCode. So syncEngine's diff re-emits roomAddOp on a
// roomTypeCode delta for a room present in BOTH the prev shadow and current state.
//
// This drives the REAL flushSyncEngine diff → the REAL liveSyncQueue → a mock ERP
// fetch, and asserts:
//   1. changing roomTypeCode on an existing room emits exactly ONE ADD_ROOM POST
//      (incremental — not a whole-building resync) carrying the NEW roomTypeCode,
//   2. a re-flush of the same state emits nothing (shadow advanced — no spurious
//      re-sync),
//   3. a non-type room change (e.g. name — ERP-owned) emits nothing (the guard is
//      keyed on roomTypeCode, defending the SHAPE/STATE boundary),
//   4. a brand-new room + a type change in the same flush each emit ONCE (the ADD
//      loop and the type-delta loop never double-emit the same room),
//   5. clearing the type (→ null) still re-emits, but with NO roomTypeCode in the
//      body (documented limitation: the ERP replay only UPDATES the type, never
//      clears it — acceptable, roomTypeCode is mandatory in the editor).
//
// Pure Node: an in-memory IDB adapter + a fake-ERP global fetch.

import assert from 'node:assert'
import { makeMemoryAdapter } from '../src/projects/storage/indexedDb.js'
import { setAssetStorage } from '../src/projects/storage/getAssetStorage.js'
import { initLiveSync, teardownLiveSync } from '../src/projects/liveSync.js'
import { initLiveSyncQueue, teardownLiveSyncQueue } from '../src/projects/liveSyncQueue.js'
import { startSyncEngine, flushSyncEngine, stopSyncEngine } from '../src/projects/syncEngine.js'

let pass = 0, fail = 0
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(pred, timeoutMs = 1000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) { if (pred()) return true; await sleep(10) }
  return pred()
}

// ── Fake ERP backend: capture every /geometry request ────────────────────────
const calls = []
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ method: opts.method ?? 'GET', url: String(url), body: opts.body ? JSON.parse(opts.body) : null })
  return { ok: true, status: 200, text: async () => '', json: async () => ({ success: true, data: { id: 'erp-room-1' } }) }
}
const roomPosts = () => calls.filter((c) => c.method === 'POST' && /\/geometry\/floors\/[^/]+\/rooms$/.test(c.url))

const conn = {
  erpUrl: 'http://erp.test', buildingId: 'b-1',
  floorIds: { F1: 'erp-floor-1' }, getToken: async () => 'scoped-token',
}

// A room map is captured into the shadow BY REFERENCE, so a type change must be
// an IMMUTABLE update (new map + new room object) — exactly what the store does
// (store.setRoomRoomTypeCode). Mutating in place would alias prev===cur (no delta).
function state({ r1Type = 'OTHER', r1Name = 'Room 1', extraRooms = {} } = {}) {
  return {
    nodes: {}, walls: {},
    rooms: {
      R1: { id: 'R1', ifcGlobalId: 'room-R1', floorId: 'F1', roomShape: 'POLYGON', name: r1Name, roomTypeCode: r1Type, nodeOrder: [], wallIds: [] },
      ...extraRooms,
    },
    projectSettings: { floors: [{ id: 'F1' }] },
  }
}

async function main() {
  setAssetStorage(makeMemoryAdapter())
  await initLiveSyncQueue('b-1')
  initLiveSync(conn)

  // Seed the shadow with R1 = OTHER; existing geometry is NOT re-emitted on start.
  const store = { getState: () => state({ r1Type: 'OTHER' }), subscribe: () => () => {} }
  startSyncEngine(store, { coordinated: true })
  await sleep(20)
  ok('start does not emit for already-synced geometry', roomPosts().length === 0, `${roomPosts().length} posts`)

  // ── 1. Incremental type change OTHER → BEDROOM (no "Resync all") ─────────────
  flushSyncEngine(state({ r1Type: 'BEDROOM' }))
  await waitFor(() => roomPosts().length >= 1)
  const p1 = roomPosts()
  ok('type change emits exactly ONE room POST (incremental, not a resync)', p1.length === 1, `${p1.length} posts`)
  ok('POST targets the room create surface (ADD_ROOM re-emit)', p1[0]?.url === 'http://erp.test/api/v1/geometry/floors/erp-floor-1/rooms')
  ok('body carries the NEW roomTypeCode', p1[0]?.body?.roomTypeCode === 'BEDROOM', JSON.stringify(p1[0]?.body))
  ok('body keys the room by its stable sourceEditorId', p1[0]?.body?.sourceEditorId === 'room-R1')

  // ── 2. Re-flush the SAME state → shadow advanced → no spurious re-sync ───────
  const same = state({ r1Type: 'BEDROOM' })
  flushSyncEngine(same)
  await sleep(40)
  ok('re-flush of unchanged state emits nothing (shadow advanced)', roomPosts().length === 1, `${roomPosts().length} posts`)

  // ── 3. A non-type room change (name — ERP-owned) emits nothing ───────────────
  flushSyncEngine(state({ r1Type: 'BEDROOM', r1Name: 'Master Bedroom' }))
  await sleep(40)
  ok('name-only change does NOT re-sync (guard keyed on roomTypeCode)', roomPosts().length === 1, `${roomPosts().length} posts`)

  // ── 4. New room + a type change in the same flush → each emits ONCE ──────────
  flushSyncEngine(state({
    r1Type: 'KITCHEN', r1Name: 'Master Bedroom',
    extraRooms: { R2: { id: 'R2', ifcGlobalId: 'room-R2', floorId: 'F1', roomShape: 'POLYGON', name: 'Room 2', roomTypeCode: 'BATHROOM', nodeOrder: [], wallIds: [] } },
  }))
  await waitFor(() => roomPosts().length >= 3)
  await sleep(40)
  const p4 = roomPosts().slice(1) // the two new posts from this flush
  const r1Re = p4.filter((c) => c.body?.sourceEditorId === 'room-R1')
  const r2Add = p4.filter((c) => c.body?.sourceEditorId === 'room-R2')
  ok('exactly two posts this flush (new room + type re-emit), no double-emit', p4.length === 2, `${p4.length} posts`)
  ok('R1 re-emitted once with the changed type (KITCHEN)', r1Re.length === 1 && r1Re[0]?.body?.roomTypeCode === 'KITCHEN')
  ok('R2 added once as a brand-new room (BATHROOM)', r2Add.length === 1 && r2Add[0]?.body?.roomTypeCode === 'BATHROOM')

  // ── 5. Clearing the type (→ null): still re-emits, but with NO roomTypeCode ──
  flushSyncEngine(state({ r1Type: null, r1Name: 'Master Bedroom', extraRooms: { R2: { id: 'R2', ifcGlobalId: 'room-R2', floorId: 'F1', roomShape: 'POLYGON', name: 'Room 2', roomTypeCode: 'BATHROOM', nodeOrder: [], wallIds: [] } } }))
  await waitFor(() => roomPosts().length >= 4)
  await sleep(40)
  const p5 = roomPosts()[roomPosts().length - 1]
  ok('clearing the type is detected as a delta (re-emit fires)', roomPosts().length === 4, `${roomPosts().length} posts`)
  ok('cleared type omits roomTypeCode in the body (ERP replay never clears — documented limitation)', p5?.body?.roomTypeCode === undefined)

  stopSyncEngine()
  teardownLiveSync()
  teardownLiveSyncQueue()

  console.log(`\nverify-room-type-sync: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })
