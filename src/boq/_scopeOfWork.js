// Scope-of-work auto-stats (Gap 9 / Addition 1) — feeds the rewritten
// Excel summary sheet + PDF cover. Pure state read; no mutation.

import { OPENING_SUBTYPE } from '../constants/joinery.js'

function r2(n) { return Math.round(n * 100) / 100 }

export function computeScopeOfWork(state) {
  if (!state) {
    return {
      floorCount: 0,
      totalBuiltUpAreaSft: 0,
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

  // Total built-up area across every valid room (project-level).
  // getTotalFloorArea is scope-aware — at project scope it returns the
  // sum across all floors.
  const totalBuiltUpAreaSft = r2(state.getTotalFloorArea?.() ?? 0)

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
    totalBuiltUpAreaSft,
    plotAreaSft,
    roomCountByType,
    openingCounts,
    wallCount: Object.values(walls).filter(w => !w.isVirtual && !w.isPlot).length,
    columnCount: Object.keys(columns).length,
  }
}
