// PlumbingOverlay — SVG `<g>` layer for plumbing fixtures, supply/drain
// routes, and risers. Mounted inside Canvas.jsx between the beams layer
// and the nodes layer.
//
// Phase 1: placeholder rectangle glyphs labeled by catalog id. Real SVG
// fixture glyphs land in Phase 2 (see mep/catalogs/fixtureTypes.glyphId).
//
// Routes come from state.getPlumbingRoutes?.() — Phase 0 returns []; the
// engines subagent replaces with a real implementation in parallel.
// We degrade gracefully when the helper or layer-visibility flags are absent.

import { useStore } from '../../store'
import { PX_PER_INCH, GRID_IN } from '../../geometry'
import { getFixtureType } from '../../mep/catalogs/index.js'

// Mirror Canvas.jsx world→SVG-group conversion (Y-up world → Y-down SVG)
const sx = x =>  x * PX_PER_INCH
const sy = y => -y * PX_PER_INCH

// Fixture glyph: 16px square. Stroke colour depends on fixture role:
//   has water inlet  → cold-supply blue
//   drain-only       → drain green
//   none of either   → neutral text colour (e.g., dry equipment)
function fixtureStrokeVar(catalog) {
  if (!catalog) return 'var(--color-text-secondary)'
  if (catalog.hasWaterInlet)  return 'var(--color-plumbing-cold)'
  if (catalog.hasDrainOutlet) return 'var(--color-plumbing-drain)'
  return 'var(--color-text-secondary)'
}

// Stroke colour per route kind. Anything unrecognised falls back to neutral.
function routeStrokeVar(kind) {
  switch (kind) {
    case 'CPVC_SUPPLY':  return 'var(--color-plumbing-cold)'
    case 'CPVC_HOT':     return 'var(--color-plumbing-hot)'
    case 'UPVC_DRAIN':   return 'var(--color-plumbing-drain)'
    case 'UPVC_RAIN':    return 'var(--color-plumbing-rain)'
    default:             return 'var(--color-text-secondary)'
  }
}

// Layer visibility flag per route kind.
function routeLayerKey(kind) {
  switch (kind) {
    case 'CPVC_SUPPLY': return 'plumbingSupplyRoutes'
    case 'CPVC_HOT':    return 'plumbingHotWaterRoutes'
    case 'UPVC_DRAIN':  return 'plumbingDrainageRoutes'
    case 'UPVC_RAIN':   return 'plumbingRainwaterRoutes'
    default:            return null
  }
}

export default function PlumbingOverlay() {
  const plumbingFixtures = useStore(s => s.plumbingFixtures)
  const risers           = useStore(s => s.risers)
  const layerVisibility  = useStore(s => s.layerVisibility)
  const currentFloorId   = useStore(s => s.currentFloorId)
  const projectSettings  = useStore(s => s.projectSettings)
  const selectedFixtureId = useStore(s => s.selectedPlumbingFixtureId)
  const selectPlumbingFixture = useStore(s => s.selectPlumbingFixture)
  const activeTool       = useStore(s => s.activeTool)
  // Subscribe to keep overlay reactive when engines populate routes.
  const getPlumbingRoutes = useStore(s => s.getPlumbingRoutes)

  const showFixtures = layerVisibility.plumbingFixtures !== false
  const showRisers   = layerVisibility.risers !== false

  const floorsList = projectSettings?.floors ?? []
  const multiFloor = floorsList.length > 1
  const ghostStyle  = { opacity: 0.15, pointerEvents: 'none' }
  const activeStyle = { opacity: 1 }
  const entityStyle = (entity) =>
    !multiFloor || (entity?.floorId ?? 'F1') === currentFloorId ? activeStyle : ghostStyle

  // Routes pipeline still wiring; engines subagent replaces the empty stub.
  const routes = (typeof getPlumbingRoutes === 'function' ? getPlumbingRoutes() : null) ?? []

  return (
    <g className="plumbing-overlay">
      {/* Routes (rendered first so fixtures sit on top) */}
      {routes.map((route) => {
        const layerKey = routeLayerKey(route.kind)
        if (layerKey && layerVisibility[layerKey] === false) return null
        const pts = (route.points ?? [])
          .map(p => `${sx(p.x)},${sy(p.y)}`)
          .join(' ')
        if (!pts) return null
        const stroke = routeStrokeVar(route.kind)
        const onActiveFloor = !multiFloor || (route.floorId ?? 'F1') === currentFloorId
        return (
          <polyline
            key={route.id ?? `route-${pts.length}-${route.kind}`}
            points={pts}
            fill="none"
            stroke={stroke}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={onActiveFloor ? 0.9 : 0.15}
            style={{ pointerEvents: 'none' }}
          />
        )
      })}

      {/* Fixtures */}
      {showFixtures && Object.values(plumbingFixtures).map((fixture) => {
        const catalog = getFixtureType(fixture.type)
        const stroke  = fixtureStrokeVar(catalog)
        const isSel   = fixture.id === selectedFixtureId
        const fStyle  = entityStyle(fixture)
        const cx = sx(fixture.x)
        const cy = sy(fixture.y)
        const half = 8 // 16px square
        const labelText = catalog?.label ?? fixture.type

        const interactive = activeTool === 'select' || activeTool === 'plumbing'

        return (
          <g
            key={fixture.id}
            style={{
              opacity: fStyle.opacity,
              pointerEvents: fStyle.pointerEvents ?? 'auto',
              cursor: interactive ? 'pointer' : 'default',
            }}
            onClick={(e) => {
              if (!interactive) return
              e.stopPropagation()
              selectPlumbingFixture(fixture.id)
            }}
          >
            <rect
              x={cx - half}
              y={cy - half}
              width={half * 2}
              height={half * 2}
              fill="var(--color-surface)"
              stroke={isSel ? 'var(--color-primary)' : stroke}
              strokeWidth={isSel ? 2 : 1.5}
            />
            <text
              x={cx}
              y={cy + half + 11}
              textAnchor="middle"
              fontSize={10}
              fontWeight={500}
              fill="var(--color-text-secondary)"
              stroke="var(--color-bg)"
              strokeWidth={3}
              paintOrder="stroke"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {labelText}
            </text>
            {isSel && (
              <rect
                key={`pulse-fixture-${fixture.id}`}
                className="canvas-selection-pulse"
                x={cx - half - 4}
                y={cy - half - 4}
                width={half * 2 + 8}
                height={half * 2 + 8}
                fill="none"
                stroke="var(--color-primary)"
                strokeWidth={4}
              />
            )}
          </g>
        )
      })}

      {/* Risers — small dashed glyph at (x,y). 12×24 dashed rectangle for
       * the vertical shaft icon. fromFloorId/toFloorId are stored on the
       * riser; we show ghost styling when neither matches currentFloor. */}
      {showRisers && Object.values(risers).map((riser) => {
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
              stroke="var(--color-riser-shaft)"
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
              {riser.kind ?? 'RISER'}
            </text>
          </g>
        )
      })}
    </g>
  )
}

// Re-export the foot-pixel constant so future companion components (route
// inspector overlays, riser shaft visualization) share the same scale.
export { GRID_IN }
