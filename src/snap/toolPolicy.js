// Tool snap policy — per-tool ordered list of target descriptors.
//
// The resolver walks this list in order; the first target whose `query()`
// returns a non-null result within tolerance wins, subject to the
// deterministic tie-break (distanceIn → _sortKey → policy index).
//
// Each entry is either:
//   - a string id  → use target's defaultSettings.toleranceIn
//   - an object    → { id, toleranceIn? } — per-tool override of tolerance
//
// Per-tool tolerance overrides live in this code-side registry, NOT in
// projectSettings. Phase C's "per-tool tolerance overrides" deferral is
// about USER-FACING overrides; the registry-side knobs that encode tool
// intent (column attract vs node snap) belong here.
//
// Tools NOT listed here resolve to raw / free placement (no snap).
//
// PURITY
//   Pure & Node-testable: no React, no DOM, no Zustand.

import { SNAP_TARGETS } from './targets.js'

function _validatePolicy(policy) {
  for (const [toolId, entries] of Object.entries(policy)) {
    for (const entry of entries) {
      const id = typeof entry === 'string' ? entry : entry?.id
      if (!id || !SNAP_TARGETS[id]) {
        throw new Error(
          `[snap/toolPolicy] tool "${toolId}" references unknown target "${id}"`
        )
      }
    }
  }
}

// Normalize a policy entry to { id, toleranceOverrideIn? }. The resolver
// uses this shape internally.
export function normalizePolicyEntry(entry) {
  if (typeof entry === 'string') return { id: entry, toleranceOverrideIn: null }
  return {
    id: entry.id,
    toleranceOverrideIn: typeof entry.toleranceIn === 'number' ? entry.toleranceIn : null,
  }
}

export const TOOL_SNAP_POLICY = Object.freeze({
  // Wall drawing: prefer existing node / endpoint; fall through to grid.
  draw:        Object.freeze(['NODE', 'WALL_ENDPOINT', 'WALL_MIDPOINT', 'GRID']),

  // Rectangle room: corners snap to existing nodes/endpoints or grid.
  rect_room:   Object.freeze(['NODE', 'WALL_ENDPOINT', 'GRID']),

  // Column placement: today's code attracts to nearby nodes within a
  // 24in radius (Canvas.jsx legacy nearNode check). Preserved via a
  // per-tool tolerance override so the same usability behavior survives
  // without inline snap logic in Canvas.
  column:      Object.freeze([
    Object.freeze({ id: 'NODE', toleranceIn: 24 }),
    'GRID',
  ]),

  // Stamp placement (sump / OHT / septic / stairs / lift): grid only.
  sump:           Object.freeze(['GRID']),
  overhead_tank:  Object.freeze(['GRID']),
  septic_tank:    Object.freeze(['GRID']),
  stairs:         Object.freeze(['GRID']),
  lift:           Object.freeze(['GRID']),

  // MEP placement: snap to nearest wall within 36in, else fall through
  // to grid. Today's MEP placement at Canvas pre-snapped via screenToWorld
  // before walking walls; with no walls in range, the snapped coord stuck.
  // Adding GRID as the catch-all preserves byte-identical behavior on
  // empty / wall-free canvases.
  plumbing:    Object.freeze(['WALL_NEAREST', 'GRID']),
  electrical:  Object.freeze(['WALL_NEAREST', 'GRID']),
  hvac:        Object.freeze(['WALL_NEAREST', 'GRID']),
  fire:        Object.freeze(['WALL_NEAREST', 'GRID']),
  elv:         Object.freeze(['WALL_NEAREST', 'GRID']),

  // Split tool: constrained to wall segment within 12in.
  split:       Object.freeze(['WALL_SEGMENT']),

  // Phase R1 — room_detect tool: hover/click anywhere within 24in of a
  // wall to detect the face on that side. Reuses WALL_SEGMENT to identify
  // the nearest wall + the projection point onto it. The side-of-wall
  // disambiguation is handled by topology/faces.js using the RAW click
  // coords (not the projected point).
  room_detect: Object.freeze([
    Object.freeze({ id: 'WALL_SEGMENT', toleranceIn: 24 }),
  ]),

  // Tools that intentionally bypass snap.
  calibrate_underlay: Object.freeze([]),
})

_validatePolicy(TOOL_SNAP_POLICY)

// Returns the raw policy array (or null if the tool has no snap policy).
export function getToolPolicy(toolId) {
  return TOOL_SNAP_POLICY[toolId] ?? null
}
