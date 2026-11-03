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
export function reconcileSyncEngine(stateOverride) {
  if (_active && _store) {
    _shadow = _snapshot(stateOverride ?? _store.getState())
    _floorShadow = _floorMap(stateOverride ?? _store.getState())
  }
}

/**
 * Coordinated mode — the sync coordinator calls this AFTER the canonical pipeline
 * has durably accepted the mutation (Invariant #5). `stateOverride` pins the diff
 * to the exact accepted state, so a mutation landing mid-accept cannot leak into
 * this projection emit.
 */
export function flushSyncEngine(stateOverride, doc) { return _flush(stateOverride, doc) }

function _schedule() {
  if (!_active || _scheduled) return
  _scheduled = true
  queueMicrotask(_flush)
}

async function _flush(stateOverride, doc) {
  _scheduled = false
  if (!_active || !_store) return
  const st = stateOverride ?? _store.getState()
  if (st._inBatch) { if (!_coordinated) _schedule(); return } // wait until the atomic batch closes

  const cur = _snapshot(st)
  const prev = _shadow
  const owner = E._wallOwnerRoom(st)
  const prevOwner = E._wallOwnerRoom(prev)

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
  const emittedNodes = new Set()
  const verticesRoomIds = new Set() // rooms already queued for a vertex emit (dedup)
  const movedNodes = new Set()      // nodes that moved this flush → re-emit owning rooms' vertices
  const ensureNode = (nid) => {
    if (!nid || (prev.nodes && prev.nodes[nid]) || emittedNodes.has(nid)) return
    const n = st.nodes?.[nid]
    if (n) { emittedNodes.add(nid); nodeOps.push(E.nodeAddOp(n)) }
  }

  // Wall re-segmentation this flush: a split (one wall → a chain of new walls) and a
  // join (walls → one) are sent as the ERP's split / join, which carry each wall
  // face — and so its BOQ identity, finishes and progress — onto the wall it now
  // lies on, instead of a delete + add that would orphan them (XR-16, XR-08).
  const reseg = detectWallResegmentation(prev, cur)

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
  // ADDS — walls: under their owner room, or on their floor when no room owns them
  // (XR-11). New nodes first. A wall born of a split or join is written by that op.
  for (const split of reseg.splits) {
    for (const piece of split.pieces) { ensureNode(piece.n1); ensureNode(piece.n2) }
    wallOps.push(E.splitWallOp(st, split.source, split.pieces))
  }
  for (const join of reseg.joins) {
    ensureNode(join.merged.n1); ensureNode(join.merged.n2)
    wallOps.push(E.joinWallsOp(st, join.merged, join.sources))
  }
  for (const id in cur.walls) {
    const wall = cur.walls[id]
    if (prev.walls?.[id]) {
      // An already-synced wall whose owning room changed — a room was drawn on a
      // wall that bounded none, or its owner room went — is re-sent under its
      // owner: the idempotent ADD adds that room's faces (and the exterior face).
      const o = owner.get(id)
      if (o && o.id !== prevOwner.get(id)?.id && !reseg.written.has(id)) wallOps.push(E.wallAddOp(st, wall, o.ifcGlobalId))
      continue
    }
    for (const op of (wall.openings ?? [])) openingOps.push(E.openingAddOp(wall, op))
    if (reseg.written.has(id)) continue
    ensureNode(wall.n1); ensureNode(wall.n2)
    wallOps.push(E.wallAddOp(st, wall, owner.get(id)?.ifcGlobalId ?? null))
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
  // UPDATES — room properties (roomTypeCode). A room-type change on an ALREADY-synced
  // room re-emits ADD_ROOM: createRoom is idempotent by sourceEditorId and its replay
  // branch updates roomTypeId when the payload carries roomTypeCode — the SAME path
  // "Resync all" uses. roomTypeCode rides ONLY on ADD_ROOM (PATCH /rooms is SHAPE-only
  // by design). Guard on a roomTypeCode delta: name is ERP-owned + ignored on replay,
  // and geometry re-emits via the moved-node vertices path above.
  for (const id in cur.rooms) {
    const p = prev.rooms?.[id]
    if (!p) continue
    if ((cur.rooms[id].roomTypeCode ?? null) !== (p.roomTypeCode ?? null)) {
      updateOps.push(E.roomAddOp(cur.rooms[id]))
    }
  }
  // UPDATES — walls (shape) + each opening (XR-17). A join survivor's shape is
  // written by its JOIN op.
  for (const id in cur.walls) {
    const p = prev.walls?.[id]
    if (!p) continue
    const w = cur.walls[id]
    if (!reseg.written.has(id) && E.wallShapeSignature(w) !== E.wallShapeSignature(p)) {
      updateOps.push(E.wallUpdateOp(st, w))
    }
    const before = new Map((p.openings ?? []).map((o) => [o.ifcGlobalId, o]))
    for (const o of (w.openings ?? [])) {
      const was = before.get(o.ifcGlobalId)
      // New on this wall (drawn, or carried here by a split/join) or its type
      // changed → ADD (it names the wall and sets the type); resized / moved along
      // the wall / sill changed → UPDATE.
      if (!was || E.openingTypeSignature(was) !== E.openingTypeSignature(o)) openingOps.push(E.openingAddOp(w, o))
      else if (E.openingShapeSignature(was) !== E.openingShapeSignature(o)) updateOps.push(E.openingUpdateOp(o))
    }
  }
  // DELETES — openings that left the building (not those carried to another wall).
  const openingsNow = new Set()
  for (const w of Object.values(cur.walls)) for (const o of (w.openings ?? [])) openingsNow.add(o.ifcGlobalId)
  if (prev.walls) {
    for (const w of Object.values(prev.walls)) {
      for (const o of (w.openings ?? [])) if (!openingsNow.has(o.ifcGlobalId)) deleteOps.push(E.openingDeleteOp(o.ifcGlobalId))
    }
  }
  // UPDATES — every element kind, registry-driven. Each side signs against its own
  // state, so a change that lives in the state (a slab's rooms) is seen (KD-37).
  for (const entry of ELEMENT_ENTRIES) {
    const coll = entry.collection
    for (const id in (cur[coll] ?? {})) {
      const p = prev[coll]?.[id]
      if (p && E.signature(coll, cur[coll][id], st) !== E.signature(coll, p, prev)) updateOps.push(E.elementUpdateOp(st, entry, cur[coll][id]))
    }
  }

  // DELETES — child-first. Walls a split or join retired are retired by that op.
  if (prev.walls) for (const id in prev.walls) if (!cur.walls[id] && !reseg.retired.has(id)) deleteOps.push(E.wallDeleteOp(prev.walls[id].ifcGlobalId))
  if (prev.rooms) for (const id in prev.rooms) if (!cur.rooms[id]) deleteOps.push(E.roomDeleteOp(prev.rooms[id].ifcGlobalId))
  if (prev.nodes) for (const id in prev.nodes) if (!cur.nodes[id]) deleteOps.push(E.nodeDeleteOp(prev.nodes[id].ifcGlobalId))
  for (const coll of ELEMENT_COLLECTIONS) if (prev[coll]) for (const id in prev[coll]) if (!cur[coll]?.[id]) deleteOps.push(E.elementDeleteOp(prev[coll][id].ifcGlobalId))


  const ops = [...floorAddOps, ...nodeOps, ...roomOps, ...verticesOps, ...wallOps, ...surfaceOps, ...openingOps, ...elemOps, ...floorUpdateOps, ...updateOps, ...deleteOps, ...floorDeleteOps]
  if (ops.length || doc) await enqueueGeometryOps(ops, doc)
  _shadow = cur
  _floorShadow = curFloors
}

// ── Wall re-segmentation (pure) ──────────────────────────────────────────────
//
// SPLIT — a wall removed this flush whose two end nodes are now joined by a chain
// of ≥2 walls added this flush, every one lying along the removed wall.
// JOIN  — (a) the Join tool: a wall that stays (the survivor keeps its id) now spans
// its old extent plus a wall removed this flush that shared a node with it; or
// (b) an undo of a split: a wall added this flush whose end nodes were joined by a
// chain of ≥2 walls removed this flush, all along it.
// Returns the ops' inputs plus `written` (walls the ops write — not re-added or
// re-patched) and `retired` (walls the ops retire — not deleted again).
const ALONG_IN = 1
function _along(nodes, a, b, p) {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return false
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  if (t < -1e-6 || t > 1 + 1e-6) return false
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y) <= ALONG_IN
}
// A chain of `candidates` from node `from` to node `to`, each wall lying along the
// segment from→to (positions read from `nodes`). Returns the walls in order, or null.
function _chain(candidates, nodes, from, to) {
  const a = nodes[from], b = nodes[to]
  if (!a || !b) return null
  const usable = candidates.filter((w) => nodes[w.n1] && nodes[w.n2] && _along(nodes, a, b, nodes[w.n1]) && _along(nodes, a, b, nodes[w.n2]))
  const out = []
  const used = new Set()
  let cursor = from
  while (cursor !== to) {
    const next = usable.find((w) => !used.has(w.id) && (w.n1 === cursor || w.n2 === cursor))
    if (!next) return null
    used.add(next.id)
    out.push(next)
    cursor = next.n1 === cursor ? next.n2 : next.n1
  }
  return out.length >= 2 ? out : null
}

export function detectWallResegmentation(prev, cur) {
  const splits = [], joins = []
  const written = new Set(), retired = new Set()
  const prevWalls = prev.walls ?? {}, curWalls = cur.walls ?? {}
  const removed = Object.values(prevWalls).filter((w) => !curWalls[w.id])
  const added = Object.values(curWalls).filter((w) => !prevWalls[w.id])

  for (const source of removed) {
    const pieces = _chain(added.filter((w) => !written.has(w.id)), cur.nodes ?? {}, source.n1, source.n2)
    if (!pieces) continue
    splits.push({ source, pieces })
    retired.add(source.id)
    for (const p of pieces) written.add(p.id)
  }
  for (const merged of added) {
    if (written.has(merged.id)) continue
    const sources = _chain(removed.filter((w) => !retired.has(w.id)), prev.nodes ?? {}, merged.n1, merged.n2)
    if (!sources) continue
    joins.push({ merged, sources })
    written.add(merged.id)
    for (const s of sources) retired.add(s.id)
  }
  for (const gone of removed) {
    if (retired.has(gone.id)) continue
    for (const survivor of Object.values(curWalls)) {
      const before = prevWalls[survivor.id]
      if (!before || written.has(survivor.id)) continue
      const shared = [before.n1, before.n2].find((n) => n === gone.n1 || n === gone.n2)
      if (!shared) continue
      const keptEnd = before.n1 === shared ? before.n2 : before.n1
      const goneEnd = gone.n1 === shared ? gone.n2 : gone.n1
      const spans = new Set([survivor.n1, survivor.n2])
      if (!(spans.has(keptEnd) && spans.has(goneEnd))) continue
      joins.push({ merged: survivor, sources: [before, gone] })
      written.add(survivor.id)
      retired.add(gone.id)
      break
    }
  }
  return { splits, joins, written, retired }
}
