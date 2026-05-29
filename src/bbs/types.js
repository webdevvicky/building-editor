// RebarGroup — the bar-member abstraction.
//
// 2026-05-28. A RebarGroup represents one batch of identical bars (same
// shape, same dia, same cutting length) belonging to a single structural
// element. It is the unit of an IS 2502 / SP 34 Bar Bending Schedule line.
//
// RebarGroups are PURE COMPUTED OBJECTS — never persisted to the project
// file. computeRebarGroups(state) regenerates them deterministically from
// state on every call. The existing computeBBSQuantities() output (aggregate
// kg by role + kg by diameter) is now a reduction over computeRebarGroups
// — backward-compat invariant: sum of RebarGroup totalWeightKg per category
// must equal computeBBSQuantities[category]Kg within rounding tolerance.
//
// Shape (documented as JSDoc; not exported as TypeScript types — this
// codebase is plain JS):
//
//   /**
//    * @typedef {Object} RebarGroup
//    * @property {string}   markId              Bar mark, e.g. 'C1-L', 'F2-X', 'S1-M', 'C1-D'.
//    *                                          Format: <elementMark>-<roleCode> with optional
//    *                                          -<zone> suffix for confinement zones, e.g. 'C1-S-Z'.
//    *                                          Stable across renders for a given (entity, role) pair.
//    * @property {ElementType} elementType      'COLUMN' | 'BEAM' | 'FOOTING' | 'SLAB'
//    * @property {string}   elementId           Entity id. For wall-derived beams, format:
//    *                                          `${wallId}::${beamClass}` (no entity exists).
//    * @property {string}   floorId             Floor that owns the parent element.
//    *                                          For dowels: the floor of the column the dowels feed.
//    * @property {Role}     role                'LONGITUDINAL' | 'STIRRUP' | 'STIRRUP_ZONE' |
//    *                                          'TOP' | 'BOTTOM' | 'MAIN' | 'CRANK' | 'DIST' |
//    *                                          'X_MESH' | 'Y_MESH' | 'DOWEL' | 'EXTRA_TOP'
//    * @property {number}   diaMm               Bar diameter (mm). One of 8/10/12/16/20/25/32.
//    * @property {string}   shapeCode           IS 2502 shape code, e.g. '00' (straight),
//    *                                          '11' (L-bar), '75' (closed stirrup), '03' (cranked).
//    * @property {number[]} bendAnglesDeg       List of bends in this shape, e.g.
//    *                                          [] for straight, [90] for L-bar,
//    *                                          [90,90,90,90] for closed stirrup,
//    *                                          [45,45,45] for cranked main bar.
//    * @property {Object}   nominalDimensions   Sketch dimensions (mm) labeled by axis.
//    *                                          { A, B, C, D } per IS 2502 convention.
//    *                                          Each generator documents which letter means what.
//    * @property {number}   cuttingLengthMm     Cutting length BEFORE bending — what site procurement cuts to.
//    * @property {number}   count               Number of identical bars in this group.
//    * @property {number}   unitWeightKgPerM    D²/162.
//    * @property {number}   totalLengthM        count × cuttingLengthMm / 1000.
//    * @property {number}   totalWeightKg       totalLengthM × unitWeightKgPerM.
//    * @property {string|null} specId           Resolved reinforcement spec id (null = ESTIMATE).
//    * @property {Source}   specSource          'INSTANCE' | 'TYPE' | 'CLASS' | 'PROJECT_DEFAULT' | 'ESTIMATE'
//    * @property {string}   steelGrade          'Fe500D' typical — metadata for schedule.
//    * @property {Object}   meta                Free-form per-generator extras: { description,
//    *                                          parentMark, zone, anchorageLengthMm, lapLengthMm, ... }
//    */
//
// markId conventions:
//   'C1-L'        → column 1, longitudinal
//   'C1-S'        → column 1, uniform stirrups
//   'C1-S-Z'     → column 1, stirrups in confinement zone (when IS 13920 enabled)
//   'C1-D'        → dowels feeding into column 1
//   'F1-X' / 'F1-Y' → footing 1, X and Y mesh
//   'F1-D'        → dowels rising from footing 1
//   'B1-T' / 'B1-B' / 'B1-S'  → beam 1 top / bottom / stirrups
//   'S1-M' / 'S1-D' / 'S1-C' / 'S1-ET' → slab 1 main / distribution / crank / extra-top

export const ELEMENT_TYPE = Object.freeze({
  COLUMN:  'COLUMN',
  BEAM:    'BEAM',
  FOOTING: 'FOOTING',
  SLAB:    'SLAB',
  // BBS-categories phase (2026-05-29): elements with no entity of their own;
  // derived from existing model data (openings / walls / staircase entity).
  SUNSHADE:  'SUNSHADE',   // chajja — cantilever above window openings
  LOFT:      'LOFT',       // RCC storage shelf cast into a wall
  STAIRCASE: 'STAIRCASE',  // waist-slab dog-legged stair (from staircase entity)
})

export const REBAR_ROLE = Object.freeze({
  LONGITUDINAL: 'LONGITUDINAL',
  STIRRUP:      'STIRRUP',
  STIRRUP_ZONE: 'STIRRUP_ZONE',
  TOP:          'TOP',
  BOTTOM:       'BOTTOM',
  MAIN:         'MAIN',
  CRANK:        'CRANK',
  DIST:         'DIST',
  X_MESH:       'X_MESH',
  Y_MESH:       'Y_MESH',
  DOWEL:        'DOWEL',
  EXTRA_TOP:    'EXTRA_TOP',
  // BBS-categories phase additions:
  MID:          'MID',      // strap-beam mid/side face bars
  WAIST:        'WAIST',    // staircase waist-slab main bars (bent at landing)
  TREAD:        'TREAD',    // staircase tread/step bars
  LANDING:      'LANDING',  // staircase landing-slab bars
})

// IS 2502 shape codes used by the generators. Real IS 2502 has dozens;
// these are the ones residential BBS actually uses.
export const SHAPE_CODE = Object.freeze({
  STRAIGHT:        '00',  // Straight bar, no bends
  STRAIGHT_HOOK1:  '01',  // Straight bar with one 90° hook end (rare)
  STRAIGHT_HOOK2:  '02',  // Straight bar with two hook ends
  CRANKED:         '03',  // Cranked slab bar (45° cranks at L/4)
  L_BAR:           '11',  // L-shaped (one 90° bend) — dowels, sunshade/loft anchorage
  TWO_BEND:        '21',  // Z / double-90° bent bar — staircase waist (landing→going→landing)
  U_BAR:           '38',  // U-shaped (two 90° bends) — slab edge bars
  CLOSED_STIRRUP:  '75',  // Closed rectangular stirrup with 135° hooks
})

export const REBAR_SOURCE = Object.freeze({
  INSTANCE:        'INSTANCE',
  TYPE:            'TYPE',
  CLASS:           'CLASS',
  PROJECT_DEFAULT: 'PROJECT_DEFAULT',
  WALL_INSTANCE:   'WALL_INSTANCE',   // BBS-4: wall.wallBeamSpecs override for wall-derived beams
  ESTIMATE:        'ESTIMATE',
})

// Helper factory — used by every generator to keep the output shape uniform.
// Computes totalLengthM + totalWeightKg from cuttingLengthMm + count + diaMm
// so callers can't forget. Returns a frozen object; the generator may layer
// per-element meta via the meta arg.
export function makeRebarGroup({
  markId,
  elementType,
  elementId,
  floorId,
  role,
  diaMm,
  shapeCode,
  bendAnglesDeg,
  nominalDimensions,
  cuttingLengthMm,
  count,
  specId,
  specSource,
  steelGrade,
  bbsCategory,   // optional top-level abstract category; merged into meta
  meta = {},
}) {
  const unitWeightKgPerM = (diaMm * diaMm) / 162
  const totalLengthM = (count * cuttingLengthMm) / 1000
  const totalWeightKg = totalLengthM * unitWeightKgPerM
  return {
    markId,
    elementType,
    elementId,
    floorId,
    role,
    diaMm,
    shapeCode,
    bendAnglesDeg: Object.freeze([...bendAnglesDeg]),
    nominalDimensions: Object.freeze({ ...nominalDimensions }),
    cuttingLengthMm,
    count,
    unitWeightKgPerM,
    totalLengthM,
    totalWeightKg,
    specId:     specId ?? null,
    specSource: specSource ?? REBAR_SOURCE.ESTIMATE,
    steelGrade: steelGrade ?? 'Fe500D',
    // bbsCategory lives in meta. Top-level arg wins; else a generator may have
    // set meta.bbsCategory directly; else null (index.js falls back to a coarse
    // elementType-derived category).
    meta:       Object.freeze({ ...meta, bbsCategory: bbsCategory ?? meta.bbsCategory ?? null }),
  }
}

// ── BBS abstract category taxonomy ───────────────────────────────────────────
// The Level-2 roll-up (the "TOTAL / ABSTRACT" sheet of an Indian site BBS)
// groups bars by a finer taxonomy than ELEMENT_TYPE: it splits columns into
// sub/super structure, beams into tie/plinth/lintel/roof, footings into
// isolated vs strap, slabs into roof vs floor. Every generator stamps
// meta.bbsCategory with one of these. The existing elementType-keyed
// byCategory roll-up is UNCHANGED (backward-compat invariant); byBbsCategory
// is additive.
//
// Reference: Karthick M-City + Selvakumar BBS workbooks, "ABSTRACT/TOTAL"
// sheet rows (Footing, Column-Substructure, Tie Beam, Grade/Plinth Beam,
// Column-Super structure, Lintel/Head Beam, Sunshade, Loft, Staircase,
// Roof Beam, Roof Slab).
export const BBS_CATEGORY = Object.freeze({
  FOOTING:       'FOOTING',
  STRAP_FOOTING: 'STRAP_FOOTING',
  SUB_COLUMN:    'SUB_COLUMN',
  SUPER_COLUMN:  'SUPER_COLUMN',
  COLUMN:        'COLUMN',        // un-split / legacy column (no position)
  TIE_BEAM:      'TIE_BEAM',
  PLINTH_BEAM:   'PLINTH_BEAM',
  LINTEL_BEAM:   'LINTEL_BEAM',   // a.k.a. head beam
  ROOF_BEAM:     'ROOF_BEAM',
  BEAM:          'BEAM',          // generic explicit beam (no class mapping)
  SUNSHADE:      'SUNSHADE',
  LOFT:          'LOFT',
  STAIRCASE:     'STAIRCASE',
  ROOF_SLAB:     'ROOF_SLAB',
  FLOOR_SLAB:    'FLOOR_SLAB',
  SLAB:          'SLAB',          // generic slab (no role)
})

// Canonical display order for the Level-2 abstract (construction sequence,
// matching the reference workbook ABSTRACT row order).
export const BBS_CATEGORY_ORDER = Object.freeze([
  BBS_CATEGORY.FOOTING,
  BBS_CATEGORY.STRAP_FOOTING,
  BBS_CATEGORY.SUB_COLUMN,
  BBS_CATEGORY.COLUMN,
  BBS_CATEGORY.TIE_BEAM,
  BBS_CATEGORY.PLINTH_BEAM,
  BBS_CATEGORY.SUPER_COLUMN,
  BBS_CATEGORY.LINTEL_BEAM,
  BBS_CATEGORY.SUNSHADE,
  BBS_CATEGORY.LOFT,
  BBS_CATEGORY.STAIRCASE,
  BBS_CATEGORY.BEAM,
  BBS_CATEGORY.ROOF_BEAM,
  BBS_CATEGORY.ROOF_SLAB,
  BBS_CATEGORY.FLOOR_SLAB,
  BBS_CATEGORY.SLAB,
])

// Human label per category — for panel + export headers.
export const BBS_CATEGORY_LABEL = Object.freeze({
  FOOTING:       'Footing',
  STRAP_FOOTING: 'Strap Footing',
  SUB_COLUMN:    'Column — Substructure',
  SUPER_COLUMN:  'Column — Superstructure',
  COLUMN:        'Column',
  TIE_BEAM:      'Tie Beam',
  PLINTH_BEAM:   'Grade / Plinth Beam',
  LINTEL_BEAM:   'Lintel / Head Beam',
  ROOF_BEAM:     'Roof Beam',
  BEAM:          'Beam',
  SUNSHADE:      'Sunshade',
  LOFT:          'Loft',
  STAIRCASE:     'Staircase',
  ROOF_SLAB:     'Roof Slab',
  FLOOR_SLAB:    'Floor Slab',
  SLAB:          'Slab',
})

// ── Centralized bar-mark prefix registry (single source of truth) ────────────
// markId = `${getBarMarkPrefix(bbsCategory)}${seq}-${roleCode}` (e.g. SC1-L,
// TB3-T, CH2-M). ALL generators import this — no ad-hoc prefix strings. Exports
// (CSV / XLSX / PDF) read the same registry so marks stay consistent forever.
const BAR_MARK_PREFIX = Object.freeze({
  [BBS_CATEGORY.FOOTING]:       'F',
  [BBS_CATEGORY.STRAP_FOOTING]: 'SF',
  [BBS_CATEGORY.SUB_COLUMN]:    'SC',
  [BBS_CATEGORY.SUPER_COLUMN]:  'C',
  [BBS_CATEGORY.COLUMN]:        'C',
  [BBS_CATEGORY.TIE_BEAM]:      'TB',
  [BBS_CATEGORY.PLINTH_BEAM]:   'PB',
  [BBS_CATEGORY.LINTEL_BEAM]:   'HB',  // head beam
  [BBS_CATEGORY.ROOF_BEAM]:     'RB',
  [BBS_CATEGORY.BEAM]:          'B',
  [BBS_CATEGORY.SUNSHADE]:      'CH',  // chajja
  [BBS_CATEGORY.LOFT]:          'LF',
  [BBS_CATEGORY.STAIRCASE]:     'ST',
  [BBS_CATEGORY.ROOF_SLAB]:     'S',
  [BBS_CATEGORY.FLOOR_SLAB]:    'S',
  [BBS_CATEGORY.SLAB]:          'S',
})

export function getBarMarkPrefix(bbsCategory) {
  return BAR_MARK_PREFIX[bbsCategory] ?? 'X'
}

// ── Derivation helpers (centralized so generators don't re-derive) ───────────

// Beam behaviour: FRAME beams (plinth/roof/explicit) are moment-frame members
// — IS 13920 confinement applies when enabled. BAND beams (tie/lintel) are RCC
// seismic bands per IS 4326 — uniform links, continuity anchorage, no
// confinement zone. Stamped on every beam RebarGroup's meta.beamBehavior.
const BAND_BEAM_CLASSES = Object.freeze(new Set(['tie', 'lintel']))
export function beamBehaviorForClass(beamClass) {
  return BAND_BEAM_CLASSES.has(beamClass) ? 'BAND' : 'FRAME'
}

// Beam class → abstract category.
export function bbsCategoryForBeamClass(beamClass) {
  switch (beamClass) {
    case 'tie':    return BBS_CATEGORY.TIE_BEAM
    case 'plinth': return BBS_CATEGORY.PLINTH_BEAM
    case 'lintel': return BBS_CATEGORY.LINTEL_BEAM
    case 'roof':   return BBS_CATEGORY.ROOF_BEAM
    default:       return BBS_CATEGORY.BEAM
  }
}

// Slab structural role → abstract category.
export function bbsCategoryForSlabRole(role) {
  switch (role) {
    case 'ROOF':  return BBS_CATEGORY.ROOF_SLAB
    case 'FLOOR': return BBS_CATEGORY.FLOOR_SLAB
    default:      return BBS_CATEGORY.SLAB
  }
}

// Column segment position → abstract category.
export function bbsCategoryForColumnPosition(position) {
  switch (position) {
    case 'SUB':   return BBS_CATEGORY.SUB_COLUMN
    case 'SUPER': return BBS_CATEGORY.SUPER_COLUMN
    default:      return BBS_CATEGORY.COLUMN
  }
}
