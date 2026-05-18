// HVAC quantity aggregator.
//
// Sums route polyline lengths by (systemId, diameter), applies the
// routing-zone quantity multiplier, counts fittings via the shared
// classifier, counts units (split-AC pairs + ventilation), and adds
// riser contributions.
//
// Pure: state-in, numbers-out. Floor scope is handled by the caller —
// when the scoped state wrapper from boq/scope.js is passed in, the
// hvacUnits + risers + graph + routes are already floor-filtered.

import { buildHvacSystemGraph } from '../hvac/network.js'
import { buildHvacRoutes } from '../hvac/routing.js'
import { countFittings } from '../shared/fittingCounter.js'
import { getRiserLengthFt, RISER_KINDS } from '../shared/risers.js'
import { getZone } from '../shared/routingZones.js'
import { polylineLengthFt } from '../shared/geometry.js'
import { getHvacUnit } from '../catalogs/hvacUnits.js'

const SYSTEM_IDS = Object.freeze(['SPLIT_AC', 'REFRIGERANT', 'CONDENSATE', 'VENTILATION'])

// Riser → primary system for length attribution.
const RISER_TO_SYSTEM = Object.freeze({
  [RISER_KINDS.HVAC_REFRIGERANT]: 'REFRIGERANT',
  [RISER_KINDS.HVAC_CONDENSATE]:  'CONDENSATE',
})

function _r2(n) { return Math.round(n * 100) / 100 }

function _emptyPerSystem() {
  const out = {}
  out.SPLIT_AC = {
    unitCounts: {},                 // indoor / outdoor / paired
    pairCount: 0,
  }
  out.REFRIGERANT = {
    byPipeOd: {},                   // pipeOdIn nominal string (e.g., '3/8') → length ft
    byOdIn: {},                     // alias of byPipeOd — preserved for task-spec callers
    byDiameter: {},                 // diameterMm string → length ft (mirror)
    fittings: { elbows: 0, tees: 0, crosses: 0, reducers: 0, valves: 0, traps: 0 },
    riserLengthFt: 0,
  }
  out.CONDENSATE = {
    byDiameter: {},                 // diameterMm string → length ft
    fittings: { elbows: 0, tees: 0, crosses: 0, reducers: 0, valves: 0, traps: 0 },
    riserLengthFt: 0,
  }
  out.VENTILATION = {
    unitCounts: {},
  }
  return out
}

export function computeHvacQuantities(state, opts = {}) {
  void opts
  const perSystem = _emptyPerSystem()
  const totals = { copperLengthFt: 0, condensateLengthFt: 0, unitCount: 0 }
  const risersOut = []
  const unitCounts = {}

  if (!state) {
    return { perSystem, unitCounts, risers: risersOut, totals }
  }

  const graph  = buildHvacSystemGraph(state)
  const { routes } = buildHvacRoutes(graph, state)

  // ── Group routes by system ───────────────────────────────────────────
  const routesBySystem = new Map()
  for (const r of routes) {
    if (!r || !r.polyline) continue
    if (!routesBySystem.has(r.systemId)) routesBySystem.set(r.systemId, [])
    routesBySystem.get(r.systemId).push(r)
  }

  // ── REFRIGERANT lengths by od + fittings ─────────────────────────────
  {
    const arr = routesBySystem.get('REFRIGERANT') ?? []
    const accOd  = perSystem.REFRIGERANT.byPipeOd
    const accDia = perSystem.REFRIGERANT.byDiameter
    for (const r of arr) {
      const lenFt = r.adjustedLengthFt ?? polylineLengthFt(r.polyline) * (getZone(r.zone)?.quantityMultiplier ?? 1)
      const odKey = r.pipeOdIn ?? ''
      if (odKey) accOd[odKey] = (accOd[odKey] ?? 0) + lenFt
      const dm = r.diameterMm
      if (dm != null && dm !== 0) {
        const dKey = String(dm)
        accDia[dKey] = (accDia[dKey] ?? 0) + lenFt
      }
    }
    for (const k of Object.keys(accOd))  accOd[k]  = _r2(accOd[k])
    for (const k of Object.keys(accDia)) accDia[k] = _r2(accDia[k])
    // Mirror byPipeOd → byOdIn (spec alias, same reference would defeat the
    // round-trip clone semantics; copy values so callers can mutate one
    // without aliasing the other).
    perSystem.REFRIGERANT.byOdIn = { ...accOd }

    if (arr.length > 0) {
      const f = countFittings(arr)
      perSystem.REFRIGERANT.fittings = {
        elbows:   f.elbows,
        tees:     f.tees,
        crosses:  f.crosses,
        reducers: f.reducers.length,
        valves:   f.valves,
        traps:    f.traps,
      }
    }
  }

  // ── CONDENSATE lengths by diameter + fittings ────────────────────────
  {
    const arr = routesBySystem.get('CONDENSATE') ?? []
    const acc = perSystem.CONDENSATE.byDiameter
    for (const r of arr) {
      const dm = r.diameterMm ?? 0
      if (dm === 0) continue
      const lenFt = r.adjustedLengthFt ?? polylineLengthFt(r.polyline) * (getZone(r.zone)?.quantityMultiplier ?? 1)
      const key = String(dm)
      acc[key] = (acc[key] ?? 0) + lenFt
    }
    for (const k of Object.keys(acc)) acc[k] = _r2(acc[k])

    if (arr.length > 0) {
      const f = countFittings(arr)
      perSystem.CONDENSATE.fittings = {
        elbows:   f.elbows,
        tees:     f.tees,
        crosses:  f.crosses,
        reducers: f.reducers.length,
        valves:   f.valves,
        traps:    f.traps,
      }
    }
  }

  // ── Unit counts (overall + per-system) ───────────────────────────────
  let pairCount = 0
  const splitAcCounts = {}
  const ventCounts    = {}

  for (const u of Object.values(state.hvacUnits ?? {})) {
    if (!u) continue
    unitCounts[u.type] = (unitCounts[u.type] ?? 0) + 1
    totals.unitCount++
    const cat = getHvacUnit(u.type)
    if (!cat) continue
    if (cat.discipline !== 'HVAC') continue
    if (u.type === 'AC_INDOOR_UNIT'  || u.type === 'AC_OUTDOOR_UNIT'  ||
        u.type === 'DUCTED_AC_INDOOR' || u.type === 'DUCTED_AC_OUTDOOR') {
      splitAcCounts[u.type] = (splitAcCounts[u.type] ?? 0) + 1
    } else if (u.type === 'EXHAUST_FAN_HVAC' || u.type === 'FRESH_AIR_INLET') {
      ventCounts[u.type] = (ventCounts[u.type] ?? 0) + 1
    }
  }
  perSystem.SPLIT_AC.unitCounts    = splitAcCounts
  perSystem.VENTILATION.unitCounts = ventCounts

  // Pair count = number of SPLIT_AC branches (network builder already
  // emits one branch per indoor↔outdoor pair).
  for (const b of (graph.branches ?? [])) {
    if (b.systemId === 'SPLIT_AC') pairCount++
  }
  perSystem.SPLIT_AC.pairCount = pairCount

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
  let copperFt = 0, condFt = 0
  for (const v of Object.values(perSystem.REFRIGERANT.byPipeOd))    copperFt += v
  for (const v of Object.values(perSystem.CONDENSATE.byDiameter))   condFt   += v
  copperFt += perSystem.REFRIGERANT.riserLengthFt ?? 0
  condFt   += perSystem.CONDENSATE.riserLengthFt  ?? 0
  totals.copperLengthFt     = _r2(copperFt)
  totals.condensateLengthFt = _r2(condFt)

  // SYSTEM_IDS is referenced for stable iteration ordering; expose it to
  // callers that want to walk the per-system map in declared order.
  void SYSTEM_IDS

  return {
    perSystem,
    unitCounts,
    risers: risersOut,
    totals,
  }
}
