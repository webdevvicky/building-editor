import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'
import {
  w2s, screenToWorld, screenToWorldRaw, snapIn,
  PX_PER_INCH, GRID_IN, DEFAULT_WALL_THICK_IN,
  closestPointOnSegment,
} from '../geometry'
import { BEAM_LEVEL_REGISTRY } from '../constants/structural'
import { getColumnSvgDims } from '../lib/columnShapes'
import { getNearestWallToPoint } from '../topology/index.js'
import PlumbingOverlay from './canvas/PlumbingOverlay.jsx'
import ElectricalOverlay from './canvas/ElectricalOverlay.jsx'
import HvacOverlay from './canvas/HvacOverlay.jsx'
import FireOverlay from './canvas/FireOverlay.jsx'
import ElvOverlay from './canvas/ElvOverlay.jsx'
import ClashOverlay from './canvas/ClashOverlay.jsx'
import './Canvas.css'

// Phase 1 plumbing — fixed placeholder type until a floating type picker
// lands. Plumbing tool drops one WC per click; user then changes the type
// via PlumbingFixturePanel. The picker is Phase 1.x polish.
const DEFAULT_PLUMBING_FIXTURE_TYPE = 'WC'

// Phase 1 electrical — fixed placeholder type until a floating type picker
// lands. Electrical tool drops one LIGHT per click; user then changes the
// type via ElectricalPointPanel. The picker is Phase 1.x polish.
const DEFAULT_ELECTRICAL_POINT_TYPE = 'LIGHT'

// Phase 1 hvac — fixed placeholder type until a floating type picker lands.
// HVAC tool drops one AC_INDOOR_UNIT per click; user then changes the type
// via HvacPanel. The picker is Phase 1.x polish.
const DEFAULT_HVAC_UNIT_TYPE = 'AC_INDOOR_UNIT'

// Phase 1 fire — fixed placeholder type until a floating type picker lands.
// Fire tool drops one SMOKE_DETECTOR per click; user then changes the type
// via FirePanel. The picker is Phase 1.x polish.
const DEFAULT_FIRE_DEVICE_TYPE = 'SMOKE_DETECTOR'

// Phase 1 elv — fixed placeholder type until a floating type picker lands.
// ELV tool drops one DATA_POINT per click; user then changes the type via
// ElvPanel. The picker is Phase 1.x polish.
const DEFAULT_ELV_DEVICE_TYPE = 'DATA_POINT'

// Shorthand: world inches → SVG-group coordinate (pan/zoom handled by the <g> transform)
const sx = x =>  x * PX_PER_INCH
const sy = y => -y * PX_PER_INCH

// 20 px per foot in SVG-group space (= GRID_IN * PX_PER_INCH = 12 * 5/3)
const FOOT_PX = GRID_IN * PX_PER_INCH

function apply90(startNode, x, y) {
  const dx = Math.abs(x - startNode.x)
  const dy = Math.abs(y - startNode.y)
  return dx >= dy ? { x, y: startNode.y } : { x: startNode.x, y }
}

// a, b are world-inch nodes; returns SVG-group-coord segments/gaps
function getWallSegments(a, b, openings) {
  const ax = sx(a.x), ay = sy(a.y)
  const bx = sx(b.x), by = sy(b.y)
  const totalPx = Math.hypot(bx - ax, by - ay)
  if (totalPx === 0 || !openings || openings.length === 0) {
    return { segments: [{ x1: ax, y1: ay, x2: bx, y2: by }], gaps: [] }
  }
  const dx = (bx - ax) / totalPx
  const dy = (by - ay) / totalPx
  const sorted = [...openings].sort((p, q) => p.offset - q.offset)
  const segments = [], gaps = []
  let cur = 0
  for (const o of sorted) {
    const gStart = Math.min(o.offset * PX_PER_INCH, totalPx)
    const gEnd   = Math.min(gStart + o.width * PX_PER_INCH, totalPx)
    if (gEnd <= gStart) continue
    if (gStart > cur) segments.push({ x1: ax+cur*dx, y1: ay+cur*dy, x2: ax+gStart*dx, y2: ay+gStart*dy })
    gaps.push({ x1: ax+gStart*dx, y1: ay+gStart*dy, x2: ax+gEnd*dx, y2: ay+gEnd*dy, type: o.type })
    cur = gEnd
  }
  if (cur < totalPx) segments.push({ x1: ax+cur*dx, y1: ay+cur*dy, x2: bx, y2: by })
  return { segments, gaps }
}

// startNode, cursor: world inches; lengthFt: feet → returns world-inch snapped endpoint (ortho)
function applyLockedLength(startNode, cursor, lengthFt) {
  const lengthIn = lengthFt * GRID_IN
  const dx = cursor.x - startNode.x
  const dy = cursor.y - startNode.y
  if (Math.abs(dx) >= Math.abs(dy)) return { x: startNode.x + (dx >= 0 ? lengthIn : -lengthIn), y: startNode.y }
  return { x: startNode.x, y: startNode.y + (dy >= 0 ? lengthIn : -lengthIn) }
}

// Free-angle locked length (world inches)
function applyLockedLengthFree(startNode, cursor, lengthFt) {
  const lengthIn = lengthFt * GRID_IN
  const dx = cursor.x - startNode.x
  const dy = cursor.y - startNode.y
  const dist = Math.hypot(dx, dy)
  if (dist === 0) return { x: startNode.x + lengthIn, y: startNode.y }
  return { x: snapIn(startNode.x + (dx / dist) * lengthIn), y: snapIn(startNode.y + (dy / dist) * lengthIn) }
}

// a, b: world-inch nodes → returns length in feet
function wallLength(a, b) {
  return Math.round(Math.hypot(b.x - a.x, b.y - a.y) / GRID_IN * 10) / 10
}

function fmtLen(ft, unit) {
  if (unit === 'm') return `${Math.round(ft * 0.3048 * 100) / 100} m`
  return `${ft} ft`
}

const ROOM_COLORS = ['#3498db','#e74c3c','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#16a085']

const TOOL_CURSOR = {
  draw:          'crosshair',
  split:         'crosshair',
  select:        'default',
  room:          'default',
  stairs:        'crosshair',
  lift:          'crosshair',
  sump:          'crosshair',
  overhead_tank: 'crosshair',
  septic_tank:   'crosshair',
  column:        'crosshair',
  beam:          'crosshair',
  plumbing:      'crosshair',
  electrical:    'crosshair',
  hvac:          'crosshair',
  fire:          'crosshair',
  elv:           'crosshair',
}

function getColPos(col, nodes) {
  if (col.attachedNodeId) {
    const n = nodes[col.attachedNodeId]
    return n ? { x: n.x, y: n.y } : { x: col.x, y: col.y }
  }
  return { x: col.x, y: col.y }
}

const STAMP_TOOLS = new Set(['stairs', 'lift', 'sump', 'overhead_tank', 'septic_tank'])

export default function Canvas() {
  const nodes          = useStore(s => s.nodes)
  const walls          = useStore(s => s.walls)
  const rooms          = useStore(s => s.rooms)
  const stamps         = useStore(s => s.stamps)
  const isRoomValid    = useStore(s => s.isRoomValid)
  const getRoomPolygon = useStore(s => s.getRoomPolygon)
  const activeTool     = useStore(s => s.activeTool)
  const drawStartId    = useStore(s => s.drawStartId)
  const selectedWallId  = useStore(s => s.selectedWallId)
  const selectedWallIds = useStore(s => s.selectedWallIds)
  const selectedOpening = useStore(s => s.selectedOpening)
  const selectOpening   = useStore(s => s.selectOpening)
  const selectedStampId = useStore(s => s.selectedStampId)
  const pendingWallIds = useStore(s => s.pendingWallIds)
  const drawVirtual    = useStore(s => s.drawVirtual)
  const showDimensions = useStore(s => s.showDimensions)
  const unit           = useStore(s => s.unit)
  const draftOpening   = useStore(s => s.draftOpening)
  const selectedRoomId = useStore(s => s.selectedRoomId)

  const columns          = useStore(s => s.columns)
  const selectedColumnId = useStore(s => s.selectedColumnId)
  const projectSettings  = useStore(s => s.projectSettings)
  const currentFloorId   = useStore(s => s.currentFloorId)
  const getColumnsOnFloor = useStore(s => s.getColumnsOnFloor)
  const getNodeIdsByFloor = useStore(s => s.getNodeIdsByFloor)
  const getAllBeams       = useStore(s => s.getAllBeams)
  const addColumn    = useStore(s => s.addColumn)
  const deleteColumn = useStore(s => s.deleteColumn)
  const selectColumn = useStore(s => s.selectColumn)
  const addBeam          = useStore(s => s.addBeam)
  const selectBeam       = useStore(s => s.selectBeam)
  const selectedBeamId   = useStore(s => s.selectedBeamId)
  const layerVisibility  = useStore(s => s.layerVisibility)

  const setTool = useStore(s => s.setTool)
  const {
    getOrCreateNode, addWall, setDrawStart, selectWall, deleteWall,
    splitWall, togglePendingWall, cancelAction,
    addStamp, deleteStamp, selectStamp, moveStamp,
    toggleWallMultiSelect, selectRoom,
    undo, redo,
  } = useStore()

  const svgRef = useRef(null)

  // Floor-switch fade: briefly dim canvas content on currentFloorId change.
  const prevFloorIdRef = useRef(currentFloorId)
  const [floorFading, setFloorFading] = useState(false)
  useEffect(() => {
    if (prevFloorIdRef.current !== currentFloorId) {
      setFloorFading(true)
      prevFloorIdRef.current = currentFloorId
      const t = setTimeout(() => setFloorFading(false), 130)
      return () => clearTimeout(t)
    }
  }, [currentFloorId])

  const [pan,  setPan]  = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const panRef  = useRef({ x: 0, y: 0 })
  const zoomRef = useRef(1)

  const [isPanning,    setIsPanning]    = useState(false)
  const isPanningRef = useRef(false)
  const panStartRef  = useRef(null)
  const [spaceDown,    setSpaceDown]    = useState(false)
  const [shiftDown,    setShiftDown]    = useState(false)
  const [cursor,       setCursor]       = useState(null)   // world inches (Y-up)
  const [hoveredWallId, setHoveredWallId] = useState(null)
  const [lockedLength, setLockedLength] = useState('')
  const [draggingStamp, setDraggingStamp] = useState(null) // { stampId, offX, offY } in world inches
  const [beamFromColId, setBeamFromColId] = useState(null)      // first column selected for beam
  const [beamLevelPicker, setBeamLevelPicker] = useState(null)  // { fromColId, toColId, screenX, screenY }

  useEffect(() => { panRef.current  = pan  }, [pan])
  useEffect(() => { zoomRef.current = zoom }, [zoom])

  // Set initial pan so the world origin (SW corner) appears near bottom-left
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const h = entries[0]?.contentRect.height
      if (!h) return
      const init = { x: 100, y: h - 100 }
      panRef.current = init
      setPan(init)
      ro.disconnect()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Global pan handlers
  useEffect(() => {
    function onMove(e) {
      if (!isPanningRef.current || !panStartRef.current) return
      const newPan = { x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y }
      panRef.current = newPan
      setPan(newPan)
    }
    function onUp() {
      if (!isPanningRef.current) return
      isPanningRef.current = false
      setIsPanning(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  // Non-passive wheel for zoom
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    function onWheel(e) {
      e.preventDefault()
      const z = zoomRef.current, p = panRef.current
      const factor  = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const newZoom = Math.max(0.1, Math.min(10, z * factor))
      const rect    = el.getBoundingClientRect()
      const mx = e.clientX - rect.left, my = e.clientY - rect.top
      const newPan  = { x: mx - (mx - p.x) * newZoom / z, y: my - (my - p.y) * newZoom / z }
      panRef.current = newPan; zoomRef.current = newZoom
      setPan(newPan); setZoom(newZoom)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e) {
      if (e.code === 'Space' && !e.target.closest('input')) { e.preventDefault(); setSpaceDown(true) }
      if (e.key === 'Shift') setShiftDown(true)
      if (e.key === 'Escape') { cancelAction(); setBeamFromColId(null); setBeamLevelPicker(null); return }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return }
      if (e.key === 'Delete') {
        if (selectedColumnId) { deleteColumn(selectedColumnId); selectColumn(null); return }
        if (selectedStampId) { deleteStamp(selectedStampId); return }
        if (selectedWallId)  { deleteWall(selectedWallId);  return }
      }
    }
    function onKeyUp(e) {
      if (e.code === 'Space') setSpaceDown(false)
      if (e.key === 'Shift')  setShiftDown(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup',   onKeyUp)
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp) }
  }, [selectedWallId, selectedStampId, selectedColumnId])

  useEffect(() => { if (!drawStartId) setLockedLength('') }, [drawStartId])

  const startNode    = drawStartId ? nodes[drawStartId] : null
  const parsedLength = parseFloat(lockedLength)
  const hasLock      = !isNaN(parsedLength) && parsedLength > 0

  // ghostEnd is in world inches
  const ghostEnd = startNode && cursor
    ? (hasLock
        ? (shiftDown ? applyLockedLengthFree(startNode, cursor, parsedLength) : applyLockedLength(startNode, cursor, parsedLength))
        : (shiftDown ? cursor : apply90(startNode, cursor.x, cursor.y)))
    : null

  function getRect() { return svgRef.current.getBoundingClientRect() }

  function handleMouseDown(e) {
    if (e.button === 2 || e.button === 1 || (e.button === 0 && spaceDown)) {
      e.preventDefault()
      isPanningRef.current = true
      panStartRef.current  = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y }
      setIsPanning(true)
    }
  }

  function handleMouseMove(e) {
    if (isPanningRef.current) return
    if (draggingStamp) {
      const { x, y } = screenToWorldRaw(e.clientX, e.clientY, getRect(), panRef.current, zoomRef.current)
      moveStamp(draggingStamp.stampId, snapIn(x - draggingStamp.offX), snapIn(y - draggingStamp.offY))
      return
    }
    if (!svgRef.current) return
    setCursor(screenToWorld(e.clientX, e.clientY, getRect(), pan, zoom))
  }

  function handleMouseUp(e) {
    if (draggingStamp) { setDraggingStamp(null); return }
  }

  function handleMouseLeave() { setCursor(null); setHoveredWallId(null); setDraggingStamp(null) }

  function handleColumnClick(e, colId) {
    const shouldCapture = activeTool === 'column' || activeTool === 'select' || activeTool === 'beam'
    if (!shouldCapture) return
    e.stopPropagation()
    if (activeTool === 'beam') {
      if (!beamFromColId) {
        setBeamFromColId(colId)
        return
      }
      if (colId === beamFromColId) { setBeamFromColId(null); return }
      // Second column selected — show level picker near click
      setBeamLevelPicker({ fromColId: beamFromColId, toColId: colId, screenX: e.clientX, screenY: e.clientY })
      setBeamFromColId(null)
      return
    }
    if (activeTool === 'column' || activeTool === 'select') {
      selectColumn(colId)
      selectWall(null)
      selectStamp(null)
    }
  }

  function handleSVGClick(e) {
    if (isPanningRef.current || spaceDown) return

    if (activeTool === 'column') {
      const { x, y } = screenToWorld(e.clientX, e.clientY, getRect(), pan, zoom)
      const nearNode = Object.values(nodes).find(n =>
        Math.hypot(n.x - x, n.y - y) < 24
      )
      const ctId = projectSettings.columnTypes[0]?.id ?? 'C1'
      if (nearNode) {
        addColumn(nearNode.x, nearNode.y, ctId, nearNode.id)
      } else {
        addColumn(x, y, ctId, null)
      }
      return
    }
    if (activeTool === 'beam') {
      // Clicking empty canvas in beam mode — cancel
      setBeamFromColId(null)
      return
    }

    if (STAMP_TOOLS.has(activeTool)) {
      const { x, y } = screenToWorld(e.clientX, e.clientY, getRect(), pan, zoom)
      addStamp(activeTool, x, y)
      setTool('select')
      return
    }

    if (activeTool === 'plumbing') {
      // Phase 1: snap to nearest wall on the current floor and drop the
      // default fixture. Engines subagent owns roomId resolution / routing.
      // Floating type-picker is Phase 1.x polish; for now the user changes
      // the type from PlumbingFixturePanel after placement.
      const { x, y } = screenToWorld(e.clientX, e.clientY, getRect(), pan, zoom)
      const state = useStore.getState()
      // Floor-scoped candidate set so we don't snap to walls on another floor.
      const candidateIds = typeof state.getWallIdsByFloor === 'function'
        ? state.getWallIdsByFloor(currentFloorId)
        : null
      const near = getNearestWallToPoint(state, { x, y }, candidateIds)
      // 36in (3ft) snap radius — beyond that we place a free fixture.
      const SNAP_IN = 36
      let wallId = null, wallT = null, px = x, py = y
      if (near && near.distance <= SNAP_IN) {
        wallId = near.wallId
        wallT  = near.t
        px = near.projected.x
        py = near.projected.y
      }
      const id = useStore.getState().addPlumbingFixture(
        DEFAULT_PLUMBING_FIXTURE_TYPE, px, py, wallId, wallT,
      )
      useStore.getState().selectPlumbingFixture(id)
      return
    }

    if (activeTool === 'electrical') {
      // Phase 1: snap to nearest wall on the current floor and drop the
      // default point. Engines subagent owns roomId resolution / routing.
      // Floating type-picker is Phase 1.x polish; for now the user changes
      // the type from ElectricalPointPanel after placement.
      const { x, y } = screenToWorld(e.clientX, e.clientY, getRect(), pan, zoom)
      const state = useStore.getState()
      // Floor-scoped candidate set so we don't snap to walls on another floor.
      const candidateIds = typeof state.getWallIdsByFloor === 'function'
        ? state.getWallIdsByFloor(currentFloorId)
        : null
      const near = getNearestWallToPoint(state, { x, y }, candidateIds)
      // 36in (3ft) snap radius — beyond that we place a free point.
      const SNAP_IN = 36
      let wallId = null, wallT = null, px = x, py = y
      if (near && near.distance <= SNAP_IN) {
        wallId = near.wallId
        wallT  = near.t
        px = near.projected.x
        py = near.projected.y
      }
      const id = useStore.getState().addElectricalPoint(
        DEFAULT_ELECTRICAL_POINT_TYPE, px, py, wallId, wallT,
      )
      useStore.getState().selectElectricalPoint(id)
      return
    }

    if (activeTool === 'hvac') {
      // Phase 1: snap to nearest wall on the current floor and drop the
      // default unit. Engines subagent owns roomId resolution / routing.
      // Floating type-picker is Phase 1.x polish; for now the user changes
      // the type from HvacPanel after placement.
      const { x, y } = screenToWorld(e.clientX, e.clientY, getRect(), pan, zoom)
      const state = useStore.getState()
      const candidateIds = typeof state.getWallIdsByFloor === 'function'
        ? state.getWallIdsByFloor(currentFloorId)
        : null
      const near = getNearestWallToPoint(state, { x, y }, candidateIds)
      const SNAP_IN = 36
      let wallId = null, wallT = null, px = x, py = y
      if (near && near.distance <= SNAP_IN) {
        wallId = near.wallId
        wallT  = near.t
        px = near.projected.x
        py = near.projected.y
      }
      const id = useStore.getState().addHvacUnit(
        DEFAULT_HVAC_UNIT_TYPE, px, py, wallId, wallT,
      )
      useStore.getState().selectHvacUnit(id)
      return
    }

    if (activeTool === 'fire') {
      // Phase 1: snap to nearest wall on the current floor and drop the
      // default device. Engines subagent owns roomId resolution / routing.
      // Floating type-picker is Phase 1.x polish; for now the user changes
      // the type from FirePanel after placement.
      const { x, y } = screenToWorld(e.clientX, e.clientY, getRect(), pan, zoom)
      const state = useStore.getState()
      const candidateIds = typeof state.getWallIdsByFloor === 'function'
        ? state.getWallIdsByFloor(currentFloorId)
        : null
      const near = getNearestWallToPoint(state, { x, y }, candidateIds)
      const SNAP_IN = 36
      let wallId = null, wallT = null, px = x, py = y
      if (near && near.distance <= SNAP_IN) {
        wallId = near.wallId
        wallT  = near.t
        px = near.projected.x
        py = near.projected.y
      }
      const id = useStore.getState().addFireDevice(
        DEFAULT_FIRE_DEVICE_TYPE, px, py, wallId, wallT,
      )
      useStore.getState().selectFireDevice(id)
      return
    }

    if (activeTool === 'elv') {
      // Phase 1: snap to nearest wall on the current floor and drop the
      // default device. Engines subagent owns roomId resolution / routing.
      // Floating type-picker is Phase 1.x polish; for now the user changes
      // the type from ElvPanel after placement.
      const { x, y } = screenToWorld(e.clientX, e.clientY, getRect(), pan, zoom)
      const state = useStore.getState()
      const candidateIds = typeof state.getWallIdsByFloor === 'function'
        ? state.getWallIdsByFloor(currentFloorId)
        : null
      const near = getNearestWallToPoint(state, { x, y }, candidateIds)
      const SNAP_IN = 36
      let wallId = null, wallT = null, px = x, py = y
      if (near && near.distance <= SNAP_IN) {
        wallId = near.wallId
        wallT  = near.t
        px = near.projected.x
        py = near.projected.y
      }
      const id = useStore.getState().addElvDevice(
        DEFAULT_ELV_DEVICE_TYPE, px, py, wallId, wallT,
      )
      useStore.getState().selectElvDevice(id)
      return
    }

    if (activeTool === 'select') { selectWall(null); selectStamp(null); selectColumn(null); return }
    if (activeTool !== 'draw') return

    const { x, y } = screenToWorld(e.clientX, e.clientY, getRect(), pan, zoom)
    if (!drawStartId) { setDrawStart(getOrCreateNode(x, y)); return }
    const snapped = hasLock
      ? (shiftDown ? applyLockedLengthFree(startNode, { x, y }, parsedLength) : applyLockedLength(startNode, { x, y }, parsedLength))
      : (shiftDown ? { x, y } : apply90(startNode, x, y))
    const endNodeId = getOrCreateNode(snapped.x, snapped.y)
    if (endNodeId === drawStartId) { setDrawStart(null); return }
    addWall(drawStartId, endNodeId)
    setDrawStart(endNodeId)
  }

  function handleWallClick(e, wallId) {
    if (activeTool === 'select') {
      e.stopPropagation()
      if (e.ctrlKey || e.metaKey) { toggleWallMultiSelect(wallId) }
      else                        { selectWall(wallId) }
      return
    }
    if (activeTool === 'split') {
      e.stopPropagation()
      const wall = walls[wallId]
      const a = nodes[wall.n1], b = nodes[wall.n2]
      const { x, y } = screenToWorldRaw(e.clientX, e.clientY, getRect(), pan, zoom)
      const pt = closestPointOnSegment(x, y, a.x, a.y, b.x, b.y)
      splitWall(wallId, pt.x, pt.y)
      return
    }
    if (activeTool === 'room') { e.stopPropagation(); togglePendingWall(wallId) }
  }

  function handleStampClick(e, stampId) {
    if (activeTool === 'select') { e.stopPropagation(); selectStamp(stampId) }
  }

  function handleStampMouseDown(e, stamp) {
    if (activeTool !== 'select' || e.button !== 0) return
    e.stopPropagation()
    selectStamp(stamp.id)
    useStore.getState()._save()
    const { x, y } = screenToWorldRaw(e.clientX, e.clientY, getRect(), panRef.current, zoomRef.current)
    setDraggingStamp({ stampId: stamp.id, offX: x - stamp.x, offY: y - stamp.y })
  }

  const svgCursor     = isPanning || spaceDown ? 'grab' : (TOOL_CURSOR[activeTool] || 'default')
  const wallHitCursor = ['select', 'split', 'room'].includes(activeTool) ? 'pointer' : 'default'
  const zoomPct       = Math.round(zoom * 100)

  // Phase 1.9 — per-floor visibility. Single-floor projects auto-match (everything tagged 'F1').
  // Multi-floor: entities on the current floor render full opacity; others render as ghost
  // (opacity 0.15, no pointer events) so the user retains spatial context.
  const floorsList     = projectSettings?.floors ?? []
  const multiFloor     = floorsList.length > 1
  const floorOf        = (e) => e?.floorId ?? 'F1'
  const ghostStyle     = { opacity: 0.15, pointerEvents: 'none' }
  const activeStyle    = { opacity: 1 }
  const entityStyle    = (entity) => !multiFloor || floorOf(entity) === currentFloorId ? activeStyle : ghostStyle
  // Column visibility honours span [baseFloorId, topFloorId].
  const columnIdsOnCurrentFloor = new Set(
    multiFloor ? getColumnsOnFloor(currentFloorId).map(c => c.id) : Object.keys(columns)
  )
  const columnStyle = (col) => !multiFloor || columnIdsOnCurrentFloor.has(col.id) ? activeStyle : ghostStyle

  // Empty-state overlay: shown when the project has no walls, rooms, columns,
  // or stamps. Pure UI signal — nothing in the store depends on it.
  const isEmpty =
    Object.keys(walls).length   === 0 &&
    Object.keys(rooms).length   === 0 &&
    Object.keys(columns).length === 0 &&
    Object.keys(stamps).length  === 0

  return (
    <>
    {/* Empty-state overlay — points to the toolbar (top-left) */}
    {isEmpty && (
      <div className="canvas-empty-state">
        <div className="canvas-empty-state__arrow" aria-hidden="true">↖</div>
        <div className="canvas-empty-state__title">Draw your first wall to get started</div>
        <div className="canvas-empty-state__hint">
          Select the <strong>Draw</strong> tool in the toolbar, then click two points on the canvas.
        </div>
      </div>
    )}

    {/* Beam level picker overlay */}
    {beamLevelPicker && (
      <div style={{
        position: 'fixed',
        top: beamLevelPicker.screenY - 60,
        left: beamLevelPicker.screenX + 8,
        background: '#fff', border: '1px solid #ccc', borderRadius: 6,
        padding: '6px 8px', zIndex: 50,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        <div style={{ fontSize: 11, color: '#555', marginBottom: 2 }}>Add beam at level:</div>
        {BEAM_LEVEL_REGISTRY.map(lvl => (
          <button key={lvl.id}
            onClick={() => {
              addBeam(beamLevelPicker.fromColId, beamLevelPicker.toColId, lvl.id)
              setBeamLevelPicker(null)
            }}
            style={{ padding: '3px 10px', fontSize: 12, cursor: 'pointer',
              background: lvl.color + '22',
              border: '1px solid #ddd', borderRadius: 4 }}>
            {lvl.label}
          </button>
        ))}
        <button onClick={() => { setBeamLevelPicker(null); setBeamFromColId(null) }}
          style={{ padding: '2px 6px', fontSize: 10, cursor: 'pointer', background: '#f5f5f5',
            border: '1px solid #ddd', borderRadius: 4, color: '#888' }}>
          Cancel
        </button>
      </div>
    )}

    {/* Length input panel */}
    {activeTool === 'draw' && drawStartId && (
      <div style={{
        position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
        background: '#fff', border: '1px solid #ccc', borderRadius: 8,
        padding: '8px 14px', zIndex: 20, display: 'flex', alignItems: 'center',
        gap: 8, fontSize: 13, boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      }}>
        <span style={{ color: '#555' }}>Length</span>
        <input type="number" value={lockedLength} min={1} placeholder="free"
          onChange={e => setLockedLength(e.target.value)}
          onKeyDown={e => e.stopPropagation()}
          style={{ width: 64, padding: '3px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: 13 }}
        />
        <span style={{ color: '#999', fontSize: 11 }}>ft</span>
        {lockedLength && (
          <button onClick={() => setLockedLength('')}
            style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 14 }}>×</button>
        )}
      </div>
    )}

    {/* Zoom indicator + reset */}
    <div style={{ position: 'absolute', bottom: 16, left: 16, zIndex: 20, display: 'flex', alignItems: 'center', gap: 6 }}>
      <button onClick={() => { setPan({ x: 0, y: 0 }); setZoom(1) }}
        style={{ background: '#fff', border: '1px solid #ccc', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: '#555' }}>
        Reset
      </button>
      <div style={{ background: '#fff', border: '1px solid #ccc', borderRadius: 6, padding: '4px 10px', fontSize: 12, color: '#555' }}>
        {zoomPct}%
      </div>
    </div>

    {/* Stamp tool hint */}
    {STAMP_TOOLS.has(activeTool) && (
      <div style={{ position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
        background: '#fff', border: '1px solid #ccc', borderRadius: 8, padding: '6px 14px',
        zIndex: 20, fontSize: 12, color: '#555' }}>
        Click to place {
          activeTool === 'stairs'        ? 'staircase'    :
          activeTool === 'lift'          ? 'lift'          :
          activeTool === 'sump'          ? 'sump'          :
          activeTool === 'overhead_tank' ? 'overhead tank' :
                                           'septic tank'
        } — switch to Select to move/delete
      </div>
    )}

    <svg
      ref={svgRef}
      width="100%" height="100%"
      style={{ background: '#f5f5f5', display: 'block', cursor: svgCursor }}
      onClick={handleSVGClick}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onContextMenu={e => e.preventDefault()}
    >
      <defs>
        <pattern id="smallGrid" width={FOOT_PX} height={FOOT_PX} patternUnits="userSpaceOnUse">
          <path d={`M ${FOOT_PX} 0 L 0 0 0 ${FOOT_PX}`} fill="none" stroke="#e0e0e0" strokeWidth={0.5}/>
        </pattern>
        <pattern id="grid" width={FOOT_PX*5} height={FOOT_PX*5} patternUnits="userSpaceOnUse">
          <rect width={FOOT_PX*5} height={FOOT_PX*5} fill="url(#smallGrid)"/>
          <path d={`M ${FOOT_PX*5} 0 L 0 0 0 ${FOOT_PX*5}`} fill="none" stroke="#ccc" strokeWidth={1}/>
        </pattern>
        <pattern id="stairHatch" width={FOOT_PX} height={FOOT_PX*0.6} patternUnits="userSpaceOnUse">
          <line x1="0" y1={FOOT_PX*0.6} x2={FOOT_PX} y2={FOOT_PX*0.6} stroke="#aaa" strokeWidth={0.8}/>
        </pattern>
      </defs>

      <g
        transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}
        className="canvas-floor-layer"
        data-fading={floorFading ? 'true' : 'false'}
      >

        {/* Grid */}
        <rect x="-10000" y="-10000" width="30000" height="30000" fill="url(#grid)"/>

        {layerVisibility.roomFills && (<>
        {/* Room fills */}
        {Object.values(rooms).map((room, idx) => {
          const fStyle = entityStyle(room)
          if (!isRoomValid(room.id)) {
            // Draw dashed red segments for each wall that still exists — broken outline shows corrupt state
            return (
              <g key={room.id} style={fStyle}>
                {room.wallIds.map(wid => {
                  const w = walls[wid]; if (!w) return null
                  const a = nodes[w.n1], b = nodes[w.n2]; if (!a || !b) return null
                  return <line key={wid}
                    x1={sx(a.x)} y1={sy(a.y)} x2={sx(b.x)} y2={sy(b.y)}
                    stroke="#e74c3c" strokeWidth={2} strokeDasharray="6,4" opacity={0.6}
                    style={{ pointerEvents: 'none' }} />
                })}
              </g>
            )
          }
          const poly = getRoomPolygon(room.id)
          if (!poly || poly.length < 3) return null
          const pts   = poly.map(p => `${sx(p.x)},${sy(p.y)}`).join(' ')
          const color = ROOM_COLORS[idx % ROOM_COLORS.length]
          const isSel = room.id === selectedRoomId
          return (
            <g key={room.id} style={fStyle}>
              {isSel && (
                <polygon
                  key={`pulse-room-${room.id}`}
                  className="canvas-selection-pulse"
                  points={pts}
                  fill="var(--color-primary)"
                  stroke="var(--color-primary)" strokeWidth={4}
                />
              )}
              <polygon points={pts}
                fill={isSel ? 'var(--color-primary-bg)' : color}
                fillOpacity={isSel ? 1 : 0.12}
                stroke={isSel ? 'var(--color-primary)' : color}
                strokeOpacity={isSel ? 1 : 0.3}
                strokeWidth={isSel ? 2 : 1}
                strokeDasharray={isSel ? 'none' : undefined}
                style={{ cursor: activeTool === 'select' ? 'pointer' : 'default' }}
                onClick={activeTool === 'select' ? e => { e.stopPropagation(); selectRoom(room.id) } : undefined}
              />
            </g>
          )
        })}
        </>)}

        {layerVisibility.stamps && (<>
        {/* Stamps — x/y is bottom-left corner in world inches */}
        {Object.values(stamps).map(stamp => {
          const isSelected = stamp.id === selectedStampId
          const color    = isSelected ? 'var(--color-primary)' : '#555'
          const isDragging = draggingStamp?.stampId === stamp.id
          // SVG rect: top-left = (sx, sy of top-left corner in Y-up = (stamp.x, stamp.y+stamp.h))
          const rx = sx(stamp.x)
          const ry = sy(stamp.y + stamp.h)   // Y-flip: top in SVG = -(bottom + height)
          const rw = stamp.w * PX_PER_INCH
          const rh = stamp.h * PX_PER_INCH
          const cx = sx(stamp.x + stamp.w / 2)
          const cy = sy(stamp.y + stamp.h / 2)
          const fStamp = entityStyle(stamp)
          return (
            <g key={stamp.id}
              onClick={e => handleStampClick(e, stamp.id)}
              onMouseDown={e => handleStampMouseDown(e, stamp)}
              style={{
                cursor: activeTool === 'select' ? (isDragging ? 'grabbing' : 'grab') : 'default',
                opacity: fStamp.opacity,
                pointerEvents: fStamp.pointerEvents ?? 'auto',
              }}>
              {stamp.type === 'stairs' ? (
                <>
                  <rect x={rx} y={ry} width={rw} height={rh}
                    fill="url(#stairHatch)" stroke={color} strokeWidth={isSelected ? 2 : 1.5}/>
                  <rect x={rx} y={ry} width={rw} height={rh}
                    fill="none" stroke={color} strokeWidth={isSelected ? 2 : 1.5}/>
                  <text x={cx} y={cy}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={10} fontWeight="600" fill={color}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    STAIRS
                  </text>
                </>
              ) : stamp.type === 'lift' ? (
                <>
                  <rect x={rx} y={ry} width={rw} height={rh}
                    fill="#e8f0f8" stroke={color} strokeWidth={isSelected ? 2 : 1.5}/>
                  <circle cx={cx} cy={cy}
                    r={Math.min(rw, rh) * 0.32}
                    fill="none" stroke={color} strokeWidth={1}/>
                  <text x={cx} y={cy}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={10} fontWeight="600" fill={color}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    LIFT
                  </text>
                </>
              ) : stamp.type === 'sump' ? (
                <>
                  <rect x={rx} y={ry} width={rw} height={rh}
                    fill="#dce8f5" stroke={color} strokeWidth={isSelected ? 2 : 1.5}
                    strokeDasharray={isSelected ? undefined : '5 3'}/>
                  <text x={cx} y={cy}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={10} fontWeight="600" fill={color}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {stamp.name || 'SUMP'}
                  </text>
                </>
              ) : stamp.type === 'overhead_tank' ? (
                <>
                  <rect x={rx} y={ry} width={rw} height={rh}
                    fill="#d4eaf7" stroke={color} strokeWidth={isSelected ? 2 : 1.5}/>
                  <rect x={rx + rw * 0.1} y={ry + rh * 0.1} width={rw * 0.8} height={rh * 0.8}
                    fill="none" stroke={color} strokeWidth={0.8}/>
                  <text x={cx} y={cy}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={10} fontWeight="600" fill={color}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {stamp.name || 'OHT'}
                  </text>
                </>
              ) : (
                // septic_tank
                <>
                  <rect x={rx} y={ry} width={rw} height={rh}
                    fill="#e8f0e0" stroke={color} strokeWidth={isSelected ? 2 : 1.5}/>
                  <line x1={rx + rw * 0.5} y1={ry} x2={rx + rw * 0.5} y2={ry + rh}
                    stroke={color} strokeWidth={0.8} opacity={0.5}
                    style={{ pointerEvents: 'none' }}/>
                  <text x={cx} y={cy}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={10} fontWeight="600" fill={color}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {stamp.name || 'SEPTIC'}
                  </text>
                </>
              )}
            </g>
          )
        })}

        {/* One-shot pulse on newly-selected stamp (key remounts on id change). */}
        {selectedStampId && stamps[selectedStampId] && (() => {
          const stamp = stamps[selectedStampId]
          const rx = sx(stamp.x)
          const ry = sy(stamp.y + stamp.h)
          const rw = stamp.w * PX_PER_INCH
          const rh = stamp.h * PX_PER_INCH
          return (
            <rect
              key={`pulse-stamp-${selectedStampId}`}
              className="canvas-selection-pulse"
              x={rx - 4} y={ry - 4} width={rw + 8} height={rh + 8}
              fill="none" stroke="var(--color-primary)" strokeWidth={4}
            />
          )
        })()}
        </>)}

        {layerVisibility.walls && (<>
        {/* Walls */}
        {Object.values(walls).map(wall => {
          const a = nodes[wall.n1], b = nodes[wall.n2]
          if (!a || !b) return null
          const isSelected      = wall.id === selectedWallId
          const isMultiSelected = selectedWallIds.includes(wall.id)
          const isPending       = pendingWallIds.includes(wall.id)
          const isHovered       = wall.id === hoveredWallId
          const isVirtual       = wall.isVirtual ?? false
          const isSelectedAny   = isSelected || isMultiSelected
          const color = isPending       ? '#27ae60'
                      : isSelectedAny   ? 'var(--color-primary)'
                      : wall.isPlot     ? '#a0522d'
                      : isVirtual       ? '#888'
                      : '#333'
          const thickPx = Math.max(2, (wall.thickness ?? DEFAULT_WALL_THICK_IN) * PX_PER_INCH)
          const baseStroke = isVirtual ? 1.5 : thickPx
          const strokeW = isSelectedAny ? baseStroke + 2
                        : isPending     ? baseStroke + 2
                        : baseStroke
          const glowW   = baseStroke + 6
          const dashArray = isVirtual ? '8 5' : undefined
          const hitW      = Math.max(14, thickPx + 8)
          const len       = wallLength(a, b)
          // SVG-group coords for the wall nodes
          const ax = sx(a.x), ay = sy(a.y)
          const bx = sx(b.x), by = sy(b.y)
          const mx = (ax + bx) / 2
          const my = (ay + by) / 2
          const angle = Math.atan2(by - ay, bx - ax)
          const perpX = -Math.sin(angle) * 10
          const perpY =  Math.cos(angle) * 10
          // Wall total length in SVG pixels (for opening geometry)
          const totalPx = Math.hypot(bx - ax, by - ay)
          const ux = totalPx > 0 ? (bx - ax) / totalPx : 0
          const uy = totalPx > 0 ? (by - ay) / totalPx : 0
          const fWall = entityStyle(wall)
          return (
            <g key={wall.id} onClick={e => handleWallClick(e, wall.id)}
              onMouseEnter={() => setHoveredWallId(wall.id)}
              onMouseLeave={() => setHoveredWallId(null)}
              style={{ opacity: fWall.opacity, pointerEvents: fWall.pointerEvents ?? 'auto' }}>
              <line x1={ax} y1={ay} x2={bx} y2={by}
                stroke="transparent" strokeWidth={hitW} style={{ cursor: wallHitCursor }}/>
              {isSelectedAny && (
                <line x1={ax} y1={ay} x2={bx} y2={by}
                  stroke="var(--color-primary)" strokeWidth={glowW}
                  strokeLinecap="round" opacity={0.18}
                  style={{ pointerEvents: 'none' }}/>
              )}
              {(() => {
                const { segments, gaps } = getWallSegments(a, b, wall.openings)
                return <>
                  {segments.map((s, i) => (
                    <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
                      stroke={color} strokeWidth={strokeW} strokeLinecap="round"
                      strokeDasharray={dashArray}
                      style={{ pointerEvents: 'none' }}/>
                  ))}
                  {gaps.map((g, i) => g.type === 'window'
                    ? <line key={i} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}
                        stroke="#88aaff" strokeWidth={1.5} strokeDasharray="4 3"
                        style={{ pointerEvents: 'none' }}/>
                    : null
                  )}
                </>
              })()}
              {/* Per-opening hit targets — clickable when select tool active.
                  Renders a transparent fat stroke over each opening's gap
                  region so users can click the door/window directly on the
                  canvas. Inside the wall <g>, so floor-ghost opacity applies. */}
              {activeTool === 'select' && fWall.pointerEvents !== 'none' &&
                (wall.openings || []).map(op => {
                  if (totalPx === 0) return null
                  const gStart = Math.min(op.offset * PX_PER_INCH, totalPx)
                  const gEnd   = Math.min(gStart + op.width * PX_PER_INCH, totalPx)
                  if (gEnd - gStart <= 0) return null
                  const x1 = ax + gStart * ux
                  const y1 = ay + gStart * uy
                  const x2 = ax + gEnd   * ux
                  const y2 = ay + gEnd   * uy
                  const isSel = selectedOpening?.wallId === wall.id &&
                                selectedOpening?.openingId === op.id
                  return (
                    <g key={`opening-hit-${op.id}`}>
                      <line x1={x1} y1={y1} x2={x2} y2={y2}
                        stroke="transparent" strokeWidth={14}
                        onMouseDown={e => {
                          e.stopPropagation()
                          selectOpening(wall.id, op.id)
                        }}
                        style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                      />
                      {isSel && (
                        <line
                          key={`pulse-opening-${op.id}`}
                          className="canvas-selection-pulse"
                          x1={x1} y1={y1} x2={x2} y2={y2}
                          stroke="var(--color-primary)" strokeWidth={10}
                          strokeLinecap="round"
                          style={{ pointerEvents: 'none' }}
                        />
                      )}
                    </g>
                  )
                })
              }
              {/* Door swing arcs — computed in SVG-group space (Y-flipped ux/uy correct for screen) */}
              {(wall.openings || []).filter(op => op.type === 'door').map(op => {
                if (totalPx === 0) return null
                const gStart = Math.min(op.offset * PX_PER_INCH, totalPx)
                const gEnd   = Math.min(gStart + op.width * PX_PER_INCH, totalPx)
                const doorW  = gEnd - gStart
                if (doorW <= 0) return null
                const orient       = op.orient ?? 0
                const hingeAtStart = orient === 0 || orient === 1
                const openLeft     = orient === 0 || orient === 2
                const hx = ax + (hingeAtStart ? gStart : gEnd) * ux
                const hy = ay + (hingeAtStart ? gStart : gEnd) * uy
                const nx = openLeft ? -uy : uy
                const ny = openLeft ?  ux : -ux
                const dx = hx + doorW * nx
                const dy = hy + doorW * ny
                const ax2 = ax + (hingeAtStart ? gEnd : gStart) * ux
                const ay2 = ay + (hingeAtStart ? gEnd : gStart) * uy
                const sweep = (orient === 0 || orient === 3) ? 1 : 0
                return (
                  <g key={op.id} style={{ pointerEvents: 'none' }}>
                    <line x1={hx} y1={hy} x2={dx} y2={dy}
                      stroke={color} strokeWidth={1} strokeLinecap="round"/>
                    <path d={`M ${ax2} ${ay2} A ${doorW} ${doorW} 0 0 ${sweep} ${dx} ${dy}`}
                      fill="none" stroke={color} strokeWidth={0.8} strokeDasharray="3 2"/>
                  </g>
                )
              })}
              {(isHovered || isSelected || isMultiSelected || isPending || showDimensions) && (
                <text x={mx + perpX} y={my + perpY}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={11} fontWeight={isHovered || isSelected ? '700' : '500'}
                  fill={isHovered || isSelected ? '#222' : '#555'}
                  stroke="white" strokeWidth={3} paintOrder="stroke"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  {fmtLen(len, unit)}
                </text>
              )}
            </g>
          )
        })}

        {/* One-shot pulse on newly-selected wall (key remounts on id change). */}
        {selectedWallId && walls[selectedWallId] && nodes[walls[selectedWallId].n1] && nodes[walls[selectedWallId].n2] && (() => {
          const w = walls[selectedWallId]
          const a = nodes[w.n1], b = nodes[w.n2]
          return (
            <line
              key={`pulse-wall-${selectedWallId}`}
              className="canvas-selection-pulse"
              x1={sx(a.x)} y1={sy(a.y)} x2={sx(b.x)} y2={sy(b.y)}
              stroke="var(--color-primary)" strokeWidth={12} strokeLinecap="round"
            />
          )
        })()}
        </>)}

        {layerVisibility.beams && (<>
        {/* Beams */}
        {getAllBeams().map(beam => {
          const fromPos = beam.endpoints.from.type === 'COLUMN'
            ? getColPos(columns[beam.endpoints.from.columnId], nodes)
            : beam.endpoints.from
          const toPos = beam.endpoints.to.type === 'COLUMN'
            ? getColPos(columns[beam.endpoints.to.columnId], nodes)
            : beam.endpoints.to
          if (!fromPos || !toPos) return null
          const color = BEAM_LEVEL_REGISTRY.find(l => l.id === beam.level)?.color ?? '#888'
          const isDerived = beam.source === 'WALL_DERIVED'
          const dash  = isDerived ? '6 3' : undefined
          // Wall-derived beams inherit floor from their source wall; explicit beams carry floorId.
          const beamFloorId = isDerived
            ? walls[beam.sourceWallId]?.floorId
            : beam.floorId
          const fBeam = entityStyle({ floorId: beamFloorId })
          // Phase 1.7+ — explicit beams are selectable (click → selectBeam).
          // Wall-derived beams stay unselectable by design.
          const isSelected = !isDerived && beam.id === selectedBeamId
          const clickable = !isDerived && activeTool === 'select'
          const strokeW = isSelected ? 6 : 3
          const beamStroke = isSelected ? 'var(--color-primary)' : color
          const beamOpacity = isSelected ? 1 : 0.7 * (fBeam.opacity ?? 1)
          return (
            <g key={beam.id}>
              {/* Wider invisible hit target for easier clicking */}
              {clickable && (
                <line
                  x1={sx(fromPos.x)} y1={sy(fromPos.y)} x2={sx(toPos.x)} y2={sy(toPos.y)}
                  stroke="transparent" strokeWidth={14}
                  style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                  onMouseDown={(e) => { e.stopPropagation(); selectBeam(beam.id) }}
                />
              )}
              {isSelected && (
                <line
                  x1={sx(fromPos.x)} y1={sy(fromPos.y)} x2={sx(toPos.x)} y2={sy(toPos.y)}
                  stroke="var(--color-primary)" strokeWidth={strokeW + 6}
                  strokeLinecap="round" opacity={0.18}
                  style={{ pointerEvents: 'none' }}
                />
              )}
              <line
                x1={sx(fromPos.x)} y1={sy(fromPos.y)} x2={sx(toPos.x)} y2={sy(toPos.y)}
                stroke={beamStroke} strokeWidth={strokeW} strokeOpacity={beamOpacity}
                strokeDasharray={dash}
                style={{ pointerEvents: 'none' }}
              />
              {isSelected && (
                <line
                  key={`pulse-beam-${beam.id}`}
                  className="canvas-selection-pulse"
                  x1={sx(fromPos.x)} y1={sy(fromPos.y)} x2={sx(toPos.x)} y2={sy(toPos.y)}
                  stroke="var(--color-primary)" strokeWidth={12} strokeLinecap="round"
                />
              )}
            </g>
          )
        })}
        </>)}

        {/* Plumbing overlay (fixtures, supply/drain routes, risers).
         * Renders between beams and nodes per CLAUDE.md MEP plan §16.2. */}
        <PlumbingOverlay />

        {/* Electrical overlay (points, wiring/submain routes, submain risers).
         * Renders right after plumbing, before nodes, per CLAUDE.md MEP plan §16.2. */}
        <ElectricalOverlay />

        {/* HVAC overlay (indoor/outdoor units, refrigerant/condensate routes,
         * HVAC risers). Renders right after electrical, before nodes. */}
        <HvacOverlay />

        {/* Fire overlay (detection + suppression devices, detection /
         * sprinkler routes, FIRE_MAIN risers). Renders right after HVAC. */}
        <FireOverlay />

        {/* ELV overlay (extra-low-voltage devices, CCTV / data routes).
         * Renders right after fire, before nodes. */}
        <ElvOverlay />

        {/* Clash overlay — cross-discipline route intersection markers
         * (Phase 2.5). Mounts above every MEP overlay so clash diamonds
         * stay visible on top of the routes that produced them, but
         * below the UI overlays / nodes / columns layers. */}
        <ClashOverlay />

        {/* Ghost line while drawing */}
        {startNode && ghostEnd && (() => {
          const saX = sx(startNode.x), saY = sy(startNode.y)
          const geX = sx(ghostEnd.x),  geY = sy(ghostEnd.y)
          const len       = wallLength(startNode, ghostEnd)
          const mx        = (saX + geX) / 2
          const my        = (saY + geY) / 2
          const ghostColor = drawVirtual ? '#888' : shiftDown ? '#e67e22' : '#4a90e2'
          const ghostDash  = drawVirtual ? '8 5' : '6 4'
          return (
            <g style={{ pointerEvents: 'none' }}>
              <line x1={saX} y1={saY} x2={geX} y2={geY}
                stroke={ghostColor} strokeWidth={drawVirtual ? 1.5 : 2} strokeDasharray={ghostDash}/>
              <text x={mx} y={my - 10} textAnchor="middle" fontSize={11} fill={ghostColor}>
                {fmtLen(len, unit)}
              </text>
            </g>
          )
        })()}

        {layerVisibility.nodes && (<>
        {/* Nodes — floor-aware ownership via node.floorIds[]. Single-floor
         * projects render every node active. Multi-floor: dim nodes whose
         * floorIds don't include currentFloorId. Topology is floor-scoped:
         * a node at the same XY as one on another floor is a DISTINCT entity.
         * Vertical relationships are explicit, never inferred from coords. */}
        {(() => {
          const activeNodeIds = multiFloor
            ? getNodeIdsByFloor(currentFloorId)
            : null
          return Object.values(nodes).map(node => {
            const isStart      = node.id === drawStartId
            const onActiveFloor = !multiFloor || activeNodeIds.has(node.id)
            return (
              <circle key={node.id} cx={sx(node.x)} cy={sy(node.y)}
                r={isStart ? 7 : 5} fill={isStart ? '#e74c3c' : '#4a90e2'}
                stroke="#fff" strokeWidth={2}
                opacity={onActiveFloor ? 1 : 0.15}
                style={{
                  pointerEvents: onActiveFloor ? 'auto' : 'none',
                  cursor: 'default',
                }}/>
            )
          })
        })()}
        </>)}

        {layerVisibility.columns && (<>
        {/* Columns */}
        {Object.values(columns).map(col => {
          const pos = getColPos(col, nodes)
          const ct  = projectSettings.columnTypes.find(t => t.id === col.columnTypeId)
          if (!ct) return null
          const isSelected = col.id === selectedColumnId
          const strokeColor = isSelected ? 'var(--color-primary)' : col.attachedNodeId ? '#2471a3' : '#555'
          const fillColor   = isSelected ? 'var(--color-primary-bg)' : col.attachedNodeId ? '#d6eaf8' : '#ecf0f1'
          const strokeW     = isSelected ? 2 : 1.5
          const fCol = columnStyle(col)

          const dims = getColumnSvgDims(ct, PX_PER_INCH)
          if (dims.r !== undefined) {
            return (
              <circle key={col.id}
                cx={sx(pos.x)} cy={sy(pos.y)} r={dims.r}
                fill={fillColor} stroke={strokeColor} strokeWidth={strokeW}
                opacity={fCol.opacity}
                style={{
                  cursor: activeTool === 'column' || activeTool === 'select' ? 'pointer' : 'default',
                  pointerEvents: fCol.pointerEvents ?? 'auto',
                }}
                onClick={e => handleColumnClick(e, col.id)}
              />
            )
          }
          return (
            <rect key={col.id}
              x={sx(pos.x) - dims.w/2} y={sy(pos.y) - dims.h/2} width={dims.w} height={dims.h}
              fill={fillColor} stroke={strokeColor} strokeWidth={strokeW}
              opacity={fCol.opacity}
              style={{
                cursor: activeTool === 'column' || activeTool === 'select' ? 'pointer' : 'default',
                pointerEvents: fCol.pointerEvents ?? 'auto',
              }}
              onClick={e => handleColumnClick(e, col.id)}
            />
          )
        })}

        {/* One-shot pulse on newly-selected column (key remounts on id change). */}
        {selectedColumnId && columns[selectedColumnId] && (() => {
          const col = columns[selectedColumnId]
          const ct  = projectSettings.columnTypes.find(t => t.id === col.columnTypeId)
          if (!ct) return null
          const pos = getColPos(col, nodes)
          const dims = getColumnSvgDims(ct, PX_PER_INCH)
          if (dims.r !== undefined) {
            return (
              <circle
                key={`pulse-col-${selectedColumnId}`}
                className="canvas-selection-pulse"
                cx={sx(pos.x)} cy={sy(pos.y)} r={dims.r + 6}
                fill="none" stroke="var(--color-primary)" strokeWidth={4}
              />
            )
          }
          return (
            <rect
              key={`pulse-col-${selectedColumnId}`}
              className="canvas-selection-pulse"
              x={sx(pos.x) - dims.w/2 - 4} y={sy(pos.y) - dims.h/2 - 4}
              width={dims.w + 8} height={dims.h + 8}
              fill="none" stroke="var(--color-primary)" strokeWidth={4}
            />
          )
        })()}
        </>)}

        {/* Beam tool: ghost line from selected first column to cursor */}
        {activeTool === 'beam' && beamFromColId && cursor && (() => {
          const fromCol = columns[beamFromColId]
          if (!fromCol) return null
          const pos = getColPos(fromCol, nodes)
          return (
            <line
              x1={sx(pos.x)} y1={sy(pos.y)} x2={sx(cursor.x)} y2={sy(cursor.y)}
              stroke="#9b59b6" strokeWidth={2} strokeDasharray="6 3" opacity={0.7}
              style={{ pointerEvents: 'none' }}
            />
          )
        })()}

        {/* Room-mode corner indicators */}
        {activeTool === 'room' && pendingWallIds.length > 0 && (() => {
          const connections = {}
          pendingWallIds.forEach(wid => {
            const w = walls[wid]; if (!w) return
            connections[w.n1] = (connections[w.n1] || 0) + 1
            connections[w.n2] = (connections[w.n2] || 0) + 1
          })
          return Object.entries(connections).map(([nodeId, count]) => {
            const node = nodes[nodeId]; if (!node) return null
            const closed = count >= 2
            const nx = sx(node.x), ny = sy(node.y)
            return (
              <g key={nodeId} style={{ pointerEvents: 'none' }}>
                <circle cx={nx} cy={ny} r={9} fill={closed ? '#27ae60' : '#e74c3c'} opacity={0.2}/>
                <circle cx={nx} cy={ny} r={6} fill={closed ? '#27ae60' : '#e74c3c'} stroke="#fff" strokeWidth={2}/>
                <text x={nx} y={ny} textAnchor="middle" dominantBaseline="middle"
                  fontSize={8} fill="#fff" fontWeight="700">
                  {closed ? '✓' : '!'}
                </text>
              </g>
            )
          })
        })()}

        {/* Live opening preview on selected wall */}
        {selectedWallId && draftOpening && (() => {
          const wall = walls[selectedWallId]
          if (!wall) return null
          const a = nodes[wall.n1], b = nodes[wall.n2]
          if (!a || !b) return null
          const ax = sx(a.x), ay = sy(a.y)
          const bx = sx(b.x), by = sy(b.y)
          const totalPx = Math.hypot(bx - ax, by - ay)
          if (totalPx === 0) return null
          const ux = (bx - ax) / totalPx
          const uy = (by - ay) / totalPx
          const { type: dType, offset: dOff, width: dW, orient: dOrient } = draftOpening
          const gStart = Math.min(dOff * PX_PER_INCH, totalPx)
          const gEnd   = Math.min(gStart + dW * PX_PER_INCH, totalPx)
          const doorW  = gEnd - gStart
          if (doorW <= 0) return null
          const startPt = { x: ax + gStart * ux, y: ay + gStart * uy }
          const endPt   = { x: ax + gEnd   * ux, y: ay + gEnd   * uy }

          if (dType === 'window') {
            return (
              <g style={{ pointerEvents: 'none' }}>
                <line x1={startPt.x} y1={startPt.y} x2={endPt.x} y2={endPt.y}
                  stroke="#4a90e2" strokeWidth={6} strokeLinecap="round" opacity={0.25}/>
                <line x1={startPt.x} y1={startPt.y} x2={endPt.x} y2={endPt.y}
                  stroke="#4a90e2" strokeWidth={2} strokeDasharray="5 3" strokeLinecap="round"/>
              </g>
            )
          }

          const hingeAtStart = dOrient === 0 || dOrient === 1
          const openLeft     = dOrient === 0 || dOrient === 2
          const hx = ax + (hingeAtStart ? gStart : gEnd) * ux
          const hy = ay + (hingeAtStart ? gStart : gEnd) * uy
          const nx = openLeft ? -uy : uy
          const ny = openLeft ?  ux : -ux
          const dx = hx + doorW * nx
          const dy = hy + doorW * ny
          const ax2   = ax + (hingeAtStart ? gEnd : gStart) * ux
          const ay2   = ay + (hingeAtStart ? gEnd : gStart) * uy
          const sweep = (dOrient === 0 || dOrient === 3) ? 1 : 0
          return (
            <g style={{ pointerEvents: 'none' }}>
              <line x1={startPt.x} y1={startPt.y} x2={endPt.x} y2={endPt.y}
                stroke="#4a90e2" strokeWidth={6} strokeLinecap="round" opacity={0.2}/>
              <circle cx={hx} cy={hy} r={4} fill="#4a90e2" opacity={0.9}/>
              <line x1={hx} y1={hy} x2={dx} y2={dy}
                stroke="#4a90e2" strokeWidth={2} strokeLinecap="round"/>
              <path d={`M ${ax2} ${ay2} A ${doorW} ${doorW} 0 0 ${sweep} ${dx} ${dy}`}
                fill="none" stroke="#4a90e2" strokeWidth={1.5} strokeDasharray="4 2"/>
            </g>
          )
        })()}

        {/* Ghost snap dot */}
        {ghostEnd && (
          <circle cx={sx(ghostEnd.x)} cy={sy(ghostEnd.y)} r={4}
            fill="#4a90e2" opacity={0.5} style={{ pointerEvents: 'none' }}/>
        )}

        {layerVisibility.roomLabels && (<>
        {/* Room labels */}
        {Object.values(rooms).map(room => {
          const midpoints = room.wallIds.map(wid => {
            const w = walls[wid]; if (!w) return null
            const a = nodes[w.n1], b = nodes[w.n2]; if (!a || !b) return null
            return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
          }).filter(Boolean)
          if (!midpoints.length) return null
          // Average in world inches then convert to SVG-group
          const wx = midpoints.reduce((s, p) => s + p.x, 0) / midpoints.length
          const wy = midpoints.reduce((s, p) => s + p.y, 0) / midpoints.length
          const cx = sx(wx), cy = sy(wy)
          const invalid = !isRoomValid(room.id)
          const isSel   = room.id === selectedRoomId
          const fRoom   = entityStyle(room)
          return (
            <text key={room.id} x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
              fontSize={13} fontWeight="600"
              fill={invalid ? '#e74c3c' : isSel ? '#1a6e3a' : '#27ae60'}
              opacity={fRoom.opacity}
              style={{
                pointerEvents: (fRoom.pointerEvents ?? 'auto') === 'none'
                  ? 'none'
                  : (activeTool === 'select' ? 'auto' : 'none'),
                userSelect: 'none',
                cursor: activeTool === 'select' ? 'pointer' : 'default',
              }}
              onClick={activeTool === 'select' ? e => { e.stopPropagation(); selectRoom(room.id) } : undefined}>
              {invalid ? '⚠ Invalid' : room.name}
            </text>
          )
        })}
        </>)}

      </g>
    </svg>
    </>
  )
}
