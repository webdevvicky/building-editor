import { writeFileSync } from 'node:fs'
import { initCheckpointTest } from './checkpoint-test-setup.mjs'
// scripts/verify-wall-opening-sync.mjs
//
// Walls, openings and floors reach the ERP from the REAL store actions — the
// user-facing entry points — through the real sync engine, queue and dispatcher
// (fake ERP backend, nothing leaves the machine).
//
// Proves (erp-saas docs/bugs.md rows):
//   XR-11  a wall no room owns is created on its floor; when a room is later drawn on
//          it, the wall is re-sent under that room (so the ERP adds the room's faces);
//   XR-17  resizing / moving / changing the sill of an opening PATCHes it; a type
//          change re-sends the ADD; nothing is deleted and re-added;
//   XR-07  the sill height and count ride the ADD and the UPDATE;
//   XR-16  a wall height / material change PATCHes the wall; the Split tool sends ONE
//          split (never a delete + two adds) naming each piece's rooms; the openings
//          follow onto their piece; the Join tool sends ONE join naming both walls;
//          an undo of a split is a join back onto the original wall;
//   XR-12  a floor height / plinth edit PATCHes the floor row (never a create replay).

import { useStore } from '../src/store.js'
import { makeMemoryAdapter } from '../src/projects/storage/indexedDb.js'
import { setAssetStorage } from '../src/projects/storage/getAssetStorage.js'
import { initLiveSync, teardownLiveSync } from '../src/projects/liveSync.js'
import { initLiveSyncQueue, teardownLiveSyncQueue, getSyncStatus } from '../src/projects/liveSyncQueue.js'
import { startSyncEngine, stopSyncEngine, flushSyncEngine } from '../src/projects/syncEngine.js'

const s = useStore.getState
const FT = 12
let pass = 0, fail = 0
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}
function header(t) { console.log(`\n${t}`) }
const tick = () => new Promise((r) => setTimeout(r, 0))

// ── Fake ERP backend: mints ids, answers each geometry route in its real shape ──
const openingBodies = {}
let calls = []
let seq = 0
const okRes = (data) => ({ ok: true, status: 200, text: async () => '', json: async () => ({ success: true, data }) })
globalThis.fetch = async (url, opts = {}) => {
  const method = opts.method ?? 'GET'
  const u = String(url).replace('http://erp.test/api/v1', '')
  const body = opts.body ? JSON.parse(opts.body) : null
  calls.push({ method, url: u, body })
  if (method === 'POST' && /\/openings$/.test(u)) openingBodies.add = body
  if (method === 'PATCH' && /\/openings\//.test(u)) openingBodies.patch = body
  if (method === 'POST' && /\/split$/.test(u)) {
    return okRes({ walls: body.newWalls.map((w) => ({ id: `erp-${++seq}`, sourceEditorId: w.sourceEditorId, version: 0 })) })
  }
  if (method === 'POST' && /\/walls\/join$/.test(u)) {
    return okRes({ wall: { id: `erp-${++seq}`, sourceEditorId: body.merged.sourceEditorId, version: 0 } })
  }
  if (method === 'PATCH') return okRes({ id: u.split('/').pop(), version: 1 })
  return okRes({ id: `erp-${++seq}`, version: 0 })
}

const conn = { buildingId: 'bld-1', floorIds: { F1: 'erp-F1' }, erpUrl: 'http://erp.test', getToken: async () => 't' }

async function sync() {
  calls = []
  await flushSyncEngine(s())
  for (let i = 0; i < 400 && getSyncStatus().total > 0; i++) await tick()
  ok('the queue drained with nothing failed', getSyncStatus().total === 0 && getSyncStatus().failed === 0,
    `total=${getSyncStatus().total} failed=${getSyncStatus().failed}`)
  return calls.filter((c) => !c.url.startsWith('/building-structure/'))
}
const find = (cs, method, re) => cs.filter((c) => c.method === method && re.test(c.url))
const nullPath = (cs) => cs.some((c) => /\/(null|undefined)(\/|$)/.test(c.url))

async function main() {
  setAssetStorage(makeMemoryAdapter())
  initLiveSync(conn)
  await initCheckpointTest(conn, 'bld-1')
  await initLiveSyncQueue('bld-1')
  s().loadProject({
    nodes: {}, walls: {}, rooms: {}, stamps: {}, columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {},
    projectSettings: undefined, unit: 'inch',
  })
  s().setDrawReference('centerline')
  startSyncEngine(useStore, { coordinated: true })

  // ── XR-11: a wall no room owns ──────────────────────────────────────────────
  header('XR-11 — a wall no room owns lives on its floor; a room drawn on it later adopts it')
  const a = s().getOrCreateNode(30 * FT, 0)
  const b = s().getOrCreateNode(40 * FT, 0)
  s().addWall(a, b)
  let cs = await sync()
  const standalone = Object.values(s().walls).find((w) => w.n1 === a || w.n2 === a)
  ok('the wall is POSTed on its floor', find(cs, 'POST', /^\/geometry\/floors\/erp-F1\/walls$/).length === 1, cs.map((c) => `${c.method} ${c.url}`).join(' | '))
  ok('… and not under any room', find(cs, 'POST', /^\/geometry\/rooms\//).length === 0)

  // ── Two rooms sharing a wall ────────────────────────────────────────────────
  header('Two rooms sharing a wall, with a window')
  const r1 = s().addRectangleRoom(0, 0, 10 * FT, 10 * FT, { type: 'OTHER' })
  const r2 = s().addRectangleRoom(10 * FT, 0, 20 * FT, 10 * FT, { type: 'OTHER' })
  cs = await sync()
  ok('two rooms created', find(cs, 'POST', /\/geometry\/floors\/erp-F1\/rooms$/).length === 2)
  ok('room walls go under their owner room', find(cs, 'POST', /^\/geometry\/rooms\/[^/]+\/walls$/).length >= 7)
  const shared = r1.wallIds.find((w) => r2.wallIds.includes(w))
  ok('the rooms share a wall', !!shared)

  s().addOpening(shared, { offset: 24, width: 48, height: 48, type: 'window' })
  cs = await sync()
  let addOpening = find(cs, 'POST', /\/openings$/)[0]
  ok('ADD_OPENING sends count 1', addOpening?.body?.count === 1, JSON.stringify(addOpening?.body))
  ok('a window with no sill set sends no sill (absent ≠ 0)', addOpening && !('heightFromFloorMm' in addOpening.body))
  const opening = s().walls[shared].openings[0]

  // ── XR-17 / XR-07: opening resize, move, sill; type change ────────────────────
  header('XR-17 / XR-07 — an opening resized, moved and given a sill is PATCHed')
  s().updateOpening(shared, opening.id, { width: 60, offset: 30, sillHeight: 36 })
  cs = await sync()
  const patch = find(cs, 'PATCH', /^\/geometry\/openings\//)
  ok('one PATCH of the opening', patch.length === 1, cs.map((c) => `${c.method} ${c.url}`).join(' | '))
  ok('… with the new size, position, sill and count',
    patch[0]?.body?.widthMm === 1524 && patch[0]?.body?.offsetFromStartMm === 762
      && patch[0]?.body?.heightFromFloorMm === 914 && patch[0]?.body?.count === 1, JSON.stringify(patch[0]?.body))
  ok('… and no delete / re-add', find(cs, 'DELETE', /openings/).length === 0 && find(cs, 'POST', /openings/).length === 0)

  s().updateOpening(shared, opening.id, { type: 'door' })
  cs = await sync()
  const retype = find(cs, 'POST', /\/openings$/)
  ok('a type change re-sends the ADD (the ERP\'s type path) on the same opening',
    retype.length === 1 && retype[0].body.sourceEditorId === opening.ifcGlobalId && retype[0].body.openingType === 'DOOR', JSON.stringify(retype[0]?.body))
  ok('… a door\'s sill is the floor (0)', retype[0]?.body?.heightFromFloorMm === 0)
  ok('… nothing deleted', find(cs, 'DELETE', /openings/).length === 0)

  for (const [subtype, usage] of [['MAIN_DOOR', 'MAIN_ENTRANCE'], ['INTERNAL_DOOR', 'INTERNAL'], ['UNCLASSIFIED', 'UNCLASSIFIED']]) {
    s().updateOpening(shared, opening.id, { subtype, subtypeSource: 'EXPLICIT' })
    cs = await sync()
    const usagePatch = find(cs, 'PATCH', /^\/geometry\/openings\//)
    ok(`subtype-only ${subtype} change PATCHes usage`, usagePatch.length === 1 && usagePatch[0].body.usage === usage)
    ok('usage change keeps opening identity', find(cs, 'POST', /\/openings$/).length === 0 && find(cs, 'DELETE', /openings/).length === 0)
  }
  if (process.env.ERP_OPENING_FIXTURE) writeFileSync(process.env.ERP_OPENING_FIXTURE, JSON.stringify(openingBodies, null, 2) + '\n')


  // ── XR-16: wall height / material ─────────────────────────────────────────────
  header('XR-16 — a wall height or material change PATCHes the wall')
  s().setWallHeight(shared, 110)
  cs = await sync()
  let wp = find(cs, 'PATCH', /^\/geometry\/walls\//)
  ok('height change → one wall PATCH carrying heightMm + version', wp.length === 1 && wp[0].body.heightMm === 2794 && typeof wp[0].body.version === 'number', JSON.stringify(wp[0]?.body))
  s().setWallMaterial(shared, 'AAC_BLOCK')
  cs = await sync()
  wp = find(cs, 'PATCH', /^\/geometry\/walls\//)
  ok('material change → one wall PATCH carrying the material', wp.length === 1 && wp[0].body.wallMaterial === 'AAC_BLOCK_200MM', JSON.stringify(wp[0]?.body))

  // ── XR-16 / XR-08: split ─────────────────────────────────────────────────────
  header('XR-16 / XR-08 — the Split tool sends ONE split naming each piece\'s rooms')
  const sharedIfc = s().walls[shared].ifcGlobalId
  const n1 = s().nodes[s().walls[shared].n1], n2 = s().nodes[s().walls[shared].n2]
  const split = s().splitWall(shared, (n1.x + n2.x) / 2, (n1.y + n2.y) * 0.75)
  ok('the split succeeded', !split.error, JSON.stringify(split))
  cs = await sync()
  const splits = find(cs, 'POST', /\/split$/)
  ok('exactly one split request', splits.length === 1, cs.map((c) => `${c.method} ${c.url}`).join(' | '))
  ok('no DELETE of the cut wall and no plain ADD of its pieces',
    find(cs, 'DELETE', /\/geometry\/walls\//).length === 0 && find(cs, 'POST', /^\/geometry\/(rooms|floors)\/[^/]+\/walls$/).length === 0)
  const pieces = splits[0]?.body?.newWalls ?? []
  ok('two pieces, each bounding BOTH rooms (a shared wall cut through)',
    pieces.length === 2 && pieces.every((p) => p.roomIds.length === 2), JSON.stringify(pieces.map((p) => p.roomIds)))
  ok('the new node is created before the split', cs.findIndex((c) => /\/nodes$/.test(c.url)) < cs.findIndex((c) => /\/split$/.test(c.url)))
  const moved = find(cs, 'POST', /\/openings$/)
  ok('the opening is re-sent onto the piece it now sits on', moved.length === 1 && moved[0].body.sourceEditorId === opening.ifcGlobalId, JSON.stringify(moved.map((m) => m.url)))
  ok('no /null/ path', !nullPath(cs))

  // ── undo of the split = a join back onto the original wall ────────────────────
  header('Undo of a split is a join back onto the original wall (same editor id)')
  s().undo()
  cs = await sync()
  const unjoin = find(cs, 'POST', /\/walls\/join$/)
  ok('one join, merging both pieces into the ORIGINAL wall id', unjoin.length === 1 && unjoin[0].body.merged.sourceEditorId === sharedIfc && unjoin[0].body.wallIds.length === 2, JSON.stringify(unjoin[0]?.body))
  ok('no wall delete or plain add', find(cs, 'DELETE', /\/geometry\/walls\//).length === 0 && find(cs, 'POST', /^\/geometry\/(rooms|floors)\/[^/]+\/walls$/).length === 0)

  // ── Join tool ─────────────────────────────────────────────────────────────────
  header('XR-16 — the Join tool sends ONE join naming both walls; the survivor keeps its id')
  const again = s().splitWall(shared, (n1.x + n2.x) / 2, (n1.y + n2.y) * 0.75)
  await sync()
  const joined = s().joinWalls(again.w1Id, again.w2Id)
  ok('the join succeeded', !joined.error, JSON.stringify(joined))
  cs = await sync()
  const joins = find(cs, 'POST', /\/walls\/join$/)
  const survivor = s().walls[joined.survivorId]
  ok('one join whose merged wall is the survivor, naming both walls',
    joins.length === 1 && joins[0].body.merged.sourceEditorId === survivor.ifcGlobalId && joins[0].body.wallIds.length === 2, JSON.stringify(joins[0]?.body))
  ok('the partner is not deleted separately and the survivor is not PATCHed separately',
    find(cs, 'DELETE', /\/geometry\/walls\//).length === 0 && find(cs, 'PATCH', /\/geometry\/walls\//).length === 0)

  // ── XR-11 continued: a room drawn on the standalone wall adopts it ────────────
  header('XR-11 — a room drawn on a wall that bounded none re-sends it under that room')
  const c = s().getOrCreateNode(40 * FT, 10 * FT)
  const d = s().getOrCreateNode(30 * FT, 10 * FT)
  s().addWall(b, c); s().addWall(c, d); s().addWall(d, a)
  await sync()
  const { findUncoveredFaces } = await import('../src/topology/faces.js')
  const face = findUncoveredFaces(s()).find((f) => (f.wallIds ?? []).includes(standalone.id))
  ok('the four walls close a face', !!face)
  if (face) s().createRoomFromFace(face, { type: 'OTHER' })
  cs = await sync()
  const adopted = find(cs, 'POST', /^\/geometry\/rooms\/[^/]+\/walls$/)
  ok('the walls are re-sent under the new room (the ERP adds its faces)',
    adopted.some((p) => p.body.sourceEditorId === standalone.ifcGlobalId), adopted.map((p) => p.body.sourceEditorId).join(','))

  // ── XR-12: floor edit ─────────────────────────────────────────────────────────
  header('XR-12 — a floor height / plinth edit PATCHes the floor row')
  s().updateFloor('F1', { floorHeightFt: 11, plinthHeightFt: 2 })
  cs = await sync()
  const fp = find(cs, 'PATCH', /^\/geometry\/floors\/erp-F1$/)
  ok('one PATCH of the floor', fp.length === 1, cs.map((x) => `${x.method} ${x.url}`).join(' | '))
  ok('… with height and plinth', fp[0]?.body?.floorHeight === 11 && fp[0]?.body?.plinthHeight === 2, JSON.stringify(fp[0]?.body))
  ok('… and never a floor create replay', find(cs, 'POST', /\/floors$/).length === 0)

  stopSyncEngine(); teardownLiveSyncQueue(); teardownLiveSync()
  console.log(`\n${fail === 0 ? '✓ PASS' : '✗ FAIL'} — verify-wall-opening-sync: ${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
