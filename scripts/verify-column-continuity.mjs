// Phase ColumnStack — column continuity + per-floor segments verification.
//
// Proves the new multi-floor column kernel:
//   A. Per-floor lift-height decomposition (Σ lifts == getColumnHeightFt;
//      single-floor lift == full height → byte-identity proof).
//   B. Stack actions (extend / truncate / setSegment / clearSegment).
//   C. findColumnStackBelow.
//   D. Resolution precedence (SEGMENT > INSTANCE > TYPE > PROJECT_DEFAULT >
//      ESTIMATE) + per-floor section override.
//   E. Per-floor concrete-volume attribution (no cross-floor double count).
//   F. Per-floor BBS lifts (one lift + one lap per floor) — FIRST-PRINCIPLES
//      cutting lengths from IS 2502 (56.6d lap), cross-checked against the
//      Karthick M-City reference workbook methodology (separate GF/FF column
//      sheets, one lap per lift).  ── REFERENCE DELTA (surfaced, not resolved):
//      the workbook uses a 50d site lap (header "50 d mm", 1.968 ft = 600 mm =
//      50×12 mm); the catalog IS_STRICT default is 56.6d (679.2 mm @ 12 mm).
//      Both produce one-lap-per-lift — only the lap multiple differs. We assert
//      against the catalog default (56.6d); 50d is reachable via SITE_PRACTICE.
//   G. column_unsupported validation (warning, dismissable).
//   H. Single-floor BBS byte-identity (collapses to the pre-phase emission).

import { useStore } from '../src/store.js'
import { verifyIntegrity } from '../src/schema/integrity.js'
import { computeRebarGroups } from '../src/bbs/index.js'
import { REBAR_ROLE } from '../src/bbs/types.js'
import { runValidation } from '../src/validation/engine.js'
import { scopeStateToFloor } from '../src/boq/scope.js'
import {
  getColumnHeightFt, getColumnLiftHeightFt, getColumnSpanFloorIds, findColumnStackBelow,
} from '../src/topology/columns.js'
import {
  resolveColumnReinforcementSpec, resolveColumnSectionForFloor,
} from '../src/specs/resolution.js'
import { ftToMm } from '../src/specs/cuttingLength.js'

const s = useStore.getState
let pass = 0, fail = 0
function ok(label, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + label) }
  else { fail++; console.log('  ✗ ' + label + (extra ? `  — ${extra}` : '')) }
}
function header(t) { console.log('\n' + '─'.repeat(70) + '\n' + t + '\n' + '─'.repeat(70)) }
const near = (a, b, t = 0.5) => Math.abs(a - b) < t

const FT = 12
const SPEC_C1 = {
  id: 'COLUMN_C1_RES', label: 'C1 Residential', elementType: 'COLUMN',
  longitudinalBarCount: 6, longitudinalBarDiaMm: 12, stirrupBarDiaMm: 8,
  stirrupSpacingIn: 6, coverMm: 25, lapLengthMultiplier: 50,
}
const SPEC_C2 = { ...SPEC_C1, id: 'COLUMN_C2_RES', label: 'C2', longitudinalBarCount: 8 }
const CT_C1 = { id: 'C1', label: 'C1', shape: 'rect', widthIn: 9, depthIn: 12, footingLengthFt: 4, footingWidthFt: 4, footingDepthFt: 1.5 }
const CT_C2 = { id: 'C2', label: 'C2', shape: 'rect', widthIn: 9, depthIn: 9, footingLengthFt: 4, footingWidthFt: 4, footingDepthFt: 1.5 }

// F1: plinth 1.5 + floor 10 ; F2: floor 9 ; slab 5"/12 = 0.416667 ft.
const FLOORS = [
  { id: 'F1', label: 'Floor 1', sequence: 0, plinthHeightFt: 1.5, floorHeightFt: 10, meta: null, underlay: null },
  { id: 'F2', label: 'Floor 2', sequence: 1, plinthHeightFt: 1.5, floorHeightFt: 9,  meta: null, underlay: null },
]
function setupTwoFloor(extra = {}) {
  s().loadProject({ nodes: {}, walls: {}, rooms: {}, stamps: {}, columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {}, projectSettings: undefined, unit: 'inch' })
  s().setProjectSettings({
    floors: FLOORS,
    reinforcementSpecs: { COLUMN_C1_RES: SPEC_C1, COLUMN_C2_RES: SPEC_C2 },
    bbsDefaults: { COLUMN: 'COLUMN_C1_RES' },
    columnTypes: [CT_C1, CT_C2],
    ...extra,
  })
  s().setCurrentFloorId('F1')
}

// Hand-computed lift heights (ft).
const LIFT_F1 = 1.5 + 10            // 11.5  (base: plinth + floor, no slab)
const LIFT_F2 = 9 + 5 / 12          // 9.41667 (top: floor + slab)
const FULL    = LIFT_F1 + LIFT_F2   // 20.91667
const LAP_12  = 56.6 * 12           // 679.2 mm  (IS 456 56.6d, Fe500/M20)

// ── A. Lift decomposition ─────────────────────────────────────────────────
header('A. Per-floor lift-height decomposition')
setupTwoFloor()
{
  const id = s().addColumn(0, 0, 'C1')
  s().extendColumnToFloor(id, 'F2')
  const col = s().columns[id]
  ok('span = [F1, F2]', JSON.stringify(getColumnSpanFloorIds(s(), col)) === JSON.stringify(['F1', 'F2']))
  ok('lift(F1) = 11.5 ft (plinth+floor, no slab)', near(getColumnLiftHeightFt(s(), col, 'F1'), LIFT_F1, 1e-6))
  ok('lift(F2) = 9.41667 ft (floor+slab)', near(getColumnLiftHeightFt(s(), col, 'F2'), LIFT_F2, 1e-6))
  ok('Σ lifts == getColumnHeightFt', near(getColumnLiftHeightFt(s(), col, 'F1') + getColumnLiftHeightFt(s(), col, 'F2'), getColumnHeightFt(s(), col), 1e-9))
  ok('getColumnHeightFt == 20.91667 (unchanged total)', near(getColumnHeightFt(s(), col), FULL, 1e-6))
  ok('integrity valid', verifyIntegrity(s()).valid)
}

// Single-floor identity: one lift == full height.
setupTwoFloor()
{
  const id = s().addColumn(0, 0, 'C1')   // base=top=F1
  const col = s().columns[id]
  ok('single-floor: span = [F1]', JSON.stringify(getColumnSpanFloorIds(s(), col)) === JSON.stringify(['F1']))
  ok('single-floor: lift(F1) == getColumnHeightFt (byte-identity)', near(getColumnLiftHeightFt(s(), col, 'F1'), getColumnHeightFt(s(), col), 1e-9))
}

// ── B. Stack actions ──────────────────────────────────────────────────────
header('B. extend / truncate / setSegment / clearSegment')
setupTwoFloor()
{
  const id = s().addColumn(0, 0, 'C1')
  s().extendColumnToFloor(id, 'F2')
  ok('extend → topFloorId = F2', s().columns[id].topFloorId === 'F2')
  ok('extend → still ONE entity', Object.keys(s().columns).length === 1)

  s().setColumnSegment(id, 'F2', { columnTypeId: 'C2', reinforcementSpecId: 'COLUMN_C2_RES' })
  ok('setColumnSegment writes F2 override', s().columns[id].segments?.F2?.columnTypeId === 'C2')

  s().truncateColumnToFloor(id, 'F1')
  ok('truncate F1 → topFloorId = F1', s().columns[id].topFloorId === 'F1')
  ok('truncate prunes orphaned F2 segment', s().columns[id].segments === null)

  // truncate below base deletes the column entirely.
  const id2 = s().addColumn(50 * FT, 0, 'C1')
  s().setCurrentFloorId('F2'); s().extendColumnToFloor(id2, 'F2')
  s().truncateColumnToFloor(id2, 'F1')   // F1 is below base? base is F1 → keeps F1
  ok('truncate to base floor keeps the column', !!s().columns[id2])
}

// ── C. findColumnStackBelow ───────────────────────────────────────────────
header('C. findColumnStackBelow')
setupTwoFloor()
{
  const id = s().addColumn(0, 0, 'C1')   // F1-only, top = F1 (the floor below F2)
  ok('stack below F2 at (0,0) → found', findColumnStackBelow(s(), 0, 0, 'F2', 16)?.id === id)
  ok('stack below F2 far away → null', findColumnStackBelow(s(), 500, 500, 'F2', 16) === null)
  ok('no floor below F1 → null', findColumnStackBelow(s(), 0, 0, 'F1', 16) === null)
}

// ── D. Resolution precedence + section override ───────────────────────────
header('D. resolution precedence + per-floor section')
setupTwoFloor()
{
  const id = s().addColumn(0, 0, 'C1')
  s().extendColumnToFloor(id, 'F2')
  const col = s().columns[id]
  // default (PROJECT_DEFAULT via bbsDefaults.COLUMN)
  ok('F1 reinforcement source = PROJECT_DEFAULT', resolveColumnReinforcementSpec(s(), id, 'F1').source === 'PROJECT_DEFAULT')
  ok('F1 section = C1 (default)', resolveColumnSectionForFloor(s(), col, 'F1')?.id === 'C1')
  // segment override on F2
  s().setColumnSegment(id, 'F2', { columnTypeId: 'C2', reinforcementSpecId: 'COLUMN_C2_RES' })
  const col2 = s().columns[id]
  ok('F2 section override = C2', resolveColumnSectionForFloor(s(), col2, 'F2')?.id === 'C2')
  ok('F2 reinforcement source = SEGMENT', resolveColumnReinforcementSpec(s(), id, 'F2').source === 'SEGMENT')
  ok('F2 reinforcement spec = COLUMN_C2_RES', resolveColumnReinforcementSpec(s(), id, 'F2').specId === 'COLUMN_C2_RES')
  // instance beats type/default, segment beats instance
  s().setColumnReinforcementSpec(id, 'COLUMN_C1_RES')
  ok('F1 now INSTANCE (no segment)', resolveColumnReinforcementSpec(s(), id, 'F1').source === 'INSTANCE')
  ok('F2 still SEGMENT (beats instance)', resolveColumnReinforcementSpec(s(), id, 'F2').source === 'SEGMENT')
}

// ── E. Per-floor concrete-volume attribution (no double count) ────────────
header('E. per-floor volume attribution')
setupTwoFloor()
{
  const id = s().addColumn(0, 0, 'C1')
  s().extendColumnToFloor(id, 'F2')
  const sectFt2 = (9 * 12) / 144   // 0.75
  const volTotal = sectFt2 * FULL
  const unscoped = s().getColumnQuantities().C1.volFt3
  const f1 = scopeStateToFloor(s(), 'F1').getColumnQuantities().C1.volFt3
  const f2 = scopeStateToFloor(s(), 'F2').getColumnQuantities().C1.volFt3
  ok('unscoped volFt3 == section × full height', near(unscoped, volTotal, 0.02))
  ok('F1 volFt3 == section × lift(F1)', near(f1, sectFt2 * LIFT_F1, 0.02))
  ok('F2 volFt3 == section × lift(F2)', near(f2, sectFt2 * LIFT_F2, 0.02))
  ok('F1 + F2 == unscoped (no double count)', near(f1 + f2, unscoped, 0.05))
  ok('F1 alone != full height (regression guard)', !near(f1, volTotal, 0.5))
}

// ── F. Per-floor BBS lifts — first-principles cutting lengths ─────────────
header('F. per-floor BBS lifts (one lap per lift, 56.6d catalog)')
setupTwoFloor()
{
  const id = s().addColumn(0, 0, 'C1')
  s().extendColumnToFloor(id, 'F2')
  const groups = computeRebarGroups(s()).groups
  const longs = groups.filter(g => g.role === REBAR_ROLE.LONGITUDINAL && g.elementId === id)
  ok('2 LONGITUDINAL groups (one lift per floor)', longs.length === 2, `got ${longs.length}`)
  const lF1 = longs.find(g => g.floorId === 'F1')
  const lF2 = longs.find(g => g.floorId === 'F2')
  ok('F1 lift carries floorId F1', !!lF1)
  ok('F2 lift carries floorId F2', !!lF2)
  // cutting = ftToMm(lift) + one lap (56.6d).
  ok('F1 cutting = 11.5ft + 56.6d = 4184.4mm', lF1 && near(lF1.cuttingLengthMm, ftToMm(LIFT_F1) + LAP_12))
  ok('F2 cutting = 9.41667ft + 56.6d = 3549.4mm', lF2 && near(lF2.cuttingLengthMm, ftToMm(LIFT_F2) + LAP_12))
  // Per-lift-lap proof: total lift cutting exceeds a single full-height bar by
  // exactly ONE extra lap (the second lift's splice).
  const singleFull = ftToMm(FULL) + LAP_12
  const twoLifts = lF1.cuttingLengthMm + lF2.cuttingLengthMm
  ok('extra steel == exactly one extra lap (679.2mm)', near(twoLifts - singleFull, LAP_12, 1))
  // 2 stirrup groups too (one per lift, no confinement by default).
  const stirs = groups.filter(g => g.role === REBAR_ROLE.STIRRUP && g.elementId === id)
  ok('2 STIRRUP groups (one per lift)', stirs.length === 2, `got ${stirs.length}`)
  ok('integrity valid', verifyIntegrity(s()).valid)
}

// Per-floor section override changes the upper lift's bar count.
setupTwoFloor()
{
  const id = s().addColumn(0, 0, 'C1')
  s().extendColumnToFloor(id, 'F2')
  s().setColumnSegment(id, 'F2', { columnTypeId: 'C2', reinforcementSpecId: 'COLUMN_C2_RES' })
  const longs = computeRebarGroups(s()).groups.filter(g => g.role === REBAR_ROLE.LONGITUDINAL && g.elementId === id)
  const lF1 = longs.find(g => g.floorId === 'F1')
  const lF2 = longs.find(g => g.floorId === 'F2')
  ok('F1 lift uses default 6 bars', lF1?.count === 6)
  ok('F2 lift uses C2 segment 8 bars', lF2?.count === 8, `got ${lF2?.count}`)
}

// ── G. column_unsupported validation ──────────────────────────────────────
header('G. column_unsupported (warning)')
setupTwoFloor()
{
  // A column based on F2 with nothing below = unsupported.
  s().setCurrentFloorId('F2')
  const floating = s().addColumn(0, 0, 'C1')   // base=top=F2
  const issues = runValidation(s(), { scopes: ['structural'] }).issues.filter(i => i.ruleId === 'column_unsupported')
  ok('floating F2 column flagged column_unsupported', issues.some(i => i.entityId === floating))
  // A ground-based column is NOT flagged.
  s().setCurrentFloorId('F1')
  const grounded = s().addColumn(40 * FT, 0, 'C1')
  const issues2 = runValidation(s(), { scopes: ['structural'] }).issues.filter(i => i.ruleId === 'column_unsupported')
  ok('grounded F1 column NOT flagged', !issues2.some(i => i.entityId === grounded))
}

// ── H. Single-floor BBS byte-identity ─────────────────────────────────────
header('H. single-floor BBS == pre-phase emission')
setupTwoFloor()
{
  const id = s().addColumn(0, 0, 'C1')   // F1-only
  const longs = computeRebarGroups(s()).groups.filter(g => g.role === REBAR_ROLE.LONGITUDINAL && g.elementId === id)
  ok('single-floor → exactly 1 LONGITUDINAL group', longs.length === 1)
  ok('single-floor cutting = fullHeight + one lap', near(longs[0].cuttingLengthMm, ftToMm(getColumnHeightFt(s(), s().columns[id])) + LAP_12))
}

console.log('\n' + '═'.repeat(70))
console.log(`PASS: ${pass}  FAIL: ${fail}`)
console.log('═'.repeat(70))
if (fail > 0) { console.error(`✗ verify-column-continuity FAILED: ${fail} assertions`); process.exit(1) }
else { console.log(`✓ verify-column-continuity passed (${pass} assertions)`) }
