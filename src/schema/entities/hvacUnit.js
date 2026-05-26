// HvacUnit entity — split-AC indoor / outdoor units, ducted units, etc.
// Stored at state.model.hvacUnits[id] (after Arch 1) or state.hvacUnits[id] today.
//
// Inherits the shared MEP baseEntity shape (see src/mepSlice.js::baseEntity)
// plus capacity + indoor/outdoor pairing fields. Discipline is fixed to
// 'HVAC' at creation. pairedOutdoorId / pairedIndoorId are mutually
// exclusive — an indoor unit references its outdoor pair, and vice-versa.

export const hvacUnitSchema = Object.freeze({
  entityType:  'hvacUnit',
  storeSlice:  'model.hvacUnits',
  fields: Object.freeze({
    id:                 Object.freeze({ type: 'uuid',    required: true,  generator: 'uid' }),
    ifcGlobalId:        Object.freeze({ type: 'ifcGuid', required: true,  generator: 'uidIfc' }),
    floorId:            Object.freeze({ type: 'ref',     required: true,  default: 'F1', refTarget: 'floor' }),
    discipline:         Object.freeze({ type: 'string',  required: true,  default: 'HVAC', oneOf: ['HVAC'] }),
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
    capacityTons:       Object.freeze({ type: 'number',  required: true,  default: 1, min: 0 }),
    pairedOutdoorId:    Object.freeze({ type: 'ref|null', required: true, default: null, refTarget: 'hvacUnit' }),
    pairedIndoorId:     Object.freeze({ type: 'ref|null', required: true, default: null, refTarget: 'hvacUnit' }),
  }),
  invariants: Object.freeze([
    Object.freeze({
      id: 'hvacUnit.discipline-fixed',
      check: e => e.discipline === 'HVAC',
      message: 'hvacUnit.discipline must be HVAC',
    }),
  ]),
  legacyAliases: Object.freeze({}),
})

export default hvacUnitSchema
