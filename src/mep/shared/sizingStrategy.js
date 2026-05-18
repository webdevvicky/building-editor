// Pluggable sizing-strategy registry for MEP branches.
//
// Each MEP discipline picks a strategy when sizing a pipe/wire/duct branch.
// The strategy is keyed by id so the choice can be persisted in
// projectSettings (e.g., a project may use HUNTER for plumbing supply +
// GRADIENT_DRAIN for plumbing drain).
//
// Phase 0 (this commit): only CATALOG has a real implementation. It returns
// the catalog default diameter / gauge for the dominant fixture or point
// on the branch — no demand-factor math, no slope correction. Sufficient
// for first-pass BOQ.
//
// Phase 2 will land HUNTER (probabilistic flow demand for plumbing supply),
// LOAD_BASED (current-per-circuit for electrical), and GRADIENT_DRAIN
// (slope + fixture-unit math for plumbing drain).
//
// Strategy impl signature:
//   sizeBranch(branch, ctx) → { diameterMm?, gaugeMm2?, reason: string }
//
// ctx is the caller-supplied resolution context, typically:
//   { catalogDefault: { diameterMm?, gaugeMm2? }, demand?: number, ... }

function _catalogSizeBranch(branch, ctx) {
  const def = ctx?.catalogDefault ?? {}
  if (def.diameterMm != null) {
    return {
      diameterMm: def.diameterMm,
      reason: 'CATALOG: catalog default diameter for dominant fixture',
    }
  }
  if (def.gaugeMm2 != null) {
    return {
      gaugeMm2: def.gaugeMm2,
      reason: 'CATALOG: catalog default gauge for dominant point type',
    }
  }
  return { reason: 'CATALOG: no catalog default available for branch' }
}

function _phase2Stub(label) {
  return (/* branch, ctx */) => {
    throw new Error(`Sizing strategy "${label}" lands in Phase 2+`)
  }
}

export const SIZING_STRATEGIES = Object.freeze({
  CATALOG: Object.freeze({
    id: 'CATALOG',
    label: 'Catalog Default',
    shipPhase: 'PHASE_0',
    impl: _catalogSizeBranch,
  }),
  HUNTER: Object.freeze({
    id: 'HUNTER',
    label: 'Hunter Curve (probabilistic flow)',
    shipPhase: 'PHASE_2',
    impl: _phase2Stub('HUNTER'),
  }),
  LOAD_BASED: Object.freeze({
    id: 'LOAD_BASED',
    label: 'Load Based (electrical current per circuit)',
    shipPhase: 'PHASE_2',
    impl: _phase2Stub('LOAD_BASED'),
  }),
  GRADIENT_DRAIN: Object.freeze({
    id: 'GRADIENT_DRAIN',
    label: 'Gradient Drain (slope + fixture units)',
    shipPhase: 'PHASE_2',
    impl: _phase2Stub('GRADIENT_DRAIN'),
  }),
})

export function selectStrategy(strategyId) {
  const s = SIZING_STRATEGIES[strategyId]
  return s ? s.impl : null
}

export function listStrategies() {
  // Deterministic order: sort by id.
  return Object.values(SIZING_STRATEGIES).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  )
}
