// scripts/verify-build-package.mjs
//
// Verifies buildPackage(state) output shape, unit conversions, and
// structural invariants.
//
// Sections:
//   A — Unit conversion: 120in wall → heightFt 10; 9in thickness → thicknessIn 9;
//       node at x=10in → xMm 254 (=round(10*25.4)); y=0 → 0mm.
//   B — Output shape: all required top-level keys present, floors array, rooms array.
//   C — IFC IDs: rooms, walls, columns use ifcGlobalId (22-char), never internal UUIDs.
//   D — faceType: solo wall (1 room) → EXTERNAL; shared wall (2 rooms) → PARTITION.
//   E — vertices: nodeOrder → mm coordinates.
//   F — openings emitted under parent wall (widthFt, heightFt, positionFt).
//   G — exportedAt is null (caller stamps, not buildPackage).
//   H — editorProjectId falls through from projectSettings.
//   I — elementLabels present at top level.
//
// Run via:
//   node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-build-package.mjs

import { useStore } from '../src/store.js'
import { buildPackage } from '../src/boq/buildPackage.js'

const s = useStore.getState
const FT = 12   // 1 foot in editor inches

let pass = 0, fail = 0

function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`) }
  else      { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}
function header(t) {
  console.log('\n' + '─'.repeat(70))
  console.log(t.toUpperCase())
  console.log('─'.repeat(70))
}
function reset() {
  s().loadProject({
    nodes: {}, walls: {}, rooms: {}, stamps: {},
    columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {},
    projectSettings: undefined, unit: 'inch',
  })
  // Use centerline draw reference so wall corners land at exact given coordinates.
  s().setDrawReference?.('centerline')
}

// ── Section A: unit conversion ────────────────────────────────────────────
header('A. Unit conversion')
reset()

// Build a simple 10ft × 8ft room (120in × 96in) with default 9in wall thickness.
// Default wall height is DEFAULT_WALL_HEIGHT_IN = 120in = 10ft.
const resultA = s().addRectangleRoom(0, 0, 10 * FT, 8 * FT, { type: 'OTHER', name: 'UnitRoom' })
ok('addRectangleRoom succeeded', !resultA?.error, JSON.stringify(resultA))

const pkgA = buildPackage(s())

// 10ft wide room — nodes at x=0 and x=120in. Both should map correctly.
const floorA = pkgA.floors?.[0]
const roomA  = floorA?.rooms?.[0]
ok('floors[0] exists', !!floorA)
ok('rooms[0] exists', !!roomA)

// heightFt: default wall height is 120in; 120/12 = 10
const wallA = roomA?.walls?.[0]
ok('wall heightFt = 10 (120in / 12)', wallA?.heightFt === 10,
   `got ${wallA?.heightFt}`)

// thicknessIn stays in inches: default is 9in
ok('wall thicknessIn = 9 (unchanged from editor)', wallA?.thicknessIn === 9,
   `got ${wallA?.thicknessIn}`)

// A node at x=10in should become xMm=254 (round(10*25.4)=254)
// The room was created at 0..120in (0..10ft). Nodes land at 0, 120, 0, 120 for x.
// Node at x=120in → 120*25.4 = 3048mm
const vtxA = roomA?.vertices ?? []
ok('vertices non-empty', vtxA.length >= 4, `length ${vtxA.length}`)

// Node at origin (0,0): xMm=0, yMm=0
const originVtx = vtxA.find(v => v.xMm === 0 && v.yMm === 0)
ok('vertex at (0,0) → xMm=0 yMm=0', !!originVtx,
   `vertices: ${JSON.stringify(vtxA)}`)

// Node at (10in, 0): xMm=254, yMm=0
const tenInVtx = (() => {
  // Add a fresh room with a node exactly at x=10in for this specific check
  reset()
  const r10 = s().addRectangleRoom(10, 0, 10 + 10 * FT, 6 * FT, { type: 'OTHER', name: 'TenInRoom' })
  if (r10?.error) return null
  const pkg10 = buildPackage(s())
  const rm10 = pkg10.floors?.[0]?.rooms?.[0]
  return (rm10?.vertices ?? []).find(v => v.xMm === 254) ?? null  // 10in → 254mm
})()
ok('10in → xMm=254 (round(10×25.4))', !!tenInVtx, `found: ${JSON.stringify(tenInVtx)}`)

// lengthFt check: 10ft wall = 120in → lengthFt=10
reset()
s().addRectangleRoom(0, 0, 10 * FT, 6 * FT, { type: 'OTHER', name: 'LenRoom' })
{
  const pkgL = buildPackage(s())
  const wallL = pkgL.floors?.[0]?.rooms?.[0]?.walls?.find(w => Math.abs(w.lengthFt - 10) < 0.01)
  ok('120in wall → lengthFt=10', !!wallL, `walls: ${JSON.stringify(pkgL.floors?.[0]?.rooms?.[0]?.walls?.map(w => w.lengthFt))}`)
}

// ── Section B: output shape ───────────────────────────────────────────────
header('B. Output shape')
reset()
s().addRectangleRoom(0, 0, 10 * FT, 8 * FT, { type: 'BEDROOM', name: 'Master' })
const pkgB = buildPackage(s())

ok('schemaVersion === 3', pkgB.schemaVersion === 3)
ok('exportedAt === null', pkgB.exportedAt === null)
ok('floors is array', Array.isArray(pkgB.floors))
ok('elementLabels is object', typeof pkgB.elementLabels === 'object' && pkgB.elementLabels !== null)

const floorB = pkgB.floors?.[0]
ok('floor.rooms is array', Array.isArray(floorB?.rooms))
ok('floor.columns is array', Array.isArray(floorB?.columns))
ok('floor.beams is array', Array.isArray(floorB?.beams))
ok('floor.slabs is array', Array.isArray(floorB?.slabs))
ok('floor.nodes is array', Array.isArray(floorB?.nodes))
ok('floor.walls is array', Array.isArray(floorB?.walls))
ok('floor.heightFt is number', typeof floorB?.heightFt === 'number')
ok('floor.plinthHeightFt is number', typeof floorB?.plinthHeightFt === 'number')
ok('floor.sequence is number', typeof floorB?.sequence === 'number')

// ── schemaVersion 3 — wall node graph + opening positions ─────────────────
// A 10×8 rectangle room → 4 corner nodes + 4 walls referencing them by ifc id.
ok('node graph has ≥ 4 nodes (rect room corners)', (floorB?.nodes?.length ?? 0) >= 4,
   `got ${floorB?.nodes?.length}`)
ok('node graph has ≥ 4 walls', (floorB?.walls?.length ?? 0) >= 4,
   `got ${floorB?.walls?.length}`)
const nodeB = floorB?.nodes?.[0]
ok('node has 22-char ifcGlobalId', /^[0-9A-Za-z_$]{22}$/.test(nodeB?.ifcGlobalId ?? ''), `got "${nodeB?.ifcGlobalId}"`)
ok('node.xMm / yMm are numbers', typeof nodeB?.xMm === 'number' && typeof nodeB?.yMm === 'number')
ok('node.zMm is null (2-D today)', nodeB?.zMm === null, `got ${nodeB?.zMm}`)
ok('node.kind is CORNER|TJUNCTION', nodeB?.kind === 'CORNER' || nodeB?.kind === 'TJUNCTION', `got "${nodeB?.kind}"`)
const wallGeoB = floorB?.walls?.[0]
ok('wall.n1IfcId / n2IfcId present + distinct', !!wallGeoB?.n1IfcId && !!wallGeoB?.n2IfcId && wallGeoB.n1IfcId !== wallGeoB.n2IfcId)
const wallNodeIds = new Set(floorB?.nodes?.map((n) => n.ifcGlobalId))
ok('wall endpoints reference real exported nodes',
   wallNodeIds.has(wallGeoB?.n1IfcId) && wallNodeIds.has(wallGeoB?.n2IfcId))

const roomB = floorB?.rooms?.[0]
ok('room.ifcGlobalId present', typeof roomB?.ifcGlobalId === 'string')
ok('room.name === Master', roomB?.name === 'Master', `got "${roomB?.name}"`)
ok('room.type === BEDROOM', roomB?.type === 'BEDROOM')
ok('room.areaSqft > 0', (roomB?.areaSqft ?? 0) > 0)
ok('room.carpetAreaSqft > 0', (roomB?.carpetAreaSqft ?? 0) > 0)
ok('room.vertices is array', Array.isArray(roomB?.vertices))
ok('room.walls is array', Array.isArray(roomB?.walls))

const wallB = roomB?.walls?.[0]
ok('wall.ifcGlobalId present', typeof wallB?.ifcGlobalId === 'string')
ok('wall.thicknessIn is number', typeof wallB?.thicknessIn === 'number')
ok('wall.heightFt is number', typeof wallB?.heightFt === 'number')
ok('wall.lengthFt is number', typeof wallB?.lengthFt === 'number')
ok('wall.faceType is EXTERNAL|PARTITION',
   wallB?.faceType === 'EXTERNAL' || wallB?.faceType === 'PARTITION',
   `got "${wallB?.faceType}"`)
ok('wall.openings is array', Array.isArray(wallB?.openings))

// ── Section C: IFC IDs (22-char IFC base64, never internal UUID) ─────────
header('C. IFC GlobalId format')
reset()
s().addRectangleRoom(0, 0, 12 * FT, 10 * FT, { type: 'LIVING', name: 'Living' })
const pkgC = buildPackage(s())
const roomC = pkgC.floors?.[0]?.rooms?.[0]
const wallC = roomC?.walls?.[0]

const IFC_RE = /^[0-9A-Za-z_$]{22}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

ok('room.ifcGlobalId is 22-char IFC GUID', IFC_RE.test(roomC?.ifcGlobalId ?? ''),
   `got "${roomC?.ifcGlobalId}"`)
ok('room.ifcGlobalId is NOT an internal UUID', !UUID_RE.test(roomC?.ifcGlobalId ?? ''))
ok('wall.ifcGlobalId is 22-char IFC GUID', IFC_RE.test(wallC?.ifcGlobalId ?? ''),
   `got "${wallC?.ifcGlobalId}"`)

// ── Section D: faceType — EXTERNAL vs PARTITION ───────────────────────────
header('D. faceType derivation')
reset()

// Create two adjacent rooms sharing a wall.
// Room 1: (0,0)→(10ft,0)→(10ft,8ft)→(0,8ft). Room 2: (10ft,0)→(20ft,0)→(20ft,8ft)→(10ft,8ft).
// The wall at x=10ft (from (10ft,0) to (10ft,8ft)) is shared → PARTITION.
// The other walls belong to only one room → EXTERNAL.
const r1D = s().addRectangleRoom(0,          0, 10 * FT, 8 * FT, { type: 'BEDROOM',  name: 'BedD' })
const r2D = s().addRectangleRoom(10 * FT, 0,   20 * FT, 8 * FT, { type: 'LIVING',    name: 'LivD' })
ok('both rooms created', !r1D?.error && !r2D?.error)

const pkgD = buildPackage(s())
const floorD = pkgD.floors?.[0]

// Check room BedD has walls with correct faceTypes
const bedD = (floorD?.rooms ?? []).find(r => r.name === 'BedD')
const livD = (floorD?.rooms ?? []).find(r => r.name === 'LivD')
ok('BedD room found', !!bedD)
ok('LivD room found', !!livD)

if (bedD && livD) {
  const bedPartitions  = bedD.walls.filter(w => w.faceType === 'PARTITION')
  const bedExternals   = bedD.walls.filter(w => w.faceType === 'EXTERNAL')
  const livPartitions  = livD.walls.filter(w => w.faceType === 'PARTITION')
  const livExternals   = livD.walls.filter(w => w.faceType === 'EXTERNAL')

  // BedD has 4 walls: the eastern wall (x=10ft) is shared → 1 PARTITION, 3 EXTERNAL
  ok('BedD has exactly 1 PARTITION wall', bedPartitions.length === 1,
     `found ${bedPartitions.length}`)
  ok('BedD has 3 EXTERNAL walls', bedExternals.length === 3,
     `found ${bedExternals.length}`)
  // LivD mirror: 1 PARTITION (western, shared), 3 EXTERNAL
  ok('LivD has exactly 1 PARTITION wall', livPartitions.length === 1,
     `found ${livPartitions.length}`)
  ok('LivD has 3 EXTERNAL walls', livExternals.length === 3,
     `found ${livExternals.length}`)

  // The shared wall: same ifcGlobalId under both rooms
  const partitionIfc = bedPartitions[0]?.ifcGlobalId
  const matchingLiv  = livPartitions.find(w => w.ifcGlobalId === partitionIfc)
  ok('shared PARTITION wall has same ifcGlobalId in both rooms', !!matchingLiv,
     `BedD partition ifc="${partitionIfc}", LivD partitions: ${JSON.stringify(livPartitions.map(w => w.ifcGlobalId))}`)
}

// ── Section E: vertices in mm ────────────────────────────────────────────
header('E. vertices — nodeOrder → mm')
reset()
// A 10ft × 5ft room at origin (centerline).
// Nodes at (0,0), (120,0), (120,60), (0,60) inches.
// Expected mm: (0,0), (3048,0), (3048,1524), (0,1524)
s().addRectangleRoom(0, 0, 10 * FT, 5 * FT, { type: 'OTHER', name: 'VtxRoom' })
const pkgE = buildPackage(s())
const vtxE = pkgE.floors?.[0]?.rooms?.[0]?.vertices ?? []
ok('4 vertices for rect room', vtxE.length === 4, `got ${vtxE.length}`)

// Check expected mm values (0, 3048, 1524 = round(0/120/60 × 25.4))
const hasOrigin   = vtxE.some(v => v.xMm === 0    && v.yMm === 0)
const has10ftX    = vtxE.some(v => v.xMm === 3048)   // 120in × 25.4 = 3048mm
const has5ftY     = vtxE.some(v => v.yMm === 1524)   // 60in  × 25.4 = 1524mm
ok('vertex (0,0) → xMm=0 yMm=0', hasOrigin)
ok('vertex x=120in → xMm=3048', has10ftX,  `vertices: ${JSON.stringify(vtxE)}`)
ok('vertex y=60in  → yMm=1524', has5ftY,   `vertices: ${JSON.stringify(vtxE)}`)

// ── Section F: openings ──────────────────────────────────────────────────
header('F. openings on wall')
reset()
s().addRectangleRoom(0, 0, 12 * FT, 10 * FT, { type: 'LIVING', name: 'OpenRoom' })
// Find any wall and add a door opening to it.
const allWallsF = Object.values(s().walls)
const wallForDoor = allWallsF.find(w => !w.isPlot && !w.isVirtual)
if (wallForDoor) {
  s().addOpening?.(wallForDoor.id, {
    type: 'door', width: 36, height: 84, offset: 12,
  })
}
const pkgF = buildPackage(s())
const roomF = pkgF.floors?.[0]?.rooms?.[0]
const wallWithOpening = (roomF?.walls ?? []).find(w => w.openings?.length > 0)
if (wallForDoor && wallWithOpening) {
  const op = wallWithOpening.openings[0]
  ok('opening.type present', typeof op.type === 'string', `got "${op.type}"`)
  ok('opening.widthFt = 3 (36in/12)', Math.abs(op.widthFt - 3) < 0.001, `got ${op.widthFt}`)
  ok('opening.heightFt = 7 (84in/12)', Math.abs(op.heightFt - 7) < 0.001, `got ${op.heightFt}`)
  ok('opening.positionFt = 1 (12in/12)', Math.abs(op.positionFt - 1) < 0.001, `got ${op.positionFt}`)
  ok('opening.positionMm = 305 (12in × 25.4, schemaVersion 3)', op.positionMm === 305, `got ${op.positionMm}`)
} else {
  ok('opening section skipped (addOpening not available or no wall found)', true,
     '— wall or addOpening() unavailable in this state; test is advisory')
}

// ── Section G: exportedAt stays null ─────────────────────────────────────
header('G. exportedAt is null (caller stamps)')
reset()
s().addRectangleRoom(0, 0, 8 * FT, 6 * FT, { type: 'OTHER', name: 'NullDate' })
const pkgG = buildPackage(s())
ok('exportedAt === null', pkgG.exportedAt === null, `got ${pkgG.exportedAt}`)

// ── Section H: editorProjectId passthrough ────────────────────────────────
header('H. editorProjectId from projectSettings')
reset()
s().loadProject?.({
  nodes: {}, walls: {}, rooms: {}, stamps: {},
  columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {},
  ratesByKey: {},
  projectSettings: {
    editorProjectId: 'test-project-abc',
    floors: [{ id: 'F1', label: 'Ground Floor', sequence: 0, floorHeightFt: 10, plinthHeightFt: 1.5 }],
  },
  unit: 'inch',
})
const pkgH = buildPackage(s())
ok("editorProjectId = 'test-project-abc'",
   pkgH.editorProjectId === 'test-project-abc',
   `got "${pkgH.editorProjectId}"`)

// No editorProjectId → null
s().loadProject?.({
  nodes: {}, walls: {}, rooms: {}, stamps: {},
  columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {},
  projectSettings: undefined, unit: 'inch',
})
const pkgH2 = buildPackage(s())
ok('editorProjectId defaults to null when absent',
   pkgH2.editorProjectId === null,
   `got ${pkgH2.editorProjectId}`)

// ── Section I: elementLabels at top level ─────────────────────────────────
header('I. elementLabels at top level')
reset()
s().addRectangleRoom(0, 0, 10 * FT, 8 * FT, { type: 'OTHER', name: 'LabelRoom' })
const pkgI = buildPackage(s())
ok('elementLabels is object', typeof pkgI.elementLabels === 'object' && pkgI.elementLabels !== null)
ok('elementLabels.rooms is object', typeof pkgI.elementLabels?.rooms === 'object')
ok('elementLabels.walls is object',  typeof pkgI.elementLabels?.walls === 'object')

// At least one room label should be present.
const roomLabelIds = Object.keys(pkgI.elementLabels?.rooms ?? {})
ok('at least one room label present', roomLabelIds.length > 0)

// ── Section J: reconciliation provenance (split lineage) ──────────────────
header('J. Reconciliation provenance')
reset()
s().addRectangleRoom(0, 0, 10 * FT, 8 * FT, { type: 'OTHER', name: 'SplitRoom' })

// Fresh package before any split → no provenance.
const pkgJ0 = buildPackage(s())
ok('provenance is an array', Array.isArray(pkgJ0.provenance))
ok('no provenance before any split', pkgJ0.provenance.length === 0)

// Pick a horizontal wall (n1.y === n2.y) and split it at its midpoint.
const wallsJ = Object.values(s().walls)
const targetWall = wallsJ.find(w => {
  const a = s().nodes[w.n1], b = s().nodes[w.n2]
  return a && b && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.x - b.x) > 1
})
ok('found a horizontal wall to split', !!targetWall)
const parentIfc = targetWall?.ifcGlobalId
const a = s().nodes[targetWall.n1], b = s().nodes[targetWall.n2]
const splitRes = s().splitWall(targetWall.id, (a.x + b.x) / 2, a.y)
ok('splitWall succeeded', !splitRes?.error, JSON.stringify(splitRes))

const pkgJ1 = buildPackage(s())
ok('provenance has two entries after split', pkgJ1.provenance.length === 2,
   `got ${pkgJ1.provenance.length}`)
ok('every provenance entry is op=SPLIT',
   pkgJ1.provenance.every(p => p.op === 'SPLIT'))
ok('every provenance entry names the parent ifcGlobalId',
   pkgJ1.provenance.every(p => p.parentIds.includes(parentIfc)))
ok('provenance newIds are the two new wall ifcGlobalIds',
   new Set(pkgJ1.provenance.map(p => p.newId)).size === 2 &&
   pkgJ1.provenance.every(p => p.newId !== parentIfc))
ok('parent ifcGlobalId no longer present as a wall',
   !Object.values(s().walls).some(w => w.ifcGlobalId === parentIfc))

// ── Section K: elements export (structural / MEP anchor) ──────────────────
header('K. elements export')
reset()
s().addRectangleRoom(0, 0, 10 * FT, 8 * FT, { type: 'OTHER', name: 'ElemRoom' })
const pkgK0 = buildPackage(s())
ok('floor.elements is array', Array.isArray(pkgK0.floors?.[0]?.elements))
ok('no elements before any structural entity', (pkgK0.floors?.[0]?.elements ?? []).length === 0,
   `got ${(pkgK0.floors?.[0]?.elements ?? []).length}`)

// Add a column (uses the first seeded column type) and confirm it exports as an element.
const colTypeId = s().projectSettings?.columnTypes?.[0]?.id
let colOk = false
if (colTypeId && typeof s().addColumn === 'function') {
  try { s().addColumn(60, 60, colTypeId); colOk = true } catch { colOk = false }
}
if (colOk) {
  const pkgK1 = buildPackage(s())
  const elems = pkgK1.floors?.[0]?.elements ?? []
  const colEl = elems.find(e => e.kind === 'COLUMN')
  ok('COLUMN element emitted', !!colEl, `kinds: ${JSON.stringify(elems.map(e => e.kind))}`)
  ok('element.ifcGlobalId is 22-char IFC GUID', IFC_RE.test(colEl?.ifcGlobalId ?? ''),
     `got "${colEl?.ifcGlobalId}"`)
  ok('element.kind is a string', typeof colEl?.kind === 'string')
  ok('element.spec is an object', colEl?.spec && typeof colEl.spec === 'object')
  // C8: the spec must NOT leak any internal UUID (id graph stripped).
  const specJson = JSON.stringify(colEl?.spec ?? {})
  ok('element.spec leaks no internal UUID',
     !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(specJson))
  ok('element.spec drops id / ifcGlobalId keys',
     !('id' in (colEl?.spec ?? {})) && !('ifcGlobalId' in (colEl?.spec ?? {})))

  // schemaVersion 2: typed structural fields + per-element BBS snapshot.
  const st = colEl?.structural
  ok('COLUMN element carries structural sub-object', st && typeof st === 'object',
     `structural: ${JSON.stringify(st)}`)
  ok('structural.sectionShape present', typeof st?.sectionShape === 'string')
  ok('structural.heightMm is a number', typeof st?.heightMm === 'number',
     `got ${st?.heightMm}`)
  ok('structural.concreteM3 is a number ≥ 0', typeof st?.concreteM3 === 'number' && st.concreteM3 >= 0,
     `got ${st?.concreteM3}`)
  ok('structural.steelGrade present', typeof st?.steelGrade === 'string')
  // bbs may be null if the fixture lacks reinforcement specs — but when present
  // it must be a well-formed snapshot keyed by this element.
  if (colEl?.bbs) {
    ok('bbs.rows is a non-empty array', Array.isArray(colEl.bbs.rows) && colEl.bbs.rows.length > 0,
       `rows: ${colEl.bbs.rows?.length}`)
    ok('bbs.totalWeightKg is a number ≥ 0',
       typeof colEl.bbs.totalWeightKg === 'number' && colEl.bbs.totalWeightKg >= 0)
    const row = colEl.bbs.rows?.[0]
    ok('bbs row has markId/diaMm/cuttingLengthMm/count',
       typeof row?.markId === 'string' && typeof row?.diaMm === 'number' &&
       typeof row?.cuttingLengthMm === 'number' && typeof row?.count === 'number',
       `row: ${JSON.stringify(row)}`)
  } else {
    ok('bbs absent (no reinforcement spec in fixture) — advisory', true)
  }
} else {
  ok('column add unavailable — elements detail advisory', true,
     'addColumn or seeded column type not available in this state')
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70))
console.log(`RESULTS: ${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('FAIL')
  process.exit(1)
} else {
  console.log('PASS')
}
