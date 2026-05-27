// Snap target registry — SNAP_TARGETS.
//
// SEMANTIC DISTINCTION (load-bearing — do NOT collapse):
//   NODE          — any reusable graph node (intersection point in the
//                   graph). Includes nodes that may not currently back a
//                   wall endpoint (orphans from split history, future
//                   import paths, etc.).
//   WALL_ENDPOINT — wall-owned endpoint semantics; today coincident with
//                   NODE in practice but distinct in intent. Future
//                   diverges may attach behavior to "endpoint" that does
//                   not apply to free nodes (e.g. trim hints, wall-side
//                   menus, IFC owner). Do NOT deduplicate — they may
//                   diverge in policy / label / future behavior.
//
// Each entry is a complete, self-contained descriptor. The resolver and
// Canvas dispatch by registry lookup, never by `switch(kind)`. Adding a
// new target = adding one entry; touching no other file.
//
// DESCRIPTOR SHAPE
//   {
//     id:              string,
//     label:           string,
//     tier:            number,   // 0 = primary (competes on distance);
//                                // 1+ = fallback (only fires if every
//                                // lower-tier target missed). GRID is tier 1.
//     defaultSettings: object,   // open-ended; merged into projectSettings.snap.targets[id]
//     prepare?:        (state, signal) => Promise<void> | void,
//     query:           (state, world, settings, ctx) =>
//                        { point, sourceId?, distanceIn } | null,
//     displayLabel:    (result, settings) => string,
//     renderOverlay?:  (result, helpers) => ReactNode | null,   // invoked by Canvas
//   }
//
// TIER SEMANTICS (load-bearing)
//   The resolver groups candidates by `tier` first. The winner is the
//   best (lowest distance) candidate in the LOWEST tier that has any
//   candidate. This expresses "real targets (NODE, WALL_ENDPOINT,
//   WALL_NEAREST) take priority over the grid catch-all" without
//   requiring callers to inspect distances manually. GRID's distance is
//   still populated (per the contract — see _debug.candidates), but
//   GRID only "wins" when every tier-0 target returned null or was
//   absent from the policy.
//
// PURITY
//   This module is pure & Node-testable: no React, no DOM, no Zustand
//   dispatches. `renderOverlay` returns a render-thunk shape that Canvas
//   interprets — it never executes here.

import { findNearestCandidate } from './candidates.js'

// Grid pitch math. Imported via numeric value (not function) so the
// registry stays pure; the resolver passes settings.pitchIn through.
function _snapToPitch(value, pitchIn) {
  return Math.round(value / pitchIn) * pitchIn
}

export const SNAP_TARGETS = Object.freeze({
  // ── Graph-entity targets ────────────────────────────────────────────────

  NODE: Object.freeze({
    id:              'NODE',
    label:           'Node',
    tier:            0,
    defaultSettings: Object.freeze({ enabled: true, toleranceIn: 4 }),
    query(state, world, settings /*, ctx */) {
      if (!settings?.enabled) return null
      const tol = settings.toleranceIn ?? 4
      const c = findNearestCandidate(state, 'node', world.x, world.y)
      if (!c || c.distanceIn > tol) return null
      return {
        point:      c.point,
        sourceId:   c.entity.id,
        distanceIn: c.distanceIn,
        _sortKey:   c.sortKey,
      }
    },
    displayLabel() { return 'Node' },
    // overlay rendered as a small primary-color ring on the node;
    // Canvas reads sourceId to find the node coords + draws via helpers.
    renderOverlay(result, helpers) {
      return {
        kind:   'ring',
        worldX: result.point.x,
        worldY: result.point.y,
        radiusPx: 8,
      }
    },
  }),

  WALL_ENDPOINT: Object.freeze({
    id:              'WALL_ENDPOINT',
    label:           'Endpoint',
    tier:            0,
    defaultSettings: Object.freeze({ enabled: true, toleranceIn: 4 }),
    query(state, world, settings) {
      if (!settings?.enabled) return null
      const tol = settings.toleranceIn ?? 4
      const c = findNearestCandidate(state, 'wallEndpoint', world.x, world.y)
      if (!c || c.distanceIn > tol) return null
      return {
        point:      c.point,
        sourceId:   c.entity.id,
        distanceIn: c.distanceIn,
        _sortKey:   c.sortKey,
      }
    },
    displayLabel() { return 'Endpoint' },
    renderOverlay(result) {
      return {
        kind:   'ring',
        worldX: result.point.x,
        worldY: result.point.y,
        radiusPx: 8,
      }
    },
  }),

  WALL_MIDPOINT: Object.freeze({
    id:              'WALL_MIDPOINT',
    label:           'Midpoint',
    tier:            0,
    // Off by default to preserve today's behavior (no midpoint snap).
    defaultSettings: Object.freeze({ enabled: false, toleranceIn: 6 }),
    query(state, world, settings) {
      if (!settings?.enabled) return null
      const tol = settings.toleranceIn ?? 6
      const c = findNearestCandidate(state, 'wallMidpoint', world.x, world.y)
      if (!c || c.distanceIn > tol) return null
      return {
        point:      c.point,
        sourceId:   c.entity.id,
        distanceIn: c.distanceIn,
        _sortKey:   c.sortKey,
      }
    },
    displayLabel() { return 'Midpoint' },
    renderOverlay(result) {
      return {
        kind:   'diamond',
        worldX: result.point.x,
        worldY: result.point.y,
        radiusPx: 7,
      }
    },
  }),

  // ── Wall-locked targets (MEP placement, split tool) ─────────────────────

  WALL_NEAREST: Object.freeze({
    id:              'WALL_NEAREST',
    label:           'Wall',
    tier:            0,
    defaultSettings: Object.freeze({ enabled: true, toleranceIn: 36 }),
    query(state, world, settings) {
      if (!settings?.enabled) return null
      const tol = settings.toleranceIn ?? 36
      const c = findNearestCandidate(state, 'wallSegment', world.x, world.y)
      if (!c || c.distanceIn > tol) return null
      return {
        point:      c.point,
        sourceId:   c.entity.id,
        distanceIn: c.distanceIn,
        _sortKey:   c.sortKey,
      }
    },
    displayLabel() { return 'Wall' },
    renderOverlay(result) {
      return {
        kind:   'ring',
        worldX: result.point.x,
        worldY: result.point.y,
        radiusPx: 6,
      }
    },
  }),

  // Split tool target. Same math as WALL_NEAREST but the resolver expects
  // the consumer to know it's split: a wall-segment-constrained click,
  // independent tolerance.
  WALL_SEGMENT: Object.freeze({
    id:              'WALL_SEGMENT',
    label:           'Segment',
    tier:            0,
    defaultSettings: Object.freeze({ enabled: true, toleranceIn: 12 }),
    query(state, world, settings) {
      if (!settings?.enabled) return null
      const tol = settings.toleranceIn ?? 12
      const c = findNearestCandidate(state, 'wallSegment', world.x, world.y)
      if (!c || c.distanceIn > tol) return null
      return {
        point:      c.point,
        sourceId:   c.entity.id,
        distanceIn: c.distanceIn,
        _sortKey:   c.sortKey,
      }
    },
    displayLabel() { return 'Segment' },
    renderOverlay(result) {
      return {
        kind:   'cross',
        worldX: result.point.x,
        worldY: result.point.y,
        radiusPx: 7,
      }
    },
  }),

  // ── Grid (catch-all) ────────────────────────────────────────────────────
  //
  // GRID fires under EVERY click (its tolerance is "infinity by
  // construction"). It populates the standard result shape with point +
  // distanceIn so _debug.candidates carries it uniformly. distanceIn is
  // the Euclidean distance from the raw click to the snapped cell — this
  // is what tie-breaking uses when two grid-snapped points coincide.

  GRID: Object.freeze({
    id:              'GRID',
    label:           'Grid',
    tier:            1,   // catch-all fallback; only wins when every tier-0 target missed
    defaultSettings: Object.freeze({ enabled: true }),
    query(state, world, settings, ctx) {
      if (!settings?.enabled) return null
      const pitchIn = ctx?.pitchIn ?? 12
      const sx = _snapToPitch(world.x, pitchIn)
      const sy = _snapToPitch(world.y, pitchIn)
      const dx = world.x - sx, dy = world.y - sy
      const d  = Math.sqrt(dx * dx + dy * dy)
      return {
        point:      { x: sx, y: sy },
        sourceId:   null,
        distanceIn: d,
        // Grid sortKey is deterministic from the snapped output.
        _sortKey:   `GRID:${sx},${sy}`,
      }
    },
    displayLabel(result, settings, ctx) {
      const pitch = ctx?.pitchIn ?? settings?.pitchIn ?? 12
      return `Grid ${pitch}"`
    },
    // Grid has no entity overlay — the snap-dot itself IS the indicator.
    renderOverlay: null,
  }),
})

export const SNAP_TARGET_IDS = Object.freeze(Object.keys(SNAP_TARGETS))

// Helper: default-fill projectSettings.snap.targets from each descriptor's
// defaultSettings. Used by store loadProject and verify-snap Section E.
export function buildDefaultTargetSettings() {
  const out = {}
  for (const id of SNAP_TARGET_IDS) {
    out[id] = { ...SNAP_TARGETS[id].defaultSettings }
  }
  return out
}
