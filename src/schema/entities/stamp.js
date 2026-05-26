// Stamp entity — volumetric civil region (sump / septic / OHT) or
// architectural footprint (stairs / lift). Civil types carry a depth
// for excavation + plaster math; non-civil types do not.
//
// Stored at state.model.stamps[id] (after Arch 1) or state.stamps[id] (today).

const CIVIL_TYPES = Object.freeze(['sump', 'septic_tank', 'overhead_tank'])

export const stampSchema = Object.freeze({
  entityType:  'stamp',
  storeSlice:  'model.stamps',
  fields: Object.freeze({
    id:          Object.freeze({ type: 'uuid',    required: true,  generator: 'uid' }),
    ifcGlobalId: Object.freeze({ type: 'ifcGuid', required: true,  generator: 'uidIfc' }),
    type:        Object.freeze({ type: 'string',  required: true,
                                 oneOf: Object.freeze(['sump', 'overhead_tank', 'septic_tank', 'stairs', 'lift']) }),
    x:           Object.freeze({ type: 'number',  required: true,  unit: 'inches' }),
    y:           Object.freeze({ type: 'number',  required: true,  unit: 'inches' }),
    w:           Object.freeze({ type: 'number',  required: true,  min: 12 }),
    h:           Object.freeze({ type: 'number',  required: true,  min: 12 }),
    depth:       Object.freeze({ type: 'number|null', default: null }),
    name:        Object.freeze({ type: 'string|null', default: null }),
    floorId:     Object.freeze({ type: 'ref',     required: true,  default: 'F1', refTarget: 'floor' }),
    meta:        Object.freeze({ type: 'object|null', required: true, default: null }),
  }),
  invariants: Object.freeze([
    Object.freeze({
      id: 'stamp.civil-has-depth',
      // Depth is optional at creation (null) — but if set on a civil stamp it must be positive.
      check: s => !CIVIL_TYPES.includes(s.type) || s.depth === null || s.depth > 0,
      message: 'civil stamp depth, when set, must be > 0',
    }),
    Object.freeze({
      id: 'stamp.size-positive',
      check: s => s.w > 0 && s.h > 0,
      message: 'stamp w and h must be positive',
    }),
  ]),
  legacyAliases: Object.freeze({}),
})

export default stampSchema
