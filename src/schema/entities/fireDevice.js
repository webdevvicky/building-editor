// FireDevice entity — smoke detectors, sprinkler heads, hose reels, extinguishers, etc.
// Stored at state.model.fireDevices[id] (after Arch 1) or state.fireDevices[id] today.
//
// Inherits the shared MEP baseEntity shape (see src/mepSlice.js::baseEntity).
// No discipline-specific fields beyond base — type discriminator picks the
// catalog entry for sub-system (DETECTION / SPRINKLER / EQUIPMENT) and
// behaviour. Discipline is fixed to 'FIRE' at creation.

export const fireDeviceSchema = Object.freeze({
  entityType:  'fireDevice',
  storeSlice:  'model.fireDevices',
  fields: Object.freeze({
    id:                 Object.freeze({ type: 'uuid',    required: true,  generator: 'uid' }),
    ifcGlobalId:        Object.freeze({ type: 'ifcGuid', required: true,  generator: 'uidIfc' }),
    floorId:            Object.freeze({ type: 'ref',     required: true,  default: 'F1', refTarget: 'floor' }),
    discipline:         Object.freeze({ type: 'string',  required: true,  default: 'FIRE', oneOf: ['FIRE'] }),
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
      id: 'fireDevice.discipline-fixed',
      check: e => e.discipline === 'FIRE',
      message: 'fireDevice.discipline must be FIRE',
    }),
  ]),
  legacyAliases: Object.freeze({}),
})

export default fireDeviceSchema
