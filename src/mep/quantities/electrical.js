// Electrical quantity aggregator.
//
// Sums route polyline lengths by (systemId, gaugeMm2), applies the
// routing-zone quantity multiplier, counts fittings (junction boxes)
// via the shared classifier, builds the DB schedule (one row per
// circuit), and adds riser contributions.
//
// Pure: state-in, numbers-out. Floor scope is handled by the caller —
// when the scoped state wrapper from boq/scope.js is passed in, the
// electricalPoints + risers + graph + routes are already floor-filtered.

import { buildElectricalSystemGraph } from '../electrical/network.js'
import { buildElectricalRoutes } from '../electrical/routing.js'
import { countFittings } from '../shared/fittingCounter.js'
import { getRiserLengthFt, RISER_KINDS } from '../shared/risers.js'
import { getZone } from '../shared/routingZones.js'
import { polylineLengthFt } from '../shared/geometry.js'
import { getWireGauge } from '../catalogs/wireGauges.js'

const SYSTEM_IDS = Object.freeze([
  'LIGHTING', 'POWER_5A', 'POWER_15A', 'AC', 'GEYSER', 'SUBMAIN', 'SOLAR_TIE', 'EV',
])

// Riser → primary system for length attribution.
const RISER_TO_SYSTEM = Object.freeze({
  [RISER_KINDS.ELECTRICAL_SUBMAIN]: 'SUBMAIN',
  [RISER_KINDS.SOLAR_DC_RISER]:     'SOLAR_TIE',
  [RISER_KINDS.SOLAR_AC_RISER]:     'SOLAR_TIE',
})

function _r2(n) { return Math.round(n * 100) / 100 }

function _emptyPerSystem() {
  const out = {}
  for (const sid of SYSTEM_IDS) {
    out[sid] = {
      byGauge: {},                    // gaugeMm2 (string) → wire length ft
      conduit: {},                    // conduitMm (string) → conduit length ft
      mcbs: {},                       // mcbAmps (string) → count
      pointCounts: {},                // pointType → count
      fittings: { elbows: 0, tees: 0, crosses: 0, reducers: 0, valves: 0, traps: 0 },
      junctionBoxes: 0,
    }
  }
  return out
}

export function computeElectricalQuantities(state, opts = {}) {
  void opts
  const perSystem = _emptyPerSystem()
  const totals = { wireLengthFt: 0, conduitLengthFt: 0, pointCount: 0, mcbCount: 0, junctionBoxes: 0 }
  const risersOut = []
  const dbSchedule = []
  const pointCounts = {}

  if (!state) return { perSystem, pointCounts, dbSchedule, risers: risersOut, totals }

  const graph  = buildElectricalSystemGraph(state)
  const { routes } = buildElectricalRoutes(graph, state)

  // ── Per-system: lengths by gauge + conduit by conduit-diameter ────────
  const routesBySystem = new Map()
  for (const r of routes) {
    if (!r || !r.polyline) continue
    if (!routesBySystem.has(r.systemId)) routesBySystem.set(r.systemId, [])
    routesBySystem.get(r.systemId).push(r)
  }

  for (const sysId of SYSTEM_IDS) {
    const arr = routesBySystem.get(sysId) ?? []
    const accGauge = perSystem[sysId].byGauge
    const accConduit = perSystem[sysId].conduit
    for (const r of arr) {
      const gauge = r.gaugeMm2 ?? 0
      if (gauge === 0) continue
      const lenFt = r.adjustedLengthFt ?? polylineLengthFt(r.polyline) * (getZone(r.zone)?.quantityMultiplier ?? 1)
      const gKey = String(gauge)
      accGauge[gKey] = (accGauge[gKey] ?? 0) + lenFt
      const gaugeCat = getWireGauge(gauge)
      const conduitMm = r.diameterMm ?? gaugeCat?.conduitMm ?? null
      if (conduitMm) {
        const cKey = String(conduitMm)
        accConduit[cKey] = (accConduit[cKey] ?? 0) + lenFt
      }
    }
    for (const k of Object.keys(accGauge))   accGauge[k]   = _r2(accGauge[k])
    for (const k of Object.keys(accConduit)) accConduit[k] = _r2(accConduit[k])

    // Fittings — junction boxes / elbows along the wiring path.
    if (arr.length > 0) {
      const f = countFittings(arr)
      perSystem[sysId].fittings = {
        elbows:   f.elbows,
        tees:     f.tees,
        crosses:  f.crosses,
        reducers: f.reducers.length,
        valves:   f.valves,
        traps:    f.traps,
      }
      // Junction boxes ≈ tees + crosses (one box at every multi-way joint).
      perSystem[sysId].junctionBoxes = f.tees + f.crosses
    }
  }

  // ── DB schedule — one row per branch / circuit ────────────────────────
  for (const branch of graph.branches ?? []) {
    if (!branch.circuitId && branch.systemId !== 'SUBMAIN') continue
    const sysId = branch.systemId
    const mcbAmps = branch.mcbAmps ?? null
    dbSchedule.push({
      circuitId: branch.circuitId ?? branch.id,
      label: `${branch.circuitClass} (${branch.gaugeMm2} sqmm)`,
      type: branch.circuitClass,
      systemId: sysId,
      floorId: branch.floorId ?? null,
      points: branch.leafEntityIds?.length ?? 0,
      loadW: Math.round(branch.loadW ?? 0),
      gaugeMm2: branch.gaugeMm2 ?? null,
      mcb: mcbAmps,
    })
    if (mcbAmps != null) {
      const key = String(mcbAmps)
      perSystem[sysId].mcbs[key] = (perSystem[sysId].mcbs[key] ?? 0) + 1
    }
  }
  dbSchedule.sort((a, b) => a.circuitId < b.circuitId ? -1 : a.circuitId > b.circuitId ? 1 : 0)

  // ── Risers ────────────────────────────────────────────────────────────
  for (const r of Object.values(state.risers ?? {})) {
    if (!r) continue
    const sysForKind = RISER_TO_SYSTEM[r.kind]
    if (!sysForKind) continue
    const lenFt = getRiserLengthFt(state, r.id)
    risersOut.push({
      id: r.id, kind: r.kind, lengthFt: _r2(lenFt),
    })
    perSystem[sysForKind].riserLengthFt = _r2((perSystem[sysForKind].riserLengthFt ?? 0) + lenFt)
  }
  risersOut.sort((a, b) => a.id < b.id ? -1 : 1)

  // ── Point counts (overall + per-system) ───────────────────────────────
  for (const pt of Object.values(state.electricalPoints ?? {})) {
    if (!pt) continue
    pointCounts[pt.type] = (pointCounts[pt.type] ?? 0) + 1
    totals.pointCount++
  }
  for (const sysId of SYSTEM_IDS) {
    const bucket = {}
    for (const node of Object.values(graph.nodes)) {
      if (node.systemId !== sysId) continue
      if (node.kind !== 'POINT') continue
      const pt = state.electricalPoints?.[node.entityId]
      if (!pt) continue
      bucket[pt.type] = (bucket[pt.type] ?? 0) + 1
    }
    perSystem[sysId].pointCounts = bucket
  }

  // ── Totals ────────────────────────────────────────────────────────────
  let wireLengthFt = 0, conduitLengthFt = 0, mcbCount = 0, junctionBoxes = 0
  for (const sysId of SYSTEM_IDS) {
    for (const v of Object.values(perSystem[sysId].byGauge))   wireLengthFt    += v
    for (const v of Object.values(perSystem[sysId].conduit))   conduitLengthFt += v
    for (const v of Object.values(perSystem[sysId].mcbs))      mcbCount        += v
    wireLengthFt    += perSystem[sysId].riserLengthFt ?? 0
    junctionBoxes   += perSystem[sysId].junctionBoxes ?? 0
  }
  totals.wireLengthFt    = _r2(wireLengthFt)
  totals.conduitLengthFt = _r2(conduitLengthFt)
  totals.mcbCount        = mcbCount
  totals.junctionBoxes   = junctionBoxes

  return {
    perSystem,
    pointCounts,
    dbSchedule,
    risers: risersOut,
    totals,
  }
}
