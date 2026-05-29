// scripts/validate-bbs-karthick.mjs  — READ-ONLY reference validation.
//
// 2026-05-29. Runs OUR BBS engine against fixtures reconstructed from the
// Karthick M-City + Selvakumar reference workbooks and prints a diff. Does NOT
// modify the engine — reports what the engine produces today.
//
// PART 1 — per-bar cutting length, BOTH modes side by side (IS_STRICT vs
//          SITE_PRACTICE) vs the workbook. SITE_PRACTICE should land ±2%.
// PART 2 — per-category kg + concrete (engine on reconstructed inventory vs
//          the Karthick TOTAL sheet; indicative only — TOTAL is unreliable).
//
// Rerun: node --experimental-loader ./scripts/resolver-hook.mjs scripts/validate-bbs-karthick.mjs

import { useStore } from '../src/store.js'
import { computeRebarGroups } from '../src/bbs/index.js'
import { buildBbsWorkbookModel } from '../src/export/bbs.js'

const s = useStore.getState
const MM_PER_FT = 304.8
const ft = mm => mm / MM_PER_FT
const pct = (a, b) => (b === 0 ? (a === 0 ? 0 : Infinity) : ((a - b) / b) * 100)
function load(p) {
  s().loadProject({ nodes: {}, walls: {}, rooms: {}, stamps: {}, columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {}, projectSettings: undefined, unit: 'inch', ...p })
  s().setDrawReference?.('centerline')
}

// ── PART 1 — per-bar, both modes ─────────────────────────────────────────────
// Each builder returns the engine cutting length (ft) for the given mode.
const builders = {
  'Footing mesh F1 Ø10': (mode) => {
    load({})
    s().setProjectSettings({ bbsAllowanceMode: mode,
      reinforcementSpecs: { F: { id: 'F', label: 'F', elementType: 'FOOTING', xBars: { count: 6, diaMm: 10 }, yBars: { count: 6, diaMm: 10 }, developmentLengthMultiplier: 50, coverMm: 60 } },
      bbsDefaults: { FOOTING: 'F' } })
    s().addFoundation('ISOLATED', { columnIds: [], geometry: { lengthFt: 3.606 + 2 * (60 / MM_PER_FT), widthFt: 3.606 + 2 * (60 / MM_PER_FT) }, floorId: 'F1', label: 'F1' })
    return ft(computeRebarGroups(s()).groups.find(g => g.role === 'X_MESH').cuttingLengthMm)
  },
  'Column main C2 Ø12': (mode) => {
    load({})
    s().setProjectSettings({ bbsAllowanceMode: mode,
      heights: { plinthHeightFt: 0, floorHeightFt: 11 },
      floors: [{ id: 'F1', label: 'GF', sequence: 0, plinthHeightFt: 0, floorHeightFt: 11, meta: null }],
      slabSettings: { mainThicknessIn: 0, sunkenDepthIn: 0, autoSunkenRoomTypes: [] },
      reinforcementSpecs: { C: { id: 'C', label: 'C2', elementType: 'COLUMN', longitudinalBarCount: 8, longitudinalBarDiaMm: 12, stirrupBarDiaMm: 8, stirrupSpacingIn: 7, coverMm: 40, lapLengthMultiplier: 50 } },
      bbsDefaults: { COLUMN: 'C' },
      columnTypes: [{ id: 'C2', label: 'C2', shape: 'rect', widthIn: 9, depthIn: 15, footingLengthFt: 4, footingWidthFt: 4, footingDepthFt: 1.5 }] })
    const cid = s().addColumn(0, 0); s().setColumnType(cid, 'C2')
    return ft(computeRebarGroups(s()).groups.find(g => g.role === 'LONGITUDINAL').cuttingLengthMm)
  },
  'Roof beam top B8 Ø16': (mode) => beamFixture(mode, 'TOP'),
  'Roof beam stirrup Ø8': (mode) => beamFixture(mode, 'STIRRUP'),
  'Sunshade main Ø8': (mode) => {
    load({ nodes: { n1: { id: 'n1', x: 0, y: 0, floorIds: ['F1'] }, n2: { id: 'n2', x: 240, y: 0, floorIds: ['F1'] } },
      walls: { w1: { id: 'w1', n1: 'n1', n2: 'n2', floorId: 'F1', thickness: 9, height: 120, materialKey: 'IS_MODULAR_BRICK', isPlot: false, isVirtual: false, openings: [{ id: 'op1', type: 'window', width: 4.384 * 12, height: 48, offset: 24, orient: 0, hasSunshade: true, subtype: 'WINDOW', subtypeSource: 'HEURISTIC' }] } } })
    s().setProjectSettings({ bbsAllowanceMode: mode, sunshadeSettings: { enabled: true, projectionFt: 1.5, thicknessIn: 3 },
      reinforcementSpecs: { SS: { id: 'SS', label: 'SS', elementType: 'SUNSHADE', mainBarDiaMm: 8, mainBarSpacingIn: 6, distBarDiaMm: 8, distBarSpacingIn: 8, coverMm: 20 } },
      bbsDefaults: { SUNSHADE: 'SS' } })
    return ft(computeRebarGroups(s()).groups.find(g => g.role === 'MAIN').cuttingLengthMm)
  },
}
function beamFixture(mode, role) {
  load({ nodes: { n1: { id: 'n1', x: 0, y: 0, floorIds: ['F1'] }, n2: { id: 'n2', x: 31.554 * 12, y: 0, floorIds: ['F1'] } },
    walls: { w1: { id: 'w1', n1: 'n1', n2: 'n2', floorId: 'F1', thickness: 9, height: 120, materialKey: 'IS_MODULAR_BRICK', isPlot: false, isVirtual: false, openings: [], hasRoofBeam: true } } })
  s().setProjectSettings({ bbsAllowanceMode: mode,
    beamDimensions: { tie: { widthIn: 9, depthIn: 15 }, plinth: { widthIn: 9, depthIn: 4 }, lintel: { widthIn: 9, depthIn: 6 }, roof: { widthIn: 9, depthIn: 15 } },
    reinforcementSpecs: { RB: { id: 'RB', label: 'RB', elementType: 'BEAM', topBars: { count: 2, diaMm: 16 }, bottomBars: { count: 2, diaMm: 16 }, stirrupBarDiaMm: 8, stirrupSpacingIn: 8, coverMm: 30 } },
    bbsDefaults: { BEAM: { tie: null, plinth: null, lintel: null, roof: 'RB' } } })
  return ft(computeRebarGroups(s()).groups.find(g => g.role === role).cuttingLengthMm)
}

const WB = { 'Footing mesh F1 Ø10': 4.106, 'Column main C2 Ø12': 12.968, 'Roof beam top B8 Ø16': 33.054, 'Roof beam stirrup Ø8': 3.813, 'Sunshade main Ø8': 4.551 }

console.log('\n' + '='.repeat(86))
console.log('PART 1 — PER-BAR CUTTING LENGTH: IS_STRICT vs SITE_PRACTICE vs workbook')
console.log('='.repeat(86))
console.log('\n ' + 'bar'.padEnd(24) + 'workbook'.padStart(9) + 'IS_STRICT'.padStart(11) + 'ISΔ%'.padStart(7) + 'SITE'.padStart(9) + 'SITEΔ%'.padStart(8) + '   note')
console.log('-'.repeat(86))
for (const [name, build] of Object.entries(builders)) {
  const wb = WB[name]
  const isv = build('IS_STRICT')
  const site = build('SITE_PRACTICE')
  const note = name.startsWith('Sunshade') ? 'model diff (bar axis) — P2' : (Math.abs(pct(site, wb)) <= 2 ? '✓ site ±2%' : '')
  console.log(' ' + name.padEnd(24) + wb.toFixed(3).padStart(9) + isv.toFixed(3).padStart(11) + (pct(isv, wb).toFixed(0) + '%').padStart(7) + site.toFixed(3).padStart(9) + (pct(site, wb).toFixed(1) + '%').padStart(8) + '   ' + note)
}

// ── PART 2 — per-category (indicative; single-wall fixture, both modes) ───────
console.log('\n' + '='.repeat(86))
console.log('PART 2 — PER-CATEGORY kg (engine reconstructed inventory vs Karthick TOTAL; indicative)')
console.log('='.repeat(86))
const TOTAL = { FOOTING: 833.809, SUB_COLUMN: 863.939, TIE_BEAM: 1038.172, PLINTH_BEAM: null, SUPER_COLUMN: 716.991, LINTEL_BEAM: 373.877, SUNSHADE: 56.88, LOFT: 142.2, STAIRCASE: 0, ROOF_BEAM: 2008.717, ROOF_SLAB: 2531.778 }
function buildInventory(mode) {
  load({ nodes: { n1: { id: 'n1', x: 0, y: 0, floorIds: ['F1'] }, n2: { id: 'n2', x: 300 * 12, y: 0, floorIds: ['F1'] } },
    walls: { w1: { id: 'w1', n1: 'n1', n2: 'n2', floorId: 'F1', thickness: 9, height: 120, materialKey: 'IS_MODULAR_BRICK', isPlot: false, isVirtual: false, hasTieBeam: true, hasLintelBeam: true, hasRoofBeam: true, loft: { enabled: true, widthFt: 16, depthFt: 4.3 }, openings: [{ id: 'op1', type: 'window', width: 52, height: 48, offset: 24, orient: 0, hasSunshade: true, subtype: 'WINDOW', subtypeSource: 'HEURISTIC' }] } } })
  s().setProjectSettings({ bbsAllowanceMode: mode, is2502Params: { subSuperColumnSplitEnabled: true },
    heights: { plinthHeightFt: 5, floorHeightFt: 11 }, floors: [{ id: 'F1', label: 'GF', sequence: 0, plinthHeightFt: 5, floorHeightFt: 11, meta: null }],
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
    columnTypes: [{ id: 'C', label: 'C', shape: 'rect', widthIn: 9, depthIn: 15, footingLengthFt: 4, footingWidthFt: 4, footingDepthFt: 1.5 }] })
  const footings = [3.6, 4.1, 4.9, 5.6, 4.1, 6.6, 4.9, 4.9, 5.6, 3.6, 8.6]
  for (let i = 0; i < footings.length; i++) s().addFoundation('ISOLATED', { columnIds: [], geometry: { lengthFt: footings[i], widthFt: footings[i] }, floorId: 'F1', label: `F${i + 1}` })
  for (let i = 0; i < 13; i++) { const c = s().addColumn(i * 12, 0); s().setColumnType(c, 'C') }
  return computeRebarGroups(s()).totals.byBbsCategory
}
const engIS = buildInventory('IS_STRICT')
const engSITE = buildInventory('SITE_PRACTICE')
console.log('\n ' + 'category'.padEnd(15) + 'IS kg'.padStart(9) + 'SITE kg'.padStart(9) + 'TOTAL kg'.padStart(10) + '  note')
console.log('-'.repeat(86))
for (const cat of ['FOOTING', 'SUB_COLUMN', 'SUPER_COLUMN', 'TIE_BEAM', 'LINTEL_BEAM', 'SUNSHADE', 'LOFT', 'ROOF_BEAM']) {
  const i = engIS[cat]?.totalKg ?? 0, st = engSITE[cat]?.totalKg ?? 0, t = TOTAL[cat]
  console.log(' ' + cat.padEnd(15) + i.toFixed(0).padStart(9) + st.toFixed(0).padStart(9) + (t == null ? '#REF!' : t.toFixed(0)).padStart(10) + '  ' + (cat === 'FOOTING' ? 'footing fix applied' : 'single-wall fixture — inventory partial'))
}
console.log('\nNOTE: PART 2 is a single-wall fixture (beams/slab one-instance), and the Karthick')
console.log('TOTAL is an unreliable manual roll-up (#REF! grade row). PART 1 per-bar is the real proof.')
