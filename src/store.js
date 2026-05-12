import { create } from 'zustand'
import {
  SNAP_IN, GRID_IN, DEFAULT_WALL_HEIGHT_IN, DEFAULT_WALL_THICK_IN,
  findNearbyNode, isOnSegment, collinearOverlap, pointInPolygon, normalizePolygonWinding,
  doRoomsOverlap,
} from './geometry'
import { getPresetFinishes, ALL_FINISHES, ROOM_PRESETS } from './roomPresets'

let nextId = 1
const uid = () => String(nextId++)

function removeOrphanNodes(nodes, walls) {
  const used = new Set()
  Object.values(walls).forEach(w => { used.add(w.n1); used.add(w.n2) })
  const cleaned = { ...nodes }
  Object.keys(cleaned).forEach(id => { if (!used.has(id)) delete cleaned[id] })
  return cleaned
}

function buildPlotPolygon(walls, nodes) {
  const plotWalls = Object.values(walls).filter(w => w.isPlot)
  if (plotWalls.length < 3) return null
  const adj = {}
  for (const w of plotWalls) {
    if (!adj[w.n1]) adj[w.n1] = []
    if (!adj[w.n2]) adj[w.n2] = []
    adj[w.n1].push(w.n2)
    adj[w.n2].push(w.n1)
  }
  const nodeIds = Object.keys(adj)
  if (nodeIds.length < 3) return null
  let best = []
  for (const startId of nodeIds) {
    const p = [startId]
    let prev = null, current = startId
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const next = (adj[current] || []).find(n => n !== prev && !p.includes(n))
      if (!next) break
      p.push(next); prev = current; current = next
    }
    if (p.length > best.length) best = p
    if (best.length === nodeIds.length) break
  }
  const isClosed = best.length === nodeIds.length && (adj[best[best.length - 1]] || []).includes(best[0])
  if (!isClosed) return null
  return best.map(id => nodes[id]).filter(Boolean)
}

// Walk adjacency graph to find polygon node order
function walkPolygon(wallIds, walls) {
  const adj = {}
  for (const wid of wallIds) {
    const w = walls[wid]
    if (!w) return null   // stale reference — refuse to compute a partial polygon
    if (!adj[w.n1]) adj[w.n1] = []
    if (!adj[w.n2]) adj[w.n2] = []
    adj[w.n1].push(w.n2)
    adj[w.n2].push(w.n1)
  }
  const nodeIds = Object.keys(adj)
  if (nodeIds.length < 3) return null
  let best = []
  for (const startId of nodeIds) {
    const p = [startId]
    let prev = null, current = startId
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const next = (adj[current] || []).find(n => n !== prev && !p.includes(n))
      if (!next) break
      p.push(next); prev = current; current = next
    }
    if (p.length > best.length) best = p
    if (best.length === nodeIds.length) break
  }
  const isClosed = best.length === nodeIds.length && (adj[best[best.length - 1]] || []).includes(best[0])
  return isClosed ? best : null
}

export const useStore = create((set, get) => ({
  nodes:  {},
  walls:  {},
  rooms:  {},
  stamps: {},

  history: [],
  future:  [],

  activeTool:      'draw',
  drawVirtual:     false,
  drawStartId:     null,
  selectedWallId:  null,
  selectedWallIds: [],
  selectedStampId: null,
  selectedRoomId:  null,
  pendingWallIds:  [],
  draftOpening:    null,

  unit:           'ft',
  showDimensions: false,

  // ── History ───────────────────────────────────────────────────────────

  _save() {
    const { nodes, walls, rooms, stamps } = get()
    set(s => ({
      history: [...s.history.slice(-49), { nodes, walls, rooms, stamps }],
      future:  [],
    }))
  },

  undo() {
    const { history } = get()
    if (!history.length) return
    const prev = history[history.length - 1]
    set(s => ({
      history: s.history.slice(0, -1),
      future:  [{ nodes: s.nodes, walls: s.walls, rooms: s.rooms, stamps: s.stamps }, ...s.future.slice(0, 49)],
      nodes:   prev.nodes,
      walls:   prev.walls,
      rooms:   prev.rooms,
      stamps:  prev.stamps,
      drawStartId: null, selectedWallId: null, selectedWallIds: [], selectedStampId: null, pendingWallIds: [],
    }))
  },

  redo() {
    const { future } = get()
    if (!future.length) return
    const next = future[0]
    set(s => ({
      future:  s.future.slice(1),
      history: [...s.history.slice(-49), { nodes: s.nodes, walls: s.walls, rooms: s.rooms, stamps: s.stamps }],
      nodes:   next.nodes,
      walls:   next.walls,
      rooms:   next.rooms,
      stamps:  next.stamps,
      drawStartId: null, selectedWallId: null, selectedWallIds: [], selectedStampId: null, pendingWallIds: [],
    }))
  },

  // ── Tools ─────────────────────────────────────────────────────────────

  setTool(tool) {
    set({ activeTool: tool, drawStartId: null, selectedWallId: null, selectedWallIds: [], selectedStampId: null, selectedRoomId: null, pendingWallIds: [], draftOpening: null })
  },

  toggleDrawVirtual()    { set(s => ({ drawVirtual: !s.drawVirtual })) },
  setUnit(unit)          { set({ unit }) },
  toggleShowDimensions() { set(s => ({ showDimensions: !s.showDimensions })) },
  setDraftOpening(data)  { set({ draftOpening: data }) },

  // ── Nodes ─────────────────────────────────────────────────────────────

  // x, y are world inches (Y-up)
  getOrCreateNode(x, y) {
    const existing = findNearbyNode(get().nodes, x, y)
    if (existing) return existing.id

    // If the point lies on the body of an existing wall, auto-split it so the
    // new node is properly shared (fixes T-junction room-marking failures).
    const { walls, nodes: currentNodes } = get()
    for (const wall of Object.values(walls)) {
      const a = currentNodes[wall.n1], b = currentNodes[wall.n2]
      if (!a || !b) continue
      if (!isOnSegment(x, y, a.x, a.y, b.x, b.y)) continue
      if (Math.hypot(x - a.x, y - a.y) < SNAP_IN || Math.hypot(x - b.x, y - b.y) < SNAP_IN) continue
      const newNodeId = uid()
      const w1Id = uid(), w2Id = uid()
      set(s => {
        const newWalls = { ...s.walls }
        delete newWalls[wall.id]
        newWalls[w1Id] = { ...wall, id: w1Id, n1: wall.n1, n2: newNodeId, openings: [] }
        newWalls[w2Id] = { ...wall, id: w2Id, n1: newNodeId, n2: wall.n2, openings: [] }
        const rooms = {}
        Object.values(s.rooms).forEach(r => {
          const idx = r.wallIds.indexOf(wall.id)
          const wallIds = idx === -1
            ? r.wallIds
            : [...r.wallIds.slice(0, idx), w1Id, w2Id, ...r.wallIds.slice(idx + 1)]
          rooms[r.id] = { ...r, wallIds }
        })
        return { nodes: { ...s.nodes, [newNodeId]: { id: newNodeId, x, y } }, walls: newWalls, rooms }
      })
      return newNodeId
    }

    const id = uid()
    set(s => ({ nodes: { ...s.nodes, [id]: { id, x, y } } }))
    return id
  },

  // ── Walls ─────────────────────────────────────────────────────────────

  addWall(n1, n2) {
    if (n1 === n2) return
    const { nodes } = get()
    const a = nodes[n1], b = nodes[n2]
    if (a && b && Math.hypot(b.x - a.x, b.y - a.y) < 1) return
    const already = Object.values(get().walls).some(
      w => (w.n1 === n1 && w.n2 === n2) || (w.n1 === n2 && w.n2 === n1)
    )
    if (already) return
    const { nodes: ns } = get()
    const na = ns[n1], nb = ns[n2]
    const overlaps = Object.values(get().walls).some(w => {
      const c = ns[w.n1], d = ns[w.n2]
      if (!c || !d) return false
      return collinearOverlap(na.x, na.y, nb.x, nb.y, c.x, c.y, d.x, d.y)
    })
    if (overlaps) return
    const { walls: currentWalls, nodes: currentNodes } = get()
    const plotPoly = buildPlotPolygon(currentWalls, currentNodes)
    if (plotPoly) {
      const nodeA = currentNodes[n1], nodeB = currentNodes[n2]
      if (!pointInPolygon(nodeA.x, nodeA.y, plotPoly) || !pointInPolygon(nodeB.x, nodeB.y, plotPoly)) return
    }
    get()._save()
    const id = uid()
    const isVirtual = get().drawVirtual
    set(s => ({
      walls: { ...s.walls, [id]: { id, n1, n2, height: DEFAULT_WALL_HEIGHT_IN, thickness: DEFAULT_WALL_THICK_IN, isPlot: false, isVirtual, openings: [] } },
      drawStartId: null,
    }))
  },

  deleteWall(wallId) {
    get()._save()
    set(s => {
      const walls = { ...s.walls }
      delete walls[wallId]
      const nodes = removeOrphanNodes(s.nodes, walls)
      const rooms = {}
      Object.values(s.rooms).forEach(r => {
        rooms[r.id] = { ...r, wallIds: r.wallIds.filter(id => id !== wallId) }
      })
      return { walls, nodes, rooms, selectedWallId: null }
    })
  },

  selectWall(wallId) { set({ selectedWallId: wallId, selectedWallIds: [], selectedStampId: null, selectedRoomId: null, draftOpening: null }) },
  selectRoom(roomId) { set({ selectedRoomId: roomId, selectedWallId: null, selectedWallIds: [], selectedStampId: null, draftOpening: null }) },

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

  // x, y are world inches
  splitWall(wallId, x, y) {
    const { walls, nodes } = get()
    const wall = walls[wallId]
    if (!wall) return null
    const a = nodes[wall.n1], b = nodes[wall.n2]
    if (!isOnSegment(x, y, a.x, a.y, b.x, b.y)) return null
    if (
      (Math.abs(x - a.x) < SNAP_IN && Math.abs(y - a.y) < SNAP_IN) ||
      (Math.abs(x - b.x) < SNAP_IN && Math.abs(y - b.y) < SNAP_IN)
    ) return null
    get()._save()
    const newNodeId = uid()
    const w1Id = uid(), w2Id = uid()
    set(s => {
      const newWalls = { ...s.walls }
      delete newWalls[wallId]
      newWalls[w1Id] = { id: w1Id, n1: wall.n1, n2: newNodeId, height: wall.height, thickness: wall.thickness, isPlot: wall.isPlot, isVirtual: wall.isVirtual, openings: [] }
      newWalls[w2Id] = { id: w2Id, n1: newNodeId, n2: wall.n2, height: wall.height, thickness: wall.thickness, isPlot: wall.isPlot, isVirtual: wall.isVirtual, openings: [] }
      const rooms = {}
      Object.values(s.rooms).forEach(r => {
        const idx = r.wallIds.indexOf(wallId)
        const wallIds = idx === -1
          ? r.wallIds
          : [...r.wallIds.slice(0, idx), w1Id, w2Id, ...r.wallIds.slice(idx + 1)]
        rooms[r.id] = { ...r, wallIds }
      })
      return { nodes: { ...s.nodes, [newNodeId]: { id: newNodeId, x, y } }, walls: newWalls, rooms }
    })
    return newNodeId
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
    const id = uid()
    set(s => {
      const wall = s.walls[wallId]
      if (!wall) return {}
      return { walls: { ...s.walls, [wallId]: { ...wall, openings: [...(wall.openings || []), { id, offset, width, height, type, orient }] } } }
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
      return { walls: { ...s.walls, [wallId]: { ...wall, openings: wall.openings.filter(o => o.id !== openingId) } } }
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
    const id = uid()
    // w, h = footprint dimensions (plan view, inches)
    // depth = vertical depth (civil stamps only — undefined for stairs/lift)
    const defaults = {
      stairs:        { w: 48, h: 96 },
      lift:          { w: 60, h: 60 },
      sump:          { w: 72, h: 60, depth: 72,  name: 'Sump' },
      overhead_tank: { w: 60, h: 60, depth: 48,  name: 'OHT' },
      septic_tank:   { w: 96, h: 72, depth: 60,  name: 'Septic Tank' },
    }[type] || { w: 48, h: 48 }
    set(s => ({
      stamps: { ...s.stamps, [id]: { id, type, x: x - defaults.w / 2, y: y - defaults.h / 2, ...defaults } },
    }))
  },

  deleteStamp(stampId) {
    get()._save()
    set(s => {
      const stamps = { ...s.stamps }
      delete stamps[stampId]
      return { stamps, selectedStampId: null }
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

  selectStamp(stampId) { set({ selectedStampId: stampId, selectedWallId: null }) },

  // ── Rooms ─────────────────────────────────────────────────────────────

  saveRoom(name, type = 'OTHER') {
    const { pendingWallIds, rooms, walls, nodes } = get()
    if (!pendingWallIds.length) return null

    // Overlap check — runs before _save() so history is not polluted by a blocked save.
    // Only checks rooms that are fully valid (isRoomValid = structural + no overlap).
    // Invalid existing rooms are not a reference for blocking new saves.
    const nodeOrder = walkPolygon(pendingWallIds, walls)
    if (nodeOrder) {
      const candidatePoly = nodeOrder.map(id => nodes[id]).filter(Boolean)
      if (candidatePoly.length >= 3) {
        for (const room of Object.values(rooms)) {
          if (!get().isRoomValid(room.id)) continue
          const existingPoly = get().getRoomPolygon(room.id)
          if (doRoomsOverlap(candidatePoly, existingPoly)) {
            return { error: 'overlap', conflictName: room.name }
          }
        }
      }
    }

    get()._save()
    const id       = uid()
    const safeType = ROOM_PRESETS[type] ? type : 'OTHER'
    set(s => ({
      rooms: {
        ...s.rooms,
        [id]: {
          id,
          name,
          wallIds:    [...s.pendingWallIds],
          type:       safeType,
          customType: null,
          finishes:   getPresetFinishes(safeType),
        },
      },
      pendingWallIds: [],
    }))
    return null
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
    // Migrate rooms: add type/finishes if missing, validate type against known presets
    const migratedRooms = {}
    for (const [id, room] of Object.entries(data.rooms || {})) {
      const safeType = ROOM_PRESETS[room.type] ? room.type : 'OTHER'
      migratedRooms[id] = {
        type:       safeType,
        customType: null,
        ...room,
        type:       safeType,    // re-assert after spread in case room.type was invalid
        finishes:   room.finishes
          ? { ...ALL_FINISHES, ...room.finishes }   // fill any missing flag keys
          : getPresetFinishes(safeType),             // v1/v2 rooms: use type preset (OTHER=ALL_FINISHES)
      }
    }
    if (import.meta.env.DEV) {
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

      // Pairwise overlap check — uses only structurally valid rooms as comparison targets
      const structuralRooms = Object.values(migratedRooms).filter(r =>
        r.wallIds.length >= 3 && walkPolygon(r.wallIds, loadedWalls) !== null
      )
      for (let i = 0; i < structuralRooms.length; i++) {
        for (let j = i + 1; j < structuralRooms.length; j++) {
          const rA = structuralRooms[i], rB = structuralRooms[j]
          const pA = walkPolygon(rA.wallIds, loadedWalls).map(id => (data.nodes || {})[id]).filter(Boolean)
          const pB = walkPolygon(rB.wallIds, loadedWalls).map(id => (data.nodes || {})[id]).filter(Boolean)
          if (pA.length >= 3 && pB.length >= 3 && doRoomsOverlap(pA, pB))
            console.warn(`[topology] Rooms "${rA.name}" and "${rB.name}" overlap`)
        }
      }
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
      migratedStamps[id] = civilDefaults
        ? { ...civilDefaults, ...stamp }   // defaults first so saved values win
        : { ...stamp }
    }

    set({
      nodes:  data.nodes  || {},
      walls:  data.walls  || {},
      rooms:  migratedRooms,
      stamps: migratedStamps,
      history: [], future: [],
      drawStartId: null, selectedWallId: null, selectedWallIds: [], selectedStampId: null, pendingWallIds: [],
    })
  },

  // ── BOQ helpers — return feet / sq ft for display ─────────────────────

  getRoomPolygon(roomId) {
    const { rooms, walls, nodes } = get()
    const room = rooms[roomId]
    if (!room || room.wallIds.length < 3) return null
    const nodeOrder = walkPolygon(room.wallIds, walls)
    if (!nodeOrder) return null
    return nodeOrder.map(id => nodes[id]).filter(Boolean)
  },

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
  getRoomWallArea(roomId) {
    const { rooms } = get()
    const room = rooms[roomId]
    if (!room) return 0
    return Math.round(room.wallIds.reduce((t, wid) => t + get().getWallArea(wid), 0) * 100) / 100
  },

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

  // Pure topology: walls exist + form a closed loop. No overlap check.
  // Used as the filter inside overlap routines to avoid composing with itself.
  isRoomStructurallyValid(roomId) {
    const { rooms, walls } = get()
    const room = rooms[roomId]
    if (!room || room.wallIds.length < 3) return false
    return walkPolygon(room.wallIds, walls) !== null
  },

  // Composite validity: structurally valid + does not overlap another structurally-valid room.
  isRoomValid(roomId) {
    return get().isRoomStructurallyValid(roomId) && !get().hasRoomOverlap(roomId)
  },

  // Returns name of first structurally-valid room that overlaps roomId, or null.
  getOverlappingRoomName(roomId) {
    const { rooms } = get()
    const polyA = get().getRoomPolygon(roomId)
    if (!polyA) return null
    for (const [otherId, room] of Object.entries(rooms)) {
      if (otherId === roomId) continue
      if (!get().isRoomStructurallyValid(otherId)) continue
      const polyB = get().getRoomPolygon(otherId)
      if (!polyB) continue
      if (doRoomsOverlap(polyA, polyB)) return room.name
    }
    return null
  },

  hasRoomOverlap(roomId) {
    return get().getOverlappingRoomName(roomId) !== null
  },

  // Returns ids of structurally valid, non-overlapping rooms.
  // All finish-gated totals and getTotalFloorArea filter THIS set — never raw Object.keys(rooms).
  getValidRoomIds() {
    const { rooms } = get()
    const structuralIds = Object.keys(rooms).filter(id => get().isRoomStructurallyValid(id))
    const polys = structuralIds.map(id => ({ id, poly: get().getRoomPolygon(id) })).filter(r => r.poly)
    const overlapExcluded = new Set()
    for (let i = 0; i < polys.length; i++) {
      for (let j = i + 1; j < polys.length; j++) {
        if (doRoomsOverlap(polys[i].poly, polys[j].poly)) {
          if (import.meta.env.DEV)
            console.warn(`[topology] Rooms "${rooms[polys[i].id].name}" and "${rooms[polys[j].id].name}" overlap — both excluded.`)
          overlapExcluded.add(polys[i].id)
          overlapExcluded.add(polys[j].id)
        }
      }
    }
    return polys.filter(r => !overlapExcluded.has(r.id)).map(r => r.id)
  },

  // Generic: sum getRoomArea over valid rooms where predicate(room) is true.
  // Used by all finish-gated total selectors — avoids duplicating the filter+reduce pattern.
  sumRoomAreas(predicate) {
    const { rooms } = get()
    return Math.round(
      get().getValidRoomIds()
        .filter(id => predicate(rooms[id]))
        .reduce((t, id) => t + get().getRoomArea(id), 0)
    * 100) / 100
  },

  // Returns room floor area in sq ft
  getRoomArea(roomId) {
    const { rooms, walls, nodes } = get()
    const room = rooms[roomId]
    if (!room || room.wallIds.length < 2) return 0
    const nodeOrder = walkPolygon(room.wallIds, walls)
    if (!nodeOrder || nodeOrder.length < 3) return 0
    const pts = nodeOrder.map(id => nodes[id]).filter(Boolean)
    let area = 0
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length
      area += pts[i].x * pts[j].y - pts[j].x * pts[i].y
    }
    // area is in in² — divide by GRID_IN² (144) to get sq ft
    return Math.round(Math.abs(area) / 2 / (GRID_IN * GRID_IN) * 100) / 100
  },

  getTotalFloorArea() {
    return Math.round(
      get().getValidRoomIds().reduce((t, id) => t + get().getRoomArea(id), 0)
    * 100) / 100
  },

  getTotalFlooringArea()       { return get().sumRoomAreas(r => r?.finishes?.flooring) },
  getTotalCeilingPlasterArea() { return get().sumRoomAreas(r => r?.finishes?.ceilingPlaster) },
  getTotalWaterproofingArea()  { return get().sumRoomAreas(r => r?.finishes?.waterproofing) },
  getTotalRoofingArea()        { return get().sumRoomAreas(r => r?.finishes?.roofing) },

  getTotalPaintArea() {
    const { rooms } = get()
    // TODO Phase 1c: split Paint into walls/ceiling for labor rate asymmetry
    return Math.round(
      get().getValidRoomIds()
        .filter(id => rooms[id]?.finishes?.paint)
        .reduce((t, id) => t + get().getRoomPaintArea(id), 0)
    * 100) / 100
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

  getStampsByType(type) {
    return Object.values(get().stamps).filter(s => s.type === type)
  },
}))
