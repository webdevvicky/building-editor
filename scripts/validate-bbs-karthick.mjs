// scripts/validate-bbs-karthick.mjs  — READ-ONLY reference validation.
//
// 2026-05-29. Runs OUR BBS engine against fixtures reconstructed from the
// Karthick M-City + Selvakumar reference workbooks and prints a diff. Does NOT
// modify the engine — reports what the engine produces today.
//
// PART 1 — per-bar cutting length (engine vs workbook detail sheet).
// PART 2 — per-category kg + concrete (engine on reconstructed inventory vs TOTAL).
//
// Rerun: node --experimental-loader ./scripts/resolver-hook.mjs scripts/validate-bbs-karthick.mjs

import { useStore } from '../src/store.js'
import { computeRebarGroups } from '../src/bbs/index.js'
import { buildBbsWorkbookModel } from '../src/export/bbs.js'

const s = useStore.getState
const MM_PER_FT = 304.8
const ft = mm => mm / MM_PER_FT
const pct = (a, b) => (b === 0 ? (a === 0 ? 0 : Infinity) : ((a - b) / b) * 100)
function resetWith(project) {
  s().loadProject({
    nodes: {}, walls: {}, rooms: {}, stamps: {},
    columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {},
    projectSettings: undefined, unit: 'inch', ...project,
  })
  s().setDrawReference?.('centerline')
}
const WALL = (xft) => ({ nodes: { n1: { id: 'n1', x: 0, y: 0, floorIds: ['F1'] }, n2: { id: 'n2', x: xft * 12, y: 0, floorIds: ['F1'] } } })

console.log('\n' + '='.repeat(80))
console.log('PART 1 — PER-BAR CUTTING LENGTH (engine vs reference detail sheets)')
console.log('='.repeat(80))
const rows = []

// Bar 1 — Footing mesh F1 (Ø10): workbook cut 4.106 ft (a3.606 + 0.25 + 0.25)
{
  resetWith({})
  s().setProjectSettings({
    reinforcementSpecs: { F: { id: 'F', label: 'F', elementType: 'FOOTING', xBars: { count: 10, diaMm: 10 }, yBars: { count: 10, diaMm: 10 }, developmentLengthMultiplier: 50, coverMm: 60 } },
    bbsDefaults: { FOOTING: 'F' },
  })
  const padFt = 3.606 + 2 * (60 / MM_PER_FT)
  s().addFoundation('ISOLATED', { columnIds: [], geometry: { lengthFt: padFt, widthFt: padFt }, floorId: 'F1', label: 'F1' })
  const g = computeRebarGroups(s()).groups.find(x => x.role === 'X_MESH')
  rows.push(['Footing mesh F1 Ø10', 4.106, ft(g.cuttingLengthMm), 'c/b', 'engine adds 2×Ld(56.6d=3.71ft); workbook 2×0.25ft hooks → footing bar over-counted'])
}
// Bar 2 — Column main C2 Ø12: workbook cut 12.968 (a11 + lap1.968=50d)
{
  resetWith({})
  s().setProjectSettings({
    heights: { plinthHeightFt: 0, floorHeightFt: 11 },
    floors: [{ id: 'F1', label: 'GF', sequence: 0, plinthHeightFt: 0, floorHeightFt: 11, meta: null }],
    slabSettings: { mainThicknessIn: 0, sunkenDepthIn: 0, autoSunkenRoomTypes: [] },
    reinforcementSpecs: { C: { id: 'C', label: 'C2', elementType: 'COLUMN', longitudinalBarCount: 8, longitudinalBarDiaMm: 12, stirrupBarDiaMm: 8, stirrupSpacingIn: 7, coverMm: 40, lapLengthMultiplier: 50 } },
    bbsDefaults: { COLUMN: 'C' },
    columnTypes: [{ id: 'C2', label: 'C2', shape: 'rect', widthIn: 9, depthIn: 15, footingLengthFt: 4, footingWidthFt: 4, footingDepthFt: 1.5 }],
  })
  const cid = s().addColumn(0, 0); s().setColumnType(cid, 'C2')
  const g = computeRebarGroups(s()).groups.find(x => x.role === 'LONGITUDINAL')
  rows.push(['Column main C2 Ø12', 12.968, ft(g.cuttingLengthMm), 'b', 'engine lap 56.6d(2.23ft) vs workbook 50d(1.968ft)'])
}
// Bars 3 + 4 — Roof beam top + stirrup (Ø16 / Ø8): workbook 33.054 / 3.813
{
  resetWith({ ...WALL(31.554), walls: { w1: { id: 'w1', n1: 'n1', n2: 'n2', floorId: 'F1', thickness: 9, height: 120, materialKey: 'IS_MODULAR_BRICK', isPlot: false, isVirtual: false, openings: [], hasRoofBeam: true } } })
  s().setProjectSettings({
    beamDimensions: { tie: { widthIn: 9, depthIn: 15 }, plinth: { widthIn: 9, depthIn: 4 }, lintel: { widthIn: 9, depthIn: 6 }, roof: { widthIn: 9, depthIn: 15 } },
    reinforcementSpecs: { RB: { id: 'RB', label: 'RB', elementType: 'BEAM', topBars: { count: 2, diaMm: 16 }, bottomBars: { count: 2, diaMm: 16 }, stirrupBarDiaMm: 8, stirrupSpacingIn: 8, coverMm: 30 } },
    bbsDefaults: { BEAM: { tie: null, plinth: null, lintel: null, roof: 'RB' } },
  })
  const G = computeRebarGroups(s()).groups
  const T = G.find(x => x.role === 'TOP'); const St = G.find(x => x.role === 'STIRRUP')
  rows.push(['Roof beam top B8 Ø16', 33.054, T ? ft(T.cuttingLengthMm) : 0, 'b', 'engine Ld(16) anchorage/end (interior=Ld/2) vs workbook flat 0.75ft bends'])
  rows.push(['Roof beam stirrup Ø8 9×15', 3.813, St ? ft(St.cuttingLengthMm) : 0, 'b', 'engine 2(w+d)+2×9d−4×2d IS2502 vs workbook flat 0.26248ft hook'])
}
// Bar 5 — Sunshade main Ø8: workbook 4.551 (a4.384 width + b0.167)
{
  resetWith({ walls: { w1: { id: 'w1', n1: 'n1', n2: 'n2', floorId: 'F1', thickness: 9, height: 120, materialKey: 'IS_MODULAR_BRICK', isPlot: false, isVirtual: false, openings: [{ id: 'op1', type: 'window', width: 4.384 * 12, height: 48, offset: 24, orient: 0, hasSunshade: true, subtype: 'WINDOW', subtypeSource: 'HEURISTIC' }] } }, nodes: { n1: { id: 'n1', x: 0, y: 0, floorIds: ['F1'] }, n2: { id: 'n2', x: 240, y: 0, floorIds: ['F1'] } } })
  s().setProjectSettings({
    sunshadeSettings: { enabled: true, projectionFt: 1.5, thicknessIn: 3 },
    reinforcementSpecs: { SS: { id: 'SS', label: 'SS', elementType: 'SUNSHADE', mainBarDiaMm: 8, mainBarSpacingIn: 6, distBarDiaMm: 8, distBarSpacingIn: 8, coverMm: 20 } },
    bbsDefaults: { SUNSHADE: 'SS' },
  })
  const g = computeRebarGroups(s()).groups.find(x => x.role === 'MAIN')
  rows.push(['Sunshade main Ø8', 4.551, g ? ft(g.cuttingLengthMm) : 0, 'e', 'different bar model: engine MAIN = cantilever along projection; workbook MAIN runs window width'])
}

console.log('\n ' + 'bar'.padEnd(26) + 'wb(ft)'.padStart(8) + 'eng(ft)'.padStart(9) + 'Δ%'.padStart(7) + ' cls  reason')
console.log('-'.repeat(80))
for (const [n, wb, e, cls, why] of rows) {
  console.log(' ' + n.padEnd(26) + wb.toFixed(3).padStart(8) + e.toFixed(3).padStart(9) + (pct(e, wb).toFixed(0) + '%').padStart(7) + '  ' + cls.padEnd(4) + ' ' + why)
}

// ── PART 2 — per-category kg + concrete ─────────────────────────────────────
console.log('\n' + '='.repeat(80))
console.log('PART 2 — PER-CATEGORY (engine on reconstructed inventory vs Karthick TOTAL)')
console.log('='.repeat(80))
const TOTAL = { FOOTING: 833.809, SUB_COLUMN: 863.939, TIE_BEAM: 1038.172, PLINTH_BEAM: null, SUPER_COLUMN: 716.991, LINTEL_BEAM: 373.877, SUNSHADE: 56.88, LOFT: 142.2, STAIRCASE: 0, ROOF_BEAM: 2008.717, ROOF_SLAB: 2531.778 }
const TOTAL_M3 = { FOOTING: 8.615, SUB_COLUMN: 2.294, PLINTH_BEAM: 5.335, SUPER_COLUMN: 5.150, LINTEL_BEAM: 3.531, SUNSHADE: 0.601, LOFT: 0.790, ROOF_BEAM: 8.215, ROOF_SLAB: 23.112 }

resetWith({
  nodes: { n1: { id: 'n1', x: 0, y: 0, floorIds: ['F1'] }, n2: { id: 'n2', x: 300 * 12, y: 0, floorIds: ['F1'] } },
  walls: { w1: { id: 'w1', n1: 'n1', n2: 'n2', floorId: 'F1', thickness: 9, height: 120, materialKey: 'IS_MODULAR_BRICK', isPlot: false, isVirtual: false, hasTieBeam: true, hasLintelBeam: true, hasRoofBeam: true,
    loft: { enabled: true, widthFt: 16, depthFt: 4.3 },
    openings: [{ id: 'op1', type: 'window', width: 52, height: 48, offset: 24, orient: 0, hasSunshade: true, subtype: 'WINDOW', subtypeSource: 'HEURISTIC' }] } },
})
s().setProjectSettings({
  is2502Params: { subSuperColumnSplitEnabled: true },
  heights: { plinthHeightFt: 5, floorHeightFt: 11 },
  floors: [{ id: 'F1', label: 'GF', sequence: 0, plinthHeightFt: 5, floorHeightFt: 11, meta: null }],
  beamDimensions: { tie: { widthIn: 9, depthIn: 15 }, plinth: { widthIn: 9, depthIn: 4 }, lintel: { widthIn: 9, depthIn: 6 }, roof: { widthIn: 9, depthIn: 15 } },
  sunshadeSettings: { enabled: true, projectionFt: 1.5, thicknessIn: 3 },
  reinforcementSpecs: {
    F: { id: 'F', label: 'F', elementType: 'FOOTING', xBars: { count: 10, diaMm: 10 }, yBars: { count: 10, diaMm: 10 }, developmentLengthMultiplier: 50, coverMm: 60 },
    COL: { id: 'COL', label: 'C', elementType: 'COLUMN', longitudinalBarCount: 8, longitudinalBarDiaMm: 12, stirrupBarDiaMm: 8, stirrupSpacingIn: 7, coverMm: 40, lapLengthMultiplier: 50 },
    TIE: { id: 'TIE', label: 'Tie', elementType: 'BEAM', topBars: { count: 2, diaMm: 12 }, bottomBars: { count: 2, diaMm: 12 }, stirrupBarDiaMm: 8, stirrupSpacingIn: 8, coverMm: 30 },
    LIN: { id: 'LIN', label: 'Lin', elementType: 'BEAM', topBars: { count: 2, diaMm: 8 }, bottomBars: { count: 2, diaMm: 8 }, stirrupBarDiaMm: 8, stirrupSpacingIn: 6, coverMm: 30 },
    RB: { id: 'RB', label: 'RB', elementType: 'BEAM', topBars: { count: 2, diaMm: 16 }, bottomBars: { count: 2, diaMm: 16 }, stirrupBarDiaMm: 8, stirrupSpacingIn: 8, coverMm: 30 },
    SS: { id: 'SS', label: 'SS', elementType: 'SUNSHADE', mainBarDiaMm: 8, mainBarSpacingIn: 6, distBarDiaMm: 8, distBarSpacingIn: 8, coverMm: 20 },
    LF: { id: 'LF', label: 'Loft', elementType: 'LOFT', mainBarDiaMm: 8, mainBarSpacingIn: 8, distBarDiaMm: 8, distBarSpacingIn: 8, coverMm: 20 },
  },
  bbsDefaults: { FOOTING: 'F', COLUMN: 'COL', BEAM: { tie: 'TIE', plinth: null, lintel: 'LIN', roof: 'RB' }, SUNSHADE: 'SS', LOFT: 'LF' },
  columnTypes: [{ id: 'C', label: 'C', shape: 'rect', widthIn: 9, depthIn: 15, footingLengthFt: 4, footingWidthFt: 4, footingDepthFt: 1.5 }],
})
const footings = [3.6, 4.1, 4.9, 5.6, 4.1, 6.6, 4.9, 4.9, 5.6, 3.6, 8.6]
for (let i = 0; i < footings.length; i++) s().addFoundation('ISOLATED', { columnIds: [], geometry: { lengthFt: footings[i], widthFt: footings[i] }, floorId: 'F1', label: `F${i + 1}` })
for (let i = 0; i < 13; i++) { const c = s().addColumn(i * 12, 0); s().setColumnType(c, 'C') }

const model = buildBbsWorkbookModel(s())
const eng = computeRebarGroups(s()).totals.byBbsCategory
const engM3 = {}; for (const r of model.totalSheet.rows) engM3[r.category] = r.concreteM3

console.log('\n ' + 'category'.padEnd(15) + 'eng kg'.padStart(10) + 'TOTAL kg'.padStart(11) + 'Δ%'.padStart(9) + 'eng m³'.padStart(9) + 'TOT m³'.padStart(8))
console.log('-'.repeat(80))
const CATS = ['FOOTING', 'SUB_COLUMN', 'SUPER_COLUMN', 'TIE_BEAM', 'PLINTH_BEAM', 'LINTEL_BEAM', 'SUNSHADE', 'LOFT', 'STAIRCASE', 'ROOF_BEAM', 'ROOF_SLAB']
for (const cat of CATS) {
  const e = eng[cat]?.totalKg ?? 0
  const t = TOTAL[cat]
  const d = t == null ? '#REF!' : (pct(e, t).toFixed(0) + '%')
  console.log(' ' + cat.padEnd(15) + e.toFixed(0).padStart(10) + (t == null ? '#REF!' : t.toFixed(0)).padStart(11) + d.padStart(9) + (engM3[cat] ?? 0).toFixed(2).padStart(9) + (TOTAL_M3[cat] ?? 0).toFixed(2).padStart(8))
}
console.log('\nDONE — single fixture, single wall (so beams/slab quantities are 1-wall not whole-building);')
console.log('per-category kg deltas are dominated by inventory completeness + the footing Ld finding (PART 1).')
