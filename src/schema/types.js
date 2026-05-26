// Entity schema field types — single source of truth for type validation.
//
// 2026-05-26 (Arch 9 Phase 1) — used by every entity schema in
// src/schema/entities/ and consumed by:
//   - normalizeEntity (default injection)
//   - validateEntity (type + invariant checks)
//   - verifyIntegrity (referential integrity for 'ref' fields)
//
// Each type entry exposes:
//   - validate(v)  — true if value is in domain
//   - example      — used by error messages + fixtures

import { isValidUuid, isValidIfcGuid } from '../lib/ids.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const FIELD_TYPES = Object.freeze({
  'uuid': {
    validate: v => isValidUuid(v),
    example:  '550e8400-e29b-41d4-a716-446655440000',
  },
  'ifcGuid': {
    validate: v => isValidIfcGuid(v),
    example:  'VQ6EAOKbQdSnFkRmVUQAAA',
  },
  // Foreign-key reference. Format is validated as string here; referential
  // integrity (does the target exist?) is checked by verifyIntegrity.
  'ref': {
    validate: v => typeof v === 'string' && v.length > 0,
    example:  'some-entity-id',
  },
  // Reference that may be null (e.g. opening.attachedNodeId).
  'ref|null': {
    validate: v => v === null || (typeof v === 'string' && v.length > 0),
    example:  'some-id-or-null',
  },
  'number': {
    validate: v => Number.isFinite(v),
    example:  3.14,
  },
  'number|null': {
    validate: v => v === null || Number.isFinite(v),
    example:  null,
  },
  'integer': {
    validate: v => Number.isInteger(v),
    example:  42,
  },
  'string': {
    validate: v => typeof v === 'string',
    example:  'hello',
  },
  'string|null': {
    validate: v => v === null || typeof v === 'string',
    example:  null,
  },
  'boolean': {
    validate: v => typeof v === 'boolean',
    example:  true,
  },
  'boolean|null': {
    validate: v => v === null || typeof v === 'boolean',
    example:  null,
  },
  'object|null': {
    validate: v => v === null || (typeof v === 'object' && !Array.isArray(v)),
    example:  null,
  },
  'array': {
    validate: v => Array.isArray(v),
    example:  [],
  },
  // Sentinel union for dado height etc. — number OR the 'FULL' sentinel string.
  'number|FULL|null': {
    validate: v => v === null || v === 'FULL' || Number.isFinite(v),
    example:  'FULL',
  },
  // Open string — accepts any string (used where domain isn't enumerable
  // here, e.g. plasterSystemId that points into a registry validated separately).
  'oneOf': {
    validate: v => true,   // shape-only; the schema's `oneOf` array narrows
    example:  '<one of declared values>',
  },
})

export function isValidType(typeName) {
  return typeName in FIELD_TYPES
}

// Helper for validators that need to check `oneOf` enums on a per-field basis.
// schemas declare `oneOf: ['A', 'B']` and validation walks this list.
export function fieldMatchesOneOf(value, oneOf) {
  if (!Array.isArray(oneOf)) return true
  return oneOf.includes(value)
}
