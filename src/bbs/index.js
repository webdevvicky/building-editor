import { effectiveStockBarLength } from '../specs/effectiveBbsSettings.js'
// BBS — Bar Bending Schedule entry point.
//
// 2026-05-28. computeRebarGroups(state, opts) is the single top-level
// function for the new bar-member abstraction. It walks every structural
// entity (column, beam, footing, slab) for the requested floor scope,
// resolves the reinforcement spec via src/specs/resolution.js, and
// delegates to the per-element generator under src/bbs/generators/.
//
// The output is a flat RebarGroup[] sorted by:
//   1. floorId sequence (per projectSettings.floors)
//   2. elementType ORDER (FOOTING → COLUMN → BEAM → SLAB — site sequence)
//   3. elementId (lexical)
//   4. role (per ROLE_ORDER below)
//   5. markId (lexical tiebreak)
//
// This ordering matches how site engineers walk a BBS table: footings
// first (poured first), columns up, beams across, slab on top.
//
// Backward-compat invariant:
//   sum(rebarGroup.totalWeightKg) per (category, floor)
//     === computeBBSQuantities(state)[byCategory].totalKg
//   within +/- 0.5 kg rounding tolerance.
//
// Pure module — no React, no DOM, no Zustand. Reads state through the same
// surface the existing aggregator uses.

import { generateColumnRebarGroups } from './generators/columnRebar.js'
import { generateBeamRebarGroups }   from './generators/beamRebar.js'
import { generateFootingRebarGroups } from './generators/footingRebar.js'
import { generateSlabRebarGroups }   from './generators/slabRebar.js'
import { generateSunshadeRebarGroups } from './generators/sunshadeRebar.js'
import { generateLoftRebarGroups }   from './generators/loftRebar.js'
import { generateStaircaseRebarGroups } from './generators/staircaseRebar.js'
import { getIs2502Params, CATALOG_VERSION } from '../specs/cuttingLength.js'
import { getDerivedWallBeams, tieBeamForWall } from '../topology/beams.js'
import {
  DERIVATION_KIND, derivedMembersWithIdentity, derivedElementId, inlineFootingColumns,
} from '../topology/derivedMembers.js'
import { ELEMENT_TYPE, REBAR_ROLE } from './types.js'

// Site-order for elements within a floor — matches construction sequence.
const ELEMENT_ORDER = Object.freeze({
  [ELEMENT_TYPE.FOOTING]:   0,
  [ELEMENT_TYPE.COLUMN]:    1,
  [ELEMENT_TYPE.BEAM]:      2,
  [ELEMENT_TYPE.SUNSHADE]:  3,
  [ELEMENT_TYPE.LOFT]:      4,
  [ELEMENT_TYPE.STAIRCASE]: 5,
  [ELEMENT_TYPE.SLAB]:      6,
})

// Role-order for bars within an element — schedule convention.
const ROLE_ORDER = Object.freeze({
  [REBAR_ROLE.MAIN]:         0,
  [REBAR_ROLE.X_MESH]:       1,
  [REBAR_ROLE.Y_MESH]:       2,
  [REBAR_ROLE.LONGITUDINAL]: 3,
  [REBAR_ROLE.WAIST]:        4,
  [REBAR_ROLE.TOP]:          5,
  [REBAR_ROLE.BOTTOM]:       6,
  [REBAR_ROLE.MID]:          7,
  [REBAR_ROLE.CRANK]:        8,
  [REBAR_ROLE.EXTRA_TOP]:    9,
  [REBAR_ROLE.TREAD]:        10,
  [REBAR_ROLE.LANDING]:      11,
  [REBAR_ROLE.DIST]:         12,
  [REBAR_ROLE.DOWEL]:        13,
  [REBAR_ROLE.STIRRUP]:      14,
  [REBAR_ROLE.STIRRUP_ZONE]: 15,
})

function _floorSequence(state) {
  const floors = state?.projectSettings?.floors ?? []
  const order = new Map()
  for (const f of floors) order.set(f.id, f.sequence ?? 0)
  return order
}

function _sortRebarGroups(groups, floorSeq) {
  return groups.slice().sort((a, b) => {
    const fa = floorSeq.get(a.floorId) ?? 0
    const fb = floorSeq.get(b.floorId) ?? 0
    if (fa !== fb) return fa - fb
    const ea = ELEMENT_ORDER[a.elementType] ?? 99
    const eb = ELEMENT_ORDER[b.elementType] ?? 99
    if (ea !== eb) return ea - eb
    if (a.elementId !== b.elementId) return a.elementId < b.elementId ? -1 : 1
    const ra = ROLE_ORDER[a.role] ?? 99
    const rb = ROLE_ORDER[b.role] ?? 99
    if (ra !== rb) return ra - rb
    if (a.markId !== b.markId) return a.markId < b.markId ? -1 : 1
    return 0
  })
}

// Main entry. Returns { groups, byElement, totals }.
//
// opts: { floorId?: string }   — floor scope (optional; matches scope wrappers)
//
// Returns:
//   {
//     groups:      RebarGroup[],
//     byElement: {
//       [elementType]: {
//         [elementId]: RebarGroup[],
//       }
//     },
//     totals: {
//       totalWeightKg,
//       byCategory:  { column, beam, footing, slab }   // sum totalWeightKg per elementType
//       byDiameter:  { [diaMm]: { totalKg, pieces, byCategory: { column, beam, footing, slab } } }
//     },
//     standardBarLengthM,
//     paramsVersion: CATALOG_VERSION,
//   }
export function computeRebarGroups(state, opts = {}) {
  if (!state) {
    return _emptyOutput()
  }
  const params = getIs2502Params(state)
  const floorSeq = _floorSequence(state)
  const ctx = {
    state,
    params,
    floorIdFilter: opts.floorId ?? null,
  }

  const all = []

  // ── Columns ────────────────────────────────────────────────────────────
  for (const col of Object.values(state.columns ?? {})) {
    if (ctx.floorIdFilter && !_columnSpansFloor(state, col, ctx.floorIdFilter)) continue
    const groups = generateColumnRebarGroups(ctx, col)
    if (groups && groups.length) all.push(...groups)
  }

  // ── Footings ───────────────────────────────────────────────────────────
  // Foundation entities first.
  for (const f of Object.values(state.foundations ?? {})) {
    if (ctx.floorIdFilter && f.floorId !== ctx.floorIdFilter) continue
    const groups = generateFootingRebarGroups(ctx, { kind: 'FOUNDATION_ENTITY', foundation: f })
    if (groups && groups.length) all.push(...groups)
  }
  // Derived members (erp-saas D-280): every member the drawing implies, each under
  // its permanent id (topology/derivedMembers.js) — the id the ERP element carries.
  const derived = derivedMembersWithIdentity(state)
  const ofKind = (kind) => derived.filter((d) => d.candidate.derivationKind === kind
    && (!ctx.floorIdFilter || d.candidate.floorId === ctx.floorIdFilter))

  // Inline footings — one per column no drawn foundation carries.
  const inlineByColumn = new Map(inlineFootingColumns(state).map((x) => [x.column.id, x]))
  for (const d of ofKind(DERIVATION_KIND.INLINE_FOOTING)) {
    const { column, columnType } = inlineByColumn.get(d.candidate.hostColumnId)
    const groups = generateFootingRebarGroups(ctx, {
      kind: 'INLINE_COLUMN', column, columnType, elementId: derivedElementId(d), floorId: d.candidate.floorId,
    })
    if (groups && groups.length) all.push(...groups)
  }

  // ── Beams ──────────────────────────────────────────────────────────────
  for (const beam of Object.values(state.beams ?? {})) {
    if (ctx.floorIdFilter && beam.floorId !== ctx.floorIdFilter) continue
    const groups = generateBeamRebarGroups(ctx, beam)
    if (groups && groups.length) all.push(...groups)
  }
  // Wall-derived bands (plinth / lintel / roof) and tie bands, as beams along their wall.
  const wallBeams = new Map(getDerivedWallBeams(state).map((b) => [`${b.sourceWallId}|${b.level}`, b]))
  for (const d of ofKind(DERIVATION_KIND.WALL_BEAM)) {
    const beam = wallBeams.get(`${d.candidate.hostWallId}|${d.candidate.level}`)
    const groups = generateBeamRebarGroups(ctx, { ...beam, id: derivedElementId(d) })
    if (groups && groups.length) all.push(...groups)
  }
  for (const d of ofKind(DERIVATION_KIND.TIE_BEAM)) {
    const groups = generateBeamRebarGroups(ctx, tieBeamForWall(state, d.candidate.hostWallId, derivedElementId(d)))
    if (groups && groups.length) all.push(...groups)
  }

  // ── Sunshades (window openings with hasSunshade) and lofts (walls with a loft). ──
  for (const d of ofKind(DERIVATION_KIND.SUNSHADE)) {
    const wall = state.walls[d.candidate.hostWallId]
    const opening = wall.openings.find((o) => o.id === d.candidate.hostOpeningId)
    const groups = generateSunshadeRebarGroups(ctx, { wall, opening, elementId: derivedElementId(d) })
    if (groups && groups.length) all.push(...groups)
  }
  for (const d of ofKind(DERIVATION_KIND.LOFT)) {
    const groups = generateLoftRebarGroups(ctx, state.walls[d.candidate.hostWallId], derivedElementId(d))
    if (groups && groups.length) all.push(...groups)
  }

  // ── Slabs ──────────────────────────────────────────────────────────────
  for (const slab of Object.values(state.slabs ?? {})) {
    if (ctx.floorIdFilter && slab.floorId !== ctx.floorIdFilter) continue
    const groups = generateSlabRebarGroups(ctx, slab)
    if (groups && groups.length) all.push(...groups)
  }

  // ── Staircases. Span floors — count once at project level; when a floor
  // filter is set, attribute to the staircase's footprint floor only. ───────
  for (const stair of Object.values(state.staircases ?? {})) {
    if (ctx.floorIdFilter && stair.floorId !== ctx.floorIdFilter) continue
    const groups = generateStaircaseRebarGroups(ctx, stair)
    if (groups && groups.length) all.push(...groups)
  }

  const sorted = _sortRebarGroups(all, floorSeq)
  return _summarize(sorted, params, state)
}

// Roll a sorted RebarGroup[] into byElement + totals.
function _summarize(groups, params, state) {
  const byElement = {
    [ELEMENT_TYPE.COLUMN]:  {},
    [ELEMENT_TYPE.BEAM]:    {},
    [ELEMENT_TYPE.FOOTING]: {},
    [ELEMENT_TYPE.SLAB]:    {},
  }
  const byCategory = { column: 0, beam: 0, footing: 0, slab: 0 }
  const byDia = {}
  // Level-2 abstract roll-up — finer taxonomy (sub/super column, tie/plinth/
  // lintel/roof beam, isolated/strap footing, roof/floor slab). ADDITIVE: the
  // elementType-keyed byCategory above is unchanged (backward-compat invariant).
  const byBbsCategory = {}
  let totalWeightKg = 0

  for (const g of groups) {
    const bucket = byElement[g.elementType]
    if (bucket) {
      if (!bucket[g.elementId]) bucket[g.elementId] = []
      bucket[g.elementId].push(g)
    }
    const catKey = _categoryFor(g.elementType)
    byCategory[catKey] += g.totalWeightKg
    totalWeightKg += g.totalWeightKg

    if (!byDia[g.diaMm]) {
      byDia[g.diaMm] = { totalKg: 0, byCategory: { column: 0, beam: 0, footing: 0, slab: 0 } }
    }
    byDia[g.diaMm].totalKg += g.totalWeightKg
    byDia[g.diaMm].byCategory[catKey] += g.totalWeightKg

    // Abstract category — generator-stamped meta.bbsCategory wins; fall back to
    // the coarse elementType-derived category for any group that predates the
    // BBS-categories phase.
    const absCat = g.meta?.bbsCategory ?? _fallbackBbsCategory(g.elementType)
    if (!byBbsCategory[absCat]) {
      byBbsCategory[absCat] = { category: absCat, totalKg: 0, byDiaKg: {}, byDiaLengthM: {} }
    }
    const ent = byBbsCategory[absCat]
    ent.totalKg += g.totalWeightKg
    ent.byDiaKg[g.diaMm] = (ent.byDiaKg[g.diaMm] ?? 0) + g.totalWeightKg
    ent.byDiaLengthM[g.diaMm] = (ent.byDiaLengthM[g.diaMm] ?? 0) + g.totalLengthM
  }

  const standardBarLengthM = effectiveStockBarLength(state)
  const byDiameter = {}
  for (const diaStr of Object.keys(byDia).sort((a, b) => Number(a) - Number(b))) {
    const dia = Number(diaStr)
    const b = byDia[dia]
    const unitW = (dia * dia) / 162
    const perPieceKg = standardBarLengthM * unitW
    byDiameter[dia] = {
      diaMm: dia,
      totalKg:          b.totalKg,
      pieces:           perPieceKg > 0 ? Math.ceil(b.totalKg / perPieceKg) : 0,
      weightPerPieceKg: perPieceKg,
      standardBarLengthM,
      byCategory:       { ...b.byCategory },
    }
  }

  return {
    groups,
    byElement,
    totals: {
      totalWeightKg,
      byCategory,
      byDiameter,
      byBbsCategory,
    },
    standardBarLengthM,
    paramsVersion: CATALOG_VERSION,
  }
}

function _categoryFor(elementType) {
  switch (elementType) {
    case ELEMENT_TYPE.COLUMN:  return 'column'
    case ELEMENT_TYPE.BEAM:    return 'beam'
    case ELEMENT_TYPE.FOOTING: return 'footing'
    case ELEMENT_TYPE.SLAB:    return 'slab'
    default:                   return 'other'
  }
}

// Coarse fallback when a group lacks meta.bbsCategory (pre-BBS-categories
// generators). New generators stamp a finer category that supersedes this.
function _fallbackBbsCategory(elementType) {
  switch (elementType) {
    case ELEMENT_TYPE.COLUMN:    return 'COLUMN'
    case ELEMENT_TYPE.BEAM:      return 'BEAM'
    case ELEMENT_TYPE.FOOTING:   return 'FOOTING'
    case ELEMENT_TYPE.SLAB:      return 'SLAB'
    case ELEMENT_TYPE.SUNSHADE:  return 'SUNSHADE'
    case ELEMENT_TYPE.LOFT:      return 'LOFT'
    case ELEMENT_TYPE.STAIRCASE: return 'STAIRCASE'
    default:                     return 'OTHER'
  }
}

function _emptyOutput() {
  return {
    groups: [],
    byElement: {
      [ELEMENT_TYPE.COLUMN]: {}, [ELEMENT_TYPE.BEAM]: {},
      [ELEMENT_TYPE.FOOTING]: {}, [ELEMENT_TYPE.SLAB]: {},
    },
    totals: { totalWeightKg: 0, byCategory: { column: 0, beam: 0, footing: 0, slab: 0 }, byDiameter: {}, byBbsCategory: {} },
    standardBarLengthM: effectiveStockBarLength(null),
    paramsVersion: CATALOG_VERSION,
  }
}

// True if the column spans the given floor (baseFloorId ≤ floorId ≤ topFloorId
// in the floor sequence ordering).
function _columnSpansFloor(state, column, floorId) {
  const floors = state?.projectSettings?.floors ?? []
  const seqOf = new Map(floors.map(f => [f.id, f.sequence ?? 0]))
  const base = seqOf.get(column.baseFloorId ?? column.floorId ?? floorId)
  const top  = seqOf.get(column.topFloorId  ?? column.floorId ?? floorId)
  const here = seqOf.get(floorId)
  if (base == null || top == null || here == null) return column.floorId === floorId
  return here >= base && here <= top
}

export { ELEMENT_TYPE, REBAR_ROLE } from './types.js'
