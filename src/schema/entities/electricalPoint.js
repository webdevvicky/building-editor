// ElectricalPoint entity — light points, sockets, switches, AC points, etc.
// Stored at state.model.electricalPoints[id] (after Arch 1) or
// state.electricalPoints[id] today.
//
// Inherits the shared MEP baseEntity shape (see src/mepSlice.js::baseEntity)
// plus electrical load + circuit + mount-height fields. Discipline is fixed
// to 'ELECTRICAL' at creation.

export const electricalPointSchema = Object.freeze({
  entityType:  'electricalPoint',
  storeSlice:  'model.electricalPoints',
  fields: Object.freeze({
    id:                 Object.freeze({ type: 'uuid',    required: true,  generator: 'uid' }),
    ifcGlobalId:        Object.freeze({ type: 'ifcGuid', required: true,  generator: 'uidIfc' }),
    floorId:            Object.freeze({ type: 'ref',     required: true,  default: 'F1', refTarget: 'floor' }),
    discipline:         Object.freeze({ type: 'string',  required: true,  default: 'ELECTRICAL', oneOf: ['ELECTRICAL'] }),
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
    loadW:              Object.freeze({ type: 'number',  required: true,  default: 0, min: 0, unit: 'watts' }),
    circuitId:          Object.freeze({ type: 'string|null', required: true, default: null }),
    mountHeightFt:      Object.freeze({ type: 'number',  required: true,  default: 0, min: 0, unit: 'ft' }),
    // Phase 4 Tier-2 Item 26 + ADD 2: per-instance wire gauge override (mm²).
    // null = inherit catalog default. Read via src/mep/resolution.js.
    wireGaugeMm2Override: Object.freeze({ type: 'number|null', required: true, default: null, min: 0, unit: 'mm2' }),
  }),
  invariants: Object.freeze([
    Object.freeze({
      id: 'electricalPoint.discipline-fixed',
      check: e => e.discipline === 'ELECTRICAL',
      message: 'electricalPoint.discipline must be ELECTRICAL',
    }),
  ]),
  legacyAliases: Object.freeze({}),
})

export default electricalPointSchema
