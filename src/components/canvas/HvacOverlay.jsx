// HvacOverlay — SVG `<g>` layer for HVAC units, refrigerant/condensate
// routes, and HVAC_REFRIGERANT / HVAC_CONDENSATE risers. Mounted inside
// Canvas.jsx right after the ElectricalOverlay layer.
//
// Phase 1: indoor unit = 20×12 rounded rect, outdoor = 24×16 rect, exhaust
// fan = 16px circle with fan-blade hint. Real SVG glyphs land in Phase 2.
//
// Routes come from state.getHvacRoutes?.() — Phase 0 returns [] (or the
// helper is absent); the engines subagent replaces with a real implementation
// in parallel. We degrade gracefully when the helper or layer-visibility
// flags are absent.

import { useStore } from '../../store'
import { PX_PER_INCH, GRID_IN } from '../../geometry'
import { getHvacUnit } from '../../mep/catalogs/index.js'

// Mirror Canvas.jsx world→SVG-group conversion (Y-up world → Y-down SVG)
const sx = x =>  x * PX_PER_INCH
const sy = y => -y * PX_PER_INCH

function isIndoorUnit(type) {
  return type === 'AC_INDOOR_UNIT' || type === 'DUCTED_AC_INDOOR'
}
function isOutdoorUnit(type) {
  return type === 'AC_OUTDOOR_UNIT' || type === 'DUCTED_AC_OUTDOOR'
}
function isExhaustFan(type) {
  return type === 'EXHAUST_FAN_HVAC'
}

function unitLabel(type) {
  switch (type) {
    case 'AC_INDOOR_UNIT':    return 'AC-I'
    case 'AC_OUTDOOR_UNIT':   return 'AC-O'
    case 'DUCTED_AC_INDOOR':  return 'AC-I'
    case 'DUCTED_AC_OUTDOOR': return 'AC-O'
    case 'EXHAUST_FAN_HVAC':  return 'EXH'
    case 'FRESH_AIR_INLET':   return 'FA'
    default:                  return type?.slice(0, 3) ?? '?'
  }
}

// Stroke / layer-visibility keys per route kind.
function routeStrokeVar(kind) {
  switch (kind) {
    case 'HVAC_REFRIGERANT': return 'var(--color-hvac-refrigerant)'
    case 'HVAC_CONDENSATE':  return 'var(--color-hvac-condensate)'
    default:                 return 'var(--color-hvac-refrigerant)'
  }
}
function routeLayerKey(kind) {
  switch (kind) {
    case 'HVAC_REFRIGERANT': return 'hvacRefrigerantRoutes'
    case 'HVAC_CONDENSATE':  return 'hvacCondensateRoutes'
    default:                 return 'hvacRefrigerantRoutes'
  }
}
function routeStrokeWidth(kind) {
  return kind === 'HVAC_REFRIGERANT' ? 1.5 : 1
}

export default function HvacOverlay() {
  const hvacUnits         = useStore(s => s.hvacUnits)
  const risers            = useStore(s => s.risers)
  const layerVisibility   = useStore(s => s.layerVisibility)
  const currentFloorId    = useStore(s => s.currentFloorId)
  const projectSettings   = useStore(s => s.projectSettings)
  const selectedUnitId    = useStore(s => s.selectedHvacUnitId)
  const selectHvacUnit    = useStore(s => s.selectHvacUnit)
  const activeTool        = useStore(s => s.activeTool)
  // Subscribe to keep overlay reactive when engines populate routes.
  const getHvacRoutes     = useStore(s => s.getHvacRoutes)

  const showUnits = layerVisibility.hvacUnits !== false

  const floorsList = projectSettings?.floors ?? []
  const multiFloor = floorsList.length > 1
  const ghostStyle  = { opacity: 0.15, pointerEvents: 'none' }
  const activeStyle = { opacity: 1 }
  const entityStyle = (entity) =>
    !multiFloor || (entity?.floorId ?? 'F1') === currentFloorId ? activeStyle : ghostStyle

  // Routes pipeline still wiring; engines subagent replaces the empty stub.
  const routes = (typeof getHvacRoutes === 'function' ? getHvacRoutes() : null) ?? []

  // Filter risers to HVAC_REFRIGERANT / HVAC_CONDENSATE kinds only.
  const hvacRisers = Object.values(risers).filter(r =>
    r.kind === 'HVAC_REFRIGERANT' || r.kind === 'HVAC_CONDENSATE',
  )
  const showRisers = layerVisibility.risers !== false

  return (
    <g className="hvac-overlay">
      {/* Routes (rendered first so units sit on top). */}
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
          <g key={route.id ?? `hroute-${pts.length}-${route.kind}`} style={{ pointerEvents: 'none' }}>
            <polyline
              points={pts}
              fill="none"
              stroke={stroke}
              strokeWidth={routeStrokeWidth(route.kind)}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={opacity}
            />
          </g>
        )
      })}

      {/* Units */}
      {showUnits && Object.values(hvacUnits).map((unit) => {
        const catalog = getHvacUnit(unit.type)
        const isSel   = unit.id === selectedUnitId
        const fStyle  = entityStyle(unit)
        const cx = sx(unit.x)
        const cy = sy(unit.y)
        const labelText = unitLabel(unit.type)

        const interactive = activeTool === 'select' || activeTool === 'hvac'

        const strokeColor = 'var(--color-hvac-refrigerant)'
        const selStroke   = 'var(--color-primary)'

        const indoor  = isIndoorUnit(unit.type)
        const outdoor = isOutdoorUnit(unit.type)
        const exhaust = isExhaustFan(unit.type)

        // Symbol geometry per type.
        // INDOOR: 20×12 rounded rect, OUTDOOR: 24×16 rect, EXHAUST: 16px circle,
        // others (fresh-air inlet, ducted variants fall back to outdoor rect).
        const sym = indoor
          ? { kind: 'rect', w: 20, h: 12, rx: 3 }
          : exhaust
            ? { kind: 'circle', r: 8 }
            : { kind: 'rect', w: 24, h: 16, rx: 1 }

        return (
          <g
            key={unit.id}
            style={{
              opacity: fStyle.opacity,
              pointerEvents: fStyle.pointerEvents ?? 'auto',
              cursor: interactive ? 'pointer' : 'default',
            }}
            onClick={(e) => {
              if (!interactive) return
              e.stopPropagation()
              selectHvacUnit(unit.id)
            }}
          >
            {sym.kind === 'rect' ? (
              <rect
                x={cx - sym.w / 2}
                y={cy - sym.h / 2}
                width={sym.w}
                height={sym.h}
                rx={sym.rx}
                ry={sym.rx}
                fill="var(--color-surface)"
                stroke={isSel ? selStroke : strokeColor}
                strokeWidth={isSel ? 2 : 1.5}
              />
            ) : (
              <>
                <circle
                  cx={cx}
                  cy={cy}
                  r={sym.r}
                  fill="var(--color-surface)"
                  stroke={isSel ? selStroke : strokeColor}
                  strokeWidth={isSel ? 2 : 1.5}
                />
                {/* Fan-blade hint: two crossed thin lines */}
                <line
                  x1={cx - sym.r * 0.7} y1={cy - sym.r * 0.7}
                  x2={cx + sym.r * 0.7} y2={cy + sym.r * 0.7}
                  stroke={isSel ? selStroke : strokeColor}
                  strokeWidth={1}
                  opacity={0.6}
                  style={{ pointerEvents: 'none' }}
                />
                <line
                  x1={cx - sym.r * 0.7} y1={cy + sym.r * 0.7}
                  x2={cx + sym.r * 0.7} y2={cy - sym.r * 0.7}
                  stroke={isSel ? selStroke : strokeColor}
                  strokeWidth={1}
                  opacity={0.6}
                  style={{ pointerEvents: 'none' }}
                />
              </>
            )}

            <text
              x={cx}
              y={cy + 3}
              textAnchor="middle"
              fontSize={8}
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
                y={cy + (sym.kind === 'rect' ? sym.h / 2 + 10 : sym.r + 10)}
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
                  key={`pulse-hunit-${unit.id}`}
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
                  key={`pulse-hunit-${unit.id}`}
                  className="canvas-selection-pulse"
                  cx={cx}
                  cy={cy}
                  r={sym.r + 4}
                  fill="none"
                  stroke="var(--color-primary)"
                  strokeWidth={4}
                />
              )
            )}
          </g>
        )
      })}

      {/* HVAC risers (refrigerant / condensate). 10×22 dashed rectangle.
       * fromFloorId/toFloorId determine active-floor ghosting. */}
      {showRisers && hvacRisers.map((riser) => {
        const onActiveFloor =
          !multiFloor ||
          riser.fromFloorId === currentFloorId ||
          riser.toFloorId === currentFloorId
        const opacity = onActiveFloor ? 1 : 0.15
        const cx = sx(riser.x ?? 0)
        const cy = sy(riser.y ?? 0)
        const w = 10
        const h = 22
        const stroke = routeStrokeVar(riser.kind)
        const label = riser.kind === 'HVAC_REFRIGERANT' ? 'REF' : 'COND'
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
              {label}
            </text>
          </g>
        )
      })}
    </g>
  )
}

// Re-export the foot-pixel constant so future companion components share scale.
export { GRID_IN }
