// ClashOverlay — renders cross-discipline route intersection markers
// (Phase 2.5). Each clash event is a small diamond with a severity-colored
// fill and a stroke ring.
//
// We pull clashes directly from `detectClashes(allRoutes)` so the overlay
// is reactive to the same route changes the discipline overlays already
// subscribe to. This avoids depending on `runValidation()` running, and
// keeps the overlay self-sufficient when the BOQ footer is collapsed.
//
// Layer gate: state.layerVisibility.clashes (default true).

import { useStore } from '../../store'
import { PX_PER_INCH } from '../../geometry'
import { detectClashes } from '../../mep/shared/clashDetection.js'
import { buildPlumbingSystemGraph } from '../../mep/plumbing/network.js'
import { buildPlumbingRoutes }      from '../../mep/plumbing/routing.js'
import { buildElectricalSystemGraph } from '../../mep/electrical/network.js'
import { buildElectricalRoutes }      from '../../mep/electrical/routing.js'
import { buildHvacSystemGraph } from '../../mep/hvac/network.js'
import { buildHvacRoutes }      from '../../mep/hvac/routing.js'
import { buildFireSystemGraph } from '../../mep/fire/network.js'
import { buildFireRoutes }      from '../../mep/fire/routing.js'
import { buildElvSystemGraph } from '../../mep/elv/network.js'
import { buildElvRoutes }      from '../../mep/elv/routing.js'

const sx = x =>  x * PX_PER_INCH
const sy = y => -y * PX_PER_INCH

// Mirror tokens.css semantic colors (fill/stroke pair per severity).
const SEVERITY_STYLE = Object.freeze({
  error:   { fill: 'var(--color-error-bg)',   stroke: 'var(--color-error)' },
  warning: { fill: 'var(--color-warning-bg)', stroke: 'var(--color-warning)' },
  info:    { fill: 'var(--color-primary-bg)', stroke: 'var(--color-primary)' },
})

function _safeRoutes(builderGraph, builderRoutes, state) {
  try {
    const g = builderGraph(state)
    const r = builderRoutes(g, state)
    if (Array.isArray(r)) return r
    if (Array.isArray(r?.routes)) return r.routes
    return []
  } catch {
    return []
  }
}

export default function ClashOverlay() {
  // Subscribe to all the discipline entity maps that drive routes — this
  // is what makes the overlay reactive. We don't need the maps themselves,
  // just the reference identity hand-off through Zustand.
  useStore(s => s.plumbingFixtures)
  useStore(s => s.electricalPoints)
  useStore(s => s.hvacUnits)
  useStore(s => s.fireDevices)
  useStore(s => s.elvDevices)
  useStore(s => s.risers)
  useStore(s => s.walls)
  useStore(s => s.nodes)
  useStore(s => s.rooms)

  const layerVisibility = useStore(s => s.layerVisibility)
  const currentFloorId  = useStore(s => s.currentFloorId)
  const projectSettings = useStore(s => s.projectSettings)

  const show = layerVisibility?.clashes !== false
  if (!show) return null

  const state = useStore.getState()
  const allRoutes = [
    ..._safeRoutes(buildPlumbingSystemGraph,   buildPlumbingRoutes,   state),
    ..._safeRoutes(buildElectricalSystemGraph, buildElectricalRoutes, state),
    ..._safeRoutes(buildHvacSystemGraph,       buildHvacRoutes,       state),
    ..._safeRoutes(buildFireSystemGraph,       buildFireRoutes,       state),
    ..._safeRoutes(buildElvSystemGraph,        buildElvRoutes,        state),
  ]
  const clashes = detectClashes(allRoutes)
  if (clashes.length === 0) return null

  const floorsList = projectSettings?.floors ?? []
  const multiFloor = floorsList.length > 1

  return (
    <g className="clash-overlay" style={{ pointerEvents: 'none' }}>
      {clashes.map((c) => {
        const cx = sx(c.point.x)
        const cy = sy(c.point.y)
        const onActiveFloor = !multiFloor || (c.floorId ?? 'F1') === currentFloorId
        const opacity = onActiveFloor ? 0.95 : 0.15
        const style = SEVERITY_STYLE[c.severity] ?? SEVERITY_STYLE.warning
        const size = 5  // half-diagonal of the diamond, in svg-group px
        return (
          <g key={c.id} opacity={opacity}>
            {/* Diamond marker — rotated square. */}
            <rect
              x={cx - size}
              y={cy - size}
              width={size * 2}
              height={size * 2}
              transform={`rotate(45 ${cx} ${cy})`}
              fill={style.fill}
              stroke={style.stroke}
              strokeWidth={1.5}
            />
            <text
              x={cx}
              y={cy + 3}
              textAnchor="middle"
              fontSize={9}
              fontWeight={700}
              fill={style.stroke}
              style={{ userSelect: 'none' }}
            >
              {'!'}
            </text>
          </g>
        )
      })}
    </g>
  )
}
