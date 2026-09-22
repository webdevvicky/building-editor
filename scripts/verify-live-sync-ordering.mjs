// scripts/verify-live-sync-ordering.mjs
//
// Dependency ordering in the live-sync outbox — the rule that makes
// `POST /geometry/walls/null/openings` structurally impossible.
//
// The bug this pins: the queue is FIFO and drains one op at a time, which gives
// parent-before-child ordering only while the head keeps moving. The old picker
// took the first *pending* op, so a parent sitting in `failed`/`dead` was STEPPED
// OVER and its child was dispatched anyway — resolving its parent id to null and
// interpolating the literal string "null" into the path. The ERP answered 500,
// the op retried five times, "Retry failed" re-fired it, and the chip never
// cleared. Reloading a persisted queue into a fresh session (initLiveSync clears
// the id map) reaches the same state by a different road.
//
// Proves:
//   (i)   an ADD_OPENING whose wall has not been created yet is NOT dispatched —
//         it WAITS (blocked), even when its ADD_WALL has dead-lettered;
//   (ii)  when the wall succeeds, the waiting opening fires with the REAL wall id;
//   (iii) an ADD_OPENING whose wall can never resolve is DROPPED with a reason,
//         so the queue drains empty and the badge clears (no infinite retry);
//   (iv)  an op whose parent is being deleted in the same batch is dropped too;
//   (v)   no URL ever contains `/null/` or `/undefined/`;
//   (vi)  the last-resort backstop: fireLiveOp itself refuses to build a /null
//         path rather than sending one.
//
// Pure Node: an in-memory IDB adapter + a fake-backend global fetch. Nothing
// leaves the machine.

import assert from 'node:assert'
import { makeMemoryAdapter } from '../src/projects/storage/indexedDb.js'
import { setAssetStorage } from '../src/projects/storage/getAssetStorage.js'
import {
  initLiveSync, teardownLiveSync, registerErpId, resolveErpId, fireLiveOp, opDependency,
} from '../src/projects/liveSync.js'
import {
  initLiveSyncQueue, teardownLiveSyncQueue, enqueueGeometryOps, getSyncStatus, retryFailed,
} from '../src/projects/liveSyncQueue.js'

let pass = 0, fail = 0
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}
function header(t) { console.log(`\n${t}`) }
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0)) }

const WALL = 'WallIfc000000000000001'
const OPENING = 'OpenIfc000000000000001'
const ROOM = 'RoomIfc000000000000001'

// ── Fake ERP backend ─────────────────────────────────────────────────────────
let calls = []
let wallPostBehaviour = 'ok'   // 'ok' | 'reject'

const okRes = (body) => ({ ok: true, status: 200, text: async () => '', json: async () => body })
const errRes = (status) => ({ ok: false, status, text: async () => 'nope', json: async () => ({}) })

globalThis.fetch = async (url, opts = {}) => {
  const method = opts.method ?? 'GET'
  const u = String(url)
  calls.push({ method, url: u, body: opts.body ? JSON.parse(opts.body) : null })

  if (method === 'POST' && /\/geometry\/rooms\/[^/]+\/walls$/.test(u)) {
    // 400 dead-letters (permanent) — the state that used to let the child past.
    return wallPostBehaviour === 'reject' ? errRes(400) : okRes({ data: { id: 'erp-wall-1' } })
  }
  if (method === 'POST' && /\/geometry\/walls\/[^/]+\/openings$/.test(u)) {
    return okRes({ data: { id: 'erp-opening-1' } })
  }
  return okRes({ data: { id: 'erp-generic' } })
}

const conn = {
  erpUrl: 'https://erp.test',
  buildingId: 'erp-building-1',
  floorIds: { F1: 'erp-floor-1' },
  getToken: async () => 'token',
}

async function freshQueue() {
  teardownLiveSyncQueue()
  teardownLiveSync()
  setAssetStorage(makeMemoryAdapter())
  calls = []
  initLiveSync(conn)
  await initLiveSyncQueue('erp-building-1')
}

const urls = () => calls.map((c) => `${c.method} ${c.url}`)
const nullPaths = () => urls().filter((u) => /\/(null|undefined)(\/|$)/.test(u))

const wallAddOp = () => ({
  opType: 'ADD_WALL',
  payload: { ifcGlobalId: WALL, roomIfcId: ROOM, materialKey: 'IS_MODULAR_BRICK', height: 120, thickness: 9 },
})
const openingAddOp = () => ({
  opType: 'ADD_OPENING',
  payload: { ifcGlobalId: OPENING, wallIfcId: WALL, type: 'DOOR', width: 36, height: 84 },
})

// ─────────────────────────────────────────────────────────────────────────────
header('1. The dependency table states what each op needs and produces')
{
  const dep = opDependency('ADD_OPENING', { ifcGlobalId: OPENING, wallIfcId: WALL })
  ok('ADD_OPENING needs its wall', dep.needs.length === 1 && dep.needs[0].editorId === WALL, dep.needs[0]?.kind)
  ok('ADD_OPENING produces its own id', dep.produces === OPENING)

  const resolved = opDependency('ADD_OPENING', { ifcGlobalId: OPENING, wallErpId: 'erp-wall-1' })
  ok('a payload carrying the resolved server id has no dependency', resolved.needs.length === 0)

  ok('ADD_WALL produces its own id', opDependency('ADD_WALL', { ifcGlobalId: WALL, roomIfcId: ROOM }).produces === WALL)
  ok('DELETE_WALL destroys its id', opDependency('DELETE_WALL', { ifcGlobalId: WALL }).destroys.includes(WALL))
  ok('an op with no declared dependency is unconstrained', opDependency('UPDATE_FLOOR', {}).needs.length === 0)
}

// ─────────────────────────────────────────────────────────────────────────────
header('2. A child WAITS when its parent is queued but has not succeeded (the live bug)')
{
  await freshQueue()
  registerErpId(ROOM, 'erp-room-1')
  wallPostBehaviour = 'reject'          // ADD_WALL dead-letters at 400

  enqueueGeometryOps([wallAddOp(), openingAddOp()])
  await settle()

  const openingCalls = urls().filter((u) => /\/openings/.test(u))
  ok('the opening was NOT dispatched behind its dead parent', openingCalls.length === 0, `${openingCalls.length} call(s)`)
  ok('no /null/ or /undefined/ path was ever requested', nullPaths().length === 0, nullPaths().join(', '))

  const st = getSyncStatus()
  ok('the failed wall is reported as failed', st.failed === 1, `failed=${st.failed}`)
  ok('the opening is reported as blocked, not in flight', st.blocked === 1, `blocked=${st.blocked}`)
  ok('nothing was silently lost', st.total === 2, `total=${st.total}`)
}

// ─────────────────────────────────────────────────────────────────────────────
header('3. When the parent succeeds, the waiting child fires with the REAL id')
{
  wallPostBehaviour = 'ok'
  retryFailed()                          // the owner clicks "Retry failed"
  await settle()

  ok('the wall was created', urls().some((u) => /\/geometry\/rooms\/erp-room-1\/walls$/.test(u)))
  ok('the wall id is now resolvable', resolveErpId(WALL) === 'erp-wall-1', String(resolveErpId(WALL)))
  ok(
    'the opening followed, addressed to the real wall',
    urls().some((u) => /\/geometry\/walls\/erp-wall-1\/openings$/.test(u)),
    urls().filter((u) => /openings/.test(u)).join(', '),
  )
  ok('still no /null/ path', nullPaths().length === 0, nullPaths().join(', '))

  const st = getSyncStatus()
  ok('"Retry failed" CLEARED the queue', st.total === 0 && st.failed === 0, `total=${st.total} failed=${st.failed}`)
}

// ─────────────────────────────────────────────────────────────────────────────
header('4. A child that can NEVER resolve is dropped with a reason, not retried for ever')
{
  await freshQueue()
  // No ADD_WALL queued and no id registered: the wall was deleted, or it belongs
  // to a session whose id map is gone. Nothing will ever create it.
  enqueueGeometryOps([openingAddOp()])
  await settle()

  ok('nothing was sent', urls().filter((u) => /openings/.test(u)).length === 0, urls().join(', '))
  ok('no /null/ path', nullPaths().length === 0)

  const st = getSyncStatus()
  ok('the queue drained empty (the chip clears)', st.total === 0, `total=${st.total}`)
  ok('it is not sitting in failed', st.failed === 0, `failed=${st.failed}`)
}

// ─────────────────────────────────────────────────────────────────────────────
header('5. A child whose parent is being deleted in the same batch is dropped')
{
  await freshQueue()
  registerErpId(ROOM, 'erp-room-1')
  enqueueGeometryOps([
    openingAddOp(),
    { opType: 'DELETE_WALL', payload: { ifcGlobalId: WALL, wallErpId: 'erp-wall-1' } },
  ])
  await settle()

  ok('the opening was dropped', urls().filter((u) => /openings/.test(u)).length === 0)
  ok('the wall delete still ran', urls().some((u) => /DELETE .*\/geometry\/walls\/erp-wall-1$/.test(u)), urls().join(', '))
  ok('the queue drained empty', getSyncStatus().total === 0)
  ok('no /null/ path', nullPaths().length === 0)
}

// ─────────────────────────────────────────────────────────────────────────────
header('6. Ordering holds for a healthy batch (no regression)')
{
  await freshQueue()
  registerErpId(ROOM, 'erp-room-1')
  enqueueGeometryOps([wallAddOp(), openingAddOp()])
  await settle()

  const seq = urls().filter((u) => /\/walls|\/openings/.test(u))
  ok('wall before opening', /\/walls$/.test(seq[0] ?? ''), seq.join(' | '))
  ok('opening addressed to the real wall', /\/geometry\/walls\/erp-wall-1\/openings$/.test(seq[1] ?? ''))
  ok('the queue drained empty', getSyncStatus().total === 0)
  ok('no /null/ path', nullPaths().length === 0)
}

// ─────────────────────────────────────────────────────────────────────────────
header('7. Backstop: fireLiveOp refuses to build a /null path at all')
{
  await freshQueue()
  const cases = [
    ['ADD_OPENING', { ifcGlobalId: OPENING, wallIfcId: 'never-synced' }],
    ['ADD_WALL', { ifcGlobalId: WALL, roomIfcId: 'never-synced' }],
    ['SPLIT_WALL', { ifcGlobalId: 'never-synced', atFractions: [0.5], newWalls: [] }],
    ['ADD_WALL_SURFACE', { wallIfcId: 'never-synced', roomIfcId: 'never-synced' }],
  ]
  for (const [opType, payload] of cases) {
    calls = []
    let threw = null
    try { await fireLiveOp(opType, payload, conn) } catch (e) { threw = e }
    ok(`${opType} throws instead of requesting /null`, threw !== null, threw?.message?.slice(0, 80))
    ok(`${opType} sent no request`, calls.length === 0)
    ok(`${opType} is marked permanent (→ 400) so it dead-letters`, /→ 400:/.test(String(threw?.message)))
  }
}

teardownLiveSyncQueue()
teardownLiveSync()

console.log(`\n${fail === 0 ? '✓' : '✗'} verify-live-sync-ordering: ${pass} passed, ${fail} failed`)
assert.strictEqual(fail, 0, `${fail} ordering assertion(s) failed`)
