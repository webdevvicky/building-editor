// Fire quantity aggregator.
//
// Sums fire-route polyline lengths by (systemId, diameter|cable), applies
// the routing-zone quantity multiplier, counts fittings via the shared
// classifier, counts devices per type, and adds riser contributions
// (FIRE_MAIN).
//
// Pure: state-in, numbers-out. Floor scope is handled by the caller — when
// the scoped state wrapper from boq/scope.js is passed in, fireDevices +
// risers + graph + routes are already floor-filtered.

import { buildFireSystemGraph } from '../fire/network.js'
import { buildFireRoutes } from '../fire/routing.js'
import { countFittings } from '../shared/fittingCounter.js'
import { getRiserLengthFt, RISER_KINDS } from '../shared/risers.js'
import { getZone } from '../shared/routingZones.js'
import { polylineLengthFt } from '../shared/geometry.js'
import { getFireDevice } from '../catalogs/fireDevices.js'

const SYSTEM_IDS = Object.freeze(['DETECTION', 'SPRINKLER', 'EQUIPMENT'])

// Riser → primary system for length attribution.
const RISER_TO_SYSTEM = Object.freeze({
  [RISER_KINDS.FIRE_MAIN]: 'SPRINKLER',
})

function _r2(n) { return Math.round(n * 100) / 100 }

function _emptyPerSystem() {
  return {
    DETECTION: {
      byCableType: {},                  // cableTypeId → length ft
      fittings: { elbows: 0, tees: 0, crosses: 0, reducers: 0, valves: 0, traps: 0 },
      riserLengthFt: 0,
    },
    SPRINKLER: {
      byDiameter: {},                   // nominalMm string → pipe length ft
      fittings: { elbows: 0, tees: 0, crosses: 0, reducers: 0, valves: 0, traps: 0 },
      riserLengthFt: 0,
    },
    EQUIPMENT: {
      deviceCounts: {},                 // deviceType → count
    },
  }
}

export function computeFireQuantities(state, opts = {}) {
  void opts
  const perSystem = _emptyPerSystem()
  const totals = { cableLengthFt: 0, pipeLengthFt: 0, deviceCount: 0 }
  const risersOut = []
  const deviceCounts = {}

  if (!state) {
    return { perSystem, deviceCounts, risers: risersOut, totals }
  }

  const graph  = buildFireSystemGraph(state)
  const { routes } = buildFireRoutes(graph, state)

  // ── Group routes by system ───────────────────────────────────────────
  const routesBySystem = new Map()
  for (const r of routes) {
    if (!r || !r.polyline) continue
    if (!routesBySystem.has(r.systemId)) routesBySystem.set(r.systemId, [])
    routesBySystem.get(r.systemId).push(r)
  }

  // ── DETECTION lengths by cable type + fittings ───────────────────────
  {
    const arr = routesBySystem.get('DETECTION') ?? []
    const acc = perSystem.DETECTION.byCableType
    for (const r of arr) {
      const cableKey = r.cableTypeId ?? ''
      if (!cableKey) continue
      const lenFt = r.adjustedLengthFt ?? polylineLengthFt(r.polyline) * (getZone(r.zone)?.quantityMultiplier ?? 1)
      acc[cableKey] = (acc[cableKey] ?? 0) + lenFt
    }
    for (const k of Object.keys(acc)) acc[k] = _r2(acc[k])

    if (arr.length > 0) {
      const f = countFittings(arr)
      perSystem.DETECTION.fittings = {
        elbows:   f.elbows,
        tees:     f.tees,
        crosses:  f.crosses,
        reducers: f.reducers.length,
        valves:   f.valves,
        traps:    f.traps,
      }
    }
  }

  // ── SPRINKLER lengths by nominal diameter + fittings ─────────────────
  {
    const arr = routesBySystem.get('SPRINKLER') ?? []
    const acc = perSystem.SPRINKLER.byDiameter
    for (const r of arr) {
      const nominal = r.nominalMm ?? r.diameterMm ?? 0
      if (!nominal) continue
      const lenFt = r.adjustedLengthFt ?? polylineLengthFt(r.polyline) * (getZone(r.zone)?.quantityMultiplier ?? 1)
      const key = String(nominal)
      acc[key] = (acc[key] ?? 0) + lenFt
    }
    for (const k of Object.keys(acc)) acc[k] = _r2(acc[k])

    if (arr.length > 0) {
      const f = countFittings(arr)
      perSystem.SPRINKLER.fittings = {
        elbows:   f.elbows,
        tees:     f.tees,
        crosses:  f.crosses,
        reducers: f.reducers.length,
        valves:   f.valves,
        traps:    f.traps,
      }
    }
  }

  // ── Device counts (overall + EQUIPMENT system) ───────────────────────
  const equipmentCounts = {}
  for (const d of Object.values(state.fireDevices ?? {})) {
    if (!d) continue
    deviceCounts[d.type] = (deviceCounts[d.type] ?? 0) + 1
    totals.deviceCount++
    const cat = getFireDevice(d.type)
    if (!cat) continue
    if (cat.discipline !== 'FIRE') continue
    if (d.type === 'FIRE_HOSE_REEL' || d.type === 'FIRE_EXTINGUISHER') {
      equipmentCounts[d.type] = (equipmentCounts[d.type] ?? 0) + 1
    }
  }
  perSystem.EQUIPMENT.deviceCounts = equipmentCounts

  // ── Risers ───────────────────────────────────────────────────────────
  for (const r of Object.values(state.risers ?? {})) {
    if (!r) continue
    const sysForKind = RISER_TO_SYSTEM[r.kind]
    if (!sysForKind) continue
    const lenFt = getRiserLengthFt(state, r.id)
    risersOut.push({ id: r.id, kind: r.kind, lengthFt: _r2(lenFt) })
    perSystem[sysForKind].riserLengthFt = _r2((perSystem[sysForKind].riserLengthFt ?? 0) + lenFt)
  }
  risersOut.sort((a, b) => a.id < b.id ? -1 : 1)

  // ── Totals ───────────────────────────────────────────────────────────
  let cableFt = 0, pipeFt = 0
  for (const v of Object.values(perSystem.DETECTION.byCableType)) cableFt += v
  for (const v of Object.values(perSystem.SPRINKLER.byDiameter))  pipeFt  += v
  cableFt += perSystem.DETECTION.riserLengthFt ?? 0
  pipeFt  += perSystem.SPRINKLER.riserLengthFt ?? 0
  totals.cableLengthFt = _r2(cableFt)
  totals.pipeLengthFt  = _r2(pipeFt)

  // Expose SYSTEM_IDS reference for stable iteration ordering by callers.
  void SYSTEM_IDS

  return {
    perSystem,
    deviceCounts,
    risers: risersOut,
    totals,
  }
}
