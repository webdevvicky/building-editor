// Slab rebar generator — IS 2502 / SP 34 / IS 456.
//
// 2026-05-28. Emits RebarGroup[] for a single slab. Spans/widths derive from
// state.getRoomGeometry(roomId, 'centerline') — NEVER from √area. The legacy
// computeSlabBBS aggregator approximated span and width as √area for square
// rooms; Phase BBS-0.5 now uses real polygon span via room.longestWall and
// preserves total area through widthFt = areaFt2 / spanFt.
//
// Branching:
//   • aspectRatio = spanFt / widthFt
//   • aspectRatio > 2  → ONE-WAY  (long-narrow: corridor / verandah / utility)
//   • aspectRatio <= 2 → TWO-WAY  (typical Indian residential rooms)
//   • spec.twoWay === true|false overrides the aspect-ratio derivation.
//
// One-way emits MAIN + DIST. When crankFraction > 0 and useSeparateTopBars
// is false, a fraction of mains are cranked at L/4 (SP 34 Fig 3.5) with the
// remainder straight. When useSeparateTopBars is true, the crank group is
// replaced by an EXTRA_TOP group of straight bars over each support.
//
// Two-way emits MAIN along span + MAIN along width (perpendicular). The
// distribution role is omitted — both directions act as main per IS 456
// Annex D simplification. Cranks (if enabled) emit for both directions.
//
// Pure function. No React, no DOM, no console.

import { resolveSlabReinforcementSpecForSlab } from '../../specs/resolution.js'
import {
  computeStraightBarCuttingLengthMm,
  computeCrankBarCuttingLengthMm,
  developmentLengthMm,
  ftToMm,
  MM_PER_FT,
  MM_PER_IN,
} from '../../specs/cuttingLength.js'
import {
  ELEMENT_TYPE,
  REBAR_ROLE,
  SHAPE_CODE,
  makeRebarGroup,
} from '../types.js'

const DEFAULT_SLAB_THICKNESS_IN_FALLBACK = 5

function slabMarkLabel(slab) {
  const raw = slab.label
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.replace(/\s+/g, '')
  }
  return 'S-' + String(slab.id).slice(0, 4)
}

// Bars perpendicular to a length L (ft), at spacing s (in): floor(L*12/s) + 1.
function barsAcross(lengthFt, spacingIn) {
  if (lengthFt <= 0 || spacingIn <= 0) return 0
  return Math.floor((lengthFt * 12) / spacingIn) + 1
}

export function generateSlabRebarGroups(ctx, slab) {
  if (!ctx || !slab) return []
  const { state, params } = ctx
  if (!state || !params) return []

  // ── Resolve spec via centralized chain. ESTIMATE → no rebar groups.
  const resolved = resolveSlabReinforcementSpecForSlab(state, slab)
  if (!resolved || !resolved.spec) return []
  const spec = resolved.spec

  // ── Geometry from getRoomGeometry — REAL span/width, not √area.
  const validSet = new Set(state.getValidRoomIds?.() ?? [])
  let areaFt2 = 0
  let spanFt = 0
  const roomIds = Array.isArray(slab.roomIds) ? slab.roomIds : []
  for (const rid of roomIds) {
    if (validSet.size && !validSet.has(rid)) continue
    const geom = state.getRoomGeometry?.(rid, 'centerline')
    if (!geom) continue
    if (typeof geom.area === 'number' && geom.area > 0) areaFt2 += geom.area
    if (typeof geom.longestWall === 'number' && geom.longestWall > spanFt) {
      spanFt = geom.longestWall
    }
  }
  if (areaFt2 <= 0 || spanFt <= 0) return []
  const widthFt = areaFt2 / spanFt
  if (widthFt <= 0) return []
  const aspectRatio = spanFt / widthFt

  // ── One-way vs two-way decision.
  const isTwoWay =
    spec.twoWay === true  ? true
    : spec.twoWay === false ? false
    : aspectRatio <= 2

  // ── Slab thickness + effective depth (mm).
  const slabThicknessIn =
    slab.thicknessIn
    ?? state.projectSettings?.slabSettings?.mainThicknessIn
    ?? DEFAULT_SLAB_THICKNESS_IN_FALLBACK
  const coverIn = (spec.coverMm ?? 20) / MM_PER_IN
  const effectiveDepthIn = Math.max(2, slabThicknessIn - 2 * coverIn)
  const effectiveDepthMm = effectiveDepthIn * MM_PER_IN

  // ── Geometry in mm.
  const spanMm  = ftToMm(spanFt)
  const widthMm = ftToMm(widthFt)

  // ── Development lengths per direction.
  const mainDia = spec.mainBarDiaMm
  const distDia = spec.distBarDiaMm
  const ldMain  = developmentLengthMm({ diaMm: mainDia, gradeKey: params.defaultGradeKey, params })
  const ldDist  = developmentLengthMm({ diaMm: distDia, gradeKey: params.defaultGradeKey, params })

  // ── Crank knobs from params.
  const crankFraction        = params.crankFraction ?? 0
  const useSeparateTopBars   = params.useSeparateTopBars === true
  const crankPositionFromSup = params.crankPositionFromSupport ?? 0.25
  const crankAngleDeg        = params.crankAngleDeg ?? 45

  const slabLabel = slabMarkLabel(slab)
  const baseFields = {
    elementType: ELEMENT_TYPE.SLAB,
    elementId:   slab.id,
    floorId:     slab.floorId,
    specId:      resolved.specId,
    specSource:  resolved.source,
    steelGrade:  params.defaultSteelGrade,
  }

  const groups = []

  if (!isTwoWay) {
    // ── ONE-WAY ────────────────────────────────────────────────────────────
    // Mains run along spanFt. Count = bars laid out across widthFt.
    const nMainTotal = barsAcross(widthFt, spec.mainBarSpacingIn)
    const nDist      = barsAcross(spanFt,  spec.distBarSpacingIn)

    let nMainStraight = nMainTotal
    let nCranked      = 0
    if (crankFraction > 0 && nMainTotal > 0) {
      nCranked      = Math.ceil(nMainTotal * crankFraction)
      nMainStraight = Math.max(0, nMainTotal - nCranked)
    }

    // MAIN — straight portion.
    if (nMainStraight > 0) {
      const lengthMm = spanMm + 2 * ldMain
      const cuttingMm = computeStraightBarCuttingLengthMm({
        lengthMm,
        diaMm:        mainDia,
        hookEndCount: 0,
        params,
      })
      groups.push(makeRebarGroup({
        ...baseFields,
        markId:            `${slabLabel}-M`,
        role:              REBAR_ROLE.MAIN,
        diaMm:             mainDia,
        shapeCode:         SHAPE_CODE.STRAIGHT,
        bendAnglesDeg:     [],
        nominalDimensions: { A: spanMm, B: ldMain },
        cuttingLengthMm:   cuttingMm,
        count:             nMainStraight,
        meta: {
          description:  'Slab main bars (straight portion, one-way)',
          direction:    'SPAN',
          spacingIn:    spec.mainBarSpacingIn,
          parentMark:   slabLabel,
          spanFt, widthFt, aspectRatio, isTwoWay,
        },
      }))
    }

    // CRANK / EXTRA_TOP — the support-region top reinforcement.
    if (nCranked > 0) {
      if (useSeparateTopBars) {
        // Separate top bars at each support — straight, no cranks. Length
        // = 2 × crankPos × spanMm (sits across each support span fraction).
        const topLenMm = 2 * crankPositionFromSup * spanMm
        const cuttingMm = computeStraightBarCuttingLengthMm({
          lengthMm:     topLenMm,
          diaMm:        mainDia,
          hookEndCount: 0,
          params,
        })
        groups.push(makeRebarGroup({
          ...baseFields,
          markId:            `${slabLabel}-ET`,
          role:              REBAR_ROLE.EXTRA_TOP,
          diaMm:             mainDia,
          shapeCode:         SHAPE_CODE.STRAIGHT,
          bendAnglesDeg:     [],
          nominalDimensions: { A: topLenMm },
          cuttingLengthMm:   cuttingMm,
          count:             nCranked,
          meta: {
            description:  'Extra top bars at supports (replaces cranks)',
            direction:    'SPAN',
            spacingIn:    spec.mainBarSpacingIn,
            parentMark:   slabLabel,
            spanFt, widthFt, aspectRatio, isTwoWay,
          },
        }))
      } else {
        // Cranked main bars — bottom run + 2 inclines + top run. The
        // crank helper handles three 45° bends + two inclined segments.
        const bottomLenMm = spanMm * (1 - 2 * crankPositionFromSup)
        const topLenMm    = spanMm * crankPositionFromSup
        const cuttingMm = computeCrankBarCuttingLengthMm({
          bottomLengthMm: bottomLenMm,
          topLengthMm:    topLenMm,
          verticalRiseMm: effectiveDepthMm,
          crankAngleDeg,
          diaMm:          mainDia,
          params,
        })
        groups.push(makeRebarGroup({
          ...baseFields,
          markId:            `${slabLabel}-C`,
          role:              REBAR_ROLE.CRANK,
          diaMm:             mainDia,
          shapeCode:         SHAPE_CODE.CRANKED,
          bendAnglesDeg:     [crankAngleDeg, crankAngleDeg, crankAngleDeg],
          nominalDimensions: {
            A: bottomLenMm,
            B: topLenMm,
            C: effectiveDepthMm,
          },
          cuttingLengthMm:   cuttingMm,
          count:             nCranked,
          meta: {
            description:    'Slab cranked main bars (alternate, one-way)',
            direction:      'SPAN',
            spacingIn:      spec.mainBarSpacingIn,
            parentMark:     slabLabel,
            crankPositionFromSupport: crankPositionFromSup,
            crankAngleDeg,
            effectiveDepthMm,
            spanFt, widthFt, aspectRatio, isTwoWay,
          },
        }))
      }
    }

    // DIST — distribution bars perpendicular to mains.
    if (nDist > 0) {
      const lengthMm = widthMm + 2 * ldDist
      const cuttingMm = computeStraightBarCuttingLengthMm({
        lengthMm,
        diaMm:        distDia,
        hookEndCount: 0,
        params,
      })
      groups.push(makeRebarGroup({
        ...baseFields,
        markId:            `${slabLabel}-D`,
        role:              REBAR_ROLE.DIST,
        diaMm:             distDia,
        shapeCode:         SHAPE_CODE.STRAIGHT,
        bendAnglesDeg:     [],
        nominalDimensions: { A: widthMm, B: ldDist },
        cuttingLengthMm:   cuttingMm,
        count:             nDist,
        meta: {
          description:  'Slab distribution bars (one-way)',
          direction:    'WIDTH',
          spacingIn:    spec.distBarSpacingIn,
          parentMark:   slabLabel,
          spanFt, widthFt, aspectRatio, isTwoWay,
        },
      }))
    }
  } else {
    // ── TWO-WAY ────────────────────────────────────────────────────────────
    // Both directions act as main (IS 456 Annex D simplification — no
    // separate distribution group). Cranks emit per direction.
    const nMainSpan  = barsAcross(widthFt, spec.mainBarSpacingIn)  // bars along span, laid across width
    const nMainWidth = barsAcross(spanFt,  spec.mainBarSpacingIn)  // bars along width, laid across span

    // SPAN-direction main.
    let nSpanStraight = nMainSpan
    let nSpanCranked  = 0
    if (crankFraction > 0 && nMainSpan > 0) {
      nSpanCranked  = Math.ceil(nMainSpan * crankFraction)
      nSpanStraight = Math.max(0, nMainSpan - nSpanCranked)
    }

    if (nSpanStraight > 0) {
      const lengthMm = spanMm + 2 * ldMain
      const cuttingMm = computeStraightBarCuttingLengthMm({
        lengthMm,
        diaMm:        mainDia,
        hookEndCount: 0,
        params,
      })
      groups.push(makeRebarGroup({
        ...baseFields,
        markId:            `${slabLabel}-M`,
        role:              REBAR_ROLE.MAIN,
        diaMm:             mainDia,
        shapeCode:         SHAPE_CODE.STRAIGHT,
        bendAnglesDeg:     [],
        nominalDimensions: { A: spanMm, B: ldMain },
        cuttingLengthMm:   cuttingMm,
        count:             nSpanStraight,
        meta: {
          description:  'Slab main bars along span (straight portion, two-way)',
          direction:    'SPAN',
          spacingIn:    spec.mainBarSpacingIn,
          parentMark:   slabLabel,
          spanFt, widthFt, aspectRatio, isTwoWay,
        },
      }))
    }

    if (nSpanCranked > 0) {
      if (useSeparateTopBars) {
        const topLenMm = 2 * crankPositionFromSup * spanMm
        const cuttingMm = computeStraightBarCuttingLengthMm({
          lengthMm:     topLenMm,
          diaMm:        mainDia,
          hookEndCount: 0,
          params,
        })
        groups.push(makeRebarGroup({
          ...baseFields,
          markId:            `${slabLabel}-ET`,
          role:              REBAR_ROLE.EXTRA_TOP,
          diaMm:             mainDia,
          shapeCode:         SHAPE_CODE.STRAIGHT,
          bendAnglesDeg:     [],
          nominalDimensions: { A: topLenMm },
          cuttingLengthMm:   cuttingMm,
          count:             nSpanCranked,
          meta: {
            description:  'Extra top bars at supports along span (replaces cranks, two-way)',
            direction:    'SPAN',
            spacingIn:    spec.mainBarSpacingIn,
            parentMark:   slabLabel,
            spanFt, widthFt, aspectRatio, isTwoWay,
          },
        }))
      } else {
        const bottomLenMm = spanMm * (1 - 2 * crankPositionFromSup)
        const topLenMm    = spanMm * crankPositionFromSup
        const cuttingMm = computeCrankBarCuttingLengthMm({
          bottomLengthMm: bottomLenMm,
          topLengthMm:    topLenMm,
          verticalRiseMm: effectiveDepthMm,
          crankAngleDeg,
          diaMm:          mainDia,
          params,
        })
        groups.push(makeRebarGroup({
          ...baseFields,
          markId:            `${slabLabel}-C`,
          role:              REBAR_ROLE.CRANK,
          diaMm:             mainDia,
          shapeCode:         SHAPE_CODE.CRANKED,
          bendAnglesDeg:     [crankAngleDeg, crankAngleDeg, crankAngleDeg],
          nominalDimensions: {
            A: bottomLenMm,
            B: topLenMm,
            C: effectiveDepthMm,
          },
          cuttingLengthMm:   cuttingMm,
          count:             nSpanCranked,
          meta: {
            description:    'Slab cranked main bars along span (alternate, two-way)',
            direction:      'SPAN',
            spacingIn:      spec.mainBarSpacingIn,
            parentMark:     slabLabel,
            crankPositionFromSupport: crankPositionFromSup,
            crankAngleDeg,
            effectiveDepthMm,
            spanFt, widthFt, aspectRatio, isTwoWay,
          },
        }))
      }
    }

    // WIDTH-direction main.
    let nWidthStraight = nMainWidth
    let nWidthCranked  = 0
    if (crankFraction > 0 && nMainWidth > 0) {
      nWidthCranked  = Math.ceil(nMainWidth * crankFraction)
      nWidthStraight = Math.max(0, nMainWidth - nWidthCranked)
    }

    if (nWidthStraight > 0) {
      const lengthMm = widthMm + 2 * ldMain
      const cuttingMm = computeStraightBarCuttingLengthMm({
        lengthMm,
        diaMm:        mainDia,
        hookEndCount: 0,
        params,
      })
      groups.push(makeRebarGroup({
        ...baseFields,
        markId:            `${slabLabel}-MW`,
        role:              REBAR_ROLE.MAIN,
        diaMm:             mainDia,
        shapeCode:         SHAPE_CODE.STRAIGHT,
        bendAnglesDeg:     [],
        nominalDimensions: { A: widthMm, B: ldMain },
        cuttingLengthMm:   cuttingMm,
        count:             nWidthStraight,
        meta: {
          description:  'Slab main bars along width (straight portion, two-way)',
          direction:    'WIDTH',
          spacingIn:    spec.mainBarSpacingIn,
          parentMark:   slabLabel,
          spanFt, widthFt, aspectRatio, isTwoWay,
        },
      }))
    }

    if (nWidthCranked > 0) {
      if (useSeparateTopBars) {
        const topLenMm = 2 * crankPositionFromSup * widthMm
        const cuttingMm = computeStraightBarCuttingLengthMm({
          lengthMm:     topLenMm,
          diaMm:        mainDia,
          hookEndCount: 0,
          params,
        })
        groups.push(makeRebarGroup({
          ...baseFields,
          markId:            `${slabLabel}-ETW`,
          role:              REBAR_ROLE.EXTRA_TOP,
          diaMm:             mainDia,
          shapeCode:         SHAPE_CODE.STRAIGHT,
          bendAnglesDeg:     [],
          nominalDimensions: { A: topLenMm },
          cuttingLengthMm:   cuttingMm,
          count:             nWidthCranked,
          meta: {
            description:  'Extra top bars at supports along width (replaces cranks, two-way)',
            direction:    'WIDTH',
            spacingIn:    spec.mainBarSpacingIn,
            parentMark:   slabLabel,
            spanFt, widthFt, aspectRatio, isTwoWay,
          },
        }))
      } else {
        const bottomLenMm = widthMm * (1 - 2 * crankPositionFromSup)
        const topLenMm    = widthMm * crankPositionFromSup
        const cuttingMm = computeCrankBarCuttingLengthMm({
          bottomLengthMm: bottomLenMm,
          topLengthMm:    topLenMm,
          verticalRiseMm: effectiveDepthMm,
          crankAngleDeg,
          diaMm:          mainDia,
          params,
        })
        groups.push(makeRebarGroup({
          ...baseFields,
          markId:            `${slabLabel}-CW`,
          role:              REBAR_ROLE.CRANK,
          diaMm:             mainDia,
          shapeCode:         SHAPE_CODE.CRANKED,
          bendAnglesDeg:     [crankAngleDeg, crankAngleDeg, crankAngleDeg],
          nominalDimensions: {
            A: bottomLenMm,
            B: topLenMm,
            C: effectiveDepthMm,
          },
          cuttingLengthMm:   cuttingMm,
          count:             nWidthCranked,
          meta: {
            description:    'Slab cranked main bars along width (alternate, two-way)',
            direction:      'WIDTH',
            spacingIn:      spec.mainBarSpacingIn,
            parentMark:     slabLabel,
            crankPositionFromSupport: crankPositionFromSup,
            crankAngleDeg,
            effectiveDepthMm,
            spanFt, widthFt, aspectRatio, isTwoWay,
          },
        }))
      }
    }
  }

  return groups
}
