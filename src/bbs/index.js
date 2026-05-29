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
import { getIs2502Params } from '../specs/cuttingLength.js'
import { ELEMENT_TYPE, REBAR_ROLE } from './types.js'

// Site-order for elements within a floor — matches construction sequence.
const ELEMENT_ORDER = Object.freeze({
  [ELEMENT_TYPE.FOOTING]: 0,
  [ELEMENT_TYPE.COLUMN]:  1,
  [ELEMENT_TYPE.BEAM]:    2,
  [ELEMENT_TYPE.SLAB]:    3,
})

// Role-order for bars within an element — schedule convention.
const ROLE_ORDER = Object.freeze({
  [REBAR_ROLE.MAIN]:         0,
  [REBAR_ROLE.X_MESH]:       1,
  [REBAR_ROLE.Y_MESH]:       2,
  [REBAR_ROLE.LONGITUDINAL]: 3,
  [REBAR_ROLE.TOP]:          4,
  [REBAR_ROLE.BOTTOM]:       5,
  [REBAR_ROLE.CRANK]:        6,
  [REBAR_ROLE.EXTRA_TOP]:    7,
  [REBAR_ROLE.DIST]:         8,
  [REBAR_ROLE.DOWEL]:        9,
  [REBAR_ROLE.STIRRUP]:      10,
  [REBAR_ROLE.STIRRUP_ZONE]: 11,
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
  // Inline auto-isolated buckets (columns with no foundation attached).
  // We use the existing aggregator's inline summary to know which buckets exist.
  const fdnQ = state.getFoundationQuantities?.()
  if (fdnQ?.byColumnTypeInline) {
    for (const [ctId, inline] of Object.entries(fdnQ.byColumnTypeInline)) {
      const inlineFloorId = _inlineFootingFloorIdForType(state, ctId, ctx.floorIdFilter)
      if (ctx.floorIdFilter && inlineFloorId !== ctx.floorIdFilter) continue
      const groups = generateFootingRebarGroups(ctx, {
        kind: 'INLINE_BUCKET',
        columnTypeId: ctId,
        inline,
        floorId: inlineFloorId,
      })
      if (groups && groups.length) all.push(...groups)
    }
  }

  // ── Beams ──────────────────────────────────────────────────────────────
  const allBeams = state.getAllBeams?.() ?? Object.values(state.beams ?? {})
  for (const beam of allBeams) {
    if (ctx.floorIdFilter && beam.floorId !== ctx.floorIdFilter) {
      const wall = state.walls?.[beam.sourceWallId]
      if (!wall || wall.floorId !== ctx.floorIdFilter) continue
    }
    const groups = generateBeamRebarGroups(ctx, beam)
    if (groups && groups.length) all.push(...groups)
  }

  // ── Slabs ──────────────────────────────────────────────────────────────
  for (const slab of Object.values(state.slabs ?? {})) {
    if (ctx.floorIdFilter && slab.floorId !== ctx.floorIdFilter) continue
    const groups = generateSlabRebarGroups(ctx, slab)
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
  }

  const standardBarLengthM = state?.projectSettings?.bbsDefaults?.standardBarLengthM ?? params.standardBarLengthM
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
    },
    standardBarLengthM,
    paramsVersion: params?.__version ?? null,
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

function _emptyOutput() {
  return {
    groups: [],
    byElement: {
      [ELEMENT_TYPE.COLUMN]: {}, [ELEMENT_TYPE.BEAM]: {},
      [ELEMENT_TYPE.FOOTING]: {}, [ELEMENT_TYPE.SLAB]: {},
    },
    totals: { totalWeightKg: 0, byCategory: { column: 0, beam: 0, footing: 0, slab: 0 }, byDiameter: {} },
    standardBarLengthM: 12,
    paramsVersion: null,
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

// For an inline-footing bucket keyed by columnTypeId, find any one column on
// the requested floor that owns this type. Used to assign a floorId to the
// inline RebarGroups (they don't carry one natively — the bucket is per-type).
function _inlineFootingFloorIdForType(state, columnTypeId, floorIdFilter) {
  for (const col of Object.values(state.columns ?? {})) {
    if (col.columnTypeId !== columnTypeId) continue
    const base = col.baseFloorId ?? col.floorId
    if (!floorIdFilter || base === floorIdFilter) return base
  }
  // Default: the lowest-sequence floor.
  const floors = state?.projectSettings?.floors ?? []
  if (!floors.length) return null
  const sorted = floors.slice().sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
  return sorted[0]?.id ?? null
}

export { ELEMENT_TYPE, REBAR_ROLE } from './types.js'
