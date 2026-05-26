// Riser entity — cross-discipline, cross-floor vertical run.
// Stored at state.model.risers[id] (after Arch 1) or state.risers[id] today.
//
// Unlike the 6 per-discipline MEP entities, risers do NOT go through the
// baseEntity helper. They carry their own from/to floor pair plus a kind
// discriminator that determines discipline. A single state.risers map holds
// every kind; scope.js mirrors each riser onto both fromFloorId and
// toFloorId of the scoped state so the floor-scoped BOQ never double-counts
// (quantity engines count riser length ONCE at the project level).

const RISER_KINDS = Object.freeze([
  'PLUMBING_SUPPLY', 'SOIL_STACK', 'RAINWATER_DOWN', 'HOT_WATER_RISER',
  'ELECTRICAL_SUBMAIN',
  'HVAC_REFRIGERANT', 'HVAC_CONDENSATE',
  'FIRE_MAIN',
  'ELV_TRUNKING',
  'SOLAR_DC_RISER', 'SOLAR_AC_RISER',
])

const RISER_DISCIPLINES = Object.freeze([
  'PLUMBING', 'ELECTRICAL', 'HVAC', 'FIRE', 'ELV', 'SOLAR',
])

// Kind-prefix → discipline. Multi-token prefixes (HOT_WATER_RISER → PLUMBING,
// RAINWATER_DOWN → PLUMBING, SOIL_STACK → PLUMBING) handled explicitly.
const KIND_TO_DISCIPLINE = Object.freeze({
  PLUMBING_SUPPLY:    'PLUMBING',
  SOIL_STACK:         'PLUMBING',
  RAINWATER_DOWN:     'PLUMBING',
  HOT_WATER_RISER:    'PLUMBING',
  ELECTRICAL_SUBMAIN: 'ELECTRICAL',
  HVAC_REFRIGERANT:   'HVAC',
  HVAC_CONDENSATE:    'HVAC',
  FIRE_MAIN:          'FIRE',
  ELV_TRUNKING:       'ELV',
  SOLAR_DC_RISER:     'SOLAR',
  SOLAR_AC_RISER:     'SOLAR',
})

export const riserSchema = Object.freeze({
  entityType:  'riser',
  storeSlice:  'model.risers',
  fields: Object.freeze({
    id:                 Object.freeze({ type: 'uuid',    required: true,  generator: 'uid' }),
    ifcGlobalId:        Object.freeze({ type: 'ifcGuid', required: true,  generator: 'uidIfc' }),
    kind:               Object.freeze({ type: 'string',  required: true,  oneOf: RISER_KINDS }),
    discipline:         Object.freeze({ type: 'string',  required: true,  oneOf: RISER_DISCIPLINES }),
    fromFloorId:        Object.freeze({ type: 'ref',     required: true,  default: 'F1', refTarget: 'floor' }),
    toFloorId:          Object.freeze({ type: 'ref',     required: true,  default: 'F1', refTarget: 'floor' }),
    x:                  Object.freeze({ type: 'number',  required: true,  unit: 'inches' }),
    y:                  Object.freeze({ type: 'number',  required: true,  unit: 'inches' }),
    diameterMm:         Object.freeze({ type: 'number|null', required: true, default: null, min: 0, unit: 'mm' }),
    routingZone:        Object.freeze({ type: 'string|null', required: true, default: null }),
    systemId:           Object.freeze({ type: 'string|null', required: true, default: null }),
    ifcType:            Object.freeze({ type: 'string|null', required: true, default: null }),
    classificationCode: Object.freeze({ type: 'string|null', required: true, default: null }),
    meta:               Object.freeze({ type: 'object|null', required: true, default: null }),
  }),
  invariants: Object.freeze([
    Object.freeze({
      id: 'riser.spans-floors',
      check: r => r.fromFloorId !== r.toFloorId,
      message: 'riser must span two distinct floors (fromFloorId !== toFloorId)',
    }),
    Object.freeze({
      id: 'riser.kind-matches-discipline',
      check: r => KIND_TO_DISCIPLINE[r.kind] === r.discipline,
      message: 'riser.discipline must match the discipline implied by riser.kind',
    }),
  ]),
  legacyAliases: Object.freeze({}),
})

export default riserSchema
