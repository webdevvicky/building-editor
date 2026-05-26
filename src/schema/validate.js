// Entity validation — type checks + invariants. Pure functions.
//
// Distinct from src/schema/integrity.js — validation checks SHAPE
// (does opening.width have a finite number?); integrity checks
// REFERENCES (does wall.n1 point to a real node?).
//
// Used by:
//   - Journal replay (Arch 2) — validate operation payload before apply
//   - Persistence write (Arch 5) — validate before save
//   - loadProject — post-normalize sanity gate

import { FIELD_TYPES, fieldMatchesOneOf } from './types.js'
import { ENTITY_SCHEMAS } from './entities/index.js'

// Validate a single field value against its declared type + oneOf.
function _validateField(value, fieldDef) {
  const typeEntry = FIELD_TYPES[fieldDef.type]
  if (!typeEntry) return { valid: false, code: 'UNKNOWN_TYPE', got: typeof value }
  if (value === undefined) {
    if (fieldDef.required) return { valid: false, code: 'REQUIRED_MISSING' }
    return { valid: true }
  }
  if (!typeEntry.validate(value)) {
    return { valid: false, code: 'TYPE_MISMATCH', expected: fieldDef.type, got: typeof value }
  }
  if (fieldDef.oneOf && !fieldMatchesOneOf(value, fieldDef.oneOf)) {
    return { valid: false, code: 'NOT_IN_ONEOF', expected: fieldDef.oneOf, got: value }
  }
  // Min/max for numbers
  if (fieldDef.type === 'number') {
    if (typeof fieldDef.min === 'number' && value < fieldDef.min) {
      return { valid: false, code: 'BELOW_MIN', min: fieldDef.min, got: value }
    }
    if (typeof fieldDef.max === 'number' && value > fieldDef.max) {
      return { valid: false, code: 'ABOVE_MAX', max: fieldDef.max, got: value }
    }
  }
  return { valid: true }
}

// Validate an entity against a schema. Returns { valid, errors[] }.
export function validateEntity(entity, schema) {
  const errors = []
  if (!entity || typeof entity !== 'object') {
    return { valid: false, errors: [{ code: 'NOT_OBJECT', message: 'Expected entity object' }] }
  }
  if (!schema) {
    return { valid: false, errors: [{ code: 'NO_SCHEMA', message: 'Schema missing for entity type' }] }
  }

  // 1. Field-level checks.
  for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
    const result = _validateField(entity[fieldName], fieldDef)
    if (!result.valid) {
      errors.push({
        code:    result.code,
        field:   fieldName,
        message: `${schema.entityType}.${fieldName}: ${result.code}`,
        details: result,
      })
    }
  }

  // 2. Schema invariants (cross-field).
  for (const inv of (schema.invariants ?? [])) {
    let result
    try { result = inv.check(entity) } catch (err) {
      result = false
      errors.push({ code: 'INVARIANT_THREW', field: inv.id, message: `${inv.id}: threw ${err.message}` })
      continue
    }
    if (!result) {
      errors.push({ code: 'INVARIANT_FAILED', field: inv.id, message: inv.message ?? inv.id })
    }
  }

  // 3. Recurse into array sub-shapes.
  for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
    if (fieldDef.itemSchema && Array.isArray(entity[fieldName])) {
      const subSchema = ENTITY_SCHEMAS[fieldDef.itemSchema]
      if (subSchema) {
        entity[fieldName].forEach((item, idx) => {
          const sub = validateEntity(item, subSchema)
          for (const e of sub.errors) {
            errors.push({ ...e, field: `${fieldName}[${idx}].${e.field}` })
          }
        })
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

// Validate every collection in state. Returns { valid, errorsByCollection }.
export function validateState(state) {
  const errorsByCollection = {}
  if (!state || typeof state !== 'object') {
    return { valid: false, errorsByCollection: { _root: [{ code: 'NOT_OBJECT' }] } }
  }
  for (const schema of Object.values(ENTITY_SCHEMAS)) {
    const slicePath = schema.storeSlice ?? ''
    const legacyKey = slicePath.replace(/^model\./, '')
    // Resolve which collection to validate (legacy or post-Arch-1).
    const collection = state.model?.[legacyKey] ?? state[legacyKey]
    if (!collection || typeof collection !== 'object') continue
    const errs = []
    for (const [id, entity] of Object.entries(collection)) {
      const result = validateEntity(entity, schema)
      if (!result.valid) {
        for (const e of result.errors) errs.push({ entityId: id, ...e })
      }
    }
    if (errs.length > 0) errorsByCollection[schema.entityType] = errs
  }
  return {
    valid: Object.keys(errorsByCollection).length === 0,
    errorsByCollection,
  }
}
