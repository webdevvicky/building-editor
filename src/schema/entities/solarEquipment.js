// SolarEquipment entity — PV panels, inverters, batteries, charge controllers.
// Stored at state.model.solarEquipment[id] (after Arch 1) or
// state.solarEquipment[id] today.
//
// Inherits the shared MEP baseEntity shape (see src/mepSlice.js::baseEntity).
// No discipline-specific fields beyond base in current scope — Phase 2.3
// (deferred) will extend with PANEL_KW / TILT_DEG / AZIMUTH_DEG / DC_AC_RATIO
// once routing + sizing land. Discipline is fixed to 'SOLAR' at creation.

export const solarEquipmentSchema = Object.freeze({
  entityType:  'solarEquipment',
  storeSlice:  'model.solarEquipment',
  fields: Object.freeze({
    id:                 Object.freeze({ type: 'uuid',    required: true,  generator: 'uid' }),
    ifcGlobalId:        Object.freeze({ type: 'ifcGuid', required: true,  generator: 'uidIfc' }),
    floorId:            Object.freeze({ type: 'ref',     required: true,  default: 'F1', refTarget: 'floor' }),
    discipline:         Object.freeze({ type: 'string',  required: true,  default: 'SOLAR', oneOf: ['SOLAR'] }),
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
  }),
  invariants: Object.freeze([
    Object.freeze({
      id: 'solarEquipment.discipline-fixed',
      check: e => e.discipline === 'SOLAR',
      message: 'solarEquipment.discipline must be SOLAR',
    }),
  ]),
  legacyAliases: Object.freeze({}),
})

export default solarEquipmentSchema
