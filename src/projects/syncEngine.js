// syncEngine.js — the ONE wiring point for live geometry sync.
//
// Subscribes to the store once and, on every committed change, diffs the tracked
// geometry collections against a shadow snapshot and enqueues the resulting ops
// (creates/updates/deletes) in dependency order. No per-action edits anywhere —
// a future entity type only needs an emitter + one line in COLLECTIONS.
//
// Coalescing: changes are flushed on a microtask, and deferred while a
// `_runAtomically` batch is open (store._inBatch), so a multi-set room draw
// produces ONE ordered flush (nodes → room → walls → surfaces → openings).
//
// Off the render path, fail-soft: building ops never throws into the store; the
// queue owns all network/retry. Active only between start…stop (ERP mode).

import * as E from './syncEmitters.js'
import { ELEMENT_ENTRIES, ELEMENT_COLLECTIONS } from './elementRegistry.js'
import { enqueueGeometryOps } from './liveSyncQueue.js'

const COLLECTIONS = ['nodes', 'walls', 'rooms', ...ELEMENT_COLLECTIONS]

let _store = null
let _active = false
let _unsub = null
let _scheduled = false
let _shadow = {}
let _floorShadow = {}
let _coordinated = false

function _snapshot(st) {
  const snap = {}
  for (const c of COLLECTIONS) snap[c] = st[c] ?? {}
  return snap
}

// Floors are NOT a top-level store collection — they live in
// projectSettings.floors[]. Snapshot them as an { id → floor } map so the diff
// can detect new/changed floors the same way COLLECTIONS are diffed.
function _floorMap(st) {
  const m = {}
  for (const f of (st.projectSettings?.floors ?? [])) if (f && f.id) m[f.id] = f
  return m
}

export function startSyncEngine(store, opts = {}) {
  if (_active) return
  _store = store
  _active = true
  _coordinated = !!opts.coordinated
  _shadow = _snapshot(store.getState()) // seed: existing geometry is NOT re-emitted
  _floorShadow = _floorMap(store.getState()) // seed: existing/reopened floors are NOT re-emitted
  // In COORDINATED mode the sync coordinator is the SOLE driver: it calls
  // flushSyncEngine() only AFTER the canonical pipeline has durably accepted the
  // mutation (Invariant #5), so the engine must NOT self-subscribe.
  if (!_coordinated) _unsub = store.subscribe(() => _schedule())
}

export function stopSyncEngine() {
  if (_unsub) { _unsub(); _unsub = null }
  _active = false; _store = null; _shadow = {}; _floorShadow = {}; _scheduled = false; _coordinated = false
}

/** Re-baseline the shadow to current state WITHOUT emitting (used after a
 *  semantic op the diff shouldn't re-derive). */
export function reconcileSyncEngine() {
  if (_active && _store) {
    _shadow = _snapshot(_store.getState())
    _floorShadow = _floorMap(_store.getState())
  }
}

/**
 * Coordinated mode — the sync coordinator calls this AFTER the canonical pipeline
 * has durably accepted the mutation (Invariant #5). `stateOverride` pins the diff
 * to the exact accepted state, so a mutation landing mid-accept cannot leak into
 * this projection emit.
 */
export function flushSyncEngine(stateOverride) { _flush(stateOverride) }

function _schedule() {
  if (!_active || _scheduled) return
  _scheduled = true
  queueMicrotask(_flush)
}

function _flush(stateOverride) {
  _scheduled = false
  if (!_active || !_store) return
  const st = stateOverride ?? _store.getState()
  if (st._inBatch) { if (!_coordinated) _schedule(); return } // wait until the atomic batch closes

  const cur = _snapshot(st)
  const prev = _shadow
  const owner = E._wallOwnerRoom(st)

  const floorAddOps = [], floorUpdateOps = [], floorDeleteOps = []
  const nodeOps = [], roomOps = [], verticesOps = [], wallOps = [], surfaceOps = [], openingOps = []
  const elemOps = [], updateOps = [], deleteOps = []

  // ADDS/UPDATES — floors (special-cased: projectSettings.floors[], not a store
  // collection). A new floor must reach the ERP BEFORE any room placed on it, so
  // floor ADDs are ordered first in the emitted ops array (below).
  const curFloors = _floorMap(st)
  const prevFloors = _floorShadow
  for (const id in curFloors) {
    const p = prevFloors[id]
    if (!p) floorAddOps.push(E.floorAddOp(curFloors[id]))
    else if (E.floorSignature(curFloors[id]) !== E.floorSignature(p)) floorUpdateOps.push(E.floorUpdateOp(curFloors[id]))
  }
  // DELETE — floors removed this flush. Emitted LAST (see ops array below) so the
  // floor row is dropped only AFTER its child rooms/walls/openings DELETE — the
  // canonical removeFloor cascades the floor's rooms, so those child DELETE_ROOMs
  // are already in deleteOps and land first (FK: room.floorId → floor).
  for (const id in prevFloors) if (!curFloors[id]) floorDeleteOps.push(E.floorDeleteOp(prevFloors[id]))
  _floorShadow = curFloors
  const emittedNodes = new Set()
  const verticesRoomIds = new Set() // rooms already queued for a vertex emit (dedup)
  const movedNodes = new Set()      // nodes that moved this flush → re-emit owning rooms' vertices
  const ensureNode = (nid) => {
    if (!nid || (prev.nodes && prev.nodes[nid]) || emittedNodes.has(nid)) return
    const n = st.nodes?.[nid]
    if (n) { emittedNodes.add(nid); nodeOps.push(E.nodeAddOp(n)) }
  }

  // ADDS — rooms (+ adjacent surfaces for shared walls owned by another room)
  for (const id in cur.rooms) {
    if (prev.rooms?.[id]) continue
    const room = cur.rooms[id]
    roomOps.push(E.roomAddOp(room))
    const v = E.roomVerticesOp(st, room)
    if (v) { verticesOps.push(v); verticesRoomIds.add(id) }
    for (const wid of (room.wallIds ?? [])) {
      const o = owner.get(wid)
      if (o && o.id !== id && st.walls?.[wid]) surfaceOps.push(E.adjacentSurfaceOp(st.walls[wid], room))
    }
  }
  // ADDS — walls (under their owner room; new nodes first)
  for (const id in cur.walls) {
    if (prev.walls?.[id]) continue
    const wall = cur.walls[id]
    const o = owner.get(id)
    if (!o) continue // standalone wall has no ERP home
    ensureNode(wall.n1); ensureNode(wall.n2)
    wallOps.push(E.wallAddOp(st, wall, o.ifcGlobalId))
    for (const op of (wall.openings ?? [])) openingOps.push(E.openingAddOp(wall, op))
  }
  // ADDS — every element kind, registry-driven (no per-kind branches)
  for (const entry of ELEMENT_ENTRIES) {
    const coll = entry.collection
    for (const id in (cur[coll] ?? {})) if (!prev[coll]?.[id]) elemOps.push(E.elementAddOp(st, entry, cur[coll][id]))
  }

  // UPDATES — nodes (and remember which moved so owning rooms re-emit vertices)
  for (const id in cur.nodes) {
    const p = prev.nodes?.[id]
    if (p && E.signature('nodes', cur.nodes[id]) !== E.signature('nodes', p)) {
      updateOps.push(E.nodeUpdateOp(cur.nodes[id]))
      movedNodes.add(id)
    }
  }
  // Re-emit room vertices for any already-synced room whose polygon nodes moved,
  // so a resize/drag keeps the ERP RoomVertex snapshot in sync (same path as create).
  if (movedNodes.size) {
    for (const id in cur.rooms) {
      if (!prev.rooms?.[id] || verticesRoomIds.has(id)) continue
      const room = cur.rooms[id]
      if ((room.nodeOrder ?? []).some((nid) => movedNodes.has(nid))) {
        const v = E.roomVerticesOp(st, room)
        if (v) { updateOps.push(v); verticesRoomIds.add(id) }
      }
    }
  }
  // UPDATES — walls (geometry) + opening delta
  for (const id in cur.walls) {
    const p = prev.walls?.[id]
    if (!p) continue
    const w = cur.walls[id]
    if (`${w.n1},${w.n2},${w.height},${w.thickness},${w.materialKey}` !== `${p.n1},${p.n2},${p.height},${p.thickness},${p.materialKey}`) {
      updateOps.push(E.wallUpdateOp(st, w))
    }
    const oldSet = new Set((p.openings ?? []).map((o) => o.ifcGlobalId))
    const newSet = new Set((w.openings ?? []).map((o) => o.ifcGlobalId))
    for (const o of (w.openings ?? [])) if (!oldSet.has(o.ifcGlobalId)) openingOps.push(E.openingAddOp(w, o))
    for (const o of (p.openings ?? [])) if (!newSet.has(o.ifcGlobalId)) deleteOps.push(E.openingDeleteOp(o.ifcGlobalId))
  }
  // UPDATES — every element kind, registry-driven
  for (const entry of ELEMENT_ENTRIES) {
    const coll = entry.collection
    for (const id in (cur[coll] ?? {})) {
      const p = prev[coll]?.[id]
      if (p && E.signature(coll, cur[coll][id]) !== E.signature(coll, p)) updateOps.push(E.elementUpdateOp(st, entry, cur[coll][id]))
    }
  }

  // DELETES — child-first
  if (prev.walls) for (const id in prev.walls) if (!cur.walls[id]) deleteOps.push(E.wallDeleteOp(prev.walls[id].ifcGlobalId))
  if (prev.rooms) for (const id in prev.rooms) if (!cur.rooms[id]) deleteOps.push(E.roomDeleteOp(prev.rooms[id].ifcGlobalId))
  if (prev.nodes) for (const id in prev.nodes) if (!cur.nodes[id]) deleteOps.push(E.nodeDeleteOp(prev.nodes[id].ifcGlobalId))
  for (const coll of ELEMENT_COLLECTIONS) if (prev[coll]) for (const id in prev[coll]) if (!cur[coll]?.[id]) deleteOps.push(E.elementDeleteOp(prev[coll][id].ifcGlobalId))

  _shadow = cur

  const ops = [...floorAddOps, ...nodeOps, ...roomOps, ...verticesOps, ...wallOps, ...surfaceOps, ...openingOps, ...elemOps, ...floorUpdateOps, ...updateOps, ...deleteOps, ...floorDeleteOps]
  if (ops.length) enqueueGeometryOps(ops)
}
