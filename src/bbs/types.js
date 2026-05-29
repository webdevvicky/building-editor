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
})

// IS 2502 shape codes used by the generators. Real IS 2502 has dozens;
// these are the ones residential BBS actually uses.
export const SHAPE_CODE = Object.freeze({
  STRAIGHT:        '00',  // Straight bar, no bends
  STRAIGHT_HOOK1:  '01',  // Straight bar with one 90° hook end (rare)
  STRAIGHT_HOOK2:  '02',  // Straight bar with two hook ends
  CRANKED:         '03',  // Cranked slab bar (45° cranks at L/4)
  L_BAR:           '11',  // L-shaped (one 90° bend) — dowels
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
    meta:       Object.freeze({ ...meta }),
  }
}
