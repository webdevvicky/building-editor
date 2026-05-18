// Plumbing quantity aggregator.
//
// Sums route polyline lengths by (systemId, diameterMm), applies the
// routing-zone quantity multiplier, counts fittings via the shared
// classifier, and adds riser contributions.
//
// Pure: state-in, numbers-out. Floor scope is handled by the caller —
// when the scoped state wrapper from boq/scope.js is passed in, the
// plumbingFixtures + risers + graph + routes are already floor-filtered.

import { buildPlumbingSystemGraph } from '../plumbing/network.js'
import { buildPlumbingRoutes } from '../plumbing/routing.js'
import { countFittings } from '../shared/fittingCounter.js'
import { getRiserLengthFt, RISER_KINDS } from '../shared/risers.js'
import { getZone } from '../shared/routingZones.js'
import { polylineLengthFt } from '../shared/geometry.js'

const SYSTEM_IDS = Object.freeze(['COLD_SUPPLY', 'HOT_SUPPLY', 'SOIL_DRAIN', 'RAINWATER'])

const SYSTEM_TO_PIPE_STANDARD = Object.freeze({
  COLD_SUPPLY: 'CPVC',
  HOT_SUPPLY:  'CPVC',
  SOIL_DRAIN:  'UPVC',
  RAINWATER:   'UPVC',
})

const SYSTEM_TO_RISER_KIND = Object.freeze({
  COLD_SUPPLY: RISER_KINDS.PLUMBING_SUPPLY,
  HOT_SUPPLY:  RISER_KINDS.HOT_WATER_RISER,
  SOIL_DRAIN:  RISER_KINDS.SOIL_STACK,
  RAINWATER:   RISER_KINDS.RAINWATER_DOWN,
})

function _emptyPerSystem() {
  const out = {}
  for (const sid of SYSTEM_IDS) {
    out[sid] = { byDiameter: {}, fittings: { elbows: 0, tees: 0, crosses: 0, reducers: 0, valves: 0, traps: 0 }, fixtureCounts: {} }
  }
  return out
}

function _r2(n) { return Math.round(n * 100) / 100 }

export function computePlumbingQuantities(state, opts = {}) {
  void opts
  const perSystem = _emptyPerSystem()
  const totals = { cpvcLengthFt: 0, upvcLengthFt: 0, fittingCount: 0, fixtureCount: 0 }
  const risersOut = []

  if (!state) return { perSystem, risers: risersOut, fixtureCounts: {}, totals }

  // Build the system graph + routes once.
  const graph  = buildPlumbingSystemGraph(state)
  const { routes } = buildPlumbingRoutes(graph, state)

  // ── Per-system: sum lengths by diameter (with zone multiplier) ────────
  // Group routes by systemId first so fittings are counted within-system
  // only (a tee never crosses systems).
  const routesBySystem = new Map()
  for (const r of routes) {
    if (!r || !r.polyline) continue
    if (!routesBySystem.has(r.systemId)) routesBySystem.set(r.systemId, [])
    routesBySystem.get(r.systemId).push(r)
  }

  for (const sysId of SYSTEM_IDS) {
    const arr = routesBySystem.get(sysId) ?? []
    const acc = perSystem[sysId].byDiameter
    for (const r of arr) {
      const dm = r.diameterMm ?? 0
      if (dm === 0) continue
      const lenFt = r.adjustedLengthFt ?? polylineLengthFt(r.polyline) * (getZone(r.zone)?.quantityMultiplier ?? 1)
      const key = String(dm)
      acc[key] = (acc[key] ?? 0) + lenFt
    }
    // Round
    for (const k of Object.keys(acc)) acc[k] = _r2(acc[k])

    // Fittings per system (only count direction changes among same-system routes).
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
    }
  }

  // ── Risers ────────────────────────────────────────────────────────────
  for (const r of Object.values(state.risers ?? {})) {
    if (!r) continue
    // Only plumbing-flavoured risers count toward plumbing quantities.
    const sysForKind = Object.entries(SYSTEM_TO_RISER_KIND).find(([, k]) => k === r.kind)?.[0]
    if (!sysForKind) continue
    const lenFt = getRiserLengthFt(state, r.id)
    const diameterMm = r.diameterMm ?? null
    risersOut.push({
      id: r.id, kind: r.kind, lengthFt: _r2(lenFt), diameterMm,
    })
    perSystem[sysForKind].riserLengthFt = _r2((perSystem[sysForKind].riserLengthFt ?? 0) + lenFt)
  }
  risersOut.sort((a, b) => a.id < b.id ? -1 : 1)

  // ── Fixture counts ────────────────────────────────────────────────────
  const fixtureCounts = {}
  for (const fx of Object.values(state.plumbingFixtures ?? {})) {
    if (!fx) continue
    fixtureCounts[fx.type] = (fixtureCounts[fx.type] ?? 0) + 1
    totals.fixtureCount++
  }
  // Per-system breakdown: classify by system the fixture participates in.
  for (const sysId of SYSTEM_IDS) {
    const bucket = {}
    for (const node of Object.values(graph.nodes)) {
      if (node.systemId !== sysId) continue
      if (node.kind !== 'FIXTURE') continue
      const fx = state.plumbingFixtures?.[node.entityId]
      if (!fx) continue
      bucket[fx.type] = (bucket[fx.type] ?? 0) + 1
    }
    perSystem[sysId].fixtureCounts = bucket
  }

  // ── Totals ────────────────────────────────────────────────────────────
  let cpvcLengthFt = 0, upvcLengthFt = 0, fittingCount = 0
  for (const sysId of SYSTEM_IDS) {
    const standard = SYSTEM_TO_PIPE_STANDARD[sysId]
    const sysLenFt = Object.values(perSystem[sysId].byDiameter).reduce((s, v) => s + v, 0) + (perSystem[sysId].riserLengthFt ?? 0)
    if (standard === 'CPVC') cpvcLengthFt += sysLenFt
    else if (standard === 'UPVC') upvcLengthFt += sysLenFt
    const f = perSystem[sysId].fittings
    fittingCount += (f.elbows + f.tees + f.crosses + f.reducers + f.valves + f.traps)
  }
  totals.cpvcLengthFt = _r2(cpvcLengthFt)
  totals.upvcLengthFt = _r2(upvcLengthFt)
  totals.fittingCount = fittingCount

  return {
    perSystem,
    risers: risersOut,
    fixtureCounts,
    totals,
  }
}
