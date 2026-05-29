// IS 2502 / SP 34 cutting-length engine + override-able parameter catalog.
//
// 2026-05-28. The single source of truth for every bend deduction, hook
// allowance, development length, lap length, crank geometry, and standard
// bar length used by the BBS generators. No magic numbers in
// src/bbs/generators/ — every constant is read through getIs2502Params(state)
// so a project can override any factor via projectSettings.is2502Params
// without code edits.
//
// Pure module. No React, no DOM, no Zustand. Node-testable.
//
// Research base (Indian individual-home residential practice, 2026-05-28):
//   • IS 2502:1963 — bar bending allowances (2d per 90°, 1d per 45°, 3d per 135°, 4d per 180°)
//   • IS 456:2000 Cl 26.2.1 — development length Ld (Fe500 / M20 tension = 56.6d ≈ 57d;
//     compression ≈ 0.8 × tension = 45.3d)
//   • IS 13920:2016 — seismic detailing: confinement zone at column/beam ends,
//     lap_seismic = 1.3 × Ld
//   • SP 34 — hook allowance 9d per end is the universally-cited site
//     shorthand for TMT 90° hooks (Fe500D)
//   • Indian market: TMT bars sold in 12 m bundles standard; 6 m / 9 m at
//     premium. (User has chosen explicit UI dropdown — default stays 6 m today
//     per existing reinforcementSpecs.STANDARD_BAR_LENGTH_M. The default lives
//     in reinforcementSpecs.js so this catalog tracks IS-correct logic separate
//     from procurement preference.)
//   • Chennai residential reality: Zone III mandates IS 13920 but small
//     contractors rarely implement confinement zones — confinementZoneEnabled
//     defaults FALSE to match practice; user opts in per project.
//
// All linear dimensions in this module are in mm unless suffixed _ft.
// All bend deductions multiply diameter (d), not an absolute length.

export const CATALOG_VERSION = '2026-05-29-IS-2502-V2'
export const CATALOG_SOURCE  = 'IS 2502:1963 + IS 456:2000 + IS 13920:2016 + IS 4326:2013 + SP 34:1987'

// ── Default IS 2502 parameter catalog ──────────────────────────────────────
// Every BBS computation reads through getIs2502Params(state) which deep-merges
// projectSettings.is2502Params over these defaults. Adding a new factor:
// add it here; consumers automatically read it via the params object.
export const DEFAULT_IS2502_PARAMS = Object.freeze({
  // IS 2502:1963 Table 1 — bend deductions per bend angle, in diameters (d).
  // Total cutting length = sum of straight segments + sum of arc lengths.
  // Cutting length per IS 2502 is the actual length of bar BEFORE bending
  // (i.e. straight stock to be cut), computed as nominal centerline length
  // MINUS the deductions per bend (because the centerline traces a
  // longer path through each bend than a sharp-corner abstraction).
  bendDeductionPerBend: Object.freeze({
    45:  1,   // 45° bend = 1d deduction
    90:  2,   // 90° bend = 2d deduction
    135: 3,   // 135° bend (typical stirrup hook end angle) = 3d deduction
    180: 4,   // 180° bend (semi-circular / U-hook) = 4d deduction
  }),

  // SP 34 + site practice: standard TMT 90° hook allowance per end = 9d.
  // (IS 2502 strict formula k=4 HYSD gives ~13d; 9d is the universally
  // applied site shorthand for Fe500D and is what every Chennai contractor
  // schedules to.) Used on stirrup hooks AND on L-shape end anchorages.
  hookAllowance9d: 9,

  // Stirrup hook bend angle (the closure bend at each tail end of a
  // closed link). IS 13920 mandates 135° hooks in seismic zones; older
  // construction uses 90°. Default 135° per current IS code; flips to
  // 90° if the project opts out of seismic detailing entirely.
  stirrupHookAngleDeg: 135,

  // Standard procurement bar length (m). Indian residential market reality
  // is 12 m bundles; user has chosen to keep the existing reinforcementSpecs
  // default of 6 m and surface a UI choice. Reading order at compute time:
  //   projectSettings.bbsDefaults.standardBarLengthM      ← user-set
  //   ?? params.standardBarLengthM                        ← this catalog
  //   ?? STANDARD_BAR_LENGTH_M (reinforcementSpecs.js)    ← legacy fallback
  standardBarLengthM: 12,

  // Development length Ld factor, in diameters (d). IS 456 Cl 26.2.1 derives
  // Ld = (φ × σs) / (4 × τbd). For Fe500 in M20 concrete (residential
  // standard), Ld_tension ≈ 56.6d. Compression Ld is typically 0.8 × tension.
  //
  // The 'simplified' entries match site shorthand ("40d", "50d") that some
  // contractors still use. They are non-compliant for Fe500 but documented
  // here so a project can opt into the legacy figure if needed.
  developmentLengthFactor: Object.freeze({
    Fe500_M20_tension:     56.6,
    Fe500_M20_compression: 45.3,
    Fe500_M25_tension:     48.5,
    Fe500_M25_compression: 38.8,
    Fe415_M20_tension:     47.0,
    // Fe550D (BBS-categories phase 2026-05-29). Ld = φ·(0.87·550)/(4·τbd).
    // M20 τbd(deformed) = 1.92 MPa → 62.3d; compression 0.8× = 49.8d.
    // M25 τbd(deformed) = 2.24 MPa → 53.4d; compression 0.8× = 42.7d.
    Fe550_M20_tension:     62.3,
    Fe550_M20_compression: 49.8,
    Fe550_M25_tension:     53.4,
    Fe550_M25_compression: 42.7,
    simplified_tension:    50,    // legacy site shorthand
    simplified_compression: 40,
  }),

  // Lap length factor, in diameters (d). Non-seismic = Ld (IS 456).
  // Seismic = 1.3 × Ld (IS 13920 Cl 6.2.6 for tension lap in flexural
  // members; columns use 7.6.1.2 with closer ties through the lap).
  lapLengthFactor: Object.freeze({
    Fe500_M20_nonseismic:  56.6,
    Fe500_M20_seismic:     73.6,  // 1.3 × 56.6
    Fe415_M20_nonseismic:  47.0,
    Fe550_M20_nonseismic:  62.3,
    Fe550_M20_seismic:     81.0,  // 1.3 × 62.3
    simplified:            50,    // legacy site shorthand
  }),

  // Default grade combination — used when a spec doesn't carry one.
  // Chennai residential standard is Fe500D + M20 (some Zone III engineers
  // specify M25 minimum for columns). Site rule-of-thumb '50d lap' implies
  // 'simplified' entries.
  defaultGradeKey: 'Fe500_M20_tension',
  defaultLapKey:   'Fe500_M20_nonseismic',

  // Crank bar geometry (slab top-bend bars). IS 456 implicit + SP 34 Fig 3.5.
  crankAngleDeg:                45,
  // Extra cutting length added per crank = factor × effective depth (D - 2×cover).
  // Geometric: a 45° crank of vertical rise D adds (D × √2) - D = 0.414 D ≈ 0.42 D.
  crankExtraLengthFactor:       0.42,
  // Crank position from the support face, as a fraction of the slab span.
  // Indian residential convention = L/4 (IS 456 + SP 34); some textbooks
  // use L/7 for short spans.
  crankPositionFromSupport:     0.25,
  // Fraction of main bars that are cranked (the remainder run straight).
  // Site practice: alternate bars cranked = 0.5.
  crankFraction:                0.5,

  // IS 13920 seismic confinement zone — close-spaced stirrups at column ends
  // (Cl 7.4) and beam ends (Cl 6.3.5).
  //
  // confinementZoneEnabled defaults FALSE — matches site reality across
  // Chennai residential. Engineers opt in per project. When ON, the column
  // and beam generators emit a separate STIRRUP_ZONE group at close spacing
  // for the confinement length on each end.
  confinementZoneEnabled:       false,
  // Column confinement length lo = max(largest section dim, height/6, 450mm).
  columnConfinementLengthMinMm: 450,
  columnConfinementHeightDivisor: 6,
  // Column confinement spacing within lo = min(d/4, 6 × longitudinalBarDia, 100mm).
  columnConfinementMaxSpacingMm: 100,
  columnConfinementDFactor:     0.25,    // d/4
  columnConfinementBarFactor:   6,       // 6 × longitudinalBarDia
  // Beam confinement length = 2 × beam depth (IS 13920 Cl 6.3.5).
  beamConfinementLengthDepthFactor: 2,
  // Beam confinement spacing within zone = min(d/4, 8 × smallestBarDia, 100mm).
  beamConfinementMaxSpacingMm:  100,
  beamConfinementDFactor:       0.25,
  beamConfinementBarFactor:     8,

  // ── BBS-categories phase (2026-05-29) — element-specific anchorage /
  // geometry FACTORS. These are IS-derived multipliers only; the bar
  // dia/count/spacing for each element live in reinforcementSpecs (per the
  // locked rule: specs are per-element, this catalog holds IS factors).

  // Sunshade / chajja (cantilever above an opening). Top steel only. Main
  // bars anchor INTO the lintel band by a development length; the cantilever
  // bar runs the projection + a down-turn at the free edge (small hook).
  // factor × Ld_tension(mainDia) embedded into the lintel.
  sunshadeAnchorageIntoLintelFactor: 1.0,
  // Free-edge down-turn of the top bar = factor × slab(sunshade) thickness.
  sunshadeEdgeTurnFactor:            1.0,

  // Loft (RCC shelf cast into wall). Top + bottom bars embed into the wall
  // for bearing. Embed = max(loftEmbedMinMm, factor × Ld_tension(dia)).
  loftEmbedMinMm:                    230,   // ~9in min bearing into masonry/RCC
  loftEmbedFactor:                   1.0,   // × Ld_tension

  // Staircase waist slab. Main bars run the inclined going and anchor INTO
  // the landing slab/beam by a development length at each end.
  staircaseLandingAnchorageFactor:   1.0,   // × Ld_tension(mainDia)

  // Strap footing. Strap-beam top/bottom bars anchor OVER the two pads by a
  // development length past each pad face.
  strapBeamAnchorageFactor:          1.0,   // × Ld_tension(barDia)

  // Sub/super structure column split. OFF by default — a single column emits
  // one LONGITUDINAL group (today's behaviour, keeps verify-bbs Section C
  // green). When true, base-floor columns split into a SUB stub (footing-top →
  // grade beam) + SUPER run(s), reported as separate abstract categories.
  subSuperColumnSplitEnabled:        false,

  // Sub/super structure column. The sub-column (footing-top → grade beam)
  // longitudinal bars lap with the dowels below and the super-column bars
  // above. Lap = factor × lap length.
  subColumnLapFactor:                1.0,   // × lap length at the grade-beam transition
  // Default grade-beam soffit level above footing top, as a fraction of the
  // base-floor plinth height, when no explicit level is given. The sub-column
  // segment spans footing-top → grade-beam soffit. 1.0 = full plinth height.
  gradeBeamLevelPlinthFraction:      1.0,

  // RCC seismic bands (tie + lintel) per IS 4326. Bands run continuous along
  // walls; site practice (Chennai residential) uses UNIFORM links — no IS
  // 13920 confinement zone. Continuity/corner anchorage = factor × Ld.
  bandBeamCornerAnchorageFactor:     1.0,   // × Ld_tension at band ends/corners

  // Steel grade label (passed through to RebarGroup output for the
  // schedule table). Pure metadata.
  defaultSteelGrade:            'Fe500D',
})

// ── SITE_PRACTICE allowance preset ───────────────────────────────────────────
// Indian site BBS shorthand (extracted from the Karthick M-City workbook):
// 50d lap, NO bend deductions, FLAT ft hook/bend allowances per bar role.
// Merged UNDER the user's is2502Params (user overrides still win) only when
// projectSettings.bbsAllowanceMode === 'SITE_PRACTICE'. IS_STRICT (default)
// never touches this. This is the expansion point for future regional presets
// (KARNATAKA_PWD, BANGALORE_STANDARD) — add a preset + a mode value.
export const SITE_PRACTICE_PARAMS = Object.freeze({
  lapLengthFactor: Object.freeze({
    Fe500_M20_nonseismic: 50, Fe500_M20_seismic: 50,
    Fe415_M20_nonseismic: 50,
    Fe550_M20_nonseismic: 50, Fe550_M20_seismic: 50,
    simplified: 50,
  }),
  // Site practice doesn't subtract IS 2502 bend deductions.
  bendDeductionPerBend: Object.freeze({ 45: 0, 90: 0, 135: 0, 180: 0 }),
  // Flat ft allowances by bar role (replace dia-based 9d hooks / Ld anchorage).
  flatAllowancesFt: Object.freeze({
    stirrupHookFt:       0.26248,  // workbook stirrup hook term (≈80 mm)
    footingHookFt:       0.25,     // 3" footing bar end hook
    beamTopBendFt:       0.75,     // 9" top-rod end bend
    beamBottomBendFt:    0.5,      // 6" bottom-rod end bend
    sunshadeAnchorageFt: 0.167,    // 2" anchorage into lintel
  }),
})

// ── Single read point for params ────────────────────────────────────────────
// Deep-merges (DEFAULT → [SITE_PRACTICE if mode] → user is2502Params). Nested
// object overrides merge one level deep. Stamps `allowanceMode` so the
// allowanceMm() resolver can switch. Pure function of state.projectSettings.
export function getIs2502Params(state) {
  const mode = state?.projectSettings?.bbsAllowanceMode === 'SITE_PRACTICE'
    ? 'SITE_PRACTICE' : 'IS_STRICT'
  const layers = mode === 'SITE_PRACTICE'
    ? [SITE_PRACTICE_PARAMS, state?.projectSettings?.is2502Params ?? {}]
    : [state?.projectSettings?.is2502Params ?? {}]
  const merged = { ...DEFAULT_IS2502_PARAMS }
  for (const overrides of layers) {
    for (const [k, v] of Object.entries(overrides)) {
      const dv = merged[k]
      if (dv && typeof dv === 'object' && !Array.isArray(dv) &&
          v && typeof v === 'object' && !Array.isArray(v)) {
        merged[k] = { ...dv, ...v }
      } else {
        merged[k] = v
      }
    }
  }
  merged.allowanceMode = mode
  return merged
}

// ── Allowance resolver (CLOSED kind enum, mode is the ONLY switch) ───────────
// Generators call allowanceMm({ kind, diaMm, params }) for hooks / bends /
// anchorage / lap — they NEVER inspect params.allowanceMode themselves. This is
// the single place the IS_STRICT ↔ SITE_PRACTICE convention difference lives.
//   IS_STRICT     → dia-based: 9d hooks, Ld anchorage, 56.6d lap.
//   SITE_PRACTICE → flat ft per role + 50d lap (via the merged factors).
// Adding a regional preset = a new SITE-style params block + a mode value;
// the kind enum stays closed.
export function allowanceMm({ kind, diaMm, params }) {
  if (!params || !diaMm) return 0
  const site = params.allowanceMode === 'SITE_PRACTICE'
  const flat = params.flatAllowancesFt ?? {}
  const d9 = params.hookAllowance9d * diaMm
  switch (kind) {
    case 'lap':
      // lap factor is already swapped to 50 by the SITE merge.
      return lapLengthMm({ diaMm, lapKey: params.defaultLapKey, params })
    case 'stirrupHook':
      return site ? (flat.stirrupHookFt ?? 0.26248) * MM_PER_FT : d9
    case 'footingHook':
      return site ? (flat.footingHookFt ?? 0.25) * MM_PER_FT : d9
    // Beam anchorage folds the IS exterior 9d hook into the exterior anchor so
    // the generator can drop hookEndCount and stay byte-identical in IS_STRICT.
    case 'beamTopAnchorExterior':
      return site ? (flat.beamTopBendFt ?? 0.75) * MM_PER_FT
                  : developmentLengthMm({ diaMm, params }) + d9
    case 'beamTopAnchorInterior':
      return site ? (flat.beamTopBendFt ?? 0.75) * MM_PER_FT
                  : developmentLengthMm({ diaMm, params }) * 0.5
    case 'beamBottomAnchorExterior':
      return site ? (flat.beamBottomBendFt ?? 0.5) * MM_PER_FT
                  : developmentLengthMm({ diaMm, params }) + d9
    case 'beamBottomAnchorInterior':
      return site ? (flat.beamBottomBendFt ?? 0.5) * MM_PER_FT
                  : developmentLengthMm({ diaMm, params }) * 0.5
    case 'sunshadeAnchorage':
      return site ? (flat.sunshadeAnchorageFt ?? 0.167) * MM_PER_FT
                  : (params.sunshadeAnchorageIntoLintelFactor ?? 1) * developmentLengthMm({ diaMm, params })
    default:
      return 0
  }
}

// ── IS 1786 unit weight ─────────────────────────────────────────────────────
// D² / 162 kg/m — the universal Indian formula. Accurate to ~0.5% vs the
// IS 1786 tabular weights for Fe500D TMT. Used by all generators.
export function unitWeightKgPerM(diaMm) {
  if (!diaMm || diaMm <= 0) return 0
  return (diaMm * diaMm) / 162
}

// ── Cutting-length engine ───────────────────────────────────────────────────
// Returns cutting length in mm given:
//   straightSegmentsMm: array of straight-segment lengths (mm). Sum is the
//     nominal centerline path length (before bend deductions).
//   bendAnglesDeg:      array of bend angles in degrees (one per bend
//     between consecutive straight segments). Length = straightSegments - 1
//     for an open bar, OR straightSegments for a closed link (last bend
//     joins the start).
//   diaMm:              bar diameter (mm). All bend deductions and hook
//     allowances scale with this.
//   hookEndCount:       number of standard 9d hooks at the bar ends (0, 1, or 2).
//     A closed stirrup adds hooks at the closure tails; an L-bar adds none.
//   params:             IS 2502 parameter object from getIs2502Params(state).
//
// Cutting length formula (IS 2502 + SP 34):
//   cuttingLengthMm = ΣstraightSegmentsMm
//                   - Σ(bendDeductionPerBend[angle] × diaMm)
//                   + hookEndCount × (hookAllowance9d × diaMm)
//
// The hook allowance is ADDED because the 9d figure represents the EXTRA
// stock needed past the nominal end of the bar to form the hook return.
// Bend deductions are SUBTRACTED because the nominal centerline overstates
// the actual stock needed by the arc-vs-corner difference.
export function computeCuttingLengthMm({
  straightSegmentsMm,
  bendAnglesDeg = [],
  diaMm,
  hookEndCount = 0,
  params,
}) {
  if (!Array.isArray(straightSegmentsMm) || straightSegmentsMm.length === 0) return 0
  if (!diaMm || diaMm <= 0) return 0
  if (!params) return 0

  const nominal = straightSegmentsMm.reduce((s, x) => s + (x > 0 ? x : 0), 0)
  let deduction = 0
  for (const angle of bendAnglesDeg) {
    const factor = params.bendDeductionPerBend?.[angle]
    if (typeof factor === 'number') {
      deduction += factor * diaMm
    }
    // Unknown angles silently contribute 0 deduction — caller's responsibility
    // to use supported angles (45/90/135/180). Generators only emit those.
  }
  const hookAddition = hookEndCount * params.hookAllowance9d * diaMm
  const cl = nominal - deduction + hookAddition
  return Math.max(0, cl)
}

// Closed rectangular stirrup / link — convenience wrapper. The four sides
// of the rectangle PLUS the two hook tails at the closure end. Four 90° bends
// at the corners; the closure hooks are accounted via hookEndCount=2.
//
// netWidthMm / netDepthMm are INSIDE the stirrup (already cover-deducted).
export function computeStirrupCuttingLengthMm({ netWidthMm, netDepthMm, diaMm, params }) {
  // Hook allowance routed through allowanceMm (9d in IS_STRICT, flat ft in
  // SITE_PRACTICE). Added as explicit segments with hookEndCount:0 so the
  // IS_STRICT result is byte-identical to the prior hookEndCount:2 form.
  const hook = allowanceMm({ kind: 'stirrupHook', diaMm, params })
  return computeCuttingLengthMm({
    straightSegmentsMm: [netWidthMm, netDepthMm, netWidthMm, netDepthMm, hook, hook],
    bendAnglesDeg:      [90, 90, 90, 90],
    diaMm,
    hookEndCount:       0,
    params,
  })
}

// L-shaped bar (e.g. dowel: vertical embed into footing + horizontal lap-up
// projection into column). One 90° bend; no hook ends.
export function computeLBarCuttingLengthMm({ legAmm, legBmm, diaMm, params }) {
  return computeCuttingLengthMm({
    straightSegmentsMm: [legAmm, legBmm],
    bendAnglesDeg:      [90],
    diaMm,
    hookEndCount:       0,
    params,
  })
}

// Straight bar — trivial wrapper. No bends, no hooks (or hookEndCount=N
// if footing/slab end anchorage adds them).
export function computeStraightBarCuttingLengthMm({ lengthMm, diaMm, hookEndCount = 0, params }) {
  return computeCuttingLengthMm({
    straightSegmentsMm: [lengthMm],
    bendAnglesDeg:      [],
    diaMm,
    hookEndCount,
    params,
  })
}

// Cranked slab bar (shape 03 — SP 34 Fig 3.5). Geometry:
//   ┌─ topLengthMm ─┐
//   ╲              ╲                        ↕ verticalRiseMm = effectiveDepthMm
//    ╲ slope ≈ 45° ╲                          (= slab thickness - 2 × cover)
//     ╲            ╲
//   ──┘            └── bottomLengthMm
//
// Cutting length = bottomLengthMm + topLengthMm + 2 × inclinedSegment
//   inclinedSegment ≈ verticalRiseMm × √2  (45° geometry)
//   then subtract 2 × bend deduction at 45°.
//
// This routine accepts both "long bar" inputs (bottomLengthMm + topLengthMm)
// and lets the caller derive them from span + crankPositionFromSupport.
export function computeCrankBarCuttingLengthMm({
  bottomLengthMm,
  topLengthMm,
  verticalRiseMm,
  crankAngleDeg = 45,
  diaMm,
  params,
}) {
  if (!params) return 0
  const inclinedMm = verticalRiseMm / Math.sin((crankAngleDeg * Math.PI) / 180)
  return computeCuttingLengthMm({
    straightSegmentsMm: [bottomLengthMm, inclinedMm, topLengthMm, inclinedMm],
    bendAnglesDeg:      [crankAngleDeg, crankAngleDeg, crankAngleDeg],
    diaMm,
    hookEndCount:       0,
    params,
  })
}

// ── Lap and development length helpers ──────────────────────────────────────
// Resolve a lap or development length in mm given a diameter and a key into
// the catalog. Falls through to the catalog defaultGradeKey / defaultLapKey
// when the explicit key isn't set.
export function developmentLengthMm({ diaMm, gradeKey, params }) {
  if (!diaMm || !params) return 0
  const key = gradeKey ?? params.defaultGradeKey
  const factor = params.developmentLengthFactor?.[key]
    ?? params.developmentLengthFactor?.[params.defaultGradeKey]
    ?? 0
  return factor * diaMm
}

export function lapLengthMm({ diaMm, lapKey, params }) {
  if (!diaMm || !params) return 0
  const key = lapKey ?? params.defaultLapKey
  const factor = params.lapLengthFactor?.[key]
    ?? params.lapLengthFactor?.[params.defaultLapKey]
    ?? 0
  return factor * diaMm
}

// Compression development length (used for dowels embedding into footings).
// IS 456 Cl 26.2.2.2 — Ld_compression = 0.8 × Ld_tension.
export function developmentLengthCompressionMm({ diaMm, gradeKey, params }) {
  if (!diaMm || !params) return 0
  const key = (gradeKey ?? params.defaultGradeKey).replace('_tension', '_compression')
  const factor = params.developmentLengthFactor?.[key]
  if (typeof factor === 'number') return factor * diaMm
  // Fall back to 0.8 × tension if a paired compression entry is missing.
  return 0.8 * developmentLengthMm({ diaMm, gradeKey, params })
}

// ── Unit conversions used by generators ─────────────────────────────────────
export const MM_PER_FT = 304.8
export const MM_PER_IN = 25.4

export function ftToMm(ft) { return ft * MM_PER_FT }
export function inToMm(inches) { return inches * MM_PER_IN }
export function mmToM(mm) { return mm / 1000 }
