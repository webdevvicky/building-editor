// Phase 1.7 — Reinforcement spec registry + pure BBS math.
//
// A "reinforcement spec" describes how a structural element is reinforced
// (bar diameters, counts, spacing, cover, lap length). Specs are referenced
// from entities via `reinforcementSpecId` (null = fall back to kg/m³ estimate
// in getSteelQuantities()).
//
// All math here is pure: no store, no React. Lengths are in feet, dia in mm.
// Conversion factor 0.3048 m/ft is used to align with the kg/m unit weights.

import { getColumnStirrupLengthFt } from '../lib/columnShapes'

// Standard IS 1786 unit weights for TMT rebar (kg per metre of bar length).
export const STEEL_UNIT_WEIGHT_KG_PER_M = {
  8:  0.395,
  10: 0.617,
  12: 0.888,
  16: 1.578,
  20: 2.469,
  25: 3.855,
  32: 6.313,
}

// Concrete cover defaults per IS 456 (mm). Foundations need maximum cover for
// soil contact; slabs use the lightest. Specs may override.
export const DEFAULT_COVER_MM_BY_ELEMENT = {
  FOUNDATION: 40,
  COLUMN:     25,
  BEAM:       25,
  SLAB:       20,
}

// 90°/135° hook return on each end of a stirrup. ~6 in standard for residential.
export const DEFAULT_HOOK_LENGTH_FT = 0.5

// Lap length ≈ 50 × bar diameter (IS 456 typical for M20). Applied once per
// column lift / per development end on footings.
export const DEFAULT_LAP_LENGTH_MULTIPLIER = 50

// ── Spec presets ─────────────────────────────────────────────────────────────
// Library defaults that the UI exposes via "Apply preset". Users may clone and
// override on a per-project basis.

export const REINFORCEMENT_SPEC_PRESETS = {
  COLUMN_C1_STD: {
    id: 'COLUMN_C1_STD',
    label: 'C1 Standard (4-12mm + 8mm stirrups @ 6")',
    elementType: 'COLUMN',
    longitudinalBarCount: 4,
    longitudinalBarDiaMm: 12,
    stirrupBarDiaMm: 8,
    stirrupSpacingIn: 6,
    coverMm: 25,
    lapLengthMultiplier: 50,
  },
  COLUMN_C2_HEAVY: {
    id: 'COLUMN_C2_HEAVY',
    label: 'C2 Heavy (4-16mm + 8mm stirrups @ 6")',
    elementType: 'COLUMN',
    longitudinalBarCount: 4,
    longitudinalBarDiaMm: 16,
    stirrupBarDiaMm: 8,
    stirrupSpacingIn: 6,
    coverMm: 25,
    lapLengthMultiplier: 50,
  },
  BEAM_PLINTH_STD: {
    id: 'BEAM_PLINTH_STD',
    label: 'Plinth Beam Standard (2T12 + 2B16 + 8mm @ 6")',
    elementType: 'BEAM',
    topBars:    { count: 2, diaMm: 12 },
    bottomBars: { count: 2, diaMm: 16 },
    stirrupBarDiaMm: 8,
    stirrupSpacingIn: 6,
    coverMm: 25,
  },
  FOOTING_STD: {
    id: 'FOOTING_STD',
    label: 'Footing Standard (6×6 of 12mm both ways)',
    elementType: 'FOOTING',
    xBars: { count: 6, diaMm: 12 },
    yBars: { count: 6, diaMm: 12 },
    developmentLengthMultiplier: 50,
    coverMm: 40,
  },
  SLAB_MAIN_STD: {
    id: 'SLAB_MAIN_STD',
    label: 'Slab Main (10mm @ 6" main + 8mm @ 8" dist, one-way)',
    elementType: 'SLAB',
    mainBarDiaMm: 10,
    mainBarSpacingIn: 6,
    distBarDiaMm: 8,
    distBarSpacingIn: 8,
    coverMm: 20,
    twoWay: false,
  },
  SLAB_SUNKEN_STD: {
    id: 'SLAB_SUNKEN_STD',
    label: 'Slab Sunken (10mm @ 6" main + 8mm @ 8" dist, two-way)',
    elementType: 'SLAB',
    mainBarDiaMm: 10,
    mainBarSpacingIn: 6,
    distBarDiaMm: 8,
    distBarSpacingIn: 8,
    coverMm: 20,
    twoWay: true,
  },
}

// ── Helpers ──────────────────────────────────────────────────────────────────
// All BBS functions follow the same kg formula:
//   kg = barCount × barLengthFt × 0.3048 × STEEL_UNIT_WEIGHT_KG_PER_M[diaMm]
// (0.3048 converts ft → m so the unit weight table can be applied directly.)

const FT_PER_M = 0.3048
const MM_PER_IN = 25.4
const FT_PER_MM = FT_PER_M / 1000   // 1 mm = 0.0003048 ft (used for dev/lap)

function kgFor(barCount, lengthFt, diaMm) {
  const w = STEEL_UNIT_WEIGHT_KG_PER_M[diaMm]
  if (!w) return 0
  return barCount * lengthFt * FT_PER_M * w
}

// ── Column BBS ───────────────────────────────────────────────────────────────
// Inputs: spec (COLUMN), columnHeightFt, columnTypeDef (passed to stirrup
// length helper so circular vs rectangular shapes both work).
//
// longitudinal: one lap allowance per column lift, lap ≈ 50 × dia
// stirrups:     count = ceil(height_in / spacing_in); perimeter from helper
//               plus two 6-in hooks.
export function computeColumnBBS(spec, columnHeightFt, columnTypeDef) {
  if (!spec || !columnTypeDef || columnHeightFt <= 0) {
    return { longitudinalKg: 0, stirrupKg: 0, totalKg: 0 }
  }
  const lapFt = spec.lapLengthMultiplier * spec.longitudinalBarDiaMm * FT_PER_MM
  const longitudinalLengthFt = columnHeightFt + lapFt
  const longitudinalKg = kgFor(spec.longitudinalBarCount, longitudinalLengthFt, spec.longitudinalBarDiaMm)

  const coverIn = spec.coverMm / MM_PER_IN
  const perStirrupFt = getColumnStirrupLengthFt(columnTypeDef, coverIn) + 2 * DEFAULT_HOOK_LENGTH_FT
  const stirrupCount = Math.ceil((columnHeightFt * 12) / spec.stirrupSpacingIn)
  const stirrupKg = kgFor(stirrupCount, perStirrupFt, spec.stirrupBarDiaMm)

  return {
    longitudinalKg,
    stirrupKg,
    totalKg: longitudinalKg + stirrupKg,
  }
}

// ── Beam BBS ─────────────────────────────────────────────────────────────────
// Inputs: spec (BEAM), lengthFt, widthIn, depthIn.
export function computeBeamBBS(spec, lengthFt, widthIn, depthIn) {
  if (!spec || lengthFt <= 0) {
    return { topKg: 0, bottomKg: 0, stirrupKg: 0, totalKg: 0 }
  }
  const topKg    = kgFor(spec.topBars.count,    lengthFt, spec.topBars.diaMm)
  const bottomKg = kgFor(spec.bottomBars.count, lengthFt, spec.bottomBars.diaMm)

  const coverIn = spec.coverMm / MM_PER_IN
  const wFt = Math.max(0, (widthIn - 2 * coverIn) / 12)
  const dFt = Math.max(0, (depthIn - 2 * coverIn) / 12)
  const perStirrupFt = 2 * (wFt + dFt) + 2 * DEFAULT_HOOK_LENGTH_FT
  const stirrupCount = Math.ceil((lengthFt * 12) / spec.stirrupSpacingIn)
  const stirrupKg = kgFor(stirrupCount, perStirrupFt, spec.stirrupBarDiaMm)

  return {
    topKg,
    bottomKg,
    stirrupKg,
    totalKg: topKg + bottomKg + stirrupKg,
  }
}

// ── Footing BBS ──────────────────────────────────────────────────────────────
// Inputs: spec (FOOTING), lengthFt, widthFt. Each bar runs full length/width
// plus development length on both ends.
export function computeFootingBBS(spec, lengthFt, widthFt) {
  if (!spec || lengthFt <= 0 || widthFt <= 0) {
    return { xKg: 0, yKg: 0, totalKg: 0 }
  }
  const maxDiaMm = Math.max(spec.xBars.diaMm, spec.yBars.diaMm)
  // dev length: (mult × dia[mm]) → m → ft
  const devLengthFt = (spec.developmentLengthMultiplier * maxDiaMm) / 1000 / FT_PER_M
  const xBarLengthFt = widthFt  + 2 * devLengthFt
  const yBarLengthFt = lengthFt + 2 * devLengthFt
  const xKg = kgFor(spec.xBars.count, xBarLengthFt, spec.xBars.diaMm)
  const yKg = kgFor(spec.yBars.count, yBarLengthFt, spec.yBars.diaMm)
  return { xKg, yKg, totalKg: xKg + yKg }
}

// ── Slab BBS ─────────────────────────────────────────────────────────────────
// Inputs: spec (SLAB), areaFt2, spanFt, widthFt.
// Approximates rectangular slab; two-way slabs double the steel (both directions
// take full main bar grid).
export function computeSlabBBS(spec, areaFt2, spanFt, widthFt) {
  if (!spec || spanFt <= 0 || widthFt <= 0) {
    return { mainKg: 0, distKg: 0, totalKg: 0, mainBarCount: 0, distBarCount: 0 }
  }
  const mainBarCount = Math.floor((widthFt * 12) / spec.mainBarSpacingIn) + 1
  const distBarCount = Math.floor((spanFt  * 12) / spec.distBarSpacingIn) + 1
  const mainKg = kgFor(mainBarCount, spanFt,  spec.mainBarDiaMm)
  const distKg = kgFor(distBarCount, widthFt, spec.distBarDiaMm)
  const twoWayMultiplier = spec.twoWay ? 2 : 1
  return {
    mainBarCount,
    distBarCount,
    mainKg,
    distKg,
    totalKg: (mainKg + distKg) * twoWayMultiplier,
  }
}
