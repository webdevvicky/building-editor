// ElvOverlay — SVG `<g>` layer for ELV (extra-low-voltage) devices and
// their CCTV / data routes. Mounted inside Canvas.jsx right after the
// FireOverlay layer.
//
// Phase 1: per-type symbol geometry. CCTV devices in indigo-dark
// (--color-elv-cctv); data / wifi / structured-cabling in indigo
// (--color-elv-data); security devices share the cctv color so they
// stand apart from data drops.
//
// Routes come from state.getElvRoutes?.() — Phase 0 returns nothing (or
// the helper is absent); the engines subagent replaces with a real
// implementation in parallel. We degrade gracefully when the helper or
// layer-visibility flags are absent.

import { useStore } from '../../store'
import { PX_PER_INCH, GRID_IN } from '../../geometry'
import { getElvDevice } from '../../mep/catalogs/index.js'

// Mirror Canvas.jsx world→SVG-group conversion (Y-up world → Y-down SVG)
const sx = x =>  x * PX_PER_INCH
const sy = y => -y * PX_PER_INCH

function deviceLabel(type) {
  switch (type) {
    case 'CCTV_CAMERA':      return 'CAM'
    case 'DATA_POINT':       return 'RJ45'
    case 'WIFI_AP':          return 'WIFI'
    case 'VIDEO_DOOR_PHONE': return 'VDP'
    case 'INTERCOM':         return 'INT'
    case 'TV_POINT_ELV':     return 'TV'
    case 'ALARM_SENSOR':     return 'SEN'
    case 'ELV_RACK':         return 'RACK'
    default:                 return type?.slice(0, 3) ?? '?'
  }
}

// CCTV + security + AV share the "cctv" indigo-dark stroke so they're
// visually distinct from data/network drops. Data + wifi + rack use the
// brighter data indigo.
function isCctvFamily(type) {
  return type === 'CCTV_CAMERA'
      || type === 'VIDEO_DOOR_PHONE'
      || type === 'INTERCOM'
      || type === 'ALARM_SENSOR'
      || type === 'TV_POINT_ELV'
}

function deviceStrokeVar(type) {
  return isCctvFamily(type)
    ? 'var(--color-elv-cctv)'
    : 'var(--color-elv-data)'
}

function routeStrokeVar(kind) {
  switch (kind) {
    case 'ELV_CCTV': return 'var(--color-elv-cctv)'
    case 'ELV_DATA': return 'var(--color-elv-data)'
    default:         return 'var(--color-elv-data)'
  }
}
function routeLayerKey(kind) {
  switch (kind) {
    case 'ELV_CCTV': return 'elvCctvRoutes'
    case 'ELV_DATA': return 'elvDataRoutes'
    default:         return 'elvDataRoutes'
  }
}

export default function ElvOverlay() {
  const elvDevices        = useStore(s => s.elvDevices)
  const layerVisibility   = useStore(s => s.layerVisibility)
  const currentFloorId    = useStore(s => s.currentFloorId)
  const projectSettings   = useStore(s => s.projectSettings)
  const selectedDeviceId  = useStore(s => s.selectedElvDeviceId)
  const selectElvDevice   = useStore(s => s.selectElvDevice)
  const activeTool        = useStore(s => s.activeTool)
  // Subscribe to keep overlay reactive when engines populate routes.
  const getElvRoutes      = useStore(s => s.getElvRoutes)

  const showDevices = layerVisibility.elvDevices !== false

  const floorsList = projectSettings?.floors ?? []
  const multiFloor = floorsList.length > 1
  const ghostStyle  = { opacity: 0.15, pointerEvents: 'none' }
  const activeStyle = { opacity: 1 }
  const entityStyle = (entity) =>
    !multiFloor || (entity?.floorId ?? 'F1') === currentFloorId ? activeStyle : ghostStyle

  const routes = (typeof getElvRoutes === 'function' ? getElvRoutes() : null) ?? []

  return (
    <g className="elv-overlay">
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
          <g key={route.id ?? `eroute-${pts.length}-${route.kind}`} style={{ pointerEvents: 'none' }}>
            <polyline
              points={pts}
              fill="none"
              stroke={stroke}
              strokeWidth={1}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={opacity}
            />
          </g>
        )
      })}

      {/* Devices */}
      {showDevices && Object.values(elvDevices).map((device) => {
        const catalog = getElvDevice(device.type)
        const isSel   = device.id === selectedDeviceId
        const fStyle  = entityStyle(device)
        const cx = sx(device.x)
        const cy = sy(device.y)
        const labelText = deviceLabel(device.type)

        const interactive = activeTool === 'select' || activeTool === 'elv'
        const strokeColor = deviceStrokeVar(device.type)
        const selStroke   = 'var(--color-primary)'

        // Symbol geometry per type.
        // - CCTV_CAMERA → triangle pointing up (cone-of-view hint), 16px tall.
        // - WIFI_AP → circle with radio-wave arcs.
        // - DATA_POINT → 10×10 square (RJ45 outlet).
        // - VIDEO_DOOR_PHONE → 14×10 rectangle (slim landscape outlet).
        // - INTERCOM → same shape, thicker stroke (signals "permanent").
        // - TV_POINT_ELV → 12×10 rectangle.
        // - ALARM_SENSOR → small 10px circle (PIR dome).
        // - ELV_RACK → 18×24 rectangle, thicker stroke (equipment).
        let sym
        switch (device.type) {
          case 'CCTV_CAMERA':
            sym = { kind: 'triangle', h: 16, w: 14 }; break
          case 'WIFI_AP':
            sym = { kind: 'wifi', r: 7 }; break
          case 'DATA_POINT':
            sym = { kind: 'rect', w: 10, h: 10, rx: 1 }; break
          case 'VIDEO_DOOR_PHONE':
            sym = { kind: 'rect', w: 14, h: 10, rx: 1 }; break
          case 'INTERCOM':
            sym = { kind: 'rect', w: 14, h: 10, rx: 1, thick: true }; break
          case 'TV_POINT_ELV':
            sym = { kind: 'rect', w: 12, h: 10, rx: 1 }; break
          case 'ALARM_SENSOR':
            sym = { kind: 'circle', r: 5 }; break
          case 'ELV_RACK':
            sym = { kind: 'rect', w: 18, h: 24, rx: 1, thick: true }; break
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
        } else if (sym.kind === 'triangle') {
          // CCTV — cone-of-view triangle (apex at top, opens downward).
          // Apex sits at (cx, cy - h/2); base at cy + h/2 spanning w.
          const half = sym.w / 2
          const top  = cy - sym.h / 2
          const bot  = cy + sym.h / 2
          const points = `${cx},${top} ${cx - half},${bot} ${cx + half},${bot}`
          body = (
            <polygon
              points={points}
              fill="var(--color-surface)"
              stroke={isSel ? selStroke : strokeColor}
              strokeWidth={strokeWidth}
            />
          )
        } else if (sym.kind === 'wifi') {
          // WIFI_AP — circle base with two radio-wave arcs above.
          const stroke = isSel ? selStroke : strokeColor
          body = (
            <>
              <circle
                cx={cx} cy={cy} r={sym.r}
                fill="var(--color-surface)"
                stroke={stroke}
                strokeWidth={strokeWidth}
              />
              {/* radio-wave hint — two concentric arcs above the body */}
              <path
                d={`M ${cx - sym.r * 0.7} ${cy - sym.r * 0.2} A ${sym.r * 0.85} ${sym.r * 0.85} 0 0 1 ${cx + sym.r * 0.7} ${cy - sym.r * 0.2}`}
                fill="none"
                stroke={stroke}
                strokeWidth={1}
                opacity={0.7}
                style={{ pointerEvents: 'none' }}
              />
              <path
                d={`M ${cx - sym.r * 1.2} ${cy - sym.r * 0.5} A ${sym.r * 1.4} ${sym.r * 1.4} 0 0 1 ${cx + sym.r * 1.2} ${cy - sym.r * 0.5}`}
                fill="none"
                stroke={stroke}
                strokeWidth={1}
                opacity={0.5}
                style={{ pointerEvents: 'none' }}
              />
            </>
          )
        }

        // Bounding box for selection pulse / label placement
        let bbRadius
        if (sym.kind === 'rect')       bbRadius = Math.max(sym.w, sym.h) / 2
        else if (sym.kind === 'triangle') bbRadius = sym.h / 2
        else                            bbRadius = sym.r

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
              selectElvDevice(device.id)
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
                  key={`pulse-edev-${device.id}`}
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
                  key={`pulse-edev-${device.id}`}
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
    </g>
  )
}

// Re-export the foot-pixel constant so future companion components share scale.
export { GRID_IN }
