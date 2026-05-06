import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'

const GRID = 20

function snap(v) { return Math.round(v / GRID) * GRID }

function apply90(startNode, x, y) {
  const dx = Math.abs(x - startNode.x)
  const dy = Math.abs(y - startNode.y)
  return dx >= dy ? { x, y: startNode.y } : { x: startNode.x, y }
}

function getWallSegments(a, b, openings) {
  const totalPx = Math.hypot(b.x - a.x, b.y - a.y)
  if (totalPx === 0 || !openings || openings.length === 0) {
    return { segments: [{ x1: a.x, y1: a.y, x2: b.x, y2: b.y }], gaps: [] }
  }
  const dx = (b.x - a.x) / totalPx
  const dy = (b.y - a.y) / totalPx
  const sorted = [...openings].sort((p, q) => p.offset - q.offset)
  const segments = [], gaps = []
  let cur = 0
  for (const o of sorted) {
    const gStart = Math.min(o.offset * GRID, totalPx)
    const gEnd   = Math.min(gStart + o.width * GRID, totalPx)
    if (gEnd <= gStart) continue
    if (gStart > cur) segments.push({ x1: a.x+cur*dx, y1: a.y+cur*dy, x2: a.x+gStart*dx, y2: a.y+gStart*dy })
    gaps.push({ x1: a.x+gStart*dx, y1: a.y+gStart*dy, x2: a.x+gEnd*dx, y2: a.y+gEnd*dy, type: o.type })
    cur = gEnd
  }
  if (cur < totalPx) segments.push({ x1: a.x+cur*dx, y1: a.y+cur*dy, x2: b.x, y2: b.y })
  return { segments, gaps }
}

function applyLockedLength(startNode, cursor, lengthUnits) {
  const px = lengthUnits * GRID
  const dx = cursor.x - startNode.x
  const dy = cursor.y - startNode.y
  if (Math.abs(dx) >= Math.abs(dy)) return { x: startNode.x + (dx >= 0 ? px : -px), y: startNode.y }
  return { x: startNode.x, y: startNode.y + (dy >= 0 ? px : -px) }
}

function applyLockedLengthFree(startNode, cursor, lengthUnits) {
  const px   = lengthUnits * GRID
  const dx   = cursor.x - startNode.x
  const dy   = cursor.y - startNode.y
  const dist = Math.hypot(dx, dy)
  if (dist === 0) return { x: startNode.x + px, y: startNode.y }
  return { x: snap(startNode.x + (dx / dist) * px), y: snap(startNode.y + (dy / dist) * px) }
}

function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx*dx + dy*dy
  if (lenSq === 0) return { x: snap(ax), y: snap(ay) }
  const t = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / lenSq))
  return { x: snap(ax + t*dx), y: snap(ay + t*dy) }
}

function wallLength(a, b) {
  return Math.round(Math.hypot(b.x-a.x, b.y-a.y) / GRID * 10) / 10
}

function fmtLen(ft, unit) {
  if (unit === 'm') return `${Math.round(ft * 0.3048 * 100) / 100} m`
  return `${ft} ft`
}

const ROOM_COLORS = ['#3498db','#e74c3c','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#16a085']

const TOOL_CURSOR = {
  draw:   'crosshair',
  split:  'crosshair',
  select: 'default',
  room:   'default',
  stairs: 'crosshair',
  lift:   'crosshair',
}

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
  const selectedStampId = useStore(s => s.selectedStampId)
  const pendingWallIds = useStore(s => s.pendingWallIds)
  const drawVirtual    = useStore(s => s.drawVirtual)
  const showDimensions = useStore(s => s.showDimensions)
  const unit           = useStore(s => s.unit)
  const draftOpening   = useStore(s => s.draftOpening)

  const setTool = useStore(s => s.setTool)
  const {
    getOrCreateNode, addWall, setDrawStart, selectWall, deleteWall,
    splitWall, togglePendingWall, cancelAction,
    addStamp, deleteStamp, selectStamp, moveStamp,
    toggleWallMultiSelect, selectRoom,
    undo, redo,
  } = useStore()

  const svgRef = useRef(null)

  const [pan,  setPan]  = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const panRef  = useRef({ x: 0, y: 0 })
  const zoomRef = useRef(1)

  const [isPanning,    setIsPanning]    = useState(false)
  const isPanningRef = useRef(false)
  const panStartRef  = useRef(null)
  const [spaceDown,    setSpaceDown]    = useState(false)
  const [shiftDown,    setShiftDown]    = useState(false)
  const [cursor,       setCursor]       = useState(null)
  const [hoveredWallId, setHoveredWallId] = useState(null)
  const [lockedLength, setLockedLength] = useState('')
  const selectedRoomId = useStore(s => s.selectedRoomId)
  const [draggingStamp, setDraggingStamp] = useState(null) // { stampId, offX, offY }

  useEffect(() => { panRef.current  = pan  }, [pan])
  useEffect(() => { zoomRef.current = zoom }, [zoom])

  // Global pan handlers — attached to window so dragging past the SVG edge doesn't cancel the pan.
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
      if (e.key === 'Escape') { cancelAction(); setEditingRoomId(null); return }
      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return }
      // Delete
      if (e.key === 'Delete') {
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
  }, [selectedWallId, selectedStampId])

  useEffect(() => { if (!drawStartId) setLockedLength('') }, [drawStartId])

  const startNode    = drawStartId ? nodes[drawStartId] : null
  const parsedLength = parseFloat(lockedLength)
  const hasLock      = !isNaN(parsedLength) && parsedLength > 0

  const ghostEnd = startNode && cursor
    ? (hasLock
        ? (shiftDown ? applyLockedLengthFree(startNode, cursor, parsedLength) : applyLockedLength(startNode, cursor, parsedLength))
        : (shiftDown ? cursor : apply90(startNode, cursor.x, cursor.y)))
    : null

  function toCanvas(clientX, clientY) {
    const rect = svgRef.current.getBoundingClientRect()
    return { x: snap((clientX - rect.left - pan.x) / zoom), y: snap((clientY - rect.top - pan.y) / zoom) }
  }

  function toCanvasRaw(clientX, clientY) {
    const rect = svgRef.current.getBoundingClientRect()
    return { x: (clientX - rect.left - pan.x) / zoom, y: (clientY - rect.top - pan.y) / zoom }
  }

  function handleMouseDown(e) {
    // Right-click, middle-click, or Space+left-click all pan
    if (e.button === 2 || e.button === 1 || (e.button === 0 && spaceDown)) {
      e.preventDefault()
      isPanningRef.current = true
      panStartRef.current  = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y }
      setIsPanning(true)
    }
  }

  function handleMouseMove(e) {
    // Pan is handled by the global window listener; only update cursor position here.
    if (isPanningRef.current) return
    if (draggingStamp) {
      const { x, y } = toCanvasRaw(e.clientX, e.clientY)
      moveStamp(draggingStamp.stampId, snap(x - draggingStamp.offX), snap(y - draggingStamp.offY))
      return
    }
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    setCursor({ x: snap((e.clientX - rect.left - pan.x) / zoom), y: snap((e.clientY - rect.top - pan.y) / zoom) })
  }

  function handleMouseUp(e) {
    if (draggingStamp) { setDraggingStamp(null); return }
  }

  function handleMouseLeave() { setCursor(null); setHoveredWallId(null); setDraggingStamp(null) }

  function handleSVGClick(e) {
    if (isPanningRef.current || spaceDown) return

    // Stamp placement — place one then switch to Select so it can be dragged/deleted
    if (activeTool === 'stairs' || activeTool === 'lift') {
      const { x, y } = toCanvas(e.clientX, e.clientY)
      addStamp(activeTool, x, y)
      setTool('select')
      return
    }

    if (activeTool === 'select') { selectWall(null); selectStamp(null); return }
    if (activeTool !== 'draw') return

    const { x, y } = toCanvas(e.clientX, e.clientY)
    if (!drawStartId) { setDrawStart(getOrCreateNode(x, y)); return }
    const snapped   = hasLock
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
      const { x, y } = toCanvasRaw(e.clientX, e.clientY)
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
    useStore.getState()._save()   // save before drag so undo restores pre-drag position
    const { x, y } = toCanvasRaw(e.clientX, e.clientY)
    setDraggingStamp({ stampId: stamp.id, offX: x - stamp.x, offY: y - stamp.y })
  }

  const svgCursor     = isPanning || spaceDown ? 'grab' : (TOOL_CURSOR[activeTool] || 'default')
  const wallHitCursor = ['select', 'split', 'room'].includes(activeTool) ? 'pointer' : 'default'
  const zoomPct       = Math.round(zoom * 100)

  return (
    <>
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
    {(activeTool === 'stairs' || activeTool === 'lift') && (
      <div style={{ position: 'absolute', bottom: 80, left: '50%', transform: 'translateX(-50%)',
        background: '#fff', border: '1px solid #ccc', borderRadius: 8, padding: '6px 14px',
        zIndex: 20, fontSize: 12, color: '#555' }}>
        Click to place {activeTool === 'stairs' ? 'staircase' : 'lift'} — switch to Select to move/delete
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
        <pattern id="smallGrid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
          <path d={`M ${GRID} 0 L 0 0 0 ${GRID}`} fill="none" stroke="#e0e0e0" strokeWidth={0.5}/>
        </pattern>
        <pattern id="grid" width={GRID*5} height={GRID*5} patternUnits="userSpaceOnUse">
          <rect width={GRID*5} height={GRID*5} fill="url(#smallGrid)"/>
          <path d={`M ${GRID*5} 0 L 0 0 0 ${GRID*5}`} fill="none" stroke="#ccc" strokeWidth={1}/>
        </pattern>
        {/* Stair hatch pattern */}
        <pattern id="stairHatch" width={GRID} height={GRID*0.6} patternUnits="userSpaceOnUse">
          <line x1="0" y1={GRID*0.6} x2={GRID} y2={GRID*0.6} stroke="#aaa" strokeWidth={0.8}/>
        </pattern>
      </defs>

      <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>

        {/* Grid */}
        <rect x="-10000" y="-10000" width="30000" height="30000" fill="url(#grid)"/>

        {/* Room fills */}
        {Object.values(rooms).map((room, idx) => {
          if (!isRoomValid(room.id)) return null
          const poly = getRoomPolygon(room.id)
          if (!poly || poly.length < 3) return null
          const pts       = poly.map(p => `${p.x},${p.y}`).join(' ')
          const color     = ROOM_COLORS[idx % ROOM_COLORS.length]
          const isSelRoom = room.id === selectedRoomId
          return (
            <polygon key={room.id} points={pts}
              fill={color} fillOpacity={isSelRoom ? 0.25 : 0.12}
              stroke={color} strokeOpacity={isSelRoom ? 0.8 : 0.3}
              strokeWidth={isSelRoom ? 2 : 1}
              style={{ cursor: activeTool === 'select' ? 'pointer' : 'default' }}
              onClick={activeTool === 'select' ? e => { e.stopPropagation(); selectRoom(room.id) } : undefined}
            />
          )
        })}

        {/* Stamps */}
        {Object.values(stamps).map(stamp => {
          const isSelected = stamp.id === selectedStampId
          const color = isSelected ? '#e74c3c' : '#555'
          const isDragging = draggingStamp?.stampId === stamp.id
          return (
            <g key={stamp.id}
              onClick={e => handleStampClick(e, stamp.id)}
              onMouseDown={e => handleStampMouseDown(e, stamp)}
              style={{ cursor: activeTool === 'select' ? (isDragging ? 'grabbing' : 'grab') : 'default' }}>
              {stamp.type === 'stairs' ? (
                <>
                  <rect x={stamp.x} y={stamp.y} width={stamp.w} height={stamp.h}
                    fill="url(#stairHatch)" stroke={color} strokeWidth={isSelected ? 2 : 1.5}/>
                  <rect x={stamp.x} y={stamp.y} width={stamp.w} height={stamp.h}
                    fill="none" stroke={color} strokeWidth={isSelected ? 2 : 1.5}/>
                  <text x={stamp.x + stamp.w/2} y={stamp.y + stamp.h/2}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={10} fontWeight="600" fill={color}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    STAIRS
                  </text>
                </>
              ) : (
                <>
                  <rect x={stamp.x} y={stamp.y} width={stamp.w} height={stamp.h}
                    fill="#e8f0f8" stroke={color} strokeWidth={isSelected ? 2 : 1.5}/>
                  <circle cx={stamp.x + stamp.w/2} cy={stamp.y + stamp.h/2}
                    r={Math.min(stamp.w, stamp.h) * 0.32}
                    fill="none" stroke={color} strokeWidth={1}/>
                  <text x={stamp.x + stamp.w/2} y={stamp.y + stamp.h/2}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={10} fontWeight="600" fill={color}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    LIFT
                  </text>
                </>
              )}
            </g>
          )
        })}

        {/* Walls */}
        {Object.values(walls).map(wall => {
          const a = nodes[wall.n1], b = nodes[wall.n2]
          if (!a || !b) return null
          const isSelected      = wall.id === selectedWallId
          const isMultiSelected = selectedWallIds.includes(wall.id)
          const isPending       = pendingWallIds.includes(wall.id)
          const isHovered       = wall.id === hoveredWallId
          const isVirtual       = wall.isVirtual ?? false
          const color = isPending       ? '#27ae60'
                      : isSelected      ? '#e74c3c'
                      : isMultiSelected ? '#e67e22'
                      : wall.isPlot     ? '#a0522d'
                      : isVirtual       ? '#888'
                      : '#333'
          const thickPx = Math.max(2, (wall.thickness ?? 0.5) * GRID)
          const strokeW = (isSelected || isPending || isMultiSelected) ? thickPx + 2 : isVirtual ? 1.5 : thickPx
          const dashArray  = isVirtual ? '8 5' : undefined
          const hitW       = Math.max(14, thickPx + 8)
          const len        = wallLength(a, b)
          const mx         = (a.x + b.x) / 2
          const my         = (a.y + b.y) / 2
          const angle  = Math.atan2(b.y - a.y, b.x - a.x)
          const perpX  = -Math.sin(angle) * 10
          const perpY  =  Math.cos(angle) * 10
          return (
            <g key={wall.id} onClick={e => handleWallClick(e, wall.id)}
              onMouseEnter={() => setHoveredWallId(wall.id)}
              onMouseLeave={() => setHoveredWallId(null)}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="transparent" strokeWidth={hitW} style={{ cursor: wallHitCursor }}/>
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
              {/* Door swing arcs */}
              {(wall.openings || []).filter(op => op.type === 'door').map(op => {
                const totalPx = Math.hypot(b.x - a.x, b.y - a.y)
                if (totalPx === 0) return null
                const ux = (b.x - a.x) / totalPx
                const uy = (b.y - a.y) / totalPx
                const gStart = Math.min(op.offset * GRID, totalPx)
                const gEnd   = Math.min(gStart + op.width * GRID, totalPx)
                const doorW  = gEnd - gStart
                if (doorW <= 0) return null
                const orient       = op.orient ?? 0
                const hingeAtStart = orient === 0 || orient === 1
                const openLeft     = orient === 0 || orient === 2
                // Hinge point
                const hx = a.x + (hingeAtStart ? gStart : gEnd) * ux
                const hy = a.y + (hingeAtStart ? gStart : gEnd) * uy
                // Normal direction for swing
                const nx = openLeft ? -uy : uy
                const ny = openLeft ? ux  : -ux
                // Door leaf endpoint
                const dx = hx + doorW * nx
                const dy = hy + doorW * ny
                // Arc start (other side of gap)
                const ax2 = a.x + (hingeAtStart ? gEnd : gStart) * ux
                const ay2 = a.y + (hingeAtStart ? gEnd : gStart) * uy
                // Sweep: orient 0,3 → CW in SVG; orient 1,2 → CCW
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

        {/* Ghost line while drawing */}
        {startNode && ghostEnd && (() => {
          const len        = wallLength(startNode, ghostEnd)
          const mx         = (startNode.x + ghostEnd.x) / 2
          const my         = (startNode.y + ghostEnd.y) / 2
          const ghostColor = drawVirtual ? '#888' : shiftDown ? '#e67e22' : '#4a90e2'
          const ghostDash  = drawVirtual ? '8 5' : '6 4'
          return (
            <g style={{ pointerEvents: 'none' }}>
              <line x1={startNode.x} y1={startNode.y} x2={ghostEnd.x} y2={ghostEnd.y}
                stroke={ghostColor} strokeWidth={drawVirtual ? 1.5 : 2} strokeDasharray={ghostDash}/>
              <text x={mx} y={my - 10} textAnchor="middle" fontSize={11} fill={ghostColor}>
                {fmtLen(len, unit)}
              </text>
            </g>
          )
        })()}

        {/* Nodes */}
        {Object.values(nodes).map(node => {
          const isStart = node.id === drawStartId
          return (
            <circle key={node.id} cx={node.x} cy={node.y}
              r={isStart ? 7 : 5} fill={isStart ? '#e74c3c' : '#4a90e2'}
              stroke="#fff" strokeWidth={2} style={{ pointerEvents: 'none' }}/>
          )
        })}

        {/* Room-mode corner indicators — show open vs closed corners */}
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
            return (
              <g key={nodeId} style={{ pointerEvents: 'none' }}>
                <circle cx={node.x} cy={node.y} r={9}
                  fill={closed ? '#27ae60' : '#e74c3c'} opacity={0.2}/>
                <circle cx={node.x} cy={node.y} r={6}
                  fill={closed ? '#27ae60' : '#e74c3c'}
                  stroke="#fff" strokeWidth={2}/>
                <text x={node.x} y={node.y} textAnchor="middle" dominantBaseline="middle"
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
          const totalPx = Math.hypot(b.x - a.x, b.y - a.y)
          if (totalPx === 0) return null
          const ux = (b.x - a.x) / totalPx
          const uy = (b.y - a.y) / totalPx
          const { type: dType, offset: dOff, width: dW, orient: dOrient } = draftOpening
          const gStart = Math.min(dOff * GRID, totalPx)
          const gEnd   = Math.min(gStart + dW * GRID, totalPx)
          const doorW  = gEnd - gStart
          if (doorW <= 0) return null
          const startPt = { x: a.x + gStart * ux, y: a.y + gStart * uy }
          const endPt   = { x: a.x + gEnd   * ux, y: a.y + gEnd   * uy }

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

          // Door preview
          const hingeAtStart = dOrient === 0 || dOrient === 1
          const openLeft     = dOrient === 0 || dOrient === 2
          const hx = a.x + (hingeAtStart ? gStart : gEnd) * ux
          const hy = a.y + (hingeAtStart ? gStart : gEnd) * uy
          const nx = openLeft ? -uy : uy
          const ny = openLeft ? ux  : -ux
          const dx = hx + doorW * nx
          const dy = hy + doorW * ny
          const ax2   = a.x + (hingeAtStart ? gEnd : gStart) * ux
          const ay2   = a.y + (hingeAtStart ? gEnd : gStart) * uy
          const sweep = (dOrient === 0 || dOrient === 3) ? 1 : 0
          return (
            <g style={{ pointerEvents: 'none' }}>
              {/* Gap highlight */}
              <line x1={startPt.x} y1={startPt.y} x2={endPt.x} y2={endPt.y}
                stroke="#4a90e2" strokeWidth={6} strokeLinecap="round" opacity={0.2}/>
              {/* Hinge dot */}
              <circle cx={hx} cy={hy} r={4} fill="#4a90e2" opacity={0.9}/>
              {/* Door leaf */}
              <line x1={hx} y1={hy} x2={dx} y2={dy}
                stroke="#4a90e2" strokeWidth={2} strokeLinecap="round"/>
              {/* Swing arc */}
              <path d={`M ${ax2} ${ay2} A ${doorW} ${doorW} 0 0 ${sweep} ${dx} ${dy}`}
                fill="none" stroke="#4a90e2" strokeWidth={1.5} strokeDasharray="4 2"/>
            </g>
          )
        })()}

        {/* Ghost snap dot */}
        {ghostEnd && (
          <circle cx={ghostEnd.x} cy={ghostEnd.y} r={4}
            fill="#4a90e2" opacity={0.5} style={{ pointerEvents: 'none' }}/>
        )}

        {/* Room labels */}
        {Object.values(rooms).map(room => {
          const midpoints = room.wallIds.map(wid => {
            const w = walls[wid]; if (!w) return null
            const a = nodes[w.n1], b = nodes[w.n2]; if (!a || !b) return null
            return { x: (a.x+b.x)/2, y: (a.y+b.y)/2 }
          }).filter(Boolean)
          if (!midpoints.length) return null
          const cx      = midpoints.reduce((s, p) => s+p.x, 0) / midpoints.length
          const cy      = midpoints.reduce((s, p) => s+p.y, 0) / midpoints.length
          const invalid = !isRoomValid(room.id)
          const isSelRoom = room.id === selectedRoomId
          return (
            <text key={room.id} x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
              fontSize={13} fontWeight="600"
              fill={invalid ? '#e74c3c' : isSelRoom ? '#1a6e3a' : '#27ae60'}
              style={{
                pointerEvents: activeTool === 'select' ? 'auto' : 'none',
                userSelect: 'none',
                cursor: activeTool === 'select' ? 'pointer' : 'default',
              }}
              onClick={activeTool === 'select' ? e => { e.stopPropagation(); selectRoom(room.id) } : undefined}>
              {invalid ? '⚠ Invalid' : room.name}
            </text>
          )
        })}

      </g>
    </svg>
    </>
  )
}
