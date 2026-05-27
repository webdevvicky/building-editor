// PlumbingFixture entity — water/drainage fixtures (WC, basin, sink, shower, ...).
// Stored at state.model.plumbingFixtures[id] (after Arch 1) or state.plumbingFixtures[id] today.
//
// Inherits the shared MEP baseEntity shape (see src/mepSlice.js::baseEntity)
// plus three plumbing-specific connection flags. Discipline is fixed to
// 'PLUMBING' at creation; the schema's invariant guards against drift.

export const plumbingFixtureSchema = Object.freeze({
  entityType:  'plumbingFixture',
  storeSlice:  'model.plumbingFixtures',
  fields: Object.freeze({
    id:                 Object.freeze({ type: 'uuid',    required: true,  generator: 'uid' }),
    ifcGlobalId:        Object.freeze({ type: 'ifcGuid', required: true,  generator: 'uidIfc' }),
    floorId:            Object.freeze({ type: 'ref',     required: true,  default: 'F1', refTarget: 'floor' }),
    discipline:         Object.freeze({ type: 'string',  required: true,  default: 'PLUMBING', oneOf: ['PLUMBING'] }),
    type:               Object.freeze({ type: 'string',  required: true }),
    x:                  Object.freeze({ type: 'number',  required: true,  unit: 'inches' }),
    y:                  Object.freeze({ type: 'number',  required: true,  unit: 'inches' }),
    wallId:             Object.freeze({ type: 'ref|null', required: true, default: null, refTarget: 'wall' }),
    wallT:              Object.freeze({ type: 'number|null', required: true, default: null, min: 0, max: 1 }),
    roomId:             Object.freeze({ type: 'ref|null', required: true, default: null, refTarget: 'room' }),
    rotationDeg:        Object.freeze({ type: 'number',  required: true,  default: 0 }),
    systemId:           Object.freeze({ type: 'string|null', required: true, default: null }),
    systemType:         Object.freeze({ type: 'string|null', required: true, default: null }),
    ifcType:            Object.freeze({ type: 'string|null', required: true, default: null }),
    classificationCode: Object.freeze({ type: 'string|null', required: true, default: null }),
    meta:               Object.freeze({ type: 'object|null', required: true, default: null }),
    hasWaterInlet:      Object.freeze({ type: 'boolean', required: true, default: false }),
    hasDrainOutlet:     Object.freeze({ type: 'boolean', required: true, default: false }),
    hasHotWaterInlet:   Object.freeze({ type: 'boolean', required: true, default: false }),
    // Phase 4 Tier-2 Item 26 + ADD 2: per-instance flow override (L/min).
    // null = inherit catalog default. Read via src/mep/resolution.js.
    flowLpmOverride:    Object.freeze({ type: 'number|null', required: true, default: null, min: 0, unit: 'lpm' }),
  }),
  invariants: Object.freeze([
    Object.freeze({
      id: 'plumbingFixture.discipline-fixed',
      check: e => e.discipline === 'PLUMBING',
      message: 'plumbingFixture.discipline must be PLUMBING',
    }),
  ]),
  legacyAliases: Object.freeze({}),
})

export default plumbingFixtureSchema
