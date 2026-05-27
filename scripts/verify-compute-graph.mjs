// scripts/verify-compute-graph.mjs
//
// Arch 3 Phase 3 — ComputationEngine DAG correctness.
// Assertions:
//   - defineComputation validates required fields
//   - class taxonomy (C6) enforced
//   - runInWorker forbidden per C3
//   - DAG acyclic detection works
//   - duplicate id throws
//   - memoization: reference-equality cache hit; dep change recomputes
//   - listComputationsByClass groups correctly
//   - profile recording (when enabled) tracks hits + misses + ms

import {
  defineComputation, runComputation, getComputation,
  listComputations, listComputationIds, listComputationsByClass,
  validateDagAcyclic,
  COMPUTE_CLASS, COMPUTE_CLASSES_ORDERED, isValidComputeClass,
  _clearRegistry, _resetCache,
} from '../src/compute/index.js'
import {
  enableProfile, disableProfile, getProfile, resetProfile,
} from '../src/compute/profile.js'

const passed = []
const failed = []
function check(name, cond, info) {
  (cond ? passed : failed).push(`${name}${info ? '  (' + info + ')' : ''}`)
}

// ── 1. Class taxonomy (C6) ───────────────────────────────────────────
check('COMPUTE_CLASS is frozen', Object.isFrozen(COMPUTE_CLASS))
check('COMPUTE_CLASSES_ORDERED has 5 entries', COMPUTE_CLASSES_ORDERED.length === 5)
check('COMPUTE_CLASS has TOPOLOGY',     COMPUTE_CLASS.TOPOLOGY === 'topology')
check('COMPUTE_CLASS has QUANTITY',     COMPUTE_CLASS.QUANTITY === 'quantity')
check('COMPUTE_CLASS has ROUTING',      COMPUTE_CLASS.ROUTING === 'routing')
check('COMPUTE_CLASS has PRESENTATION', COMPUTE_CLASS.PRESENTATION === 'presentation')
check('COMPUTE_CLASS has VALIDATION',   COMPUTE_CLASS.VALIDATION === 'validation')
check('isValidComputeClass accepts known',   isValidComputeClass('quantity'))
check('isValidComputeClass rejects unknown', !isValidComputeClass('bogus'))

// ── 2. defineComputation validation ──────────────────────────────────
_clearRegistry()

let thrownNoId = false
try { defineComputation({ class: 'quantity', version: 'v1', inputs: () => [], compute: () => 0 }) } catch { thrownNoId = true }
check('defineComputation throws when id missing', thrownNoId)

let thrownBadClass = false
try { defineComputation({ id: 't.x', class: 'invalid', version: 'v1', inputs: () => [], compute: () => 0 }) } catch { thrownBadClass = true }
check('defineComputation throws on invalid class', thrownBadClass)

let thrownNoVersion = false
try { defineComputation({ id: 't.y', class: 'quantity', inputs: () => [], compute: () => 0 }) } catch { thrownNoVersion = true }
check('defineComputation throws when version missing', thrownNoVersion)

let thrownWorker = false
try { defineComputation({ id: 't.w', class: 'quantity', version: 'v1', runInWorker: true, inputs: () => [], compute: () => 0 }) } catch { thrownWorker = true }
check('defineComputation throws on runInWorker=true (C3)', thrownWorker)

// ── 3. Basic registration + retrieval ───────────────────────────────
_clearRegistry()

const sampleNode = defineComputation({
  id:      'sample.adder',
  class:   COMPUTE_CLASS.QUANTITY,
  version: '2026-05-26-V1',
  inputs:  (state) => [state.a, state.b],
  compute: (state) => state.a + state.b,
})
check('defineComputation returns the registered node', sampleNode.id === 'sample.adder')
check('node is frozen', Object.isFrozen(sampleNode))
check('node has empty dependsOn by default', sampleNode.dependsOn.length === 0)
check('getComputation retrieves by id', getComputation('sample.adder')?.id === 'sample.adder')
check('listComputationIds returns sorted ids',
      listComputationIds().includes('sample.adder'))

// ── 4. Duplicate id throws ──────────────────────────────────────────
let thrownDup = false
try { defineComputation({ id: 'sample.adder', class: 'quantity', version: 'v1', inputs: () => [], compute: () => 0 }) } catch { thrownDup = true }
check('defineComputation throws on duplicate id', thrownDup)

// ── 5. Memoization correctness ──────────────────────────────────────
const state1 = { a: 2, b: 3 }
let computeCount = 0
defineComputation({
  id:      'sample.counted',
  class:   COMPUTE_CLASS.QUANTITY,
  version: 'v1',
  inputs:  (state) => [state.a, state.b],
  compute: (state) => { computeCount += 1; return state.a + state.b },
})
check('runComputation returns initial result',
      runComputation('sample.counted', state1) === 5 && computeCount === 1)
check('runComputation hits cache when deps unchanged',
      runComputation('sample.counted', state1) === 5 && computeCount === 1)
const state2 = { a: 10, b: 3 }
check('runComputation recomputes when dep ref changes',
      runComputation('sample.counted', state2) === 13 && computeCount === 2)
_resetCache('sample.counted')
runComputation('sample.counted', state2)
check('_resetCache forces recompute', computeCount === 3)

// ── 6. listComputationsByClass groups by class ──────────────────────
_clearRegistry()
defineComputation({ id: 'top.a', class: COMPUTE_CLASS.TOPOLOGY,   version: 'v1', inputs: () => [], compute: () => 0 })
defineComputation({ id: 'qty.a', class: COMPUTE_CLASS.QUANTITY,   version: 'v1', inputs: () => [], compute: () => 0 })
defineComputation({ id: 'qty.b', class: COMPUTE_CLASS.QUANTITY,   version: 'v1', inputs: () => [], compute: () => 0 })
defineComputation({ id: 'pres.a', class: COMPUTE_CLASS.PRESENTATION, version: 'v1', inputs: () => [], compute: () => 0 })
const byClass = listComputationsByClass()
check('listComputationsByClass groups topology', byClass.topology.length === 1)
check('listComputationsByClass groups quantity', byClass.quantity.length === 2)
check('listComputationsByClass groups presentation', byClass.presentation.length === 1)
check('listComputationsByClass returns empty array for unused class',
      byClass.routing.length === 0 && byClass.validation.length === 0)

// ── 7. DAG cycle detection ──────────────────────────────────────────
_clearRegistry()
defineComputation({ id: 'a', class: 'quantity', version: 'v1', dependsOn: ['b'], inputs: () => [], compute: () => 0 })
defineComputation({ id: 'b', class: 'quantity', version: 'v1', dependsOn: ['c'], inputs: () => [], compute: () => 0 })
defineComputation({ id: 'c', class: 'quantity', version: 'v1', dependsOn: [],    inputs: () => [], compute: () => 0 })
check('validateDagAcyclic: linear chain acyclic',
      validateDagAcyclic().acyclic === true)

// Introduce a cycle: a → b → c → a
_clearRegistry()
defineComputation({ id: 'a', class: 'quantity', version: 'v1', dependsOn: ['b'], inputs: () => [], compute: () => 0 })
defineComputation({ id: 'b', class: 'quantity', version: 'v1', dependsOn: ['c'], inputs: () => [], compute: () => 0 })
defineComputation({ id: 'c', class: 'quantity', version: 'v1', dependsOn: ['a'], inputs: () => [], compute: () => 0 })
const dagResult = validateDagAcyclic()
check('validateDagAcyclic: cycle detected',
      dagResult.acyclic === false && dagResult.cycles.length > 0)

// ── 8. Profile instrumentation ──────────────────────────────────────
_clearRegistry()
resetProfile()
enableProfile()
defineComputation({
  id:      'profile.target',
  class:   COMPUTE_CLASS.QUANTITY,
  version: 'v1',
  inputs:  (state) => [state.x],
  compute: (state) => state.x * 2,
})
const ps1 = { x: 1 }
runComputation('profile.target', ps1)   // miss
runComputation('profile.target', ps1)   // hit
runComputation('profile.target', ps1)   // hit
runComputation('profile.target', { x: 2 }) // miss
const stat = getProfile('profile.target')
check('profile records misses', stat?.misses === 2, `got ${stat?.misses}`)
check('profile records hits',   stat?.hits   === 2, `got ${stat?.hits}`)
check('profile records class',  stat?.class === COMPUTE_CLASS.QUANTITY)
disableProfile()
resetProfile()

console.log(`\nPASSED: ${passed.length}`)
for (const p of passed) console.log(`   ${p}`)
if (failed.length > 0) {
  console.log(`\nFAILED:`)
  for (const f of failed) console.log(`   ${f}`)
  process.exit(1)
}
console.log('\n✓ verify-compute-graph passed.')
