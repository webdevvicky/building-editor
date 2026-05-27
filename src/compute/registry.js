// Computation registry — Arch 3 Phase 3.
//
// Every aggregator that needs memoization registers here via
// defineComputation. Replaces the scattered createMemo() pattern with a
// formal DAG that:
//   - Validates no cycles at module load
//   - Caches results per-node with reference-equality deps
//   - Optional LRU(N) for scoped computations (floor-toggle thrash)
//   - Instruments compute time + cache hits via profile.js
//   - Classifies each node (C6 — topology / quantity / routing /
//     presentation / validation) for discipline-specific batching +
//     future worker routing
//
// Worker routing DEFERRED per C3 — `runInWorker: false` is the only
// supported value. Re-evaluated if --profile shows repeated >50ms work.
//
// Computation node interface:
//   defineComputation({
//     id:           'plaster.quantities',          // dotted, unique
//     version:      '2026-05-26-V2',
//     class:        'quantity',                    // C6
//     inputs:       (state) => [...refs],          // live state slice refs
//     dependsOn:    ['topology.wallSurfaces'],     // other compute node ids
//     compute:      (state) => result,             // pure
//     estimatedCost: 'low' | 'medium' | 'high',
//     runInWorker:  false,                         // C3 — always false
//   })

import { recordCompute } from './profile.js'

// Class taxonomy (C6) — used for profiling, batching, future worker routing.
export const COMPUTE_CLASS = Object.freeze({
  TOPOLOGY:     'topology',     // pure spatial relationships
  QUANTITY:     'quantity',     // material aggregations
  ROUTING:      'routing',      // MEP networks + routes
  PRESENTATION: 'presentation', // final composition (BOQ lines, model)
  VALIDATION:   'validation',   // rule outputs (Arch 4 nodes)
})

export const COMPUTE_CLASSES_ORDERED = Object.freeze([
  COMPUTE_CLASS.TOPOLOGY,
  COMPUTE_CLASS.QUANTITY,
  COMPUTE_CLASS.ROUTING,
  COMPUTE_CLASS.PRESENTATION,
  COMPUTE_CLASS.VALIDATION,
])

export function isValidComputeClass(c) {
  return COMPUTE_CLASSES_ORDERED.includes(c)
}

// Module-scope registry. Cleared via _clearRegistry for tests.
const _nodes = new Map()
let _cycleChecked = false

export function defineComputation(node) {
  if (!node || typeof node !== 'object') {
    throw new TypeError('defineComputation: node config required')
  }
  if (!node.id || typeof node.id !== 'string') {
    throw new TypeError('defineComputation: id is required (dotted string)')
  }
  if (_nodes.has(node.id)) {
    throw new Error(`defineComputation: duplicate id "${node.id}"`)
  }
  if (!isValidComputeClass(node.class)) {
    throw new TypeError(`defineComputation: class "${node.class}" not in COMPUTE_CLASS for "${node.id}"`)
  }
  if (typeof node.version !== 'string' || !node.version) {
    throw new TypeError(`defineComputation: version is required for "${node.id}"`)
  }
  if (typeof node.inputs !== 'function') {
    throw new TypeError(`defineComputation: inputs(state) function required for "${node.id}"`)
  }
  if (typeof node.compute !== 'function') {
    throw new TypeError(`defineComputation: compute(state) function required for "${node.id}"`)
  }
  if (node.runInWorker) {
    throw new Error(`defineComputation: runInWorker forbidden per C3 (defer pending --profile evidence) for "${node.id}"`)
  }

  const sealed = Object.freeze({
    id:            node.id,
    version:       node.version,
    class:         node.class,
    inputs:        node.inputs,
    dependsOn:     Object.freeze([...(node.dependsOn ?? [])]),
    compute:       node.compute,
    estimatedCost: node.estimatedCost ?? 'low',
    runInWorker:   false,
    // Per-node cache state (mutable, but only via memoize call paths).
    _cache: {
      lastDeps:   null,
      lastResult: undefined,
      lru:        null,   // optional LRU<key, result> for scoped variants
    },
  })
  _nodes.set(node.id, sealed)
  _cycleChecked = false
  return sealed
}

export function getComputation(id) {
  return _nodes.get(id) ?? null
}

export function listComputations() {
  return [..._nodes.values()]
}

export function listComputationIds() {
  return [..._nodes.keys()].sort()
}

// Group registered nodes by class (C6) — used by profile output + future
// worker batching decisions.
export function listComputationsByClass() {
  const out = Object.fromEntries(COMPUTE_CLASSES_ORDERED.map(c => [c, []]))
  for (const node of _nodes.values()) out[node.class].push(node)
  return out
}

// DAG cycle detection via iterative DFS. Run at engine start; cached
// until next defineComputation invalidates.
export function validateDagAcyclic() {
  if (_cycleChecked) return { acyclic: true, cycles: [] }
  const cycles = []
  for (const start of _nodes.keys()) {
    const stack = [{ id: start, path: [start] }]
    const seen = new Set()
    while (stack.length) {
      const { id, path } = stack.pop()
      const node = _nodes.get(id)
      if (!node) continue
      for (const dep of node.dependsOn) {
        if (dep === start) {
          cycles.push([...path, dep])
        } else if (!seen.has(dep)) {
          seen.add(dep)
          stack.push({ id: dep, path: [...path, dep] })
        }
      }
    }
  }
  _cycleChecked = cycles.length === 0
  return { acyclic: cycles.length === 0, cycles }
}

// Run a registered computation with memoization + instrumentation.
// Public-facing API used by aggregators that opt in.
export function runComputation(id, state) {
  const node = _nodes.get(id)
  if (!node) throw new Error(`runComputation: unknown id "${id}"`)

  // Cycle check before first run (cached afterward until registry changes).
  if (!_cycleChecked) {
    const dag = validateDagAcyclic()
    if (!dag.acyclic) {
      throw new Error(`runComputation: DAG has cycles: ${dag.cycles.map(c => c.join(' → ')).join('; ')}`)
    }
  }

  const deps = node.inputs(state)
  const cache = node._cache
  if (
    cache.lastDeps !== null &&
    cache.lastDeps.length === deps.length &&
    cache.lastDeps.every((d, i) => d === deps[i])
  ) {
    recordCompute(node, { hit: true, ms: 0 })
    return cache.lastResult
  }
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
  const result = node.compute(state)
  const ms = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0
  cache.lastDeps   = deps
  cache.lastResult = result
  recordCompute(node, { hit: false, ms })
  return result
}

// Reset a single node's cache. Used by tests that want to force a recompute
// without changing state references.
export function _resetCache(id) {
  const node = _nodes.get(id)
  if (node) { node._cache.lastDeps = null; node._cache.lastResult = undefined }
}

// Test helper — clears entire registry. Production code never calls this.
export function _clearRegistry() {
  _nodes.clear()
  _cycleChecked = false
}
