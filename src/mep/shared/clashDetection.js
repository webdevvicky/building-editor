// Clash detection — Phase 1 STUB.
//
// Returns an empty list. Full implementation lands in Phase 2.5 with
// route-vs-route segment intersection tests, zone-aware clearance
// envelopes (pipes need standoff from cables, refrigerant from soil
// stacks), and discipline-priority resolution.
//
// Export the function shape so callers (BOQ verifier, BIM exporter) can
// wire up the call site today. The PHASE_1_STUB sentinel signals to
// downstream UIs that the panel may render an explanatory placeholder.

export const PHASE_1_STUB = true

/**
 * @param {import('./systemGraph.types.js').PolylineRoute[]} routes
 * @returns {import('./systemGraph.types.js').ClashEvent[]}
 */
// eslint-disable-next-line no-unused-vars
export function detectClashes(routes) {
  return []
}
