import { create } from 'zustand'
import {
  SNAP_IN, GRID_IN, DEFAULT_WALL_HEIGHT_IN, DEFAULT_WALL_THICK_IN,
  findNearbyNode, isOnSegment, collinearOverlap, pointInPolygon, normalizePolygonWinding,
} from './geometry'

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
    if (!w) continue
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
    // Defaults in inches: stairs 4ft×8ft, lift 5ft×5ft
    const defaults = type === 'stairs' ? { w: 48, h: 96 } : { w: 60, h: 60 }
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

  selectStamp(stampId) { set({ selectedStampId: stampId, selectedWallId: null }) },

  // ── Rooms ─────────────────────────────────────────────────────────────

  saveRoom(name) {
    const { pendingWallIds, walls, nodes } = get()
    if (!pendingWallIds.length) return
    get()._save()
    const id = uid()
    set(s => ({
      rooms: { ...s.rooms, [id]: { id, name, wallIds: [...s.pendingWallIds] } },
      pendingWallIds: [],
    }))
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
    set({
      nodes:  data.nodes  || {},
      walls:  data.walls  || {},
      rooms:  data.rooms  || {},
      stamps: data.stamps || {},
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

  getTotalWallArea() {
    const { walls } = get()
    return Math.round(Object.keys(walls).reduce((t, id) => t + get().getWallArea(id), 0) * 100) / 100
  },

  isRoomValid(roomId) {
    const { rooms, walls } = get()
    const room = rooms[roomId]
    if (!room || room.wallIds.length < 3) return false
    return walkPolygon(room.wallIds, walls) !== null
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
    const { rooms } = get()
    return Math.round(
      Object.keys(rooms)
        .filter(id => get().isRoomValid(id))
        .reduce((t, id) => t + get().getRoomArea(id), 0)
      * 100
    ) / 100
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
}))
