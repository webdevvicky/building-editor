// ElectricalOverlay — SVG `<g>` layer for electrical points, wiring/submain
// routes, and ELECTRICAL_SUBMAIN risers. Mounted inside Canvas.jsx right
// after the PlumbingOverlay layer.
//
// Phase 1: 14px circles per point (DB/SUB_DB → 18px square). Real SVG
// glyphs land in Phase 2 (see mep/catalogs/pointTypes.glyphId).
//
// Routes come from state.getElectricalRoutes?.() — Phase 0 returns [] (or
// the helper is absent); the engines subagent replaces with a real
// implementation in parallel. We degrade gracefully when the helper or
// layer-visibility flags are absent.

import { useStore } from '../../store'
import { PX_PER_INCH, GRID_IN } from '../../geometry'
import { getPointType } from '../../mep/catalogs/index.js'

// Mirror Canvas.jsx world→SVG-group conversion (Y-up world → Y-down SVG)
const sx = x =>  x * PX_PER_INCH
const sy = y => -y * PX_PER_INCH

// Compact label per point type. Distribution boards get longer text on a
// larger glyph; everyone else uses a 1–2 char abbreviation.
function pointLabel(type) {
  switch (type) {
    case 'LIGHT':              return 'L'
    case 'FAN':                return 'F'
    case 'EXHAUST_FAN':        return 'EF'
    case 'SOCKET_5A':          return '5A'
    case 'SOCKET_15A':         return '15A'
    case 'AC_INDOOR_POINT':    return 'AC'
    case 'AC_OUTDOOR_POINT':   return 'AC'
    case 'GEYSER_POINT':       return 'GY'
    case 'TV_POINT':           return 'TV'
    case 'DB':                 return 'DB'
    case 'SUB_DB':             return 'SDB'
    case 'SWITCHBOARD':        return 'SW'
    case 'ENERGY_METER':       return 'EM'
    case 'EV_CHARGER':         return 'EV'
    case 'INVERTER_TIE_POINT': return 'INV'
    default:                   return type?.slice(0, 2) ?? '?'
  }
}

function isDistributionBoard(type) {
  return type === 'DB' || type === 'SUB_DB'
}

// Stroke colour per route kind.
function routeStrokeVar(kind) {
  switch (kind) {
    case 'ELECTRICAL_SUBMAIN': return 'var(--color-electrical-submain)'
    case 'ELECTRICAL_WIRING':  return 'var(--color-electrical-wire)'
    case 'ELECTRICAL_CONDUIT': return 'var(--color-electrical-conduit)'
    default:                   return 'var(--color-electrical-wire)'
  }
}

// Layer visibility flag per route kind.
function routeLayerKey(kind) {
  switch (kind) {
    case 'ELECTRICAL_SUBMAIN': return 'electricalSubmainRoutes'
    case 'ELECTRICAL_WIRING':  return 'electricalWiringRoutes'
    case 'ELECTRICAL_CONDUIT': return 'electricalWiringRoutes'
    default:                   return 'electricalWiringRoutes'
  }
}

export default function ElectricalOverlay() {
  const electricalPoints  = useStore(s => s.electricalPoints)
  const risers            = useStore(s => s.risers)
  const layerVisibility   = useStore(s => s.layerVisibility)
  const currentFloorId    = useStore(s => s.currentFloorId)
  const projectSettings   = useStore(s => s.projectSettings)
  const selectedPointId   = useStore(s => s.selectedElectricalPointId)
  const selectElectricalPoint = useStore(s => s.selectElectricalPoint)
  const activeTool        = useStore(s => s.activeTool)
  // Phase 4 Tier-2 ADD 3: circuit-highlight selection from the namespaced
  // selection state. Points + routes whose circuitId matches get the
  // primary stroke + bumped width.
  const highlightedCircuitId = useStore(s => s.selection?.electricalCircuitId ?? null)
  // Subscribe to keep overlay reactive when engines populate routes.
  const getElectricalRoutes = useStore(s => s.getElectricalRoutes)

  const showPoints = layerVisibility.electricalPoints !== false
  const showRisers = layerVisibility.risers !== false

  const floorsList = projectSettings?.floors ?? []
  const multiFloor = floorsList.length > 1
  const ghostStyle  = { opacity: 0.15, pointerEvents: 'none' }
  const activeStyle = { opacity: 1 }
  const entityStyle = (entity) =>
    !multiFloor || (entity?.floorId ?? 'F1') === currentFloorId ? activeStyle : ghostStyle

  // Routes pipeline still wiring; engines subagent replaces the empty stub.
  const routes = (typeof getElectricalRoutes === 'function' ? getElectricalRoutes() : null) ?? []

  // Filter risers to ELECTRICAL_SUBMAIN kind only — plumbing/HVAC risers
  // belong to their own overlays.
  const electricalRisers = Object.values(risers).filter(r => r.kind === 'ELECTRICAL_SUBMAIN')

  return (
    <g className="electrical-overlay">
      {/* Routes (rendered first so points sit on top). Conduit underglow:
       * 3px lighter background line, with the 1px solid wire on top. */}
      {routes.map((route) => {
        const layerKey = routeLayerKey(route.kind)
        if (layerKey && layerVisibility[layerKey] === false) return null
        const pts = (route.points ?? [])
          .map(p => `${sx(p.x)},${sy(p.y)}`)
          .join(' ')
        if (!pts) return null
        const matchesCircuit = highlightedCircuitId && route.circuitId === highlightedCircuitId
        const stroke = matchesCircuit ? 'var(--color-primary)' : routeStrokeVar(route.kind)
        const onActiveFloor = !multiFloor || (route.floorId ?? 'F1') === currentFloorId
        // Dim non-matching routes when a circuit is highlighted so the
        // active circuit visually pops.
        const dimmed = highlightedCircuitId && !matchesCircuit
        const opacity = onActiveFloor ? (dimmed ? 0.25 : 0.9) : 0.15
        const isSubmain = route.kind === 'ELECTRICAL_SUBMAIN'
        return (
          <g key={route.id ?? `eroute-${pts.length}-${route.kind}`} style={{ pointerEvents: 'none' }}>
            {/* Conduit underglow */}
            <polyline
              points={pts}
              fill="none"
              stroke="var(--color-electrical-conduit)"
              strokeWidth={isSubmain ? 4 : 3}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={opacity * 0.5}
            />
            {/* Wire on top */}
            <polyline
              points={pts}
              fill="none"
              stroke={stroke}
              strokeWidth={matchesCircuit ? (isSubmain ? 2.5 : 2) : (isSubmain ? 1.5 : 1)}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={opacity}
            />
          </g>
        )
      })}

      {/* Points */}
      {showPoints && Object.values(electricalPoints).map((point) => {
        const catalog = getPointType(point.type)
        const isSel   = point.id === selectedPointId
        const matchesCircuit = highlightedCircuitId && point.circuitId === highlightedCircuitId
        const dimmed = highlightedCircuitId && !matchesCircuit
        const fStyleRaw = entityStyle(point)
        const fStyle = dimmed
          ? { opacity: (fStyleRaw.opacity ?? 1) * 0.3, pointerEvents: fStyleRaw.pointerEvents }
          : fStyleRaw
        const cx = sx(point.x)
        const cy = sy(point.y)
        const isDB = isDistributionBoard(point.type)
        const labelText = pointLabel(point.type)

        const interactive = activeTool === 'select' || activeTool === 'electrical'

        const strokeColor = matchesCircuit
          ? 'var(--color-primary)'
          : 'var(--color-electrical-wire)'
        const selStroke   = 'var(--color-primary)'

        return (
          <g
            key={point.id}
            style={{
              opacity: fStyle.opacity,
              pointerEvents: fStyle.pointerEvents ?? 'auto',
              cursor: interactive ? 'pointer' : 'default',
            }}
            onClick={(e) => {
              if (!interactive) return
              e.stopPropagation()
              selectElectricalPoint(point.id)
            }}
          >
            {isDB ? (
              // DB / SUB_DB — 18px square, thicker stroke
              <rect
                x={cx - 9}
                y={cy - 9}
                width={18}
                height={18}
                fill="var(--color-surface)"
                stroke={isSel ? selStroke : strokeColor}
                strokeWidth={isSel ? 2.5 : 2}
              />
            ) : (
              // Regular point — 14px circle
              <circle
                cx={cx}
                cy={cy}
                r={7}
                fill="var(--color-surface)"
                stroke={isSel ? selStroke : strokeColor}
                strokeWidth={isSel ? 2 : 1.5}
              />
            )}

            <text
              x={cx}
              y={cy + (isDB ? 4 : 3)}
              textAnchor="middle"
              fontSize={isDB ? 9 : 8}
              fontWeight={600}
              fill="var(--color-text)"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {labelText}
            </text>

            {/* Catalog label below, only when selected (avoids clutter) */}
            {isSel && catalog && (
              <text
                x={cx}
                y={cy + (isDB ? 18 : 16)}
                textAnchor="middle"
                fontSize={9}
                fill="var(--color-text-secondary)"
                stroke="var(--color-bg)"
                strokeWidth={3}
                paintOrder="stroke"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {catalog.label}
              </text>
            )}

            {isSel && (
              isDB ? (
                <rect
                  key={`pulse-epoint-${point.id}`}
                  className="canvas-selection-pulse"
                  x={cx - 13}
                  y={cy - 13}
                  width={26}
                  height={26}
                  fill="none"
                  stroke="var(--color-primary)"
                  strokeWidth={4}
                />
              ) : (
                <circle
                  key={`pulse-epoint-${point.id}`}
                  className="canvas-selection-pulse"
                  cx={cx}
                  cy={cy}
                  r={11}
                  fill="none"
                  stroke="var(--color-primary)"
                  strokeWidth={4}
                />
              )
            )}
          </g>
        )
      })}

      {/* Electrical submain risers — small dashed glyph at (x,y). 12×24
       * dashed rectangle for the vertical shaft icon. fromFloorId/toFloorId
       * are stored on the riser; we show ghost styling when neither
       * matches currentFloor. */}
      {showRisers && electricalRisers.map((riser) => {
        const onActiveFloor =
          !multiFloor ||
          riser.fromFloorId === currentFloorId ||
          riser.toFloorId === currentFloorId
        const opacity = onActiveFloor ? 1 : 0.15
        const cx = sx(riser.x ?? 0)
        const cy = sy(riser.y ?? 0)
        const w = 12
        const h = 24
        return (
          <g
            key={riser.id}
            style={{ opacity, pointerEvents: onActiveFloor ? 'auto' : 'none' }}
          >
            <rect
              x={cx - w / 2}
              y={cy - h / 2}
              width={w}
              height={h}
              fill="none"
              stroke="var(--color-electrical-submain)"
              strokeWidth={1.5}
              strokeDasharray="3 2"
            />
            <text
              x={cx + w / 2 + 4}
              y={cy + 3}
              fontSize={9}
              fill="var(--color-text-muted)"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              SUBMAIN
            </text>
          </g>
        )
      })}
    </g>
  )
}

// Re-export the foot-pixel constant so future companion components (route
// inspector overlays, circuit visualization) share the same scale.
export { GRID_IN }
