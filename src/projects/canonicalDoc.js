// canonicalDoc.js — Phase 1: the editor's canonical Building Document.
//
// The editor's own buildSnapshot() output IS the canonical model. This module
// builds the wire document (payload + checksum + schemaVersion), verifies the
// checksum on read, and talks to the ERP canonical-document REST surface
// (PUT/GET /building-structure/buildings/:id/document) using the same scoped
// editor-session token the live sync uses.
//
// IMPORTANT: this is the WRITE path only. Nothing here loads the canvas — the
// reopen path still reconstructs from the PostgreSQL projection (Phase 2 changes
// that, not this).

import { buildSnapshot } from './_snapshot.js'

const SCHEMA_VERSION_FALLBACK = 7

// ── Checksum (corruption detection) ─────────────────────────────────────────
// SHA-256 when a SubtleCrypto is available (browser secure context / Node 18+),
// else a deterministic FNV-1a fallback. The algorithm only needs to be stable
// (same input → same digest) so a corrupted/truncated payload is detectable.

export async function computeChecksum(jsonString) {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const data = new TextEncoder().encode(jsonString)
    const digest = await subtle.digest('SHA-256', data)
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return `sha256:${hex}`
  }
  return `fnv1a:${_fnv1a(jsonString)}`
}

function _fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** True iff `checksum` matches a freshly computed digest of `payload`. */
export async function verifyChecksum(payload, checksum) {
  if (!checksum) return false
  const recomputed = await computeChecksum(JSON.stringify(payload))
  return recomputed === checksum
}

// ── Document builder ────────────────────────────────────────────────────────
// Returns the WIRE body MINUS baseVersion (the upload queue stamps baseVersion
// at send time, since it can advance between build and send). Shape is exactly
// { schemaVersion, checksum, payload } so the queue adds only baseVersion.

export async function buildSnapshotDoc(state) {
  const payload = buildSnapshot(state)
  const checksum = await computeChecksum(JSON.stringify(payload))
  return {
    schemaVersion: payload.version ?? SCHEMA_VERSION_FALLBACK,
    checksum,
    payload,
  }
}

// ── ERP REST client (canonical document surface) ────────────────────────────

async function _request(conn, method, path, body) {
  const token = await conn.getToken()
  const url = `${conn.erpUrl.replace(/\/$/, '')}/api/v1${path}`
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    // Format mirrors liveSync so a status code can be parsed off the message.
    throw new Error(`[canonicalDoc] ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

// The ERP ResponseInterceptor wraps payloads as { success, data, meta, error }.
function _unwrap(envelope) {
  return envelope && envelope.data !== undefined ? envelope.data : envelope
}

/** PUT a new canonical document. Body: { baseVersion, schemaVersion, checksum, payload }. */
export async function putCanonicalDocument(conn, buildingId, body) {
  const res = await _request(conn, 'PUT', `/building-structure/buildings/${buildingId}/document`, body)
  return _unwrap(res)
}

/** GET the current canonical document → { snapshotVersion, checksum, payload }. */
export async function getCanonicalDocument(conn, buildingId) {
  const res = await _request(conn, 'GET', `/building-structure/buildings/${buildingId}/document`)
  return _unwrap(res)
}

/** Parse the HTTP status off an error thrown by _request (else null). */
export function statusCodeFromError(err) {
  const m = String(err?.message ?? '')
  const match = m.match(/→ (\d{3}):/)
  return match ? Number(match[1]) : null
}
