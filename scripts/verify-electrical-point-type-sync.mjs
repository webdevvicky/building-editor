// scripts/verify-electrical-point-type-sync.mjs
//
// Stream 2 — a placed electrical point's canonical `pointType` must flow through the
// sync boundary: it rides the ADD_ELEMENT payload, it is part of the element change
// SIGNATURE (so a type change re-syncs), and it survives the op→REST mapping onto both
// POST /geometry/buildings/:id/elements and PATCH /geometry/elements/:id.
//
// Two layers:
//   A. Unit — the emitters + signature carry pointType (fast, localises failures).
//   B. Integration — drive the REAL syncEngine diff → liveSyncQueue → mock ERP fetch:
//      placing a point POSTs pointType; changing it PATCHes pointType.
//
// Pure Node: an in-memory IDB adapter + a fake-ERP global fetch.

import assert from 'node:assert'
import { makeMemoryAdapter } from '../src/projects/storage/indexedDb.js'
import { setAssetStorage } from '../src/projects/storage/getAssetStorage.js'
import * as E from '../src/projects/syncEmitters.js'
import { ELEMENT_REGISTRY } from '../src/projects/elementRegistry.js'
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

const MEP_ELECTRICAL = ELEMENT_REGISTRY.MEP_ELECTRICAL
const pt = (over = {}) => ({
  id: 'ep1', ifcGlobalId: 'ep-ifc-1', floorId: 'F1', discipline: 'ELECTRICAL',
  type: 'AC_INDOOR_POINT', pointType: 'AC', x: 10, y: 20, roomId: null, ...over,
})

// ── A. Unit: emitters + signature carry pointType ────────────────────────────
console.log('\nA. emitters + change signature')
{
  const add = E.elementAddOp({}, MEP_ELECTRICAL, pt())
  ok('elementAddOp payload carries pointType', add.payload.pointType === 'AC', JSON.stringify(add.payload))
  ok('elementAddOp still carries kind (MEP_ELECTRICAL)', add.payload.kind === 'MEP_ELECTRICAL')

  const upd = E.elementUpdateOp({}, MEP_ELECTRICAL, pt())
  ok('elementUpdateOp payload carries pointType', upd.payload.pointType === 'AC')
  ok('elementUpdateOp omits kind (SHAPE-only PATCH)', upd.payload.kind === undefined)

  const sigA = E.signature('electricalPoints', pt({ pointType: 'AC' }))
  const sigB = E.signature('electricalPoints', pt({ pointType: 'SOCKET_16A' }))
  const sigA2 = E.signature('electricalPoints', pt({ pointType: 'AC' }))
  ok('signature changes when pointType changes (→ re-sync)', sigA !== sigB)
  ok('signature stable when pointType unchanged (no spurious re-sync)', sigA === sigA2)

  // A point with no pointType (other MEP disciplines) → benign omit, no crash.
  const noType = E.elementAddOp({}, MEP_ELECTRICAL, pt({ pointType: undefined }))
  ok('missing pointType omitted from payload (benign for non-electrical)', !('pointType' in noType.payload))
}

// ── B. Integration: syncEngine diff → queue → REST carries pointType ─────────
console.log('\nB. full sync path (ADD_ELEMENT POST + UPDATE_ELEMENT PATCH)')

const calls = []
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ method: opts.method ?? 'GET', url: String(url), body: opts.body ? JSON.parse(opts.body) : null })
  return { ok: true, status: 200, text: async () => '', json: async () => ({ success: true, data: { id: 'erp-el-1' } }) }
}
const elementPosts = () => calls.filter((c) => c.method === 'POST' && /\/geometry\/buildings\/[^/]+\/elements$/.test(c.url))
const elementPatches = () => calls.filter((c) => c.method === 'PATCH' && /\/geometry\/elements\/[^/]+$/.test(c.url))

const conn = {
  erpUrl: 'http://erp.test', buildingId: 'b-1',
  floorIds: { F1: 'erp-floor-1' }, getToken: async () => 'scoped-token',
}

// A minimal store: element collections captured into the shadow by reference, so a
// pointType change must be an IMMUTABLE update (new map + new point), like the store does.
function state(over = {}) {
  return {
    nodes: {}, walls: {}, rooms: {},
    electricalPoints: over.electricalPoints ?? {},
    projectSettings: { floors: [{ id: 'F1' }] },
  }
}

async function main() {
  setAssetStorage(makeMemoryAdapter())
  await initLiveSyncQueue('b-1')
  initLiveSync(conn)

  // Seed the engine with NO electrical points (nothing to re-emit on start).
  const store = { getState: () => state(), subscribe: () => () => {} }
  startSyncEngine(store, { coordinated: true })
  await sleep(20)

  // Place an AC point → ADD_ELEMENT POST carrying pointType:'AC'.
  flushSyncEngine(state({ electricalPoints: { ep1: pt({ pointType: 'AC' }) } }))
  await waitFor(() => elementPosts().length >= 1)
  const post = elementPosts()[0]
  ok('placing a point POSTs to the elements surface', !!post && post.url === 'http://erp.test/api/v1/geometry/buildings/b-1/elements')
  ok('ADD_ELEMENT body carries pointType:AC', post?.body?.pointType === 'AC', JSON.stringify(post?.body))
  ok('ADD_ELEMENT body carries kind + sourceEditorId', post?.body?.kind === 'MEP_ELECTRICAL' && post?.body?.sourceEditorId === 'ep-ifc-1')

  // Change the point type AC → SOCKET_16A (immutable update) → UPDATE_ELEMENT PATCH.
  flushSyncEngine(state({ electricalPoints: { ep1: pt({ pointType: 'SOCKET_16A' }) } }))
  await waitFor(() => elementPatches().length >= 1)
  const patch = elementPatches()[0]
  ok('changing the type PATCHes the element (re-sync)', !!patch)
  ok('UPDATE_ELEMENT body carries the new pointType:SOCKET_16A', patch?.body?.pointType === 'SOCKET_16A', JSON.stringify(patch?.body))

  // Re-flush unchanged → no new PATCH (signature stable).
  const n = elementPatches().length
  flushSyncEngine(state({ electricalPoints: { ep1: pt({ pointType: 'SOCKET_16A' }) } }))
  await sleep(40)
  ok('re-flush of unchanged type emits no new PATCH', elementPatches().length === n, `${elementPatches().length} patches`)

  stopSyncEngine()
  teardownLiveSync()
  teardownLiveSyncQueue()

  console.log(`\nverify-electrical-point-type-sync: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })
