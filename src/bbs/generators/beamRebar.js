// Beam rebar group generator.
//
// 2026-05-28. Pure function — given a beam entity (explicit or wall-derived)
// + IS 2502 params, returns the RebarGroup[] for that beam:
//   • TOP — straight bars across the span + per-end anchorage (Ld at
//     exterior joints, Ld/2 at interior joints — conservative continuity).
//   • BOTTOM — mirror of TOP, using spec.bottomBars.
//   • STIRRUP — closed rectangular link at spec.stirrupSpacingIn.
//     When params.confinementZoneEnabled === true (IS 13920 Cl 6.3.5) the
//     stirrup population SPLITS into a close-spaced STIRRUP_ZONE group
//     covering 2 × confinementLength at zone spacing + a uniform STIRRUP
//     group covering the mid (length - 2 × confinementLength) at the
//     spec spacing.
//
// Exterior-joint detection:
//   • Wall-derived beams: external wall iff getRoomsForWall returns exactly
//     one room (single-room adjacency = building exterior). Both ends sit
//     on that wall → both are exterior joints.
//   • Explicit beams: default conservative (both ends treated as INTERIOR
//     → Ld/2 each end). Until column-perimeter exterior detection is
//     wired, this matches the existing computeBeamBBS baseline most closely.
//
// Backward-compat invariant: sum of totalWeightKg per beam roughly tracks
// computeBeamBBS(spec, lenFt, w, d).totalKg. Slight overage at exterior
// joints (Ld additions) is correct per IS 456 anchorage requirements.

import { resolveBeamReinforcementSpec } from '../../specs/resolution.js'
import {
  computeStraightBarCuttingLengthMm,
  computeStirrupCuttingLengthMm,
  allowanceMm,
  ftToMm,
  inToMm,
  MM_PER_IN,
} from '../../specs/cuttingLength.js'
import { resolveBeamEndpoint } from '../../topology/beams.js'
import {
  ELEMENT_TYPE, REBAR_ROLE, SHAPE_CODE, makeRebarGroup,
  bbsCategoryForBeamClass, beamBehaviorForClass, getBarMarkPrefix,
} from '../types.js'

// Beam label — kept short for schedule table column width.
//   Explicit:     'B-<idSlice>'
//   Wall-derived: '<CLS>-<wallIdSlice>'  (CLS ∈ PLI / LIN / ROO)
function _beamLabelFor(beam, bbsCategory) {
  const prefix = getBarMarkPrefix(bbsCategory)   // PB/HB/RB/TB/B per registry
  const slice = beam.source === 'WALL_DERIVED'
    ? String(beam.sourceWallId ?? '').slice(0, 4)
    : String(beam.id ?? '').slice(0, 4)
  return slice ? `${prefix}-${slice}` : prefix
}

// Exterior-joint detection. Wall-derived: external wall iff exactly one
// room references this wall (the building exterior is the "other side").
// Explicit beams default to INTERIOR — conservative; better to under-anchor
// in the BBS than over-quote steel for a typology we can't reliably detect.
function _isExteriorJoint(state, beam /*, end */) {
  if (beam.source !== 'WALL_DERIVED') return false
  const wallId = beam.sourceWallId
  if (!wallId) return false
  const rooms = state.getRoomsForWall?.(wallId) ?? []
  return rooms.length === 1
}

function _floorIdFor(state, beam) {
  if (beam.source === 'WALL_DERIVED') {
    return state.walls?.[beam.sourceWallId]?.floorId ?? beam.floorId ?? null
  }
  return beam.floorId ?? null
}

export function generateBeamRebarGroups(ctx, beam) {
  const { state, params } = ctx
  if (!beam || !state || !params) return []

  const resolved = resolveBeamReinforcementSpec(state, beam)
  if (!resolved.spec) return []   // ESTIMATE — kg/m³ pool handles it

  const spec       = resolved.spec
  const specId     = resolved.specId
  const specSource = resolved.source

  // ── Geometry ──────────────────────────────────────────────────────────────
  const from = resolveBeamEndpoint(state, beam.endpoints?.from)
  const to   = resolveBeamEndpoint(state, beam.endpoints?.to)
  if (!from || !to) return []
  const lengthFt = Math.hypot(to.x - from.x, to.y - from.y) / 12
  if (lengthFt <= 0) return []

  const beamClass = beam.beamClass ?? beam.level
  const dims = state.projectSettings?.beamDimensions?.[beamClass]
  if (!dims) return []
  const widthIn = dims.widthIn, depthIn = dims.depthIn
  if (widthIn <= 0 || depthIn <= 0) return []

  // Band vs frame behaviour (IS 4326 bands = tie/lintel → uniform links, no
  // IS 13920 confinement). beamBehavior + bbsCategory stamped on every group.
  const beamBehavior = beamBehaviorForClass(beamClass)
  const bbsCategory  = bbsCategoryForBeamClass(beamClass)
  const isBand       = beamBehavior === 'BAND'

  const lengthMm  = ftToMm(lengthFt)
  const beamLabel = _beamLabelFor(beam, bbsCategory)
  const floorId   = _floorIdFor(state, beam)
  const elementId = beam.id
  const steelGrade = params.defaultSteelGrade

  // ── Anchorage (via allowanceMm — Ld+hook in IS_STRICT, flat ft in SITE) ────
  // The exterior anchor folds the IS exterior 9d hook in, so the cut below uses
  // hookEndCount:0 and stays byte-identical to the prior form in IS_STRICT.
  const topDia = spec.topBars.diaMm
  const botDia = spec.bottomBars.diaMm
  const isExtFrom = _isExteriorJoint(state, beam, 'from')
  const isExtTo   = _isExteriorJoint(state, beam, 'to')

  const anchorFromTopMm = allowanceMm({ kind: isExtFrom ? 'beamTopAnchorExterior' : 'beamTopAnchorInterior', diaMm: topDia, params })
  const anchorToTopMm   = allowanceMm({ kind: isExtTo   ? 'beamTopAnchorExterior' : 'beamTopAnchorInterior', diaMm: topDia, params })
  const anchorFromBotMm = allowanceMm({ kind: isExtFrom ? 'beamBottomAnchorExterior' : 'beamBottomAnchorInterior', diaMm: botDia, params })
  const anchorToBotMm   = allowanceMm({ kind: isExtTo   ? 'beamBottomAnchorExterior' : 'beamBottomAnchorInterior', diaMm: botDia, params })

  const groups = []

  // ── Group 1 — TOP bars ────────────────────────────────────────────────────
  const topTotalMm = lengthMm + anchorFromTopMm + anchorToTopMm
  const topCuttingLengthMm = computeStraightBarCuttingLengthMm({
    lengthMm:     topTotalMm,
    diaMm:        topDia,
    hookEndCount: 0,   // exterior 9d hook folded into anchorMm (IS_STRICT)
    params,
  })
  groups.push(makeRebarGroup({
    markId:        `${beamLabel}-T`,
    elementType:   ELEMENT_TYPE.BEAM,
    elementId,
    floorId,
    role:          REBAR_ROLE.TOP,
    diaMm:         topDia,
    shapeCode:     SHAPE_CODE.STRAIGHT,
    bendAnglesDeg: [],
    nominalDimensions: { A: lengthMm, B: anchorFromTopMm, C: anchorToTopMm },
    cuttingLengthMm: topCuttingLengthMm,
    count:         spec.topBars.count,
    specId,
    specSource,
    steelGrade,
    bbsCategory,
    meta: {
      beamBehavior,
      description:    'Beam top bars (anchorage at ends)',
      parentMark:     beamLabel,
      anchorFromMm:   Math.round(anchorFromTopMm),
      anchorToMm:     Math.round(anchorToTopMm),
      isExteriorFrom: isExtFrom,
      isExteriorTo:   isExtTo,
      lengthFt,
    },
  }))

  // ── Group 2 — BOTTOM bars ─────────────────────────────────────────────────
  const botTotalMm = lengthMm + anchorFromBotMm + anchorToBotMm
  const botCuttingLengthMm = computeStraightBarCuttingLengthMm({
    lengthMm:     botTotalMm,
    diaMm:        botDia,
    hookEndCount: 0,   // exterior 9d hook folded into anchorMm (IS_STRICT)
    params,
  })
  groups.push(makeRebarGroup({
    markId:        `${beamLabel}-B`,
    elementType:   ELEMENT_TYPE.BEAM,
    elementId,
    floorId,
    role:          REBAR_ROLE.BOTTOM,
    diaMm:         botDia,
    shapeCode:     SHAPE_CODE.STRAIGHT,
    bendAnglesDeg: [],
    nominalDimensions: { A: lengthMm, B: anchorFromBotMm, C: anchorToBotMm },
    cuttingLengthMm: botCuttingLengthMm,
    count:         spec.bottomBars.count,
    specId,
    specSource,
    steelGrade,
    bbsCategory,
    meta: {
      beamBehavior,
      description:    'Beam bottom bars (anchorage at ends)',
      parentMark:     beamLabel,
      anchorFromMm:   Math.round(anchorFromBotMm),
      anchorToMm:     Math.round(anchorToBotMm),
      isExteriorFrom: isExtFrom,
      isExteriorTo:   isExtTo,
      lengthFt,
    },
  }))

  // ── Stirrups ──────────────────────────────────────────────────────────────
  const stirrupDia = spec.stirrupBarDiaMm
  const coverIn    = spec.coverMm / MM_PER_IN
  const netWidthMm = inToMm(Math.max(0, widthIn - 2 * coverIn))
  const netDepthMm = inToMm(Math.max(0, depthIn - 2 * coverIn))
  const stirrupCuttingLengthMm = computeStirrupCuttingLengthMm({
    netWidthMm, netDepthMm, diaMm: stirrupDia, params,
  })
  const totalLengthIn = lengthFt * 12
  const specSpacingIn = spec.stirrupSpacingIn

  if (params.confinementZoneEnabled && !isBand) {
    // IS 13920 Cl 6.3.5 — confinement zone per end = 2 × beam depth (default).
    const zoneLengthIn = (params.beamConfinementLengthDepthFactor ?? 2) * depthIn
    const zoneSpacingMm = Math.min(
      params.beamConfinementDFactor * inToMm(depthIn),
      params.beamConfinementBarFactor * Math.min(topDia, botDia),
      params.beamConfinementMaxSpacingMm,
    )
    const zoneSpacingIn = zoneSpacingMm / MM_PER_IN

    // Constrain zone length so two zones can't exceed the beam length.
    const usableZoneLengthIn = Math.min(zoneLengthIn, totalLengthIn / 2)
    const totalZoneLengthIn  = 2 * usableZoneLengthIn
    const midLengthIn        = Math.max(0, totalLengthIn - totalZoneLengthIn)

    const zoneCount = zoneSpacingIn > 0
      ? Math.ceil(totalZoneLengthIn / zoneSpacingIn)
      : 0
    const midCount = specSpacingIn > 0 && midLengthIn > 0
      ? Math.ceil(midLengthIn / specSpacingIn)
      : 0

    if (zoneCount > 0) {
      groups.push(makeRebarGroup({
        markId:        `${beamLabel}-S-Z`,
        elementType:   ELEMENT_TYPE.BEAM,
        elementId,
        floorId,
        role:          REBAR_ROLE.STIRRUP_ZONE,
        diaMm:         stirrupDia,
        shapeCode:     SHAPE_CODE.CLOSED_STIRRUP,
        bendAnglesDeg: [90, 90, 90, 90],
        nominalDimensions: { A: netWidthMm, B: netDepthMm },
        cuttingLengthMm: stirrupCuttingLengthMm,
        count:         zoneCount,
        specId,
        specSource,
        steelGrade,
        bbsCategory,
        meta: {
          beamBehavior,
          description:   'Beam stirrups (IS 13920 confinement zone at ends)',
          parentMark:    beamLabel,
          spacingIn:     zoneSpacingIn,
          zone:          'CONFINEMENT',
          zoneLengthIn:  usableZoneLengthIn,
          zonesPerBeam:  2,
        },
      }))
    }

    if (midCount > 0) {
      groups.push(makeRebarGroup({
        markId:        `${beamLabel}-S`,
        elementType:   ELEMENT_TYPE.BEAM,
        elementId,
        floorId,
        role:          REBAR_ROLE.STIRRUP,
        diaMm:         stirrupDia,
        shapeCode:     SHAPE_CODE.CLOSED_STIRRUP,
        bendAnglesDeg: [90, 90, 90, 90],
        nominalDimensions: { A: netWidthMm, B: netDepthMm },
        cuttingLengthMm: stirrupCuttingLengthMm,
        count:         midCount,
        specId,
        specSource,
        steelGrade,
        bbsCategory,
        meta: {
          beamBehavior,
          description: 'Beam stirrups (mid span, uniform spacing)',
          parentMark:  beamLabel,
          spacingIn:   specSpacingIn,
          zone:        'MID',
          midLengthIn,
        },
      }))
    }
  } else {
    // Uniform stirrups across full length.
    const stirrupCount = specSpacingIn > 0
      ? Math.ceil(totalLengthIn / specSpacingIn)
      : 0
    if (stirrupCount > 0) {
      groups.push(makeRebarGroup({
        markId:        `${beamLabel}-S`,
        elementType:   ELEMENT_TYPE.BEAM,
        elementId,
        floorId,
        role:          REBAR_ROLE.STIRRUP,
        diaMm:         stirrupDia,
        shapeCode:     SHAPE_CODE.CLOSED_STIRRUP,
        bendAnglesDeg: [90, 90, 90, 90],
        nominalDimensions: { A: netWidthMm, B: netDepthMm },
        cuttingLengthMm: stirrupCuttingLengthMm,
        count:         stirrupCount,
        specId,
        specSource,
        steelGrade,
        bbsCategory,
        meta: {
          beamBehavior,
          description: 'Beam stirrups (uniform spacing)',
          parentMark:  beamLabel,
          spacingIn:   specSpacingIn,
          zone:        'MID',
        },
      }))
    }
  }

  return groups
}
