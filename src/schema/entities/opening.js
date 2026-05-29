// Opening entity — sub-shape inside wall.openings[].
// Doors and windows; ventilators are a window subtype.
//
// Identity: ifcGlobalId stable; id may rotate on import.
// Joinery subtypes drive procurement-relevant BOQ rollup.

import { OPENING_SUBTYPE } from '../../constants/joinery.js'

const SUBTYPE_VALUES = Object.freeze([
  OPENING_SUBTYPE.MAIN_DOOR,
  OPENING_SUBTYPE.INTERNAL_DOOR,
  OPENING_SUBTYPE.WINDOW,
  OPENING_SUBTYPE.VENTILATOR,
])

export const openingSchema = Object.freeze({
  entityType:  'opening',
  storeSlice:  'model.walls[].openings',
  fields: Object.freeze({
    id:          Object.freeze({ type: 'uuid',    required: true,  generator: 'uid' }),
    ifcGlobalId: Object.freeze({ type: 'ifcGuid', required: true,  generator: 'uidIfc' }),
    offset:      Object.freeze({ type: 'number',  required: true,  unit: 'inches', min: 0 }),
    width:       Object.freeze({ type: 'number',  required: true,  min: 12,         unit: 'inches' }),
    height:      Object.freeze({ type: 'number',  required: true,  min: 12, max: 144, unit: 'inches' }),
    type:        Object.freeze({ type: 'string',  required: true,  oneOf: Object.freeze(['door', 'window']) }),
    orient:      Object.freeze({ type: 'integer', required: true,  default: 0 }),
    hasSunshade: Object.freeze({ type: 'boolean', required: true,  default: false }),
    hasGrill:    Object.freeze({ type: 'boolean|null', required: true, default: null }),
    subtype:     Object.freeze({ type: 'string',  required: true,  oneOf: SUBTYPE_VALUES }),
    subtypeSource: Object.freeze({ type: 'string', required: true, default: 'HEURISTIC',
                                   oneOf: Object.freeze(['EXPLICIT', 'HEURISTIC']) }),
    hardwareSetId:     Object.freeze({ type: 'string|null', default: null }),
    hardwareOverrides: Object.freeze({ type: 'object|null', default: null }),
    // BBS-categories phase — per-opening sunshade reinforcement spec override.
    // null = inherit bbsDefaults.SUNSHADE. Sunshade BBS only emits when
    // hasSunshade === true AND a spec resolves (default → no BBS impact).
    sunshadeSpecId:    Object.freeze({ type: 'string|null', default: null }),
  }),
  invariants: Object.freeze([
    Object.freeze({
      id: 'opening.window-no-orient',
      check: o => o.type !== 'window' || o.orient === 0,
      message: 'window opening must have orient === 0',
    }),
    Object.freeze({
      id: 'opening.door-has-orient',
      check: o => o.type !== 'door' || [0, 1, 2, 3].includes(o.orient),
      message: 'door opening.orient must be one of [0,1,2,3]',
    }),
    Object.freeze({
      id: 'opening.size-positive',
      check: o => o.width > 0 && o.height > 0,
      message: 'opening width and height must be positive',
    }),
  ]),
  legacyAliases: Object.freeze({}),
})

export default openingSchema
