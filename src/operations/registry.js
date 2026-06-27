// Operation registry — every operation type the dispatcher accepts.
//
// 2026-05-26 (Arch 2 Phase 2). Each registry entry declares:
//   - version:        bumps when the apply semantics change
//   - kind:           OP_KIND.USER / SYSTEM / TRANSIENT (default USER)
//   - apply:          pure (state, payload) → { nextState, inverse }
//                     where nextState is a NEW state object and inverse
//                     is a payload that — passed to a different op type —
//                     undoes the apply.
//   - payloadSchema:  optional entity schema name for validation
//
// MANDATORY (C2 — purity): apply() MUST NOT generate any IDs. Caller
// pre-generates via uid() / uidIfc() / newEntityIds() and threads them
// through the payload. Enforced by scripts/verify-op-purity.mjs.
//
// Phase 2 Step 4 ships a representative SUBSET of ops covering the
// most common entity creation / mutation paths. The remaining setters
// keep using legacy _save() and migrate incrementally as features need
// the journal / audit / collab capabilities the operation system unlocks.

import { OP_KIND } from './types.js'

// Helper used inside apply functions — never call crypto.randomUUID()
// here. Pure setter on the target slice.

function _elementSlice(kind) {
  const map = {
    FOUNDATION: 'foundations', STAIRCASE: 'staircases', RISER: 'risers',
    PLUMBING: 'plumbingFixtures', ELECTRICAL: 'electricalPoints',
    HVAC: 'hvacUnits', FIRE: 'fireDevices', ELV: 'elvDevices',
    SOLAR: 'solarEquipment',
  }
  return map[kind] ?? 'elements'
}

function _replaceCollection(state, slice, id, entity) {
  return { ...state, [slice]: { ...(state[slice] ?? {}), [id]: entity } }
}

function _removeFromCollection(state, slice, id) {
  const next = { ...(state[slice] ?? {}) }
  delete next[id]
  return { ...state, [slice]: next }
}

// Default wall shape — applied to ADD_WALL payload. Mirrors the existing
// addWall() defaults in store.js so journal-driven creations match
// imperative-driven ones byte-for-byte.
function _defaultWallShape() {
  return {
    height:       120,
    thickness:    9,
    materialKey:  'IS_MODULAR_BRICK',
    openings:     [],
    isPlot:       false,
    isVirtual:    false,
    floorId:      'F1',
    classification: null,
    hasPlinthBeam: null,
    hasLintelBeam: null,
    hasRoofBeam:   null,
    hasBalconyRailingEdge: null,
    meta:         null,
  }
}

export const OPERATIONS = Object.freeze({

  // ── Wall lifecycle ────────────────────────────────────────────────────────

  ADD_WALL: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      // C2: payload pre-generated { id, ifcGlobalId, n1, n2 }
      const wall = { ...(_defaultWallShape()), ...payload }
      const nextState = _replaceCollection(state, 'walls', payload.id, wall)
      const inverse = { type: 'DELETE_WALL', payload: { id: payload.id, capturedWall: wall } }
      return { nextState, inverse }
    },
  }),

  DELETE_WALL: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      const existing = state.walls?.[payload.id] ?? payload.capturedWall ?? null
      const nextState = _removeFromCollection(state, 'walls', payload.id)
      const inverse = existing
        ? { type: 'ADD_WALL', payload: { ...existing } }
        : null
      return { nextState, inverse }
    },
  }),

  SET_WALL_MATERIAL: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      const wall = state.walls?.[payload.id]
      if (!wall) return { nextState: state, inverse: null }
      const prevMaterial = wall.materialKey
      const nextWall = { ...wall, materialKey: payload.materialKey }
      const nextState = _replaceCollection(state, 'walls', payload.id, nextWall)
      const inverse = { type: 'SET_WALL_MATERIAL', payload: { id: payload.id, materialKey: prevMaterial } }
      return { nextState, inverse }
    },
  }),

  SET_WALL_HEIGHT: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      const wall = state.walls?.[payload.id]
      if (!wall) return { nextState: state, inverse: null }
      const prevHeight = wall.height
      const nextWall = { ...wall, height: payload.height }
      const nextState = _replaceCollection(state, 'walls', payload.id, nextWall)
      const inverse = { type: 'SET_WALL_HEIGHT', payload: { id: payload.id, height: prevHeight } }
      return { nextState, inverse }
    },
  }),

  // ── Opening lifecycle ────────────────────────────────────────────────────
  // Openings live inside wall.openings[]. The full wall list mutates.

  ADD_OPENING: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      // C2: payload pre-generated { wallId, openingId, ifcGlobalId, offset, width, height, type, ... }
      const wall = state.walls?.[payload.wallId]
      if (!wall) return { nextState: state, inverse: null }
      const opening = {
        id:            payload.openingId,
        ifcGlobalId:   payload.ifcGlobalId,
        offset:        payload.offset,
        width:         payload.width,
        height:        payload.height,
        type:          payload.type,
        orient:        payload.orient ?? 0,
        hasSunshade:   payload.hasSunshade ?? false,
        hasGrill:      payload.hasGrill ?? null,
        subtype:       payload.subtype,
        subtypeSource: payload.subtypeSource ?? 'EXPLICIT',
      }
      const nextWall = { ...wall, openings: [...(wall.openings ?? []), opening] }
      const nextState = _replaceCollection(state, 'walls', payload.wallId, nextWall)
      const inverse = { type: 'DELETE_OPENING', payload: { wallId: payload.wallId, openingId: payload.openingId } }
      return { nextState, inverse }
    },
  }),

  DELETE_OPENING: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      const wall = state.walls?.[payload.wallId]
      if (!wall) return { nextState: state, inverse: null }
      const captured = (wall.openings ?? []).find(o => o.id === payload.openingId) ?? null
      const nextOpenings = (wall.openings ?? []).filter(o => o.id !== payload.openingId)
      const nextWall = { ...wall, openings: nextOpenings }
      const nextState = _replaceCollection(state, 'walls', payload.wallId, nextWall)
      const inverse = captured
        ? {
            type: 'ADD_OPENING',
            payload: {
              wallId:        payload.wallId,
              openingId:     captured.id,
              ifcGlobalId:   captured.ifcGlobalId,
              offset:        captured.offset,
              width:         captured.width,
              height:        captured.height,
              type:          captured.type,
              orient:        captured.orient,
              hasSunshade:   captured.hasSunshade,
              hasGrill:      captured.hasGrill,
              subtype:       captured.subtype,
              subtypeSource: captured.subtypeSource,
            },
          }
        : null
      return { nextState, inverse }
    },
  }),

  // ── Column lifecycle ────────────────────────────────────────────────────

  ADD_COLUMN: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      // C2: payload pre-generated { id, ifcGlobalId, x, y, columnTypeId, attachedNodeId? }
      const column = {
        id:                  payload.id,
        ifcGlobalId:         payload.ifcGlobalId,
        x:                   payload.x,
        y:                   payload.y,
        columnTypeId:        payload.columnTypeId,
        attachedNodeId:      payload.attachedNodeId ?? null,
        baseFloorId:         payload.baseFloorId ?? 'F1',
        topFloorId:          payload.topFloorId  ?? 'F1',
        classification:      null,
        reinforcementSpecId: null,
        meta:                null,
      }
      const nextState = _replaceCollection(state, 'columns', payload.id, column)
      const inverse = { type: 'DELETE_COLUMN', payload: { id: payload.id, capturedColumn: column } }
      return { nextState, inverse }
    },
  }),

  DELETE_COLUMN: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      const existing = state.columns?.[payload.id] ?? payload.capturedColumn ?? null
      const nextState = _removeFromCollection(state, 'columns', payload.id)
      const inverse = existing
        ? { type: 'ADD_COLUMN', payload: { ...existing } }
        : null
      return { nextState, inverse }
    },
  }),

  // ── Transient ops (C1) ──────────────────────────────────────────────────
  // No journal, no undo, no autosave. Pure view-state mutation.

  SET_SELECTED_WALL_ID: Object.freeze({
    version: 1,
    kind:    OP_KIND.TRANSIENT,
    apply(state, payload) {
      return { nextState: { ...state, selectedWallId: payload.id ?? null }, inverse: null }
    },
  }),

  SET_HOVERED_ENTITY: Object.freeze({
    version: 1,
    kind:    OP_KIND.TRANSIENT,
    apply(state, payload) {
      return { nextState: { ...state, hoveredEntity: payload.entity ?? null }, inverse: null }
    },
  }),

  SET_LAYER_VISIBILITY: Object.freeze({
    version: 1,
    kind:    OP_KIND.TRANSIENT,
    apply(state, payload) {
      const next = { ...(state.layerVisibility ?? {}), ...payload.patch }
      return { nextState: { ...state, layerVisibility: next }, inverse: null }
    },
  }),

  SET_CURRENT_FLOOR_ID: Object.freeze({
    version: 1,
    kind:    OP_KIND.TRANSIENT,
    apply(state, payload) {
      return { nextState: { ...state, currentFloorId: payload.floorId }, inverse: null }
    },
  }),

  // ── System ops (C1) ──────────────────────────────────────────────────────
  // Persisted in journal as audit trail. NOT in undo stack.

  BACKFILL_IFC_GLOBAL_ID: Object.freeze({
    version: 1,
    kind:    OP_KIND.SYSTEM,
    apply(state, payload) {
      // payload: { slice, id, ifcGlobalId }  — pre-generated ifcGlobalId
      const collection = state[payload.slice] ?? {}
      const entity = collection[payload.id]
      if (!entity) return { nextState: state, inverse: null }
      const next = { ...entity, ifcGlobalId: payload.ifcGlobalId }
      const nextState = _replaceCollection(state, payload.slice, payload.id, next)
      return { nextState, inverse: null }   // irreversible by design
    },
  }),

  MIGRATE_SCHEMA_VERSION: Object.freeze({
    version: 1,
    kind:    OP_KIND.SYSTEM,
    apply(state, payload) {
      // payload: { from, to, label }  — informational; migrations module
      // performs the actual transforms before dispatch.
      return { nextState: state, inverse: null }
    },
  }),

  REPAIR_BROKEN_REFERENCE: Object.freeze({
    version: 1,
    kind:    OP_KIND.SYSTEM,
    apply(state, payload) {
      // payload: { entityType, entityId, action }
      // No state change at apply time — repair logic runs upstream;
      // this op records the audit trail entry.
      return { nextState: state, inverse: null }
    },
  }),

  // ── Phase E additions ────────────────────────────────────────────────────

  UPDATE_WALL: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      const id = payload.ifcGlobalId ?? payload.id
      const wall = state.walls[id]
      if (!wall) return { nextState: state, inverse: null }
      const patch = {}
      if (payload.materialKey !== undefined) patch.materialKey = payload.materialKey
      if (payload.height !== undefined) patch.height = payload.height
      if (payload.thickness !== undefined) patch.thickness = payload.thickness
      if (payload.angleDeg !== undefined) patch.angleDeg = payload.angleDeg
      if (payload.orientation !== undefined) patch.orientation = payload.orientation
      const updated = { ...wall, ...patch }
      const nextState = _replaceCollection(state, 'walls', id, updated)
      return { nextState, inverse: { type: 'UPDATE_WALL', payload: { ...wall, ifcGlobalId: id } } }
    },
  }),

  ADD_ROOM: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      const id = payload.ifcGlobalId
      if (!id) return { nextState: state, inverse: null }
      const room = { id, ...payload }
      const nextState = _replaceCollection(state, 'rooms', id, room)
      return { nextState, inverse: { type: 'DELETE_ROOM', payload: { ifcGlobalId: id } } }
    },
  }),

  UPDATE_ROOM: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      const id = payload.ifcGlobalId
      const room = state.rooms?.[id]
      if (!room) return { nextState: state, inverse: null }
      const updated = { ...room, ...payload }
      const nextState = _replaceCollection(state, 'rooms', id, updated)
      return { nextState, inverse: { type: 'UPDATE_ROOM', payload: { ...room, ifcGlobalId: id } } }
    },
  }),

  DELETE_ROOM: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      const id = payload.ifcGlobalId
      const room = state.rooms?.[id]
      if (!room) return { nextState: state, inverse: null }
      const nextState = _removeFromCollection(state, 'rooms', id)
      return { nextState, inverse: { type: 'ADD_ROOM', payload: { ...room, ifcGlobalId: id } } }
    },
  }),

  SAVE_ROOM_VERTICES: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      return { nextState: state, inverse: null }
    },
  }),

  UPDATE_OPENING: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      const id = payload.ifcGlobalId
      // openings may be nested in walls; state-neutral for registry
      return { nextState: state, inverse: null }
    },
  }),

  ADD_NODE: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      const id = payload.ifcGlobalId
      if (!id) return { nextState: state, inverse: null }
      const node = { id, ...payload }
      const nextState = _replaceCollection(state, 'nodes', id, node)
      return { nextState, inverse: { type: 'DELETE_NODE', payload: { ifcGlobalId: id } } }
    },
  }),

  UPDATE_NODE: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      const id = payload.ifcGlobalId
      const node = state.nodes?.[id]
      if (!node) return { nextState: state, inverse: null }
      const updated = { ...node, ...payload }
      const nextState = _replaceCollection(state, 'nodes', id, updated)
      return { nextState, inverse: { type: 'UPDATE_NODE', payload: { ...node, ifcGlobalId: id } } }
    },
  }),

  DELETE_NODE: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      const id = payload.ifcGlobalId
      const node = state.nodes?.[id]
      if (!node) return { nextState: state, inverse: null }
      const nextState = _removeFromCollection(state, 'nodes', id)
      return { nextState, inverse: { type: 'ADD_NODE', payload: { ...node, ifcGlobalId: id } } }
    },
  }),

  UPDATE_COLUMN: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      const id = payload.ifcGlobalId
      const col = state.columns?.[id]
      if (!col) return { nextState: state, inverse: null }
      const updated = { ...col, ...payload }
      const nextState = _replaceCollection(state, 'columns', id, updated)
      return { nextState, inverse: { type: 'UPDATE_COLUMN', payload: { ...col, ifcGlobalId: id } } }
    },
  }),

  ADD_BEAM: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      const id = payload.ifcGlobalId
      if (!id) return { nextState: state, inverse: null }
      const beam = { id, ...payload }
      const nextState = _replaceCollection(state, 'beams', id, beam)
      return { nextState, inverse: { type: 'DELETE_BEAM', payload: { ifcGlobalId: id } } }
    },
  }),

  UPDATE_BEAM: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      const id = payload.ifcGlobalId
      const beam = state.beams?.[id]
      if (!beam) return { nextState: state, inverse: null }
      const updated = { ...beam, ...payload }
      const nextState = _replaceCollection(state, 'beams', id, updated)
      return { nextState, inverse: { type: 'UPDATE_BEAM', payload: { ...beam, ifcGlobalId: id } } }
    },
  }),

  DELETE_BEAM: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      const id = payload.ifcGlobalId
      const beam = state.beams?.[id]
      if (!beam) return { nextState: state, inverse: null }
      const nextState = _removeFromCollection(state, 'beams', id)
      return { nextState, inverse: { type: 'ADD_BEAM', payload: { ...beam, ifcGlobalId: id } } }
    },
  }),

  ADD_SLAB: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      const id = payload.ifcGlobalId
      if (!id) return { nextState: state, inverse: null }
      const slab = { id, ...payload }
      const nextState = _replaceCollection(state, 'slabs', id, slab)
      return { nextState, inverse: { type: 'DELETE_SLAB', payload: { ifcGlobalId: id } } }
    },
  }),

  UPDATE_SLAB: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      const id = payload.ifcGlobalId
      const slab = state.slabs?.[id]
      if (!slab) return { nextState: state, inverse: null }
      const updated = { ...slab, ...payload }
      const nextState = _replaceCollection(state, 'slabs', id, updated)
      return { nextState, inverse: { type: 'UPDATE_SLAB', payload: { ...slab, ifcGlobalId: id } } }
    },
  }),

  DELETE_SLAB: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      const id = payload.ifcGlobalId
      const slab = state.slabs?.[id]
      if (!slab) return { nextState: state, inverse: null }
      const nextState = _removeFromCollection(state, 'slabs', id)
      return { nextState, inverse: { type: 'ADD_SLAB', payload: { ...slab, ifcGlobalId: id } } }
    },
  }),

  ADD_ELEMENT: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      const id = payload.ifcGlobalId
      if (!id) return { nextState: state, inverse: null }
      const slice = _elementSlice(payload.kind)
      const elem = { id, ...payload }
      const nextState = _replaceCollection(state, slice, id, elem)
      return { nextState, inverse: { type: 'DELETE_ELEMENT', payload: { ifcGlobalId: id, kind: payload.kind } } }
    },
  }),

  UPDATE_ELEMENT: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      const id = payload.ifcGlobalId
      const slice = _elementSlice(payload.kind)
      const elem = state[slice]?.[id]
      if (!elem) return { nextState: state, inverse: null }
      const updated = { ...elem, ...payload }
      const nextState = _replaceCollection(state, slice, id, updated)
      return { nextState, inverse: { type: 'UPDATE_ELEMENT', payload: { ...elem, ifcGlobalId: id } } }
    },
  }),

  DELETE_ELEMENT: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      const id = payload.ifcGlobalId
      const slice = _elementSlice(payload.kind)
      const elem = state[slice]?.[id]
      if (!elem) return { nextState: state, inverse: null }
      const nextState = _removeFromCollection(state, slice, id)
      return { nextState, inverse: { type: 'ADD_ELEMENT', payload: { ...elem, ifcGlobalId: id } } }
    },
  }),

  SPLIT_WALL: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      return { nextState: state, inverse: null }
    },
  }),

  JOIN_WALLS: Object.freeze({
    version: 1,
    kind:    OP_KIND.USER,
    apply(state, payload) {
      return { nextState: state, inverse: null }
    },
  }),
})

// Lookup convenience.
export function getOperation(type) {
  return OPERATIONS[type] ?? null
}

export function listOperationTypes() {
  return Object.keys(OPERATIONS)
}

// Every op-type → kind map for fast lookup during dispatch.
export const KIND_BY_TYPE = Object.freeze(
  Object.fromEntries(
    Object.entries(OPERATIONS).map(([type, def]) => [type, def.kind])
  )
)
