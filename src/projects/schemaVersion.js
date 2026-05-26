// Schema migration system — Arch 5 Phase 2.
//
// SCHEMA_VERSION is the canonical project-shape version. Every save
// stamps it; every load runs MIGRATIONS to lift older shapes up to the
// current version.
//
// Re-exports SCHEMA_VERSION from src/operations/_schemaVersion.js so
// operations + persistence agree on the same number.
//
// Migration chain entries:
//   { from, to, label, migrate(data) → data }
//
// Each migration is a pure function returning a new data object.
// Migrations are responsible for adding NEW required fields (defaults)
// and dropping legacy fields. Field-level normalization (per-entity
// defaults) happens AFTER migration via src/schema/normalize.js.

import { SCHEMA_VERSION as SCHEMA_VERSION_CONST } from '../operations/_schemaVersion.js'

export const SCHEMA_VERSION = SCHEMA_VERSION_CONST

// Migration chain — ordered list of incremental upgrades.
//
// Phase 1 baseline = v8. Any saved project with version < 8 falls into
// the legacy normalization path that store.js::loadProject still handles
// for backward compat. The chain stays empty until the next schema bump
// (e.g. v8 → v9 when Arch 5 Step 5 lands an actual shape change).
//
// Adding a migration:
//   { from: 8, to: 9, label: 'add foo field',
//     migrate: data => ({ ...data, schemaVersion: 9, projectSettings: { ...data.projectSettings, foo: 'default' } }) }
//
// Migrations MUST:
//   - Be pure (return new object; never mutate input)
//   - Stamp the next version on the output
//   - Leave existing fields untouched unless explicitly transformed

export const MIGRATIONS = Object.freeze([
  // Baseline: v8 → v8 — no-op stamp for projects already at current version.
  // Kept as a registry entry to make the chain greppable + extensible.
  Object.freeze({
    from:  8,
    to:    8,
    label: 'baseline (v8)',
    migrate: (data) => ({ ...data, schemaVersion: 8 }),
  }),
])

// Resolve the saved version from a project's data, preferring the explicit
// schemaVersion field but falling back to legacy `version` (which was 7 in
// pre-Arch-5 saves).
function _resolveSavedVersion(data) {
  if (!data || typeof data !== 'object') return 1
  if (typeof data.schemaVersion === 'number') return data.schemaVersion
  if (typeof data.version === 'number') return data.version
  return 1   // very old saves with no version stamp
}

// runMigrations(data) → { data, applied: [labels], warnings: [strings] }
//
// Applies the migration chain to upgrade `data` to SCHEMA_VERSION.
// Returns:
//   - data:     migrated data with schemaVersion stamped
//   - applied:  ordered list of migration labels that ran
//   - warnings: array of advisory strings (e.g. saved-version > current)
//
// Pure: caller chooses whether to overwrite the original.
export function runMigrations(data) {
  const applied = []
  const warnings = []

  const saved = _resolveSavedVersion(data)
  let working = { ...data }

  if (saved > SCHEMA_VERSION) {
    warnings.push(
      `Saved project schemaVersion=${saved} is newer than current SCHEMA_VERSION=${SCHEMA_VERSION}. ` +
      `Loading best-effort — some fields may be ignored or behave unexpectedly.`,
    )
    // Don't run migrations forward; just stamp + return for forward-compat best effort.
    working.schemaVersion = saved
    return { data: working, applied, warnings }
  }

  // Stamp baseline if missing — many old saves only have legacy `version`.
  if (typeof working.schemaVersion !== 'number') {
    working.schemaVersion = saved
  }

  // Apply migrations in order.
  let cursor = working.schemaVersion
  let safety = 0
  while (cursor < SCHEMA_VERSION) {
    if (safety++ > 100) {
      warnings.push(`Migration loop safety break at version ${cursor} — possible chain bug`)
      break
    }
    const step = MIGRATIONS.find(m => m.from === cursor && m.to > cursor)
    if (!step) {
      warnings.push(`No migration found for version ${cursor} → next; aborting upgrade`)
      break
    }
    working = step.migrate(working)
    applied.push(step.label)
    cursor = step.to
  }

  // Always stamp current version on output, even if no migrations ran.
  working.schemaVersion = SCHEMA_VERSION
  return { data: working, applied, warnings }
}

// Sanity check exposed for verify scripts.
export function getMigrationChain() {
  return MIGRATIONS
}

// Resolve helper exposed for tests + future repair tooling.
export { _resolveSavedVersion as resolveSavedVersion }
