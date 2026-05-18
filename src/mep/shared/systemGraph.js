// Generic helpers for the MEP system graph.
//
// Discipline-specific buildSystemGraph(...) functions live in
// src/mep/{plumbing,electrical,hvac,fire,elv,solar}/network.js. The helpers
// here are the common scaffolding every builder uses: deterministic id
// minting, graph validation, sort comparators.
//
// All pure. No store access.

// ── FNV-1a 32-bit hash ──────────────────────────────────────────────────────
//
// Deterministic, dependency-free. Sufficient for collision-resistant ids over
// the entity-id space of a single project. Returns an 8-char hex string.

export function fnv1aHash(str) {
  let h = 0x811c9dc5 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    // 32-bit FNV prime multiplication using unsigned shifts
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

// Stable string from any JSON-serializable payload. Keys are sorted at every
// object level so payload field-order doesn't affect the hash.
function _stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map(_stableStringify).join(',') + ']'
  }
  const keys = Object.keys(value).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + _stableStringify(value[k])).join(',') + '}'
}

// ── Deterministic id minting ────────────────────────────────────────────────

export function nodeIdFor(entityId, role, systemId) {
  const payload = _stableStringify({ entityId: entityId ?? null, role, systemId })
  return 'n_' + fnv1aHash(payload)
}

export function edgeIdFor(fromNodeId, toNodeId, systemId, kind) {
  // Canonicalize endpoint order so the same edge minted twice gets the same id.
  const [a, b] = fromNodeId < toNodeId ? [fromNodeId, toNodeId] : [toNodeId, fromNodeId]
  const payload = _stableStringify({ a, b, systemId, kind })
  return 'e_' + fnv1aHash(payload)
}

export function branchIdFor(systemId, sortedLeafIds) {
  // Caller is expected to pass sorted ids — we re-sort defensively so the
  // contract is honored even if callers forget.
  const leaves = [...sortedLeafIds].sort()
  const payload = _stableStringify({ systemId, leaves })
  return 'b_' + fnv1aHash(payload)
}

// ── Graph validation ────────────────────────────────────────────────────────

// graph shape: { nodes: SystemNode[], edges: SystemEdge[], branches?: Branch[] }
// Returns { valid, errors }. Empty errors[] when valid.
export function validateGraph(graph) {
  const errors = []
  if (!graph || typeof graph !== 'object') {
    return { valid: false, errors: ['graph is not an object'] }
  }
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : null
  const edges = Array.isArray(graph.edges) ? graph.edges : null
  if (!nodes) errors.push('graph.nodes must be an array')
  if (!edges) errors.push('graph.edges must be an array')
  if (errors.length) return { valid: false, errors }

  const nodeIds = new Set()
  for (const n of nodes) {
    if (!n || typeof n.id !== 'string') {
      errors.push('node missing id')
      continue
    }
    if (nodeIds.has(n.id)) errors.push(`duplicate node id: ${n.id}`)
    nodeIds.add(n.id)
    if (typeof n.x !== 'number' || typeof n.y !== 'number') {
      errors.push(`node ${n.id} missing numeric x/y`)
    }
    if (typeof n.discipline !== 'string' || !n.discipline) {
      errors.push(`node ${n.id} missing discipline`)
    }
    if (typeof n.kind !== 'string' || !n.kind) {
      errors.push(`node ${n.id} missing kind`)
    }
  }

  const edgeIds = new Set()
  for (const e of edges) {
    if (!e || typeof e.id !== 'string') {
      errors.push('edge missing id')
      continue
    }
    if (edgeIds.has(e.id)) errors.push(`duplicate edge id: ${e.id}`)
    edgeIds.add(e.id)
    if (!nodeIds.has(e.fromNodeId)) {
      errors.push(`edge ${e.id} fromNodeId ${e.fromNodeId} not in graph`)
    }
    if (!nodeIds.has(e.toNodeId)) {
      errors.push(`edge ${e.id} toNodeId ${e.toNodeId} not in graph`)
    }
    if (e.fromNodeId === e.toNodeId) {
      errors.push(`edge ${e.id} is a self-loop`)
    }
  }

  if (Array.isArray(graph.branches)) {
    for (const b of graph.branches) {
      if (!b || typeof b.id !== 'string') {
        errors.push('branch missing id')
        continue
      }
      for (const nid of (b.nodeIds ?? [])) {
        if (!nodeIds.has(nid)) errors.push(`branch ${b.id} references missing node ${nid}`)
      }
      for (const eid of (b.edgeIds ?? [])) {
        if (!edgeIds.has(eid)) errors.push(`branch ${b.id} references missing edge ${eid}`)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

// ── Deterministic sort helpers ──────────────────────────────────────────────
//
// Sort by id only — node/edge ids are content-addressed via fnv1a so equal
// content → equal id → stable sort across runs.

function _byId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function sortNodesDeterministically(nodes) {
  return [...nodes].sort(_byId)
}

export function sortEdgesDeterministically(edges) {
  return [...edges].sort(_byId)
}
