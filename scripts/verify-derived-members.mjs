import fs from 'node:fs'
import { initCheckpointTest } from './checkpoint-test-setup.mjs'
// scripts/verify-derived-members.mjs
//
// Derived structural members (erp-saas D-280): the bands, inline footings, sunshades,
// lofts and tie bands the BBS engine builds from a wall, an opening or a column get a
// PERMANENT identity (state.derivedMembers) and reach the ERP as elements with their
// sizes and bars. Driven from the REAL store actions through the real sync engine,
// queue and dispatcher (fake ERP backend, nothing leaves the machine).
//
// Proves:
//   1. members appear with their parent links, labels and permanent ids; the worked
//      example (a 1.5 m lintel band, 230 × 150) goes to the ERP as a BEAM with that
//      section and span and its IS-2502 bars, naming its wall;
//   2. moving / resizing a window keeps its sunshade (one PATCH, no delete / re-add);
//   3. splitting the wall keeps the sunshade (its wall link moves to the piece) and
//      cuts each band into successors that name the band they came from; the old band
//      is retired (DELETE); an undo restores the original ids;
//   4. joining two walls combines their bands into a new member naming both;
//   5. deleting the window retires its sunshade; re-deriving an unchanged drawing,
//      saving and reopening it keep every id;
//   6. no double counting: a column carried by a drawn foundation has no inline
//      footing, and a wall whose band an explicit beam covers has no derived band of
//      that level — in the registry, the BBS and the sync alike;
//   7. lofts and tie bands are members too, and a parent and its members change in
//      ONE store commit.
//
// `ERP_DERIVED_FIXTURE=<path>` writes the request bodies captured here as JSON: the erp-saas spec
// `building-structure/dto/editor-derived-member-payloads.spec.ts` validates them against the real ERP DTOs and
// quantities.

import { useStore } from '../src/store.js'
import { makeMemoryAdapter } from '../src/projects/storage/indexedDb.js'
import { setAssetStorage } from '../src/projects/storage/getAssetStorage.js'
import { initLiveSync, teardownLiveSync, resolveErpId } from '../src/projects/liveSync.js'
import { initLiveSyncQueue, getSyncStatus } from '../src/projects/liveSyncQueue.js'
import { startSyncEngine, flushSyncEngine } from '../src/projects/syncEngine.js'
import { buildSnapshot } from '../src/projects/_snapshot.js'
import { reconcileDerivedMembers } from '../src/topology/derivedMembers.js'
import { computeRebarGroups } from '../src/bbs/index.js'
import { REINFORCEMENT_SPEC_PRESETS } from '../src/specs/reinforcementSpecs.js'

const s = useStore.getState
const FT = 12
const MM = 1 / 25.4
let pass = 0, fail = 0
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}
function header(t) { console.log(`\n${t}`) }
const tick = () => new Promise((r) => setTimeout(r, 0))

// ── Fake ERP backend: mints ids, answers each geometry route in its real shape ──
let calls = []
let seq = 0
const okRes = (data) => ({ ok: true, status: 200, text: async () => '', json: async () => ({ success: true, data }) })
globalThis.fetch = async (url, opts = {}) => {
  const method = opts.method ?? 'GET'
  const u = String(url).replace('http://erp.test/api/v1', '')
  const body = opts.body ? JSON.parse(opts.body) : null
  calls.push({ method, url: u, body })
  if (method === 'POST' && /\/split$/.test(u)) {
    return okRes({ walls: body.newWalls.map((w) => ({ id: `erp-${++seq}`, sourceEditorId: w.sourceEditorId, version: 0 })) })
  }
  if (method === 'POST' && /\/walls\/join$/.test(u)) {
    return okRes({ wall: { id: `erp-${++seq}`, sourceEditorId: body.merged.sourceEditorId, version: 0 } })
  }
  if (method === 'PATCH') return okRes({ id: u.split('/').pop(), version: 1 })
  return okRes({ id: `erp-${++seq}`, version: 0 })
}
const conn = { buildingId: 'bld-1', floorIds: { F1: '7f0c3f5e-0000-4000-8000-0000000000f1' }, erpUrl: 'http://erp.test', getToken: async () => 't' }

async function sync() {
  calls = []
  await flushSyncEngine(s())
  for (let i = 0; i < 400 && getSyncStatus().total > 0; i++) await tick()
  ok('the queue drained with nothing failed', getSyncStatus().total === 0 && getSyncStatus().failed === 0,
    `total=${getSyncStatus().total} failed=${getSyncStatus().failed}`)
  return calls.filter((c) => !c.url.startsWith('/building-structure/'))
}
const elementAdds = (cs) => cs.filter((c) => c.method === 'POST' && /\/geometry\/buildings\/[^/]+\/elements$/.test(c.url))
const elementPatches = (cs) => cs.filter((c) => c.method === 'PATCH' && /^\/geometry\/elements\//.test(c.url))
const elementDeletes = (cs) => cs.filter((c) => c.method === 'DELETE' && /^\/geometry\/elements\//.test(c.url))
// A PATCH names the element by its ERP id (the body is shape only).
const patchOf = (cs, ifcGlobalId) => elementPatches(cs).find((c) => c.url === `/geometry/elements/${resolveErpId(ifcGlobalId, conn)}`)
const members = () => Object.values(s().derivedMembers)
const memberOf = (pred) => members().find(pred)
const bandsOn = (wallId) => members().filter((m) => m.derivationKind === 'WALL_BEAM' && m.hostWallId === wallId)
const wallsAlong = (y) => Object.values(s().walls).filter((w) => s().nodes[w.n1].y === y && s().nodes[w.n2].y === y)

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
  // The company's bar specs for bands, sunshades and footings (BBS settings, D-275/D-278): every derived member
  // then carries IS-2502 bars as well as its sizes.
  const P = REINFORCEMENT_SPEC_PRESETS
  useStore.setState((st) => ({
    projectSettings: {
      ...st.projectSettings,
      reinforcementSpecs: { LINTEL_BAND_STD: P.LINTEL_BAND_STD, SUNSHADE_STD: P.SUNSHADE_STD, FOOTING_STD: P.FOOTING_STD },
      bbsDefaults: { ...st.projectSettings.bbsDefaults, BEAM: { ...st.projectSettings.bbsDefaults.BEAM, lintel: 'LINTEL_BAND_STD' }, SUNSHADE: 'SUNSHADE_STD', FOOTING: 'FOOTING_STD' },
    },
  }))
  // The worked example's lintel section: 230 × 150 mm.
  s().setBeamDimension('lintel', { widthIn: 230 * MM, depthIn: 150 * MM })
  startSyncEngine(useStore, { coordinated: true })

  // ── 1. Members, labels, the worked example ────────────────────────────────────
  header('1. A room, a window with a sunshade: its bands and the sunshade become members')
  const W = 1500 * MM
  const room = s().addRectangleRoom(0, 0, 20 * FT, W, { type: 'OTHER' })
  const longWall = room.wallIds.find((id) => wallsAlong(0).some((w) => w.id === id))
  const shortWall = room.wallIds.find((id) => {
    const w = s().walls[id]
    return s().nodes[w.n1].x === 0 && s().nodes[w.n2].x === 0
  })
  s().addOpening(longWall, { offset: 24, width: 48, height: 48, type: 'window', hasSunshade: true })
  const opening = s().walls[longWall].openings[0]
  ok('every external wall carries plinth / lintel / roof bands', room.wallIds.every((id) => bandsOn(id).length === 3), members().map((m) => m.derivationKind + ':' + m.level).join(' '))
  const sunshade = memberOf((m) => m.derivationKind === 'SUNSHADE')
  ok('the window\'s sunshade is a member, linked to the opening and its wall', sunshade?.hostOpeningId === opening.id && sunshade.hostWallId === longWall)
  ok('every member has a permanent id, an IFC id and a label number', members().every((m) => m.id && m.ifcGlobalId?.length === 22 && m.labelNo > 0))
  let cs = await sync()
  const lintel = bandsOn(shortWall).find((m) => m.level === 'lintel')
  const lintelAdd = elementAdds(cs).find((c) => c.body.sourceEditorId === lintel.ifcGlobalId)
  ok('worked example: the 1.5 m lintel band goes to the ERP as a BEAM, 230 × 150, span 1500 mm',
    lintelAdd?.body.kind === 'BEAM' && lintelAdd.body.sectionWidthMm === 230 && lintelAdd.body.sectionDepthMm === 150
      && lintelAdd.body.spanMm === 1500 && lintelAdd.body.structuralLevel === 'lintel', JSON.stringify(lintelAdd?.body && { ...lintelAdd.body, bars: lintelAdd.body.bars?.length }))
  ok('… with its IS-2502 bars, its name and its derivation (kind + host wall), no m³ or kg',
    lintelAdd?.body.bars?.length > 0 && /^Lintel band LB-\d{3}$/.test(lintelAdd.body.name)
      && lintelAdd.body.derivation?.kind === 'WALL_BEAM' && lintelAdd.body.derivation.hostWallIfcId === s().walls[shortWall].ifcGlobalId
      && !('concreteM3' in lintelAdd.body) && !('steelWeightKg' in lintelAdd.body), lintelAdd?.body.name)
  const ssAdd = elementAdds(cs).find((c) => c.body.sourceEditorId === sunshade.ifcGlobalId)
  ok('the sunshade goes as a SLAB: window width × projection × thickness, naming window and wall',
    ssAdd?.body.kind === 'SLAB' && ssAdd.body.sectionWidthMm === Math.round(48 * 25.4) && ssAdd.body.thicknessMm === Math.round(3 * 25.4)
      && ssAdd.body.derivation.hostOpeningIfcId === opening.ifcGlobalId && ssAdd.body.bars.length > 0, JSON.stringify(ssAdd?.body.derivation))
  ok('every member was created once', elementAdds(cs).length === members().length, `${elementAdds(cs).length}/${members().length}`)
  ok('the BBS groups of every member carry its permanent id', members().every((m) => m.level === 'plinth' || m.level === 'roof'
    || computeRebarGroups(s()).groups.some((g) => g.elementId === m.id)))

  // ── 2. Move / resize the window ───────────────────────────────────────────────
  header('2. Moving and resizing the window keeps its sunshade')
  s().updateOpening(longWall, opening.id, { offset: 40, width: 60 })
  ok('same sunshade id', memberOf((m) => m.derivationKind === 'SUNSHADE')?.id === sunshade.id)
  cs = await sync()
  const ssPatch = patchOf(cs, sunshade.ifcGlobalId)
  ok('one PATCH of the sunshade with its new width; nothing deleted or re-added',
    ssPatch?.body.sectionWidthMm === Math.round(60 * 25.4) && !('name' in ssPatch.body) && elementDeletes(cs).length === 0 && elementAdds(cs).length === 0,
    cs.map((c) => `${c.method} ${c.url}`).join(' | '))

  // ── 3. Split the wall ─────────────────────────────────────────────────────────
  header('3. Splitting the wall keeps the sunshade and cuts the bands into successors')
  const before = structuredClone(s().derivedMembers)
  const oldBands = bandsOn(longWall)
  const oldBandErpIds = oldBands.map((o) => resolveErpId(o.ifcGlobalId, conn))
  const split = s().splitWall(longWall, 14 * FT, 0)
  ok('the wall split', !split?.error, JSON.stringify(split))
  const pieces = wallsAlong(0).map((w) => w.id)
  const ssNow = memberOf((m) => m.derivationKind === 'SUNSHADE')
  ok('same sunshade id; its wall link moved to the piece the window is on',
    ssNow?.id === sunshade.id && pieces.includes(ssNow.hostWallId) && s().walls[ssNow.hostWallId].openings.some((o) => o.id === opening.id))
  const successors = pieces.flatMap((id) => bandsOn(id))
  ok('each piece has its own bands, NEW ids naming the band they were cut from',
    successors.length === 6 && successors.every((m) => !oldBands.some((o) => o.id === m.id)
      && m.predecessorIfcIds.length === 1 && oldBands.find((o) => o.level === m.level)?.ifcGlobalId === m.predecessorIfcIds[0]))
  ok('the cut bands are gone from the registry', oldBands.every((o) => !s().derivedMembers[o.id]))
  cs = await sync()
  ok('ONE split of the wall', cs.filter((c) => c.method === 'POST' && /\/split$/.test(c.url)).length === 1)
  ok('the cut bands are retired in the ERP (DELETE), the successors created with their predecessors',
    oldBandErpIds.every((id) => id && elementDeletes(cs).some((c) => c.url === `/geometry/elements/${id}`)) && elementAdds(cs).filter((c) => c.body.derivation?.predecessorIfcIds?.length === 1).length === 6)
  ok('the sunshade is PATCHed onto its new wall, not deleted',
    patchOf(cs, sunshade.ifcGlobalId)?.body.derivation.hostWallIfcId === s().walls[ssNow.hostWallId].ifcGlobalId
      && !elementDeletes(cs).some((c) => c.url.endsWith(sunshade.ifcGlobalId)))
  s().undo()
  ok('undo of the split restores every original member id', JSON.stringify(Object.keys(s().derivedMembers).sort()) === JSON.stringify(Object.keys(before).sort())
    && memberOf((m) => m.derivationKind === 'SUNSHADE').hostWallId === longWall)
  await sync()

  // ── 4. Join ───────────────────────────────────────────────────────────────────
  header('4. Joining two walls combines their bands into one member naming both')
  s().splitWall(longWall, 14 * FT, 0)
  await sync()
  const [p1, p2] = wallsAlong(0).map((w) => w.id)
  const parts = [...bandsOn(p1), ...bandsOn(p2)].filter((m) => m.level === 'lintel')
  const joined = s().joinWalls(p1, p2)
  ok('the walls joined', !joined?.error, JSON.stringify(joined))
  const combined = bandsOn(joined.survivorId).find((m) => m.level === 'lintel')
  ok('the combined lintel band is a new member naming both parts',
    combined && !parts.some((p) => p.id === combined.id)
      && JSON.stringify([...combined.predecessorIfcIds].sort()) === JSON.stringify(parts.map((p) => p.ifcGlobalId).sort()))
  await sync()

  // ── 5. Delete the window; re-derive; save and reopen ─────────────────────────
  header('5. Deleting the window retires its sunshade; ids survive re-derivation and reopen')
  const hostNow = memberOf((m) => m.derivationKind === 'SUNSHADE').hostWallId
  const sunshadeErpId = resolveErpId(sunshade.ifcGlobalId, conn)
  s().removeOpening(hostNow, opening.id)
  ok('the sunshade left the registry', !memberOf((m) => m.derivationKind === 'SUNSHADE'))
  cs = await sync()
  ok('… and is retired in the ERP (DELETE of its element, nothing else)', elementDeletes(cs).length === 1 && elementDeletes(cs)[0].url === `/geometry/elements/${sunshadeErpId}`)
  ok('re-deriving an unchanged drawing changes nothing (same registry object)', reconcileDerivedMembers(s().derivedMembers, s(), s()) === s().derivedMembers)
  const snap = buildSnapshot(s())
  const ids = Object.keys(s().derivedMembers).sort()
  s().loadProject(structuredClone(snap))
  ok('saving and reopening the drawing keeps every member id', JSON.stringify(Object.keys(s().derivedMembers).sort()) === JSON.stringify(ids))
  cs = await sync()

  // ── 6. No double counting ────────────────────────────────────────────────────
  header('6. No double counting: drawn foundations and explicit beams replace derived members')
  const ct = s().addColumnType({ label: 'C1' })
  const corner = s().walls[shortWall].n1
  s().addColumn(s().nodes[corner].x, s().nodes[corner].y, ct, corner)
  const columnId = Object.keys(s().columns)[0]
  const footing = memberOf((m) => m.derivationKind === 'INLINE_FOOTING')
  ok('a column with no foundation stands on an inline footing member', footing?.hostColumnId === columnId)
  cs = await sync()
  const fAdd = elementAdds(cs).find((c) => c.body.sourceEditorId === footing.ifcGlobalId)
  ok('… sent as a FOUNDATION pad naming its column', fAdd?.body.kind === 'FOUNDATION' && fAdd.body.sectionWidthMm === Math.round(4 * FT * 25.4)
    && fAdd.body.derivation.hostColumnIfcId === s().columns[columnId].ifcGlobalId && fAdd.body.bars.length > 0)
  const fdn = s().addFoundation('ISOLATED', { geometry: { lengthFt: 4, widthFt: 4, depthFt: 1 } })
  const fdnId = typeof fdn === 'string' ? fdn : Object.keys(s().foundations)[0]
  s().attachColumnToFoundation(columnId, fdnId)
  ok('once a drawn foundation carries the column, the inline footing is gone', !memberOf((m) => m.derivationKind === 'INLINE_FOOTING'))
  const groups = computeRebarGroups(s()).groups.filter((g) => g.elementType === 'FOOTING')
  ok('… and the BBS counts the footing once (the drawn one)', groups.length > 0 && groups.every((g) => g.elementId === fdnId))
  cs = await sync()
  ok('… and the ERP retires the inline footing', elementDeletes(cs).length === 1)

  const sw = s().walls[shortWall]
  const n1 = s().nodes[sw.n1], n2 = s().nodes[sw.n2]
  s().addBeamWithEndpoints({ type: 'POINT', x: n1.x, y: n1.y }, { type: 'POINT', x: n2.x, y: n2.y }, 'plinth')
  ok('an explicit plinth beam over the wall replaces the derived plinth band', !bandsOn(shortWall).some((m) => m.level === 'plinth')
    && bandsOn(shortWall).some((m) => m.level === 'lintel'))
  cs = await sync()
  ok('… the ERP gets the explicit beam and retires the derived band', elementDeletes(cs).length === 1
    && elementAdds(cs).some((c) => c.body.kind === 'BEAM' && !c.body.derivation))

  // ── 7. Lofts and tie bands; one commit ───────────────────────────────────────
  header('7. Lofts and tie bands are members; parent and members change in one commit')
  let commits = 0
  const unsub = useStore.subscribe((st, prev) => { if (st.walls !== prev.walls) { commits++; ok('… the members are already in step in that commit', st.derivedMembers !== prev.derivedMembers) } })
  s().setWallTieBeam(shortWall, true)
  unsub()
  ok('turning on a tie band is one commit', commits === 1)
  ok('the tie band is a member', !!memberOf((m) => m.derivationKind === 'TIE_BEAM' && m.hostWallId === shortWall))
  s().setWallLoft(shortWall, { enabled: true })
  ok('a loft with no size implies no member yet', !memberOf((m) => m.derivationKind === 'LOFT'))
  s().setWallLoft(shortWall, { widthFt: 4, depthFt: 2, heightFt: 7 })
  const loft = memberOf((m) => m.derivationKind === 'LOFT')
  ok('a sized loft is a member', loft?.hostWallId === shortWall)
  cs = await sync()
  const loftAdd = elementAdds(cs).find((c) => c.body.sourceEditorId === loft.ifcGlobalId)
  ok('a loft with no thickness sends its plan size and no thickness (the ERP quantifies no concrete)',
    loftAdd?.body.kind === 'SLAB' && loftAdd.body.sectionWidthMm === Math.round(4 * FT * 25.4) && !('thicknessMm' in loftAdd.body))
  s().setWallLoft(shortWall, { thicknessIn: 4 })
  ok('setting its thickness keeps the loft', memberOf((m) => m.derivationKind === 'LOFT')?.id === loft.id)
  cs = await sync()
  ok('… and PATCHes its thickness', patchOf(cs, loft.ifcGlobalId)?.body.thicknessMm === Math.round(4 * 25.4))

  if (process.env.ERP_DERIVED_FIXTURE) {
    const fixture = {
      producedBy: 'boq scripts/verify-derived-members.mjs (DERIVED_MEMBER_ENTRY.toErpPayload → liveSync.fireLiveOp request bodies)',
      lintelAdd: lintelAdd.body,
      sunshadeAdd: ssAdd.body,
      sunshadePatch: ssPatch.body,
      footingAdd: fAdd.body,
      loftAdd: loftAdd.body,
    }
    fs.writeFileSync(process.env.ERP_DERIVED_FIXTURE, JSON.stringify(fixture, null, 2) + '\n')
    console.log(`  (fixture written to ${process.env.ERP_DERIVED_FIXTURE})`)
  }

  teardownLiveSync()
  console.log(`\n${fail === 0 ? '✓ PASS' : '✗ FAIL'} — ${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
