// MEP routing zones — single source of truth.
//
// Each MEP route segment (pipe / wire / duct / conduit) belongs to one
// routing zone. The zone drives:
//   - Quantity multiplier (account for vertical drops, fittings overhead,
//     and field-bending losses that planar polylines don't capture).
//   - Default zone-per-discipline selection when a network builder hasn't
//     been told otherwise.
//
// All values frozen — never mutate the registry in place. Adding a new zone
// = add one entry here. No other file in src/mep/ should ever literal-string
// a zone id.

export const ROUTING_ZONES = Object.freeze([
  Object.freeze({
    id: 'WALL',
    label: 'Wall (chase / surface)',
    quantityMultiplier: 1.00,
    defaultFor: Object.freeze(['ELECTRICAL', 'ELV', 'PLUMBING_SUPPLY']),
  }),
  Object.freeze({
    id: 'CEILING',
    label: 'Ceiling (slab soffit / false ceiling)',
    quantityMultiplier: 1.05,
    defaultFor: Object.freeze(['HVAC', 'FIRE_SPRINKLER', 'LIGHTING_HOMERUN']),
  }),
  Object.freeze({
    id: 'FLOOR',
    label: 'Floor (slab embedded / screed)',
    quantityMultiplier: 1.00,
    defaultFor: Object.freeze(['PLUMBING_DRAIN', 'FLOOR_HEATING']),
  }),
  Object.freeze({
    id: 'SHAFT',
    label: 'Shaft (vertical riser core)',
    quantityMultiplier: 1.05,
    defaultFor: Object.freeze([]),
  }),
  Object.freeze({
    id: 'EXTERNAL',
    label: 'External (façade / on-grade)',
    quantityMultiplier: 1.10,
    defaultFor: Object.freeze(['RAINWATER', 'SOLAR']),
  }),
  Object.freeze({
    id: 'UNDERGROUND',
    label: 'Underground (buried)',
    quantityMultiplier: 1.00,
    defaultFor: Object.freeze(['SEWAGE', 'EXTERNAL_WATER']),
  }),
])

const _zoneById = Object.freeze(
  Object.fromEntries(ROUTING_ZONES.map(z => [z.id, z]))
)

export function getZone(id) {
  return _zoneById[id] ?? null
}

export function listZones() {
  return ROUTING_ZONES
}

// Returns the zone whose defaultFor list contains systemType, or null.
// Deterministic: ROUTING_ZONES is iterated in declared order; first match wins.
export function getDefaultZoneForSystem(systemType) {
  if (!systemType) return null
  for (const z of ROUTING_ZONES) {
    if (z.defaultFor.includes(systemType)) return z
  }
  return null
}
