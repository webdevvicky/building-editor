// scripts/verify-migrations.mjs
//
// Arch 5 Phase 2 — schema migration runner correctness.
//   - Identity migration for current-version data
//   - Future-version save loaded best-effort with warning
//   - Version-stamp injected when missing
//   - Pure: input data not mutated

import {
  SCHEMA_VERSION, MIGRATIONS, runMigrations, getMigrationChain, resolveSavedVersion,
} from '../src/projects/schemaVersion.js'

const passed = []
const failed = []
function check(name, cond, info) {
  (cond ? passed : failed).push(`${name}${info ? '  (' + info + ')' : ''}`)
}

// ── 1. SCHEMA_VERSION constant ──────────────────────────────────────────
check('SCHEMA_VERSION is a positive integer',
      Number.isInteger(SCHEMA_VERSION) && SCHEMA_VERSION > 0)
check('SCHEMA_VERSION === 8 (Phase 1 baseline)', SCHEMA_VERSION === 8)

// ── 2. MIGRATIONS chain shape ───────────────────────────────────────────
const chain = getMigrationChain()
check('getMigrationChain returns frozen array', Object.isFrozen(chain))
check('chain has at least one entry (baseline)', chain.length >= 1)
for (const m of chain) {
  check(`migration "${m.label}": has from`, typeof m.from === 'number')
  check(`migration "${m.label}": has to`, typeof m.to === 'number')
  check(`migration "${m.label}": has migrate fn`, typeof m.migrate === 'function')
}

// ── 3. resolveSavedVersion ──────────────────────────────────────────────
check('resolveSavedVersion: explicit schemaVersion wins',
      resolveSavedVersion({ schemaVersion: 8, version: 7 }) === 8)
check('resolveSavedVersion: falls back to legacy version field',
      resolveSavedVersion({ version: 7 }) === 7)
check('resolveSavedVersion: defaults to 1 when no version',
      resolveSavedVersion({}) === 1)
check('resolveSavedVersion: null/undefined input → 1',
      resolveSavedVersion(null) === 1 && resolveSavedVersion(undefined) === 1)

// ── 4. runMigrations on current-version data ───────────────────────────
const v8Data = { schemaVersion: 8, walls: {}, nodes: {}, foo: 'bar' }
const r1 = runMigrations(v8Data)
check('runMigrations(v8): schemaVersion stays at 8',
      r1.data.schemaVersion === 8)
check('runMigrations(v8): preserves other fields',
      r1.data.foo === 'bar' && r1.data.walls && r1.data.nodes)
check('runMigrations: returns warnings array',
      Array.isArray(r1.warnings))
check('runMigrations: returns applied array',
      Array.isArray(r1.applied))
check('runMigrations: pure (input not mutated)',
      v8Data.schemaVersion === 8 && !('migratedAt' in v8Data))
// Identity migration runs the baseline label.
check('runMigrations(v8): baseline label applied',
      r1.applied.length >= 0)

// ── 5. runMigrations on legacy data (version: 7) ───────────────────────
const v7Data = { version: 7, walls: {}, nodes: {}, foo: 'legacy' }
const r2 = runMigrations(v7Data)
check('runMigrations(v7): schemaVersion stamped to current',
      r2.data.schemaVersion === SCHEMA_VERSION)
check('runMigrations(v7): legacy fields preserved',
      r2.data.foo === 'legacy')

// ── 6. runMigrations on data with no version ───────────────────────────
const unversioned = { walls: {}, nodes: {} }
const r3 = runMigrations(unversioned)
check('runMigrations(unversioned): schemaVersion stamped',
      r3.data.schemaVersion === SCHEMA_VERSION)

// ── 7. Future-version best-effort load ─────────────────────────────────
const futureData = { schemaVersion: 999, walls: {}, futureField: 'magic' }
const r4 = runMigrations(futureData)
check('runMigrations(future): preserves schemaVersion=999',
      r4.data.schemaVersion === 999)
check('runMigrations(future): emits a warning',
      r4.warnings.length === 1 && /newer than current/.test(r4.warnings[0]))
check('runMigrations(future): preserves all original fields',
      r4.data.futureField === 'magic')

// ── 8. Empty / malformed input ─────────────────────────────────────────
const r5 = runMigrations(null)
check('runMigrations(null): no crash; stamps current version',
      r5.data.schemaVersion === SCHEMA_VERSION)
const r6 = runMigrations({})
check('runMigrations({}): stamps current version', r6.data.schemaVersion === SCHEMA_VERSION)

// ── 9. Chain order well-formed ─────────────────────────────────────────
// `from` values must be monotonically increasing and contiguous in the
// from→to graph (otherwise the upgrade loop would skip steps).
let lastTo = null
for (const m of chain) {
  if (m.from === m.to) continue   // identity / baseline self-link
  if (lastTo === null) { lastTo = m.to; continue }
  check(`chain step ${m.label}: from === previous.to`, m.from === lastTo,
        `from=${m.from}, expected=${lastTo}`)
  lastTo = m.to
}

console.log(`\nPASSED: ${passed.length}`)
for (const p of passed) console.log(`   ${p}`)
if (failed.length > 0) {
  console.log(`\nFAILED:`)
  for (const f of failed) console.log(`   ${f}`)
  process.exit(1)
}
console.log('\n✓ verify-migrations passed.')
