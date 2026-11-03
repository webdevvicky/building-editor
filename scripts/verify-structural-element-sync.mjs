import { initCheckpointTest } from './checkpoint-test-setup.mjs'
// scripts/verify-structural-element-sync.mjs
//
// XR-02 / XR-03 / XR-09 (erp-saas D-271): a structural element reaches the ERP with every size and bar the ERP's BOQ
// needs, and its updates are never refused.
//
//   1. A 9″×18″ (229 × 457 mm) column, one floor, 4-T16 + T8 ties: the payload carries the REAL section (its type id
//      resolved here), the height, the grades and the bar list of the IS-2502 engine (computeRebarGroups) — every
//      bar complete, integer mm — and never a concrete or steel figure (the ERP works those out).
//   2. ADD and UPDATE send the same shape (the ERP create and patch DTOs accept the same fields): an MEP point's
//      `roomIfcId` rides the patch (XR-03), a slab's room ids are resolved to ERP ids on the patch (XR-09).
//   3. The change signature is taken on the whole state: resizing the column TYPE (the element object untouched) or
//      changing the reinforcement re-sends the column with its new section and bars; an unchanged re-flush sends
//      nothing; deleting the column retires it (DELETE).
//
// `ERP_ELEMENT_FIXTURE=<path>` writes the request bodies this harness captured as JSON: the erp-saas spec
// `building-structure/dto/editor-element-payloads.spec.ts` validates them against the real ERP DTOs and quantities.
//
// Pure Node: in-memory IDB + a fake-ERP fetch.

import fs from 'node:fs'
import { useStore } from '../src/store.js'
import { computeRebarGroups } from '../src/bbs/index.js'
import { getColumnHeightFt } from '../src/topology/columns.js'
import { ELEMENT_REGISTRY } from '../src/projects/elementRegistry.js'
import * as E from '../src/projects/syncEmitters.js'
import { makeMemoryAdapter } from '../src/projects/storage/indexedDb.js'
import { setAssetStorage } from '../src/projects/storage/getAssetStorage.js'
import { initLiveSync, teardownLiveSync, fireLiveOp, registerErpId } from '../src/projects/liveSync.js'
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

const calls = []
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ method: opts.method ?? 'GET', url: String(url), body: opts.body ? JSON.parse(opts.body) : null })
  return { ok: true, status: 200, text: async () => '', json: async () => ({ success: true, data: { id: 'erp-new' } }) }
}
const conn = { erpUrl: 'http://erp.test', buildingId: 'b-1', floorIds: { F1: '7f0c3f5e-0000-4000-8000-0000000000f1' }, getToken: async () => 'scoped-token' }
const ERP_COLUMN = '7f0c3f5e-0000-4000-8000-0000000000c1'
const ERP_ROOM = '7f0c3f5e-0000-4000-8000-0000000000a1'
const ERP_SLAB = '7f0c3f5e-0000-4000-8000-0000000000b1'
const ERP_POINT = '7f0c3f5e-0000-4000-8000-0000000000e1'

const s = useStore.getState
const COLUMN_SPEC = {
  id: 'COLUMN_T16', label: '4-T16 + T8', elementType: 'COLUMN',
  longitudinalBarCount: 4, longitudinalBarDiaMm: 16, stirrupBarDiaMm: 8, stirrupSpacingIn: 6, coverMm: 25,
}
const columnType = (depthIn) => ({ id: 'C1', label: 'C1', shape: 'rect', widthIn: 9, depthIn, footingLengthFt: 4, footingWidthFt: 4, footingDepthFt: 1.5 })

async function main() {
  s().loadProject({
    nodes: {}, walls: {}, rooms: {}, stamps: {}, columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {},
    projectSettings: undefined, unit: 'inch',
  })
  s().setDrawReference?.('centerline')
  s().setProjectSettings({ reinforcementSpecs: { COLUMN_T16: COLUMN_SPEC }, bbsDefaults: { COLUMN: 'COLUMN_T16' }, columnTypes: [columnType(18)] })
  const roomRes = s().addRectangleRoom(0, 0, 144, 120)
  const roomId = Object.keys(s().rooms)[0]
  const columnId = s().addColumn(0, 0, 'C1')
  const slabId = s().addSlab('MAIN', [roomId], 5)
  const pointId = s().addElectricalPoint('SOCKET_6A', 30, 30, null, null, roomId, 'SOCKET_6A')
  const st = s()
  const column = st.columns[columnId]

  console.log('\n1. The column payload: real sizes, grades and the IS-2502 bars')
  ok('the room was drawn', !roomRes?.error && !!roomId)
  const payload = ELEMENT_REGISTRY.COLUMN.toErpPayload(column, st)
  ok('section is the TYPE resolved to mm (9″ × 18″ → 229 × 457)', payload.sectionShape === 'RECT' && payload.sectionWidthMm === 229 && payload.sectionDepthMm === 457, JSON.stringify([payload.sectionShape, payload.sectionWidthMm, payload.sectionDepthMm]))
  ok('height is the column height in integer mm', payload.heightMm === Math.round(getColumnHeightFt(st, column) * 12 * 25.4), `${payload.heightMm}`)
  ok('grades: project concrete grade and the IS-2502 steel grade', payload.concreteGrade === 'M20' && payload.steelGrade === 'Fe500D')
  const groups = computeRebarGroups(st).groups.filter((g) => g.elementId === columnId)
  ok('bars are exactly the engine groups of this column', payload.bars.length === groups.length && groups.length >= 2, `${payload.bars.length}/${groups.length}`)
  const long = payload.bars.find((b) => b.role === 'LONGITUDINAL')
  const ties = payload.bars.find((b) => b.role === 'STIRRUP')
  ok('4 longitudinal bars of 16 mm', long?.count === 4 && long?.diaMm === 16)
  ok('ties of 8 mm', ties?.diaMm === 8 && ties?.count > 0)
  ok('every bar is complete, integer mm', payload.bars.every((b) => b.markId && b.role && b.shapeCode && Number.isInteger(b.diaMm) && Number.isInteger(b.cuttingLengthMm) && Number.isInteger(b.count) && b.totalLengthM > 0 && b.totalWeightKg > 0))
  const engineKg = groups.reduce((a, g) => a + g.totalWeightKg, 0)
  const sentKg = payload.bars.reduce((a, b) => a + b.totalWeightKg, 0)
  ok('the bars carry the engine steel (±1 g per bar)', Math.abs(engineKg - sentKg) <= 0.001 * groups.length, `${sentKg.toFixed(3)} kg`)
  ok('no concrete or steel figure is sent (the ERP works them out)', !('concreteM3' in payload) && !('steelWeightKg' in payload))

  console.log('\n2. ADD and UPDATE send the same shape; room references resolve')
  setAssetStorage(makeMemoryAdapter())
  await initCheckpointTest(conn, 'b-1')
  await initLiveSyncQueue('b-1')
  initLiveSync(conn)
  registerErpId(st.rooms[roomId].ifcGlobalId, ERP_ROOM)
  const add = E.elementAddOp(st, ELEMENT_REGISTRY.COLUMN, column)
  await fireLiveOp(add.opType, add.payload, conn)
  const addBody = calls.find((c) => c.method === 'POST' && c.url.endsWith('/geometry/buildings/b-1/elements'))?.body
  ok('ADD body = the registry payload + identity, kind and floor', addBody?.sourceEditorId === column.ifcGlobalId && addBody?.kind === 'COLUMN' && addBody?.floorId === conn.floorIds.F1 && JSON.stringify(addBody.bars) === JSON.stringify(payload.bars))
  registerErpId(column.ifcGlobalId, ERP_COLUMN)
  const upd = E.elementUpdateOp(st, ELEMENT_REGISTRY.COLUMN, column)
  await fireLiveOp(upd.opType, upd.payload, conn)
  const updBody = calls.find((c) => c.method === 'PATCH' && c.url.endsWith(`/geometry/elements/${ERP_COLUMN}`))?.body
  const addShape = { ...(addBody ?? {}) }
  delete addShape.sourceEditorId; delete addShape.kind; delete addShape.floorId
  ok('UPDATE body = the ADD body without identity, kind and floor', JSON.stringify(updBody) === JSON.stringify(addShape))

  registerErpId(st.slabs[slabId].ifcGlobalId, ERP_SLAB)
  const slabUpd = E.elementUpdateOp(st, ELEMENT_REGISTRY.SLAB, st.slabs[slabId])
  await fireLiveOp(slabUpd.opType, slabUpd.payload, conn)
  const slabBody = calls.find((c) => c.method === 'PATCH' && c.url.endsWith(`/geometry/elements/${ERP_SLAB}`))?.body
  ok('slab patch: room ids resolved to ERP ids (XR-09)', JSON.stringify(slabBody?.roomIds) === JSON.stringify([ERP_ROOM]))
  ok('slab patch: area and thickness', slabBody?.areaSqft > 0 && slabBody?.thicknessMm === 127, `${slabBody?.areaSqft} sqft`)

  registerErpId(st.electricalPoints[pointId].ifcGlobalId, ERP_POINT)
  const pointUpd = E.elementUpdateOp(st, ELEMENT_REGISTRY.MEP_ELECTRICAL, st.electricalPoints[pointId])
  await fireLiveOp(pointUpd.opType, pointUpd.payload, conn)
  const pointBody = calls.find((c) => c.method === 'PATCH' && c.url.endsWith(`/geometry/elements/${ERP_POINT}`))?.body
  ok('MEP point patch carries roomIfcId (XR-03) and its point type', pointBody?.roomIfcId === st.rooms[roomId].ifcGlobalId && pointBody?.pointType === 'SOCKET_6A')

  if (process.env.ERP_ELEMENT_FIXTURE) {
    const fixture = {
      producedBy: 'boq scripts/verify-structural-element-sync.mjs (elementRegistry.toErpPayload → liveSync.fireLiveOp request bodies)',
      columnAdd: addBody,
      columnPatch: updBody,
      slabPatch: slabBody,
      pointPatch: pointBody,
    }
    fs.writeFileSync(process.env.ERP_ELEMENT_FIXTURE, JSON.stringify(fixture, null, 2) + '\n')
    console.log(`  (fixture written to ${process.env.ERP_ELEMENT_FIXTURE})`)
  }

  console.log('\n3. Whole-state signature: a change elsewhere re-sends the element; delete retires it')
  const store = { getState: () => st, subscribe: () => () => {} }
  startSyncEngine(store, { coordinated: true })
  const before = calls.length
  const patches = () => calls.slice(before).filter((c) => c.method === 'PATCH' && c.url.endsWith(`/geometry/elements/${ERP_COLUMN}`))
  await flushSyncEngine(st)
  await sleep(40)
  ok('an unchanged state sends nothing', calls.length === before, `${calls.length - before} calls`)

  s().setProjectSettings({ columnTypes: [columnType(12)] }) // the TYPE changes; the column object does not
  ok('the column object itself is unchanged', s().columns[columnId] === column)
  await flushSyncEngine(s())
  await waitFor(() => patches().length >= 1)
  const resized = patches()[0]?.body
  ok('resizing the column type re-sends the column with its new section', resized?.sectionDepthMm === 305, `${resized?.sectionDepthMm}`)
  const resizedTie = resized?.bars?.find((b) => b.role === 'STIRRUP')
  ok('…and its new ties (shorter cutting length)', resizedTie && resizedTie.cuttingLengthMm < ties.cuttingLengthMm, `${resizedTie?.cuttingLengthMm} < ${ties.cuttingLengthMm}`)

  s().setProjectSettings({ reinforcementSpecs: { COLUMN_T16: { ...COLUMN_SPEC, longitudinalBarCount: 6 } } })
  await flushSyncEngine(s())
  await waitFor(() => patches().length >= 2)
  ok('changing the reinforcement re-sends the bars (6 longitudinal)', patches()[1]?.body?.bars?.find((b) => b.role === 'LONGITUDINAL')?.count === 6)

  const settled = calls.length
  await flushSyncEngine(s())
  await sleep(40)
  ok('a re-flush of the same state sends nothing', calls.length === settled)

  s().deleteColumn(columnId)
  await flushSyncEngine(s())
  await waitFor(() => calls.slice(settled).some((c) => c.method === 'DELETE'))
  ok('deleting the column retires it (DELETE /geometry/elements/:id)', calls.slice(settled).some((c) => c.method === 'DELETE' && c.url.endsWith(`/geometry/elements/${ERP_COLUMN}`)))

  stopSyncEngine()
  teardownLiveSync()
  teardownLiveSyncQueue()
  console.log(`\nverify-structural-element-sync: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })
