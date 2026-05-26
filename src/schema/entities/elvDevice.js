// ElvDevice entity — extra-low-voltage devices: CCTV cameras, data outlets,
// security sensors, AV speakers, etc.
// Stored at state.model.elvDevices[id] (after Arch 1) or state.elvDevices[id] today.
//
// Inherits the shared MEP baseEntity shape (see src/mepSlice.js::baseEntity).
// No discipline-specific fields beyond base — type discriminator picks the
// catalog entry for sub-system (CCTV / DATA / SECURITY / AV). Discipline is
// fixed to 'ELV' at creation.

export const elvDeviceSchema = Object.freeze({
  entityType:  'elvDevice',
  storeSlice:  'model.elvDevices',
  fields: Object.freeze({
    id:                 Object.freeze({ type: 'uuid',    required: true,  generator: 'uid' }),
    ifcGlobalId:        Object.freeze({ type: 'ifcGuid', required: true,  generator: 'uidIfc' }),
    floorId:            Object.freeze({ type: 'ref',     required: true,  default: 'F1', refTarget: 'floor' }),
    discipline:         Object.freeze({ type: 'string',  required: true,  default: 'ELV', oneOf: ['ELV'] }),
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
      id: 'elvDevice.discipline-fixed',
      check: e => e.discipline === 'ELV',
      message: 'elvDevice.discipline must be ELV',
    }),
  ]),
  legacyAliases: Object.freeze({}),
})

export default elvDeviceSchema
