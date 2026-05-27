// scripts/verify-persistence.mjs
//
// Arch 5 Phase 2 — IDB persistence layer correctness.
// Exercises the storage adapter via the in-memory mock so the same logic
// works the same way against real IDB in the browser.
//
// Assertions:
//   - createProject / openProject / saveCurrent round-trip
//   - listProjects sorted by updated DESC
//   - Chunk split + reassemble preserves data shape
//   - Journal append + read-since returns ordered ops
//   - Snapshot write + read latest works
//   - Catalog provenance stamp + retrieve

import {
  makeMemoryAdapter, createPersistence,
  splitDataIntoChunks, PROJECT_CHUNKS, DB_STORES,
} from '../src/projects/storage/indexedDb.js'
import { uid } from '../src/lib/ids.js'

const passed = []
const failed = []
function check(name, cond, info) {
  (cond ? passed : failed).push(`${name}${info ? '  (' + info + ')' : ''}`)
}

const adapter = makeMemoryAdapter()
const p = createPersistence(adapter)

// ── 1. Project CRUD ───────────────────────────────────────────────────
const rec1 = await p.createProject('Test A', 'Residential')
check('createProject returns id', typeof rec1.id === 'string' && rec1.id.length > 0)
check('createProject sets name', rec1.name === 'Test A')
check('createProject sets type', rec1.type === 'Residential')
check('createProject sets timestamps', rec1.created > 0 && rec1.updated > 0)

const rec2 = await p.createProject('Test B', 'Commercial')
const list = await p.listProjects()
check('listProjects returns 2 entries', list.length === 2)
// Updated DESC — rec2 most recent
check('listProjects sorted by updated DESC', list[0].id === rec2.id)

// ── 2. saveCurrent + openProject round-trip ──────────────────────────
const sampleData = {
  schemaVersion: 8,
  unit:          'inch',
  nodes:         { 'n1': { id: 'n1', x: 0, y: 0 } },
  walls:         { 'w1': { id: 'w1', n1: 'n1', n2: 'n1' } },
  rooms:         {},
  stamps:        {},
  columns:       {},
  beams:         {},
  slabs:         {},
  staircases:    {},
  foundations:   {},
  plumbingFixtures: {}, electricalPoints: {}, hvacUnits: {},
  fireDevices: {}, elvDevices: {}, solarEquipment: {}, risers: {},
  ratesByKey:    { 'flooring': 100 },
  projectSettings: {
    projectMeta: { projectTitle: 'Hello' },
    // Area 1 — round-trip the dimensionMode field via IDB.
    dimensionMode: 'clear_internal',
  },
}
const saved = await p.saveCurrent(rec1.id, sampleData)
check('saveCurrent returns true', saved === true)

const opened = await p.openProject(rec1.id)
check('openProject reassembles nodes', opened.nodes['n1']?.x === 0)
check('openProject reassembles walls', opened.walls['w1']?.id === 'w1')
check('openProject reassembles projectSettings',
      opened.projectSettings?.projectMeta?.projectTitle === 'Hello')
check('openProject preserves dimensionMode',
      opened.projectSettings?.dimensionMode === 'clear_internal')
check('openProject reassembles ratesByKey',
      opened.ratesByKey?.flooring === 100)
check('openProject reassembles unit', opened.unit === 'inch')
check('openProject reassembles schemaVersion', opened.schemaVersion === 8)

// ── 3. Chunk split (pure) ────────────────────────────────────────────
const split = splitDataIntoChunks(sampleData)
check('splitDataIntoChunks returns model chunk', !!split.model.nodes && !!split.model.walls)
check('splitDataIntoChunks returns projectSettings chunk',
      split.projectSettings?.projectSettings?.projectMeta?.projectTitle === 'Hello')
check('splitDataIntoChunks returns settings chunk with rates',
      split.settings?.ratesByKey?.flooring === 100)
check('splitDataIntoChunks: model does NOT contain projectSettings',
      !('projectSettings' in split.model))
check('splitDataIntoChunks: settings does NOT contain walls',
      !('walls' in split.settings))

// ── 4. PROJECT_CHUNKS contract ───────────────────────────────────────
check('PROJECT_CHUNKS frozen', Object.isFrozen(PROJECT_CHUNKS))
check('PROJECT_CHUNKS has model/projectSettings/settings',
      PROJECT_CHUNKS.includes('model') &&
      PROJECT_CHUNKS.includes('projectSettings') &&
      PROJECT_CHUNKS.includes('settings'))

// ── 5. Rename / delete ───────────────────────────────────────────────
const renameOk = await p.renameProject(rec2.id, 'Test B renamed')
check('renameProject returns true', renameOk === true)
const listAfter = await p.listProjects()
check('renameProject reflects new name',
      listAfter.find(x => x.id === rec2.id)?.name === 'Test B renamed')

const delOk = await p.deleteProject(rec2.id)
check('deleteProject returns true', delOk === true)
const list2 = await p.listProjects()
check('deleteProject removes from list', list2.length === 1)

// ── 6. Journal append + read-since ───────────────────────────────────
const op1 = { id: uid(), type: 'ADD_WALL', kind: 'user', payload: { wallId: 'w-new' }, timestamp: Date.now(), schemaVersion: 8 }
const op2 = { id: uid(), type: 'DELETE_WALL', kind: 'user', payload: { wallId: 'w-new' }, timestamp: Date.now() + 1, schemaVersion: 8 }
const entry1 = await p.appendJournalEntry(rec1.id, op1, null)
const entry2 = await p.appendJournalEntry(rec1.id, op2, null)
check('appendJournalEntry assigns opIndex 0', entry1.opIndex === 0)
check('appendJournalEntry assigns opIndex 1', entry2.opIndex === 1)
check('appendJournalEntry stores kind', entry1.kind === 'user')

const allJournal = await p.readJournalSince(rec1.id, -1)
check('readJournalSince(-1) returns all entries', allJournal.length === 2)
check('readJournalSince: ordered by opIndex ASC',
      allJournal[0].opIndex < allJournal[1].opIndex)
const sinceFirst = await p.readJournalSince(rec1.id, 0)
check('readJournalSince(0) returns only after-index-0 entries',
      sinceFirst.length === 1 && sinceFirst[0].opIndex === 1)

// ── 7. Snapshot write + getLatest ────────────────────────────────────
const snap1 = await p.writeSnapshot(rec1.id, 5, { state: 'mock-at-5' })
const snap2 = await p.writeSnapshot(rec1.id, 10, { state: 'mock-at-10' })
const latest = await p.getLatestSnapshot(rec1.id)
check('writeSnapshot returns the record', typeof snap1.id === 'string')
check('getLatestSnapshot returns highest-opIndex snapshot',
      latest.opIndex === 10 && latest.fullState.state === 'mock-at-10')

// ── 8. Catalog provenance store ──────────────────────────────────────
const manifest = {
  schemaRev: '2026-05-26-V1',
  paint:     'paint-v1',
  ceilingFinish: 'ceiling-v1',
  mep:       { fixtures: 'fixt-v1' },
}
await p.stampCatalogProvenance(manifest)
const got = await p.getLastCatalogProvenance()
check('stampCatalogProvenance: round-trips manifest',
      got?.paint === 'paint-v1' && got?.mep?.fixtures === 'fixt-v1')
check('catalog record has stampedAt', typeof got.stampedAt === 'number')

// ── 9. Memory-adapter introspection (mock-only) ──────────────────────
const dump = adapter._dump()
check('adapter._dump exposes projects store',
      dump[DB_STORES.PROJECTS] && Object.keys(dump[DB_STORES.PROJECTS]).length === 1)
check('adapter._dump exposes chunks store',
      dump[DB_STORES.CHUNKS] && Object.keys(dump[DB_STORES.CHUNKS]).length >= 3)

// ── 10. Phase 4 Tier-2 ADD 4 — generic binary asset storage ──────────
const {
  storeAsset, getAsset, deleteAsset, deleteProjectAssets,
  listProjectAssets, ASSET_TYPES, buildAssetKey,
} = await import('../src/projects/storage/assets.js')

// Stash a synthetic underlay blob.
const u8 = new Uint8Array([1, 2, 3, 4, 5])
const projectIdA = 'proj_assets_A'
const projectIdB = 'proj_assets_B'

const keyU1 = await storeAsset(adapter, projectIdA, ASSET_TYPES.UNDERLAY, u8, {
  mimeType: 'image/png',
  originalFileName: 'plan.png',
  naturalSize: { wPx: 800, hPx: 600 },
})
check('storeAsset returns composite key',
      typeof keyU1 === 'string' && keyU1.startsWith(`${projectIdA}::underlay::`))

const got1 = await getAsset(adapter, keyU1)
check('getAsset returns the stored record',
      got1 && got1.mimeType === 'image/png' && got1.naturalSize?.wPx === 800)
check('getAsset preserves blob',
      got1?.blob instanceof Uint8Array && got1.blob[2] === 3)
check('getAsset stamps createdAt',
      typeof got1.createdAt === 'number' && got1.createdAt > 0)

// Different asset types on the same project
const keyD1 = await storeAsset(adapter, projectIdA, ASSET_TYPES.DXF, u8, { mimeType: 'application/dxf' })
const keyU2 = await storeAsset(adapter, projectIdB, ASSET_TYPES.UNDERLAY, u8)

const allForA = await listProjectAssets(adapter, projectIdA)
check('listProjectAssets: project A has 2 entries',
      allForA.length === 2)
const underlaysForA = await listProjectAssets(adapter, projectIdA, ASSET_TYPES.UNDERLAY)
check('listProjectAssets: filter by assetType narrows result',
      underlaysForA.length === 1 && underlaysForA[0].key === keyU1)

// deleteAsset
const assetDelOk = await deleteAsset(adapter, keyD1)
check('deleteAsset returns true when record existed', assetDelOk === true)
const assetDelMiss = await deleteAsset(adapter, 'no-such-key')
check('deleteAsset returns false on missing key', assetDelMiss === false)
const afterDel = await listProjectAssets(adapter, projectIdA)
check('listProjectAssets reflects deletion',
      afterDel.length === 1 && afterDel[0].key === keyU1)

// deleteProjectAssets — prefix scan
const droppedA = await deleteProjectAssets(adapter, projectIdA)
check('deleteProjectAssets returns drop count', droppedA === 1)
const remainingA = await listProjectAssets(adapter, projectIdA)
check('deleteProjectAssets clears every asset for the project',
      remainingA.length === 0)
// Other project's blob is unaffected.
const remainingB = await listProjectAssets(adapter, projectIdB)
check('deleteProjectAssets is scoped to the named project',
      remainingB.length === 1 && remainingB[0].key === keyU2)

// buildAssetKey shape stability
check('buildAssetKey separator is ::',
      buildAssetKey('p', 'underlay', 'a') === 'p::underlay::a')

// Constants exposure
check('ASSET_TYPES includes the 5 expected kinds',
      ASSET_TYPES.UNDERLAY === 'underlay' &&
      ASSET_TYPES.DXF === 'dxf' &&
      ASSET_TYPES.IFC === 'ifc' &&
      ASSET_TYPES.PHOTO === 'photo' &&
      ASSET_TYPES.TEXTURE === 'texture')

// ── 11.5. Phase 4 Tier-2 (Phase B) — manager.js full autosave through IDB ──
const {
  _bootForTest, _resetForTest,
  listProjects, createProject, openProject, saveCurrent,
  renameProject, deleteProject, getCurrentProjectId, setCurrentProjectId,
  subscribe, flushPendingWrites,
} = await import('../src/projects/manager.js')

// Migration: legacyProjects + legacyCurrentId hydrate IDB through manager.
const mgrAdapter = makeMemoryAdapter()
const mgrPersistence = createPersistence(mgrAdapter)
await _bootForTest({
  persistence: mgrPersistence,
  legacyProjects: {
    'leg-1': {
      name: 'Legacy A', type: 'Residential',
      created: 1000, updated: 2000,
      data: { version: 7, walls: { w1: { id: 'w1' } }, projectSettings: null },
    },
    'leg-2': {
      name: 'Legacy B', type: 'Commercial',
      created: 500, updated: 1500,
      data: { version: 7, walls: {}, projectSettings: null },
    },
  },
  legacyCurrentId: 'leg-1',
})
const mgrList = listProjects()
check('manager: migration hydrated both legacy projects', mgrList.length === 2)
check('manager: list is sorted updated-DESC',
      mgrList[0].id === 'leg-1' && mgrList[1].id === 'leg-2')
check('manager: current id hydrated from legacy', getCurrentProjectId() === 'leg-1')

// Sync read stability: listProjects() returns the same ref between calls.
const ref1 = listProjects()
const ref2 = listProjects()
check('manager: listProjects ref is stable when nothing changed',
      ref1 === ref2)

// Sync subscribe: notifier fires on every mutation.
let notifyCount = 0
const unsub = subscribe(() => { notifyCount++ })

// createProject — sync return + cache update + ref bump.
const rec = createProject('Fresh', 'Residential')
check('manager: createProject returns record sync',
      rec && typeof rec.id === 'string' && rec.name === 'Fresh')
check('manager: listProjects sees the new project',
      listProjects().some(p => p.id === rec.id))
check('manager: createProject fired notify',
      notifyCount >= 1)
const refAfterCreate = listProjects()
check('manager: list ref changed after create', refAfterCreate !== ref1)

// openProject — current id flips + data is non-null.
const data = openProject(rec.id)
check('manager: openProject returns empty-shape data for fresh project',
      data && data.version === 7 && typeof data.walls === 'object')
check('manager: openProject updates currentId',
      getCurrentProjectId() === rec.id)

// saveCurrent — sync true + cache update.
const snap = {
  version: 7,
  nodes: { n1: { id: 'n1', x: 0, y: 0, floorIds: ['F1'] } },
  walls: { w1: { id: 'w1', n1: 'n1', n2: 'n2', materialKey: 'IS_MODULAR_BRICK',
                 height: 120, thickness: 9, floorId: 'F1', ifcGlobalId: 'g1',
                 openings: [] } },
  rooms: {}, stamps: {}, columns: {}, beams: {}, slabs: {}, staircases: {},
  foundations: {}, plumbingFixtures: {}, electricalPoints: {}, hvacUnits: {},
  fireDevices: {}, elvDevices: {}, solarEquipment: {}, risers: {},
  ratesByKey: {}, projectSettings: { foo: 'bar' },
}
const saveOk = saveCurrent(rec.id, snap)
check('manager: saveCurrent returns true sync', saveOk === true)

// Drain the write queue then re-read via the persistence layer directly
// (proves chunked storage worked).
await flushPendingWrites()
const reassembled = await mgrPersistence.openProject(rec.id)
check('manager: chunked IDB write reassembles correctly',
      reassembled?.walls?.w1?.id === 'w1')
check('manager: chunked IDB write preserves projectSettings',
      reassembled?.projectSettings?.foo === 'bar')

// rename
const mgrRenameOk = renameProject(rec.id, 'Renamed')
check('manager: renameProject returns true sync', mgrRenameOk === true)
check('manager: listProjects reflects rename',
      listProjects().find(p => p.id === rec.id)?.name === 'Renamed')

// delete
const mgrDelOk = deleteProject(rec.id)
check('manager: deleteProject returns true sync', mgrDelOk === true)
check('manager: list excludes deleted project',
      !listProjects().some(p => p.id === rec.id))
check('manager: currentId cleared when current is deleted',
      getCurrentProjectId() === null)

// setCurrentProjectId
setCurrentProjectId('leg-2')
check('manager: setCurrentProjectId updates cache',
      getCurrentProjectId() === 'leg-2')

unsub()

// ── 11.6. Migration shim — only runs once ─────────────────────────────
// Re-boot with same adapter and ensure migration doesn't double-write.
await flushPendingWrites()
const beforeCount = (await mgrPersistence.listProjects()).length
_resetForTest()
const mgr2 = createPersistence(mgrAdapter)
await _bootForTest({ persistence: mgr2 })  // no legacy block — boot from existing IDB
const afterCount = listProjects().length
check('manager: re-boot does not duplicate migrated projects',
      afterCount === beforeCount,
      `before=${beforeCount} after=${afterCount}`)

// ── 11.7. Autosave snapshot shape ─────────────────────────────────────
const { buildSnapshot } = await import('../src/projects/_snapshot.js')
const fakeStoreState = {
  nodes: { n1: { id: 'n1' } }, walls: {}, rooms: {}, stamps: {},
  columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {},
  plumbingFixtures: { f1: { id: 'f1' } },
  electricalPoints: {}, hvacUnits: {}, fireDevices: {}, elvDevices: {},
  solarEquipment: {}, risers: {},
  ratesByKey: { plasterWallsInternal: '12.50' },
  projectSettings: { foo: 'bar' },
}
const builtSnap = buildSnapshot(fakeStoreState)
check('autosave: buildSnapshot stamps version 7',
      builtSnap.version === 7)
check('autosave: buildSnapshot includes MEP collections',
      builtSnap.plumbingFixtures?.f1?.id === 'f1')
check('autosave: buildSnapshot includes rates + projectSettings',
      builtSnap.ratesByKey.plasterWallsInternal === '12.50' &&
      builtSnap.projectSettings.foo === 'bar')

_resetForTest()

// ── 12. Phase 4 Tier-2 ADD 5 — IDB schema version anchor ────────────
const {
  IDB_SCHEMA_VERSION, IDB_MIGRATIONS, DB_VERSION,
} = await import('../src/projects/storage/indexedDb.js')
check('IDB_SCHEMA_VERSION is at least 1', IDB_SCHEMA_VERSION >= 1)
check('IDB_MIGRATIONS is a frozen array',
      Array.isArray(IDB_MIGRATIONS) && Object.isFrozen(IDB_MIGRATIONS))
check('DB_VERSION bumped to 3 (assets + metadata + templates stores)',
      DB_VERSION === 3)

console.log(`\nPASSED: ${passed.length}`)
for (const p of passed) console.log(`   ${p}`)
if (failed.length > 0) {
  console.log(`\nFAILED:`)
  for (const f of failed) console.log(`   ${f}`)
  process.exit(1)
}
console.log('\n✓ verify-persistence passed.')
