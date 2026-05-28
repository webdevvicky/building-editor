import { create } from 'zustand'
import {
  SNAP_IN, GRID_IN, DEFAULT_WALL_HEIGHT_IN, DEFAULT_WALL_THICK_IN,
  findNearbyNode, isOnSegment, collinearOverlap, pointInPolygon, normalizePolygonWinding,
  doRoomsOverlap,
} from './geometry'
import { getPresetFinishes, ALL_FINISHES, ROOM_PRESETS } from './roomPresets'
import { MATERIAL_LIBRARY, BONDING } from './materials'
import { createStructuralSlice, DEFAULT_PROJECT_SETTINGS, DEFAULT_FLOOR_ID } from './structuralSlice'
import { createMepSlice } from './mepSlice'
import { DEFAULT_LAYER_VISIBILITY } from './constants/layers'
import {
  walkPolygonNodeOrder as walkPolygon,
  buildPlotPolygon,
  getRoomPolygon as topoGetRoomPolygon,
  getRoomArea as topoGetRoomArea,
  getRoomWallArea as topoGetRoomWallArea,
  isRoomStructurallyValid as topoIsRoomStructurallyValid,
  hasRoomOverlap as topoHasRoomOverlap,
  getOverlappingRoomName as topoGetOverlappingRoomName,
  getValidRoomIds as topoGetValidRoomIds,
  sumRoomAreas as topoSumRoomAreas,
} from './topology/rooms.js'
import {
  getActiveFloorNodes,
  getActiveFloorWalls,
} from './topology/floor.js'
import {
  findFaceContainingEdge,
  isFaceCoveredByRoom,
} from './topology/faces.js'
import {
  probeWallForMidSpan,
  findCoalescingJunction,
} from './topology/junctions.js'
import {
  recomputeRoomNodeOrder,
  computeNodeOrderForWallIds,
} from './topology/nodeOrderRefresh.js'
import {
  findExpandedEdge,
} from './topology/adjacency.js'
import {
  planWallSplit,
} from './topology/wallSplit.js'
import {
  canMergeWalls,
} from './topology/canMerge.js'
import {
  OPENING_SUBTYPE, SUBTYPE_SOURCE,
  VENTILATOR_MAX_HEIGHT_IN, VENTILATOR_MAX_WIDTH_IN,
} from './constants/joinery.js'
import { uid, uidIfc, newEntityIds } from './lib/ids.js'

// Default opening subtype — pure heuristic by size + type. Used at creation
// time (addOpening) and as loadProject fallback when subtype is absent.
//
// Doors: default INTERNAL_DOOR. Promotion to MAIN_DOOR happens when:
//   - addOpening sees an external wall AND no other MAIN_DOOR exists on
//     the same floor yet.
// Windows: small openings (≤18in tall, ≤36in wide) → VENTILATOR.
function _deriveSubtypeBySize(opening) {
  if (opening.type === 'window') {
    const w = opening.width  ?? 0
    const h = opening.height ?? 0
    if (h <= VENTILATOR_MAX_HEIGHT_IN && w <= VENTILATOR_MAX_WIDTH_IN) {
      return OPENING_SUBTYPE.VENTILATOR
    }
    return OPENING_SUBTYPE.WINDOW
  }
  if (opening.type === 'door') return OPENING_SUBTYPE.INTERNAL_DOOR
  return null
}

function getStampDimensionsFt(stamp) {
  const wFt = (stamp.w || 0) / 12
  const hFt = (stamp.h || 0) / 12
  const dFt = (stamp.depth || 0) / 12
  return { wFt, hFt, dFt, perimeterFt: 2 * (wFt + hFt), footprintFt2: wFt * hFt }
}

// Area 2B — auto-name "Room N" where N = first unused integer starting at 1.
function _autoRectRoomName(rooms) {
  const taken = new Set(Object.values(rooms).map(r => r.name))
  for (let i = 1; i < 10000; i++) {
    const name = `Room ${i}`
    if (!taken.has(name)) return name
  }
  return 'Room'
}

function removeOrphanNodes(nodes, walls) {
  const used = new Set()
  Object.values(walls).forEach(w => { used.add(w.n1); used.add(w.n2) })
  const cleaned = { ...nodes }
  Object.keys(cleaned).forEach(id => { if (!used.has(id)) delete cleaned[id] })
  return cleaned
}

// Floor-aware draw/snap scoping flows through src/topology/floor.js — see
// getActiveFloorNodes / getActiveFloorWalls imports above. Topology principle:
// spatial alignment across floors NEVER implies shared ownership.

// Dev-only handle for browser console debugging. Stripped from production builds.
// Usage in DevTools: useStore.getState().getValidRoomIds(), etc.
function exposeStoreForDev(store) {
  // import.meta.env is injected by Vite — undefined in plain Node (verify scripts).
  if (import.meta.env?.DEV && typeof window !== 'undefined') {
    window.useStore = store
  }
}

export const useStore = create((set, get) => ({
  nodes:  {},
  walls:  {},
  rooms:  {},
  stamps: {},

  history: [],
  future:  [],
  // Area 2B Correction 6 — batch flag for _runAtomically. Set true while a
  // transactional batch is in flight so nested _save() calls collapse to a
  // single history frame.
  _inBatch: false,

  activeTool:      'draw',
  drawVirtual:     false,
  drawStartId:     null,
  selectedWallId:  null,
  selectedWallIds: [],
  selectedStampId: null,
  selectedRoomId:  null,
  // Selected opening (door/window) — { wallId, openingId } | null.
  // Openings live inside walls; we carry both ids so the detail panel can
  // resolve the opening without iterating every wall's openings[] array.
  selectedOpening: null,
  pendingWallIds:  [],
  draftOpening:    null,

  // Phase 4 Tier-2 ADD 3: namespaced cross-canvas selection state.
  // Lives outside the legacy `selectedX` flat fields. New "highlight a
  // collection" features (electrical circuit, plumbing zone, HVAC
  // refrigerant loop, riser trace) all live here. View-slice only —
  // never history-tracked, never persisted.
  selection: {},

  // Default display unit. 'ft-in' targets Indian residential construction
  // (engineers think 10'-6" not 10.5 ft). Existing projects whose autosave
  // restored an explicit preference keep it; this only governs first load
  // on a new browser / fresh state.
  unit:           'ft-in',
  showDimensions: false,
  layerVisibility: { ...DEFAULT_LAYER_VISIBILITY },

  // UI state for floor switcher (Phase 1.9 UI). Stage 0 stays on F1.
  // Excluded from history snapshots — switching floors is a view operation.
  currentFloorId: DEFAULT_FLOOR_ID,

  // BOQ rate inputs — keyed by rateKey from getBoqLines() lines.
  // Persisted via autosave + project snapshot + revision snapshot. Excluded
  // from history (changing a rate is a numerical adjustment, not a structural
  // edit; Ctrl+Z should not unwind rate keystrokes).
  ratesByKey: {},
  setRate(key, val) {
    set(s => ({
      ratesByKey: { ...s.ratesByKey, [key]: val },
      ratesRevision: (s.ratesRevision ?? 0) + 1,
    }))
  },

  // Phase 4 Tier-2 ADD 7: revision counters for downstream memoization.
  // boqRevision bumps on any structural mutation (via _save). ratesRevision
  // bumps on any setRate call. Consumers (RoomDetailPanel materials, future
  // per-room cost dashboards) key useMemo on these so getBoqLines() only
  // recomputes when its real inputs changed.
  boqRevision: 0,
  ratesRevision: 0,

  // Ring buffer of action-emitted validation events (Phase 1.7+ floor topology).
  // Store actions that REJECT an invalid operation (e.g., splitWall on an
  // off-floor wall) push a pre-formed issue record here. runValidation() picks
  // them up. Capped at 100 entries — older events drop off the head.
  // Excluded from history (transient observability, not user-meaningful state).
  validationEvents: [],

  // ── History ───────────────────────────────────────────────────────────

  _save() {
    // Area 2B — Correction 6. When _runAtomically opened a batch, the
    // pre-batch snapshot is already on history; suppress nested _save calls
    // so the whole batch undoes as ONE frame.
    if (get()._inBatch) {
      // Still bump boqRevision so downstream memos see the in-flight changes.
      set(s => ({ boqRevision: (s.boqRevision ?? 0) + 1 }))
      return
    }
    const {
      nodes, walls, rooms, stamps, columns, beams, slabs, staircases, foundations,
      plumbingFixtures, electricalPoints, hvacUnits, fireDevices, elvDevices, solarEquipment, risers,
    } = get()
    set(s => ({
      history: [...s.history.slice(-49), {
        nodes, walls, rooms, stamps, columns, beams, slabs, staircases, foundations,
        plumbingFixtures, electricalPoints, hvacUnits, fireDevices, elvDevices, solarEquipment, risers,
      }],
      future: [],
      // ADD 7: any structural mutation invalidates BOQ memo subscribers.
      boqRevision: (s.boqRevision ?? 0) + 1,
    }))
  },

  // Area 2B — Correction 6. Wraps a multi-action batch so it occupies a
  // SINGLE history frame. Use for any operation that calls multiple
  // _save-emitting actions (addRectangleRoom, multi-import, etc.).
  // Undo restores the pre-batch state atomically.
  _runAtomically(fn) {
    if (get()._inBatch) return fn()  // re-entrancy: caller already owns the batch
    get()._save()
    set({ _inBatch: true })
    try {
      return fn()
    } finally {
      set({ _inBatch: false })
    }
  },

  undo() {
    const { history } = get()
    if (!history.length) return
    const prev = history[history.length - 1]
    set(s => ({
      history: s.history.slice(0, -1),
      future:  [{
        nodes: s.nodes, walls: s.walls, rooms: s.rooms, stamps: s.stamps,
        columns: s.columns, beams: s.beams, slabs: s.slabs, staircases: s.staircases, foundations: s.foundations,
        plumbingFixtures: s.plumbingFixtures, electricalPoints: s.electricalPoints,
        hvacUnits: s.hvacUnits, fireDevices: s.fireDevices, elvDevices: s.elvDevices,
        solarEquipment: s.solarEquipment, risers: s.risers,
      }, ...s.future.slice(0, 49)],
      nodes:   prev.nodes,
      walls:   prev.walls,
      rooms:   prev.rooms,
      stamps:  prev.stamps,
      columns: prev.columns    ?? s.columns,
      beams:   prev.beams      ?? s.beams,
      slabs:   prev.slabs      ?? s.slabs,
      staircases:  prev.staircases  ?? s.staircases,
      foundations: prev.foundations ?? s.foundations,
      plumbingFixtures: prev.plumbingFixtures ?? s.plumbingFixtures,
      electricalPoints: prev.electricalPoints ?? s.electricalPoints,
      hvacUnits:        prev.hvacUnits        ?? s.hvacUnits,
      fireDevices:      prev.fireDevices      ?? s.fireDevices,
      elvDevices:       prev.elvDevices       ?? s.elvDevices,
      solarEquipment:   prev.solarEquipment   ?? s.solarEquipment,
      risers:           prev.risers           ?? s.risers,
      drawStartId: null, selectedWallId: null, selectedWallIds: [], selectedStampId: null, selectedBeamId: null, pendingWallIds: [],
    }))
  },

  redo() {
    const { future } = get()
    if (!future.length) return
    const next = future[0]
    set(s => ({
      future:  s.future.slice(1),
      history: [...s.history.slice(-49), {
        nodes: s.nodes, walls: s.walls, rooms: s.rooms, stamps: s.stamps,
        columns: s.columns, beams: s.beams, slabs: s.slabs, staircases: s.staircases, foundations: s.foundations,
        plumbingFixtures: s.plumbingFixtures, electricalPoints: s.electricalPoints,
        hvacUnits: s.hvacUnits, fireDevices: s.fireDevices, elvDevices: s.elvDevices,
        solarEquipment: s.solarEquipment, risers: s.risers,
      }],
      nodes:   next.nodes,
      walls:   next.walls,
      rooms:   next.rooms,
      stamps:  next.stamps,
      columns: next.columns    ?? s.columns,
      beams:   next.beams      ?? s.beams,
      slabs:   next.slabs      ?? s.slabs,
      staircases:  next.staircases  ?? s.staircases,
      foundations: next.foundations ?? s.foundations,
      plumbingFixtures: next.plumbingFixtures ?? s.plumbingFixtures,
      electricalPoints: next.electricalPoints ?? s.electricalPoints,
      hvacUnits:        next.hvacUnits        ?? s.hvacUnits,
      fireDevices:      next.fireDevices      ?? s.fireDevices,
      elvDevices:       next.elvDevices       ?? s.elvDevices,
      solarEquipment:   next.solarEquipment   ?? s.solarEquipment,
      risers:           next.risers           ?? s.risers,
      drawStartId: null, selectedWallId: null, selectedWallIds: [], selectedStampId: null, selectedBeamId: null, pendingWallIds: [],
    }))
  },

  // ── Tools ─────────────────────────────────────────────────────────────

  setTool(tool) {
    set({ activeTool: tool, drawStartId: null, selectedWallId: null, selectedWallIds: [], selectedStampId: null, selectedRoomId: null, selectedColumnId: null, selectedFoundationId: null, selectedBeamId: null, selectedOpening: null, pendingWallIds: [], draftOpening: null })
  },

  toggleDrawVirtual()    { set(s => ({ drawVirtual: !s.drawVirtual })) },
  setUnit(unit)          { set({ unit }) },
  toggleShowDimensions() { set(s => ({ showDimensions: !s.showDimensions })) },
  setDraftOpening(data)  { set({ draftOpening: data }) },
  setLayerVisibility(partial) { set(s => ({ layerVisibility: { ...s.layerVisibility, ...partial } })) },
  setCurrentFloorId(id)  { set({ currentFloorId: id }) },

  // ── Nodes ─────────────────────────────────────────────────────────────

  // Phase W — getOrCreateNode priority (rewritten):
  //   1. CORNER snap (Phase A NODE 4in tolerance) — reuse existing corner.
  //   2. TJUNCTION snap (4in tolerance via findNearestTjunction) — reuse junction.
  //   3. Mid-span on a wall (within SNAP_IN perpendicular, beyond SNAP_IN
  //      from any endpoint, beyond SNAP_IN from any existing junction):
  //      → Create a TJUNCTION node attached to the wall. Wall is NOT split.
  //      → Wall identity, ifcGlobalId, openings, hasPlinthBeam/etc. preserved.
  //      → Refresh room.nodeOrder for every room whose wallIds contains the wall.
  //   4. Fresh CORNER node.
  //
  // Floor-aware topology:
  //   - All snaps + wall iteration restricted to current floor.
  //   - Cross-floor coordinate collisions create distinct nodes.
  //   - Mid-span junctions inherit wall.floorId.
  getOrCreateNode(x, y) {
    const state = get()
    const cur = state.currentFloorId ?? DEFAULT_FLOOR_ID

    // 1. CORNER snap on current floor.
    const candidateNodes = getActiveFloorNodes(state, cur)
    // findNearbyNode walks ALL nodes; we need to exclude TJUNCTIONs here
    // (those are queried separately). Box-distance test mirrors findNearbyNode.
    let cornerHit = null
    for (const n of Object.values(candidateNodes)) {
      if ((n.kind ?? 'CORNER') !== 'CORNER') continue
      if (Math.abs(n.x - x) < SNAP_IN && Math.abs(n.y - y) < SNAP_IN) {
        cornerHit = n
        break
      }
    }
    if (cornerHit) return cornerHit.id

    // 2. TJUNCTION snap on current floor.
    let junctionHit = null
    for (const n of Object.values(candidateNodes)) {
      if ((n.kind ?? 'CORNER') !== 'TJUNCTION') continue
      if (Math.abs(n.x - x) < SNAP_IN && Math.abs(n.y - y) < SNAP_IN) {
        junctionHit = n
        break
      }
    }
    if (junctionHit) return junctionHit.id

    // 3. Mid-span: create a T-junction (do NOT split the wall).
    const splittableWalls = getActiveFloorWalls(state, cur)
    for (const wall of Object.values(splittableWalls)) {
      if (wall.isPlot) continue   // plot walls are site boundaries; no T-junctions on them
      const probe = probeWallForMidSpan(state, wall.id, x, y)
      if (!probe.onCenterline) continue

      // INV-W10 guard: refuse if within SNAP_IN of an existing junction.
      const coalesceId = findCoalescingJunction(state, wall.id, probe.t)
      if (coalesceId) return coalesceId   // reuse existing junction

      // Create the TJUNCTION node and attach to wall.
      const newNodeId = uid()
      const newNodeIfc = uidIfc()
      const newNodeFloorIds = [wall.floorId ?? cur]
      // Use projected coordinates so the junction sits exactly on the
      // wall centerline.
      const jX = probe.x, jY = probe.y

      set(s => {
        const newNodes = {
          ...s.nodes,
          [newNodeId]: {
            id: newNodeId,
            ifcGlobalId: newNodeIfc,
            x: jX,
            y: jY,
            floorIds: newNodeFloorIds,
            kind: 'TJUNCTION',
            onWallId: wall.id,
          },
        }
        const newWalls = {
          ...s.walls,
          [wall.id]: {
            ...s.walls[wall.id],
            junctions: [...(s.walls[wall.id].junctions ?? []), newNodeId],
          },
        }
        // Refresh room.nodeOrder for every room whose wallIds contains
        // this parent wall — the new junction is now a polygon vertex.
        const stateAfter = { ...s, nodes: newNodes, walls: newWalls }
        const newRooms = {}
        let anyRoomTouched = false
        for (const room of Object.values(s.rooms)) {
          if (!(room.wallIds ?? []).includes(wall.id)) {
            newRooms[room.id] = room
            continue
          }
          const refreshed = recomputeRoomNodeOrder(stateAfter, room.id)
          newRooms[room.id] = { ...room, nodeOrder: refreshed }
          anyRoomTouched = true
        }
        return {
          nodes: newNodes,
          walls: newWalls,
          ...(anyRoomTouched ? { rooms: newRooms } : {}),
        }
      })
      return newNodeId
    }

    const { id, ifcGlobalId } = newEntityIds()
    set(s => ({ nodes: { ...s.nodes, [id]: { id, ifcGlobalId, x, y, floorIds: [cur], kind: 'CORNER', onWallId: null } } }))
    return id
  },

  // ── Walls ─────────────────────────────────────────────────────────────

  addWall(n1, n2) {
    if (n1 === n2) return
    const state = get()
    const { nodes } = state
    const a = nodes[n1], b = nodes[n2]
    if (a && b && Math.hypot(b.x - a.x, b.y - a.y) < 1) return

    // Floor-scoped dedup + collinear-overlap. Identical wall geometry on
    // different floors is the expected case for multi-storey buildings —
    // cross-floor walls share no topology and cannot be duplicates of
    // each other. Plot polygon containment stays floor-agnostic (site
    // boundary is single, not per-floor).
    const cur = state.currentFloorId ?? DEFAULT_FLOOR_ID
    const sameFloorWalls = Object.values(getActiveFloorWalls(state, cur))
    const already = sameFloorWalls.some(
      w => (w.n1 === n1 && w.n2 === n2) || (w.n1 === n2 && w.n2 === n1)
    )
    if (already) return
    const ns = nodes
    const na = ns[n1], nb = ns[n2]
    const overlaps = sameFloorWalls.some(w => {
      const c = ns[w.n1], d = ns[w.n2]
      if (!c || !d) return false
      return collinearOverlap(na.x, na.y, nb.x, nb.y, c.x, c.y, d.x, d.y)
    })
    if (overlaps) return

    const { walls: currentWalls, nodes: currentNodes } = state
    const plotPoly = buildPlotPolygon(currentWalls, currentNodes)
    if (plotPoly) {
      const nodeA = currentNodes[n1], nodeB = currentNodes[n2]
      if (!pointInPolygon(nodeA.x, nodeA.y, plotPoly) || !pointInPolygon(nodeB.x, nodeB.y, plotPoly)) return
    }
    get()._save()
    const { id, ifcGlobalId } = newEntityIds()
    const isVirtual = get().drawVirtual
    const floorId = cur
    set(s => ({
      walls: { ...s.walls, [id]: { id, ifcGlobalId, n1, n2, height: DEFAULT_WALL_HEIGHT_IN, thickness: DEFAULT_WALL_THICK_IN, materialKey: 'IS_MODULAR_BRICK', isPlot: false, isVirtual, openings: [], hasPlinthBeam: null, hasLintelBeam: null, hasRoofBeam: null, floorId, classification: null, meta: null, junctions: [], splitOrigin: 'NONE' } },
      drawStartId: null,
    }))
  },

  // Area 2B — atomic rectangle-room creation. ONE history frame for nodes
  // + walls + room (+ auto-MEP if caller wraps an outer _runAtomically).
  // x1/y1/x2/y2 are world inches (any corner ordering accepted).
  // opts: { name?: string, type?: string }. Returns:
  //   { roomId, wallIds } on success
  //   { error: 'too-small' | 'node-snap-failed' | 'wall-create-failed' | <saveRoom error> }
  addRectangleRoom(x1, y1, x2, y2, opts = {}) {
    return get()._runAtomically(() => {
      const minX = Math.min(x1, x2), maxX = Math.max(x1, x2)
      const minY = Math.min(y1, y2), maxY = Math.max(y1, y2)
      if (maxX - minX < GRID_IN || maxY - minY < GRID_IN) {
        return { error: 'too-small' }
      }
      // 4 corners CCW from SW so winding matches getRoomPolygon convention.
      const sw = get().getOrCreateNode(minX, minY)
      const se = get().getOrCreateNode(maxX, minY)
      const ne = get().getOrCreateNode(maxX, maxY)
      const nw = get().getOrCreateNode(minX, maxY)
      if (!sw || !se || !ne || !nw) return { error: 'node-snap-failed' }

      // addWall is idempotent on dup geometry (returns early). After all
      // four calls, look up the wallId between each consecutive pair —
      // reuses existing walls when corners snapped to existing nodes.
      get().addWall(sw, se)
      get().addWall(se, ne)
      get().addWall(ne, nw)
      get().addWall(nw, sw)
      // Phase W — lookup via the expanded graph: a pair (a, b) might be
      // a SEGMENT of an existing parent wall (T-junction case) rather
      // than a fresh wall. findExpandedEdge returns the parent wallId.
      const pairs = [[sw, se], [se, ne], [ne, nw], [nw, sw]]
      const wallIds = pairs.map(([a, b]) => {
        // Try direct wall lookup first.
        const direct = Object.values(get().walls).find(
          x => (x.n1 === a && x.n2 === b) || (x.n1 === b && x.n2 === a)
        )
        if (direct) return direct.id
        // Fall back to expanded graph: pair may span a wall segment.
        const expanded = findExpandedEdge(get(), a, b)
        return expanded?.wallId ?? null
      })
      if (wallIds.some(id => !id)) return { error: 'wall-create-failed' }

      // saveRoom consumes pendingWallIds. Stage them, save, then clear.
      set({ pendingWallIds: wallIds })
      const type = ROOM_PRESETS[opts.type] ? opts.type : 'OTHER'
      const name = (opts.name && String(opts.name).trim())
                   || _autoRectRoomName(get().rooms)
      const result = get().saveRoom(name, type)
      if (result?.error) return result

      // Recover the new room id (most-recent room on current floor with this name).
      const cur = get().currentFloorId ?? DEFAULT_FLOOR_ID
      const created = Object.values(get().rooms)
        .filter(r => (r.floorId ?? DEFAULT_FLOOR_ID) === cur && r.name === name)
        .at(-1)
      if (!created) return { error: 'save-room-failed' }
      return { roomId: created.id, wallIds }
    })
  },

  // ── Phase R1 — interactive face detection → Room ────────────────────────
  //
  // detectFaceFromWallClick: pure pass-through to topology. No mutation.
  // Used by Canvas's room_detect tool for hover preview + click handler.
  // Returns Face | null.
  detectFaceFromWallClick(wallId, clickPoint) {
    return findFaceContainingEdge(get(), wallId, clickPoint)
  },

  // createRoomFromFace: atomically convert a detected face into a Room.
  // Routes through pendingWallIds → saveRoom so the existing overlap
  // check, history snapshot, integrity, finishes presets, naming, and
  // IFC GUID generation all stay consistent. Stamps provenance meta
  // (createdFrom='face-detect', detectedAt=ISO timestamp).
  //
  // Returns:
  //   { roomId, wallIds }                — created
  //   { roomId, alreadyExists: true }    — face already covered by a Room
  //   { error: 'no-face' }               — face was null
  //   { error: 'overlap', conflictName } — saveRoom overlap rejection
  //   { error: 'save-room-failed' }      — saveRoom returned non-ok
  createRoomFromFace(face, opts = {}) {
    if (!face || !Array.isArray(face.wallIdsInOrder)) return { error: 'no-face' }
    return get()._runAtomically(() => {
      // Idempotency: if a Room already covers this exact wall set, return it.
      const existingRoomId = isFaceCoveredByRoom(get(), face.wallIds)
      if (existingRoomId) return { roomId: existingRoomId, alreadyExists: true }

      const type = ROOM_PRESETS[opts.type] ? opts.type : 'OTHER'
      const desiredName = (opts.name && String(opts.name).trim())
                          || _autoRectRoomName(get().rooms)

      // Stage the face's wallIds in walk order for saveRoom.
      set({ pendingWallIds: [...face.wallIdsInOrder] })
      const result = get().saveRoom(desiredName, type)
      if (result?.error) return result

      // Recover the new room id (most-recent room on the face's floor
      // with the desired name).
      const fid = face.floorId ?? get().currentFloorId ?? DEFAULT_FLOOR_ID
      const created = Object.values(get().rooms)
        .filter(r => (r.floorId ?? DEFAULT_FLOOR_ID) === fid && r.name === desiredName)
        .at(-1)
      if (!created) return { error: 'save-room-failed' }

      // Phase W — overwrite saveRoom's walkPolygon-derived nodeOrder with
      // the face's authoritative nodeOrder (canonical from face
      // enumeration). saveRoom's wallIds dedup may have changed order;
      // face.nodeOrder is the authoritative closed-polygon sequence.
      // Also stamp provenance meta.
      set(s => ({
        rooms: {
          ...s.rooms,
          [created.id]: {
            ...s.rooms[created.id],
            nodeOrder: Array.isArray(face.nodeOrder) ? [...face.nodeOrder] : s.rooms[created.id].nodeOrder,
            meta: {
              ...(s.rooms[created.id].meta ?? {}),
              createdFrom: 'face-detect',
              detectedAt:  new Date().toISOString(),
            },
          },
        },
      }))

      return { roomId: created.id, wallIds: [...face.wallIdsInOrder] }
    })
  },

  // Phase W — deleteWall handles T-junction cleanup correctly:
  //   - For each junction node N attached to this wall (in junctions[]):
  //     * If N is also referenced by ANOTHER wall (via n1/n2 or junctions[])
  //       → convert N to CORNER (clear onWallId), keep the node.
  //     * If N has no other reference → orphan; removeOrphanNodes prunes it.
  //   - Refuse the delete if any junction is in ANOTHER wall's junctions[]
  //     (stale ownership corruption) — flag as validationEvent.
  //   - room.nodeOrder refreshed for every room that referenced this wall.
  //
  // Bug B fix (2026-05-28): rooms whose closure depended on the deleted
  // wall are AUTO-PURGED, atomic with the wall removal. Each affected
  // room is re-validated via isRoomStructurallyValid against the
  // post-deletion state; rooms that fail are removed from state.rooms
  // and an `room_orphaned_by_wall_delete` validationEvent is pushed.
  // The whole operation runs under a single _save() snapshot so undo
  // restores both the wall AND the purged rooms atomically. The action
  // returns { ok, purgedRoomIds, purgedRoomNames } so UI callers can
  // upgrade their wall-delete toast to a persistent one when rooms
  // were affected.
  deleteWall(wallId) {
    const state = get()
    const wall = state.walls?.[wallId]
    if (!wall) return null

    // Stale-ownership corruption check (Section F.4).
    const ownJunctions = wall.junctions ?? []
    const corrupted = []
    for (const otherWall of Object.values(state.walls)) {
      if (otherWall.id === wallId) continue
      for (const jId of (otherWall.junctions ?? [])) {
        if (ownJunctions.includes(jId)) {
          corrupted.push({ junctionId: jId, alsoIn: otherWall.id })
        }
      }
    }
    if (corrupted.length > 0) {
      set(s => ({
        validationEvents: [
          ...(s.validationEvents ?? []),
          ...corrupted.map(c => ({
            ruleId:     'wall_junction_stale_ownership',
            severity:   'error',
            category:   'topology',
            entityType: 'wall',
            entityId:   wallId,
            message:    `deleteWall refused: junction ${c.junctionId} also in wall ${c.alsoIn}.junctions[]`,
          })),
        ].slice(-100),
      }))
      return { error: 'junction-stale-ownership', corrupted }
    }

    // Collect rooms that reference this wall BEFORE mutation so we can
    // re-validate them after the strip + nodeOrder recompute pass.
    const affectedRoomIds = []
    for (const r of Object.values(state.rooms ?? {})) {
      if ((r.wallIds ?? []).includes(wallId)) affectedRoomIds.push(r.id)
    }

    get()._save()
    set(s => {
      const walls = { ...s.walls }
      delete walls[wallId]

      // Junction cleanup: each junction node that was attached to this
      // wall is either converted to CORNER (if referenced elsewhere)
      // or left for removeOrphanNodes to prune.
      const newNodes = { ...s.nodes }
      for (const jId of ownJunctions) {
        const j = newNodes[jId]
        if (!j) continue
        // Determine if j is referenced by any remaining wall.
        let referenced = false
        for (const w of Object.values(walls)) {
          if (w.n1 === jId || w.n2 === jId) { referenced = true; break }
          if ((w.junctions ?? []).includes(jId)) { referenced = true; break }
        }
        if (referenced) {
          // Convert to CORNER — it's no longer "mid-span on a wall."
          newNodes[jId] = { ...j, kind: 'CORNER', onWallId: null }
        }
        // If not referenced, leave for removeOrphanNodes below.
      }

      const nodes = removeOrphanNodes(newNodes, walls)
      const rooms = {}
      Object.values(s.rooms).forEach(r => {
        rooms[r.id] = { ...r, wallIds: (r.wallIds ?? []).filter(id => id !== wallId) }
      })
      const clearOpening = s.selectedOpening?.wallId === wallId
      return {
        walls, nodes, rooms,
        selectedWallId: null,
        ...(clearOpening ? { selectedOpening: null } : {}),
      }
    })

    // Refresh nodeOrder for every affected room AND purge those whose
    // closure broke. Atomic within this single set() — undo restores
    // both the wall and any purged rooms because _save() above captured
    // the pre-mutation snapshot.
    const purgedRoomIds = []
    const purgedRoomNames = []
    if (affectedRoomIds.length > 0) {
      set(s => {
        const refreshed = { ...s.rooms }
        const purgeEvents = []
        for (const rid of affectedRoomIds) {
          const room = refreshed[rid]
          if (!room) continue
          const order = recomputeRoomNodeOrder(s, rid)
          // Build a candidate room reflecting the new nodeOrder so the
          // canonical isRoomStructurallyValid call sees the post-refresh
          // state without mutating store before validation.
          const candidate = { ...room, nodeOrder: order }
          const probeState = { ...s, rooms: { ...refreshed, [rid]: candidate } }
          if (topoIsRoomStructurallyValid(probeState, rid)) {
            refreshed[rid] = candidate
            continue
          }
          // Orphan — closure broken. Purge.
          purgedRoomIds.push(rid)
          purgedRoomNames.push(room.name || 'Untitled')
          purgeEvents.push({
            ruleId:     'room_orphaned_by_wall_delete',
            severity:   'warning',
            category:   'topology',
            entityType: 'room',
            entityId:   rid,
            message:    `Room "${room.name || 'Untitled'}" lost closure when wall ${wallId} was deleted; auto-removed.`,
            meta:       { deletedWallId: wallId, roomName: room.name ?? null },
          })
          delete refreshed[rid]
        }
        const out = { rooms: refreshed }
        if (purgeEvents.length > 0) {
          out.validationEvents = [
            ...(s.validationEvents ?? []),
            ...purgeEvents,
          ].slice(-100)
        }
        // Clear room-related selection state when its target was purged.
        if (purgedRoomIds.includes(s.selectedRoomId)) out.selectedRoomId = null
        return out
      })
    }
    return { ok: true, purgedRoomIds, purgedRoomNames }
  },

  selectWall(wallId) {
    // BUG 3 defensive guard — preserve an active opening selection when the
    // wall click resolves to the SAME wall that owns the opening. Prevents
    // the canvas opening-hit-target → wall-group click chain from clearing
    // selectedOpening between mousedown (opening) and click (wall).
    const cur = get().selectedOpening
    if (cur && wallId && cur.wallId === wallId) return
    set({ selectedWallId: wallId, selectedWallIds: [], selectedStampId: null, selectedRoomId: null, selectedBeamId: null, selectedOpening: null, draftOpening: null })
  },
  selectRoom(roomId) { set({ selectedRoomId: roomId, selectedWallId: null, selectedWallIds: [], selectedStampId: null, selectedBeamId: null, selectedOpening: null, draftOpening: null }) },

  // ADD 3: shallow-merge into state.selection. Pass an object with the
  // namespace field to set (`electricalCircuitId`, `plumbingZoneId`,
  // `hvacRefrigerantLoopId`, `riserTraceId`, etc.). Pass `null` for a
  // field to clear it. Pass `{}` to clear all.
  setSelection(partial) {
    set(s => ({ selection: { ...s.selection, ...partial } }))
  },

  // Select a single opening within its parent wall. Pass (null, null) to clear.
  // Clears every other entity selection so panels remain mutually exclusive.
  selectOpening(wallId, openingId) {
    if (!wallId || !openingId) {
      set({ selectedOpening: null })
      return
    }
    set({
      selectedOpening: { wallId, openingId },
      selectedWallId: null,
      selectedWallIds: [],
      selectedStampId: null,
      selectedRoomId: null,
      selectedColumnId: null,
      selectedFoundationId: null,
      selectedBeamId: null,
      draftOpening: null,
    })
  },

  toggleWallMultiSelect(wallId) {
    set(s => {
      const already = s.selectedWallIds.includes(wallId)
      return {
        selectedWallIds: already ? s.selectedWallIds.filter(id => id !== wallId) : [...s.selectedWallIds, wallId],
        selectedWallId:  null,
        selectedStampId: null,
        draftOpening:    null,
      }
    })
  },

  setBulkWallProp(wallIds, prop, value) {
    get()._save()
    set(s => {
      const walls = { ...s.walls }
      wallIds.forEach(id => { if (walls[id]) walls[id] = { ...walls[id], [prop]: value } })
      return { walls }
    })
  },

  setDrawStart(nodeId) { set({ drawStartId: nodeId }) },

  // x, y are world inches.
  //
  // Floor-aware (Phase 1.7+): cross-floor splits are rejected unless the
  // caller passes { force: true } (importers / clone tools). Rejections
  // emit a validation event so the BOQ panel footer / verification surface
  // them — no console.warn anywhere. The midpoint node inherits floorIds
  // from the wall being split (wall.floorId wrapped in an array), so
  // forced cross-floor splits still produce consistent topology.
  // Phase W — splitWall delegates propagation to wallSplit.js
  // (central pure planner). Failures return { error: <reason> }; the
  // store applies the plan inside one history frame.
  //
  // Refusal reasons:
  //   - 'wall-not-found' / 'wall-endpoints-missing' / 'invalid-offset'
  //   - 'split-too-close-to-endpoint' (within SNAP_IN of n1 or n2)
  //   - 'opening-straddles-split' (an opening's range overlaps split)
  //   - 'junction-near-split' (existing T-junction within SNAP_IN)
  //   - 'cross-floor-split-blocked' (opts.force overrides)
  //
  // On success returns { newNodeId, w1Id, w2Id, splitOffsetIn }.
  splitWall(wallId, x, y, opts = {}) {
    const state = get()
    const wall = state.walls?.[wallId]
    if (!wall) return { error: 'wall-not-found' }

    const wallFloorId = wall.floorId ?? DEFAULT_FLOOR_ID
    const cur = state.currentFloorId ?? DEFAULT_FLOOR_ID
    if (wallFloorId !== cur && !opts.force) {
      set(s => ({
        validationEvents: [
          ...(s.validationEvents ?? []),
          {
            ruleId:     'cross_floor_split_attempt',
            severity:   'warning',
            category:   'topology',
            entityType: 'wall',
            entityId:   wallId,
            message:    'splitWall called on off-floor wall',
          },
        ].slice(-100),
      }))
      return { error: 'cross-floor-split-blocked' }
    }

    const plan = planWallSplit(state, wallId, x, y)
    if (!plan.ok) return { error: plan.reason, ...plan }

    get()._save()
    const newNodeId = uid()
    const newNodeIfc = uidIfc()
    const w1Id = uid(), w2Id = uid()
    const w1Ifc = uidIfc(), w2Ifc = uidIfc()
    const newNodeFloorIds = [wallFloorId]
    const { splitWorld } = plan

    set(s => {
      // ── Walls ────────────────────────────────────────────────────────
      const newWalls = { ...s.walls }
      delete newWalls[wallId]
      // Junctions migrate: each junction node's onWallId rebases to w1Id or w2Id.
      const w1JunctionIds = plan.w1Junctions.map(j => j.nodeId)
      const w2JunctionIds = plan.w2Junctions.map(j => j.nodeId)
      newWalls[w1Id] = {
        id: w1Id, ifcGlobalId: w1Ifc, n1: wall.n1, n2: newNodeId,
        height: wall.height, thickness: wall.thickness,
        materialKey: wall.materialKey ?? 'IS_MODULAR_BRICK',
        isPlot: wall.isPlot, isVirtual: wall.isVirtual,
        openings: plan.w1Openings,
        hasPlinthBeam: wall.hasPlinthBeam ?? null,
        hasLintelBeam: wall.hasLintelBeam ?? null,
        hasRoofBeam:   wall.hasRoofBeam ?? null,
        floorId: wallFloorId,
        classification: wall.classification ?? null,
        meta: wall.meta ?? null,
        junctions: w1JunctionIds,
        splitOrigin: 'USER_SPLIT',
      }
      newWalls[w2Id] = {
        id: w2Id, ifcGlobalId: w2Ifc, n1: newNodeId, n2: wall.n2,
        height: wall.height, thickness: wall.thickness,
        materialKey: wall.materialKey ?? 'IS_MODULAR_BRICK',
        isPlot: wall.isPlot, isVirtual: wall.isVirtual,
        openings: plan.w2Openings,
        hasPlinthBeam: wall.hasPlinthBeam ?? null,
        hasLintelBeam: wall.hasLintelBeam ?? null,
        hasRoofBeam:   wall.hasRoofBeam ?? null,
        floorId: wallFloorId,
        classification: wall.classification ?? null,
        meta: wall.meta ?? null,
        junctions: w2JunctionIds,
        splitOrigin: 'USER_SPLIT',
      }

      // ── Nodes ────────────────────────────────────────────────────────
      const newNodes = {
        ...s.nodes,
        [newNodeId]: {
          id: newNodeId, ifcGlobalId: newNodeIfc,
          x: splitWorld.x, y: splitWorld.y,
          floorIds: newNodeFloorIds,
          kind: 'CORNER', onWallId: null,
        },
      }
      // Migrate TJUNCTION nodes' onWallId from wallId to the new sub-walls.
      for (const j of plan.w1Junctions) {
        const node = newNodes[j.nodeId]
        if (node) newNodes[j.nodeId] = { ...node, onWallId: w1Id }
      }
      for (const j of plan.w2Junctions) {
        const node = newNodes[j.nodeId]
        if (node) newNodes[j.nodeId] = { ...node, onWallId: w2Id }
      }

      // ── Rooms ────────────────────────────────────────────────────────
      const newRooms = {}
      for (const r of Object.values(s.rooms)) {
        if (!plan.roomsAffected.includes(r.id)) {
          newRooms[r.id] = r
          continue
        }
        const idx = r.wallIds.indexOf(wallId)
        const newWallIds = idx === -1
          ? r.wallIds
          : [...r.wallIds.slice(0, idx), w1Id, w2Id, ...r.wallIds.slice(idx + 1)]
        // Dedup defensive — rare but possible if room.wallIds already
        // referenced one of the new id slots somehow.
        const uniqWallIds = Array.from(new Set(newWallIds))
        newRooms[r.id] = { ...r, wallIds: uniqWallIds }
      }

      // ── Foundations ──────────────────────────────────────────────────
      const newFoundations = {}
      for (const f of Object.values(s.foundations ?? {})) {
        if (!plan.foundationsAffected.includes(f.id)) {
          newFoundations[f.id] = f
          continue
        }
        const idx = (f.wallIds ?? []).indexOf(wallId)
        const newFWalls = idx === -1
          ? (f.wallIds ?? [])
          : [...f.wallIds.slice(0, idx), w1Id, w2Id, ...f.wallIds.slice(idx + 1)]
        const uniqFWalls = Array.from(new Set(newFWalls))
        newFoundations[f.id] = { ...f, wallIds: uniqFWalls }
      }

      // ── MEP fixtures (5 disciplines) ─────────────────────────────────
      function applyMepPartition(collection, partition, sideId) {
        const next = { ...collection }
        for (const entry of partition) {
          const f = next[entry.fixtureId]
          if (!f) continue
          next[entry.fixtureId] = { ...f, wallId: sideId, wallT: entry.newWallT }
        }
        return next
      }
      const newPlumbing = applyMepPartition(applyMepPartition(
        s.plumbingFixtures ?? {}, plan.mep.plumbingFixtures.w1, w1Id),
        plan.mep.plumbingFixtures.w2, w2Id)
      const newElectrical = applyMepPartition(applyMepPartition(
        s.electricalPoints ?? {}, plan.mep.electricalPoints.w1, w1Id),
        plan.mep.electricalPoints.w2, w2Id)
      const newHvac = applyMepPartition(applyMepPartition(
        s.hvacUnits ?? {}, plan.mep.hvacUnits.w1, w1Id),
        plan.mep.hvacUnits.w2, w2Id)
      const newFire = applyMepPartition(applyMepPartition(
        s.fireDevices ?? {}, plan.mep.fireDevices.w1, w1Id),
        plan.mep.fireDevices.w2, w2Id)
      const newElv = applyMepPartition(applyMepPartition(
        s.elvDevices ?? {}, plan.mep.elvDevices.w1, w1Id),
        plan.mep.elvDevices.w2, w2Id)

      return {
        nodes:            newNodes,
        walls:            newWalls,
        rooms:            newRooms,
        foundations:      newFoundations,
        plumbingFixtures: newPlumbing,
        electricalPoints: newElectrical,
        hvacUnits:        newHvac,
        fireDevices:      newFire,
        elvDevices:       newElv,
      }
    })

    // Refresh nodeOrder for every affected room (recomputation uses
    // the post-update state's expanded graph).
    if (plan.roomsAffected.length > 0) {
      set(s => {
        const refreshedRooms = { ...s.rooms }
        for (const rid of plan.roomsAffected) {
          if (!refreshedRooms[rid]) continue
          const order = recomputeRoomNodeOrder(s, rid)
          refreshedRooms[rid] = { ...refreshedRooms[rid], nodeOrder: order }
        }
        return { rooms: refreshedRooms }
      })
    }

    return { newNodeId, w1Id, w2Id, splitOffsetIn: plan.splitOffsetIn }
  },

  // Phase W — Manual Join tool. Inverse of explicit Split.
  //
  // joinWalls(w1Id, w2Id) gates via canMergeWalls; on success, the
  // lex-smaller id survives, retains its ifcGlobalId, absorbs the
  // partner's geometry / openings / junctions / MEP references /
  // foundation references / room references. Surviving splitOrigin
  // reverts to 'NONE' (merged wall is no longer split-derived).
  //
  // Returns:
  //   { survivorId, removedId, wasSplit, sharedNodeId } on success
  //   { error: <reason> } on refusal — see canMergeWalls reasons
  joinWalls(w1Id, w2Id) {
    const gate = canMergeWalls(get(), w1Id, w2Id)
    if (!gate.ok) return { error: gate.reason }

    const state = get()
    const wA = state.walls[w1Id]
    const wB = state.walls[w2Id]
    const sharedNodeId = gate.sharedNodeId

    // Survivor: lex-smaller id.
    const survivorId = w1Id < w2Id ? w1Id : w2Id
    const removedId  = w1Id < w2Id ? w2Id : w1Id
    const survivor   = state.walls[survivorId]
    const removed    = state.walls[removedId]
    const wasSplit   = survivor.splitOrigin === 'USER_SPLIT'
                    && removed.splitOrigin  === 'USER_SPLIT'

    // Determine survivor's new endpoints.
    // Survivor keeps its non-shared endpoint; takes partner's non-shared endpoint.
    const survivorNonSharedEnd =
      survivor.n1 === sharedNodeId ? survivor.n2 : survivor.n1
    const removedNonSharedEnd =
      removed.n1  === sharedNodeId ? removed.n2  : removed.n1

    // For opening offset rebase: openings on the partner need their
    // offsets shifted by survivor's old length (if survivor sits
    // "before" the partner along the merged centerline).
    const sN1 = state.nodes[survivor.n1]
    const sN2 = state.nodes[survivor.n2]
    const survivorLenIn = Math.hypot(sN2.x - sN1.x, sN2.y - sN1.y)
    const survivorSharedIsN2 = (survivor.n2 === sharedNodeId)

    // Rebased survivor endpoints (in canonical n1 → n2 direction
    // matching the original survivor's direction). If sharedNodeId was
    // survivor's n2, the merged wall extends from survivor.n1 to
    // removedNonSharedEnd. Otherwise from removedNonSharedEnd to
    // survivor.n2 (we flip to keep n1 < n2 in a deterministic sense).
    // Simpler: keep survivor.n1 as the new n1; the new n2 is either
    // survivor.n2 (if shared was n1) or removed's non-shared endpoint.
    let newN1, newN2
    if (survivorSharedIsN2) {
      // survivor: A → shared, partner: shared → B → merged A → B.
      newN1 = survivor.n1
      newN2 = removedNonSharedEnd
    } else {
      // shared was survivor's n1. partner: B → shared. merged B → survivor.n2.
      newN1 = removedNonSharedEnd
      newN2 = survivor.n2
    }

    // Opening rebase: openings stored with offset from n1.
    // After merge, openings on the "before-survivor" side (the side
    // that becomes the n1 portion of merged) need offset preserved or
    // mirrored depending on which wall's openings.
    // Cleanest: compute each opening's WORLD-coord position, then
    // recompute offset from new n1.
    //
    // For practical purposes since merged.n1 is one of (survivor.n1,
    // removedNonSharedEnd), the survivor-openings' offsets either
    // stay (if newN1 === survivor.n1) or shift to (survivorLenIn -
    // (offset + width)) + removedLenIn... complicated.
    //
    // Use the WORLD-position approach:
    const newN1Node = state.nodes[newN1]
    const newN2Node = state.nodes[newN2]
    const newDx = newN2Node.x - newN1Node.x
    const newDy = newN2Node.y - newN1Node.y
    const newLen2 = newDx * newDx + newDy * newDy
    const newLenIn = Math.sqrt(newLen2)

    function _rebaseOpening(op, origWall) {
      // Compute opening's start point in world coords using origWall n1.
      const oN1 = state.nodes[origWall.n1]
      const oN2 = state.nodes[origWall.n2]
      const oDx = oN2.x - oN1.x, oDy = oN2.y - oN1.y
      const oLen = Math.hypot(oDx, oDy)
      if (oLen === 0) return op
      const ux = oDx / oLen, uy = oDy / oLen
      const startX = oN1.x + ux * (op.offset ?? 0)
      const startY = oN1.y + uy * (op.offset ?? 0)
      // Project startX/Y onto new wall (newN1 → newN2).
      const newOffsetIn =
        ((startX - newN1Node.x) * newDx + (startY - newN1Node.y) * newDy) / newLenIn
      return { ...op, offset: Math.max(0, Math.min(newLenIn, newOffsetIn)) }
    }

    const mergedOpenings = [
      ...(survivor.openings ?? []).map(op => _rebaseOpening(op, survivor)),
      ...(removed.openings  ?? []).map(op => _rebaseOpening(op, removed)),
    ]

    // Merge junctions: concatenate the two lists. Each junction's
    // onWallId rebases to survivorId.
    const mergedJunctionIds = [
      ...(survivor.junctions ?? []),
      ...(removed.junctions  ?? []),
    ]

    get()._save()
    set(s => {
      // ── Walls ──
      const newWalls = { ...s.walls }
      delete newWalls[removedId]
      newWalls[survivorId] = {
        ...survivor,
        n1: newN1,
        n2: newN2,
        openings:    mergedOpenings,
        junctions:   mergedJunctionIds,
        splitOrigin: 'NONE',   // no longer split-derived after re-join
      }

      // ── Nodes ──
      const newNodes = { ...s.nodes }
      // Update junction nodes' onWallId.
      for (const jId of mergedJunctionIds) {
        if (newNodes[jId]) {
          newNodes[jId] = { ...newNodes[jId], onWallId: survivorId }
        }
      }
      // Delete the formerly-shared node if its degree (in the new wall set)
      // is 0. Shared was an endpoint of two walls; after merge it's no
      // longer either n1/n2 of any wall and is not in anyone's junctions[].
      // A defensive check before deleting:
      let stillReferenced = false
      for (const w of Object.values(newWalls)) {
        if (w.n1 === sharedNodeId || w.n2 === sharedNodeId) {
          stillReferenced = true; break
        }
        if ((w.junctions ?? []).includes(sharedNodeId)) {
          stillReferenced = true; break
        }
      }
      if (!stillReferenced) {
        delete newNodes[sharedNodeId]
      }

      // ── Rooms ──
      const newRooms = {}
      for (const r of Object.values(s.rooms)) {
        const wallIds = r.wallIds ?? []
        if (!wallIds.includes(removedId)) {
          // Survivor reference may still exist; keep room as-is.
          newRooms[r.id] = r
          continue
        }
        // Replace removed with survivor; dedupe (survivor may already exist).
        const replaced = wallIds.map(id => id === removedId ? survivorId : id)
        const uniq = Array.from(new Set(replaced))
        newRooms[r.id] = { ...r, wallIds: uniq }
      }

      // ── Foundations ──
      const newFoundations = {}
      for (const f of Object.values(s.foundations ?? {})) {
        const fwids = f.wallIds ?? []
        if (!fwids.includes(removedId)) {
          newFoundations[f.id] = f
          continue
        }
        const replaced = fwids.map(id => id === removedId ? survivorId : id)
        const uniq = Array.from(new Set(replaced))
        newFoundations[f.id] = { ...f, wallIds: uniq }
      }

      // ── MEP fixtures (5 disciplines) ──
      // Any fixture referencing removedId moves to survivorId; wallT
      // rebases via world-position recomputation.
      function _rebaseMep(collection, origWallId) {
        const next = { ...collection }
        for (const f of Object.values(collection)) {
          if (f.wallId !== origWallId) continue
          // Compute world position via original wall.
          const origWall = origWallId === survivorId ? survivor : removed
          const oN1 = state.nodes[origWall.n1]
          const oN2 = state.nodes[origWall.n2]
          const oDx = oN2.x - oN1.x, oDy = oN2.y - oN1.y
          const oLen = Math.hypot(oDx, oDy)
          if (oLen === 0) continue
          const ux = oDx / oLen, uy = oDy / oLen
          const fx = oN1.x + ux * oLen * (f.wallT ?? 0)
          const fy = oN1.y + uy * oLen * (f.wallT ?? 0)
          // Project onto new wall.
          const newT = newLenIn > 0
            ? ((fx - newN1Node.x) * newDx + (fy - newN1Node.y) * newDy) / newLen2
            : 0
          next[f.id] = {
            ...f, wallId: survivorId,
            wallT: Math.max(0, Math.min(1, newT)),
          }
        }
        return next
      }
      const newPlumbing = _rebaseMep(_rebaseMep(s.plumbingFixtures ?? {}, survivorId), removedId)
      const newElectrical = _rebaseMep(_rebaseMep(s.electricalPoints ?? {}, survivorId), removedId)
      const newHvac = _rebaseMep(_rebaseMep(s.hvacUnits ?? {}, survivorId), removedId)
      const newFire = _rebaseMep(_rebaseMep(s.fireDevices ?? {}, survivorId), removedId)
      const newElv = _rebaseMep(_rebaseMep(s.elvDevices ?? {}, survivorId), removedId)

      return {
        nodes:            newNodes,
        walls:            newWalls,
        rooms:            newRooms,
        foundations:      newFoundations,
        plumbingFixtures: newPlumbing,
        electricalPoints: newElectrical,
        hvacUnits:        newHvac,
        fireDevices:      newFire,
        elvDevices:       newElv,
      }
    })

    // Refresh nodeOrder for every affected room.
    set(s => {
      const refreshedRooms = { ...s.rooms }
      for (const r of Object.values(s.rooms)) {
        if (!(r.wallIds ?? []).includes(survivorId)) continue
        const order = recomputeRoomNodeOrder(s, r.id)
        refreshedRooms[r.id] = { ...r, nodeOrder: order }
      }
      return { rooms: refreshedRooms }
    })

    return { survivorId, removedId, wasSplit, sharedNodeId }
  },

  togglePendingWall(wallId) {
    set(s => {
      const already = s.pendingWallIds.includes(wallId)
      return { pendingWallIds: already ? s.pendingWallIds.filter(id => id !== wallId) : [...s.pendingWallIds, wallId] }
    })
  },

  // ── Openings — offset/width/height stored in inches ───────────────────

  addOpening(wallId, { offset, width, height, type = 'door', orient = 0 }) {
    get()._save()
    const { id, ifcGlobalId } = newEntityIds()
    set(s => {
      const wall = s.walls[wallId]
      if (!wall) return {}
      const sunshadeOn = s.projectSettings?.sunshadeSettings?.enabled ?? true
      const hasSunshade = type === 'window' ? sunshadeOn : false
      // Rev 2 — subtype derivation. Size-based default; for doors, promote to
      // MAIN_DOOR when the wall is external AND this floor has no MAIN_DOOR
      // yet (lazy check against the current state). subtypeSource records
      // whether the value came from the heuristic vs an explicit user pick.
      const seed = { id, ifcGlobalId, offset, width, height, type, orient, hasSunshade }
      let subtype = _deriveSubtypeBySize(seed)
      if (type === 'door') {
        const adjCount = s.getWallAdjacencyCount?.() ?? {}
        const isExternal = (adjCount[wallId] ?? 0) === 1 && !wall.isPlot && !wall.isVirtual
        if (isExternal) {
          const floorId = wall.floorId ?? DEFAULT_FLOOR_ID
          let alreadyHasMain = false
          outer: for (const w of Object.values(s.walls)) {
            if ((w.floorId ?? DEFAULT_FLOOR_ID) !== floorId) continue
            for (const o of (w.openings ?? [])) {
              if (o.subtype === OPENING_SUBTYPE.MAIN_DOOR) { alreadyHasMain = true; break outer }
            }
          }
          if (!alreadyHasMain) subtype = OPENING_SUBTYPE.MAIN_DOOR
        }
      }
      const opening = { ...seed, subtype, subtypeSource: SUBTYPE_SOURCE.HEURISTIC, hasGrill: null }
      return { walls: { ...s.walls, [wallId]: { ...wall, openings: [...(wall.openings || []), opening] } } }
    })
  },

  // Rev 2 — explicit per-opening subtype assignment (panel-driven).
  setOpeningSubtype(wallId, openingId, subtype) {
    get()._save()
    set(s => {
      const wall = s.walls[wallId]
      if (!wall) return {}
      return {
        walls: { ...s.walls, [wallId]: {
          ...wall,
          openings: (wall.openings || []).map(o =>
            o.id === openingId
              ? { ...o, subtype, subtypeSource: SUBTYPE_SOURCE.EXPLICIT }
              : o
          ),
        } },
      }
    })
  },

  // Rev 2 — explicit per-opening grill override. null = inherit project
  // setting (projectSettings.grills.windowGrillEnabled / mainDoorSafetyGrillEnabled).
  setOpeningGrill(wallId, openingId, hasGrill) {
    get()._save()
    set(s => {
      const wall = s.walls[wallId]
      if (!wall) return {}
      return {
        walls: { ...s.walls, [wallId]: {
          ...wall,
          openings: (wall.openings || []).map(o =>
            o.id === openingId ? { ...o, hasGrill } : o
          ),
        } },
      }
    })
  },

  setOpeningOrient(wallId, openingId, orient) {
    set(s => {
      const wall = s.walls[wallId]
      if (!wall) return {}
      return {
        walls: { ...s.walls, [wallId]: {
          ...wall,
          openings: wall.openings.map(o => o.id === openingId ? { ...o, orient } : o),
        }},
      }
    })
  },

  removeOpening(wallId, openingId) {
    get()._save()
    set(s => {
      const wall = s.walls[wallId]
      if (!wall) return {}
      const wasSelected =
        s.selectedOpening?.wallId === wallId &&
        s.selectedOpening?.openingId === openingId
      return {
        walls: { ...s.walls, [wallId]: { ...wall, openings: wall.openings.filter(o => o.id !== openingId) } },
        ...(wasSelected ? { selectedOpening: null } : {}),
      }
    })
  },

  // Partial update on one opening within its parent wall's openings[] array.
  // When `fields.type` flips, normalize role-specific fields so the opening
  // keeps a clean shape:
  //   door → window: hasSunshade=false, orient cleared
  //   window → door: orient=0,         hasSunshade cleared
  // Clamps width/offset to (wallLengthIn - offset) and (wallLengthIn - width)
  // respectively. Height clamped to [12in, 144in].
  updateOpening(wallId, openingId, fields) {
    get()._save()
    set(s => {
      const wall = s.walls[wallId]
      if (!wall) return {}
      const current = (wall.openings || []).find(o => o.id === openingId)
      if (!current) return {}
      // Wall length in inches for clamping.
      const n1 = s.nodes[wall.n1], n2 = s.nodes[wall.n2]
      const wallLenIn = (n1 && n2) ? Math.hypot(n2.x - n1.x, n2.y - n1.y) : 0
      let next = { ...current, ...fields }
      // Type-swap normalization
      if (fields.type && fields.type !== current.type) {
        if (fields.type === 'window') {
          next.hasSunshade = next.hasSunshade ?? (s.projectSettings?.sunshadeSettings?.enabled ?? true)
          next.orient = 0
        } else {
          next.hasSunshade = false
          next.orient = next.orient ?? 0
        }
        // Rev 2 — subtype must follow the parent type when it swaps.
        // Reset to heuristic default for the new type; clear EXPLICIT flag.
        next.subtype       = _deriveSubtypeBySize(next)
        next.subtypeSource = SUBTYPE_SOURCE.HEURISTIC
      }
      // Clamp dimensions
      if (typeof next.width === 'number')  next.width  = Math.max(12, Math.min(next.width,  Math.max(12, wallLenIn - (next.offset ?? 0))))
      if (typeof next.height === 'number') next.height = Math.max(12, Math.min(next.height, 144))
      if (typeof next.offset === 'number') next.offset = Math.max(0,  Math.min(next.offset, Math.max(0, wallLenIn - (next.width ?? 0))))
      return {
        walls: { ...s.walls, [wallId]: {
          ...wall,
          openings: (wall.openings || []).map(o => o.id === openingId ? next : o),
        } },
      }
    })
  },

  // heightIn is in inches
  setWallHeight(wallId, heightIn) {
    get()._save()
    const h = Math.max(1, Number(heightIn) || DEFAULT_WALL_HEIGHT_IN)
    set(s => {
      const wall = s.walls[wallId]
      if (!wall) return {}
      return { walls: { ...s.walls, [wallId]: { ...wall, height: h } } }
    })
  },

  // thicknessIn is in inches
  setWallThickness(wallId, thicknessIn) {
    get()._save()
    const t = Math.max(0.5, Number(thicknessIn) || DEFAULT_WALL_THICK_IN)
    set(s => {
      const wall = s.walls[wallId]
      if (!wall) return {}
      return { walls: { ...s.walls, [wallId]: { ...wall, thickness: t } } }
    })
  },

  setWallMaterial(wallId, key) {
    get()._save()
    set(s => {
      const wall = s.walls[wallId]
      if (!wall || !MATERIAL_LIBRARY[key]) return {}
      return { walls: { ...s.walls, [wallId]: { ...wall, materialKey: key } } }
    })
  },

  setWallIsPlot(wallId, value) {
    get()._save()
    set(s => {
      const wall = s.walls[wallId]
      if (!wall) return {}
      return { walls: { ...s.walls, [wallId]: { ...wall, isPlot: Boolean(value) } } }
    })
  },

  setWallIsVirtual(wallId, value) {
    get()._save()
    set(s => {
      const wall = s.walls[wallId]
      if (!wall) return {}
      return { walls: { ...s.walls, [wallId]: { ...wall, isVirtual: Boolean(value) } } }
    })
  },

  // ── Stamps — x/y/w/h stored in inches ────────────────────────────────

  addStamp(type, x, y) {
    get()._save()
    const { id, ifcGlobalId } = newEntityIds()
    // Staircase companion is a distinct entity that happens to share the
    // stamp.id (Arch 6 — separate IFC GUID even though id is reused).
    const staircaseIfc = type === 'stairs' ? uidIfc() : null
    const floorId = get().currentFloorId ?? DEFAULT_FLOOR_ID
    // w, h = footprint dimensions (plan view, inches)
    // depth = vertical depth (civil stamps only — undefined for stairs/lift)
    const defaults = {
      stairs:        { w: 48, h: 96 },
      lift:          { w: 60, h: 60 },
      sump:          { w: 72, h: 60, depth: 72,  name: 'Sump' },
      overhead_tank: { w: 60, h: 60, depth: 48,  name: 'OHT' },
      septic_tank:   { w: 96, h: 72, depth: 60,  name: 'Septic Tank' },
    }[type] || { w: 48, h: 48 }
    set(s => {
      const nextState = {
        stamps: { ...s.stamps, [id]: { id, ifcGlobalId, type, x: x - defaults.w / 2, y: y - defaults.h / 2, ...defaults, floorId, meta: null } },
      }
      if (type === 'stairs') {
        const sd = s.projectSettings?.staircaseDefaults ?? DEFAULT_PROJECT_SETTINGS.staircaseDefaults
        nextState.staircases = {
          ...s.staircases,
          [id]: {
            id,
            ifcGlobalId: staircaseIfc,
            type: sd.type,
            flightCount: 2, stepsPerFlight: 7,
            treadIn: sd.treadIn, riserIn: sd.riserIn, waistSlabIn: sd.waistSlabIn,
            landingFtWidth: sd.landingFtWidth, landingFtLength: sd.landingFtLength,
            flightWidthFt: sd.flightWidthFt,
            grade: 'M20',
            floorId,              // floor the staircase sits ON (single-floor today)
            fromFloorId: floorId, // Phase 1.9 will set this to floor below
            toFloorId: floorId,   // Phase 1.9 will set this to floor above
            meta: null,
          },
        }
      }
      return nextState
    })
  },

  deleteStamp(stampId) {
    get()._save()
    set(s => {
      const stamps = { ...s.stamps }
      const stampType = stamps[stampId]?.type
      delete stamps[stampId]
      const nextState = { stamps, selectedStampId: null }
      if (stampType === 'stairs') {
        const staircases = { ...s.staircases }
        delete staircases[stampId]
        nextState.staircases = staircases
      }
      return nextState
    })
  },

  moveStamp(stampId, x, y) {
    set(s => {
      const stamp = s.stamps[stampId]
      if (!stamp) return {}
      return { stamps: { ...s.stamps, [stampId]: { ...stamp, x, y } } }
    })
  },

  // wFt/hFt in feet — stored as inches
  resizeStamp(stampId, wFt, hFt) {
    const wIn = Math.max(GRID_IN, wFt * GRID_IN)
    const hIn = Math.max(GRID_IN, hFt * GRID_IN)
    set(s => {
      const stamp = s.stamps[stampId]
      if (!stamp) return {}
      return { stamps: { ...s.stamps, [stampId]: { ...stamp, w: wIn, h: hIn } } }
    })
  },

  // Generic partial update for civil stamps — no undo history by design,
  // matches the resizeStamp pattern used for stairs/lift
  updateStamp(stampId, fields) {
    set(s => {
      const stamp = s.stamps[stampId]
      if (!stamp) return {}
      return { stamps: { ...s.stamps, [stampId]: { ...stamp, ...fields } } }
    })
  },

  selectStamp(stampId) { set({ selectedStampId: stampId, selectedWallId: null, selectedBeamId: null, selectedOpening: null }) },

  // ── Rooms ─────────────────────────────────────────────────────────────

  saveRoom(name, type = 'OTHER') {
    const { pendingWallIds, rooms, walls, nodes } = get()
    if (!pendingWallIds.length) return null

    // Overlap check — runs before _save() so history is not polluted by a blocked save.
    // Only checks rooms that are fully valid (isRoomValid = structural + no overlap).
    // Invalid existing rooms are not a reference for blocking new saves.
    //
    // Floor scope: rooms on different floors NEVER conflict — a G+1 building
    // typically has identical or overlapping footprints across floors. Only
    // compare against rooms on the floor where the new room is being saved.
    const candidateFloorId = get().currentFloorId ?? DEFAULT_FLOOR_ID
    // Phase W — use expanded-graph nodeOrder walk so T-junction segments
    // appear as polygon vertices when applicable. Falls back gracefully
    // for legacy/simple rooms (no T-junctions on touched walls).
    const dedupedPendingIds = Array.from(new Set(pendingWallIds))
    let nodeOrder = computeNodeOrderForWallIds(get(), dedupedPendingIds, candidateFloorId)
    // For rooms drawn via the legacy room-tool flow (togglePendingWall),
    // the wallIds may include duplicates and may not form a single closed
    // chain in the expanded graph. Fall back to the old walkPolygon helper
    // when the expanded walk returns empty — preserves legacy behavior.
    if (!nodeOrder || nodeOrder.length === 0) {
      nodeOrder = walkPolygon(pendingWallIds, walls)
    }
    if (nodeOrder) {
      const candidatePoly = nodeOrder.map(id => nodes[id]).filter(Boolean)
      if (candidatePoly.length >= 3) {
        for (const room of Object.values(rooms)) {
          if ((room.floorId ?? DEFAULT_FLOOR_ID) !== candidateFloorId) continue
          if (!get().isRoomValid(room.id)) continue
          const existingPoly = get().getRoomPolygon(room.id)
          if (doRoomsOverlap(candidatePoly, existingPoly)) {
            return { error: 'overlap', conflictName: room.name }
          }
        }
      }
    }

    get()._save()
    const { id, ifcGlobalId } = newEntityIds()
    const safeType = ROOM_PRESETS[type] ? type : 'OTHER'
    const floorId  = get().currentFloorId ?? DEFAULT_FLOOR_ID
    // Phase W — stamp room.nodeOrder at create time. The authoritative
    // source is recomputeRoomNodeOrder (runtime); this is the cache.
    // For initial create, walkPolygon(pendingWallIds) produces the
    // closed sequence — but we deduplicate parent wallIds first since
    // the new model has room.wallIds as semantic-membership only.
    const dedupedWallIds = Array.from(new Set([...get().pendingWallIds]))
    const initialNodeOrder = nodeOrder ?? []
    set(s => ({
      rooms: {
        ...s.rooms,
        [id]: {
          id,
          ifcGlobalId,
          name,
          wallIds:          dedupedWallIds,
          nodeOrder:        [...initialNodeOrder],
          type:             safeType,
          customType:       null,
          finishes:         getPresetFinishes(safeType),
          plasterSystemId:  null,   // null = use projectSettings.defaultPlasterSystemId
          floorId,
          classification:   null,
          meta:             null,
        },
      },
      pendingWallIds: [],
    }))
    return null
  },

  setRoomPlasterSystem(roomId, plasterSystemId) {
    get()._save()
    set(s => {
      const room = s.rooms[roomId]
      if (!room) return {}
      return { rooms: { ...s.rooms, [roomId]: { ...room, plasterSystemId: plasterSystemId || null } } }
    })
  },

  setRoomType(roomId, type) {
    get()._save()
    const safeType = ROOM_PRESETS[type] ? type : 'OTHER'
    set(s => {
      const room = s.rooms[roomId]
      if (!room) return {}
      return {
        rooms: {
          ...s.rooms,
          [roomId]: { ...room, type: safeType, finishes: getPresetFinishes(safeType) },
        },
      }
    })
  },

  setRoomFinishes(roomId, partialFinishes) {
    get()._save()
    set(s => {
      const room = s.rooms[roomId]
      if (!room) return {}
      return {
        rooms: {
          ...s.rooms,
          [roomId]: { ...room, finishes: { ...room.finishes, ...partialFinishes } },
        },
      }
    })
  },

  // Rev 2 — per-room dado override. null = inherit project setting
  // (projectSettings.tileDefaults.dadoHeightsFt[room.type]).
  setRoomDado(roomId, dadoHeightFt) {
    get()._save()
    set(s => {
      const room = s.rooms[roomId]
      if (!room) return {}
      return { rooms: { ...s.rooms, [roomId]: { ...room, dadoHeightFt } } }
    })
  },

  // 2026-05-26 — per-room skirting include override. null = derive from
  // project rule (room.type ∈ skirtingApplyToTypes AND dado===0 AND
  // finishes.flooring); true = force include; false = force exclude.
  setRoomIncludeSkirting(roomId, includeSkirting) {
    get()._save()
    set(s => {
      const room = s.rooms[roomId]
      if (!room) return {}
      return { rooms: { ...s.rooms, [roomId]: { ...room, includeSkirting } } }
    })
  },

  // Rev 2 — per-room kitchen counter override. null = inherit
  // (projectSettings.kitchenCounter; lengthMode derives geometry).
  setRoomKitchenCounter(roomId, kitchenCounter) {
    get()._save()
    set(s => {
      const room = s.rooms[roomId]
      if (!room) return {}
      return { rooms: { ...s.rooms, [roomId]: { ...room, kitchenCounter } } }
    })
  },

  // Rev 2 — per-BALCONY-room handrail override.
  // Shape: { enabled: boolean | null, heightFt: number | null } | null
  // null = full inherit; { enabled: false } disables on this balcony only.
  setRoomBalconyHandrail(roomId, balconyHandrail) {
    get()._save()
    set(s => {
      const room = s.rooms[roomId]
      if (!room) return {}
      return { rooms: { ...s.rooms, [roomId]: { ...room, balconyHandrail } } }
    })
  },

  // Phase 4 Commit A — per-room paint system override.
  // null = inherit projectSettings.defaultInteriorPaintSystemId.
  setRoomPaintSystem(roomId, paintSystemId) {
    get()._save()
    set(s => {
      const room = s.rooms[roomId]
      if (!room) return {}
      return { rooms: { ...s.rooms, [roomId]: { ...room, paintSystemId: paintSystemId || null } } }
    })
  },

  // Phase 4 Commit A — per-room ceiling finish system override.
  // null = inherit projectSettings.defaultCeilingFinishSystemId.
  setRoomCeilingFinishSystem(roomId, ceilingFinishId) {
    get()._save()
    set(s => {
      const room = s.rooms[roomId]
      if (!room) return {}
      return { rooms: { ...s.rooms, [roomId]: { ...room, ceilingFinishId: ceilingFinishId || null } } }
    })
  },

  // Phase 4 Commit A — per-opening hardware override.
  // partial = { hardwareSetId?, hardwareOverrides? }
  //   hardwareSetId: string | null  — null = inherit per-subtype default
  //   hardwareOverrides: { add: [{itemId, qty}], remove: [itemId] } | null
  setOpeningHardware(wallId, openingId, partial) {
    get()._save()
    set(s => {
      const wall = s.walls[wallId]
      if (!wall) return {}
      const openings = (wall.openings ?? []).map(o =>
        o.id === openingId ? { ...o, ...partial } : o
      )
      return { walls: { ...s.walls, [wallId]: { ...wall, openings } } }
    })
  },

  renameRoom(roomId, name) {
    set(s => {
      const room = s.rooms[roomId]
      if (!room) return {}
      return { rooms: { ...s.rooms, [roomId]: { ...room, name: name.trim() || room.name } } }
    })
  },

  deleteRoom(roomId) {
    get()._save()
    set(s => {
      const rooms = { ...s.rooms }
      delete rooms[roomId]
      return { rooms }
    })
  },

  cancelAction() {
    set({ drawStartId: null, pendingWallIds: [], selectedWallId: null, selectedWallIds: [], selectedStampId: null, selectedRoomId: null, draftOpening: null })
  },

  loadProject(data) {
    // ── Normalize nodes: floor-aware topology requires every node to carry
    // floorIds: string[] (length 1 today; future-proofed for vertical shafts
    // / staircase cores / DXF-imported multi-floor anchors).
    //
    // Greenfield rule: no migration / no inference from referencing walls.
    // Nodes lacking floorIds simply default to ['F1']. Saves from this
    // version onward carry floorIds verbatim.
    const migratedNodes = {}
    for (const [id, node] of Object.entries(data.nodes || {})) {
      const floorIds = Array.isArray(node.floorIds) && node.floorIds.length > 0
        ? node.floorIds
        : [DEFAULT_FLOOR_ID]
      migratedNodes[id] = { ...node, floorIds, ifcGlobalId: node.ifcGlobalId ?? uidIfc() }
    }

    // Migrate rooms: add type/finishes if missing, validate type against known presets
    const migratedRooms = {}
    for (const [id, room] of Object.entries(data.rooms || {})) {
      const safeType = ROOM_PRESETS[room.type] ? room.type : 'OTHER'
      migratedRooms[id] = {
        customType:       null,
        plasterSystemId:  null,   // null = inherit projectSettings.defaultPlasterSystemId
        ...room,
        type:             safeType,    // safeType always wins — validated against ROOM_PRESETS
        finishes:         room.finishes
          ? { ...ALL_FINISHES, ...room.finishes }   // fill any missing flag keys
          : getPresetFinishes(safeType),             // v1/v2 rooms: use type preset (OTHER=ALL_FINISHES)
        ifcGlobalId:      room.ifcGlobalId ?? uidIfc(),
      }
    }
    if (import.meta.env?.DEV) {
      const loadedWalls = data.walls || {}
      const wallRoomCount = {}
      for (const room of Object.values(migratedRooms)) {
        const missing = room.wallIds.filter(wid => !loadedWalls[wid])
        if (missing.length)
          console.warn(`[topology] Room "${room.name}" has missing wallIds:`, missing)
        for (const wid of room.wallIds)
          wallRoomCount[wid] = (wallRoomCount[wid] || 0) + 1
      }
      for (const [wid, count] of Object.entries(wallRoomCount)) {
        if (count > 2)
          console.warn(`[topology] Wall ${wid} referenced by ${count} rooms (expected ≤2)`)
      }
      for (const room of Object.values(migratedRooms)) {
        if (room.wallIds.length >= 3 && walkPolygon(room.wallIds, loadedWalls) === null)
          console.warn(`[topology] Room "${room.name}" walls don't form a closed loop`)
      }

      // Pairwise overlap check — uses only structurally valid rooms as comparison targets.
      // Same-floor only: identical footprints across floors are valid by design.
      const structuralRooms = Object.values(migratedRooms).filter(r =>
        r.wallIds.length >= 3 && walkPolygon(r.wallIds, loadedWalls) !== null
      )
      for (let i = 0; i < structuralRooms.length; i++) {
        for (let j = i + 1; j < structuralRooms.length; j++) {
          const rA = structuralRooms[i], rB = structuralRooms[j]
          if ((rA.floorId ?? DEFAULT_FLOOR_ID) !== (rB.floorId ?? DEFAULT_FLOOR_ID)) continue
          const pA = walkPolygon(rA.wallIds, loadedWalls).map(id => (data.nodes || {})[id]).filter(Boolean)
          const pB = walkPolygon(rB.wallIds, loadedWalls).map(id => (data.nodes || {})[id]).filter(Boolean)
          if (pA.length >= 3 && pB.length >= 3 && doRoomsOverlap(pA, pB))
            console.warn(`[topology] Rooms "${rA.name}" and "${rB.name}" overlap on floor ${rA.floorId ?? DEFAULT_FLOOR_ID}`)
        }
      }
    }

    // ── Migrate walls: inject materialKey + floor/classification/meta defaults ──
    // Rev 2: inject hasBalconyRailingEdge: null (future-ready slot — no UI in
    // current iteration; programmatic via setWallBalconyRailingEdge or DXF
    // import). Inject opening.subtype + subtypeSource via size-based heuristic
    // when absent (greenfield rule — no migration script, just normalize).
    const migratedWalls = {}
    for (const [id, wall] of Object.entries(data.walls || {})) {
      const openings = (wall.openings ?? []).map(o => {
        const ifcGlobalId = o.ifcGlobalId ?? uidIfc()
        if (o.subtype && o.subtypeSource) {
          return o.ifcGlobalId ? o : { ...o, ifcGlobalId }
        }
        const subtype = o.subtype ?? _deriveSubtypeBySize(o)
        return {
          ...o,
          subtype,
          subtypeSource: o.subtypeSource ?? SUBTYPE_SOURCE.HEURISTIC,
          hasGrill:      o.hasGrill ?? null,
          ifcGlobalId,
        }
      })
      migratedWalls[id] = {
        materialKey:            'IS_MODULAR_BRICK',
        floorId:                DEFAULT_FLOOR_ID,
        classification:         null,
        meta:                   null,
        hasBalconyRailingEdge:  null,
        ...wall,
        openings,
        ifcGlobalId: wall.ifcGlobalId ?? uidIfc(),
      }
    }

    // Rooms already migrated above; add floor/classification/meta where missing.
    // Rev 2 also injects tile/counter/handrail per-room override slots
    // (null = inherit projectSettings defaults).
    for (const id of Object.keys(migratedRooms)) {
      const r = migratedRooms[id]
      if (r.floorId === undefined)         r.floorId         = DEFAULT_FLOOR_ID
      if (r.classification === undefined)  r.classification  = null
      if (r.meta === undefined)            r.meta            = null
      if (r.dadoHeightFt === undefined)    r.dadoHeightFt    = null
      if (r.kitchenCounter === undefined)  r.kitchenCounter  = null
      if (r.balconyHandrail === undefined) r.balconyHandrail = null
    }

    // ── Migrate stamps (v1/v2/v3 → v4): inject depth/name defaults for civil types ──
    const CIVIL_STAMP_DEFAULTS = {
      sump:          { depth: 72,  name: 'Sump' },
      overhead_tank: { depth: 48,  name: 'OHT' },
      septic_tank:   { depth: 60,  name: 'Septic Tank' },
    }
    const migratedStamps = {}
    for (const [id, stamp] of Object.entries(data.stamps || {})) {
      const civilDefaults = CIVIL_STAMP_DEFAULTS[stamp.type]
      const base = { floorId: DEFAULT_FLOOR_ID, meta: null }
      const merged = civilDefaults
        ? { ...base, ...civilDefaults, ...stamp }
        : { ...base, ...stamp }
      merged.ifcGlobalId = merged.ifcGlobalId ?? uidIfc()
      migratedStamps[id] = merged
    }

    // ── Migrate columns ──
    // Fix 1: drop legacy column.foundationId (foundation owns columnIds[] only).
    // Fix 2: rename legacy floorId → baseFloorId; mirror topFloorId for single-span.
    const migratedColumns = {}
    for (const [id, col] of Object.entries(data.columns ?? {})) {
      const { foundationId: _drop, floorId: legacyFloorId, ...rest } = col
      const baseFloorId = rest.baseFloorId ?? legacyFloorId ?? DEFAULT_FLOOR_ID
      migratedColumns[id] = {
        classification:      null,
        reinforcementSpecId: null,
        meta:                null,
        ...rest,
        baseFloorId,
        topFloorId: rest.topFloorId ?? baseFloorId,
      }
    }

    // ── Migrate beams: inject floor + meta ──
    const migratedBeams = Object.fromEntries(
      Object.entries(data.beams ?? {}).map(([id, beam]) => [id, {
        floorId: DEFAULT_FLOOR_ID,
        reinforcementSpecId: null,
        meta:    null,
        ...beam,
      }])
    )

    // ── Migrate slabs ──
    // Fix 3: populate classification/role on saved slabs that lack it.
    // Phase 4 Tier-2 ADD 1: legacy slabs without an explicit roleSource
    // default to 'AUTO' (conservative — re-derivation reproduces the value).
    const migratedSlabs = {}
    for (const [id, slab] of Object.entries(data.slabs ?? {})) {
      const role = slab.role ?? slab.classification ?? (slab.type === 'SUNKEN' ? 'SUNKEN' : 'ROOF')
      migratedSlabs[id] = {
        floorId:             DEFAULT_FLOOR_ID,
        reinforcementSpecId: null,
        meta:                null,
        roleSource:          'AUTO',
        ...slab,
        classification: role,
        role,
      }
    }

    // ── Migrate staircases: inject floor/fromFloor/toFloor + meta ──
    // Rev 2: inject hasHandrail: null (null = inherit projectSettings.grills).
    const migratedStaircases = Object.fromEntries(
      Object.entries(data.staircases ?? {}).map(([id, sc]) => [id, {
        floorId:      DEFAULT_FLOOR_ID,
        fromFloorId:  DEFAULT_FLOOR_ID,
        toFloorId:    DEFAULT_FLOOR_ID,
        meta:         null,
        hasHandrail:  null,
        ...sc,
        ifcGlobalId:  sc.ifcGlobalId ?? uidIfc(),
      }])
    )

    // ── Migrate foundations: inject classification + meta + ensure floor ──
    const migratedFoundations = Object.fromEntries(
      Object.entries(data.foundations ?? {}).map(([id, f]) => [id, {
        floorId:             DEFAULT_FLOOR_ID,
        classification:      null,
        reinforcementSpecId: null,
        meta:                null,
        ...f,
      }])
    )

    // ── MEP collections: default-injection on load ──
    // Greenfield — no legacy field renames, no version checks. Pure defaults
    // for missing fields so the loaded entities are runtime-ready.
    const _normalizeMepCollection = get()._normalizeMepCollection
    const _normalizeRisers        = get()._normalizeRisers
    const loadedPlumbingFixtures = _normalizeMepCollection(data.plumbingFixtures, 'plumbingFixtures')
    const loadedElectricalPoints = _normalizeMepCollection(data.electricalPoints, 'electricalPoints')
    const loadedHvacUnits        = _normalizeMepCollection(data.hvacUnits,        'hvacUnits')
    const loadedFireDevices      = _normalizeMepCollection(data.fireDevices,      'fireDevices')
    const loadedElvDevices       = _normalizeMepCollection(data.elvDevices,       'elvDevices')
    const loadedSolarEquipment   = _normalizeMepCollection(data.solarEquipment,   'solarEquipment')
    const loadedRisers           = _normalizeRisers(data.risers)

    set({
      nodes:  migratedNodes,
      walls:  migratedWalls,
      rooms:  migratedRooms,
      stamps: migratedStamps,
      currentFloorId: DEFAULT_FLOOR_ID,
      // Structural state — migrate then load.
      projectSettings: (() => {
        // Detect "new project" path: caller passed _emptyProjectData() with
        // null projectSettings. These projects opt into 'clear_internal'
        // (Area 1 — Option C); legacy saves keep whatever their saved
        // dimensionMode is (typically absent → 'centerline' via fallback).
        const _isNewProject = data.projectSettings == null
        const ps = data.projectSettings ?? DEFAULT_PROJECT_SETTINGS
        // Layer 4 migration: resolve footingTypeId → inline footing dims on column types.
        // Old format: ct.footingTypeId = 'F1' with separate ps.footingTypes array.
        // New format: ct.footingLengthFt / footingWidthFt / footingDepthFt inline.
        const savedFootingTypes = ps.footingTypes ?? []
        const migratedColumnTypes = (ps.columnTypes ?? []).map(ct => {
          if (ct.footingLengthFt !== undefined) return ct  // already migrated
          const ft = savedFootingTypes.find(f => f.id === ct.footingTypeId)
          if (!ft) return ct
          const { footingTypeId: _drop, ...rest } = ct
          return { ...rest, footingLengthFt: ft.lengthFt, footingWidthFt: ft.widthFt, footingDepthFt: ft.depthFt }
        })
        const { footingTypes: _drop, ...psRest } = ps
        // Layer 5 migration: inject rccSpecs default for saves without it.
        const rccSpecs = psRest.rccSpecs ?? DEFAULT_PROJECT_SETTINGS.rccSpecs
        // Stage 0 T2 migration: inject defaultPlasterSystemId for saves without it.
        const defaultPlasterSystemId         = psRest.defaultPlasterSystemId         ?? DEFAULT_PROJECT_SETTINGS.defaultPlasterSystemId
        // Plaster split (v2): inject defaultExternalPlasterSystemId for saves without it.
        const defaultExternalPlasterSystemId = psRest.defaultExternalPlasterSystemId ?? DEFAULT_PROJECT_SETTINGS.defaultExternalPlasterSystemId
        // Stage 0 T1 migration: synthesize floors[] from legacy heights if absent.
        const rawFloors = psRest.floors ?? [
          { id: DEFAULT_FLOOR_ID, label: 'Floor 1', sequence: 0,
            plinthHeightFt: psRest.heights?.plinthHeightFt ?? 1.5,
            floorHeightFt:  psRest.heights?.floorHeightFt  ?? 10,
            meta: null },
        ]
        // Per-floor underlay (Fix 3). Legacy saves stored a single
        // projectSettings.underlay; migrate it onto the first floor and drop
        // the legacy field. Floors without an underlay default to null.
        const legacyUnderlay = psRest.underlay ?? null
        const floors = rawFloors.map((f, i) => ({
          ...f,
          underlay: f.underlay ?? (i === 0 ? legacyUnderlay : null),
        }))
        // Strip the legacy field from psRest so spread doesn't reintroduce it.
        delete psRest.underlay
        // Rev 2 — inject tile / kitchen counter / grills defaults if absent.
        // Deep-merge dadoHeightsFt so saves that defined a partial map
        // (e.g. only TOILET) still pick up the other defaults.
        const tileDefaults = (() => {
          const def = DEFAULT_PROJECT_SETTINGS.tileDefaults
          const got = psRest.tileDefaults
          if (!got) return def
          return {
            ...def,
            ...got,
            dadoHeightsFt: { ...def.dadoHeightsFt, ...(got.dadoHeightsFt ?? {}) },
          }
        })()
        const kitchenCounter = psRest.kitchenCounter ?? DEFAULT_PROJECT_SETTINGS.kitchenCounter
        const grills         = { ...DEFAULT_PROJECT_SETTINGS.grills, ...(psRest.grills ?? {}) }
        // Area 1 — Option C. New projects opt into 'clear_internal';
        // loaded projects keep their saved dimensionMode (or stay legacy
        // 'centerline' via DEFAULT_PROJECT_SETTINGS when unset on save).
        const dimensionMode = _isNewProject
          ? 'clear_internal'
          : (psRest.dimensionMode ?? DEFAULT_PROJECT_SETTINGS.dimensionMode)
        // Snap architecture (Phase A). Schema-fill missing fields from
        // DEFAULT_PROJECT_SETTINGS.snap; deep-merge targets so a partial
        // saved subtree picks up newer target defaults.
        const snap = (() => {
          const def = DEFAULT_PROJECT_SETTINGS.snap
          const got = psRest.snap
          if (!got) return def
          const targets = { ...def.targets }
          for (const id of Object.keys(targets)) {
            if (got.targets?.[id]) targets[id] = { ...targets[id], ...got.targets[id] }
          }
          return {
            enabled:      got.enabled      ?? def.enabled,
            pitchIn:      got.pitchIn      ?? def.pitchIn,
            pitchPresets: got.pitchPresets ?? def.pitchPresets,
            bypassKey:    got.bypassKey    ?? def.bypassKey,
            targets,
          }
        })()
        return {
          ...psRest,
          columnTypes: migratedColumnTypes,
          rccSpecs, defaultPlasterSystemId, defaultExternalPlasterSystemId, floors,
          tileDefaults, kitchenCounter, grills,
          dimensionMode,
          snap,
        }
      })(),
      columns:     migratedColumns,
      beams:       migratedBeams,
      slabs:       migratedSlabs,
      staircases:  migratedStaircases,
      foundations: migratedFoundations,
      plumbingFixtures: loadedPlumbingFixtures,
      electricalPoints: loadedElectricalPoints,
      hvacUnits:        loadedHvacUnits,
      fireDevices:      loadedFireDevices,
      elvDevices:       loadedElvDevices,
      solarEquipment:   loadedSolarEquipment,
      risers:           loadedRisers,
      ratesByKey: (data.ratesByKey && typeof data.ratesByKey === 'object') ? { ...data.ratesByKey } : {},
      history: [], future: [],
      drawStartId: null, selectedWallId: null, selectedWallIds: [], selectedStampId: null, selectedColumnId: null, selectedFoundationId: null, selectedBeamId: null, pendingWallIds: [],
    })
  },

  // ── BOQ helpers — return feet / sq ft for display ─────────────────────

  getRoomPolygon(roomId) { return topoGetRoomPolygon(get(), roomId) },

  // Returns wall length in feet
  getWallLength(wallId) {
    const { nodes, walls } = get()
    const wall = walls[wallId]
    if (!wall) return 0
    const a = nodes[wall.n1], b = nodes[wall.n2]
    if (!a || !b) return 0
    const lengthIn = Math.hypot(b.x - a.x, b.y - a.y)
    return Math.round(lengthIn / GRID_IN * 100) / 100
  },

  // Returns net wall area in sq ft (gross - openings)
  getWallArea(wallId) {
    const { walls } = get()
    const wall = walls[wallId]
    if (!wall || wall.isVirtual) return 0
    const lengthFt  = get().getWallLength(wallId)
    const heightFt  = (wall.height  ?? DEFAULT_WALL_HEIGHT_IN) / GRID_IN
    const grossArea = lengthFt * heightFt
    const openingArea = (wall.openings || []).reduce(
      (sum, o) => sum + (o.width / GRID_IN) * (o.height / GRID_IN), 0
    )
    return Math.round(Math.max(0, grossArea - openingArea) * 100) / 100
  },

  // Sum of net wall area for all walls in a room (virtual walls return 0 from getWallArea)
  getRoomWallArea(roomId) { return topoGetRoomWallArea(get(), roomId) },

  // Ceiling + all wall faces in sq ft — basis for per-room paint area
  getRoomPaintArea(roomId) {
    return Math.round((get().getRoomArea(roomId) + get().getRoomWallArea(roomId)) * 100) / 100
  },

  getTotalWallArea() {
    // Wall plaster and bricks are global wall-map aggregates by design — not gated by room.finishes.
    // Iterates the walls map directly — each wallId is unique, so shared walls are counted once.
    // Do NOT change to iterate room.wallIds across rooms (that path double-counts shared walls).
    const { walls } = get()
    return Math.round(Object.keys(walls).reduce((t, id) => t + get().getWallArea(id), 0) * 100) / 100
  },

  // Returns quantities keyed by materialKey — only keys with at least one wall are present.
  // Each entry shape:
  //   { volFt3, faceAreaFt2, unitCount,
  //     cementBags?, sandFt3?          — CEMENT_SAND types only
  //     adhesiveKg?, adhesiveBags?     — THIN_BED types only }
  // 5% wastage applied to unitCount (bricks/blocks).
  getMaterialQuantities() {
    const WASTAGE = 1.05
    const { walls } = get()
    const acc = {}

    for (const w of Object.values(walls)) {
      if (w.isVirtual) continue
      const matKey = w.materialKey ?? 'IS_MODULAR_BRICK'
      const mat = MATERIAL_LIBRARY[matKey]
      if (!mat) continue
      const faceAreaFt2 = get().getWallArea(w.id)
      const thicknessFt = (w.thickness ?? DEFAULT_WALL_THICK_IN) / GRID_IN
      if (!acc[matKey]) acc[matKey] = { volFt3: 0, faceAreaFt2: 0 }
      acc[matKey].volFt3     += faceAreaFt2 * thicknessFt
      acc[matKey].faceAreaFt2 += faceAreaFt2
    }

    const result = {}
    for (const [matKey, { volFt3, faceAreaFt2 }] of Object.entries(acc)) {
      const mat = MATERIAL_LIBRARY[matKey]
      const unitPer = mat.bricksPerFt3 ?? mat.blocksPerFt3
      const entry = {
        volFt3:     Math.round(volFt3 * 100) / 100,
        faceAreaFt2: Math.round(faceAreaFt2 * 100) / 100,
        unitCount:  Math.ceil(volFt3 * unitPer * WASTAGE),
      }
      if (mat.bondingType === BONDING.CEMENT_SAND) {
        const mortarVol  = volFt3 * mat.mortarVolPerFt3Wall
        entry.cementBags = Math.ceil(mortarVol * mat.cementBagsPerFt3Mortar)
        entry.sandFt3    = Math.round(mortarVol * mat.sandFt3PerFt3Mortar * 100) / 100
      } else {
        const adhesiveKg      = faceAreaFt2 * mat.adhesiveKgPerFt2
        entry.adhesiveKg      = Math.round(adhesiveKg * 100) / 100
        entry.adhesiveBags    = Math.ceil(adhesiveKg / mat.adhesiveBagKg)
      }
      result[matKey] = entry
    }
    return result
  },

  isRoomStructurallyValid(roomId) { return topoIsRoomStructurallyValid(get(), roomId) },
  isRoomValid(roomId) {
    return get().isRoomStructurallyValid(roomId) && !get().hasRoomOverlap(roomId)
  },
  getOverlappingRoomName(roomId) { return topoGetOverlappingRoomName(get(), roomId) },
  hasRoomOverlap(roomId)         { return topoHasRoomOverlap(get(), roomId) },
  getValidRoomIds()              { return topoGetValidRoomIds(get()) },
  sumRoomAreas(predicate)        { return topoSumRoomAreas(get(), predicate) },
  getRoomArea(roomId)            { return topoGetRoomArea(get(), roomId) },

  getTotalFloorArea() {
    return Math.round(
      get().getValidRoomIds().reduce((t, id) => t + get().getRoomArea(id), 0)
    * 100) / 100
  },

  getTotalFlooringArea()       { return get().sumRoomAreas(r => r?.finishes?.flooring) },
  getTotalCeilingPlasterArea() { return get().sumRoomAreas(r => r?.finishes?.ceilingPlaster) },
  getTotalWaterproofingArea()  { return get().sumRoomAreas(r => r?.finishes?.waterproofing) },
  getTotalRoofingArea()        { return get().sumRoomAreas(r => r?.finishes?.roofing) },

  getTotalPaintWallsArea() {
    const { rooms } = get()
    return Math.round(
      get().getValidRoomIds()
        .filter(id => rooms[id]?.finishes?.paint)
        .reduce((t, id) => t + get().getRoomWallArea(id), 0)
    * 100) / 100
  },

  getTotalPaintCeilingArea() {
    return get().sumRoomAreas(r => r?.finishes?.paint)
  },

  getTotalPaintArea() {
    return Math.round((get().getTotalPaintWallsArea() + get().getTotalPaintCeilingArea()) * 100) / 100
  },

  // Returns total wall length in feet (excluding virtual walls)
  getAllWallsLength() {
    const { nodes, walls } = get()
    return Object.values(walls).reduce((total, wall) => {
      if (wall.isVirtual) return total
      const a = nodes[wall.n1], b = nodes[wall.n2]
      if (!a || !b) return total
      return total + Math.hypot(b.x - a.x, b.y - a.y) / GRID_IN
    }, 0)
  },

  // Excavation volume in cubic feet for sump + septic_tank stamps
  getTotalExcavationVolumeFt3() {
    return Math.round(
      Object.values(get().stamps)
        .filter(s => (s.type === 'sump' || s.type === 'septic_tank') && s.depth)
        .reduce((t, s) => t + (s.w * s.h * s.depth) / 1728, 0)
    * 100) / 100
  },

  // Returns { excavFt3, brickFt3, rccBottomFt3, rccTopFt3, plasterFt2 } summed over all sump stamps.
  // rccBottomFt3 / rccTopFt3 are identical today (6" slab each) but split for future rate/spec divergence.
  getSumpCivilQty() {
    return Object.values(get().stamps)
      .filter(s => s.type === 'sump' && s.depth)
      .reduce((acc, s) => {
        const { wFt, hFt, dFt, perimeterFt, footprintFt2 } = getStampDimensionsFt(s)
        acc.excavFt3    += footprintFt2 * dFt
        acc.brickFt3    += perimeterFt * dFt * 0.75
        acc.rccBottomFt3 += footprintFt2 * 0.5
        acc.rccTopFt3    += footprintFt2 * 0.5
        // Approximation: waterproofing assumed on all internal plastered
        // faces for underground tanks. Real systems vary (floor only,
        // floor + wall upturn, external membrane, full tank). Revisit
        // in Phase 1.5+ with material spec inputs.
        acc.plasterFt2  += perimeterFt * dFt + footprintFt2
        return acc
      }, { excavFt3: 0, brickFt3: 0, rccBottomFt3: 0, rccTopFt3: 0, plasterFt2: 0 })
  },

  // Returns { excavFt3, brickFt3, rccBottomFt3, rccTopFt3, plasterFt2 } summed over all septic_tank stamps.
  // Brickwork includes 1 internal partition wall spanning the shorter footprint dimension (standard 2-chamber design).
  getSepticCivilQty() {
    return Object.values(get().stamps)
      .filter(s => s.type === 'septic_tank' && s.depth)
      .reduce((acc, s) => {
        const { wFt, hFt, dFt, perimeterFt, footprintFt2 } = getStampDimensionsFt(s)
        const partitionFt = Math.min(wFt, hFt)
        acc.excavFt3    += footprintFt2 * dFt
        acc.brickFt3    += (perimeterFt + partitionFt) * dFt * 0.75
        acc.rccBottomFt3 += footprintFt2 * 0.5
        acc.rccTopFt3    += footprintFt2 * 0.5
        // Approximation: waterproofing assumed on all internal plastered
        // faces for underground tanks. Real systems vary (floor only,
        // floor + wall upturn, external membrane, full tank). Revisit
        // in Phase 1.5+ with material spec inputs.
        acc.plasterFt2  += (perimeterFt + partitionFt) * dFt + footprintFt2
        return acc
      }, { excavFt3: 0, brickFt3: 0, rccBottomFt3: 0, rccTopFt3: 0, plasterFt2: 0 })
  },

  getStampsByType(type) {
    return Object.values(get().stamps).filter(s => s.type === type)
  },

  // ── Structural slice (columns, beams, slabs, staircases, projectSettings) ──
  ...createStructuralSlice(set, get, uid),

  // ── MEP slice (6 disciplines + risers) ──
  ...createMepSlice(set, get, uid),
}))

exposeStoreForDev(useStore)
