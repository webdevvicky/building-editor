import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { Modal } from './ui/Modal.jsx'
import { Button } from './ui/Button.jsx'
import {
  worldToIso, sortedFloors as sortFloors,
  floorBaseZIn, floorTopZIn,
} from '../iso/projection'
import {
  resolveWallSolid, resolveColumnSolid, resolveBeamSolid,
  resolveSlabSolid, resolveFoundationSolids, resolveInlineFootingSolid,
  resolveStampSolid,
} from '../iso/solids'
import { buildFaceList } from '../iso/extrude'
import { faceColors } from '../iso/colors'
import './iso.css'

const FT = 12
const DEFAULT_EXPLODED_GAP_IN = 24   // 2 ft visual gap between stacked floors
const PX_PER_INCH = 0.6
const DEFAULT_FLOOR_ID = 'F1'

// Vertical center of a beam by level. Plinth beams sit at the bottom of
// the floor's walls; lintels at ~7 ft above; roof beams at the floor top.
function beamTopZForLevel(level, floorBaseZ, floorTopZ) {
  if (level === 'plinth') return floorBaseZ
  if (level === 'lintel') return floorBaseZ + 84   // 7 ft
  return floorTopZ                                 // roof
}

// Beam endpoint position. COLUMN endpoints follow attached-node coords when
// the column is snapped to one; otherwise use the column's free position.
function beamEndpointXY(ep, nodes, columns) {
  if (!ep) return null
  if (ep.type === 'COLUMN') {
    const c = columns[ep.columnId]
    if (!c) return null
    if (c.attachedNodeId && nodes[c.attachedNodeId]) {
      const n = nodes[c.attachedNodeId]
      return { x: n.x, y: n.y }
    }
    return { x: c.x, y: c.y }
  }
  return { x: ep.x, y: ep.y }
}

// Column position. Attached columns mirror the node; standalone use col.x/y.
function columnXY(col, nodes) {
  if (col.attachedNodeId && nodes[col.attachedNodeId]) {
    const n = nodes[col.attachedNodeId]
    return { x: n.x, y: n.y }
  }
  return { x: col.x, y: col.y }
}

export default function IsoView() {
  const activeTool = useStore(s => s.activeTool)
  const setTool    = useStore(s => s.setTool)
  const open       = activeTool === 'iso'

  // Subscribe to entity maps so the iso re-renders on edits.
  const nodes           = useStore(s => s.nodes)
  const walls           = useStore(s => s.walls)
  const rooms           = useStore(s => s.rooms)
  const stamps          = useStore(s => s.stamps)
  const columns         = useStore(s => s.columns)
  const slabs           = useStore(s => s.slabs)
  const foundations     = useStore(s => s.foundations)
  const projectSettings = useStore(s => s.projectSettings)
  // Touch rooms so room polygons re-derive when walls change.
  void rooms

  const floors = useMemo(
    () => sortFloors(projectSettings?.floors ?? []),
    [projectSettings?.floors],
  )
  const slabThicknessIn = projectSettings?.slabSettings?.mainThicknessIn ?? 5
  const columnTypes     = projectSettings?.columnTypes ?? []
  const beamDimensions  = projectSettings?.beamDimensions ?? {}

  // Per-floor visibility (initialized true; re-syncs on floor list change).
  const [floorVisibility, setFloorVisibility] = useState(() =>
    Object.fromEntries((floors || []).map(f => [f.id, true])),
  )
  useEffect(() => {
    setFloorVisibility(prev => {
      const next = {}
      for (const f of floors) next[f.id] = prev[f.id] ?? true
      return next
    })
  }, [floors])

  // Per-element-type visibility.
  const [layerVisibility, setLayerVisibility] = useState({
    walls: true, columns: true, beams: true, slabs: true, foundations: true, stamps: true,
  })

  // Exploded view ON by default per scope decision (24 in gap between floors).
  const [exploded, setExploded] = useState(true)

  // Pan / zoom local state.
  const [pan, setPan]    = useState({ x: 0, y: 0 })
  const [zoom, setZoom]  = useState(1)
  const panStartRef      = useRef(null)
  const svgRef           = useRef(null)
  const containerRef     = useRef(null)

  // ── Build the solid list ───────────────────────────────────────────────
  const solids = useMemo(() => {
    if (!open) return []
    const out = []
    const explodedGap = exploded ? DEFAULT_EXPLODED_GAP_IN : 0
    const baseZOf = (fid) => floorBaseZIn(floors, fid, slabThicknessIn, explodedGap)
    const topZOf  = (fid) => floorTopZIn (floors, fid, slabThicknessIn, explodedGap)

    // Walls
    if (layerVisibility.walls) {
      for (const w of Object.values(walls)) {
        if (w.isVirtual) continue
        const fid = w.floorId ?? DEFAULT_FLOOR_ID
        if (!floorVisibility[fid]) continue
        const n1 = nodes[w.n1], n2 = nodes[w.n2]
        if (!n1 || !n2) continue
        const baseZ = baseZOf(fid)
        const topZ  = baseZ + (w.height ?? 108)
        const s = resolveWallSolid({
          n1x: n1.x, n1y: n1.y, n2x: n2.x, n2y: n2.y,
          thicknessIn: w.thickness ?? 9,
          baseZIn: baseZ,
          topZIn:  topZ,
          entityId: w.id, floorId: fid,
          isVirtual: w.isVirtual,
        })
        if (s) out.push(s)
      }
    }

    // Columns — one solid per floor the column spans. Ground-floor pieces
    // start at z=0 (foundation top); upper pieces start at floor base
    // minus plinth so they visually meet the slab below.
    if (layerVisibility.columns) {
      for (const col of Object.values(columns)) {
        const ct = columnTypes.find(t => t.id === col.columnTypeId)
        if (!ct) continue
        const baseIdx = floors.findIndex(f => f.id === (col.baseFloorId ?? floors[0]?.id))
        const topIdx0 = floors.findIndex(f => f.id === (col.topFloorId  ?? col.baseFloorId ?? floors[0]?.id))
        if (baseIdx < 0) continue
        const topIdx = topIdx0 < 0 ? baseIdx : topIdx0
        const lo = Math.min(baseIdx, topIdx), hi = Math.max(baseIdx, topIdx)
        const { x: cx, y: cy } = columnXY(col, nodes)
        for (let i = lo; i <= hi; i++) {
          const flr = floors[i]
          if (!flr || !floorVisibility[flr.id]) continue
          const pieceBase = (i === 0)
            ? 0
            : baseZOf(flr.id) - (flr.plinthHeightFt ?? 0) * FT
          const pieceTop = topZOf(flr.id) + slabThicknessIn
          const s = resolveColumnSolid({
            x: cx, y: cy, columnType: ct,
            baseZIn: pieceBase, topZIn: pieceTop,
            entityId: col.id, floorId: flr.id,
          })
          if (s) out.push(s)
        }
      }
    }

    // Beams
    if (layerVisibility.beams) {
      const allBeams = useStore.getState().getAllBeams?.() ?? []
      for (const beam of allBeams) {
        const fid = beam.floorId ?? walls[beam.sourceWallId]?.floorId ?? DEFAULT_FLOOR_ID
        if (!floorVisibility[fid]) continue
        const fromXY = beamEndpointXY(beam.endpoints?.from, nodes, columns)
        const toXY   = beamEndpointXY(beam.endpoints?.to,   nodes, columns)
        if (!fromXY || !toXY) continue
        const dims = beamDimensions[beam.level] ?? { widthIn: 9, depthIn: 9 }
        const baseZ = baseZOf(fid)
        const topZ  = topZOf(fid)
        const beamTopZ = beamTopZForLevel(beam.level, baseZ, topZ)
        const s = resolveBeamSolid({
          x1: fromXY.x, y1: fromXY.y, x2: toXY.x, y2: toXY.y,
          widthIn: dims.widthIn, depthIn: dims.depthIn,
          topZIn: beamTopZ,
          entityId: beam.id, floorId: fid, level: beam.level,
        })
        if (s) out.push(s)
      }
    }

    // Slabs — emit one prism per room covered. The slab body sits below
    // the floor's top + slabThicknessIn; SUNKEN slabs are recessed by
    // sinkDepthIn from that plane.
    if (layerVisibility.slabs) {
      const getRoomPolygon = useStore.getState().getRoomPolygon
      for (const slab of Object.values(slabs)) {
        const fid = slab.floorId ?? DEFAULT_FLOOR_ID
        if (!floorVisibility[fid]) continue
        const top = topZOf(fid) + slabThicknessIn
        const isSunken = slab.role === 'SUNKEN' || slab.type === 'SUNKEN'
        const sinkBy   = isSunken ? (slab.sinkDepthIn ?? 0) : 0
        const thickness = slab.thicknessIn ?? slabThicknessIn
        for (const rid of (slab.roomIds || [])) {
          const poly = getRoomPolygon?.(rid)
          if (!poly || poly.length < 3) continue
          const s = resolveSlabSolid({
            polygon: poly.map(p => [p.x, p.y]),
            topZIn: top,
            thicknessIn: thickness,
            sunkByIn: sinkBy,
            entityId: slab.id, floorId: fid, role: slab.role,
          })
          if (s) out.push(s)
        }
      }
    }

    // Foundations — entity foundations + inline auto-isolated footings
    // under un-attached columns.
    if (layerVisibility.foundations) {
      for (const f of Object.values(foundations)) {
        const wallSegs = (f.wallIds || []).map(wid => {
          const w = walls[wid]
          if (!w) return null
          const n1 = nodes[w.n1], n2 = nodes[w.n2]
          if (!n1 || !n2) return null
          return { x1: n1.x, y1: n1.y, x2: n2.x, y2: n2.y, wallId: wid }
        }).filter(Boolean)
        const fs = resolveFoundationSolids({ foundation: f, wallSegments: wallSegs, groundZIn: 0 })
        for (const s of fs) out.push(s)
      }
      const attached = new Set()
      for (const f of Object.values(foundations)) {
        for (const cid of (f.columnIds || [])) attached.add(cid)
      }
      for (const col of Object.values(columns)) {
        if (attached.has(col.id)) continue
        const ct = columnTypes.find(t => t.id === col.columnTypeId)
        if (!ct) continue
        const { x: cx, y: cy } = columnXY(col, nodes)
        const s = resolveInlineFootingSolid({
          x: cx, y: cy, columnType: ct, groundZIn: 0, entityId: col.id,
        })
        if (s) out.push(s)
      }
    }

    // Stamps — OHT sits on the roof slab; sump/septic underground; stairs/lift
    // as a labeled block at floor base.
    if (layerVisibility.stamps) {
      for (const stamp of Object.values(stamps)) {
        const fid = stamp.floorId ?? DEFAULT_FLOOR_ID
        if (!floorVisibility[fid]) continue
        let stampBaseZ
        if (stamp.type === 'overhead_tank') {
          stampBaseZ = topZOf(fid) + slabThicknessIn
        } else if (stamp.type === 'sump' || stamp.type === 'septic_tank') {
          stampBaseZ = 0
        } else {
          stampBaseZ = baseZOf(fid)
        }
        const s = resolveStampSolid({
          stamp, baseZIn: stampBaseZ, entityId: stamp.id, floorId: fid,
        })
        if (s) out.push(s)
      }
    }

    return out
  }, [
    open, floors, floorVisibility, layerVisibility, exploded,
    nodes, walls, stamps, columns, slabs, foundations,
    columnTypes, beamDimensions, slabThicknessIn,
  ])

  // Sort faces back-to-front via painter's algorithm.
  const faces = useMemo(() => buildFaceList(solids), [solids])

  // Iso-space bounds for fit-to-content.
  const bounds = useMemo(() => {
    if (faces.length === 0) return null
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const f of faces) {
      for (const p of f.points) {
        const { sx, sy } = worldToIso(p[0], p[1], p[2])
        if (sx < minX) minX = sx
        if (sx > maxX) maxX = sx
        if (sy < minY) minY = sy
        if (sy > maxY) maxY = sy
      }
    }
    return { minX, maxX, minY, maxY }
  }, [faces])

  // Fit-to-content when the modal opens (or after a layer toggle re-empties).
  const fitDoneRef = useRef(false)
  useEffect(() => {
    if (!open) { fitDoneRef.current = false; return }
    if (!bounds || !svgRef.current) return
    if (fitDoneRef.current) return
    fitDoneRef.current = true
    // Defer one frame so the SVG has its real dimensions.
    const id = requestAnimationFrame(fitToContent)
    return () => cancelAnimationFrame(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bounds])

  function fitToContent() {
    if (!bounds || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const sceneW = (bounds.maxX - bounds.minX) * PX_PER_INCH
    const sceneH = (bounds.maxY - bounds.minY) * PX_PER_INCH
    const padding = 50
    const zw = (rect.width  - padding * 2) / Math.max(1, sceneW)
    const zh = (rect.height - padding * 2) / Math.max(1, sceneH)
    const z  = Math.max(0.05, Math.min(20, Math.min(zw, zh)))
    const cx = (bounds.minX + bounds.maxX) / 2
    const cy = (bounds.minY + bounds.maxY) / 2
    setZoom(z)
    setPan({
      x: rect.width  / 2 - cx * PX_PER_INCH * z,
      y: rect.height / 2 - cy * PX_PER_INCH * z,
    })
  }

  // ── Pan / zoom handlers ──
  function handleMouseDown(e) {
    if (e.button !== 0 && e.button !== 1) return
    e.preventDefault()
    panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
    if (containerRef.current) containerRef.current.style.cursor = 'grabbing'
  }
  useEffect(() => {
    function onMove(e) {
      if (!panStartRef.current) return
      setPan({ x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y })
    }
    function onUp() {
      panStartRef.current = null
      if (containerRef.current) containerRef.current.style.cursor = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, [])

  useEffect(() => {
    const el = svgRef.current
    if (!el || !open) return
    function onWheel(e) {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      setZoom(z => Math.max(0.05, Math.min(20, z * factor)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [open])

  if (!open) return null

  const strokeW = 0.6 / (PX_PER_INCH * zoom)

  return (
    <Modal open={open} onClose={() => setTool('select')} title="3D View" width={1100}>
      <div className="iso-view" ref={containerRef}>
        <div className="iso-canvas-wrap">
          <svg
            ref={svgRef}
            className="iso-svg"
            onMouseDown={handleMouseDown}
            xmlns="http://www.w3.org/2000/svg"
          >
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${PX_PER_INCH * zoom})`}>
              {faces.map((face, i) => {
                const pts = face.points.map(p => {
                  const iso = worldToIso(p[0], p[1], p[2])
                  return `${iso.sx},${iso.sy}`
                }).join(' ')
                const { fill, stroke } = faceColors(face.elementType, face.faceKind)
                return (
                  <polygon
                    key={i}
                    points={pts}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={strokeW}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                )
              })}
            </g>
          </svg>
          {faces.length === 0 && (
            <div className="iso-empty">
              Nothing to show yet. Add rooms, columns, or foundations and reopen.
            </div>
          )}
          <div className="iso-footer-note">
            Read-only preview · Fixed isometric (30°) · Drag to pan · Scroll to zoom
          </div>
        </div>

        <div className="iso-sidebar">
          <div className="iso-sidebar__section">
            <div className="iso-sidebar__title">Floors</div>
            {floors.length === 0 ? (
              <div className="iso-sidebar__hint">No floors.</div>
            ) : floors.map(f => (
              <label key={f.id} className="iso-toggle">
                <input
                  type="checkbox"
                  checked={!!floorVisibility[f.id]}
                  onChange={e => setFloorVisibility(prev => ({ ...prev, [f.id]: e.target.checked }))}
                />
                <span>{f.label}</span>
              </label>
            ))}
          </div>

          <div className="iso-sidebar__section">
            <div className="iso-sidebar__title">Layers</div>
            {Object.keys(layerVisibility).map(k => (
              <label key={k} className="iso-toggle">
                <input
                  type="checkbox"
                  checked={layerVisibility[k]}
                  onChange={e => setLayerVisibility(prev => ({ ...prev, [k]: e.target.checked }))}
                />
                <span>{k.charAt(0).toUpperCase() + k.slice(1)}</span>
              </label>
            ))}
          </div>

          <div className="iso-sidebar__section">
            <div className="iso-sidebar__title">View</div>
            <label className="iso-toggle">
              <input
                type="checkbox"
                checked={exploded}
                onChange={e => setExploded(e.target.checked)}
              />
              <span>Exploded floors (24 in gap)</span>
            </label>
            <Button variant="secondary" size="sm" onClick={fitToContent}>
              Fit to content
            </Button>
          </div>

          <div className="iso-sidebar__footer">
            <div>Zoom: {Math.round(zoom * 100)}%</div>
            <div>Faces: {faces.length}</div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
