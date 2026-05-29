// Wall entity — segment between two nodes carrying openings and finishes.
// Stored at state.model.walls[id] (after Arch 1) or state.walls[id] (today).
//
// Identity: ifcGlobalId is stable across imports; internal id may rotate.
// Floor scoping: wall.floorId is authoritative. Identical geometry on two
// floors is the expected multi-storey case — not a duplicate.

export const wallSchema = Object.freeze({
  entityType:  'wall',
  storeSlice:  'model.walls',
  fields: Object.freeze({
    id:          Object.freeze({ type: 'uuid',    required: true,  generator: 'uid' }),
    ifcGlobalId: Object.freeze({ type: 'ifcGuid', required: true,  generator: 'uidIfc' }),
    n1:          Object.freeze({ type: 'ref',     required: true,  refTarget: 'node' }),
    n2:          Object.freeze({ type: 'ref',     required: true,  refTarget: 'node' }),
    height:      Object.freeze({ type: 'number',  required: true,  default: 120, min: 12, max: 240, unit: 'inches' }),
    thickness:   Object.freeze({ type: 'number',  required: true,  default: 9,   min: 2,  max: 24,  unit: 'inches' }),
    materialKey: Object.freeze({ type: 'string',  required: true,  default: 'IS_MODULAR_BRICK' }),
    openings:    Object.freeze({ type: 'array',   required: true,  default: () => [],
                                 itemSchema: 'opening' }),
    floorId:     Object.freeze({ type: 'ref',     required: true,  default: 'F1', refTarget: 'floor' }),
    classification:        Object.freeze({ type: 'string|null',  required: true, default: null }),
    isPlot:                Object.freeze({ type: 'boolean',      required: true, default: false }),
    isVirtual:             Object.freeze({ type: 'boolean',      required: true, default: false }),
    hasPlinthBeam:         Object.freeze({ type: 'boolean|null', required: true, default: null }),
    hasLintelBeam:         Object.freeze({ type: 'boolean|null', required: true, default: null }),
    hasRoofBeam:           Object.freeze({ type: 'boolean|null', required: true, default: null }),
    hasBalconyRailingEdge: Object.freeze({ type: 'boolean|null', required: true, default: null }),
    meta:                  Object.freeze({ type: 'object|null',  required: true, default: null }),
    // Phase W — UNORDERED set of TJUNCTION node ids attached to this
    // wall mid-span. Geometric order along the wall is derived via
    // getOrderedWallJunctions, never stored.
    junctions:             Object.freeze({ type: 'array',         required: true, default: () => [],
                                            itemType: 'string' }),
    // Phase W — provenance for explicit splits. 'USER_SPLIT' iff this
    // wall was produced by a splitWall invocation; 'NONE' otherwise.
    // T-junction insertion never sets 'USER_SPLIT' (wall identity
    // is preserved across T-junctions, not split).
    splitOrigin:           Object.freeze({ type: 'string',        required: true, default: 'NONE',
                                            oneOf: ['NONE', 'USER_SPLIT'] }),
    // BBS-4 — per-beam-class reinforcement spec overrides for the three
    // wall-derived beams (plinth / lintel / roof) that this wall implies.
    // Default null = no override; resolveBeamReinforcementSpec falls back
    // to bbsDefaults.BEAM[class] then ESTIMATE. Shape when non-null:
    //   { plinth?: specId|null, lintel?: specId|null, roof?: specId|null }
    // Greenfield: no migration; loadProject hydrates default null. The
    // specId references projectSettings.reinforcementSpecs entries; the
    // existing reinforcementSpecs FK invariant covers it.
    wallBeamSpecs:         Object.freeze({ type: 'object|null',   required: true, default: null }),
    // BBS-categories phase (2026-05-29):
    // Tie/grade band beam opt-in. null/false = no tie band (default → zero
    // BBS impact). true = synthesize a BBS-only tie band along this wall.
    hasTieBeam:            Object.freeze({ type: 'boolean|null',  required: true, default: null }),
    // Loft (RCC shelf cast into this wall). null = none. When non-null:
    //   { enabled: bool, widthFt, depthFt, heightFt }
    loft:                  Object.freeze({ type: 'object|null',   required: true, default: null }),
    // Per-wall loft reinforcement spec override (resolveLoftReinforcementSpec
    // INSTANCE tier). null = inherit bbsDefaults.LOFT.
    loftSpecId:            Object.freeze({ type: 'string|null',   required: true, default: null }),
  }),
  invariants: Object.freeze([
    Object.freeze({
      id: 'wall.distinct-nodes',
      check: w => w.n1 !== w.n2,
      message: 'wall.n1 and wall.n2 must be distinct nodes',
    }),
    Object.freeze({
      id: 'wall.no-virtual-plot',
      check: w => !(w.isVirtual && w.isPlot),
      message: 'wall cannot be both isVirtual and isPlot',
    }),
  ]),
  // Fields removed in earlier phases; loadProject drops them on read.
  legacyAliases: Object.freeze({
    foundationId: null,
  }),
})

export default wallSchema
