// Column rebar group generator.
//
// 2026-05-28 / 2026-05-29 (sub/super split). Pure function — given a column
// entity + IS 2502 params, returns the RebarGroup[] for that column:
//   • LONGITUDINAL — straight bars, each with one full lap. When the sub/super
//     split is enabled (params.subSuperColumnSplitEnabled) OR column.position
//     is forced, the longitudinal + stirrup bars are partitioned into a SUB
//     segment (footing-top → grade-beam level: dowel-lap) and a SUPER segment
//     (above grade beam: normal lap). ONE column.id, multiple RebarGroups —
//     never two column entities (Q4 rule).
//   • STIRRUP / STIRRUP_ZONE — closed rectangular (or circular tie). IS 13920
//     confinement split applies in the SUPER segment only.
//
// Backward-compat: when neither split nor a forced position is in play the
// emission is byte-identical to the pre-split generator (verify-bbs C/G), with
// an additive meta.bbsCategory = 'COLUMN' stamp.

import { resolveColumnReinforcementSpecForColumn, resolveColumnTypeForColumn } from '../../specs/resolution.js'
import { getColumnSpanFloorIds as topoGetColumnSpanFloorIds, getColumnLiftHeightFt as topoGetColumnLiftHeightFt } from '../../topology/columns.js'
import {
  computeStraightBarCuttingLengthMm,
  computeStirrupCuttingLengthMm,
  computeCuttingLengthMm,
  lapLengthMm,
  ftToMm,
  inToMm,
  MM_PER_IN,
} from '../../specs/cuttingLength.js'
import {
  ELEMENT_TYPE, REBAR_ROLE, SHAPE_CODE, BBS_CATEGORY,
  makeRebarGroup, bbsCategoryForColumnPosition, getBarMarkPrefix,
} from '../types.js'

function columnLabelFor(ct, column) {
  const ctLabel = String(ct.label ?? ct.id ?? 'C').replace(/\s+/g, '')
  const idSlice = String(column.id ?? '').slice(0, 4)
  return idSlice ? `${ctLabel}-${idSlice}` : ctLabel
}

// Stirrup geometry shared by standard + split paths.
// Returns { cuttingLengthMm, nominal, shapeCode, bendAngles } or null.
function _stirrupGeom(ct, spec, params) {
  const stirrupDia = spec.stirrupBarDiaMm
  const coverIn = spec.coverMm / MM_PER_IN
  if (ct.shape === 'rect') {
    const netWidthMm = inToMm(Math.max(0, ct.widthIn - 2 * coverIn))
    const netDepthMm = inToMm(Math.max(0, ct.depthIn - 2 * coverIn))
    return {
      cuttingLengthMm: computeStirrupCuttingLengthMm({ netWidthMm, netDepthMm, diaMm: stirrupDia, params }),
      nominal: { A: netWidthMm, B: netDepthMm },
      shapeCode: SHAPE_CODE.CLOSED_STIRRUP,
      bendAngles: [90, 90, 90, 90],
    }
  }
  if (ct.shape === 'circle') {
    const netDiaIn = Math.max(0, ct.diamIn - 2 * coverIn)
    const circumferenceMm = Math.PI * inToMm(netDiaIn)
    return {
      cuttingLengthMm: computeCuttingLengthMm({ straightSegmentsMm: [circumferenceMm], bendAnglesDeg: [], diaMm: stirrupDia, hookEndCount: 2, params }),
      nominal: { A: circumferenceMm },
      shapeCode: SHAPE_CODE.CLOSED_STIRRUP,
      bendAngles: [],
    }
  }
  return null
}

export function generateColumnRebarGroups(ctx, column) {
  const { state, params } = ctx
  if (!column || !state || !params) return []

  // Phase ColumnStack — emit one "lift" per floor in the column's span. Each
  // lift resolves its own section + reinforcement (per-floor segment overrides)
  // and carries its own lap; the sub/super grade split happens at the BASE lift
  // only. A single-floor column has exactly one (base) lift → emission is
  // byte-identical to the pre-phase whole-column generator (verify-bbs C/G).
  const columnTypes = state.projectSettings?.columnTypes ?? []
  const spanFloorIds = topoGetColumnSpanFloorIds(state, column)

  if (spanFloorIds.length === 0) {
    // Floors unconfigured / span unresolved — single base lift over the whole
    // fallback height (mirrors getColumnHeightFt's fallback).
    const floorId = column.baseFloorId ?? column.floorId ?? null
    const liftHeightFt = state.getColumnHeightFt?.(column) ?? 0
    return _emitLift(ctx, column, columnTypes, floorId, true, liftHeightFt)
  }

  const groups = []
  const baseFid = spanFloorIds[0]
  for (const fid of spanFloorIds) {
    const liftHeightFt = topoGetColumnLiftHeightFt(state, column, fid)
    groups.push(..._emitLift(ctx, column, columnTypes, fid, fid === baseFid, liftHeightFt))
  }
  return groups
}

// Emit one lift's RebarGroups. `isBase` gates the sub/super grade split (only
// the base lift straddles the grade beam); upper lifts are super-columns.
function _emitLift(ctx, column, columnTypes, floorId, isBase, liftHeightFt) {
  const { state, params } = ctx
  const ct = resolveColumnTypeForColumn(state, column, columnTypes, floorId)
  if (!ct) return []

  const resolved = resolveColumnReinforcementSpecForColumn(state, column, ct, floorId)
  if (!resolved.spec) return []   // ESTIMATE — kg/m³ pool handles it

  const spec       = resolved.spec
  const specId     = resolved.specId
  const specSource = resolved.source

  const heightMm = ftToMm(liftHeightFt)
  if (heightMm <= 0) return []

  const columnLabel = columnLabelFor(ct, column)
  const idSlice = String(column.id ?? '').slice(0, 4)
  const steelGrade  = params.defaultSteelGrade

  const longDia = spec.longitudinalBarDiaMm
  const lapMm   = lapLengthMm({ diaMm: longDia, lapKey: params.defaultLapKey, params })
  const stirrupSpacingMm = inToMm(spec.stirrupSpacingIn)
  const sg = _stirrupGeom(ct, spec, params)
  const common = { column, floorId, spec, specId, specSource, steelGrade, params, longDia, sg, stirrupSpacingMm, ct }

  const forcedPos = (column.position === 'SUB' || column.position === 'SUPER') ? column.position : null
  const splitEnabled = params.subSuperColumnSplitEnabled === true

  // ── Forced position: whole column → one abstract category (every lift) ──────
  if (forcedPos) {
    const cat = bbsCategoryForColumnPosition(forcedPos)
    return _buildSegment({
      ...common, mk: `${getBarMarkPrefix(cat)}-${idSlice}`, lengthMm: heightMm, lapMm,
      bbsCategory: cat, segmentType: `FORCED_${forcedPos}`, confinement: forcedPos === 'SUPER',
    })
  }

  // ── Base lift: optional sub/super auto-split at the grade beam ───────────────
  if (isBase) {
    const floors = state.projectSettings?.floors ?? []
    const baseFloor = floors.find(f => f.id === floorId)
    const plinthFt = baseFloor?.plinthHeightFt ?? state.projectSettings?.heights?.plinthHeightFt ?? 0
    const subLenMm = (params.gradeBeamLevelPlinthFraction ?? 1.0) * ftToMm(plinthFt)
    const canAutoSplit = splitEnabled && subLenMm > 0 && subLenMm < heightMm
    if (canAutoSplit) {
      const subLapMm = (params.subColumnLapFactor ?? 1.0) * lapMm
      const superLenMm = heightMm - subLenMm
      return [
        ..._buildSegment({ ...common, mk: `${getBarMarkPrefix(BBS_CATEGORY.SUB_COLUMN)}-${idSlice}`,
          lengthMm: subLenMm, lapMm: subLapMm, bbsCategory: BBS_CATEGORY.SUB_COLUMN, segmentType: 'AUTO_SUB', confinement: false }),
        ..._buildSegment({ ...common, mk: columnLabel,
          lengthMm: superLenMm, lapMm, bbsCategory: BBS_CATEGORY.SUPER_COLUMN, segmentType: 'AUTO_SUPER', confinement: true }),
      ]
    }
    // Standard base lift (no split) — byte-identical to the pre-phase emission.
    return _buildSegment({
      ...common, mk: columnLabel, lengthMm: heightMm, lapMm,
      bbsCategory: BBS_CATEGORY.COLUMN, segmentType: null, confinement: true,
    })
  }

  // ── Upper lift: physically a super-column, no grade split ────────────────────
  return _buildSegment({
    ...common, mk: columnLabel, lengthMm: heightMm, lapMm,
    bbsCategory: splitEnabled ? BBS_CATEGORY.SUPER_COLUMN : BBS_CATEGORY.COLUMN,
    segmentType: splitEnabled ? 'AUTO_SUPER' : null, confinement: true,
  })
}

// Build one column segment's LONGITUDINAL + stirrup groups. `confinement` gates
// the IS 13920 zone split (only when params.confinementZoneEnabled too).
function _buildSegment({
  mk, column, floorId, spec, specId, specSource, steelGrade, params,
  lengthMm, lapMm, longDia, sg, stirrupSpacingMm, bbsCategory, segmentType,
  confinement, ct,
}) {
  const groups = []
  const longCuttingLengthMm = computeStraightBarCuttingLengthMm({
    lengthMm: lengthMm + lapMm, diaMm: longDia, hookEndCount: 0, params,
  })
  groups.push(makeRebarGroup({
    markId: `${mk}-L`, elementType: ELEMENT_TYPE.COLUMN, elementId: column.id, floorId,
    role: REBAR_ROLE.LONGITUDINAL, diaMm: longDia, shapeCode: SHAPE_CODE.STRAIGHT,
    bendAnglesDeg: [], nominalDimensions: { A: lengthMm + lapMm },
    cuttingLengthMm: longCuttingLengthMm, count: spec.longitudinalBarCount,
    specId, specSource, steelGrade, bbsCategory,
    meta: { description: 'Column longitudinal bars (one full lap per bar)',
      lapLengthMm: Math.round(lapMm), segmentType, parentMark: mk },
  }))

  if (!sg) return groups
  const stirrupDia = spec.stirrupBarDiaMm

  const useConfinement = confinement && params.confinementZoneEnabled === true && stirrupSpacingMm > 0
  if (useConfinement) {
    const isRect = ct.shape === 'rect'
    const sectionMaxMm = isRect ? Math.max(inToMm(ct.widthIn), inToMm(ct.depthIn)) : inToMm(ct.diamIn ?? 0)
    const lo = Math.max(sectionMaxMm, lengthMm / (params.columnConfinementHeightDivisor || 6), params.columnConfinementLengthMinMm || 450)
    const sectionMinMm = isRect ? Math.min(inToMm(ct.widthIn), inToMm(ct.depthIn)) : inToMm(ct.diamIn ?? 0)
    const zoneSpacingMm = Math.max(1, Math.min(
      (params.columnConfinementDFactor || 0.25) * sectionMinMm,
      (params.columnConfinementBarFactor || 6) * longDia,
      params.columnConfinementMaxSpacingMm || 100))
    const midLenMm = Math.max(0, lengthMm - 2 * lo)
    const zoneCount = 2 * Math.ceil(lo / zoneSpacingMm)
    const midCount = midLenMm > 0 ? Math.ceil(midLenMm / stirrupSpacingMm) : 0
    if (zoneCount > 0) {
      groups.push(makeRebarGroup({
        markId: `${mk}-S-Z`, elementType: ELEMENT_TYPE.COLUMN, elementId: column.id, floorId,
        role: REBAR_ROLE.STIRRUP_ZONE, diaMm: stirrupDia, shapeCode: sg.shapeCode, bendAnglesDeg: sg.bendAngles,
        nominalDimensions: sg.nominal, cuttingLengthMm: sg.cuttingLengthMm, count: zoneCount,
        specId, specSource, steelGrade, bbsCategory,
        meta: { description: 'Column stirrups, confinement zone (IS 13920 Cl 7.4)', spacingMm: Math.round(zoneSpacingMm), zone: 'CONFINEMENT', segmentType, parentMark: mk, loMm: Math.round(lo) },
      }))
    }
    if (midCount > 0) {
      groups.push(makeRebarGroup({
        markId: `${mk}-S`, elementType: ELEMENT_TYPE.COLUMN, elementId: column.id, floorId,
        role: REBAR_ROLE.STIRRUP, diaMm: stirrupDia, shapeCode: sg.shapeCode, bendAnglesDeg: sg.bendAngles,
        nominalDimensions: sg.nominal, cuttingLengthMm: sg.cuttingLengthMm, count: midCount,
        specId, specSource, steelGrade, bbsCategory,
        meta: { description: 'Column stirrups, uniform spacing', spacingIn: spec.stirrupSpacingIn, zone: 'MID', segmentType, parentMark: mk },
      }))
    }
  } else {
    const totalCount = stirrupSpacingMm > 0 ? Math.ceil(lengthMm / stirrupSpacingMm) : 0
    if (totalCount > 0) {
      groups.push(makeRebarGroup({
        markId: `${mk}-S`, elementType: ELEMENT_TYPE.COLUMN, elementId: column.id, floorId,
        role: REBAR_ROLE.STIRRUP, diaMm: stirrupDia, shapeCode: sg.shapeCode, bendAnglesDeg: sg.bendAngles,
        nominalDimensions: sg.nominal, cuttingLengthMm: sg.cuttingLengthMm, count: totalCount,
        specId, specSource, steelGrade, bbsCategory,
        meta: { description: 'Column stirrups, uniform spacing', spacingIn: spec.stirrupSpacingIn, zone: 'MID', segmentType, parentMark: mk },
      }))
    }
  }
  return groups
}
