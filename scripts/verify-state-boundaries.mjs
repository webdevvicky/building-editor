// scripts/verify-state-boundaries.mjs
//
// Arch 1 Phase 2 — state-slice boundary contract.
//
// Asserts the invariants that the eventual 5-namespace refactor must
// uphold, run against the CURRENT flat-shape state:
//
//   1. Every classified path is reachable from the current store
//   2. View-slice fields are NEVER captured in history snapshots
//      (they're transient — undo shouldn't restore selection / hover)
//   3. History-slice fields are NEVER captured inside model snapshots
//      (would create recursion / unbounded growth)
//   4. Every store field that exists today is classified somewhere
//      (catches unknown fields added without slice declaration)

import { useStore } from '../src/store.js'
import {
  LEGACY_ACCESSORS, SLICE_BOUNDARIES, getSliceForPath, allKnownPaths, SHIM_KILL_BY,
} from '../src/store/legacyAccessors.js'

const passed = []
const failed = []
function check(name, cond, info) {
  (cond ? passed : failed).push(`${name}${info ? '  (' + info + ')' : ''}`)
}

const s = useStore.getState
const state = s()

// ── 1. Every classified path reachable on the store ───────────────────
const unreachable = []
for (const acc of LEGACY_ACCESSORS) {
  if (!(acc.path in state)) {
    unreachable.push(acc.path)
  }
}
check(`Every classified path exists on the store (${LEGACY_ACCESSORS.length} accessors)`,
      unreachable.length === 0,
      unreachable.length ? `missing: ${unreachable.join(', ')}` : '')

// ── 2. SLICE_BOUNDARIES well-formed ────────────────────────────────────
check('SLICE_BOUNDARIES has model slice',     Array.isArray(SLICE_BOUNDARIES.model))
check('SLICE_BOUNDARIES has view slice',      Array.isArray(SLICE_BOUNDARIES.view))
check('SLICE_BOUNDARIES has history slice',   Array.isArray(SLICE_BOUNDARIES.history))
check('SLICE_BOUNDARIES has validation slice', Array.isArray(SLICE_BOUNDARIES.validation))
check('SLICE_BOUNDARIES has cache slice (may be empty)', Array.isArray(SLICE_BOUNDARIES.cache))

check('model slice has entities (>10 collections)',
      SLICE_BOUNDARIES.model.length >= 10,
      `got ${SLICE_BOUNDARIES.model.length}`)
check('view slice has selection fields',
      SLICE_BOUNDARIES.view.includes('selectedWallId') &&
      SLICE_BOUNDARIES.view.includes('currentFloorId'))
check('history slice has history + future', SLICE_BOUNDARIES.history.includes('history') && SLICE_BOUNDARIES.history.includes('future'))
check('validation slice has validationEvents',
      SLICE_BOUNDARIES.validation.includes('validationEvents'))

// Paths are mutually exclusive across slices.
const allPaths = LEGACY_ACCESSORS.map(a => a.path)
const uniquePaths = new Set(allPaths)
check('No duplicate paths across slices',
      allPaths.length === uniquePaths.size,
      `${allPaths.length - uniquePaths.size} duplicates`)

// ── 3. View fields NEVER appear in history snapshots ──────────────────
// Trigger a history-creating mutation, inspect the captured snapshot.
const FT = 12
s().loadProject({})
const nA = s().getOrCreateNode(0, 0)
const nB = s().getOrCreateNode(20 * FT, 0)
s().addWall(nA, nB)
// history[] now has at least one entry from addWall's _save() call.
const snapshot = s().history[s().history.length - 1]
const viewFieldsInSnap = SLICE_BOUNDARIES.view.filter(f => snapshot && f in snapshot)
check('History snapshot contains NO view-slice fields',
      viewFieldsInSnap.length === 0,
      viewFieldsInSnap.length ? `found: ${viewFieldsInSnap.join(', ')}` : '')

// History.history is NEVER captured inside its own snapshot (would explode memory).
check('History snapshot does NOT contain "history" field (no recursion)',
      snapshot && !('history' in snapshot))
check('History snapshot does NOT contain "future" field',
      snapshot && !('future' in snapshot))
check('History snapshot does NOT contain "validationEvents"',
      snapshot && !('validationEvents' in snapshot))

// ── 4. Every store field is classified ────────────────────────────────
// Walk live state keys; anything not in LEGACY_ACCESSORS is either a
// method (function) or an unclassified field (which is a bug — surface it).
const unclassified = []
for (const key of Object.keys(state)) {
  if (typeof state[key] === 'function') continue   // store methods don't need classification
  if (key.startsWith('_')) continue                // internal methods (_save, etc.)
  if (!getSliceForPath(key)) {
    unclassified.push(key)
  }
}
check(`Every store state field is classified in a slice (no unknowns)`,
      unclassified.length === 0,
      unclassified.length ? `unknown: ${unclassified.join(', ')}` : '')

// ── 5. Kill-switch date set ───────────────────────────────────────────
check('SHIM_KILL_BY is a valid date string',
      typeof SHIM_KILL_BY === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(SHIM_KILL_BY),
      `got "${SHIM_KILL_BY}"`)

// ── 6. allKnownPaths() round-trip ─────────────────────────────────────
const known = allKnownPaths()
check('allKnownPaths returns full path list', known.length === LEGACY_ACCESSORS.length)
check('every known path has a slice', known.every(p => getSliceForPath(p) !== null))

console.log(`\nPASSED: ${passed.length}`)
for (const p of passed) console.log(`   ${p}`)
if (failed.length > 0) {
  console.log(`\nFAILED:`)
  for (const f of failed) console.log(`   ${f}`)
  process.exit(1)
}
console.log('\n✓ verify-state-boundaries passed.')
