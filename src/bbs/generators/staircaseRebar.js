// Staircase rebar generator — dog-legged waist slab. IS 456 Cl 33 + SP 34.
//
// 2026-05-29 (BBS-categories phase). Pure function. ESTIMATE-grade per the
// research note: the reference workbook scheduled the staircase at 0 kg, so the
// only seatbelt is the ~65-90 kg worked-example band for a one-storey flight.
//
// Geometry from the staircase entity (per flight):
//   goingFt        = stepsPerFlight × treadIn / 12
//   riseFt         = stepsPerFlight × riserIn / 12
//   inclinedWaist  = hypot(going, rise)            ← the load-bearing span
// Emits WAIST main (cranked multi-bend, anchored Ld into both landings) + DIST
// per flight, plus LANDING slab main + dist (one shared mid-landing). Counts
// once at project level (spans floors) — never per floor. Emits only when a
// staircase spec resolves; default → no groups, zero BBS impact.

import { resolveStaircaseReinforcementSpec } from '../../specs/resolution.js'
import {
  computeStraightBarCuttingLengthMm,
  developmentLengthMm,
  ftToMm,
} from '../../specs/cuttingLength.js'
import {
  ELEMENT_TYPE, REBAR_ROLE, SHAPE_CODE, BBS_CATEGORY,
  getBarMarkPrefix, makeRebarGroup,
} from '../types.js'

export function generateStaircaseRebarGroups(ctx, staircase) {
  if (!ctx || !staircase) return []
  const { state, params } = ctx
  if (!state || !params) return []

  const resolved = resolveStaircaseReinforcementSpec(state, staircase)
  if (!resolved.spec) return []
  const spec = resolved.spec

  const stepsPerFlight = staircase.stepsPerFlight ?? 0
  const flightCount    = staircase.flightCount ?? 2
  const treadIn        = staircase.treadIn ?? 0
  const riserIn        = staircase.riserIn ?? 0
  const flightWidthFt  = staircase.flightWidthFt ?? 0
  if (stepsPerFlight <= 0 || treadIn <= 0 || riserIn <= 0 || flightWidthFt <= 0) return []

  const goingFt = (stepsPerFlight * treadIn) / 12
  const riseFt  = (stepsPerFlight * riserIn) / 12
  const inclinedWaistFt = Math.hypot(goingFt, riseFt)
  if (inclinedWaistFt <= 0) return []

  const waistMainDia = spec.waistMainBarDiaMm
  const distDia      = spec.distBarDiaMm
  const steelGrade   = params.defaultSteelGrade
  const prefix       = getBarMarkPrefix(BBS_CATEGORY.STAIRCASE)
  const idSlice      = String(staircase.id ?? '').slice(0, 4)
  const label        = `${prefix}-${idSlice}`
  const floorId      = staircase.floorId ?? null
  const elementId    = staircase.id
  const catMeta      = { bbsCategory: BBS_CATEGORY.STAIRCASE, parentMark: label, staircaseId: staircase.id }

  const inclinedWaistMm = ftToMm(inclinedWaistFt)
  const flightWidthMm   = ftToMm(flightWidthFt)
  const anchorMm = (params.staircaseLandingAnchorageFactor ?? 1.0) *
    developmentLengthMm({ diaMm: waistMainDia, gradeKey: params.defaultGradeKey, params })

  const groups = []

  // ── WAIST main bars (per flight, ×flightCount). Anchored into both landings.
  const nWaist = (Math.floor((flightWidthFt * 12) / spec.waistMainSpacingIn) + 1) * flightCount
  const waistLenMm = inclinedWaistMm + 2 * anchorMm
  const waistCutMm = computeStraightBarCuttingLengthMm({ lengthMm: waistLenMm, diaMm: waistMainDia, hookEndCount: 0, params })
  if (nWaist > 0) {
    groups.push(makeRebarGroup({
      markId: `${label}-W`, elementType: ELEMENT_TYPE.STAIRCASE, elementId, floorId,
      role: REBAR_ROLE.WAIST, diaMm: waistMainDia, shapeCode: SHAPE_CODE.TWO_BEND,
      bendAnglesDeg: [], nominalDimensions: { A: Math.round(inclinedWaistMm), B: Math.round(anchorMm) },
      cuttingLengthMm: waistCutMm, count: nWaist,
      specId: resolved.specId, specSource: resolved.source, steelGrade,
      meta: { ...catMeta, description: 'Staircase waist main bars (cranked, anchored into landings)',
        inclinedWaistFt, goingFt, riseFt, flightCount, spacingIn: spec.waistMainSpacingIn },
    }))
  }

  // ── WAIST distribution bars (per flight, ×flightCount).
  const nWaistDist = (Math.floor((inclinedWaistFt * 12) / spec.distBarSpacingIn) + 1) * flightCount
  const waistDistCutMm = computeStraightBarCuttingLengthMm({ lengthMm: flightWidthMm, diaMm: distDia, hookEndCount: 0, params })
  if (nWaistDist > 0) {
    groups.push(makeRebarGroup({
      markId: `${label}-D`, elementType: ELEMENT_TYPE.STAIRCASE, elementId, floorId,
      role: REBAR_ROLE.DIST, diaMm: distDia, shapeCode: SHAPE_CODE.STRAIGHT,
      bendAnglesDeg: [], nominalDimensions: { A: Math.round(flightWidthMm) },
      cuttingLengthMm: waistDistCutMm, count: nWaistDist,
      specId: resolved.specId, specSource: resolved.source, steelGrade,
      meta: { ...catMeta, description: 'Staircase waist distribution bars', spacingIn: spec.distBarSpacingIn },
    }))
  }

  // ── LANDING slab (one shared mid-landing). Main spans the short direction.
  const landW = staircase.landingFtWidth ?? 0
  const landL = staircase.landingFtLength ?? 0
  if (landW > 0 && landL > 0) {
    const spanFt = Math.min(landW, landL)
    const widFt  = Math.max(landW, landL)
    const landMainLenMm = ftToMm(spanFt) + 2 * anchorMm
    const landMainCutMm = computeStraightBarCuttingLengthMm({ lengthMm: landMainLenMm, diaMm: waistMainDia, hookEndCount: 0, params })
    const nLandMain = Math.floor((widFt * 12) / spec.waistMainSpacingIn) + 1
    if (nLandMain > 0) {
      groups.push(makeRebarGroup({
        markId: `${label}-LM`, elementType: ELEMENT_TYPE.STAIRCASE, elementId, floorId,
        role: REBAR_ROLE.LANDING, diaMm: waistMainDia, shapeCode: SHAPE_CODE.STRAIGHT,
        bendAnglesDeg: [], nominalDimensions: { A: Math.round(ftToMm(spanFt)), B: Math.round(anchorMm) },
        cuttingLengthMm: landMainCutMm, count: nLandMain,
        specId: resolved.specId, specSource: resolved.source, steelGrade,
        meta: { ...catMeta, description: 'Landing slab main bars', spacingIn: spec.waistMainSpacingIn },
      }))
    }
    const landDistCutMm = computeStraightBarCuttingLengthMm({ lengthMm: ftToMm(widFt), diaMm: distDia, hookEndCount: 0, params })
    const nLandDist = Math.floor((spanFt * 12) / spec.distBarSpacingIn) + 1
    if (nLandDist > 0) {
      groups.push(makeRebarGroup({
        markId: `${label}-LD`, elementType: ELEMENT_TYPE.STAIRCASE, elementId, floorId,
        role: REBAR_ROLE.LANDING, diaMm: distDia, shapeCode: SHAPE_CODE.STRAIGHT,
        bendAnglesDeg: [], nominalDimensions: { A: Math.round(ftToMm(widFt)) },
        cuttingLengthMm: landDistCutMm, count: nLandDist,
        specId: resolved.specId, specSource: resolved.source, steelGrade,
        meta: { ...catMeta, description: 'Landing slab distribution bars', spacingIn: spec.distBarSpacingIn },
      }))
    }
  }

  return groups
}
