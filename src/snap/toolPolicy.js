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
  // Wall drawing: prefer existing node / endpoint / T-junction;
  // fall through to grid. Policy order at distance ties:
  //   CORNER (NODE) > WALL_ENDPOINT > WALL_JUNCTION > WALL_MIDPOINT > GRID.
  draw:        Object.freeze(['NODE', 'WALL_ENDPOINT', 'WALL_JUNCTION', 'WALL_MIDPOINT', 'GRID']),

  // Rectangle room: corners snap to existing nodes / endpoints /
  // T-junctions or grid. T-junctions matter for stacked-room cases
  // where a corner of a new rect lands on an existing wall mid-span
  // and the user expects to re-use the prior junction.
  rect_room:   Object.freeze(['NODE', 'WALL_ENDPOINT', 'WALL_JUNCTION', 'GRID']),

  // Column placement: columns are structural grid-anchored entities — they
  // snap ONLY to the pitch grid, never to wall topology nodes / T-junctions.
  // (Attracting to wall centerline nodes within 24in pulled columns off-grid
  // and made clean rectangular column grids impossible near walls.)
  column:      Object.freeze(['GRID']),

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

  // Phase W — Manual Join tool. Clicks select a wall (identified by
  // WALL_NEAREST → sourceId = parent wallId). Section A fuzz exercises
  // this tool on a clean canvas; with no walls, WALL_NEAREST returns
  // null → resolver returns raw — matching screenToWorldRaw baseline.
  join_walls: Object.freeze(['WALL_NEAREST']),
})

_validatePolicy(TOOL_SNAP_POLICY)

// Beam-tool endpoint targeting (Phase BeamConnect). The beam tool resolves a
// click to a beam endpoint by PRIORITY + per-type radius: column > beam > wall
// > free point. This is NOT a TOOL_SNAP_POLICY entry — those ids feed the
// generic resolver against SNAP_TARGETS; beam targeting is consumed by
// src/snap/beamTarget.js::resolveBeamTarget. Walls get a slightly larger
// radius (they are long; the projected bearing point can sit far from the
// click along the span).
export const BEAM_TOOL_TARGETS = Object.freeze([
  // COLUMN raised 16→24 to match the column grid-snap granularity: a click
  // near a column always binds as a COLUMN ref (resolves to the column
  // center) instead of falling through to WALL-centerline projection or a
  // free POINT. COLUMN is checked first, so it still wins over WALL at ties.
  Object.freeze({ kind: 'COLUMN', toleranceIn: 24 }),
  Object.freeze({ kind: 'BEAM',   toleranceIn: 16 }),
  Object.freeze({ kind: 'WALL',   toleranceIn: 24 }),
])

// Returns the raw policy array (or null if the tool has no snap policy).
export function getToolPolicy(toolId) {
  return TOOL_SNAP_POLICY[toolId] ?? null
}
