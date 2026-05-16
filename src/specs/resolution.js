// Centralized reinforcement-spec resolution.
//
// ALL fallback chains for column/beam/slab/footing reinforcement specs MUST
// flow through this module. No UI panel, no BOQ aggregator, no quantities
// function re-implements the chain.
//
// Resolved output shape (consistent across element types):
//   {
//     spec:      ReinforcementSpec | null,   // null → fallback to kg/m³ estimate
//     specId:    string | null,
//     specLabel: string,                     // 'Estimate (kg/m³)' when spec === null
//     source:    'INSTANCE' | 'TYPE' | 'CLASS' | 'PROJECT_DEFAULT' | 'ESTIMATE',
//   }
//
// Fallback chains:
//   COLUMN:  instance → type (columnType.reinforcementSpecId)
//                    → project default (bbsDefaults.COLUMN)
//                    → ESTIMATE
//   BEAM:    instance → class (bbsDefaults.BEAM[beamClass])
//                    → ESTIMATE          (no global beam fallback by design)
//   SLAB:    instance → project default (bbsDefaults.SLAB)
//                    → ESTIMATE
//   FOOTING: instance (foundation.reinforcementSpecId OR
//                       inline columnType.reinforcementSpecId)
//                    → project default (bbsDefaults.FOOTING)
//                    → ESTIMATE
//
// All resolvers accept the live store state OR a floor-scoped state wrapper
// — they only read projectSettings + entity maps, never call live store getters.

const ESTIMATE_LABEL = 'Estimate (kg/m³)'

function specMapOf(state) {
  return state.projectSettings?.reinforcementSpecs ?? {}
}
function defaultsOf(state) {
  return state.projectSettings?.bbsDefaults ?? {}
}
function lookupSpec(state, specId) {
  if (!specId) return null
  return specMapOf(state)[specId] ?? null
}
function makeEstimate() {
  return { spec: null, specId: null, specLabel: ESTIMATE_LABEL, source: 'ESTIMATE' }
}
function makeResolved(spec, source) {
  if (!spec) return makeEstimate()
  return { spec, specId: spec.id, specLabel: spec.label ?? spec.id, source }
}

// ── Column resolver ──────────────────────────────────────────────────────────
// instance → type → project default → ESTIMATE
export function resolveColumnReinforcementSpec(state, columnId) {
  const column = state.columns?.[columnId]
  if (!column) return makeEstimate()
  const columnTypes = state.projectSettings?.columnTypes ?? []
  const ct = columnTypes.find(t => t.id === column.columnTypeId)
  return resolveColumnReinforcementSpecForColumn(state, column, ct)
}

// Variant that accepts column + columnType directly (avoids redundant lookups
// in tight aggregator loops). Same fallback chain, same output shape.
export function resolveColumnReinforcementSpecForColumn(state, column, columnType) {
  if (!column) return makeEstimate()
  const defaults = defaultsOf(state)

  const instanceSpec = lookupSpec(state, column.reinforcementSpecId)
  if (instanceSpec) return makeResolved(instanceSpec, 'INSTANCE')

  const typeSpec = lookupSpec(state, columnType?.reinforcementSpecId)
  if (typeSpec) return makeResolved(typeSpec, 'TYPE')

  const defaultSpec = lookupSpec(state, defaults.COLUMN)
  if (defaultSpec) return makeResolved(defaultSpec, 'PROJECT_DEFAULT')

  return makeEstimate()
}

// ── Beam resolver ────────────────────────────────────────────────────────────
// instance (explicit only) → class (bbsDefaults.BEAM[beamClass]) → ESTIMATE
//
// `beamOrId` may be a beam entity (explicit or wall-derived) or a beam id.
// Wall-derived beams don't persist a reinforcementSpecId — they skip the
// INSTANCE tier and resolve via class default → ESTIMATE.
export function resolveBeamReinforcementSpec(state, beamOrId) {
  let beam = beamOrId
  if (typeof beamOrId === 'string') {
    beam = state.beams?.[beamOrId] ?? null
  }
  if (!beam) return makeEstimate()

  const defaults = defaultsOf(state)
  const beamClass = beam.beamClass ?? beam.level
  const isExplicit = beam.source !== 'WALL_DERIVED'

  if (isExplicit) {
    const instanceSpec = lookupSpec(state, beam.reinforcementSpecId)
    if (instanceSpec) return makeResolved(instanceSpec, 'INSTANCE')
  }

  // bbsDefaults.BEAM is per-class object: { plinth, lintel, roof } → specId | null
  const beamDefaults = defaults.BEAM ?? {}
  const classSpec = lookupSpec(state, beamDefaults[beamClass])
  if (classSpec) return makeResolved(classSpec, 'CLASS')

  return makeEstimate()
}

// ── Slab resolver ────────────────────────────────────────────────────────────
// instance → project default → ESTIMATE
export function resolveSlabReinforcementSpec(state, slabId) {
  const slab = state.slabs?.[slabId]
  if (!slab) return makeEstimate()
  return resolveSlabReinforcementSpecForSlab(state, slab)
}

export function resolveSlabReinforcementSpecForSlab(state, slab) {
  if (!slab) return makeEstimate()
  const defaults = defaultsOf(state)

  const instanceSpec = lookupSpec(state, slab.reinforcementSpecId)
  if (instanceSpec) return makeResolved(instanceSpec, 'INSTANCE')

  const defaultSpec = lookupSpec(state, defaults.SLAB)
  if (defaultSpec) return makeResolved(defaultSpec, 'PROJECT_DEFAULT')

  return makeEstimate()
}

// ── Footing resolver ─────────────────────────────────────────────────────────
// Two flavors, both return the same output shape:
//   { foundationId } — resolve from foundation.reinforcementSpecId
//   { columnTypeId } — inline (auto-isolated) footing; fall back to columnType.reinforcementSpecId
//
// Fallback for foundation entities:
//   foundation.reinforcementSpecId → bbsDefaults.FOOTING → ESTIMATE
// Fallback for inline footings (columns with no foundation):
//   columnType.reinforcementSpecId → bbsDefaults.FOOTING → ESTIMATE
//
// The columnType.reinforcementSpecId tier is marked 'TYPE' for the inline
// case (mirrors column resolver semantics) — there is no 'INSTANCE' tier on
// inline footings because no per-instance footing entity exists yet.
export function resolveFootingReinforcementSpec(state, opts) {
  const defaults = defaultsOf(state)

  if (opts?.foundationId) {
    const f = state.foundations?.[opts.foundationId]
    if (!f) return makeEstimate()
    const instanceSpec = lookupSpec(state, f.reinforcementSpecId)
    if (instanceSpec) return makeResolved(instanceSpec, 'INSTANCE')

    const defaultSpec = lookupSpec(state, defaults.FOOTING)
    if (defaultSpec) return makeResolved(defaultSpec, 'PROJECT_DEFAULT')

    return makeEstimate()
  }

  if (opts?.columnTypeId) {
    const ct = (state.projectSettings?.columnTypes ?? []).find(t => t.id === opts.columnTypeId)
    const typeSpec = lookupSpec(state, ct?.reinforcementSpecId)
    if (typeSpec) return makeResolved(typeSpec, 'TYPE')

    const defaultSpec = lookupSpec(state, defaults.FOOTING)
    if (defaultSpec) return makeResolved(defaultSpec, 'PROJECT_DEFAULT')

    return makeEstimate()
  }

  return makeEstimate()
}

// Human label for a resolution source — used by panels, BOQ labels, exports.
export function humanizeAssignmentSource(source) {
  switch (source) {
    case 'INSTANCE':        return 'instance override'
    case 'TYPE':            return 'type default'
    case 'CLASS':           return 'class default'
    case 'PROJECT_DEFAULT': return 'project default'
    case 'ESTIMATE':        return 'kg/m³ estimate'
    default:                return source
  }
}
