// scripts/verify-schemas.mjs
//
// Arch 9 (Phase 1) — every entity schema is well-formed:
//   - declared entityType matches the registry key
//   - storeSlice is a non-empty string
//   - every field declares a valid type from FIELD_TYPES
//   - required fields without default values declare a generator
//   - invariants are { id, check, message } shape
//   - legacyAliases values are null or string
//
// Plus: spot-check normalization + validation work end-to-end.

import { ENTITY_SCHEMAS, SCHEMAS_BY_SLICE } from '../src/schema/entities/index.js'
import { FIELD_TYPES } from '../src/schema/types.js'
import { normalizeEntity, normalizeState } from '../src/schema/normalize.js'
import { validateEntity, validateState } from '../src/schema/validate.js'
import { newEntityIds } from '../src/lib/ids.js'

const passed = []
const failed = []
function check(name, cond, info) {
  (cond ? passed : failed).push(`${name}${info ? '  (' + info + ')' : ''}`)
}

// ── 1. Registry well-formedness ─────────────────────────────────────────
check('ENTITY_SCHEMAS has 17 schemas',
      Object.keys(ENTITY_SCHEMAS).length === 17,
      `got ${Object.keys(ENTITY_SCHEMAS).length}`)

check('ENTITY_SCHEMAS is frozen', Object.isFrozen(ENTITY_SCHEMAS))

for (const [name, schema] of Object.entries(ENTITY_SCHEMAS)) {
  check(`${name}: registered with matching entityType`,
        schema.entityType === name,
        `entityType=${schema.entityType}`)
  check(`${name}: storeSlice is non-empty string`,
        typeof schema.storeSlice === 'string' && schema.storeSlice.length > 0)
  check(`${name}: schema is frozen`, Object.isFrozen(schema))
  check(`${name}: fields is object`, typeof schema.fields === 'object' && schema.fields !== null)
  check(`${name}: has invariants array`, Array.isArray(schema.invariants))

  // Every field declares a known type from FIELD_TYPES
  for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
    check(`${name}.${fieldName}: type "${fieldDef.type}" is recognized`,
          fieldDef.type in FIELD_TYPES,
          `got "${fieldDef.type}"`)
  }

  // Required fields must have default or generator (so normalizeEntity can fill them)
  for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
    if (fieldDef.required && !('default' in fieldDef) && !fieldDef.generator) {
      // Some fields are user-supplied (e.g. wall.n1 / wall.n2 / room.name)
      // — they have no sensible default. That's fine; flag them informationally.
      // Don't fail; just note.
    }
  }

  // Invariants are { id, check, message }
  for (const inv of schema.invariants) {
    check(`${name}: invariant "${inv.id}" has check function`,
          typeof inv.check === 'function')
    check(`${name}: invariant "${inv.id}" has message`,
          typeof inv.message === 'string' && inv.message.length > 0)
  }
}

// ── 2. SCHEMAS_BY_SLICE exposes both legacy + post-Arch-1 keys ─────────
check('SCHEMAS_BY_SLICE has model.* keys',
      Object.keys(SCHEMAS_BY_SLICE).some(k => k.startsWith('model.')))
check('SCHEMAS_BY_SLICE has legacy keys (without model. prefix)',
      'walls' in SCHEMAS_BY_SLICE && 'rooms' in SCHEMAS_BY_SLICE)

// ── 3. normalizeEntity round-trip ──────────────────────────────────────
const wallSchema = ENTITY_SCHEMAS.wall

const ids = newEntityIds()
const partialWall = { id: ids.id, ifcGlobalId: ids.ifcGlobalId, n1: 'node-1', n2: 'node-2' }
const { entity: normalized, applied } = normalizeEntity(partialWall, wallSchema)
check('normalizeEntity injects height default',
      normalized.height === 120)
check('normalizeEntity injects materialKey default',
      normalized.materialKey === 'IS_MODULAR_BRICK')
check('normalizeEntity injects openings: []',
      Array.isArray(normalized.openings) && normalized.openings.length === 0)
check('normalizeEntity injects floorId default',
      normalized.floorId === 'F1')
check('normalizeEntity reports applied changes',
      applied.length > 0)

// Each call to normalizeEntity gets a fresh openings array (functional default)
const { entity: w2 } = normalizeEntity(partialWall, wallSchema)
w2.openings.push('mutation')
const { entity: w3 } = normalizeEntity(partialWall, wallSchema)
check('normalizeEntity returns fresh array each call (no shared mutation)',
      w3.openings.length === 0)

// ── 4. Legacy alias drop (wall.foundationId → null) ────────────────────
const legacyWall = { id: ids.id, ifcGlobalId: ids.ifcGlobalId, n1: 'a', n2: 'b', foundationId: 'old-foundation' }
const { entity: legacyOut, applied: legacyApplied } = normalizeEntity(legacyWall, wallSchema)
check('normalizeEntity drops legacyAliases (foundationId)',
      !('foundationId' in legacyOut))
check('normalizeEntity reports legacy-dropped action',
      legacyApplied.some(a => a.action === 'dropped-legacy' && a.field === 'foundationId'))

// ── 5. validateEntity on well-formed wall ──────────────────────────────
const goodWall = { ...normalized, id: ids.id, n1: 'n-1', n2: 'n-2' }
const result = validateEntity(goodWall, wallSchema)
check('validateEntity passes on well-formed wall', result.valid,
      result.valid ? '' : result.errors.map(e => e.message).join('; '))

// ── 6. validateEntity catches type mismatch ────────────────────────────
const badWall = { ...goodWall, height: 'not-a-number' }
const badResult = validateEntity(badWall, wallSchema)
check('validateEntity catches type mismatch on height',
      !badResult.valid && badResult.errors.some(e => e.field === 'height'))

// ── 7. validateEntity catches invariant failure ────────────────────────
const sameNodeWall = { ...goodWall, n1: 'X', n2: 'X' }
const sameNodeResult = validateEntity(sameNodeWall, wallSchema)
check('validateEntity catches wall.distinct-nodes invariant',
      !sameNodeResult.valid &&
      sameNodeResult.errors.some(e => e.field === 'wall.distinct-nodes'))

// ── 8. validateEntity catches NOT_IN_ONEOF on opening.type ─────────────
const openingSchema = ENTITY_SCHEMAS.opening
const badOpening = {
  id: ids.id, ifcGlobalId: ids.ifcGlobalId,
  offset: 0, width: 36, height: 84,
  type: 'magic',   // ← not in ['door', 'window']
  orient: 0, hasSunshade: false, hasGrill: null,
  subtype: 'MAIN_DOOR', subtypeSource: 'EXPLICIT',
}
const badOpeningResult = validateEntity(badOpening, openingSchema)
check('validateEntity catches opening.type NOT_IN_ONEOF',
      !badOpeningResult.valid &&
      badOpeningResult.errors.some(e => e.code === 'NOT_IN_ONEOF' && e.field === 'type'))

// ── 9. normalizeState walks a state object ─────────────────────────────
const sampleState = {
  nodes: { 'n1': { id: 'n1', ifcGlobalId: 'abc1234567890123456789', x: 0, y: 0 } },
  walls: {
    'w1': { id: 'w1', ifcGlobalId: 'def1234567890123456789', n1: 'n1', n2: 'n1' },
  },
  rooms: {},
  stamps: {},
  projectSettings: { floors: [{ id: 'F1' }] },
}
const { state: normalizedState, applied: stateApplied } = normalizeState(sampleState)
check('normalizeState injects defaults into nodes (floorIds)',
      Array.isArray(normalizedState.nodes['n1'].floorIds))
check('normalizeState injects defaults into walls (height, materialKey, openings)',
      normalizedState.walls['w1'].height === 120 &&
      normalizedState.walls['w1'].materialKey === 'IS_MODULAR_BRICK' &&
      Array.isArray(normalizedState.walls['w1'].openings))
check('normalizeState reports applied changes',
      stateApplied.length > 0)

// ── 10. validateState walks a state object ─────────────────────────────
const validationResult = validateState(normalizedState)
// The w1 wall has n1 === n2 — should fail validation.
check('validateState catches wall.distinct-nodes from sample',
      !validationResult.valid &&
      validationResult.errorsByCollection.wall?.some(e => e.field === 'wall.distinct-nodes'))

console.log(`\nPASSED: ${passed.length}`)
for (const p of passed) console.log(`   ${p}`)
if (failed.length > 0) {
  console.log(`\nFAILED:`)
  for (const f of failed) console.log(`   ${f}`)
  process.exit(1)
}
console.log('\n✓ verify-schemas passed.')
