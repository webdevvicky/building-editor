// Staircase entity schema.
//
// 2026-05-26 (Arch 9 Phase 1) — mirrors the runtime shape created by
// store.js::addStamp when type === 'stairs'. Stored in state.staircases
// (Map<id, Staircase>). The id is intentionally shared with the companion
// stamp.id (Arch 6) — they're addressing the same physical object. The
// ifcGlobalId, however, is a fresh GUID distinct from the stamp's.
//
// fromFloorId / toFloorId express the vertical span (Phase 1.9).
// floorId is the floor the staircase footprint sits ON in plan view.

export const staircaseSchema = Object.freeze({
  entityType: 'staircase',
  storeSlice: 'model.staircases',
  fields: Object.freeze({
    id:              Object.freeze({ type: 'uuid',        required: true,  generator: 'uid' }),
    ifcGlobalId:     Object.freeze({ type: 'ifcGuid',     required: true,  generator: 'uidIfc' }),
    type:            Object.freeze({ type: 'string',      required: true,  default: 'DOG_LEGGED', oneOf: Object.freeze(['DOG_LEGGED', 'STRAIGHT', 'U_SHAPED']) }),
    flightCount:     Object.freeze({ type: 'integer',     required: true,  default: 2 }),
    stepsPerFlight:  Object.freeze({ type: 'integer',     required: true,  default: 10 }),
    treadIn:         Object.freeze({ type: 'number',      required: true,  default: 10 }),
    riserIn:         Object.freeze({ type: 'number',      required: true,  default: 6.5 }),
    waistSlabIn:     Object.freeze({ type: 'number',      required: true,  default: 6 }),
    landingFtWidth:  Object.freeze({ type: 'number',      required: true,  default: 4 }),
    landingFtLength: Object.freeze({ type: 'number',      required: true,  default: 4 }),
    flightWidthFt:   Object.freeze({ type: 'number',      required: true,  default: 3.5 }),
    grade:           Object.freeze({ type: 'string',      required: true,  default: 'M20' }),
    fromFloorId:     Object.freeze({ type: 'ref',         required: true,  default: 'F1' }),
    toFloorId:       Object.freeze({ type: 'ref',         required: true,  default: 'F1' }),
    floorId:         Object.freeze({ type: 'ref',         required: true,  default: 'F1' }),
    hasHandrail:     Object.freeze({ type: 'boolean|null', required: true,  default: null }),
    meta:            Object.freeze({ type: 'object|null', required: true,  default: null }),
  }),
  invariants: Object.freeze([
    Object.freeze({
      id: 'staircase.positive-flights',
      check: s => Number.isInteger(s?.flightCount) && s.flightCount >= 1,
      message: 'staircase.flightCount must be an integer >= 1',
    }),
    Object.freeze({
      id: 'staircase.positive-steps',
      check: s => Number.isInteger(s?.stepsPerFlight) && s.stepsPerFlight >= 1,
      message: 'staircase.stepsPerFlight must be an integer >= 1',
    }),
    Object.freeze({
      id: 'staircase.positive-dimensions',
      check: s =>
        Number.isFinite(s?.treadIn) && s.treadIn > 0 &&
        Number.isFinite(s?.riserIn) && s.riserIn > 0 &&
        Number.isFinite(s?.waistSlabIn) && s.waistSlabIn > 0,
      message: 'staircase treadIn, riserIn, waistSlabIn must all be positive numbers',
    }),
  ]),
  legacyAliases: Object.freeze({}),
})

export default staircaseSchema
