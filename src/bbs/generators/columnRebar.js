// Column rebar group generator.
//
// 2026-05-28. Pure function — given a column entity + IS 2502 params,
// returns the RebarGroup[] for that column:
//   • LONGITUDINAL — one straight bar per longitudinal slot, each with
//     one full lap added (per IS 456 / IS 13920 lap rule from the
//     catalog). Count = spec.longitudinalBarCount.
//   • STIRRUP — closed rectangular (or circular tie) at spec.stirrupSpacingIn.
//     When params.confinementZoneEnabled === true (IS 13920 Cl 7.4) the
//     stirrup count is SPLIT into a close-spaced STIRRUP_ZONE group
//     covering 2 × lo at zone spacing + a uniform STIRRUP group covering
//     the mid (height - 2 × lo) at the normal spacing.
//
// Backward-compat invariant: sum of totalWeightKg across the emitted
// groups must equal computeColumnBBS(spec, heightFt, ct).totalKg within
// ±2% rounding tolerance. The mid+zone split preserves total bar count
// (and therefore total weight) modulo the integer ceil rounding at each
// zone boundary.

import { resolveColumnReinforcementSpecForColumn } from '../../specs/resolution.js'
import {
  computeStraightBarCuttingLengthMm,
  computeStirrupCuttingLengthMm,
  computeCuttingLengthMm,
  lapLengthMm,
  ftToMm,
  inToMm,
  MM_PER_IN,
} from '../../specs/cuttingLength.js'
import { ELEMENT_TYPE, REBAR_ROLE, SHAPE_CODE, makeRebarGroup } from '../types.js'

// Stable mark prefix for a column: '<ctLabelNoWs>-<colIdSlice>'. The colIdSlice
// disambiguates multiple columns of the same type so e.g. 'C1-abcd-L' and
// 'C1-efgh-L' never collide in the schedule table.
function columnLabelFor(ct, column) {
  const ctLabel = String(ct.label ?? ct.id ?? 'C').replace(/\s+/g, '')
  const idSlice = String(column.id ?? '').slice(0, 4)
  return idSlice ? `${ctLabel}-${idSlice}` : ctLabel
}

export function generateColumnRebarGroups(ctx, column) {
  const { state, params } = ctx
  if (!column || !state || !params) return []

  const columnTypes = state.projectSettings?.columnTypes ?? []
  const ct = columnTypes.find(t => t.id === column.columnTypeId)
  if (!ct) return []

  const resolved = resolveColumnReinforcementSpecForColumn(state, column, ct)
  if (!resolved.spec) return []   // ESTIMATE — kg/m³ pool handles it

  const spec       = resolved.spec
  const specId     = resolved.specId
  const specSource = resolved.source

  const heightFt = state.getColumnHeightFt?.(column) ?? 0
  if (heightFt <= 0) return []
  const heightMm = ftToMm(heightFt)

  const floorId  = column.baseFloorId ?? column.floorId ?? null
  const columnLabel = columnLabelFor(ct, column)
  const steelGrade  = params.defaultSteelGrade

  const groups = []

  // ── Group 1 — LONGITUDINAL ────────────────────────────────────────────────
  // One straight bar per longitudinal slot. Each carries one full lap
  // (matches the existing computeColumnBBS lap accounting — one lap per
  // bar over the column height).
  const longDia = spec.longitudinalBarDiaMm
  const lapMm   = lapLengthMm({ diaMm: longDia, lapKey: params.defaultLapKey, params })
  const longLengthMm = heightMm + lapMm
  const longCuttingLengthMm = computeStraightBarCuttingLengthMm({
    lengthMm:     longLengthMm,
    diaMm:        longDia,
    hookEndCount: 0,
    params,
  })
  groups.push(makeRebarGroup({
    markId:           `${columnLabel}-L`,
    elementType:      ELEMENT_TYPE.COLUMN,
    elementId:        column.id,
    floorId,
    role:             REBAR_ROLE.LONGITUDINAL,
    diaMm:            longDia,
    shapeCode:        SHAPE_CODE.STRAIGHT,
    bendAnglesDeg:    [],
    nominalDimensions:{ A: longLengthMm },
    cuttingLengthMm:  longCuttingLengthMm,
    count:            spec.longitudinalBarCount,
    specId,
    specSource,
    steelGrade,
    meta: {
      description:    'Column longitudinal bars (one full lap per bar)',
      lapLengthMm:    Math.round(lapMm),
      columnHeightFt: heightFt,
      parentMark:     columnLabel,
    },
  }))

  // ── Stirrup geometry — shared between mid + zone groups ───────────────────
  const stirrupDia    = spec.stirrupBarDiaMm
  const coverIn       = spec.coverMm / MM_PER_IN
  const isRect        = ct.shape === 'rect'
  const isCircle      = ct.shape === 'circle'

  let stirrupCuttingLengthMm = 0
  let stirrupNominal          = {}
  let stirrupShapeCode        = SHAPE_CODE.CLOSED_STIRRUP
  let stirrupBendAngles       = [90, 90, 90, 90]

  if (isRect) {
    const netWidthMm = inToMm(Math.max(0, ct.widthIn - 2 * coverIn))
    const netDepthMm = inToMm(Math.max(0, ct.depthIn - 2 * coverIn))
    stirrupCuttingLengthMm = computeStirrupCuttingLengthMm({
      netWidthMm, netDepthMm, diaMm: stirrupDia, params,
    })
    stirrupNominal = { A: netWidthMm, B: netDepthMm }
  } else if (isCircle) {
    const netDiaIn       = Math.max(0, ct.diamIn - 2 * coverIn)
    const circumferenceMm = Math.PI * inToMm(netDiaIn)
    stirrupCuttingLengthMm = computeCuttingLengthMm({
      straightSegmentsMm: [circumferenceMm],
      bendAnglesDeg:      [],
      diaMm:              stirrupDia,
      hookEndCount:       2,
      params,
    })
    stirrupNominal       = { A: circumferenceMm }
    stirrupBendAngles    = []
  } else {
    // Unknown shape — graceful degradation. Skip stirrup emission entirely;
    // the longitudinal group still ships.
    return groups
  }

  // ── Confinement-zone (IS 13920 Cl 7.4) split ──────────────────────────────
  const stirrupSpacingMm = inToMm(spec.stirrupSpacingIn)

  if (params.confinementZoneEnabled === true && stirrupSpacingMm > 0) {
    // lo = max(largest section dim, height / divisor, columnConfinementLengthMinMm)
    const sectionMaxMm = isRect
      ? Math.max(inToMm(ct.widthIn), inToMm(ct.depthIn))
      : inToMm(ct.diamIn ?? 0)
    const lo = Math.max(
      sectionMaxMm,
      heightMm / (params.columnConfinementHeightDivisor || 6),
      params.columnConfinementLengthMinMm || 450,
    )
    // Zone spacing = min(d/4, 6 × longDia, columnConfinementMaxSpacingMm)
    const sectionMinMm = isRect
      ? Math.min(inToMm(ct.widthIn), inToMm(ct.depthIn))
      : inToMm(ct.diamIn ?? 0)
    const zoneSpacingMm = Math.max(1, Math.min(
      (params.columnConfinementDFactor || 0.25) * sectionMinMm,
      (params.columnConfinementBarFactor || 6) * longDia,
      params.columnConfinementMaxSpacingMm || 100,
    ))

    const midLenMm = Math.max(0, heightMm - 2 * lo)
    const zoneCount = 2 * Math.ceil(lo / zoneSpacingMm)
    const midCount  = midLenMm > 0 ? Math.ceil(midLenMm / stirrupSpacingMm) : 0

    if (zoneCount > 0) {
      groups.push(makeRebarGroup({
        markId:           `${columnLabel}-S-Z`,
        elementType:      ELEMENT_TYPE.COLUMN,
        elementId:        column.id,
        floorId,
        role:             REBAR_ROLE.STIRRUP_ZONE,
        diaMm:            stirrupDia,
        shapeCode:        stirrupShapeCode,
        bendAnglesDeg:    stirrupBendAngles,
        nominalDimensions: stirrupNominal,
        cuttingLengthMm:  stirrupCuttingLengthMm,
        count:            zoneCount,
        specId,
        specSource,
        steelGrade,
        meta: {
          description: 'Column stirrups, confinement zone (IS 13920 Cl 7.4)',
          spacingMm:   Math.round(zoneSpacingMm),
          zone:        'CONFINEMENT',
          parentMark:  columnLabel,
          loMm:        Math.round(lo),
        },
      }))
    }

    if (midCount > 0) {
      groups.push(makeRebarGroup({
        markId:           `${columnLabel}-S`,
        elementType:      ELEMENT_TYPE.COLUMN,
        elementId:        column.id,
        floorId,
        role:             REBAR_ROLE.STIRRUP,
        diaMm:            stirrupDia,
        shapeCode:        stirrupShapeCode,
        bendAnglesDeg:    stirrupBendAngles,
        nominalDimensions: stirrupNominal,
        cuttingLengthMm:  stirrupCuttingLengthMm,
        count:            midCount,
        specId,
        specSource,
        steelGrade,
        meta: {
          description: 'Column stirrups, uniform spacing',
          spacingIn:   spec.stirrupSpacingIn,
          zone:        'MID',
          parentMark:  columnLabel,
        },
      }))
    }
  } else {
    // No confinement zone — single uniform stirrup group over the full height.
    const totalCount = stirrupSpacingMm > 0
      ? Math.ceil(heightMm / stirrupSpacingMm)
      : 0
    if (totalCount > 0) {
      groups.push(makeRebarGroup({
        markId:           `${columnLabel}-S`,
        elementType:      ELEMENT_TYPE.COLUMN,
        elementId:        column.id,
        floorId,
        role:             REBAR_ROLE.STIRRUP,
        diaMm:            stirrupDia,
        shapeCode:        stirrupShapeCode,
        bendAnglesDeg:    stirrupBendAngles,
        nominalDimensions: stirrupNominal,
        cuttingLengthMm:  stirrupCuttingLengthMm,
        count:            totalCount,
        specId,
        specSource,
        steelGrade,
        meta: {
          description: 'Column stirrups, uniform spacing',
          spacingIn:   spec.stirrupSpacingIn,
          zone:        'MID',
          parentMark:  columnLabel,
        },
      }))
    }
  }

  return groups
}
