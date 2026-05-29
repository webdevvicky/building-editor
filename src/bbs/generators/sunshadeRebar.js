// Sunshade / chajja rebar generator — IS 456 cantilever + IS 2502.
//
// 2026-05-29 (BBS-categories phase). Pure function. A sunshade is a cantilever
// slab projecting from the lintel above a window opening. It carries TOP steel
// only (cantilever tension is on the top face). Geometry is DERIVED from the
// opening (no entity of its own):
//   • main (top) cantilever bars — anchored INTO the lintel by a development
//     length, run the projection, and turn down at the free edge. Shape L-bar.
//   • distribution bars — straight, run along the opening width.
//
// Emits only when the opening has hasSunshade === true AND a sunshade spec
// resolves (bbsDefaults.SUNSHADE or opening.sunshadeSpecId). Default → no
// groups, zero BBS impact.

import { resolveSunshadeReinforcementSpec } from '../../specs/resolution.js'
import {
  computeLBarCuttingLengthMm,
  computeStraightBarCuttingLengthMm,
  developmentLengthMm,
  ftToMm,
  inToMm,
} from '../../specs/cuttingLength.js'
import {
  ELEMENT_TYPE, REBAR_ROLE, SHAPE_CODE, BBS_CATEGORY,
  getBarMarkPrefix, makeRebarGroup,
} from '../types.js'

// descriptor: { wall, opening }
export function generateSunshadeRebarGroups(ctx, descriptor) {
  if (!ctx || !descriptor) return []
  const { state, params } = ctx
  const { wall, opening } = descriptor
  if (!state || !params || !wall || !opening) return []
  // Sunshades sit over window openings (matches getSunshadeQuantities).
  if (opening.type !== 'window' || !opening.hasSunshade) return []

  const resolved = resolveSunshadeReinforcementSpec(state, opening)
  if (!resolved.spec) return []   // ESTIMATE — no rebar groups
  const spec = resolved.spec

  const ss = state.projectSettings?.sunshadeSettings ?? {}
  const projectionFt = ss.projectionFt ?? 1.5
  const thicknessIn  = ss.thicknessIn ?? 3
  const widthIn = opening.width
  if (projectionFt <= 0 || widthIn <= 0) return []

  const widthMm      = inToMm(widthIn)
  const projectionMm = ftToMm(projectionFt)
  const thicknessMm  = inToMm(thicknessIn)
  const steelGrade   = params.defaultSteelGrade
  const prefix       = getBarMarkPrefix(BBS_CATEGORY.SUNSHADE)
  const idSlice      = String(opening.id ?? '').slice(0, 4)
  const label        = `${prefix}-${idSlice}`
  const elementId    = `${wall.id}::${opening.id}`
  const floorId      = wall.floorId ?? null
  const catMeta      = { bbsCategory: BBS_CATEGORY.SUNSHADE, parentMark: label, openingId: opening.id, wallId: wall.id }

  const groups = []

  // ── MAIN — top cantilever bars (L-bar: anchorage into lintel + projection,
  //          then a down-turn at the free edge). ──────────────────────────────
  const mainDia = spec.mainBarDiaMm
  const anchorMm = (params.sunshadeAnchorageIntoLintelFactor ?? 1.0) *
    developmentLengthMm({ diaMm: mainDia, gradeKey: params.defaultGradeKey, params })
  const edgeTurnMm = (params.sunshadeEdgeTurnFactor ?? 1.0) * thicknessMm
  const legAmm = anchorMm + projectionMm           // horizontal: into lintel + out over chajja
  const legBmm = edgeTurnMm                         // vertical down-turn at free edge
  const mainCutMm = computeLBarCuttingLengthMm({ legAmm, legBmm, diaMm: mainDia, params })
  const nMain = Math.floor(widthIn / spec.mainBarSpacingIn) + 1
  if (nMain > 0) {
    groups.push(makeRebarGroup({
      markId: `${label}-M`, elementType: ELEMENT_TYPE.SUNSHADE, elementId, floorId,
      role: REBAR_ROLE.MAIN, diaMm: mainDia, shapeCode: SHAPE_CODE.L_BAR,
      bendAnglesDeg: [90], nominalDimensions: { A: Math.round(legAmm), B: Math.round(legBmm) },
      cuttingLengthMm: mainCutMm, count: nMain,
      specId: resolved.specId, specSource: resolved.source, steelGrade,
      meta: { ...catMeta, description: 'Sunshade top cantilever bars (anchored into lintel)',
        anchorageMm: Math.round(anchorMm), projectionFt, spacingIn: spec.mainBarSpacingIn },
    }))
  }

  // ── DIST — straight distribution bars along the width. ──────────────────────
  const distDia = spec.distBarDiaMm
  const distCutMm = computeStraightBarCuttingLengthMm({ lengthMm: widthMm, diaMm: distDia, hookEndCount: 0, params })
  const nDist = Math.floor((projectionFt * 12) / spec.distBarSpacingIn) + 1
  if (nDist > 0) {
    groups.push(makeRebarGroup({
      markId: `${label}-D`, elementType: ELEMENT_TYPE.SUNSHADE, elementId, floorId,
      role: REBAR_ROLE.DIST, diaMm: distDia, shapeCode: SHAPE_CODE.STRAIGHT,
      bendAnglesDeg: [], nominalDimensions: { A: Math.round(widthMm) },
      cuttingLengthMm: distCutMm, count: nDist,
      specId: resolved.specId, specSource: resolved.source, steelGrade,
      meta: { ...catMeta, description: 'Sunshade distribution bars', spacingIn: spec.distBarSpacingIn },
    }))
  }

  return groups
}
