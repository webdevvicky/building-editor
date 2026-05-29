// Loft rebar generator — RCC storage shelf cast into a wall. IS 456 + IS 2502.
//
// 2026-05-29 (BBS-categories phase). Pure function. A loft is a shallow slab
// spanning a wall niche (kitchen / wardrobe / study). Geometry is DERIVED from
// the wall's loft attribute (no entity of its own):
//   wall.loft = { enabled, widthFt, depthFt, heightFt }
// Emits TOP + BOTTOM main mats (each embedded into the wall by a bearing
// length) + a distribution bar set. Emits only when wall.loft.enabled AND a
// loft spec resolves; default → no groups, zero BBS impact.

import { resolveLoftReinforcementSpec } from '../../specs/resolution.js'
import {
  computeLBarCuttingLengthMm,
  computeStraightBarCuttingLengthMm,
  developmentLengthMm,
  ftToMm,
} from '../../specs/cuttingLength.js'
import {
  ELEMENT_TYPE, REBAR_ROLE, SHAPE_CODE, BBS_CATEGORY,
  getBarMarkPrefix, makeRebarGroup,
} from '../types.js'

export function generateLoftRebarGroups(ctx, wall) {
  if (!ctx || !wall) return []
  const { state, params } = ctx
  if (!state || !params) return []
  const loft = wall.loft
  if (!loft || loft.enabled !== true) return []

  const widthFt = loft.widthFt ?? 0
  const depthFt = loft.depthFt ?? 0
  if (widthFt <= 0 || depthFt <= 0) return []

  const resolved = resolveLoftReinforcementSpec(state, wall)
  if (!resolved.spec) return []
  const spec = resolved.spec

  const widthMm = ftToMm(widthFt)
  const depthMm = ftToMm(depthFt)
  const steelGrade = params.defaultSteelGrade
  const prefix = getBarMarkPrefix(BBS_CATEGORY.LOFT)
  const idSlice = String(wall.id ?? '').slice(0, 4)
  const label = `${prefix}-${idSlice}`
  const elementId = `${wall.id}::loft`
  const floorId = wall.floorId ?? null
  const catMeta = { bbsCategory: BBS_CATEGORY.LOFT, parentMark: label, wallId: wall.id }

  const mainDia = spec.mainBarDiaMm
  const distDia = spec.distBarDiaMm
  const embedMm = Math.max(
    params.loftEmbedMinMm ?? 230,
    (params.loftEmbedFactor ?? 1.0) * developmentLengthMm({ diaMm: mainDia, gradeKey: params.defaultGradeKey, params }),
  )
  // Main bars run the depth (projection) + an embed leg bent into the wall.
  const mainCutMm = computeLBarCuttingLengthMm({ legAmm: depthMm, legBmm: embedMm, diaMm: mainDia, params })
  const nMain = Math.floor((widthFt * 12) / spec.mainBarSpacingIn) + 1
  // Distribution bars run the width.
  const distCutMm = computeStraightBarCuttingLengthMm({ lengthMm: widthMm, diaMm: distDia, hookEndCount: 0, params })
  const nDist = Math.floor((depthFt * 12) / spec.distBarSpacingIn) + 1

  const groups = []
  const pushMain = (roleKey, suffix, desc) => {
    if (nMain <= 0) return
    groups.push(makeRebarGroup({
      markId: `${label}-${suffix}`, elementType: ELEMENT_TYPE.LOFT, elementId, floorId,
      role: roleKey, diaMm: mainDia, shapeCode: SHAPE_CODE.L_BAR,
      bendAnglesDeg: [90], nominalDimensions: { A: Math.round(depthMm), B: Math.round(embedMm) },
      cuttingLengthMm: mainCutMm, count: nMain,
      specId: resolved.specId, specSource: resolved.source, steelGrade,
      meta: { ...catMeta, description: desc, embedMm: Math.round(embedMm), spacingIn: spec.mainBarSpacingIn },
    }))
  }
  pushMain(REBAR_ROLE.TOP,    'T', 'Loft top mat bars (embedded into wall)')
  pushMain(REBAR_ROLE.BOTTOM, 'B', 'Loft bottom mat bars (embedded into wall)')
  if (nDist > 0) {
    groups.push(makeRebarGroup({
      markId: `${label}-D`, elementType: ELEMENT_TYPE.LOFT, elementId, floorId,
      role: REBAR_ROLE.DIST, diaMm: distDia, shapeCode: SHAPE_CODE.STRAIGHT,
      bendAnglesDeg: [], nominalDimensions: { A: Math.round(widthMm) },
      cuttingLengthMm: distCutMm, count: nDist,
      specId: resolved.specId, specSource: resolved.source, steelGrade,
      meta: { ...catMeta, description: 'Loft distribution bars', spacingIn: spec.distBarSpacingIn },
    }))
  }
  return groups
}
