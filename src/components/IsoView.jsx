import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { Modal } from './ui/Modal.jsx'
import { Button } from './ui/Button.jsx'
import {
  worldToIso, makeViewBasis, sortedFloors as sortFloors,
  floorBaseZIn, floorTopZIn,
} from '../iso/projection'
import {
  ISO_PRESETS, TOP_PRESET, DEFAULT_VIEW,
  ELEVATION_MIN_DEG, ELEVATION_MAX_DEG,
} from '../iso/viewPresets'
import {
  resolveWallSolid, resolveColumnSolid, resolveBeamSolid,
  resolveSlabSolid, resolveFoundationSolids, resolveInlineFootingSolid,
  resolveStampSolid,
} from '../iso/solids'
import { buildFaceList } from '../iso/extrude'
import { faceColors } from '../iso/colors'
import { resolveBeamEndpoint } from '../topology/beams'
import './iso.css'

const FT = 12
const DEFAULT_EXPLODED_GAP_IN = 24   // 2 ft visual gap between stacked floors
const PX_PER_INCH = 0.6
const DEFAULT_FLOOR_ID = 'F1'

const ORBIT_AZ_DEG_PER_PX = 0.4
const ORBIT_EL_DEG_PER_PX = 0.3

// Vertical center of a beam by level. Plinth beams sit at the bottom of
// the floor's walls; lintels at ~7 ft above; roof beams at the floor top.
function beamTopZForLevel(level, floorBaseZ, floorTopZ) {
  if (level === 'plinth') return floorBaseZ
  if (level === 'lintel') return floorBaseZ + 84   // 7 ft
  return floorTopZ                                 // roof
}

// Column position. Attached columns mirror the node; standalone use col.x/y.
function columnXY(col, nodes) {
  if (col.attachedNodeId && nodes[col.attachedNodeId]) {
    const n = nodes[col.attachedNodeId]
    return { x: n.x, y: n.y }
  }
  return { x: col.x, y: col.y }
}

// Normalise an azimuth degree value to [0, 360).
function wrapAz(deg) {
  return ((deg % 360) + 360) % 360
}

// True when two views point the same way (used to highlight the active preset).
function isSameView(a, b) {
  return Math.round(wrapAz(a.azimuthDeg)) === Math.round(wrapAz(b.azimuthDeg))
      && Math.round(a.elevationDeg)        === Math.round(b.elevationDeg)
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

  // Camera view + drag mode.
  const [view, setView]         = useState(DEFAULT_VIEW)
  const [dragMode, setDragMode] = useState('pan')   // 'pan' | 'orbit'
  const basis = useMemo(() => makeViewBasis(view), [view])

  // Pan / zoom local state.
  const [pan, setPan]    = useState({ x: 0, y: 0 })
  const [zoom, setZoom]  = useState(1)
  const panStartRef      = useRef(null)
  const orbitStartRef    = useRef(null)
  const svgRef           = useRef(null)
  const containerRef     = useRef(null)

  // ── rAF throttle for view changes during drag/slider ─────────────────
  const pendingViewRef = useRef(null)
  const rafRef         = useRef(null)
  const scheduleView = useCallback((next) => {
    pendingViewRef.current = next
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      const v = pendingViewRef.current
      pendingViewRef.current = null
      rafRef.current = null
      if (v) setView(v)
    })
  }, [])
  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
  }, [])

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
      const st = useStore.getState()
      const allBeams = st.getAllBeams?.() ?? []
      for (const beam of allBeams) {
        const fid = beam.floorId ?? walls[beam.sourceWallId]?.floorId ?? DEFAULT_FLOOR_ID
        if (!floorVisibility[fid]) continue
        // Canonical resolver — handles COLUMN / BEAM / WALL / POINT, returns
        // {x,y}|null. Unresolvable (dangling / cyclic) endpoints skip the beam.
        const fromXY = resolveBeamEndpoint(st, beam.endpoints?.from)
        const toXY   = resolveBeamEndpoint(st, beam.endpoints?.to)
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

  // Sort faces back-to-front via painter's algorithm — basis-aware now.
  const faces = useMemo(() => buildFaceList(solids, basis), [solids, basis])

  // Iso-space bounds for fit-to-content (basis-aware).
  const bounds = useMemo(() => {
    if (faces.length === 0) return null
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const f of faces) {
      for (const p of f.points) {
        const { sx, sy } = worldToIso(p[0], p[1], p[2], basis)
        if (sx < minX) minX = sx
        if (sx > maxX) maxX = sx
        if (sy < minY) minY = sy
        if (sy > maxY) maxY = sy
      }
    }
    return { minX, maxX, minY, maxY }
  }, [faces, basis])

  // ── Fit-to-content ──────────────────────────────────────────────────────
  const fitToContent = useCallback(() => {
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
  }, [bounds])

  // Fit-to-content when the modal opens.
  const fitDoneRef = useRef(false)
  useEffect(() => {
    if (!open) { fitDoneRef.current = false; return }
    if (!bounds || !svgRef.current) return
    if (fitDoneRef.current) return
    fitDoneRef.current = true
    const id = requestAnimationFrame(fitToContent)
    return () => cancelAnimationFrame(id)
  }, [open, bounds, fitToContent])

  // Re-fit on preset / reset only (NOT on every view tick during drag).
  // applyPreset sets this flag; the effect below fires once after bounds
  // update to the new view, then clears the flag.
  const refitOnNextBoundsRef = useRef(false)
  useEffect(() => {
    if (!refitOnNextBoundsRef.current) return
    if (!bounds) return
    refitOnNextBoundsRef.current = false
    fitToContent()
  }, [bounds, fitToContent])

  const applyPreset = useCallback((preset) => {
    // Drop any pending throttled update so the preset wins immediately.
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    pendingViewRef.current = null
    refitOnNextBoundsRef.current = true
    setView({ azimuthDeg: preset.azimuthDeg, elevationDeg: preset.elevationDeg })
  }, [])

  const resetView = useCallback(() => {
    applyPreset(DEFAULT_VIEW)
  }, [applyPreset])

  // ── Pan / orbit handlers ──
  function handleMouseDown(e) {
    if (e.button !== 0 && e.button !== 1) return
    e.preventDefault()
    if (dragMode === 'orbit') {
      orbitStartRef.current = { x: e.clientX, y: e.clientY, view: { ...view } }
    } else {
      panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
    }
    if (containerRef.current) containerRef.current.style.cursor = 'grabbing'
  }
  useEffect(() => {
    function onMove(e) {
      if (panStartRef.current) {
        setPan({ x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y })
      } else if (orbitStartRef.current) {
        const start = orbitStartRef.current
        const dx = e.clientX - start.x
        const dy = e.clientY - start.y
        const nextAz = wrapAz(start.view.azimuthDeg + dx * ORBIT_AZ_DEG_PER_PX)
        const nextEl = Math.max(
          ELEVATION_MIN_DEG,
          Math.min(ELEVATION_MAX_DEG, start.view.elevationDeg - dy * ORBIT_EL_DEG_PER_PX),
        )
        scheduleView({ azimuthDeg: nextAz, elevationDeg: nextEl })
      }
    }
    function onUp() {
      panStartRef.current = null
      orbitStartRef.current = null
      if (containerRef.current) containerRef.current.style.cursor = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, [scheduleView])

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
      <div className="iso-view">
        <div className="iso-canvas-wrap">
          <svg
            ref={svgRef}
            className="iso-svg"
            data-drag-mode={dragMode}
            onMouseDown={handleMouseDown}
            xmlns="http://www.w3.org/2000/svg"
          >
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${PX_PER_INCH * zoom})`}>
              {faces.map((face) => {
                const pts = face.points.map(p => {
                  const iso = worldToIso(p[0], p[1], p[2], basis)
                  return `${iso.sx},${iso.sy}`
                }).join(' ')
                const { fill, stroke } = faceColors(face.elementType, face.faceKind)
                // Stable React key: element + entity + face role + edge slot.
                // originalIndex tail disambiguates multi-solid entities like
                // PILE foundations (cap + N shafts share entityId) without
                // re-introducing array-index instability.
                const key = `${face.elementType}:${face.entityId ?? '_'}:${face.faceKind}:${face.edgeIndex ?? '_'}:${face.originalIndex}`
                return (
                  <polygon
                    key={key}
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
            {Math.round(view.azimuthDeg)}° az · {Math.round(view.elevationDeg)}° el · Drag to {dragMode} · Scroll to zoom
          </div>
        </div>

        <div className="iso-sidebar">
          <div className="iso-sidebar__section">
            <div className="iso-sidebar__title">Camera</div>
            <div className="iso-preset-grid">
              {[...ISO_PRESETS, TOP_PRESET].map(p => (
                <Button
                  key={p.id}
                  size="sm"
                  variant={isSameView(view, p) ? 'primary' : 'ghost'}
                  onClick={() => applyPreset(p)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <label className="iso-slider-row">
              <span className="iso-slider-row__label">Elevation</span>
              <input
                type="range"
                min={ELEVATION_MIN_DEG}
                max={ELEVATION_MAX_DEG}
                step={1}
                value={Math.round(view.elevationDeg)}
                onChange={e => scheduleView({ ...view, elevationDeg: Number(e.target.value) })}
              />
              <span className="iso-slider-row__value">{Math.round(view.elevationDeg)}°</span>
            </label>
            <div className="iso-mode-toggle">
              <Button
                size="sm"
                variant={dragMode === 'pan' ? 'primary' : 'ghost'}
                onClick={() => setDragMode('pan')}
              >Pan</Button>
              <Button
                size="sm"
                variant={dragMode === 'orbit' ? 'primary' : 'ghost'}
                onClick={() => setDragMode('orbit')}
              >Orbit</Button>
            </div>
            <Button variant="secondary" size="sm" onClick={resetView}>
              Reset view
            </Button>
          </div>

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
