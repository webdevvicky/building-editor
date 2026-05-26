// Canonical ID generation — single home for every entity identifier.
//
// 2026-05-26 (Arch 6 Phase 1) — replaces scattered `crypto.randomUUID()`
// calls so the stable-ID contract is enforced in one place.
//
// Two IDs per persistent entity:
//   - internal `id`        — 36-char UUID (RFC 4122). May change on
//                            import/clone/split. Used for runtime
//                            addressing (selectors, indexes, etc.).
//   - external `ifcGlobalId` — 22-char IFC base64 GUID (IFC 4 §8.7.3.4
//                            "GlobalId"). STABLE for the lifetime of
//                            the entity. Used for exports, revisions,
//                            validation dismissals, persistence,
//                            journals — per ID exposure policy (C8).
//
// Catalog IDs ('HINGE_HD_4X4', 'C1', 'plinth', 'F1') stay semantic —
// they're definitions, not instances.

// uid() — internal UUID. The only place in the codebase that calls
// crypto.randomUUID() (enforced by scripts/verify-lints.mjs Rule 2).
export function uid() {
  return crypto.randomUUID()
}

// uidIfc() — 22-char IFC base64 GUID derived from a fresh UUID.
//
// IFC GlobalId encoding:
//   - Take 16 bytes of UUID
//   - Encode as base64 (24 chars including 2 padding '=')
//   - Strip padding (22 chars)
//   - Replace + → _ and / → $ (IFC base64 alphabet differs slightly)
//
// This is the standard "compressed GUID" form used by IFC exporters
// (Tekla, Revit, ArchiCAD, etc.). Stable, round-trippable, 22 chars.
export function uidIfc() {
  return uuidToIfcGuid(uid())
}

// newEntityIds() — convenience helper. Every persistent entity creation
// site calls this and spreads the result.
//
//   const { id, ifcGlobalId } = newEntityIds()
//   walls[id] = { id, ifcGlobalId, n1, n2, ... }
export function newEntityIds() {
  return { id: uid(), ifcGlobalId: uidIfc() }
}

// ── Conversion ──────────────────────────────────────────────────────────────

// uuidToIfcGuid(uuid) — convert a 36-char hyphenated UUID to a 22-char
// IFC base64 GlobalId. Pure / deterministic / round-trippable.
//
// Algorithm (IFC base64 alphabet per ISO 16739-1):
//   bytes(uuid) → base64 (standard) → strip '=' padding → replace + / with _ $
//
// For Node/browser parity we avoid Buffer and use the Uint8Array path.
export function uuidToIfcGuid(uuid) {
  if (typeof uuid !== 'string') throw new TypeError('uuidToIfcGuid: expected string')
  const hex = uuid.replace(/-/g, '')
  if (hex.length !== 32) throw new RangeError(`uuidToIfcGuid: bad UUID "${uuid}"`)
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  // Standard base64 from bytes.
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  // btoa is available in browser + Node 16+
  const b64 = btoa(binary)
  // Strip padding + apply IFC alphabet substitutions.
  return b64.replace(/=+$/, '').replace(/\+/g, '_').replace(/\//g, '$')
}

// Inverse for completeness (Phase 3 IFC export will need it).
export function ifcGuidToUuid(ifcGuid) {
  if (typeof ifcGuid !== 'string') throw new TypeError('ifcGuidToUuid: expected string')
  if (ifcGuid.length !== 22) throw new RangeError(`ifcGuidToUuid: bad length ${ifcGuid.length}`)
  const b64 = ifcGuid.replace(/_/g, '+').replace(/\$/g, '/') + '=='
  const binary = atob(b64)
  let hex = ''
  for (let i = 0; i < binary.length; i++) {
    hex += binary.charCodeAt(i).toString(16).padStart(2, '0')
  }
  // 8-4-4-4-12 hyphenation
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

// ── Format validators ──────────────────────────────────────────────────────

const UUID_RE     = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IFC_GUID_RE = /^[0-9A-Za-z_$]{22}$/   // base64 alphabet with IFC substitutions

export function isValidUuid(s)    { return typeof s === 'string' && UUID_RE.test(s) }
export function isValidIfcGuid(s) { return typeof s === 'string' && IFC_GUID_RE.test(s) }
