// scripts/verify-room-breakdown.mjs
//
// Room-by-room BOQ breakdown (computeRoomBreakdown).
//
// Sections:
//   Bootstrap — integrity gate + module purity grep (roomBreakdown.js is
//               React/DOM-free; it only consumes existing engines).
//   A — Structure: per-room rows, grouping, totals shape.
//   B — Cross-check invariant: the exact-match columns (flooring, plaster-ext,
//       paint, waterproofing, tiles) — Σ per-room == project BOQ Summary line.
//   C — Multi-floor grouping isolation.
//   D — Per-room correctness: wet room has waterproofing; areas match
//       getRoomArea; totals == sum of room rows.
//
// Run via:
//   node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-room-breakdown.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { useStore } from '../src/store.js'
import { verifyIntegrity } from '../src/schema/integrity.js'
import { getBoqLines } from '../src/boq/lines.js'
import { computeRoomBreakdown, EXACT_MATCH_COLUMNS } from '../src/boq/roomBreakdown.js'

const s = useStore.getState
const FT = 12

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
const near = (a, b, eps = 0.05) => Math.abs(a - b) < eps

function reset() {
  s().loadProject({
    nodes: {}, walls: {}, rooms: {}, stamps: {},
    columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {},
    projectSettings: undefined, unit: 'inch',
  })
  // Lock centerline so room rectangles have predictable areas (the new
  // inside_face default would otherwise inset the corners). The cross-check
  // invariant is geometry-independent, but Section D asserts exact areas.
  s().setDrawReference('centerline')
}

// ── Bootstrap — module purity grep ──────────────────────────────────────

header('Bootstrap — module purity (roomBreakdown.js is React/DOM-free)')
{
  const __filename = fileURLToPath(import.meta.url)
  const repoRoot   = path.resolve(path.dirname(__filename), '..')
  const src = fs.readFileSync(path.join(repoRoot, 'src/boq/roomBreakdown.js'), 'utf-8')
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  ok('no react import',     !/from\s+['"]react['"]/.test(stripped))
  ok('no react-dom import', !/from\s+['"]react-dom['"]/.test(stripped))
  ok('no window reference', !/\bwindow\b/.test(stripped))
  ok('no document reference', !/\bdocument\b/.test(stripped))
}

// ── Fixture — 3 rooms on F1 (incl. a wet TOILET) + 1 room on F2 ──────────
// Separated rectangles (gaps) so every room has 4 clean external walls; the
// exact-match cross-check holds regardless of partition layout.

reset()
const f1 = s().currentFloorId
s().addRectangleRoom(0,      0,     12*FT, 10*FT, { type: 'LIVING',  name: 'Living'  })
s().addRectangleRoom(16*FT,  0,     26*FT, 10*FT, { type: 'BEDROOM', name: 'Bedroom' })
s().addRectangleRoom(0,      14*FT, 6*FT,  19*FT, { type: 'TOILET',  name: 'Toilet'  })

const f2 = s().addFloor()
s().setCurrentFloorId(f2)
s().addRectangleRoom(0, 0, 10*FT, 12*FT, { type: 'BEDROOM', name: 'Bedroom 2' })
s().setCurrentFloorId(f1)

const rates = s().ratesByKey ?? {}

// ── Bootstrap — integrity gate ──────────────────────────────────────────
header('Bootstrap — integrity gate')
ok('state passes referential integrity', verifyIntegrity(s()).valid)

// ── Section A — Structure ───────────────────────────────────────────────
header('Section A — Structure')
{
  const bd = computeRoomBreakdown(s(), rates)
  ok('roomCount === 4', bd.roomCount === 4, `got ${bd.roomCount}`)
  ok('isMultiFloor === true', bd.isMultiFloor === true)
  ok('byFloor has 2 groups', bd.byFloor.length === 2, `got ${bd.byFloor.length}`)
  const g1 = bd.byFloor.find(g => g.floorId === f1)
  const g2 = bd.byFloor.find(g => g.floorId === f2)
  ok('F1 group has 3 rooms', g1?.rooms.length === 3, `got ${g1?.rooms.length}`)
  ok('F2 group has 1 room',  g2?.rooms.length === 1, `got ${g2?.rooms.length}`)
  ok('rooms sorted by name in F1', g1 && g1.rooms.map(r => r.name).join(',') === 'Bedroom,Living,Toilet',
     g1?.rooms.map(r => r.name).join(','))
  const row = g1?.rooms.find(r => r.name === 'Living')
  ok('row carries typeLabel', row?.typeLabel === 'Living Room', row?.typeLabel)
  ok('totals object has all columns', bd.totals &&
     ['floorAreaFt2','wallAreaFt2','brickworkCft','plasterIntSft','plasterExtSft',
      'flooringSft','paintSft','waterproofingSft','tilesSft','doors','windows']
       .every(k => k in bd.totals))
}

// ── Section B — Cross-check invariant ───────────────────────────────────
header('Section B — Exact-match columns reconcile to project BOQ Summary')
{
  const bd = computeRoomBreakdown(s(), rates)
  for (const col of EXACT_MATCH_COLUMNS) {
    ok(`Σ rooms ${col} == BOQ Summary`, near(bd.totals[col], bd.crossCheck[col]),
       `Σrooms=${bd.totals[col]} summary=${bd.crossCheck[col]}`)
  }
  // The exact-match columns must be non-trivial (the fixture exercises them).
  ok('flooring total > 0',     bd.totals.flooringSft > 0,      `${bd.totals.flooringSft}`)
  ok('paint total > 0',        bd.totals.paintSft > 0,         `${bd.totals.paintSft}`)
  ok('waterproofing total > 0',bd.totals.waterproofingSft > 0, `${bd.totals.waterproofingSft}`)
  ok('plaster-ext total > 0',  bd.totals.plasterExtSft > 0,    `${bd.totals.plasterExtSft}`)

  // Independent cross-check against a fresh project getBoqLines call.
  const proj = getBoqLines(s(), rates, {})
  const pq = (id) => proj.find(l => l.id === id)?.qty ?? 0
  ok('flooring matches finishes_flooring line',
     near(bd.totals.flooringSft, pq('finishes_flooring')))
  ok('plaster-ext matches finishes_plaster_walls_external line',
     near(bd.totals.plasterExtSft, pq('finishes_plaster_walls_external')))
  ok('waterproofing matches finishes_waterproofing line',
     near(bd.totals.waterproofingSft, pq('finishes_waterproofing')))
}

// ── Section C — Multi-floor grouping isolation ──────────────────────────
header('Section C — Multi-floor grouping isolation')
{
  const bd = computeRoomBreakdown(s(), rates)
  const g1 = bd.byFloor.find(g => g.floorId === f1)
  const g2 = bd.byFloor.find(g => g.floorId === f2)
  // Every room in a group actually belongs to that floor.
  ok('F1 rows all on F1', g1.rooms.every(r => r.floorId === f1))
  ok('F2 rows all on F2', g2.rooms.every(r => r.floorId === f2))
  // F2's single room is the only Bedroom 2.
  ok('F2 contains Bedroom 2', g2.rooms[0].name === 'Bedroom 2')
  // Sum of per-floor floor-area equals overall total.
  const perFloorSum = bd.byFloor
    .flatMap(g => g.rooms)
    .reduce((t, r) => t + r.floorAreaFt2, 0)
  ok('Σ room floor-area == totals.floorAreaFt2', near(perFloorSum, bd.totals.floorAreaFt2, 0.5),
     `Σ=${perFloorSum} totals=${bd.totals.floorAreaFt2}`)
}

// ── Section D — Per-room correctness ────────────────────────────────────
header('Section D — Per-room correctness')
{
  const bd = computeRoomBreakdown(s(), rates)
  const allRows = bd.byFloor.flatMap(g => g.rooms)

  // Wet room (TOILET) carries waterproofing; dry rooms do not.
  const toilet = allRows.find(r => r.type === 'TOILET')
  ok('toilet has waterproofing > 0', toilet && toilet.waterproofingSft > 0,
     `${toilet?.waterproofingSft}`)
  const living = allRows.find(r => r.name === 'Living')
  ok('living has no waterproofing', living && living.waterproofingSft === 0,
     `${living?.waterproofingSft}`)

  // Floor area matches getRoomArea for each room (within rounding).
  let areaMatches = true
  for (const r of allRows) {
    if (!near(r.floorAreaFt2, s().getRoomArea(r.roomId), 0.5)) areaMatches = false
  }
  ok('every row floorArea == getRoomArea(roomId)', areaMatches)

  // Living is 12×10 = 120 ft² (centerline).
  ok('Living floor area == 120 ft²', near(living.floorAreaFt2, 120, 0.5), `${living?.floorAreaFt2}`)

  // Totals are exactly the column-wise sums of the rows.
  const sumKey = (k) => allRows.reduce((t, r) => t + r[k], 0)
  ok('totals.flooringSft == Σ rows', near(bd.totals.flooringSft, sumKey('flooringSft')))
  ok('totals.brickworkCft == Σ rows', near(bd.totals.brickworkCft, sumKey('brickworkCft')))
  ok('totals.doors == Σ rows', bd.totals.doors === sumKey('doors'))
}

// ── Single-floor degenerate case ────────────────────────────────────────
header('Section E — Single-floor case (isMultiFloor false)')
{
  reset()
  s().setDrawReference('centerline')
  s().addRectangleRoom(0, 0, 10*FT, 10*FT, { type: 'BEDROOM', name: 'Only Room' })
  const bd = computeRoomBreakdown(s(), s().ratesByKey ?? {})
  ok('single floor → isMultiFloor false', bd.isMultiFloor === false)
  ok('single group with 1 room', bd.byFloor.length === 1 && bd.byFloor[0].rooms.length === 1)
  ok('exact-match columns still reconcile',
     EXACT_MATCH_COLUMNS.every(c => near(bd.totals[c], bd.crossCheck[c])))
}

// ── Summary ─────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(70))
console.log(`Room-breakdown verify: ${pass} passed, ${fail} failed`)
console.log('='.repeat(70))
process.exit(fail === 0 ? 0 : 1)
