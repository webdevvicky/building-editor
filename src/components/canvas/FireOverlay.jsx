// FireOverlay — SVG `<g>` layer for fire-protection devices, detection /
// sprinkler routes, and FIRE_MAIN risers. Mounted inside Canvas.jsx right
// after the HvacOverlay layer.
//
// Phase 1: per-type symbol geometry. Detection devices in orange
// (--color-fire-detection); suppression in red (--color-fire-sprinkler).
//
// Routes come from state.getFireRoutes?.() — Phase 0 returns [] (or the
// helper is absent); the engines subagent replaces with a real implementation
// in parallel. We degrade gracefully when the helper or layer-visibility
// flags are absent.

import { useStore } from '../../store'
import { PX_PER_INCH, GRID_IN } from '../../geometry'
import { getFireDevice } from '../../mep/catalogs/index.js'

// Mirror Canvas.jsx world→SVG-group conversion (Y-up world → Y-down SVG)
const sx = x =>  x * PX_PER_INCH
const sy = y => -y * PX_PER_INCH

function deviceLabel(type) {
  switch (type) {
    case 'SMOKE_DETECTOR':    return 'SD'
    case 'HEAT_DETECTOR':     return 'HD'
    case 'MANUAL_CALL_POINT': return 'MCP'
    case 'FIRE_ALARM_PANEL':  return 'FAP'
    case 'SPRINKLER_HEAD':    return 'SPR'
    case 'FIRE_HOSE_REEL':    return 'HR'
    case 'FIRE_EXTINGUISHER': return 'FE'
    case 'SPRINKLER_VALVE':   return 'SV'
    default:                  return type?.slice(0, 3) ?? '?'
  }
}

function isSuppression(type) {
  return type === 'SPRINKLER_HEAD'
      || type === 'FIRE_HOSE_REEL'
      || type === 'FIRE_EXTINGUISHER'
      || type === 'SPRINKLER_VALVE'
}

function deviceStrokeVar(type) {
  return isSuppression(type)
    ? 'var(--color-fire-sprinkler)'
    : 'var(--color-fire-detection)'
}

function routeStrokeVar(kind) {
  switch (kind) {
    case 'FIRE_DETECTION': return 'var(--color-fire-detection)'
    case 'FIRE_SPRINKLER': return 'var(--color-fire-sprinkler)'
    default:               return 'var(--color-fire-detection)'
  }
}
function routeLayerKey(kind) {
  switch (kind) {
    case 'FIRE_DETECTION': return 'fireDetectionRoutes'
    case 'FIRE_SPRINKLER': return 'fireSprinklerRoutes'
    default:               return 'fireDetectionRoutes'
  }
}
function routeDashArray(kind) {
  return kind === 'FIRE_DETECTION' ? '4 2' : undefined
}
function routeStrokeWidth(kind) {
  return kind === 'FIRE_SPRINKLER' ? 1.5 : 1
}

export default function FireOverlay() {
  const fireDevices       = useStore(s => s.fireDevices)
  const risers            = useStore(s => s.risers)
  const layerVisibility   = useStore(s => s.layerVisibility)
  const currentFloorId    = useStore(s => s.currentFloorId)
  const projectSettings   = useStore(s => s.projectSettings)
  const selectedDeviceId  = useStore(s => s.selectedFireDeviceId)
  const selectFireDevice  = useStore(s => s.selectFireDevice)
  const activeTool        = useStore(s => s.activeTool)
  // Subscribe to keep overlay reactive when engines populate routes.
  const getFireRoutes     = useStore(s => s.getFireRoutes)

  const showDevices = layerVisibility.fireDevices !== false

  const floorsList = projectSettings?.floors ?? []
  const multiFloor = floorsList.length > 1
  const ghostStyle  = { opacity: 0.15, pointerEvents: 'none' }
  const activeStyle = { opacity: 1 }
  const entityStyle = (entity) =>
    !multiFloor || (entity?.floorId ?? 'F1') === currentFloorId ? activeStyle : ghostStyle

  const routes = (typeof getFireRoutes === 'function' ? getFireRoutes() : null) ?? []

  // Filter risers to FIRE_MAIN only.
  const fireRisers = Object.values(risers).filter(r => r.kind === 'FIRE_MAIN')
  const showRisers = layerVisibility.risers !== false

  return (
    <g className="fire-overlay">
      {/* Routes (rendered first so devices sit on top). */}
      {routes.map((route) => {
        const layerKey = routeLayerKey(route.kind)
        if (layerKey && layerVisibility[layerKey] === false) return null
        const pts = (route.points ?? [])
          .map(p => `${sx(p.x)},${sy(p.y)}`)
          .join(' ')
        if (!pts) return null
        const stroke = routeStrokeVar(route.kind)
        const onActiveFloor = !multiFloor || (route.floorId ?? 'F1') === currentFloorId
        const opacity = onActiveFloor ? 0.9 : 0.15
        return (
          <g key={route.id ?? `froute-${pts.length}-${route.kind}`} style={{ pointerEvents: 'none' }}>
            <polyline
              points={pts}
              fill="none"
              stroke={stroke}
              strokeWidth={routeStrokeWidth(route.kind)}
              strokeDasharray={routeDashArray(route.kind)}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={opacity}
            />
          </g>
        )
      })}

      {/* Devices */}
      {showDevices && Object.values(fireDevices).map((device) => {
        const catalog = getFireDevice(device.type)
        const isSel   = device.id === selectedDeviceId
        const fStyle  = entityStyle(device)
        const cx = sx(device.x)
        const cy = sy(device.y)
        const labelText = deviceLabel(device.type)

        const interactive = activeTool === 'select' || activeTool === 'fire'
        const strokeColor = deviceStrokeVar(device.type)
        const selStroke   = 'var(--color-primary)'

        // Symbol geometry per type.
        let sym
        switch (device.type) {
          case 'SMOKE_DETECTOR':
            sym = { kind: 'circle', r: 6 }; break
          case 'HEAT_DETECTOR':
            sym = { kind: 'circle-cross', r: 6 }; break
          case 'MANUAL_CALL_POINT':
            sym = { kind: 'rect', w: 12, h: 12, rx: 1 }; break
          case 'FIRE_ALARM_PANEL':
            sym = { kind: 'rect', w: 18, h: 14, rx: 1, thick: true }; break
          case 'SPRINKLER_HEAD':
            sym = { kind: 'circle-cross-small', r: 4 }; break
          case 'FIRE_HOSE_REEL':
            sym = { kind: 'circle-reel', r: 7 }; break
          case 'FIRE_EXTINGUISHER':
            sym = { kind: 'rect', w: 8, h: 16, rx: 1 }; break
          case 'SPRINKLER_VALVE':
            sym = { kind: 'rect', w: 14, h: 10, rx: 1 }; break
          default:
            sym = { kind: 'circle', r: 6 }
        }

        const strokeWidth = sym.thick
          ? (isSel ? 2.5 : 2)
          : (isSel ? 2 : 1.5)

        // Body
        let body
        if (sym.kind === 'rect') {
          body = (
            <rect
              x={cx - sym.w / 2}
              y={cy - sym.h / 2}
              width={sym.w}
              height={sym.h}
              rx={sym.rx}
              ry={sym.rx}
              fill="var(--color-surface)"
              stroke={isSel ? selStroke : strokeColor}
              strokeWidth={strokeWidth}
            />
          )
        } else if (sym.kind === 'circle') {
          body = (
            <circle
              cx={cx} cy={cy} r={sym.r}
              fill="var(--color-surface)"
              stroke={isSel ? selStroke : strokeColor}
              strokeWidth={strokeWidth}
            />
          )
        } else if (sym.kind === 'circle-cross') {
          // HEAT_DETECTOR — circle + cross hatch
          const s = sym.r * 0.7
          body = (
            <>
              <circle
                cx={cx} cy={cy} r={sym.r}
                fill="var(--color-surface)"
                stroke={isSel ? selStroke : strokeColor}
                strokeWidth={strokeWidth}
              />
              <line
                x1={cx - s} y1={cy - s} x2={cx + s} y2={cy + s}
                stroke={isSel ? selStroke : strokeColor}
                strokeWidth={1}
                opacity={0.7}
                style={{ pointerEvents: 'none' }}
              />
              <line
                x1={cx - s} y1={cy + s} x2={cx + s} y2={cy - s}
                stroke={isSel ? selStroke : strokeColor}
                strokeWidth={1}
                opacity={0.7}
                style={{ pointerEvents: 'none' }}
              />
            </>
          )
        } else if (sym.kind === 'circle-cross-small') {
          // SPRINKLER_HEAD — small circle with crossed lines
          const s = sym.r + 2
          body = (
            <>
              <circle
                cx={cx} cy={cy} r={sym.r}
                fill="var(--color-surface)"
                stroke={isSel ? selStroke : strokeColor}
                strokeWidth={strokeWidth}
              />
              <line
                x1={cx - s} y1={cy} x2={cx + s} y2={cy}
                stroke={isSel ? selStroke : strokeColor}
                strokeWidth={1}
                style={{ pointerEvents: 'none' }}
              />
              <line
                x1={cx} y1={cy - s} x2={cx} y2={cy + s}
                stroke={isSel ? selStroke : strokeColor}
                strokeWidth={1}
                style={{ pointerEvents: 'none' }}
              />
            </>
          )
        } else if (sym.kind === 'circle-reel') {
          // FIRE_HOSE_REEL — outer circle, inner hub
          body = (
            <>
              <circle
                cx={cx} cy={cy} r={sym.r}
                fill="var(--color-surface)"
                stroke={isSel ? selStroke : strokeColor}
                strokeWidth={strokeWidth}
              />
              <circle
                cx={cx} cy={cy} r={sym.r * 0.4}
                fill={isSel ? selStroke : strokeColor}
                stroke="none"
                opacity={0.6}
                style={{ pointerEvents: 'none' }}
              />
            </>
          )
        }

        // Bounding box for selection pulse
        const bbRadius = sym.kind === 'rect'
          ? Math.max(sym.w, sym.h) / 2
          : sym.r

        return (
          <g
            key={device.id}
            style={{
              opacity: fStyle.opacity,
              pointerEvents: fStyle.pointerEvents ?? 'auto',
              cursor: interactive ? 'pointer' : 'default',
            }}
            onClick={(e) => {
              if (!interactive) return
              e.stopPropagation()
              selectFireDevice(device.id)
            }}
          >
            {body}

            <text
              x={cx}
              y={cy + bbRadius + 9}
              textAnchor="middle"
              fontSize={8}
              fontWeight={600}
              fill="var(--color-text)"
              stroke="var(--color-bg)"
              strokeWidth={3}
              paintOrder="stroke"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {labelText}
            </text>

            {/* Catalog label below, only when selected (avoids clutter) */}
            {isSel && catalog && (
              <text
                x={cx}
                y={cy + bbRadius + 20}
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
              sym.kind === 'rect' ? (
                <rect
                  key={`pulse-fdev-${device.id}`}
                  className="canvas-selection-pulse"
                  x={cx - sym.w / 2 - 4}
                  y={cy - sym.h / 2 - 4}
                  width={sym.w + 8}
                  height={sym.h + 8}
                  fill="none"
                  stroke="var(--color-primary)"
                  strokeWidth={4}
                />
              ) : (
                <circle
                  key={`pulse-fdev-${device.id}`}
                  className="canvas-selection-pulse"
                  cx={cx}
                  cy={cy}
                  r={bbRadius + 4}
                  fill="none"
                  stroke="var(--color-primary)"
                  strokeWidth={4}
                />
              )
            )}
          </g>
        )
      })}

      {/* Fire risers (FIRE_MAIN). 10×22 dashed rectangle.
       * fromFloorId/toFloorId determine active-floor ghosting. */}
      {showRisers && fireRisers.map((riser) => {
        const onActiveFloor =
          !multiFloor ||
          riser.fromFloorId === currentFloorId ||
          riser.toFloorId === currentFloorId
        const opacity = onActiveFloor ? 1 : 0.15
        const cx = sx(riser.x ?? 0)
        const cy = sy(riser.y ?? 0)
        const w = 10
        const h = 22
        const stroke = 'var(--color-fire-sprinkler)'
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
              stroke={stroke}
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
              FIRE
            </text>
          </g>
        )
      })}
    </g>
  )
}

// Re-export the foot-pixel constant so future companion components share scale.
export { GRID_IN }
