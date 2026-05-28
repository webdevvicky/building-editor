// Scope-of-work auto-stats (Gap 9 / Addition 1) — feeds the rewritten
// Excel summary sheet + PDF cover. Pure state read; no mutation.

import { OPENING_SUBTYPE } from '../constants/joinery.js'
import { safeR2 as r2 } from '../lib/numbers.js'

export function computeScopeOfWork(state) {
  if (!state) {
    return {
      floorCount: 0,
      totalCarpetAreaSft: 0,
      totalBuiltUpAreaSft: 0,
      builtUpComplete: true,
      plotAreaSft: 0,
      roomCountByType: {},
      openingCounts: { doors: 0, windows: 0, ventilators: 0 },
      wallCount: 0,
      columnCount: 0,
    }
  }

  const ps = state.projectSettings ?? {}
  const floors = Array.isArray(ps.floors) ? ps.floors : []
  const rooms  = state.rooms  ?? {}
  const walls  = state.walls  ?? {}
  const columns = state.columns ?? {}

  // Carpet area — strict inside-face floor area summed over every valid
  // room. Uses the clear_internal inset kernel regardless of dimensionMode.
  const totalCarpetAreaSft = r2(state.getTotalCarpetAreaSft?.() ?? 0)

  // Built-up (plinth) area — outer-face footprint via the external-wall
  // boundary loop offset outward by per-edge halfThickness. Includes
  // enclosed-but-not-roomed spaces by construction (the loop is the
  // building outline, not the union of rooms). `complete` falls to false
  // when an external boundary chain fails to close.
  const builtUpInfo = state.getBuiltUpAreaInfo?.() ?? { areaSft: 0, complete: true }
  const totalBuiltUpAreaSft = r2(builtUpInfo.areaSft ?? 0)
  const builtUpComplete = builtUpInfo.complete !== false

  // Plot area from getPlotPolygon, if helper exists.
  let plotAreaSft = 0
  try {
    const poly = state.getPlotPolygon?.()
    if (poly?.length) {
      let area = 0
      for (let i = 0, n = poly.length; i < n; i++) {
        const [x1, y1] = poly[i]
        const [x2, y2] = poly[(i + 1) % n]
        area += (x1 * y2 - x2 * y1) / 2
      }
      plotAreaSft = r2(Math.abs(area) / 144) // inches² → ft²
    }
  } catch { /* helper not present */ }

  const roomCountByType = {}
  for (const room of Object.values(rooms)) {
    const t = room?.type ?? 'OTHER'
    roomCountByType[t] = (roomCountByType[t] ?? 0) + 1
  }

  // Opening counts by parent type via subtype field on each opening.
  const openingCounts = { doors: 0, windows: 0, ventilators: 0 }
  for (const wall of Object.values(walls)) {
    for (const op of (wall.openings ?? [])) {
      if (op.subtype === OPENING_SUBTYPE.VENTILATOR) openingCounts.ventilators += 1
      else if (op.type === 'window') openingCounts.windows += 1
      else if (op.type === 'door')   openingCounts.doors   += 1
    }
  }

  return {
    floorCount: Math.max(1, floors.length),
    totalCarpetAreaSft,
    totalBuiltUpAreaSft,
    builtUpComplete,
    plotAreaSft,
    roomCountByType,
    openingCounts,
    wallCount: Object.values(walls).filter(w => !w.isVirtual && !w.isPlot).length,
    columnCount: Object.keys(columns).length,
  }
}
