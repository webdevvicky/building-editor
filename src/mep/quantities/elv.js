// ELV quantity aggregator.
//
// Sums ELV-route polyline lengths by (systemId, cableType), applies the
// routing-zone quantity multiplier, counts fittings (junction boxes /
// elbows / tees) via the shared classifier, counts devices per type,
// and adds riser contributions (ELV_TRUNKING risers split equally across
// the four ELV sub-systems for length attribution).
//
// Pure: state-in, numbers-out. Floor scope is handled by the caller —
// when the scoped state wrapper from boq/scope.js is passed in, the
// elvDevices + risers + graph + routes are already floor-filtered.

import { buildElvSystemGraph } from '../elv/network.js'
import { buildElvRoutes } from '../elv/routing.js'
import { countFittings } from '../shared/fittingCounter.js'
import { getRiserLengthFt, RISER_KINDS } from '../shared/risers.js'
import { getZone } from '../shared/routingZones.js'
import { polylineLengthFt } from '../shared/geometry.js'
import { getElvDevice } from '../catalogs/elvDevices.js'

const SYSTEM_IDS = Object.freeze(['CCTV', 'DATA', 'SECURITY', 'AV'])

// Per-sub-system device-type membership for fittings/counts breakdown.
const SYSTEM_DEVICE_TYPES = Object.freeze({
  CCTV:     Object.freeze(['CCTV_CAMERA', 'VIDEO_DOOR_PHONE', 'ELV_RACK']),
  DATA:     Object.freeze(['DATA_POINT', 'ELV_RACK']),
  SECURITY: Object.freeze(['ALARM_SENSOR', 'VIDEO_DOOR_PHONE', 'INTERCOM']),
  AV:       Object.freeze(['TV_POINT_ELV', 'WIFI_AP', 'ELV_RACK']),
})

function _r2(n) { return Math.round(n * 100) / 100 }

function _emptyPerSystem() {
  const out = {}
  for (const sid of SYSTEM_IDS) {
    out[sid] = {
      byCableType: {},                  // cableTypeId → length ft
      fittings: { elbows: 0, tees: 0, crosses: 0, reducers: 0, valves: 0, traps: 0 },
      deviceCounts: {},                 // deviceType → count (devices in this sub-system)
      riserLengthFt: 0,
    }
  }
  return out
}

export function computeElvQuantities(state, opts = {}) {
  void opts
  const perSystem = _emptyPerSystem()
  const totals = { cableLengthFt: 0, deviceCount: 0 }
  const risersOut = []
  const deviceCounts = {}

  if (!state) {
    return { perSystem, deviceCounts, risers: risersOut, totals }
  }

  const graph  = buildElvSystemGraph(state)
  const { routes } = buildElvRoutes(graph, state)

  // ── Group routes by system ───────────────────────────────────────────
  const routesBySystem = new Map()
  for (const r of routes) {
    if (!r || !r.polyline) continue
    if (!routesBySystem.has(r.systemId)) routesBySystem.set(r.systemId, [])
    routesBySystem.get(r.systemId).push(r)
  }

  // ── Per-system: cable lengths by cable type + fittings ───────────────
  for (const sysId of SYSTEM_IDS) {
    const arr = routesBySystem.get(sysId) ?? []
    const acc = perSystem[sysId].byCableType
    for (const r of arr) {
      const cableKey = r.cableTypeId ?? r.cableType ?? ''
      if (!cableKey) continue
      const lenFt = r.adjustedLengthFt ?? polylineLengthFt(r.polyline) * (getZone(r.zone)?.quantityMultiplier ?? 1)
      acc[cableKey] = (acc[cableKey] ?? 0) + lenFt
    }
    for (const k of Object.keys(acc)) acc[k] = _r2(acc[k])

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

  // ── Device counts (overall + per-sub-system membership) ──────────────
  for (const d of Object.values(state.elvDevices ?? {})) {
    if (!d) continue
    deviceCounts[d.type] = (deviceCounts[d.type] ?? 0) + 1
    totals.deviceCount++
    const cat = getElvDevice(d.type)
    if (!cat) continue
    if (cat.discipline !== 'ELV') continue
    for (const sysId of SYSTEM_IDS) {
      if (SYSTEM_DEVICE_TYPES[sysId].includes(d.type)) {
        perSystem[sysId].deviceCounts[d.type] = (perSystem[sysId].deviceCounts[d.type] ?? 0) + 1
      }
    }
  }

  // ── Risers — ELV_TRUNKING serves all sub-systems; split length equally ─
  const elvRiserSystems = SYSTEM_IDS
  for (const r of Object.values(state.risers ?? {})) {
    if (!r) continue
    if (r.kind !== RISER_KINDS.ELV_TRUNKING) continue
    const lenFt = getRiserLengthFt(state, r.id)
    risersOut.push({ id: r.id, kind: r.kind, lengthFt: _r2(lenFt) })
    const share = lenFt / elvRiserSystems.length
    for (const sysId of elvRiserSystems) {
      perSystem[sysId].riserLengthFt = _r2((perSystem[sysId].riserLengthFt ?? 0) + share)
    }
  }
  risersOut.sort((a, b) => a.id < b.id ? -1 : 1)

  // ── Totals ───────────────────────────────────────────────────────────
  let cableFt = 0
  for (const sysId of SYSTEM_IDS) {
    for (const v of Object.values(perSystem[sysId].byCableType)) cableFt += v
    cableFt += perSystem[sysId].riserLengthFt ?? 0
  }
  totals.cableLengthFt = _r2(cableFt)

  return {
    perSystem,
    deviceCounts,
    risers: risersOut,
    totals,
  }
}
