// scripts/verify-op-kinds.mjs
//
// Arch 2 Correction 1 (C1) — every operation declares a kind from
// OP_KIND. Three pipelines: USER (full journal + undo + autosave),
// SYSTEM (journal + autosave, no undo), TRANSIENT (no journal, no undo,
// no autosave).
//
// Assertions:
//   - Every op type in the registry has a valid kind
//   - KIND_BY_TYPE is consistent with registry entries
//   - At least one of each kind is registered (sanity check)
//   - Transient ops never carry an inverse in their apply return
//     (transient = no undo, so inverse is meaningless)

import {
  OP_KIND, OPERATIONS, KIND_BY_TYPE, listOperationTypes, isValidOpKind,
} from '../src/operations/index.js'

const passed = []
const failed = []
function check(name, cond, info) {
  (cond ? passed : failed).push(`${name}${info ? '  (' + info + ')' : ''}`)
}

// ── 1. Every op declares a valid kind ───────────────────────────────────
const types = listOperationTypes()
for (const t of types) {
  const def = OPERATIONS[t]
  check(`${t}: declares valid OP_KIND`, isValidOpKind(def.kind), `got "${def.kind}"`)
}

// ── 2. KIND_BY_TYPE consistency ─────────────────────────────────────────
for (const t of types) {
  check(`KIND_BY_TYPE[${t}] matches registry`,
        KIND_BY_TYPE[t] === OPERATIONS[t].kind)
}
check('KIND_BY_TYPE has the same key set as OPERATIONS',
      Object.keys(KIND_BY_TYPE).length === types.length)
check('KIND_BY_TYPE is frozen', Object.isFrozen(KIND_BY_TYPE))

// ── 3. Sanity: at least one of each kind ────────────────────────────────
const kinds = new Set(types.map(t => OPERATIONS[t].kind))
check('USER kind has at least one registered op', kinds.has(OP_KIND.USER))
check('SYSTEM kind has at least one registered op', kinds.has(OP_KIND.SYSTEM))
check('TRANSIENT kind has at least one registered op', kinds.has(OP_KIND.TRANSIENT))

// ── 4. Transient ops never carry an inverse ─────────────────────────────
// Apply transient ops on a trivial state and confirm the inverse field
// in the return is null or undefined. Transient = no undo by design.
for (const t of types) {
  const def = OPERATIONS[t]
  if (def.kind !== OP_KIND.TRANSIENT) continue
  const dummy = { walls: {}, rooms: {}, nodes: {}, stamps: {}, projectSettings: { floors: [] } }
  let result
  try { result = def.apply(dummy, {}) } catch { result = { inverse: 'threw' } }
  check(`transient op "${t}": apply returns null/undefined inverse`,
        result?.inverse == null,
        `got "${result?.inverse}"`)
}

// ── 5. Registry classifications match plan expectations ─────────────────
const expectUser = ['ADD_WALL', 'DELETE_WALL', 'SET_WALL_MATERIAL', 'ADD_OPENING', 'DELETE_OPENING', 'ADD_COLUMN']
for (const t of expectUser) {
  check(`${t} is USER kind`, OPERATIONS[t]?.kind === OP_KIND.USER, `got "${OPERATIONS[t]?.kind}"`)
}
const expectSystem = ['BACKFILL_IFC_GLOBAL_ID', 'MIGRATE_SCHEMA_VERSION', 'REPAIR_BROKEN_REFERENCE']
for (const t of expectSystem) {
  check(`${t} is SYSTEM kind`, OPERATIONS[t]?.kind === OP_KIND.SYSTEM, `got "${OPERATIONS[t]?.kind}"`)
}
const expectTransient = ['SET_SELECTED_WALL_ID', 'SET_HOVERED_ENTITY', 'SET_LAYER_VISIBILITY', 'SET_CURRENT_FLOOR_ID']
for (const t of expectTransient) {
  check(`${t} is TRANSIENT kind`, OPERATIONS[t]?.kind === OP_KIND.TRANSIENT, `got "${OPERATIONS[t]?.kind}"`)
}

console.log(`\nPASSED: ${passed.length}`)
for (const p of passed) console.log(`   ${p}`)
if (failed.length > 0) {
  console.log(`\nFAILED:`)
  for (const f of failed) console.log(`   ${f}`)
  process.exit(1)
}
console.log('\n✓ verify-op-kinds passed.')
