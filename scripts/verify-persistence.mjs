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
  projectSettings: { projectMeta: { projectTitle: 'Hello' } },
}
const saved = await p.saveCurrent(rec1.id, sampleData)
check('saveCurrent returns true', saved === true)

const opened = await p.openProject(rec1.id)
check('openProject reassembles nodes', opened.nodes['n1']?.x === 0)
check('openProject reassembles walls', opened.walls['w1']?.id === 'w1')
check('openProject reassembles projectSettings',
      opened.projectSettings?.projectMeta?.projectTitle === 'Hello')
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

console.log(`\nPASSED: ${passed.length}`)
for (const p of passed) console.log(`   ${p}`)
if (failed.length > 0) {
  console.log(`\nFAILED:`)
  for (const f of failed) console.log(`   ${f}`)
  process.exit(1)
}
console.log('\n✓ verify-persistence passed.')
