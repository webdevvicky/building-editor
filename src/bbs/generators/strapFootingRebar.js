// Strap (eccentric / cantilever) footing rebar — IS 456 + IS 2502.
//
// 2026-05-29 (BBS-categories phase). Pure helper imported by footingRebar.js
// for foundation.type === 'STRAP'. Two isolated pads joined by a strap beam.
// The strap beam is hogging-dominated, so TOP is the primary steel.
//
// geometry: {
//   padA: { lengthFt, widthFt },   // exterior / boundary pad
//   padB: { lengthFt, widthFt },   // interior balancing pad
//   strap: { widthIn, depthIn, lengthFt },  // c/c of pads
// }
// spec (STRAP): {
//   pad:   { barDiaMm, barSpacingIn },
//   strap: { topBars:{count,diaMm}, bottomBars:{count,diaMm},
//            sideBars:{count,diaMm}, stirrupBarDiaMm, stirrupSpacingIn },
//   coverMm, padCoverMm,
// }

import { resolveStrapReinforcementSpec } from '../../specs/resolution.js'
import {
  computeStraightBarCuttingLengthMm,
  computeStirrupCuttingLengthMm,
  developmentLengthMm,
  ftToMm,
  inToMm,
} from '../../specs/cuttingLength.js'
import {
  ELEMENT_TYPE, REBAR_ROLE, SHAPE_CODE, BBS_CATEGORY,
  getBarMarkPrefix, makeRebarGroup,
} from '../types.js'

export function buildStrapFootingGroups(state, params, foundation) {
  if (!state || !params || !foundation) return []
  const resolved = resolveStrapReinforcementSpec(state, foundation)
  if (!resolved.spec) return []
  const spec = resolved.spec

  const geom = foundation.geometry || {}
  const padA = geom.padA || {}
  const padB = geom.padB || {}
  const strap = geom.strap || {}
  const steelGrade = params.defaultSteelGrade
  const prefix = getBarMarkPrefix(BBS_CATEGORY.STRAP_FOOTING)
  const idSlice = String(foundation.id ?? '').slice(0, 4)
  const baseLabel = (typeof foundation.label === 'string' && foundation.label.trim())
    ? foundation.label.replace(/\s+/g, '') : `${prefix}-${idSlice}`
  const floorId = foundation.floorId ?? null
  const elementId = foundation.id
  const catMeta = { bbsCategory: BBS_CATEGORY.STRAP_FOOTING, parentMark: baseLabel }

  const groups = []

  // ── Pad bottom mesh (both pads, X + Y). ─────────────────────────────────────
  const padDia = spec.pad?.barDiaMm ?? 10
  const padSpacingIn = spec.pad?.barSpacingIn ?? 5
  const padLd = developmentLengthMm({ diaMm: padDia, gradeKey: params.defaultGradeKey, params })
  const addPad = (pad, tag) => {
    const lFt = pad.lengthFt ?? 0, wFt = pad.widthFt ?? 0
    if (lFt <= 0 || wFt <= 0) return
    const lMm = ftToMm(lFt), wMm = ftToMm(wFt)
    // X bars span width, laid across length; Y bars span length, laid across width.
    const xCut = computeStraightBarCuttingLengthMm({ lengthMm: wMm + 2 * padLd, diaMm: padDia, hookEndCount: 0, params })
    const yCut = computeStraightBarCuttingLengthMm({ lengthMm: lMm + 2 * padLd, diaMm: padDia, hookEndCount: 0, params })
    const nX = Math.floor((lFt * 12) / padSpacingIn) + 1
    const nY = Math.floor((wFt * 12) / padSpacingIn) + 1
    groups.push(makeRebarGroup({
      markId: `${baseLabel}-${tag}X`, elementType: ELEMENT_TYPE.FOOTING, elementId, floorId,
      role: REBAR_ROLE.X_MESH, diaMm: padDia, shapeCode: SHAPE_CODE.STRAIGHT, bendAnglesDeg: [],
      nominalDimensions: { A: Math.round(wMm), B: Math.round(padLd) }, cuttingLengthMm: xCut, count: nX,
      specId: resolved.specId, specSource: resolved.source, steelGrade,
      meta: { ...catMeta, description: `Strap ${tag} pad X mesh` },
    }))
    groups.push(makeRebarGroup({
      markId: `${baseLabel}-${tag}Y`, elementType: ELEMENT_TYPE.FOOTING, elementId, floorId,
      role: REBAR_ROLE.Y_MESH, diaMm: padDia, shapeCode: SHAPE_CODE.STRAIGHT, bendAnglesDeg: [],
      nominalDimensions: { A: Math.round(lMm), B: Math.round(padLd) }, cuttingLengthMm: yCut, count: nY,
      specId: resolved.specId, specSource: resolved.source, steelGrade,
      meta: { ...catMeta, description: `Strap ${tag} pad Y mesh` },
    }))
  }
  addPad(padA, 'A')
  addPad(padB, 'B')

  // ── Strap beam (top primary + bottom + side + stirrups). ────────────────────
  const sLenFt = strap.lengthFt ?? 0
  const sWidthIn = strap.widthIn ?? 0
  const sDepthIn = strap.depthIn ?? 0
  if (sLenFt > 0 && sWidthIn > 0 && sDepthIn > 0) {
    const sLenMm = ftToMm(sLenFt)
    const sb = spec.strap ?? {}
    const anchorFactor = params.strapBeamAnchorageFactor ?? 1.0
    const flexBar = (bars, role, tag, desc) => {
      if (!bars || (bars.count ?? 0) <= 0) return
      const dia = bars.diaMm
      const anchor = anchorFactor * developmentLengthMm({ diaMm: dia, gradeKey: params.defaultGradeKey, params })
      const cut = computeStraightBarCuttingLengthMm({ lengthMm: sLenMm + 2 * anchor, diaMm: dia, hookEndCount: 0, params })
      groups.push(makeRebarGroup({
        markId: `${baseLabel}-${tag}`, elementType: ELEMENT_TYPE.FOOTING, elementId, floorId,
        role, diaMm: dia, shapeCode: SHAPE_CODE.STRAIGHT, bendAnglesDeg: [],
        nominalDimensions: { A: Math.round(sLenMm), B: Math.round(anchor) }, cuttingLengthMm: cut, count: bars.count,
        specId: resolved.specId, specSource: resolved.source, steelGrade,
        meta: { ...catMeta, description: desc },
      }))
    }
    flexBar(sb.topBars,    REBAR_ROLE.TOP,    'ST', 'Strap beam top bars (primary, hogging)')
    flexBar(sb.bottomBars, REBAR_ROLE.BOTTOM, 'SB', 'Strap beam bottom bars')
    flexBar(sb.sideBars,   REBAR_ROLE.MID,    'SM', 'Strap beam side / mid bars')

    const stDia = sb.stirrupBarDiaMm
    const stSpacingIn = sb.stirrupSpacingIn
    if (stDia > 0 && stSpacingIn > 0) {
      const coverIn = (spec.coverMm ?? 30) / 25.4
      const netW = inToMm(Math.max(0, sWidthIn - 2 * coverIn))
      const netD = inToMm(Math.max(0, sDepthIn - 2 * coverIn))
      const stCut = computeStirrupCuttingLengthMm({ netWidthMm: netW, netDepthMm: netD, diaMm: stDia, params })
      const nSt = Math.floor((sLenFt * 12) / stSpacingIn) + 1
      groups.push(makeRebarGroup({
        markId: `${baseLabel}-SS`, elementType: ELEMENT_TYPE.FOOTING, elementId, floorId,
        role: REBAR_ROLE.STIRRUP, diaMm: stDia, shapeCode: SHAPE_CODE.CLOSED_STIRRUP,
        bendAnglesDeg: [90, 90, 90, 90], nominalDimensions: { A: Math.round(netW), B: Math.round(netD) },
        cuttingLengthMm: stCut, count: nSt,
        specId: resolved.specId, specSource: resolved.source, steelGrade,
        meta: { ...catMeta, description: 'Strap beam stirrups', spacingIn: stSpacingIn },
      }))
    }
  }

  return groups
}
