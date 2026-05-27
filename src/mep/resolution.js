// Centralized MEP per-instance override resolution.
//
// Phase 4 Tier-2 Item 26 + ADD 2 (architectural review).
//
// ALL fallback chains for MEP per-instance overrides MUST flow through this
// module. No sizing engine, UI panel, BOQ aggregator, or quantity function
// re-implements the chain.
//
// Pattern mirrors src/specs/resolution.js exactly:
//   {
//     value:  number,                   // the resolved numeric value
//     source: 'INSTANCE' | 'CATALOG',   // tier that produced the value
//   }
//
// Fallback chain (uniform across all three resolvers):
//   INSTANCE override (entity.xxxOverride is non-null)
//     → CATALOG default (catalog entry's documented value)
//
// Adding a new override later (e.g. fixtureDrainDiameterMm override) =
// one more resolver here + one more sizing-engine consumer.

function nonNullNumber(v) {
  return v !== null && v !== undefined && Number.isFinite(v)
}

function resolveFromOverride(entity, overrideField, catalog, catalogField, fallback = 0) {
  if (entity && nonNullNumber(entity[overrideField])) {
    return { value: entity[overrideField], source: 'INSTANCE' }
  }
  if (catalog && nonNullNumber(catalog[catalogField])) {
    return { value: catalog[catalogField], source: 'CATALOG' }
  }
  return { value: fallback, source: 'CATALOG' }
}

// Plumbing — fixture peak flow demand. Used by HUNTER + LOAD_BASED sizing
// strategies. flowLpm = litres per minute.
export function resolveFixtureFlowLpm(fixture, catalog) {
  return resolveFromOverride(fixture, 'flowLpmOverride', catalog, 'flowLpm', 0)
}

// Electrical — wire cross-section in mm². Used by CATALOG + LOAD_BASED
// sizing strategies. Returning 0 from CATALOG would be a bug, but the
// fallback is defensive against a catalog entry missing the field.
export function resolveWireGauge(point, catalog) {
  return resolveFromOverride(point, 'wireGaugeMm2Override', catalog, 'wireGaugeMm2', 0)
}

// HVAC — refrigerant pipe outer diameter in inches. Used by CATALOG sizing.
// Some catalog entries (DUCTED units) have null refrigerantPipeOdIn; the
// resolver treats that as "no value" and falls through to fallback (0).
export function resolveRefrigerantPipeOD(unit, catalog) {
  return resolveFromOverride(unit, 'refrigerantPipeOdInOverride', catalog, 'refrigerantPipeOdIn', 0)
}

// Human-readable source label for UI badges.
export function humanizeMepSource(source) {
  switch (source) {
    case 'INSTANCE': return 'Override'
    case 'CATALOG':  return 'Catalog default'
    default:         return source
  }
}
