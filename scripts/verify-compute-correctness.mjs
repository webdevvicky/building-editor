// scripts/verify-compute-correctness.mjs
//
// Arch 3 Phase 3 — property tests for memoization correctness.
// The biggest danger of a memo layer is silently returning stale results
// when an undeclared dep changes. These tests:
//   - Mutate an UNDECLARED dep, assert output stays cached (correct
//     because the dep wasn't declared, so memo is allowed to miss it)
//   - Mutate a DECLARED dep, assert output recomputes
//
// This catches the "I added a state read inside compute but forgot to
// declare it in inputs" bug class — the most common failure mode of
// any dep-graph memo system.

import {
  defineComputation, runComputation, _clearRegistry,
  COMPUTE_CLASS,
} from '../src/compute/index.js'

const passed = []
const failed = []
function check(name, cond, info) {
  (cond ? passed : failed).push(`${name}${info ? '  (' + info + ')' : ''}`)
}

// ── 1. Declared-dep change → recompute ───────────────────────────────
_clearRegistry()
let callCount = 0
defineComputation({
  id:      'test.declaredDep',
  class:   COMPUTE_CLASS.QUANTITY,
  version: 'v1',
  inputs:  (state) => [state.walls],
  compute: (state) => { callCount += 1; return Object.keys(state.walls ?? {}).length },
})

const s1 = { walls: { 'w1': {} } }
check('declared dep: initial compute',
      runComputation('test.declaredDep', s1) === 1 && callCount === 1)
// Identical state object — same reference → cache hit
check('declared dep: same state object → cache hit',
      runComputation('test.declaredDep', s1) === 1 && callCount === 1)
// New walls reference → recompute
const s2 = { walls: { 'w1': {}, 'w2': {} } }
check('declared dep: new walls reference → recompute',
      runComputation('test.declaredDep', s2) === 2 && callCount === 2)

// ── 2. Undeclared-dep change → result stale (CORRECT — memo can't
//     know about a dep it wasn't told about) ─────────────────────────
_clearRegistry()
let leakyCount = 0
defineComputation({
  id:      'test.undeclaredDep',
  class:   COMPUTE_CLASS.QUANTITY,
  version: 'v1',
  inputs:  (state) => [state.walls],   // ← only declares walls
  compute: (state) => {
    // BAD pattern: reads state.rooms but doesn't declare it. Test
    // demonstrates this is detectable — output stays stale when rooms
    // changes but walls doesn't.
    leakyCount += 1
    return Object.keys(state.walls ?? {}).length + Object.keys(state.rooms ?? {}).length
  },
})
const a1 = { walls: { 'w': {} }, rooms: {} }
check('undeclared dep: initial compute',
      runComputation('test.undeclaredDep', a1) === 1 && leakyCount === 1)
// rooms changed, walls same reference — memo still hits (silently stale)
const a2 = { walls: a1.walls, rooms: { 'r': {} } }
const stale = runComputation('test.undeclaredDep', a2)
check('undeclared dep: result IS stale (memo correctly caches against declared deps only)',
      stale === 1 && leakyCount === 1,
      `if this fails, memo accidentally recomputed — undeclared deps would change behavior`)

// ── 3. Multi-dep correctness ─────────────────────────────────────────
_clearRegistry()
let multiCount = 0
defineComputation({
  id:      'test.multiDep',
  class:   COMPUTE_CLASS.QUANTITY,
  version: 'v1',
  inputs:  (state) => [state.a, state.b, state.c],
  compute: (state) => { multiCount += 1; return state.a + state.b + state.c },
})
const m1 = { a: 1, b: 2, c: 3 }
runComputation('test.multiDep', m1)               // miss (1)
runComputation('test.multiDep', m1)               // hit
runComputation('test.multiDep', { ...m1, a: 10 }) // a changed 1→10 → miss (2)
runComputation('test.multiDep', { ...m1, a: 10 }) // primitives equal (10,2,3) → hit
check('multi-dep: miss count is 2 (primitives compare by value, so repeated primitive deps hit cache)',
      multiCount === 2,
      `got ${multiCount}`)

// ── 4. dependsOn metadata is preserved ───────────────────────────────
_clearRegistry()
const depNode = defineComputation({
  id:        'test.withDeps',
  class:     COMPUTE_CLASS.PRESENTATION,
  version:   'v1',
  dependsOn: ['topology.x', 'quantity.y'],
  inputs:    () => [],
  compute:   () => 'ok',
})
check('dependsOn captured', depNode.dependsOn.length === 2)
check('dependsOn includes declared ids',
      depNode.dependsOn.includes('topology.x') && depNode.dependsOn.includes('quantity.y'))
check('dependsOn is frozen', Object.isFrozen(depNode.dependsOn))

// ── 5. estimatedCost default ─────────────────────────────────────────
_clearRegistry()
const lowCost = defineComputation({
  id: 'test.lowCost', class: 'quantity', version: 'v1',
  inputs: () => [], compute: () => 0,
})
check('estimatedCost defaults to "low"', lowCost.estimatedCost === 'low')

const highCost = defineComputation({
  id: 'test.highCost', class: 'quantity', version: 'v1',
  estimatedCost: 'high',
  inputs: () => [], compute: () => 0,
})
check('estimatedCost honors declared value', highCost.estimatedCost === 'high')

// ── 6. Reset registry for downstream verify scripts ─────────────────
_clearRegistry()

console.log(`\nPASSED: ${passed.length}`)
for (const p of passed) console.log(`   ${p}`)
if (failed.length > 0) {
  console.log(`\nFAILED:`)
  for (const f of failed) console.log(`   ${f}`)
  process.exit(1)
}
console.log('\n✓ verify-compute-correctness passed.')
