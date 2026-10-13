// scripts/verify-canonical-reopen.mjs
//
// Phase 2 verification of the canonical READ path (reopenCanvas):
//   - R2 canonical document → loadProject(payload) verbatim (NO reconstruction):
//     the T-junction onWallId / junctions[] survive (reconstruction would null them)
//   - the id-map is seeded from the projection in EVERY non-empty path AND on empty
//     (so the write-through resolves existing entities to UPDATE, never duplicate ADD)
//   - checksum mismatch on R2 → falls back to the IDB local snapshot
//   - no R2 doc, IDB present → loads from IDB
//   - neither present → 'empty' (blank canvas; loadProject not called with geometry)
//   - XR-15: unsent local edits on the server's CURRENT version load (they are the
//     newest copy); unsent local edits on an OLDER version are a clash — the server's
//     copy loads, the local one is kept aside and never uploaded
//
// Pure Node: in-memory IDB + a fake-backend global fetch routing /state vs /document.

import assert from 'node:assert'
import { makeMemoryAdapter, DB_STORES } from '../src/projects/storage/indexedDb.js'
import { setAssetStorage } from '../src/projects/storage/getAssetStorage.js'
import { initLiveSync, resolveErpId, teardownLiveSync } from '../src/projects/liveSync.js'
import { buildSnapshotDoc } from '../src/projects/canonicalDoc.js'
import { reopenCanvas } from '../src/projects/canonicalReopen.js'
import { writeCanonicalQueueMeta, readCanonicalQueueMeta } from '../src/projects/canonicalSyncQueue.js'

let pass = 0, fail = 0
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}
function header(t) { console.log(`\n${t}`) }
function deepEq(a, b) { try { assert.deepStrictEqual(a, b); return true } catch { return false } }

// ── Fake ERP backend ─────────────────────────────────────────────────────────
let docMode = 'valid'        // 'valid' | 'null' | 'badchecksum'
let docPayload = null
let docChecksum = null
let docVersion = 1
const okRes = (body) => ({ ok: true, status: 200, text: async () => '', json: async () => body })

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); const method = opts.method ?? 'GET'
  if (u.includes('/state')) {
    // Drives the id-map seed (sourceEditorId → ERP id).
    return okRes({ success: true, data: { nodes: [{ sourceEditorId: 'ifc-tj', id: 'erp-tj' }], rooms: [], walls: [], elements: [] } })
  }
  if (u.includes('/document') && method === 'GET') {
    if (docMode === 'null') return okRes({ success: true, data: { snapshotVersion: 0, checksum: null, payload: null } })
    if (docMode === 'badchecksum') return okRes({ success: true, data: { snapshotVersion: docVersion, checksum: 'sha256:deadbeef', payload: docPayload } })
    return okRes({ success: true, data: { snapshotVersion: docVersion, checksum: docChecksum, payload: docPayload } })
  }
  return { ok: false, status: 404, json: async () => ({}), text: async () => 'nf' }
}

const conn = { erpUrl: 'http://erp.test', getToken: async () => 'scoped-token' }

// ── A topology with a T-junction (the field reconstruction used to lose) ─────
function topology() {
  return {
    version: 7,
    nodes: {
      n1: { id: 'n1', ifcGlobalId: 'ifc-n1', x: 0, y: 0, floorIds: ['F1'], kind: 'CORNER', onWallId: null },
      n3: { id: 'n3', ifcGlobalId: 'ifc-n3', x: 120, y: 120, floorIds: ['F1'], kind: 'CORNER', onWallId: null },
      tj: { id: 'tj', ifcGlobalId: 'ifc-tj', x: 120, y: 60, floorIds: ['F1'], kind: 'TJUNCTION', onWallId: 'w2' },
    },
    walls: {
      w2: { id: 'w2', ifcGlobalId: 'ifc-w2', n1: 'n1', n2: 'n3', height: 120, thickness: 9, materialKey: 'IS_MODULAR_BRICK', isPlot: false, isVirtual: false, openings: [{ id: 'o1', ifcGlobalId: 'ifc-o1', type: 'door', width: 36, height: 84, offset: 12 }], junctions: ['tj'], splitOrigin: 'NONE', floorId: 'F1' },
    },
    rooms: {
      r1: { id: 'r1', ifcGlobalId: 'ifc-r1', name: 'Room 1', type: 'OTHER', wallIds: ['w2'], nodeOrder: ['n1', 'tj', 'n3'], floorId: 'F1' },
    },
    stamps: {}, columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {},
    plumbingFixtures: {}, electricalPoints: {}, hvacUnits: {}, fireDevices: {},
    elvDevices: {}, solarEquipment: {}, risers: {}, ratesByKey: {}, projectSettings: null,
  }
}

async function main() {
  const state = topology()
  const doc = await buildSnapshotDoc(state)        // { schemaVersion, checksum, payload }
  docPayload = doc.payload; docChecksum = doc.checksum

  // ── 1. R2 path — load canonical verbatim, no reconstruction ───────────────
  header('R2 canonical reopen (verbatim — no reconstruction)')
  setAssetStorage(makeMemoryAdapter()); teardownLiveSync(); initLiveSync(conn)
  docMode = 'valid'; docVersion = 4
  let loaded = null
  let res = await reopenCanvas(conn, 'bld', (d) => { loaded = d })
  ok("source === 'r2'", res.source === 'r2')
  ok('snapshotVersion returned (4) → seeds the queue with no extra GET', res.snapshotVersion === 4)
  ok('loadProject received the canonical payload deep-equal', deepEq(loaded, docPayload))
  ok('T-junction onWallId PRESERVED (reconstruction would null it)', loaded.nodes.tj.onWallId === 'w2')
  ok('T-junction kind preserved', loaded.nodes.tj.kind === 'TJUNCTION')
  ok('wall.junctions[] preserved', deepEq(loaded.walls.w2.junctions, ['tj']))
  ok('room.nodeOrder[] preserved (incl. the T-junction vertex)', deepEq(loaded.rooms.r1.nodeOrder, ['n1', 'tj', 'n3']))
  ok('id-map seeded from /state (existing edits → UPDATE, not ADD)', resolveErpId('ifc-tj', conn) === 'erp-tj')

  // ── 2. Checksum mismatch on R2 → fall back to IDB ─────────────────────────
  header('Checksum mismatch on R2 → IDB fallback')
  const mem2 = makeMemoryAdapter(); setAssetStorage(mem2); teardownLiveSync(); initLiveSync(conn)
  await mem2.put(DB_STORES.SNAPSHOTS, 'bld', doc) // a VALID local snapshot
  docMode = 'badchecksum'
  loaded = null
  res = await reopenCanvas(conn, 'bld', (d) => { loaded = d })
  ok("R2 rejected by checksum → source === 'idb'", res.source === 'idb')
  ok('loaded the IDB snapshot payload', deepEq(loaded, docPayload))
  ok('id-map still seeded', resolveErpId('ifc-tj', conn) === 'erp-tj')

  // ── 3. No R2 doc, IDB present → IDB ───────────────────────────────────────
  header('No R2 document, IDB present → IDB')
  const mem3 = makeMemoryAdapter(); setAssetStorage(mem3); teardownLiveSync(); initLiveSync(conn)
  await mem3.put(DB_STORES.SNAPSHOTS, 'bld', doc)
  docMode = 'null'
  loaded = null
  res = await reopenCanvas(conn, 'bld', (d) => { loaded = d })
  ok("source === 'idb'", res.source === 'idb')
  ok('loaded the IDB snapshot', deepEq(loaded, docPayload))

  // ── 4. Neither → empty (blank canvas), but id-map STILL seeded ────────────
  header('No R2, no IDB → empty (blank), id-map still seeded')
  setAssetStorage(makeMemoryAdapter()); teardownLiveSync(); initLiveSync(conn)
  docMode = 'null'
  loaded = null
  res = await reopenCanvas(conn, 'bld', (d) => { loaded = d })
  ok("source === 'empty'", res.source === 'empty')
  ok('loadProject NOT called with geometry (blank canvas)', loaded === null)
  ok('id-map seeded even on empty (write-through still resolves UPDATE)', resolveErpId('ifc-tj', conn) === 'erp-tj')

  // ── 5. R2 doc present but BAD checksum, NO IDB rescue → integrity-failed ───
  //     (the P0 write-gate case: must NOT be treated as 'empty', or a blank canvas
  //     would overwrite the server's good data).
  header('R2 bad checksum, no IDB → integrity-failed (write gate)')
  setAssetStorage(makeMemoryAdapter()); teardownLiveSync(); initLiveSync(conn)
  docMode = 'badchecksum'; docVersion = 7
  loaded = null
  res = await reopenCanvas(conn, 'bld', (d) => { loaded = d })
  ok("source === 'integrity-failed' (NOT 'empty')", res.source === 'integrity-failed')
  ok('loadProject NOT called (blank, but writes will be gated)', loaded === null)

  // ── 6. Unsent local edits made ON the server's current version → load them ──
  header('Unsent local edits on the current server version → the local copy is the newest (XR-15)')
  const localState = topology(); localState.rooms.r1.name = 'Edited offline'
  const localDoc = await buildSnapshotDoc(localState)
  const mem6 = makeMemoryAdapter(); setAssetStorage(mem6); teardownLiveSync(); initLiveSync(conn)
  await mem6.put(DB_STORES.SNAPSHOTS, 'bld', localDoc)
  await writeCanonicalQueueMeta('bld', { baseVersion: 4, dirty: true })
  docMode = 'valid'; docVersion = 4
  loaded = null
  res = await reopenCanvas(conn, 'bld', (d) => { loaded = d })
  ok("source === 'idb-unsent'", res.source === 'idb-unsent')
  ok('the local (newer) copy is on the canvas', loaded?.rooms?.r1?.name === 'Edited offline')
  ok('the upload base is the server version it descends from (4)', res.snapshotVersion === 4)
  ok('no clash', res.clash === null)

  // ── 7. Unsent local edits made on an OLDER version → clash: server copy wins ──
  header('Unsent local edits on an older version → clash: newer server copy loads, local kept aside, never sent')
  const mem7 = makeMemoryAdapter(); setAssetStorage(mem7); teardownLiveSync(); initLiveSync(conn)
  await mem7.put(DB_STORES.SNAPSHOTS, 'bld', localDoc)
  await writeCanonicalQueueMeta('bld', { baseVersion: 2, dirty: true })
  docMode = 'valid'; docVersion = 6 // someone else saved v3..v6 since
  loaded = null
  res = await reopenCanvas(conn, 'bld', (d) => { loaded = d })
  ok("source === 'r2' (the newer server copy)", res.source === 'r2')
  ok('the server copy is on the canvas, not the stale local one', deepEq(loaded, docPayload))
  ok('the clash is reported (local v2 vs server v6)', deepEq(res.clash, { localBaseVersion: 2, serverVersion: 6 }))
  const meta7 = await readCanonicalQueueMeta('bld')
  ok('the stale copy will NOT be uploaded (unsent flag cleared, base = 6)', deepEq(meta7, { baseVersion: 6, dirty: false }))
  const kept = await mem7.getAll(DB_STORES.SNAPSHOTS, 'bld:clash:v2')
  ok('the stale local copy is kept aside, not destroyed', kept.length === 1 && kept[0].checksum === localDoc.checksum)
  teardownLiveSync()

  console.log(`\n${fail === 0 ? '✓ PASS' : '✗ FAIL'} — ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
