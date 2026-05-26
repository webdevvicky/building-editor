// LEGACY STATE ACCESSORS — DEPRECATED PATHS
//
// This file is the contract for Arch 1 state-separation migration.
//
// Plan: state has five logical namespaces:
//   state.model       — authoritative geometry + MEP + projectSettings
//   state.view        — selection / panels / currentFloorId / unit
//   state.history     — operation journal (Arch 2)
//   state.validation  — events + dismissals (Arch 4)
//   state.cache       — ComputationEngine cells (Arch 3)
//
// CURRENT SHAPE (Phase 2 Step 6 baseline): every field still lives at
// state.<field> (flat). The five namespaces are NOT YET implemented as
// nested slices — that physical move is a follow-on refactor that
// touches every component selector. This file documents the contract
// + enforces it via verify scripts so the refactor can happen
// incrementally without losing track of what should land where.
//
// REMOVE BY: 2026-08-15 (3 months after Phase 2 ships; tracks migration
// sweep progress).
//
// After the physical refactor lands, this file becomes pure
// compatibility shim — providing state.walls (legacy) as a getter
// that reads state.model.walls. When the kill-switch date passes with
// any LEGACY_ACCESSORS entry still defined, verify-legacy-shim.mjs
// fails CI.

// ── Accessor registry ──────────────────────────────────────────────────
//
// Each entry declares:
//   path:    legacy state path (string, dotted)
//   slice:   target namespace (model | view | history | validation | cache)
//   kind:    'collection' | 'scalar' | 'object'
//   notes:   one-line explanation
//   killBy:  ISO date — must be removed by this date
//
// Adding a new accessor here is FORBIDDEN once Phase 2 ships — new code
// uses state.<slice>.X directly. Existing accessors get removed as their
// callers migrate.

const KILL_BY = '2026-08-15'

export const LEGACY_ACCESSORS = Object.freeze([
  // ── Model slice (authoritative geometry + MEP + projectSettings) ──────
  Object.freeze({ path: 'nodes',            slice: 'model', kind: 'collection', killBy: KILL_BY, notes: 'Node entities — keyed by uuid' }),
  Object.freeze({ path: 'walls',            slice: 'model', kind: 'collection', killBy: KILL_BY, notes: 'Wall entities — wall.openings sub-shape lives here' }),
  Object.freeze({ path: 'rooms',            slice: 'model', kind: 'collection', killBy: KILL_BY, notes: 'Room entities' }),
  Object.freeze({ path: 'stamps',           slice: 'model', kind: 'collection', killBy: KILL_BY, notes: 'Civil + architectural stamps' }),
  Object.freeze({ path: 'columns',          slice: 'model', kind: 'collection', killBy: KILL_BY, notes: 'Column entities — see structuralSlice' }),
  Object.freeze({ path: 'beams',            slice: 'model', kind: 'collection', killBy: KILL_BY, notes: 'Beam entities (explicit) — wall-derived computed' }),
  Object.freeze({ path: 'slabs',            slice: 'model', kind: 'collection', killBy: KILL_BY, notes: 'Slab entities' }),
  Object.freeze({ path: 'staircases',       slice: 'model', kind: 'collection', killBy: KILL_BY, notes: 'Staircase entities (companion to stamps)' }),
  Object.freeze({ path: 'foundations',      slice: 'model', kind: 'collection', killBy: KILL_BY, notes: 'Foundation entities — Phase 1.8' }),
  Object.freeze({ path: 'plumbingFixtures', slice: 'model', kind: 'collection', killBy: KILL_BY, notes: 'MEP — plumbing fixtures' }),
  Object.freeze({ path: 'electricalPoints', slice: 'model', kind: 'collection', killBy: KILL_BY, notes: 'MEP — electrical points' }),
  Object.freeze({ path: 'hvacUnits',        slice: 'model', kind: 'collection', killBy: KILL_BY, notes: 'MEP — HVAC units' }),
  Object.freeze({ path: 'fireDevices',      slice: 'model', kind: 'collection', killBy: KILL_BY, notes: 'MEP — fire devices' }),
  Object.freeze({ path: 'elvDevices',       slice: 'model', kind: 'collection', killBy: KILL_BY, notes: 'MEP — ELV devices' }),
  Object.freeze({ path: 'solarEquipment',   slice: 'model', kind: 'collection', killBy: KILL_BY, notes: 'MEP — solar (deferred)' }),
  Object.freeze({ path: 'risers',           slice: 'model', kind: 'collection', killBy: KILL_BY, notes: 'Cross-discipline risers' }),
  Object.freeze({ path: 'projectSettings',  slice: 'model', kind: 'object',     killBy: KILL_BY, notes: 'Project-level configuration tree' }),

  // ── View slice (selection / panels / transient) ──────────────────────
  Object.freeze({ path: 'activeTool',       slice: 'view', kind: 'scalar', killBy: KILL_BY, notes: 'Selected tool — draw/select/room/etc.' }),
  Object.freeze({ path: 'drawVirtual',      slice: 'view', kind: 'scalar', killBy: KILL_BY, notes: 'Virtual-wall mode toggle' }),
  Object.freeze({ path: 'drawStartId',      slice: 'view', kind: 'scalar', killBy: KILL_BY, notes: 'Ghost-line start node id during draw' }),
  Object.freeze({ path: 'selectedWallId',   slice: 'view', kind: 'scalar', killBy: KILL_BY, notes: 'Currently selected wall (single)' }),
  Object.freeze({ path: 'selectedWallIds',  slice: 'view', kind: 'scalar', killBy: KILL_BY, notes: 'Multi-select wall ids' }),
  Object.freeze({ path: 'selectedStampId',  slice: 'view', kind: 'scalar', killBy: KILL_BY, notes: 'Selected stamp' }),
  Object.freeze({ path: 'selectedRoomId',   slice: 'view', kind: 'scalar', killBy: KILL_BY, notes: 'Selected room' }),
  Object.freeze({ path: 'selectedColumnId', slice: 'view', kind: 'scalar', killBy: KILL_BY, notes: 'Selected column' }),
  Object.freeze({ path: 'selectedBeamId',   slice: 'view', kind: 'scalar', killBy: KILL_BY, notes: 'Selected beam' }),
  Object.freeze({ path: 'selectedFoundationId', slice: 'view', kind: 'scalar', killBy: KILL_BY, notes: 'Selected foundation' }),
  Object.freeze({ path: 'selectedOpening',  slice: 'view', kind: 'object', killBy: KILL_BY, notes: '{ wallId, openingId } | null' }),
  // MEP selection state — one per discipline. Wired via mepSlice.
  Object.freeze({ path: 'selectedPlumbingFixtureId', slice: 'view', kind: 'scalar', killBy: KILL_BY, notes: 'Selected plumbing fixture' }),
  Object.freeze({ path: 'selectedElectricalPointId', slice: 'view', kind: 'scalar', killBy: KILL_BY, notes: 'Selected electrical point' }),
  Object.freeze({ path: 'selectedHvacUnitId',        slice: 'view', kind: 'scalar', killBy: KILL_BY, notes: 'Selected HVAC unit' }),
  Object.freeze({ path: 'selectedFireDeviceId',      slice: 'view', kind: 'scalar', killBy: KILL_BY, notes: 'Selected fire device' }),
  Object.freeze({ path: 'selectedElvDeviceId',       slice: 'view', kind: 'scalar', killBy: KILL_BY, notes: 'Selected ELV device' }),
  Object.freeze({ path: 'selectedSolarEquipmentId',  slice: 'view', kind: 'scalar', killBy: KILL_BY, notes: 'Selected solar equipment (deferred discipline)' }),
  Object.freeze({ path: 'selectedRiserId',           slice: 'view', kind: 'scalar', killBy: KILL_BY, notes: 'Selected cross-discipline riser' }),
  Object.freeze({ path: 'pendingWallIds',   slice: 'view', kind: 'scalar', killBy: KILL_BY, notes: 'Pending-room wall accumulator' }),
  Object.freeze({ path: 'draftOpening',     slice: 'view', kind: 'object', killBy: KILL_BY, notes: 'In-progress opening drag preview' }),
  Object.freeze({ path: 'unit',             slice: 'view', kind: 'scalar', killBy: KILL_BY, notes: 'ft / ft-in / m display preference' }),
  Object.freeze({ path: 'showDimensions',   slice: 'view', kind: 'scalar', killBy: KILL_BY, notes: 'Canvas dimension toggle' }),
  Object.freeze({ path: 'layerVisibility',  slice: 'view', kind: 'object', killBy: KILL_BY, notes: 'Per-layer visibility map' }),
  Object.freeze({ path: 'currentFloorId',   slice: 'view', kind: 'scalar', killBy: KILL_BY, notes: 'Active floor in floor switcher' }),
  Object.freeze({ path: 'ratesByKey',       slice: 'view', kind: 'object', killBy: KILL_BY, notes: 'BOQ rate inputs — excluded from history' }),

  // ── History slice (Arch 2 operation journal) ─────────────────────────
  Object.freeze({ path: 'history',          slice: 'history', kind: 'collection', killBy: KILL_BY, notes: 'Undo ring buffer (50 entries)' }),
  Object.freeze({ path: 'future',           slice: 'history', kind: 'collection', killBy: KILL_BY, notes: 'Redo ring buffer (50 entries)' }),

  // ── Validation slice (Arch 4) ────────────────────────────────────────
  Object.freeze({ path: 'validationEvents', slice: 'validation', kind: 'collection', killBy: KILL_BY, notes: 'Ring buffer of action-emitted validation issues' }),
])

// Boundary contract: which fields belong to which slice. Used by
// verify-state-boundaries.mjs to assert (a) every legacy path is
// classified, (b) view fields never appear in history snapshots,
// (c) history slice never appears inside model snapshots.
export const SLICE_BOUNDARIES = Object.freeze({
  model:      Object.freeze(LEGACY_ACCESSORS.filter(a => a.slice === 'model').map(a => a.path)),
  view:       Object.freeze(LEGACY_ACCESSORS.filter(a => a.slice === 'view').map(a => a.path)),
  history:    Object.freeze(LEGACY_ACCESSORS.filter(a => a.slice === 'history').map(a => a.path)),
  validation: Object.freeze(LEGACY_ACCESSORS.filter(a => a.slice === 'validation').map(a => a.path)),
  cache:      Object.freeze([]),    // No legacy paths — cache lands fresh in the new shape
})

// Kill-switch date — the single source. After this date,
// verify-legacy-shim.mjs fails CI if any accessor is still defined.
export const SHIM_KILL_BY = KILL_BY

// Helper: what slice does a flat-shape state field belong to?
export function getSliceForPath(path) {
  const entry = LEGACY_ACCESSORS.find(a => a.path === path)
  return entry?.slice ?? null
}

// Helper: every field name across every slice — used to detect
// accidentally-introduced unknown fields.
export function allKnownPaths() {
  return LEGACY_ACCESSORS.map(a => a.path)
}
