// scripts/verify-bbs-export.mjs
//
// BBS export builder verifier (BBS-5b). 2026-05-29.
// Drives the PURE buildBbsWorkbookModel() (no Date, no file I/O) on a
// multi-category fixture and asserts:
//   • one detail sheet per category, rows = group count (Level 1)
//   • TOTAL-sheet category kg = byBbsCategory reduce (Level 2)
//   • Level 2 == reduce(Level 1): detail-row weights sum to the abstract kg
//   • grand total = Σ all group weights; mark prefixes match the registry
//   • concrete + kg/m³ ratio present where derivable

import { useStore } from '../src/store.js'
import { verifyIntegrity } from '../src/schema/integrity.js'
import { computeRebarGroups } from '../src/bbs/index.js'
import { buildBbsWorkbookModel } from '../src/export/bbs.js'
import { getBarMarkPrefix } from '../src/bbs/types.js'

const s = useStore.getState
let pass = 0, fail = 0
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`   ✓ ${label}${detail ? ' — ' + detail : ''}`) }
  else      { fail++; console.log(`   ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}
function near(a, b, t = 0.3) { return Math.abs(a - b) <= t }
function header(t) { console.log('\n' + '─'.repeat(70)); console.log(t); console.log('─'.repeat(70)) }

// ── Multi-category fixture ────────────────────────────────────────────────
header('Fixture — column + footing + sunshade + loft + tie + staircase + strap')
s().loadProject({
  nodes: { n1: { id: 'n1', x: 0, y: 0, floorIds: ['F1'] }, n2: { id: 'n2', x: 240, y: 0, floorIds: ['F1'] } },
  walls: {
    w1: {
      id: 'w1', n1: 'n1', n2: 'n2', floorId: 'F1', thickness: 9, height: 120,
      materialKey: 'IS_MODULAR_BRICK', isPlot: false, isVirtual: false,
      hasTieBeam: true,
      loft: { enabled: true, widthFt: 8, depthFt: 2, heightFt: 7 },
      openings: [{ id: 'op1', type: 'window', width: 48, height: 48, offset: 24, orient: 0,
        hasSunshade: true, subtype: 'WINDOW', subtypeSource: 'HEURISTIC' }],
    },
  },
  rooms: {}, stamps: {}, columns: {}, beams: {}, slabs: {},
  staircases: { st1: { id: 'st1', type: 'DOG_LEGGED', flightCount: 2, stepsPerFlight: 9, treadIn: 10,
    riserIn: 6.5, waistSlabIn: 6, landingFtWidth: 4, landingFtLength: 4, flightWidthFt: 3.5, grade: 'M20',
    fromFloorId: 'F1', toFloorId: 'F1', floorId: 'F1' } },
  foundations: { f1: { id: 'f1', type: 'STRAP', columnIds: [], wallIds: [],
    geometry: { padA: { lengthFt: 4, widthFt: 4, depthFt: 1.5 }, padB: { lengthFt: 5, widthFt: 5, depthFt: 1.5 },
      strap: { widthIn: 9, depthIn: 18, lengthFt: 6 } },
    grade: 'M20', pccDepthFt: 0.16, plumDepthFt: 0, floorId: 'F1', label: 'EF1', reinforcementSpecId: 'STR' } },
  projectSettings: undefined, unit: 'inch',
})
s().setDrawReference?.('centerline')
s().setProjectSettings({
  reinforcementSpecs: {
    COLC1: { id: 'COLC1', label: 'C1', elementType: 'COLUMN', longitudinalBarCount: 6, longitudinalBarDiaMm: 12,
      stirrupBarDiaMm: 8, stirrupSpacingIn: 6, coverMm: 25, lapLengthMultiplier: 50 },
    TIE: { id: 'TIE', label: 'Tie', elementType: 'BEAM', topBars: { count: 2, diaMm: 12 },
      bottomBars: { count: 2, diaMm: 12 }, stirrupBarDiaMm: 8, stirrupSpacingIn: 8, coverMm: 30 },
    SS: { id: 'SS', label: 'SS', elementType: 'SUNSHADE', mainBarDiaMm: 8, mainBarSpacingIn: 6, distBarDiaMm: 8, distBarSpacingIn: 8, coverMm: 20 },
    LF: { id: 'LF', label: 'Loft', elementType: 'LOFT', mainBarDiaMm: 8, mainBarSpacingIn: 8, distBarDiaMm: 8, distBarSpacingIn: 8, coverMm: 20 },
    ST: { id: 'ST', label: 'Stair', elementType: 'STAIRCASE', waistMainBarDiaMm: 12, waistMainSpacingIn: 5, distBarDiaMm: 8, distBarSpacingIn: 6, coverMm: 20 },
    STR: { id: 'STR', label: 'Strap', elementType: 'STRAP', pad: { barDiaMm: 10, barSpacingIn: 5 },
      strap: { topBars: { count: 3, diaMm: 16 }, bottomBars: { count: 3, diaMm: 16 }, sideBars: { count: 2, diaMm: 12 }, stirrupBarDiaMm: 8, stirrupSpacingIn: 6 }, coverMm: 30, padCoverMm: 60 },
  },
  bbsDefaults: { COLUMN: 'COLC1', BEAM: { tie: 'TIE', plinth: null, lintel: null, roof: null },
    SUNSHADE: 'SS', LOFT: 'LF', STAIRCASE: 'ST', STRAP: 'STR' },
  columnTypes: [{ id: 'C1', label: 'C1', shape: 'rect', widthIn: 9, depthIn: 12, footingLengthFt: 4, footingWidthFt: 4, footingDepthFt: 1.5 }],
})
const cid = s().addColumn(0, 0)
s().setColumnType(cid, 'C1')

ok('baseline integrity valid', verifyIntegrity(s()).valid)

const model = buildBbsWorkbookModel(s())
const result = computeRebarGroups(s())

// ── Level 1 — detail sheets ────────────────────────────────────────────────
header('Level 1 — per-category detail sheets')
ok('detail sheets present', model.detailSheets.length >= 5, `got ${model.detailSheets.length}`)
const byCatGroups = {}
for (const g of result.groups) {
  const c = g.meta?.bbsCategory ?? 'OTHER'
  byCatGroups[c] = (byCatGroups[c] ?? 0) + 1
}
let rowsMatch = true
for (const sheet of model.detailSheets) {
  if (sheet.rows.length !== (byCatGroups[sheet.category] ?? 0)) rowsMatch = false
}
ok('each detail sheet rows === group count for that category', rowsMatch)
// Registry prefix governs auto-generated marks; entity grid-labels (C1 / EF1)
// legitimately override (reference convention). SUPER_COLUMN keeps the column
// type label; STRAP_FOOTING keeps the foundation grid label.
const LABEL_DRIVEN = new Set(['SUPER_COLUMN', 'STRAP_FOOTING'])
ok('every detail row mark uses registry prefix (or entity grid-label)', model.detailSheets.every(sh =>
  sh.rows.every(r => r.mark.startsWith(getBarMarkPrefix(sh.category)) || LABEL_DRIVEN.has(sh.category))))

// ── Level 2 — abstract = reduce(Level 1) ───────────────────────────────────
header('Level 2 — abstract reduces over Level 1')
let l2matchesL1 = true
for (const sheet of model.detailSheets) {
  const l1kg = sheet.rows.reduce((a, r) => a + r.weightKg, 0)
  const totalRow = model.totalSheet.rows.find(r => r.category === sheet.category)
  if (!totalRow || !near(l1kg, totalRow.totalKg, 0.5)) l2matchesL1 = false
}
ok('Σ detail-row kg per category ≈ abstract totalKg (Level2 = reduce(Level1))', l2matchesL1)

// abstract kg matches computeRebarGroups byBbsCategory
let absMatchesRollup = true
for (const r of model.totalSheet.rows) {
  const ent = result.totals.byBbsCategory[r.category]
  if (!ent || !near(r.totalKg, Math.round(ent.totalKg * 100) / 100, 0.2)) absMatchesRollup = false
}
ok('abstract totalKg == byBbsCategory rollup', absMatchesRollup)

const sumGroupsKg = result.groups.reduce((a, g) => a + g.totalWeightKg, 0)
ok('grandKg ≈ Σ all group weights', near(model.totalSheet.grandKg, Math.round(sumGroupsKg * 100) / 100, 0.5),
   `grand=${model.totalSheet.grandKg} sum=${sumGroupsKg.toFixed(2)}`)

// ── Concrete + ratio present ───────────────────────────────────────────────
header('Concrete m³ + kg/m³ ratio')
ok('at least 3 categories carry concrete m³', model.totalSheet.rows.filter(r => r.concreteM3 > 0).length >= 3,
   `got ${model.totalSheet.rows.filter(r => r.concreteM3 > 0).length}`)
ok('grand concrete m³ > 0', model.totalSheet.grandM3 > 0)
ok('a category reports a kg/m³ ratio', model.totalSheet.rows.some(r => r.kgPerM3 != null && r.kgPerM3 > 0))
ok('every category present in BBS_CATEGORY taxonomy (no OTHER leak)',
   !model.detailSheets.some(sh => sh.category === 'OTHER'))
ok('diaCols include 8/10/12/16/20/25', [8, 10, 12, 16, 20, 25].every(d => model.totalSheet.diaCols.includes(d)))

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(70))
console.log(`BBS export verification: ${pass} passed, ${fail} failed`)
console.log('═'.repeat(70))
if (fail > 0) process.exit(1)
else console.log('\n✓ verify-bbs-export passed.')
