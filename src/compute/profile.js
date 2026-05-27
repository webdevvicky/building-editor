// Compute profiling — per-node timings + cache hit metrics.
//
// Arch 3 Phase 3. Dev-mode instrumentation that surfaces:
//   - Avg + max compute time per node
//   - Cache hit rate (hit / total calls)
//   - Total time per class (topology / quantity / etc.)
//
// Verify scripts opt in via `--profile` CLI flag, which sets
// `process.env.COMPUTE_PROFILE = '1'` before importing aggregators.
// At verify-script teardown, `printProfile()` dumps the table.
//
// Production behavior: zero-cost no-ops (record functions branch on the
// `enabled` flag set at import time).

const _stats = new Map()
let _enabled = false

if (typeof process !== 'undefined' && process.env && process.env.COMPUTE_PROFILE === '1') {
  _enabled = true
}
// Browser opt-in via window.__COMPUTE_PROFILE = true before app boot.
if (typeof window !== 'undefined' && window.__COMPUTE_PROFILE === true) {
  _enabled = true
}

export function isProfileEnabled() { return _enabled }
export function enableProfile()    { _enabled = true }
export function disableProfile()   { _enabled = false; _stats.clear() }

// Record one compute call. Called from registry.js runComputation only
// when _enabled is true; otherwise zero-cost.
export function recordCompute(node, { hit, ms }) {
  if (!_enabled) return
  const id = node.id
  let s = _stats.get(id)
  if (!s) {
    s = {
      id,
      class:    node.class,
      version:  node.version,
      hits:     0,
      misses:   0,
      totalMs:  0,
      maxMs:    0,
    }
    _stats.set(id, s)
  }
  if (hit) {
    s.hits += 1
  } else {
    s.misses += 1
    s.totalMs += ms
    if (ms > s.maxMs) s.maxMs = ms
  }
}

// Returns the snapshot for one node or all.
export function getProfile(nodeId) {
  if (nodeId) return _stats.get(nodeId) ?? null
  return [..._stats.values()]
}

export function resetProfile() {
  _stats.clear()
}

// Dump a sortable table to console. Called at verify-script teardown
// when --profile was passed.
//
//   Node                              Class         Calls  Hits  Avg ms  Max ms  Total ms
//   ─────────────────────────────────────────────────────────────────────────────────
//   topology.wallAdjacency            topology       42     38    0.3     1.2     12.0
//   plaster.quantities                quantity        4      0   12.5    18.2     50.0  ⚠
//   ...
export function printProfile() {
  if (!_enabled) {
    console.log('\n[profile] disabled — pass --profile to enable')
    return
  }
  const rows = [..._stats.values()]
  if (rows.length === 0) {
    console.log('\n[profile] no compute nodes registered or called')
    return
  }
  // Sort by total ms desc.
  rows.sort((a, b) => b.totalMs - a.totalMs)
  const JANK_THRESHOLD_MS = 25
  const totalMs = rows.reduce((s, r) => s + r.totalMs, 0)

  const colWidths = {
    id:    Math.max(20, Math.max(...rows.map(r => r.id.length)) + 2),
    cls:   12,
    calls: 7,
    hits:  6,
    avg:   8,
    max:   8,
    total: 10,
  }
  function pad(s, w) { return String(s).padEnd(w) }
  function padR(s, w) { return String(s).padStart(w) }

  console.log('\n─── Computation profile ───')
  console.log(
    pad('Node', colWidths.id) +
    pad('Class', colWidths.cls) +
    padR('Calls', colWidths.calls) +
    padR('Hits',  colWidths.hits) +
    padR('Avg ms', colWidths.avg) +
    padR('Max ms', colWidths.max) +
    padR('Total ms', colWidths.total),
  )
  console.log('─'.repeat(Object.values(colWidths).reduce((s, w) => s + w, 0)))
  for (const r of rows) {
    const calls = r.hits + r.misses
    const avg   = r.misses ? (r.totalMs / r.misses) : 0
    const flag  = avg > JANK_THRESHOLD_MS ? ' ⚠' : ''
    console.log(
      pad(r.id, colWidths.id) +
      pad(r.class, colWidths.cls) +
      padR(calls, colWidths.calls) +
      padR(r.hits, colWidths.hits) +
      padR(avg.toFixed(2), colWidths.avg) +
      padR(r.maxMs.toFixed(2), colWidths.max) +
      padR(r.totalMs.toFixed(2), colWidths.total) +
      flag,
    )
  }
  console.log('─'.repeat(Object.values(colWidths).reduce((s, w) => s + w, 0)))
  console.log(`Total: ${totalMs.toFixed(2)}ms across ${rows.length} computations`)

  const slow = rows.filter(r => r.misses && r.totalMs / r.misses > JANK_THRESHOLD_MS)
  if (slow.length) {
    console.log(`Slow (>${JANK_THRESHOLD_MS}ms avg): ${slow.map(r => `${r.id} (${r.class})`).join(', ')}`)
    console.log('Consider DAG dep tightening — workers deferred per C3 until repeated >50ms causes jank.')
  }
}
