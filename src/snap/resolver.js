// Snap resolver — single entry point for screen→world coord conversion
// across every drawing tool.
//
// Replaces the old `screenToWorld` (snapped) helper. `screenToWorldRaw`
// (the pixel-accurate math primitive) is retained and used internally.
//
// CONTRACT
//   resolveSnap(state, screenXY, ctx) → {
//     worldXY:    { x, y },                  // resolved world inches
//     targetKind: string | null,             // SNAP_TARGETS id of the winner
//     sourceId:   string | { kind, … } | null,
//     raw:        boolean,                   // true if snap was bypassed / no match
//     _debug?:    { chosen, candidates[], rejected[], policy[], timingMs }
//                                            // DEV-only; absent in prod
//   }
//
//   ctx = {
//     toolId:     string,                     // active tool id
//     pan:        { x, y },                   // viewport pan (screen px)
//     zoom:       number,                     // viewport zoom factor
//     svgRect:    DOMRect | { left, top },    // SVG bounding rect
//     settings:   projectSettings.snap,       // user's snap config
//     modifiers?: { bypass?: boolean },       // Alt-held → bypass snap
//     // Phase B may extend (e.g. underlayRasterCacheRef). Targets read
//     // what they need; resolver passes ctx through opaquely.
//   }
//
// DETERMINISTIC TIE-BREAKING + PRIORITY TIERS (contract — refined
// post-implementation; both adjustments preserve cross-machine
// determinism)
//
//   The winner is chosen by this comparator chain:
//     1. Primary:    `tier` ascending. Tier 0 = real targets that
//                    compete on distance (NODE, WALL_ENDPOINT,
//                    WALL_MIDPOINT, WALL_NEAREST, WALL_SEGMENT). Tier 1
//                    = fallback targets (GRID). A tier-0 candidate
//                    ALWAYS beats a tier-1 candidate, regardless of
//                    distance. This expresses "policy says try wall
//                    first, fall back to grid" — not "whichever target
//                    happens to be closer to the click wins."
//     2. Secondary:  `distanceIn` ascending. Within a tier, closer
//                    wins.
//     3. Tertiary:   `_policyIndex` ascending — earlier policy entry
//                    wins at equal-distance ties between different
//                    targets in the same tier.
//     4. Quaternary: `_sortKey` lexicographic ascending — deterministic
//                    tie-break within a single target's candidate set
//                    (e.g., two equidistant nodes).
//
//   All four keys are fully deterministic from the policy array,
//   candidate identity, and target descriptor, so this preserves
//   cross-runs / machines / browsers reproducibility.
//   verify-snap.mjs Section G fuzz-tests this rule against shuffled
//   candidate orderings.
//
// PREPARE() RE-ENTRANCE
//   Targets that opt into `prepare(state, signal)` may be invoked again
//   before a prior call resolves. The resolver maintains a per-target
//   AbortController map: a new prepare call aborts the prior controller
//   first, then constructs a new one and passes the new signal. Targets
//   MUST honor `signal.aborted` and discard partial work.
//
// PURITY
//   This module is pure & Node-testable: no React, no DOM, no Zustand
//   dispatches. The renderOverlay thunks returned by targets are invoked
//   by Canvas, never here.
//
// POST-MERGE CONTRACT REFINEMENTS (both accepted as real architectural
// improvements during Phase A integration — preserved here so future
// contributors understand why the contract evolved)
//
//   1. Priority tier on target descriptors.
//      The original contract had `distanceIn` as the primary comparator
//      key. That produced surprising results because GRID's distance
//      (always ≤ pitchIn × √2 / 2 ≈ 8.5in for pitchIn=12) often beat
//      WALL_NEAREST's wall-perpendicular distance (10–36in). Result:
//      MEP clicks landed on the grid cell instead of the nearby wall,
//      contradicting policy intent.
//      Fix: each target declares `tier` (0 = real, 1 = fallback). GRID
//      moved to tier 1. Tier became the primary comparator key. A
//      tier-0 candidate always beats a tier-1 candidate regardless of
//      distance — so "policy says try wall first, fall back to grid"
//      now actually holds. Determinism preserved (tier values are
//      registry-frozen, comparator chain stays deterministic). See
//      Section B + Section G of verify-snap.mjs.
//
//   2. MEP policies extended with GRID fallback.
//      Original MEP policies were [WALL_NEAREST] only. On an empty /
//      wall-free canvas, WALL_NEAREST returned null and the resolver
//      fell through to raw — diverging from today's behavior (legacy
//      MEP code pre-snapped via screenToWorld before walking walls;
//      with no walls in range, the snapped output stuck).
//      Fix: MEP policies in TOOL_SNAP_POLICY are now
//      [WALL_NEAREST, GRID]. Tier-based comparator ensures GRID only
//      wins when WALL_NEAREST returned null (wall-free canvas) or was
//      out of tolerance (>36in from any wall). Section A byte-equality
//      restored at 1400/1400.
//
//   Both refinements are documented in CLAUDE.md → "Phase A — Snap
//   Architecture" (Locked rules + Phase B compatibility audit).

import { SNAP_TARGETS } from './targets.js'
import { TOOL_SNAP_POLICY, normalizePolicyEntry } from './toolPolicy.js'

// ── Raw transform primitive — kept local to avoid coupling to geometry.js
//    so this module can be exercised in Node tests.
//
// SVG pixels → world inches. Mirror of screenToWorldRaw in geometry.js.
const PX_PER_INCH = 5 / 3

export function screenToWorldRaw(clientX, clientY, svgRect, pan, zoom) {
  return {
    x:  (clientX - svgRect.left - pan.x) / zoom / PX_PER_INCH,
    y: -(clientY - svgRect.top  - pan.y) / zoom / PX_PER_INCH,
  }
}

// ── Prepare / AbortController lifecycle (Phase B contract, used by Phase
//    A only for the empty default — no Phase A target opts into prepare).

const _prepareControllers = new Map()  // targetId → AbortController
const _prepareLastState   = new Map()  // targetId → state ref (referential)

/**
 * Invoke prepare() for every registered target whose state-dependence
 * changed. Targets that do not declare prepare are skipped.
 *
 * Called externally (e.g. on underlay import / floor switch) — NOT from
 * the click hot path. The resolver itself does not invoke prepare during
 * resolveSnap; it only consults the cache that prepare populates.
 *
 * Re-entrant: invoking again before the prior call resolves aborts the
 * prior controller first. Targets must honor signal.aborted.
 */
export function runPrepareForAllTargets(state, registry = SNAP_TARGETS) {
  const out = []
  for (const id of Object.keys(registry)) {
    const target = registry[id]
    if (typeof target.prepare !== 'function') continue
    if (_prepareLastState.get(id) === state) continue   // no state change
    const prior = _prepareControllers.get(id)
    if (prior) {
      try { prior.abort() } catch { /* swallow */ }
    }
    const controller = new AbortController()
    _prepareControllers.set(id, controller)
    _prepareLastState.set(id, state)
    try {
      const ret = target.prepare(state, controller.signal)
      if (ret && typeof ret.then === 'function') {
        out.push(ret.catch(() => null))   // never reject the pipeline
      }
    } catch { /* swallow */ }
  }
  return out
}

// Test helper — verify-snap.mjs uses this to reset between sections.
export function _resetPrepareState() {
  for (const c of _prepareControllers.values()) {
    try { c.abort() } catch { /* swallow */ }
  }
  _prepareControllers.clear()
  _prepareLastState.clear()
}

// Get the live AbortController for a target (verify-snap F8 uses this to
// assert the prior signal is aborted before the next prepare begins).
export function _getPrepareController(targetId) {
  return _prepareControllers.get(targetId) ?? null
}

// ── Resolver core ───────────────────────────────────────────────────────

const DEV_ENABLED = (
  typeof process !== 'undefined' && process?.env?.NODE_ENV !== 'production'
)

// Compare candidates: tier asc → distance asc → policyIndex asc → sortKey lex asc.
// Tier asc gives fallback targets (GRID, tier 1) lowest priority, so
// they only "win" when every tier-0 target returned null. Within a tier,
// distance is primary; policyIndex resolves cross-target ties; sortKey
// resolves within-target ties.
function _compareCandidates(a, b) {
  if (a._tier !== b._tier) return a._tier - b._tier
  if (a.distanceIn !== b.distanceIn) return a.distanceIn - b.distanceIn
  if (a._policyIndex !== b._policyIndex) return a._policyIndex - b._policyIndex
  if (a._sortKey < b._sortKey) return -1
  if (a._sortKey > b._sortKey) return 1
  return 0
}

/**
 * Pure resolver: takes a screen-coord click, returns the snapped world
 * coord + the winning target metadata.
 */
export function resolveSnap(state, screenXY, ctx) {
  const start = (DEV_ENABLED && typeof performance !== 'undefined')
    ? performance.now() : 0

  const { toolId, pan, zoom, svgRect, settings, modifiers, registry } = ctx
  const targets   = registry ?? SNAP_TARGETS
  const policyRaw = TOOL_SNAP_POLICY[toolId] ?? null

  // Always compute the raw world coord first — it is the free-fall result.
  const worldRaw = screenToWorldRaw(screenXY.clientX, screenXY.clientY, svgRect, pan, zoom)

  // Bypass conditions: explicit modifier, snap-disabled globally, or no
  // policy registered for this tool.
  const snapDisabled = settings?.enabled === false
  const bypass       = !!modifiers?.bypass
  if (bypass || snapDisabled || !policyRaw || policyRaw.length === 0) {
    return _buildResult({
      worldXY:    worldRaw,
      targetKind: null,
      sourceId:   null,
      raw:        true,
      _debugMeta: DEV_ENABLED ? {
        chosen:     null,
        candidates: [],
        rejected:   [],
        policy:     policyRaw ? [...policyRaw] : [],
        timingMs:   _elapsed(start),
        reason:     bypass ? 'bypass' : (snapDisabled ? 'disabled' : 'no-policy'),
      } : null,
    })
  }

  // Walk every policy entry, gather candidates from each target.
  const candidates = []
  const rejected   = []
  const policy     = []

  for (let i = 0; i < policyRaw.length; i++) {
    const norm   = normalizePolicyEntry(policyRaw[i])
    const target = targets[norm.id]
    if (!target) continue
    policy.push(norm.id)

    // Merge per-tool tolerance override over the project-side setting.
    const projSetting   = settings?.targets?.[norm.id]
    const effectiveTol  = norm.toleranceOverrideIn != null
      ? norm.toleranceOverrideIn
      : (projSetting?.toleranceIn ?? target.defaultSettings.toleranceIn)
    const effectiveSettings = {
      ...target.defaultSettings,
      ...(projSetting ?? {}),
      toleranceIn: effectiveTol,
    }

    let result = null
    try {
      result = target.query(state, worldRaw, effectiveSettings, {
        ...ctx,
        toleranceIn: effectiveTol,
        pitchIn:     settings?.pitchIn,
      })
    } catch (err) {
      rejected.push({ id: norm.id, error: String(err?.message ?? err) })
      continue
    }

    if (!result) {
      rejected.push({ id: norm.id, reason: 'null' })
      continue
    }
    // Sanity-check the result shape.
    if (!result.point || typeof result.distanceIn !== 'number') {
      rejected.push({ id: norm.id, reason: 'bad-shape' })
      continue
    }
    candidates.push({
      ...result,
      _targetKind:  norm.id,
      _tier:        typeof target.tier === 'number' ? target.tier : 0,
      _policyIndex: i,
      _sortKey:     result._sortKey ?? `${norm.id}:${result.sourceId ?? ''}`,
    })
  }

  if (candidates.length === 0) {
    return _buildResult({
      worldXY:    worldRaw,
      targetKind: null,
      sourceId:   null,
      raw:        true,
      _debugMeta: DEV_ENABLED ? {
        chosen:     null,
        candidates: [],
        rejected,
        policy,
        timingMs:   _elapsed(start),
        reason:     'no-match',
      } : null,
    })
  }

  // Deterministic winner pick.
  candidates.sort(_compareCandidates)
  const winner = candidates[0]

  return _buildResult({
    worldXY:    { x: winner.point.x, y: winner.point.y },
    targetKind: winner._targetKind,
    sourceId:   winner.sourceId ?? null,
    raw:        false,
    _debugMeta: DEV_ENABLED ? {
      chosen:     {
        targetKind: winner._targetKind,
        sourceId:   winner.sourceId ?? null,
        distanceIn: winner.distanceIn,
        point:      { x: winner.point.x, y: winner.point.y },
        sortKey:    winner._sortKey,
      },
      candidates: candidates.map(c => ({
        targetKind: c._targetKind,
        sourceId:   c.sourceId ?? null,
        distanceIn: c.distanceIn,
        point:      { x: c.point.x, y: c.point.y },
        sortKey:    c._sortKey,
      })),
      rejected,
      policy,
      timingMs:   _elapsed(start),
    } : null,
  })
}

function _buildResult({ worldXY, targetKind, sourceId, raw, _debugMeta }) {
  const out = { worldXY, targetKind, sourceId, raw }
  if (DEV_ENABLED && _debugMeta) out._debug = _debugMeta
  return out
}

function _elapsed(start) {
  if (!DEV_ENABLED || typeof performance === 'undefined') return 0
  return performance.now() - start
}

// Convenience: returns just the world point (no metadata). Used by Canvas
// for the cursor-display path when it doesn't need the snap-target info.
export function resolveSnapPoint(state, screenXY, ctx) {
  return resolveSnap(state, screenXY, ctx).worldXY
}

// Look up the target descriptor for a snap result. Pure passthrough —
// used by Canvas to fetch displayLabel / renderOverlay without coupling
// to the registry import.
export function getTargetDescriptor(targetKind, registry = SNAP_TARGETS) {
  if (!targetKind) return null
  return registry[targetKind] ?? null
}
