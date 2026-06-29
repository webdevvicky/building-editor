// scripts/verify-invariant-5-7.mjs
//
// Phase 2.5A (Invariants #5/#7) verification of the ordered editor write pipeline:
//   #5 — a projection op cannot enter the live-sync queue until the canonical
//        pipeline has DURABLY ACCEPTED the mutation (canonical snapshot persisted
//        to local IDB + upload enqueued; NOT R2 completion).
//   #7 — each accepted mutation yields exactly ONE canonical lineage (one IDB
//        snapshot write) and ONE projection lineage (one diff flush).
//   Exception — the coordinated sync engine NEVER self-emits; with no coordinator
//        running (the reconstruct-inspection wiring), a change produces neither
//        lineage.
//
// Pure Node: an in-memory IDB adapter (probed for ordering + write counts) and a
// failing fetch (offline) so nothing leaves the machine.

import assert from 'node:assert'
import { makeMemoryAdapter, DB_STORES } from '../src/projects/storage/indexedDb.js'
import { setAssetStorage, getAssetStorage } from '../src/projects/storage/getAssetStorage.js'
import { buildSnapshot } from '../src/projects/_snapshot.js'
import { initLiveSyncQueue, getSyncStatus, teardownLiveSyncQueue } from '../src/projects/liveSyncQueue.js'
import { initCanonicalSyncQueue, teardownCanonicalSyncQueue, isCanonicalDirty } from '../src/projects/canonicalSyncQueue.js'
import { startSyncEngine, stopSyncEngine } from '../src/projects/syncEngine.js'
import { startSyncCoordinator, stopSyncCoordinator } from '../src/projects/syncCoordinator.js'

let pass = 0, fail = 0
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}
function header(t) { console.log(`\n${t}`) }
function deepEq(a, b) { try { assert.deepStrictEqual(a, b); return true } catch { return false } }
const tick = () => new Promise((r) => setTimeout(r, 0)) // drain microtasks (macrotask boundary)

// Offline: every request fails, so the projection drain + canonical GET/upload
// never complete — projection ops stay queued (observable) and uploads no-op.
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => 'offline' })

const conn = { erpUrl: 'http://erp.test', getToken: async () => 'scoped-token' }

// Probe adapter: counts SNAPSHOTS writes (canonical accept) and can BARRIER one,
// suspending the accept so we can assert the projection has not yet emitted.
function makeProbe(base) {
  const s = { snapshotPuts: 0, armed: false, onReached: null, releaseGate: null }
  // Prototype delegation (NOT a Proxy — the memory adapter's methods are
  // non-configurable, which a Proxy get-trap can't legally re-wrap). `get`/etc.
  // resolve to `base` via the prototype chain; only `put` is overridden.
  const adapter = Object.create(base)
  Object.defineProperty(adapter, 'put', {
    configurable: true, enumerable: true, writable: true,
    value: async (store, key, val) => {
      if (store === DB_STORES.SNAPSHOTS) {
        s.snapshotPuts++
        if (s.armed) {
          s.armed = false
          const gate = new Promise((res) => { s.releaseGate = res })
          if (s.onReached) s.onReached()
          await gate
        }
      }
      return base.put(store, key, val)
    },
  })
  return {
    adapter,
    get snapshotPuts() { return s.snapshotPuts },
    arm() { s.armed = true; return new Promise((res) => { s.onReached = res }) },
    release() { if (s.releaseGate) s.releaseGate() },
  }
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

function emptyState() {
  return {
    nodes: {}, walls: {}, rooms: {}, stamps: {}, columns: {}, beams: {}, slabs: {},
    staircases: {}, foundations: {}, plumbingFixtures: {}, electricalPoints: {},
    hvacUnits: {}, fireDevices: {}, elvDevices: {}, solarEquipment: {}, risers: {},
    ratesByKey: {}, projectSettings: null,
  }
}

// A small topology that emits at least one projection op (rooms + walls + nodes).
function buildTopologyState() {
  const wall = (id, n1, n2, junctions = [], openings = []) => ({
    id, ifcGlobalId: `ifc-${id}`, n1, n2, height: 120, thickness: 9,
    materialKey: 'IS_MODULAR_BRICK', isPlot: false, isVirtual: false, openings,
    hasPlinthBeam: null, hasLintelBeam: null, hasRoofBeam: null, floorId: 'F1',
    classification: null, meta: null, junctions, splitOrigin: 'NONE', labelNo: null,
  })
  const corner = (id, x, y) => ({ id, ifcGlobalId: `ifc-${id}`, x, y, floorIds: ['F1'], kind: 'CORNER', onWallId: null })
  return {
    ...emptyState(),
    nodes: {
      n1: corner('n1', 0, 0), n2: corner('n2', 120, 0), n3: corner('n3', 120, 120), n4: corner('n4', 0, 120),
    },
    walls: {
      w1: wall('w1', 'n1', 'n2', [], [{ id: 'o1', ifcGlobalId: 'ifc-o1', type: 'door', subtype: 'INTERNAL_DOOR', width: 36, height: 84, offset: 12 }]),
      w2: wall('w2', 'n2', 'n3'), w3: wall('w3', 'n3', 'n4'), w4: wall('w4', 'n4', 'n1'),
    },
    rooms: {
      r1: { id: 'r1', ifcGlobalId: 'ifc-r1', name: 'Room 1', type: 'OTHER', wallIds: ['w1', 'w2', 'w3', 'w4'], nodeOrder: ['n1', 'n2', 'n3', 'n4'], finishes: null, customType: null, floorId: 'F1', classification: null, meta: null, labelNo: null },
    },
  }
}

async function teardownAll() {
  stopSyncCoordinator()
  stopSyncEngine()
  teardownLiveSyncQueue()
  teardownCanonicalSyncQueue()
}

async function main() {
  const BID = 'bld-57'

  // ── 1. #5 — projection emission cannot precede canonical acceptance ─────────
  header('#5 — canonical ACCEPT happens before projection EMIT')
  {
    const probe = makeProbe(makeMemoryAdapter())
    setAssetStorage(probe.adapter)
    await initLiveSyncQueue(BID)
    await initCanonicalSyncQueue(conn, BID) // offline GET → baseVersion 0
    const store = makeStore(emptyState())
    startSyncEngine(store, { coordinated: true })          // shadow = empty
    startSyncCoordinator(store, BID, { uploadDebounceMs: 10_000_000 })

    const reached = probe.arm()                  // barrier the next canonical IDB write
    store.setState(buildTopologyState())         // committed change → coordinator tick
    await reached                                // tick is now SUSPENDED mid-accept

    ok('projection NOT yet emitted while canonical accept is in flight', getSyncStatus().total === 0,
      `liveSync queue total=${getSyncStatus().total}`)
    ok('canonical not yet marked accepted (dirty) before the snapshot persists', isCanonicalDirty() === false)

    probe.release()                              // canonical IDB write completes → accept
    await tick()                                 // let the tick finish (noteDirty → emit)

    ok('projection emitted AFTER canonical acceptance', getSyncStatus().total > 0,
      `liveSync queue total=${getSyncStatus().total}`)
    ok('canonical accepted (dirty) once the snapshot is durable', isCanonicalDirty() === true)
    const snap = await getAssetStorage().get(DB_STORES.SNAPSHOTS, BID)
    ok('canonical snapshot durably persisted to local IDB', !!snap?.payload)
    await teardownAll()
  }

  // ── 2. #7 — one mutation → one canonical lineage + one projection lineage ────
  header('#7 — exactly one canonical lineage + one projection lineage per mutation')
  {
    const probe = makeProbe(makeMemoryAdapter())
    setAssetStorage(probe.adapter)
    await initLiveSyncQueue(BID)
    await initCanonicalSyncQueue(conn, BID)
    const store = makeStore(emptyState())
    startSyncEngine(store, { coordinated: true })
    startSyncCoordinator(store, BID, { uploadDebounceMs: 10_000_000 })

    ok('no canonical write before any mutation', probe.snapshotPuts === 0)
    const topo = buildTopologyState()
    store.setState(topo)
    await tick()

    ok('exactly ONE canonical snapshot write for one mutation', probe.snapshotPuts === 1,
      `snapshotPuts=${probe.snapshotPuts}`)
    ok('projection lineage present (ops emitted)', getSyncStatus().total > 0,
      `total=${getSyncStatus().total}`)
    const snap = await getAssetStorage().get(DB_STORES.SNAPSHOTS, BID)
    ok('the one canonical snapshot equals the editor snapshot (no normalization)',
      deepEq(snap.payload, buildSnapshot(topo)))
    await teardownAll()
  }

  // ── 3. Exception — coordinated engine never self-emits without the coordinator
  header('Exception — coordinated engine produces NEITHER lineage without the coordinator')
  {
    const probe = makeProbe(makeMemoryAdapter())
    setAssetStorage(probe.adapter)
    await initLiveSyncQueue(BID)
    await initCanonicalSyncQueue(conn, BID)
    const store = makeStore(emptyState())
    startSyncEngine(store, { coordinated: true }) // engine only — NO coordinator (reconstruct-inspection wiring)

    store.setState(buildTopologyState())
    await tick()

    ok('coordinated engine does NOT self-emit a projection', getSyncStatus().total === 0,
      `total=${getSyncStatus().total}`)
    ok('no canonical snapshot written without the coordinator', probe.snapshotPuts === 0,
      `snapshotPuts=${probe.snapshotPuts}`)
    await teardownAll()
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${fail === 0 ? '✓ PASS' : '✗ FAIL'} — ${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
