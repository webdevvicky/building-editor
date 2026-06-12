// BOQ category + line-ID + scope-support registry.
//
// Single source of truth for every BOQ line ID emitted by src/boq/lines.js
// and src/boq/emitters/*.js. Raw string IDs MUST NOT appear inline in any
// emitter — always go through BOQ_LINE_IDS or one of the ID builder
// functions exported below.
//
// Grep guard: `grep -rn "id: '" src/boq/` must return zero matches.

// ── 1. Scope identifiers ─────────────────────────────────────────────────
// Every BOQ line declares which scopes it can be aggregated under. The
// UI filters visible lines by intersecting line.scopeSupport with the
// active scope.

export const BOQ_SCOPE = Object.freeze({
  PROJECT:   'PROJECT',
  FLOOR:     'FLOOR',
  ROOM:      'ROOM',
  ROOM_TYPE: 'ROOM_TYPE',
})

export const ALL_SCOPES = Object.freeze([
  BOQ_SCOPE.PROJECT, BOQ_SCOPE.FLOOR, BOQ_SCOPE.ROOM, BOQ_SCOPE.ROOM_TYPE,
])

export const PROJECT_AND_FLOOR_ONLY = Object.freeze([
  BOQ_SCOPE.PROJECT, BOQ_SCOPE.FLOOR,
])

// ── 2. Category identifiers ──────────────────────────────────────────────

export const BOQ_CATEGORIES = Object.freeze({
  // Room-attributable (per-room breakdown supported)
  FINISHES:        'finishes',
  MASONRY:         'masonry',
  PLASTER:         'plaster',
  TILES:           'tiles',
  JOINERY:         'joinery',
  JOINERY_HARDWARE:'joinery_hardware',   // door + window hardware (Gap 4/5)
  GRILLS:          'grills',
  PAINT_MATERIALS: 'paint_materials',    // gallons by layer (Gap 6)
  CEILING_FINISH:  'ceiling_finish',     // false ceiling materials (Gap 7)

  // Project / floor-only (don't decompose per room)
  RCC:               'rcc',
  STEEL:             'steel',
  STEEL_BY_DIAMETER: 'steel_by_diameter',  // rebar by bar dia (Gap 3)
  SHUTTERING:        'shuttering',
  EXCAVATION:        'excavation',
  CONCRETE_MIX:      'concreteMix',
  PLUM_CONCRETE:     'plumConcrete',
  CIVIL:             'civil',
  STAIRCASE:         'staircase',
})

// Default scope-support per category. Push helper looks up category here
// and stamps the resulting array on every line (per-line override
// allowed via line.scopeSupport in the push call).
//
// Categories not listed default to PROJECT_AND_FLOOR_ONLY (conservative).
// MEP categories (plumbing_supply, electrical_*, hvac_*, fire_*, elv_*)
// fall into that default — they don't decompose per room today.
export const DEFAULT_SCOPE_SUPPORT_BY_CATEGORY = Object.freeze({
  [BOQ_CATEGORIES.FINISHES]:         ALL_SCOPES,
  [BOQ_CATEGORIES.MASONRY]:          ALL_SCOPES,
  [BOQ_CATEGORIES.PLASTER]:          ALL_SCOPES,
  [BOQ_CATEGORIES.TILES]:            ALL_SCOPES,
  [BOQ_CATEGORIES.JOINERY]:          ALL_SCOPES,
  [BOQ_CATEGORIES.JOINERY_HARDWARE]: ALL_SCOPES,
  [BOQ_CATEGORIES.GRILLS]:           ALL_SCOPES,
  [BOQ_CATEGORIES.PAINT_MATERIALS]:  ALL_SCOPES,
  [BOQ_CATEGORIES.CEILING_FINISH]:   ALL_SCOPES,

  [BOQ_CATEGORIES.RCC]:               PROJECT_AND_FLOOR_ONLY,
  [BOQ_CATEGORIES.STEEL]:             PROJECT_AND_FLOOR_ONLY,
  [BOQ_CATEGORIES.STEEL_BY_DIAMETER]: PROJECT_AND_FLOOR_ONLY,
  [BOQ_CATEGORIES.SHUTTERING]:        PROJECT_AND_FLOOR_ONLY,
  [BOQ_CATEGORIES.EXCAVATION]:        PROJECT_AND_FLOOR_ONLY,
  [BOQ_CATEGORIES.CONCRETE_MIX]:      PROJECT_AND_FLOOR_ONLY,
  [BOQ_CATEGORIES.PLUM_CONCRETE]:     PROJECT_AND_FLOOR_ONLY,
  [BOQ_CATEGORIES.CIVIL]:             PROJECT_AND_FLOOR_ONLY,
  [BOQ_CATEGORIES.STAIRCASE]:         PROJECT_AND_FLOOR_ONLY,
})

export function getDefaultScopeSupport(category) {
  return DEFAULT_SCOPE_SUPPORT_BY_CATEGORY[category] ?? PROJECT_AND_FLOOR_ONLY
}

// ── 3. Static BOQ line IDs ───────────────────────────────────────────────
// Every static (non-parametric) line ID in the BOQ pipeline.

export const BOQ_LINE_IDS = Object.freeze({
  // Finishes
  FINISHES_FLOORING:                 'finishes_flooring',
  FINISHES_PLASTER_WALLS_INTERNAL:   'finishes_plaster_walls_internal',
  FINISHES_PLASTER_WALLS_EXTERNAL:   'finishes_plaster_walls_external',
  FINISHES_PLASTER_CEILING:          'finishes_plaster_ceiling',
  FINISHES_PAINT_WALLS:              'finishes_paint_walls',
  FINISHES_PAINT_CEILING:            'finishes_paint_ceiling',
  FINISHES_WATERPROOFING:            'finishes_waterproofing',
  FINISHES_ROOFING:                  'finishes_roofing',

  // Slab + sunshade + parapet + staircase
  SLAB_MAIN:                         'slab_main',
  SLAB_SUNKEN:                       'slab_sunken',
  SUNSHADE_RCC:                      'sunshade_rcc',
  PARAPET_RCC:                       'parapet_rcc',
  STAIR_RCC:                         'stair_rcc',

  // Work-quantity lines (Steps 1-3 — area/length/count alongside RCC vols)
  SLAB_MAIN_AREA:                    'slab_main_area',
  SLAB_SUNKEN_AREA:                  'slab_sunken_area',
  PARAPET_LEN:                       'parapet_len',
  STAIR_GRANITE:                     'stair_granite',
  STAIR_STEP_COUNT:                  'stair_step_count',

  // Concrete mix
  CONC_M7_5_CEMENT:                  'conc_M7_5_cement',
  CONC_M7_5_SAND:                    'conc_M7_5_sand',
  CONC_M7_5_AGG20:                   'conc_M7_5_agg20',
  CONC_M20_CEMENT:                   'conc_M20_cement',
  CONC_M20_SAND:                     'conc_M20_sand',
  CONC_M20_AGG10:                    'conc_M20_agg10',
  CONC_M20_AGG20:                    'conc_M20_agg20',

  // Plum concrete
  PLUM_CONCRETE:                     'plum_concrete',

  // Shuttering
  SHUTTER_COLUMNS:                   'shutter_columns',
  SHUTTER_BEAMS:                     'shutter_beams',
  SHUTTER_FOOTINGS:                  'shutter_footings',
  SHUTTER_SLAB:                      'shutter_slab',
  SHUTTER_STAIR:                     'shutter_stair',

  // Excavation
  EXCAV_BULK:                        'excav_bulk',
  EXCAV_PIT:                         'excav_pit',
  EXCAV_CIVIL:                       'excav_civil',

  // Steel (top-level, fixed)
  STEEL_FOOTING:                     'steel_footing',
  STEEL_COLUMN:                      'steel_column',
  STEEL_BEAM:                        'steel_beam',
  STEEL_SLAB:                        'steel_slab',
  STEEL_STAIRCASE:                   'steel_staircase',
  STEEL_CIVIL:                       'steel_civil',

  // Joinery (Rev 2 — new)
  JOINERY_MAIN_DOOR_COUNT:           'joinery_main_door_count',
  JOINERY_MAIN_DOOR_FRAME:           'joinery_main_door_frame',
  JOINERY_MAIN_DOOR_SHUTTER:         'joinery_main_door_shutter',
  JOINERY_INTERNAL_DOOR_COUNT:       'joinery_internal_door_count',
  JOINERY_INTERNAL_DOOR_FRAME:       'joinery_internal_door_frame',
  JOINERY_INTERNAL_DOOR_SHUTTER:     'joinery_internal_door_shutter',
  JOINERY_WINDOW_COUNT:              'joinery_window_count',
  JOINERY_WINDOW_FRAME:              'joinery_window_frame',
  JOINERY_WINDOW_SHUTTER:            'joinery_window_shutter',
  JOINERY_VENTILATOR_COUNT:          'joinery_ventilator_count',
  JOINERY_VENTILATOR_FRAME:          'joinery_ventilator_frame',
  JOINERY_VENTILATOR_AREA:           'joinery_ventilator_area',

  // Tiles (Rev 2 — new)
  TILES_FLOOR:                       'tiles_floor',
  TILES_WALL_DADO:                   'tiles_wall_dado',
  TILES_SKIRTING:                    'tiles_skirting',
  TILES_KITCHEN_COUNTER:             'tiles_kitchen_counter',

  // Grills (Rev 2 — new)
  GRILLS_WINDOW:                     'grills_window',
  GRILLS_MAIN_DOOR:                  'grills_main_door',
  GRILLS_STAIRCASE_HANDRAIL:         'grills_staircase_handrail',
  GRILLS_BALCONY_HANDRAIL:           'grills_balcony_handrail',
})

// ── 4. Parametric ID builders ────────────────────────────────────────────
// Lines whose ID encodes an entity-id (material key, column type id,
// foundation id, plaster system id, beam class id, BBS spec id) MUST
// build the ID through these helpers — never with template literals
// at the emission site.

export const BOQ_LINE_ID = Object.freeze({
  // Masonry brickwork by thickness (work quantity — Steps 1-3)
  // thkTag is '9in', '4_5in', or `other_${thkIn}in`.
  masonryWork:     (matKey, thkTag) => `masonry_work_${matKey}_${thkTag}`,

  // Masonry (per material)
  matUnit:         (matKey) => `mat_${matKey}_unit`,
  matCement:       (matKey) => `mat_${matKey}_cement`,
  matSand:         (matKey) => `mat_${matKey}_sand`,
  matAdhesive:     (matKey) => `mat_${matKey}_adhesive`,

  // Civil (per stamp type)
  civilExcav:      (prefix) => `${prefix}_excavation`,
  civilBrick:      (prefix) => `${prefix}_brickwork`,
  civilRcc:        (prefix) => `${prefix}_rcc`,
  civilPlaster:    (prefix) => `${prefix}_plasterInner`,
  civilWp:         (prefix) => `${prefix}_waterproofingInner`,

  // Columns / inline footings (per column type)
  columnRcc:       (ctId)   => `col_${ctId}_rcc`,
  footingRcc:      (ctId)   => `fot_${ctId}_rcc`,
  footingPcc:      (ctId)   => `fot_${ctId}_pcc`,

  // Foundation entities
  foundationRcc:       (fid) => `fdn_${fid}_rcc`,
  foundationRccShaft:  (fid) => `fdn_${fid}_rcc_shaft`,
  foundationRccCap:    (fid) => `fdn_${fid}_rcc_cap`,
  foundationPcc:       (fid) => `fdn_${fid}_pcc`,

  // Beams (per beam class)
  beam:            (lvlId)  => `beam_${lvlId}`,
  beamLen:         (lvlId)  => `beam_len_${lvlId}`,

  // Steel grouped-by-spec (per category × spec)
  steelSpec:       (rateKey, specId) => `${rateKey}_spec_${specId}`,

  // Steel by bar diameter (Gap 3) — one line per diameter (8/10/12/16/20/25/32)
  steelByDia:      (diaMm)  => `steel_dia_${diaMm}mm`,

  // Plaster materials (per plaster system)
  plasterCement:    (sysId) => `plaster_${sysId}_cement`,
  plasterSand:      (sysId) => `plaster_${sysId}_sand`,
  plasterMaterial:  (sysId) => `plaster_${sysId}_material`,

  // Hardware (per item, Gap 4/5)
  hardwareItem:    (itemId) => `hw_${itemId.toLowerCase()}`,

  // Paint materials (per system × layer, Gap 6)
  paintLayer:      (sysId, layerId) => `paint_${sysId}_${layerId}`,

  // Ceiling finish (per system × material, Gap 7)
  ceilingMaterial: (sysId, matId)   => `ceiling_${sysId}_${matId}`,
})

// Civil prefix tokens for sump / septic stamp emission.
export const CIVIL_PREFIX = Object.freeze({
  SUMP:   'sump',
  SEPTIC: 'septic',
})
