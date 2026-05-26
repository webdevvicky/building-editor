// Entity normalization — injects defaults for missing fields, drops
// legacy aliases, recurses into sub-shapes (e.g. wall.openings[]).
//
// Pure: every function returns a new object. Caller swaps the entity
// in state.
//
// Used by:
//   - loadProject (replaces 12+ ad-hoc default-injection passes)
//   - DXF import (when it ships)
//   - Journal replay validation (Arch 2)

import { ENTITY_SCHEMAS } from './entities/index.js'
import { uid, uidIfc } from '../lib/ids.js'

// Resolve a field's default. If the default is a function, call it (so
// arrays/objects get fresh references per entity). If it's a generator
// token ('uid' / 'uidIfc'), call the corresponding helper.
function _resolveDefault(field) {
  if (field.generator === 'uid')    return uid()
  if (field.generator === 'uidIfc') return uidIfc()
  if (typeof field.default === 'function') return field.default()
  return field.default
}

// Normalize a single entity against its schema.
// Returns { entity, applied: [{ field, action }] } — applied is the audit
// trail of what changed (default-injected, legacy-dropped, etc.).
export function normalizeEntity(entity, schema) {
  if (!schema) {
    return { entity, applied: [], warnings: [{ code: 'NO_SCHEMA', message: 'No schema provided' }] }
  }
  const applied = []
  const next = { ...(entity ?? {}) }

  // 1. Drop legacy aliases.
  for (const legacyField of Object.keys(schema.legacyAliases ?? {})) {
    if (legacyField in next) {
      // legacyAliases[legacyField] === null means "just delete"
      // legacyAliases[legacyField] === 'newName' means "rename"
      const target = schema.legacyAliases[legacyField]
      if (target === null) {
        delete next[legacyField]
        applied.push({ field: legacyField, action: 'dropped-legacy' })
      } else {
        if (!(target in next)) next[target] = next[legacyField]
        delete next[legacyField]
        applied.push({ field: legacyField, action: 'renamed', to: target })
      }
    }
  }

  // 2. Inject defaults for missing required fields.
  for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
    if (next[fieldName] === undefined) {
      if (fieldDef.required || 'default' in fieldDef || 'generator' in fieldDef) {
        next[fieldName] = _resolveDefault(fieldDef)
        applied.push({ field: fieldName, action: 'defaulted' })
      }
    }
  }

  // 3. Recurse into array sub-shapes (e.g. wall.openings[]).
  for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
    if (fieldDef.itemSchema && Array.isArray(next[fieldName])) {
      const subSchema = ENTITY_SCHEMAS[fieldDef.itemSchema]
      if (subSchema) {
        next[fieldName] = next[fieldName].map(item => {
          const sub = normalizeEntity(item, subSchema)
          for (const a of sub.applied) applied.push({ field: `${fieldName}[].${a.field}`, action: a.action })
          return sub.entity
        })
      }
    }
  }

  return { entity: next, applied }
}

// Normalize a whole collection map: { [id]: entity } → same shape with
// every entity normalized. Stable iteration order (insertion-order).
export function normalizeCollection(collection, schema) {
  if (!collection || typeof collection !== 'object') return { collection: {}, applied: [] }
  const next = {}
  const applied = []
  for (const [id, entity] of Object.entries(collection)) {
    const sub = normalizeEntity(entity, schema)
    next[id] = sub.entity
    for (const a of sub.applied) applied.push({ entityId: id, ...a })
  }
  return { collection: next, applied }
}

// Normalize a whole state object against every schema. Used by
// loadProject (replaces ad-hoc passes) and import paths.
//
// Walks both post-Arch-1 (state.model.X) and legacy (state.X) slice
// paths transparently.
export function normalizeState(state) {
  if (!state || typeof state !== 'object') return { state: {}, applied: [] }
  const next = { ...state }
  const applied = []

  // Helper: normalize state[key] using schemaName, write back to next[key].
  function normalizeAtPath(pathSegments, schemaName) {
    const schema = ENTITY_SCHEMAS[schemaName]
    if (!schema) return
    // Walk path to find the collection map.
    let cursor = next
    for (let i = 0; i < pathSegments.length - 1; i++) {
      if (!cursor[pathSegments[i]] || typeof cursor[pathSegments[i]] !== 'object') return
      cursor = cursor[pathSegments[i]]
    }
    const lastKey = pathSegments[pathSegments.length - 1]
    const map = cursor[lastKey]
    if (!map || typeof map !== 'object') return
    const result = normalizeCollection(map, schema)
    cursor[lastKey] = result.collection
    for (const a of result.applied) applied.push({ slice: pathSegments.join('.'), ...a })
  }

  // Try both legacy + post-Arch-1 paths.
  for (const [entityType, schema] of Object.entries(ENTITY_SCHEMAS)) {
    const slicePath = schema.storeSlice ?? ''
    const legacyKey = slicePath.replace(/^model\./, '')
    // Try legacy path first (current state shape).
    if (legacyKey && next[legacyKey]) {
      normalizeAtPath([legacyKey], entityType)
    }
    // Also try post-Arch-1 path if model wrapper exists.
    if (next.model && slicePath.startsWith('model.')) {
      normalizeAtPath(slicePath.split('.'), entityType)
    }
  }

  return { state: next, applied }
}
