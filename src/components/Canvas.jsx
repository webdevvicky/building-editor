import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'
import {
  w2s, screenToWorldRaw, snapIn,
  PX_PER_INCH, GRID_IN, DEFAULT_WALL_THICK_IN,
  closestPointOnSegment,
} from '../geometry'
import { resolveSnap, getTargetDescriptor, findNearestCandidate, getSnapRef } from '../snap'
import { convertFacePointsToCenterline, isFaceChainClosed } from '../draw/faceToCenterline.js'
import { isFaceCoveredByRoom } from '../topology/faces.js'
import { canMergeWalls } from '../topology/canMerge.js'
import { getActiveFloorWalls } from '../topology/floor.js'
import { dialog } from './ui/Dialog'
import { BEAM_LEVEL_REGISTRY } from '../constants/structural'
import { getColumnSvgDims } from '../lib/columnShapes'
import { getEffectiveWallLengthFt } from '../topology/index.js'
// Area 2B — rect-room tool atomically creates walls + room + auto-MEP.
import { suggestPlumbingFixturesForRoom } from '../mep/plumbing/suggestions.js'
import { suggestElectricalPointsForRoom } from '../mep/electrical/suggestions.js'
import { suggestHvacUnitsForRoom }        from '../mep/hvac/suggestions.js'
import { suggestFireDevicesForRoom }      from '../mep/fire/suggestions.js'
import { suggestElvDevicesForRoom }       from '../mep/elv/suggestions.js'
import { toast } from './ui/Toast'
import { formatLength } from '../lib/units.js'
import FeetInchesInput from './ui/FeetInchesInput.jsx'
import PlumbingOverlay from './canvas/PlumbingOverlay.jsx'
import ElectricalOverlay from './canvas/ElectricalOverlay.jsx'
import HvacOverlay from './canvas/HvacOverlay.jsx'
import FireOverlay from './canvas/FireOverlay.jsx'
import ElvOverlay from './canvas/ElvOverlay.jsx'
import ClashOverlay from './canvas/ClashOverlay.jsx'
import './Canvas.css'
import UnderlayLayer from './UnderlayLayer.jsx'

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

// Mode-aware length formatter — single source from src/lib/units.js.
// In 'ft-in' mode renders 10'-6"; in 'm' converts to metres; otherwise ft.
function fmtLen(ft, unit) {
  return formatLength(ft, unit)
}

const ROOM_COLORS = ['#3498db','#e74c3c','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#16a085']

const TOOL_CURSOR = {
  draw:          'crosshair',
  rect_room:     'crosshair',
  split:         'crosshair',
  select:        'default',
  room:          'default',
  room_detect:   'pointer',
  join_walls:    'pointer',
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

// Phase W follow-up — Manual Join refusal-reason → user-facing message.
// Mirrors the reason strings produced by canMergeWalls in
// src/topology/canMerge.js. Unmapped reasons fall back to a generic
// "Cannot join these walls" via the lookup site's `?? __default__`.
const JOIN_WALLS_REASONS = Object.freeze({
  'wall-not-found':                          'Wall not found',
  'same-wall':                               'Cannot join a wall to itself',
  'different-floors':                        'Walls are on different floors',
  'isVirtual-mismatch':                      'Walls have different virtual/real status',
  'isPlot-mismatch':                         'Cannot mix plot walls with regular walls',
  'no-shared-endpoint':                      'Walls do not share an endpoint',
  'shared-node-has-third-wall':              'A third wall meets at the join point — cannot merge',
  'shared-node-is-tjunction-of-third-wall':  'Join point is attached to a third wall — cannot merge',
  'missing-endpoint-node':                   'Wall endpoint missing — invalid topology',
  'zero-length-wall':                        'One of the walls has zero length',
  'not-collinear':                           'Walls are not collinear',
  'material-mismatch':                       'Walls have different materials',
  'height-mismatch':                         'Walls have different heights',
  'thickness-mismatch':                      'Walls have different thicknesses',
  'classification-mismatch':                 'Walls have different classifications',
  'hasPlinthBeam-mismatch':                  'Walls disagree on plinth-beam flag',
  'hasLintelBeam-mismatch':                  'Walls disagree on lintel-beam flag',
  'hasRoofBeam-mismatch':                    'Walls disagree on roof-beam flag',
  'opening-near-merge-point':                'An opening is too close to the merge point',
  'no-eligible-sibling':                     'No collinear-eligible adjacent wall to join with',
  'ambiguous':                               'Multiple eligible neighbors — click each in turn',
})
const JOIN_WALLS_DEFAULT_MESSAGE = 'Cannot join these walls'

// Find collinear-eligible siblings of a wall via canMergeWalls.
// Floor-scoped — iterates only the current floor's walls. Returns an
// array of wallIds whose canMergeWalls(state, wallId, W) returns ok=true.
function findEligibleJoinSiblings(state, wallId) {
  const floorWalls = getActiveFloorWalls(state, state.currentFloorId)
  const out = []
  for (const otherId of Object.keys(floorWalls)) {
    if (otherId === wallId) continue
    const gate = canMergeWalls(state, wallId, otherId)
    if (gate.ok) out.push(otherId)
  }
  return out
}

// Given a wallId and a projected point already on (or very near) the wall,
// return the parametric position t in [0, 1]. Used by MEP placement to
// derive wallT after the snap resolver yields a WALL_NEAREST winner.
// Resolver returns the projected point but not the parametric position
// (sortKey-only contract); recomputing it here is O(1) and keeps the
// resolver's candidate shape minimal.
function _wallTFromPoint(state, wallId, px, py) {
  const w = state?.walls?.[wallId]
  const a = w && state.nodes?.[w.n1]
  const b = w && state.nodes?.[w.n2]
  if (!a || !b) return null
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return 0
  let t = ((px - a.x) * dx + (py - a.y) * dy) / len2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  return t
}

export default function Canvas() {
  const nodes          = useStore(s => s.nodes)
  const walls          = useStore(s => s.walls)
  const rooms          = useStore(s => s.rooms)
  const stamps         = useStore(s => s.stamps)
  const slabs          = useStore(s => s.slabs)
  // Phase 4 Tier-2 (Phase C — two-click calibration) — keep markers reactive.
  const calibrationCapture = useStore(s => s.selection?.calibrationCapture ?? null)
  // Per-floor underlay (Fix 3): the calibration overlay reads the current
  // floor's underlay so two-click capture lines up with whatever plan is
  // visible.
  const calibrationUnderlay = useStore(s => {
    const fid = s.currentFloorId
    return s.projectSettings?.floors?.find(f => f.id === fid)?.underlay ?? null
  })
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
  // Area 1 — dimension mode drives wall-label length (Correction 2).
  const dimensionMode  = useStore(s => s.projectSettings?.dimensionMode ?? 'centerline')
  const drawReference  = useStore(s => s.projectSettings?.drawReference ?? 'inside_face')
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
    splitWall, joinWalls, togglePendingWall, cancelAction,
    addStamp, deleteStamp, selectStamp, moveStamp,
    toggleWallMultiSelect, selectRoom,
    detectFaceFromWallClick, createRoomFromFace,
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
  // Snap-bypass modifier (Alt by default; configurable via
  // projectSettings.snap.bypassKey). When held, resolveSnap returns
  // raw world coords with no snapping.
  const [bypassDown,   setBypassDown]   = useState(false)
  const [cursor,       setCursor]       = useState(null)   // { x, y, kind, label, raw }
  const [hoveredWallId, setHoveredWallId] = useState(null)
  // Phase R1 — room_detect tool hover preview. Updated on mousemove
  // while activeTool === 'room_detect'; null otherwise.
  const [hoveredFace,  setHoveredFace]  = useState(null)
  // Phase W follow-up — Manual Join tool. joinFirstWallId holds the
  // first wall selected in two-click mode. joinHover is the live
  // mousemove-driven preview state.
  const [joinFirstWallId, setJoinFirstWallId] = useState(null)
  const [joinHover, setJoinHover] = useState(null)   // { wallA, wallB|null, eligible, reason }
  const [lockedLength, setLockedLength] = useState('')
  const [draggingStamp, setDraggingStamp] = useState(null) // { stampId, offX, offY } in world inches
  const [beamFromColId, setBeamFromColId] = useState(null)      // first column selected for beam
  const [beamLevelPicker, setBeamLevelPicker] = useState(null)  // { fromColId, toColId, screenX, screenY }
  // Area 2A — wall chain drawing. drawChainOriginId tracks the FIRST node
  // of the active chain. End triggers: double-click on SVG, Enter key
  // (fired via window event from useKeyboardShortcuts), Esc (existing
  // cancelAction path), or auto-close when the next click snaps to the
  // chain origin (a closing wall is created, then chain ends).
  const [drawChainOriginId, setDrawChainOriginId] = useState(null)
  // Face-aware draw chain buffer (2026-05-28). For drawReference =
  // 'inside_face' or 'outside_face': clicks are pushed here as face
  // points; no walls are created until chain end (Enter / double-click
  // / face-space closure). drawChainBufferOpen flips false on commit.
  //   Each entry: { point: {x,y}, snapRef: 'face' | 'centerline' }
  // Closure detection runs on these FACE points BEFORE convertFacePointsToCenterline
  // (see src/draw/faceToCenterline.js header — closure-in-face-space rule).
  // For drawReference = 'centerline' this buffer stays empty; the
  // existing per-click commit path runs unchanged.
  const [drawChainBuffer, setDrawChainBuffer] = useState([])
  // Area 2B — rect_room tool first-corner stash (world inches). Cleared
  // on Esc / tool change / second click.
  const [rectFirstCorner, setRectFirstCorner] = useState(null)

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
  // bypassKey is the configurable snap-bypass modifier; defaults to 'Alt'.
  // 'None' disables bypass entirely. Effect re-binds when the setting changes.
  const bypassKey = projectSettings?.snap?.bypassKey ?? 'Alt'
  useEffect(() => {
    function matchesBypass(e) {
      if (bypassKey === 'None') return false
      if (bypassKey === 'Alt')   return e.key === 'Alt'   || e.altKey
      if (bypassKey === 'Shift') return e.key === 'Shift' || e.shiftKey
      if (bypassKey === 'Ctrl')  return e.key === 'Control' || e.ctrlKey || e.metaKey
      return false
    }
    function onKeyDown(e) {
      if (e.code === 'Space' && !e.target.closest('input')) { e.preventDefault(); setSpaceDown(true) }
      if (e.key === 'Shift') setShiftDown(true)
      if (matchesBypass(e)) setBypassDown(true)
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
      // Clear bypass when the bound key (or any modifier that would have
      // triggered it) is released.
      if (bypassKey === 'Alt'   && e.key === 'Alt')     setBypassDown(false)
      if (bypassKey === 'Shift' && e.key === 'Shift')   setBypassDown(false)
      if (bypassKey === 'Ctrl'  && (e.key === 'Control' || e.key === 'Meta')) setBypassDown(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup',   onKeyUp)
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp) }
  }, [selectedWallId, selectedStampId, selectedColumnId, bypassKey])

  // F9 toggle for projectSettings.snap.enabled — dispatched from
  // useKeyboardShortcuts (or any other source) via window event.
  useEffect(() => {
    function onToggle() { useStore.getState().toggleSnapEnabled?.() }
    window.addEventListener('snap:toggle', onToggle)
    return () => window.removeEventListener('snap:toggle', onToggle)
  }, [])

  useEffect(() => { if (!drawStartId) setLockedLength('') }, [drawStartId])

  // Area 2A — wall chain end via Enter key (dispatched from
  // useKeyboardShortcuts as a window event to keep the hook decoupled
  // from Canvas internals, mirroring the boq:toggle pattern).
  //
  // Face-aware draw (2026-05-28): if there's a buffered face chain,
  // Enter commits it as an OPEN polyline (kernel handles endpoint
  // perpendicular-translation). Otherwise the existing chain-cancel
  // path runs.
  useEffect(() => {
    function endChain() {
      if (drawChainBuffer.length >= 2) {
        _commitFaceChain([...drawChainBuffer], false)
        return
      }
      setDrawChainBuffer([])
      setDrawStart(null)
      setDrawChainOriginId(null)
    }
    window.addEventListener('canvas:end-chain', endChain)
    return () => window.removeEventListener('canvas:end-chain', endChain)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawChainBuffer, drawReference])

  // Clear chain state whenever the user leaves the draw tool. Esc
  // already calls setTool('select'); we shadow chain-origin AND the
  // face-mode buffer here so a mode flip mid-chain doesn't strand state.
  useEffect(() => {
    if (activeTool !== 'draw') {
      setDrawChainOriginId(null)
      setDrawChainBuffer([])
    }
  }, [activeTool])

  // Also discard face-mode buffer if the user toggles the draw reference
  // mid-chain — semantically the chain was "begun in mode X", switching
  // mid-stroke is ambiguous so we restart cleanly.
  useEffect(() => {
    setDrawChainBuffer([])
    setDrawStart(null)
    setDrawChainOriginId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawReference])

  // Area 2B — clear rectFirstCorner when leaving rect_room tool.
  useEffect(() => {
    if (activeTool !== 'rect_room') setRectFirstCorner(null)
  }, [activeTool])

  // Phase R1 — clear room-detect hover preview when leaving the tool.
  useEffect(() => {
    if (activeTool !== 'room_detect') setHoveredFace(null)
  }, [activeTool])

  // Phase W follow-up — clear Manual Join state when leaving the tool.
  useEffect(() => {
    if (activeTool !== 'join_walls') {
      setJoinFirstWallId(null)
      setJoinHover(null)
    }
  }, [activeTool])

  const startNode    = drawStartId ? nodes[drawStartId] : null
  // lockedLength may be '' (free draw) or a number-as-string ('10.5') or a
  // number — FeetInchesInput commits numbers, the legacy clear button
  // commits ''. parseFloat handles all three.
  const parsedLength = parseFloat(lockedLength)
  const hasLock      = !isNaN(parsedLength) && parsedLength > 0

  // ghostEnd is in world inches
  const ghostEnd = startNode && cursor
    ? (hasLock
        ? (shiftDown ? applyLockedLengthFree(startNode, cursor, parsedLength) : applyLockedLength(startNode, cursor, parsedLength))
        : (shiftDown ? cursor : apply90(startNode, cursor.x, cursor.y)))
    : null

  function getRect() { return svgRef.current.getBoundingClientRect() }

  // Unified snap dispatch — every drawing tool's click goes through this.
  // Returns the full resolveSnap result so callers can branch on
  // result.targetKind / sourceId where needed (column NODE attract,
  // MEP wall-locked placement). Pulls state lazily to keep call sites short.
  function runSnap(e) {
    return resolveSnap(
      useStore.getState(),
      { clientX: e.clientX, clientY: e.clientY },
      {
        toolId:    activeTool,
        pan,
        zoom,
        svgRect:   getRect(),
        settings:  projectSettings?.snap,
        modifiers: { bypass: bypassDown },
      },
    )
  }

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
      // Stamp drag uses pre-existing offset semantics — intentionally raw,
      // not routed through resolveSnap.
      const { x, y } = screenToWorldRaw(e.clientX, e.clientY, getRect(), panRef.current, zoomRef.current)
      moveStamp(draggingStamp.stampId, snapIn(x - draggingStamp.offX), snapIn(y - draggingStamp.offY))
      return
    }
    if (!svgRef.current) return
    // Live cursor display goes through the unified resolver so the snap
    // dot + label reflect what a click would target.
    const result = runSnap(e)
    const desc   = getTargetDescriptor(result.targetKind)
    const label  = result.raw
      ? (bypassDown ? 'Free' : null)
      : (desc?.displayLabel?.(result, projectSettings?.snap, { pitchIn: projectSettings?.snap?.pitchIn }) ?? null)
    setCursor({
      x:    result.worldXY.x,
      y:    result.worldXY.y,
      kind: result.targetKind,
      label,
      raw:  result.raw,
    })

    // Phase R1 — room_detect hover preview. Find the nearest wall within
    // 24in of the raw cursor; resolve the face on the cursor's side of
    // that wall. O(1) on cache hits.
    if (activeTool === 'room_detect') {
      const raw = screenToWorldRaw(e.clientX, e.clientY, getRect(), panRef.current, zoomRef.current)
      const state = useStore.getState()
      const nearest = findNearestCandidate(state, 'wallSegment', raw.x, raw.y)
      if (nearest && nearest.distanceIn <= 24) {
        const face = detectFaceFromWallClick(nearest.entity.id, raw)
        setHoveredFace(face)
      } else if (hoveredFace) {
        setHoveredFace(null)
      }
    }

    // Phase W follow-up — join_walls hover preview. Find the hovered wall,
    // then either look up its single collinear-eligible sibling (no
    // first pick yet) or evaluate canMergeWalls against the staged
    // first pick. Sets joinHover for the SVG overlay to render.
    if (activeTool === 'join_walls') {
      const raw = screenToWorldRaw(e.clientX, e.clientY, getRect(), panRef.current, zoomRef.current)
      const state = useStore.getState()
      const nearest = findNearestCandidate(state, 'wallSegment', raw.x, raw.y)
      if (!nearest || nearest.distanceIn > 24) {
        if (joinHover) setJoinHover(null)
        return
      }
      const hoveredId = nearest.entity.id
      if (joinFirstWallId == null) {
        // No first pick yet — discover siblings.
        if (hoveredId === joinHover?.wallA && joinHover.wallB !== undefined) {
          // Same wall; skip re-scan to avoid mousemove churn.
        }
        const siblings = findEligibleJoinSiblings(state, hoveredId)
        if (siblings.length === 1) {
          setJoinHover({ wallA: hoveredId, wallB: siblings[0], eligible: true, reason: null })
        } else if (siblings.length === 0) {
          setJoinHover({ wallA: hoveredId, wallB: null, eligible: false, reason: 'no-eligible-sibling' })
        } else {
          setJoinHover({ wallA: hoveredId, wallB: null, eligible: false, reason: 'ambiguous' })
        }
      } else {
        // Second-pick mode — evaluate against the staged first pick.
        if (hoveredId === joinFirstWallId) {
          // Hovering the staged wall itself — neutral preview (click clears).
          setJoinHover({ wallA: joinFirstWallId, wallB: null, eligible: false, reason: null })
        } else {
          const gate = canMergeWalls(state, joinFirstWallId, hoveredId)
          setJoinHover({
            wallA:    joinFirstWallId,
            wallB:    hoveredId,
            eligible: gate.ok,
            reason:   gate.ok ? null : gate.reason,
          })
        }
      }
    }
  }

  function handleMouseUp(e) {
    if (draggingStamp) { setDraggingStamp(null); return }
  }

  function handleMouseLeave() {
    setCursor(null); setHoveredWallId(null); setDraggingStamp(null); setHoveredFace(null); setJoinHover(null)
  }

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

    // Phase 4 Tier-2 (Phase C — Step 18 follow-on): two-click calibration.
    // First click stores p1Px; second click stores p2Px and re-opens the
    // CalibrationModal which now prompts for known length between them.
    // Coords are converted to IMAGE PIXEL space per ADD 8.
    if (activeTool === 'calibrate_underlay') {
      const underlay = useStore.getState().getFloorUnderlay()
      if (!underlay) return
      const { x, y } = screenToWorldRaw(e.clientX, e.clientY, getRect(), pan, zoom)
      const ipp = underlay.calibration?.inchesPerPixel ?? 1
      const hIn = (underlay.naturalSize?.hPx ?? 0) * ipp
      const placement = underlay.placement ?? { xIn: 0, yIn: 0 }
      // world → image pixel (Y-flip: image-top is world Y = placement.yIn + hIn).
      const pxX = (x - placement.xIn) / ipp
      const pxY = ((placement.yIn + hIn) - y) / ipp
      const setSelection = useStore.getState().setSelection
      const capture = useStore.getState().selection?.calibrationCapture ?? null
      if (!capture || !capture.p1Px) {
        setSelection({ calibrationCapture: { p1Px: { x: pxX, y: pxY }, p2Px: null } })
      } else {
        setSelection({
          calibrationCapture: { p1Px: capture.p1Px, p2Px: { x: pxX, y: pxY } },
        })
      }
      return
    }

    if (activeTool === 'column') {
      // Column placement: resolver's column policy attracts to NODE within
      // 24in (the legacy nearNode radius preserved as a per-tool override),
      // else falls through to GRID. When the winner is NODE, we attach the
      // column to that node's id so future moves stay coupled.
      const result = runSnap(e)
      const ctId   = projectSettings.columnTypes[0]?.id ?? 'C1'
      if (result.targetKind === 'NODE' && result.sourceId) {
        const node = useStore.getState().nodes?.[result.sourceId]
        if (node) {
          addColumn(node.x, node.y, ctId, node.id)
          return
        }
      }
      const { x, y } = result.worldXY
      addColumn(x, y, ctId, null)
      return
    }
    if (activeTool === 'beam') {
      // Clicking empty canvas in beam mode — cancel
      setBeamFromColId(null)
      return
    }

    if (STAMP_TOOLS.has(activeTool)) {
      // Stamp tools (sump / OHT / septic / stairs / lift) policy = GRID only.
      const { x, y } = runSnap(e).worldXY
      addStamp(activeTool, x, y)
      setTool('select')
      return
    }

    // ── MEP placement (plumbing / electrical / hvac / fire / elv) ─────────
    // Each tool's policy is `['WALL_NEAREST']` with the registry's 36in
    // default tolerance. When the resolver returns a WALL_NEAREST winner,
    // we attach the fixture to that wall and derive wallT from the
    // projected point; otherwise we place free at the raw click.
    if (activeTool === 'plumbing' || activeTool === 'electrical'
        || activeTool === 'hvac'   || activeTool === 'fire'
        || activeTool === 'elv') {
      const result = runSnap(e)
      const { x, y } = result.worldXY
      let wallId = null, wallT = null
      if (result.targetKind === 'WALL_NEAREST' && result.sourceId) {
        wallId = result.sourceId
        wallT  = _wallTFromPoint(useStore.getState(), wallId, x, y)
      }
      const store = useStore.getState()
      if (activeTool === 'plumbing') {
        const id = store.addPlumbingFixture(DEFAULT_PLUMBING_FIXTURE_TYPE, x, y, wallId, wallT)
        store.selectPlumbingFixture(id)
      } else if (activeTool === 'electrical') {
        const id = store.addElectricalPoint(DEFAULT_ELECTRICAL_POINT_TYPE, x, y, wallId, wallT)
        store.selectElectricalPoint(id)
      } else if (activeTool === 'hvac') {
        const id = store.addHvacUnit(DEFAULT_HVAC_UNIT_TYPE, x, y, wallId, wallT)
        store.selectHvacUnit(id)
      } else if (activeTool === 'fire') {
        const id = store.addFireDevice(DEFAULT_FIRE_DEVICE_TYPE, x, y, wallId, wallT)
        store.selectFireDevice(id)
      } else {
        const id = store.addElvDevice(DEFAULT_ELV_DEVICE_TYPE, x, y, wallId, wallT)
        store.selectElvDevice(id)
      }
      return
    }

    if (activeTool === 'select') { selectWall(null); selectStamp(null); selectColumn(null); return }

    // Area 2B — rectangle-room tool. Two-click flow; atomic on second click.
    // rect_room policy = NODE / WALL_ENDPOINT / GRID so corners snap to
    // existing graph nodes when nearby.
    if (activeTool === 'rect_room') {
      const { x, y } = runSnap(e).worldXY
      if (!rectFirstCorner) {
        setRectFirstCorner({ x, y })
        return
      }
      // Second click → atomic create wrapping addRectangleRoom + auto-MEP
      // in ONE history frame (Correction 6).
      const c1 = rectFirstCorner
      const c2 = { x, y }
      setRectFirstCorner(null)
      const store = useStore.getState()
      store._runAtomically(() => {
        const result = store.addRectangleRoom(c1.x, c1.y, c2.x, c2.y, { type: 'OTHER' })
        if (result?.error) {
          toast.error(`Couldn't create room: ${result.error}${result.conflictName ? ` (overlaps ${result.conflictName})` : ''}`)
          return
        }
        // Auto-MEP per Area 2D — runs inside the same batch so undo is atomic.
        const stAfter = useStore.getState()
        const autoOn = stAfter.projectSettings?.autoMepDefaultsEnabled !== false
        if (autoOn && result?.roomId) {
          const sug = {
            plumbing:   suggestPlumbingFixturesForRoom(stAfter, result.roomId),
            electrical: suggestElectricalPointsForRoom(stAfter, result.roomId),
            hvac:       suggestHvacUnitsForRoom(stAfter, result.roomId),
            fire:       suggestFireDevicesForRoom(stAfter, result.roomId),
            elv:        suggestElvDevicesForRoom(stAfter, result.roomId),
          }
          const added = stAfter.applyRoomMepDefaults?.(result.roomId, sug) ?? {}
          const count = (added.plumbing?.length ?? 0)
                      + (added.electrical?.length ?? 0)
                      + (added.hvac?.length ?? 0)
                      + (added.fire?.length ?? 0)
                      + (added.elv?.length ?? 0)
          toast.action(`Room created with ${count} MEP item${count === 1 ? '' : 's'}.`, {
            label: 'Undo',
            onClick: () => useStore.getState().undo?.(),
            duration: 6000,
          })
        } else {
          toast.success('Room created.')
        }
      })
      // Switch to select so the user can rename / re-type the new room.
      setTool('select')
      return
    }

    if (activeTool !== 'draw') return

    // draw policy = NODE / WALL_ENDPOINT / WALL_MIDPOINT / GRID. The ortho
    // (apply90 / applyLockedLength) logic below operates on the resolved
    // world point — unchanged.
    const snapResult = runSnap(e)
    const { x, y } = snapResult.worldXY
    const clickSnapRef = getSnapRef(snapResult.targetKind)

    // ── Face-aware draw path (2026-05-28).
    //
    // For drawReference ∈ {'inside_face', 'outside_face'}: buffer face
    // clicks, render the face polyline, defer wall creation to chain
    // commit. Closure-in-face-space rule (see faceToCenterline.js
    // header): closure is detected on the buffered FACE points, BEFORE
    // conversion — never on the post-conversion centerline geometry.
    //
    // For drawReference === 'centerline': fall through to the legacy
    // per-click commit path below (zero behavior change for users on
    // that setting).
    if (drawReference !== 'centerline') {
      // Ortho lock applies to face-space too — the user expects 90°
      // snapping to operate on their visible click trajectory.
      const last = drawChainBuffer.length > 0
        ? drawChainBuffer[drawChainBuffer.length - 1]
        : null
      let snapped = { x, y }
      if (last) {
        snapped = hasLock
          ? (shiftDown ? applyLockedLengthFree(last.point, { x, y }, parsedLength) : applyLockedLength(last.point, { x, y }, parsedLength))
          : (shiftDown ? { x, y } : apply90(last.point, x, y))
      }
      // Closure detection — face space, before conversion.
      if (drawChainBuffer.length >= 2) {
        const first = drawChainBuffer[0].point
        const dxC = snapped.x - first.x
        const dyC = snapped.y - first.y
        const distToFirst = Math.hypot(dxC, dyC)
        if (distToFirst <= SNAP_IN) {
          // User clicked back on the first buffered point — chain closes.
          _commitFaceChain([...drawChainBuffer], true)
          return
        }
      }
      setDrawChainBuffer(prev => [
        ...prev,
        { point: { x: snapped.x, y: snapped.y }, snapRef: clickSnapRef },
      ])
      return
    }

    // ── Centerline draw path (legacy, unchanged).
    if (!drawStartId) {
      const id = getOrCreateNode(x, y)
      setDrawStart(id)
      setDrawChainOriginId(id)   // First click of a new chain.
      return
    }
    const snapped = hasLock
      ? (shiftDown ? applyLockedLengthFree(startNode, { x, y }, parsedLength) : applyLockedLength(startNode, { x, y }, parsedLength))
      : (shiftDown ? { x, y } : apply90(startNode, x, y))
    const endNodeId = getOrCreateNode(snapped.x, snapped.y)
    if (endNodeId === drawStartId) { setDrawStart(null); setDrawChainOriginId(null); return }
    addWall(drawStartId, endNodeId)
    // Auto-close: if this click landed on the chain origin (and we drew at
    // least one wall to get here), the closing wall has been created and
    // the chain ends.
    if (endNodeId === drawChainOriginId) {
      setDrawStart(null)
      setDrawChainOriginId(null)
      return
    }
    setDrawStart(endNodeId)
  }

  // Commit a buffered face-mode chain. Runs conversion via the kernel,
  // then atomically creates nodes + walls under _runAtomically. Refuses
  // commit if the conversion collapses (validationEvent + toast.error).
  // `closed` indicates whether the chain ends with a closure-to-origin
  // detected in FACE space (per closure-in-face-space rule).
  function _commitFaceChain(buffer, closed) {
    if (!buffer || buffer.length < 2) {
      setDrawChainBuffer([])
      return
    }
    const points = buffer.map(b => ({ x: b.point.x, y: b.point.y }))
    const snapRefs = buffer.map(b => b.snapRef)
    const conv = convertFacePointsToCenterline(points, snapRefs, {
      drawReference, closed,
    })
    if (conv.collapsed) {
      const store = useStore.getState()
      store.setState?.({})  // no-op; for clarity
      // Push validationEvent directly via setState (matches existing
      // pattern for face_conversion_collapsed in addRectangleRoom).
      useStore.setState(s => ({
        validationEvents: [
          ...(s.validationEvents ?? []),
          {
            ruleId:     'face_conversion_collapsed',
            severity:   'error',
            category:   'topology',
            entityType: 'draw_chain',
            entityId:   null,
            message:    `Chain (${closed ? 'closed' : 'open'}) collapsed under ${drawReference} conversion — geometry not committed.`,
            meta:       { drawReference, closed, warnings: conv.warnings },
          },
        ].slice(-100),
      }))
      toast.error(`Cannot commit: ${drawReference.replace('_', ' ')} conversion collapsed.`)
      setDrawChainBuffer([])
      return
    }
    // Atomic commit: all walls in one history frame.
    const store = useStore.getState()
    store._runAtomically(() => {
      const st = useStore.getState()
      const nodeIds = conv.points.map(p => st.getOrCreateNode(p.x, p.y))
      const N = nodeIds.length
      const edgeCount = closed ? N : N - 1
      for (let i = 0; i < edgeCount; i++) {
        const a = nodeIds[i]
        const b = nodeIds[(i + 1) % N]
        if (a === b) continue
        useStore.getState().addWall(a, b)
      }
    })
    setDrawChainBuffer([])
    setDrawStart(null)
    setDrawChainOriginId(null)
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
      // Split targets the SPECIFIC wall the user clicked (passed as `wallId`
      // to the hit-target handler), not the nearest wall. The resolver's
      // WALL_SEGMENT target picks the closest wall globally, which is wrong
      // for split — if the click is closer to a neighbour, WALL_SEGMENT
      // would route the cut there. Inline closestPointOnSegment is the
      // correct primitive: project onto THIS wall only. Intentional
      // exception to the "no snap math outside src/snap/" rule.
      const wall = walls[wallId]
      const a = nodes[wall.n1], b = nodes[wall.n2]
      const { x, y } = screenToWorldRaw(e.clientX, e.clientY, getRect(), pan, zoom)
      const pt = closestPointOnSegment(x, y, a.x, a.y, b.x, b.y)
      splitWall(wallId, pt.x, pt.y)
      return
    }
    if (activeTool === 'room') { e.stopPropagation(); togglePendingWall(wallId) }

    if (activeTool === 'room_detect') {
      e.stopPropagation()
      const raw = screenToWorldRaw(e.clientX, e.clientY, getRect(), pan, zoom)
      const face = detectFaceFromWallClick(wallId, raw)
      if (!face) {
        toast.info('No enclosing room from this wall — wall may be on an open chain')
        return
      }
      const existing = isFaceCoveredByRoom(useStore.getState(), face.wallIds)
      if (existing) {
        selectRoom(existing)
        toast.info('Room already exists — selected')
        return
      }
      const result = createRoomFromFace(face)
      if (result?.error === 'overlap') {
        toast.warning(`Cannot create — overlaps existing room "${result.conflictName}"`)
      } else if (result?.alreadyExists) {
        selectRoom(result.roomId)
      } else if (result?.roomId) {
        selectRoom(result.roomId)
        toast.success('Room created from detected face')
      } else {
        toast.error('Could not create room')
      }
    }

    // Phase W follow-up — join_walls click handler. One-click flow
    // when there's exactly 1 eligible sibling; two-click flow otherwise.
    // Re-reads state fresh both before staging AND after dialog.confirm
    // await (state may have changed during the async dialog).
    if (activeTool === 'join_walls') {
      e.stopPropagation()

      // _attemptJoin is a local async helper. Encapsulated here so it
      // closes over toast / selectWall / joinWalls / setJoin*State.
      const _attemptJoin = async (w1Id, w2Id) => {
        // Re-read fresh state (defensive — predicate run on stale state).
        const stateBefore = useStore.getState()
        const gate = canMergeWalls(stateBefore, w1Id, w2Id)
        if (!gate.ok) {
          toast.warning(JOIN_WALLS_REASONS[gate.reason] ?? JOIN_WALLS_DEFAULT_MESSAGE)
          setJoinFirstWallId(null)
          setJoinHover(null)
          return
        }
        const w1 = stateBefore.walls[w1Id]
        const w2 = stateBefore.walls[w2Id]
        const wasSplit = w1?.splitOrigin === 'USER_SPLIT'
                      && w2?.splitOrigin === 'USER_SPLIT'
        const message = wasSplit
          ? 'Join these two walls into one?\n\nThese walls were split via the Split tool.'
          : 'Join these two walls into one?'
        const confirmed = await dialog.confirm(message, {
          title:        'Join walls',
          confirmLabel: 'Join',
        })
        if (!confirmed) {
          setJoinFirstWallId(null)
          setJoinHover(null)
          return
        }
        // Refinement #3 — re-read state AFTER the await. State may have
        // changed during the dialog (autosave, another window, undo).
        const stateAfter = useStore.getState()
        if (!stateAfter.walls[w1Id] || !stateAfter.walls[w2Id]) {
          toast.warning('One of the selected walls no longer exists')
          setJoinFirstWallId(null)
          setJoinHover(null)
          return
        }
        const result = joinWalls(w1Id, w2Id)
        if (result?.error) {
          toast.warning(JOIN_WALLS_REASONS[result.error] ?? JOIN_WALLS_DEFAULT_MESSAGE)
          setJoinFirstWallId(null)
          setJoinHover(null)
          return
        }
        // Refinement #4 — clear hover BEFORE selectWall to avoid the
        // preview overlay rendering against the now-removed wallId.
        setJoinFirstWallId(null)
        setJoinHover(null)
        if (result?.survivorId) {
          selectWall(result.survivorId)
          toast.success(result.wasSplit ? 'Walls re-joined.' : 'Walls joined.')
        } else {
          toast.error('Could not join walls')
        }
      }

      if (joinFirstWallId == null) {
        // First click — discover siblings.
        const state = useStore.getState()
        const siblings = findEligibleJoinSiblings(state, wallId)
        if (siblings.length === 1) {
          // One-click flow.
          _attemptJoin(wallId, siblings[0])
        } else if (siblings.length === 0) {
          toast.warning(JOIN_WALLS_REASONS['no-eligible-sibling'])
        } else {
          // Ambiguous — stage as first pick for two-click flow.
          setJoinFirstWallId(wallId)
          toast.info('First wall selected. Click the wall to join with.')
        }
      } else {
        // Second click.
        if (wallId === joinFirstWallId) {
          setJoinFirstWallId(null)
          setJoinHover(null)
          toast.info('Selection cleared.')
        } else {
          _attemptJoin(joinFirstWallId, wallId)
        }
      }
    }
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
  const wallHitCursor = ['select', 'split', 'room', 'room_detect', 'join_walls'].includes(activeTool) ? 'pointer' : 'default'
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
        <div style={{ width: 72 }}>
          <FeetInchesInput
            value={hasLock ? parsedLength : null}
            onCommit={ft => setLockedLength(ft > 0 ? ft : '')}
            min={0}
            placeholder="free"
          />
        </div>
        {lockedLength !== '' && (
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

    {/* Area 2A — chain-drawing hint */}
    {activeTool === 'draw' && (drawStartId || drawChainBuffer.length > 0) && (
      <div style={{ position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
        background: '#fff', border: '1px solid #ccc', borderRadius: 8, padding: '6px 14px',
        zIndex: 20, fontSize: 12, color: '#555' }}>
        Click to continue · Click origin to close · Double-click or Enter to end · Esc to cancel
      </div>
    )}

    {/* Face-aware draw — always-visible mode badge during draw/rect_room.
        Lives top-left next to the calibration / floor-switcher chrome. */}
    {(activeTool === 'draw' || activeTool === 'rect_room') && (
      <div style={{
        position: 'absolute', top: 12, left: 12, zIndex: 20,
        background: drawReference === 'centerline'
          ? 'var(--color-surface)'
          : (drawReference === 'inside_face' ? 'rgba(39,174,96,0.10)' : 'rgba(230,126,34,0.10)'),
        border: '1px solid',
        borderColor: drawReference === 'centerline'
          ? 'var(--color-border)'
          : (drawReference === 'inside_face' ? '#27ae60' : '#e67e22'),
        borderRadius: 6, padding: '4px 10px',
        fontSize: 12, color: 'var(--color-text-secondary)',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        boxShadow: 'var(--shadow-sm)',
      }}>
        <span style={{ fontWeight: 'var(--weight-medium)', color: 'var(--color-text)' }}>
          Drawing to:
        </span>
        <span>
          {drawReference === 'inside_face'  ? 'Inside face'  :
           drawReference === 'outside_face' ? 'Outside face' :
                                              'Centerline'}
        </span>
      </div>
    )}

    {/* Area 2B — rectangle-room hint */}
    {activeTool === 'rect_room' && (
      <div style={{ position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
        background: '#fff', border: '1px solid #ccc', borderRadius: 8, padding: '6px 14px',
        zIndex: 20, fontSize: 12, color: '#555' }}>
        {rectFirstCorner
          ? 'Click opposite corner to create room · Esc to cancel'
          : 'Click first corner · Click opposite corner to create 4 walls + room'}
      </div>
    )}

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
      onDoubleClick={() => {
        // Area 2A — end wall chain on double-click.
        // Face-aware draw (2026-05-28): commit the buffered face chain
        // as OPEN if one is active; otherwise cancel chain state.
        if (activeTool === 'draw') {
          if (drawChainBuffer.length >= 2) {
            _commitFaceChain([...drawChainBuffer], false)
            return
          }
          if (drawStartId || drawChainOriginId) {
            setDrawStart(null)
            setDrawChainOriginId(null)
          }
        }
      }}
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

        {/* Phase 4 Tier-2 Step 16: PDF/image underlay layer (rendered
            below the grid so user-drawn content always sits on top). */}
        <UnderlayLayer />

        {/* Two-click calibration markers — visible when activeTool ===
            'calibrate_underlay' and at least one point has been captured. */}
        {activeTool === 'calibrate_underlay' && (() => {
          const underlay = calibrationUnderlay
          const capture = calibrationCapture
          if (!underlay || !capture) return null
          const ipp = underlay.calibration?.inchesPerPixel ?? 1
          const hIn = (underlay.naturalSize?.hPx ?? 0) * ipp
          const placement = underlay.placement ?? { xIn: 0, yIn: 0 }
          // Image-pixel → world inches (inverse of click handler)
          const px2world = (p) => ({
            x: placement.xIn + p.x * ipp,
            y: (placement.yIn + hIn) - p.y * ipp,
          })
          const p1 = capture.p1Px ? px2world(capture.p1Px) : null
          const p2 = capture.p2Px ? px2world(capture.p2Px) : null
          return (
            <g style={{ pointerEvents: 'none' }} data-layer="calibration-capture">
              {p1 && (
                <circle cx={sx(p1.x)} cy={sy(p1.y)} r={6}
                  fill="var(--color-primary)" stroke="var(--color-bg)" strokeWidth={2}/>
              )}
              {p2 && (
                <circle cx={sx(p2.x)} cy={sy(p2.y)} r={6}
                  fill="var(--color-primary)" stroke="var(--color-bg)" strokeWidth={2}/>
              )}
              {p1 && p2 && (
                <line x1={sx(p1.x)} y1={sy(p1.y)} x2={sx(p2.x)} y2={sy(p2.y)}
                  stroke="var(--color-primary)" strokeWidth={2} strokeDasharray="6 4"/>
              )}
            </g>
          )
        })()}

        {/* Grid */}
        <rect x="-10000" y="-10000" width="30000" height="30000" fill="url(#grid)"/>

        {/* Snap-target overlay — renders the descriptor's renderOverlay
            output for the live cursor when the resolver picked a non-GRID
            target. Always above the grid, below user-drawn content. */}
        <g data-layer="snap-targets" style={{ pointerEvents: 'none' }}>
          {cursor && cursor.kind && cursor.kind !== 'GRID' && (() => {
            const desc = getTargetDescriptor(cursor.kind)
            if (!desc?.renderOverlay) return null
            const overlay = desc.renderOverlay({ point: { x: cursor.x, y: cursor.y } }, { sx, sy })
            if (!overlay) return null
            const cx = sx(overlay.worldX), cy = sy(overlay.worldY), r = overlay.radiusPx
            if (overlay.kind === 'ring')
              return <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--color-primary)" strokeWidth={2}/>
            if (overlay.kind === 'diamond')
              return <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2}
                           transform={`rotate(45 ${cx} ${cy})`}
                           fill="none" stroke="var(--color-primary)" strokeWidth={2}/>
            if (overlay.kind === 'cross')
              return <g>
                <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} stroke="var(--color-primary)" strokeWidth={2}/>
                <line x1={cx} y1={cy - r} x2={cx} y2={cy + r} stroke="var(--color-primary)" strokeWidth={2}/>
              </g>
            return null
          })()}
        </g>

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

        {/* Phase 4 Tier-2 Item 29 + ADD 6: slab overlays — translucent solid
            fills only, no SVG patterns (performance risk at zoom +
            transparency). SUNKEN gets a dashed border to distinguish.
            Off by default; engineers toggle on for QA + clash review. */}
        {layerVisibility.slabs && (<>
        {Object.values(slabs).map((slab) => {
          // Floor scope — slabs only render on their own floor (no ghosting,
          // a slab on a different floor isn't visually meaningful in plan view).
          if (multiFloor && slab.floorId !== currentFloorId) return null
          const role = slab.role ?? slab.classification ?? 'FLOOR'
          const fillVar =
            role === 'ROOF'          ? 'var(--color-primary-bg)' :
            role === 'SUNKEN'        ? 'var(--color-warning-bg)' :
            role === 'STAIR_LANDING' ? 'var(--color-success-bg)' :
                                       'var(--color-bg-muted)'
          const strokeVar =
            role === 'SUNKEN'        ? 'var(--color-warning)' :
            role === 'STAIR_LANDING' ? 'var(--color-success)' :
                                       'var(--color-text-muted)'
          const dashArray = role === 'SUNKEN' ? '6,4' : undefined
          return (
            <g key={slab.id} style={{ pointerEvents: 'none' }}>
              {(slab.roomIds ?? []).map(rid => {
                const room = rooms[rid]
                if (!room) return null
                if (!isRoomValid(rid)) return null
                const poly = getRoomPolygon(rid)
                if (!poly || poly.length < 3) return null
                const pts = poly.map(p => `${sx(p.x)},${sy(p.y)}`).join(' ')
                return (
                  <polygon
                    key={`slab-${slab.id}-${rid}`}
                    points={pts}
                    fill={fillVar}
                    fillOpacity={0.35}
                    stroke={strokeVar}
                    strokeOpacity={0.6}
                    strokeWidth={1}
                    strokeDasharray={dashArray}
                  />
                )
              })}
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
          // Effective label length: in 'clear_internal' mode this returns
          // the inset edge length (queries getRoomPolygonInsetEdges via
          // wallId — Correction 2). In 'centerline' mode it equals the
          // bare wallLength. Free-standing walls (no room) fall back to
          // centerline naturally.
          const len = getEffectiveWallLengthFt(useStore.getState(), wall.id, dimensionMode)
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
                        // BUG 3 fix: mousedown stopPropagation does NOT stop the
                        // synthesized click event chain — without this, the wall
                        // group's onClick fires after mouseup and selectWall()
                        // would clear selectedOpening. Belt: this. Suspenders:
                        // defensive guard in selectWall (store.js).
                        onClick={e => e.stopPropagation()}
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

        {/* Area 2B — ghost rectangle while rect_room tool is active.
            Dim labels respect projectSettings.dimensionMode: in
            clear_internal we show the inner-face dimensions the user
            will actually see in the BOQ (centerline shrunk by half-wall
            on each side; the rect always creates walls of default
            thickness so the shrinkage is symmetric and well-defined
            even before the walls exist). */}
        {/* Phase R1 — room_detect hover preview. Renders a translucent
            polygon overlay tracing the smallest enclosing face on the
            cursor's side of the nearest wall. Primary tint when the face
            is uncovered; warning tint when a Room already exists.
            Click commits via handleWallClick's room_detect branch. */}
        {activeTool === 'room_detect' && hoveredFace && (() => {
          const pts = hoveredFace.polygon.map(p => `${sx(p.x)},${sy(p.y)}`).join(' ')
          const existingRoomId = isFaceCoveredByRoom(useStore.getState(), hoveredFace.wallIds)
          const isExisting = !!existingRoomId
          const fillColor   = isExisting ? 'var(--color-warning-bg)' : 'var(--color-primary-bg)'
          const strokeColor = isExisting ? 'var(--color-warning)'    : 'var(--color-primary)'
          const cxScreen = sx(hoveredFace.centroid.x)
          const cyScreen = sy(hoveredFace.centroid.y)
          const areaFt2  = hoveredFace.signedAreaFt2.toFixed(1)
          return (
            <g data-layer="face-detect-preview" style={{ pointerEvents: 'none' }}>
              <polygon points={pts}
                fill={fillColor} fillOpacity={0.35}
                stroke={strokeColor} strokeWidth={2} strokeDasharray="6 4"/>
              <text x={cxScreen} y={cyScreen}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={12} fill={strokeColor}
                style={{ userSelect: 'none', fontFamily: 'var(--font-mono)' }}>
                {isExisting ? 'Already a room' : `${areaFt2} ft²`}
              </text>
            </g>
          )
        })()}

        {/* Phase W follow-up — Manual Join hover preview. Renders both
            walls (or just wallA when no sibling is determined) with a
            small label showing the action or the refusal reason.
            Eligible → primary tint dashed; ineligible → warning tint. */}
        {activeTool === 'join_walls' && joinHover && (() => {
          const { wallA, wallB, eligible, reason } = joinHover
          const wA = walls[wallA]
          if (!wA) return null
          const wAn1 = nodes[wA.n1], wAn2 = nodes[wA.n2]
          if (!wAn1 || !wAn2) return null
          const wB = wallB ? walls[wallB] : null
          const wBn1 = wB ? nodes[wB.n1] : null
          const wBn2 = wB ? nodes[wB.n2] : null
          const stroke = eligible ? 'var(--color-primary)' : 'var(--color-warning)'
          const label = eligible
            ? 'Click to join'
            : (JOIN_WALLS_REASONS[reason] ?? (reason ? JOIN_WALLS_DEFAULT_MESSAGE : ''))
          // Refinement #5 — midpoint math handles wallB === null.
          let labelX, labelY
          if (wB && wBn1 && wBn2) {
            // Midpoint of the pair's combined geometry.
            labelX = (wAn1.x + wAn2.x + wBn1.x + wBn2.x) / 4
            labelY = (wAn1.y + wAn2.y + wBn1.y + wBn2.y) / 4
          } else {
            labelX = (wAn1.x + wAn2.x) / 2
            labelY = (wAn1.y + wAn2.y) / 2
          }
          return (
            <g data-layer="join-walls-preview" style={{ pointerEvents: 'none' }}>
              <line x1={sx(wAn1.x)} y1={sy(wAn1.y)}
                    x2={sx(wAn2.x)} y2={sy(wAn2.y)}
                    stroke={stroke} strokeWidth={4}
                    strokeDasharray="6 4" />
              {wB && wBn1 && wBn2 && (
                <line x1={sx(wBn1.x)} y1={sy(wBn1.y)}
                      x2={sx(wBn2.x)} y2={sy(wBn2.y)}
                      stroke={stroke} strokeWidth={4}
                      strokeDasharray="6 4" />
              )}
              {label && (
                <text x={sx(labelX)} y={sy(labelY)}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize={12} fill={stroke}
                      style={{ userSelect: 'none', fontFamily: 'var(--font-mono)' }}>
                  {label}
                </text>
              )}
            </g>
          )
        })()}

        {activeTool === 'rect_room' && rectFirstCorner && cursor && (() => {
          const c1 = rectFirstCorner
          const c2 = cursor
          const xs = [c1.x, c2.x].sort((a, b) => a - b)
          const ys = [c1.y, c2.y].sort((a, b) => a - b)
          // Ghost label shows the DRAGGED dimension as the active draw
          // reference (face-aware draw, 2026-05-28). The drag IS the
          // user's chosen reference frame:
          //   - inside_face: drag = clear inside dimension
          //   - centerline:  drag = wall centerline dimension
          //   - outside_face: drag = outer-face / plinth dimension
          // The label matches what the user is doing — dimensionMode no
          // longer drives this label (it controls labels on existing
          // rendered geometry, not the in-progress ghost).
          const wFt = Math.abs(c2.x - c1.x) / GRID_IN
          const hFt = Math.abs(c2.y - c1.y) / GRID_IN
          const sxA = sx(xs[0]), sxB = sx(xs[1])
          const syA = sy(ys[0]), syB = sy(ys[1])
          // SVG: y-flip means syA > syB visually; reorder for <rect>.
          const rx = Math.min(sxA, sxB)
          const ry = Math.min(syA, syB)
          const rw = Math.abs(sxB - sxA)
          const rh = Math.abs(syA - syB)
          return (
            <g style={{ pointerEvents: 'none' }}>
              <rect x={rx} y={ry} width={rw} height={rh}
                fill="rgba(74,144,226,0.10)" stroke="#4a90e2"
                strokeWidth={1.5} strokeDasharray="6 4" />
              <text x={rx + rw / 2} y={ry + rh / 2}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={12} fill="#4a90e2"
                style={{ userSelect: 'none' }}>
                {fmtLen(wFt, unit)} × {fmtLen(hFt, unit)}
              </text>
            </g>
          )
        })()}

        {/* Face-aware draw — buffered face-mode chain preview (2026-05-28).
            Shows ONLY face clicks per design decision Q2: no dual centerline
            preview. The centerline conversion runs at chain commit. */}
        {activeTool === 'draw' && drawReference !== 'centerline' && drawChainBuffer.length > 0 && (() => {
          const pts = drawChainBuffer.map(b => b.point)
          const tail = cursor ?? null
          const color = drawReference === 'inside_face' ? '#27ae60' : '#e67e22'
          // Polyline through buffered face points.
          const path = pts.map(p => `${sx(p.x)},${sy(p.y)}`).join(' ')
          return (
            <g data-layer="face-chain-preview" style={{ pointerEvents: 'none' }}>
              <polyline points={path} fill="none" stroke={color}
                strokeWidth={1.5} strokeDasharray="6 4" />
              {pts.map((p, i) => (
                <circle key={`fbp-${i}`} cx={sx(p.x)} cy={sy(p.y)} r={3}
                  fill={color} stroke="#fff" strokeWidth={1} />
              ))}
              {tail && (
                <line x1={sx(pts[pts.length - 1].x)} y1={sy(pts[pts.length - 1].y)}
                  x2={sx(tail.x)} y2={sy(tail.y)} stroke={color}
                  strokeWidth={1.5} strokeDasharray="4 4" />
              )}
            </g>
          )
        })()}

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
            const isStart       = node.id === drawStartId
            // Area 2A — chain-origin gets a green ring so users can see
            // the "click here to close" target as soon as 1+ walls exist.
            const isChainOrigin = activeTool === 'draw' && node.id === drawChainOriginId && node.id !== drawStartId
            const onActiveFloor = !multiFloor || activeNodeIds.has(node.id)
            return (
              <circle key={node.id} cx={sx(node.x)} cy={sy(node.y)}
                r={isStart || isChainOrigin ? 7 : 5}
                fill={isStart ? '#e74c3c' : isChainOrigin ? '#27ae60' : '#4a90e2'}
                stroke="#fff" strokeWidth={isChainOrigin ? 3 : 2}
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

        {/* Snap-target label — sits ~12px right of the resolved cursor
            position, identifies the winning target (Node / Endpoint /
            Wall / Grid 12" / Free). Hidden when label is null. */}
        {cursor?.label && (
          <foreignObject x={sx(cursor.x) + 10} y={sy(cursor.y) - 22}
                         width={80} height={20}
                         style={{ pointerEvents: 'none' }}>
            <div style={{
              display: 'inline-block',
              padding: '2px 6px',
              borderRadius: 4,
              background: 'var(--color-primary-bg)',
              color: 'var(--color-text)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              lineHeight: 1,
              whiteSpace: 'nowrap',
            }}>{cursor.label}</div>
          </foreignObject>
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
