// Electrical wire-gauge assignment — CATALOG / LOAD_BASED.
//
// Reads projectSettings.mepSizing.ELECTRICAL (default 'CATALOG').
//
//   CATALOG     — IS-732 grouping rules in circuitGrouping.js choose the
//                 gauge per circuit at network build time; this module
//                 returns a defensive graph clone.
//   LOAD_BASED  — Recompute gauge per branch from total load + diversity
//                 factor + voltage drop. Walks the wire-gauge catalog
//                 ascending; picks the smallest gauge passing both the
//                 ampacity check (I <= maxLoadW / 230) and the voltage
//                 drop limit (VD% <= 3% per IS 732). Never reduces below
//                 the CATALOG-chosen gauge (mid-circuit step-downs are
//                 not modelled in Phase 1).
//
// Pure: returns a sized clone of the graph; never mutates input.

import { listWireGauges, getWireGauge } from '../catalogs/wireGauges.js'
import { getPointLoadW } from '../catalogs/loads/pointLoads.js'
import { getDiversityFactor } from '../catalogs/loads/diversityFactors.js'
import {
  NOMINAL_VOLTAGE_V,
  MAX_VOLTAGE_DROP_PERCENT,
  RESISTANCE_OHM_PER_M_BY_SQMM,
  POWER_FACTOR,
} from '../catalogs/loads/electricalConstants.js'

// Map IS-732 circuitClass → diversity-factor key.
const CIRCUIT_CLASS_TO_DIVERSITY = Object.freeze({
  LIGHTING:    'LIGHTING',
  FAN:         'FAN',
  SOCKETS_5A:  'SOCKETS_5A',
  SOCKETS_15A: 'SOCKETS_15A',
  AC:          'AC',
  GEYSER:      'GEYSER',
  EV:          'EV',
  SUBMAIN:     'SUBMAIN',
  SOLAR:       'SOLAR',
  METER:       'METER',
})

// Branch length estimate (meters). Phase 1 graph edges carry lengthIn = 0
// until the routing pass populates them; we approximate via the max
// straight-line distance from DB to any leaf POINT. This is the
// canonical "branch length" used in voltage-drop classroom problems.
function _approxBranchLengthM(graph, edges) {
  if (!edges || edges.length === 0) return 0
  const FT_PER_INCH = 1 / 12
  const M_PER_FT = 0.3048
  let maxLenIn = 0
  for (const e of edges) {
    // Prefer route-populated length if any.
    if (Number.isFinite(e.lengthIn) && e.lengthIn > 0) {
      if (e.lengthIn > maxLenIn) maxLenIn = e.lengthIn
      continue
    }
    const a = graph.nodes[e.fromNodeId]
    const b = graph.nodes[e.toNodeId]
    if (!a || !b) continue
    const dx = (a.x ?? 0) - (b.x ?? 0)
    const dy = (a.y ?? 0) - (b.y ?? 0)
    const len = Math.hypot(dx, dy)
    if (len > maxLenIn) maxLenIn = len
  }
  return maxLenIn * FT_PER_INCH * M_PER_FT
}

// Compute a LOAD_BASED gauge for one branch. Returns the chosen sqmm.
function _loadBasedGaugeForBranch(branch, branchEdgeArr, graph) {
  const diversityKey = CIRCUIT_CLASS_TO_DIVERSITY[branch?.circuitClass] ?? null
  const diversity = diversityKey != null ? getDiversityFactor(diversityKey) : 1.0

  // Total raw load: prefer branch.loadW (filled by circuit grouping), else
  // sum point catalog defaults across all POINT leaves in the branch.
  let rawW = Number.isFinite(branch?.loadW) ? branch.loadW : 0
  if (!Number.isFinite(branch?.loadW) || branch.loadW === 0) {
    const seen = new Set()
    for (const e of branchEdgeArr) {
      for (const nid of [e.fromNodeId, e.toNodeId]) {
        const n = graph.nodes[nid]
        if (n?.kind !== 'POINT' || seen.has(nid)) continue
        seen.add(nid)
        rawW += getPointLoadW(n.pointType) ?? 0
      }
    }
  }
  const designW = rawW * diversity
  const voltage = NOMINAL_VOLTAGE_V
  const current = designW / (voltage * POWER_FACTOR)
  const lengthM = _approxBranchLengthM(graph, branchEdgeArr)

  const gauges = [...listWireGauges()].sort((a, b) => a.sqmm - b.sqmm)
  for (const g of gauges) {
    const ampacity = (g.maxLoadW ?? 0) / voltage
    if (current > ampacity) continue
    const rPerM = RESISTANCE_OHM_PER_M_BY_SQMM[g.sqmm]
    if (rPerM == null) continue
    const vDrop = current * rPerM * lengthM * 2
    const vdPct = (vDrop / voltage) * 100
    if (vdPct <= MAX_VOLTAGE_DROP_PERCENT) {
      return {
        sqmm: g.sqmm,
        reason: `LOAD_BASED W=${Math.round(designW)} VD=${vdPct.toFixed(2)}% → ${g.sqmm}sqmm`,
      }
    }
  }
  const last = gauges[gauges.length - 1]
  return {
    sqmm: last?.sqmm ?? null,
    reason: `LOAD_BASED W=${Math.round(designW)} exceeds catalog → ${last?.sqmm}sqmm (max)`,
  }
}

export function sizeElectricalBranches(graph, ctx = {}) {
  if (!graph || !graph.edges) return graph
  const projectSettings = ctx.projectSettings ?? ctx.state?.projectSettings ?? {}
  const strategyId = projectSettings?.mepSizing?.ELECTRICAL ?? 'CATALOG'

  const nextEdges = {}
  for (const [eid, e] of Object.entries(graph.edges)) nextEdges[eid] = { ...e }

  if (strategyId !== 'LOAD_BASED') {
    // CATALOG (default): edges already carry gaugeMm2 from network.js.
    return { ...graph, edges: nextEdges }
  }

  // LOAD_BASED — group edges by branch, size each branch, write back.
  const branchEdges = new Map()
  for (const e of Object.values(nextEdges)) {
    if (!branchEdges.has(e.branchId)) branchEdges.set(e.branchId, [])
    branchEdges.get(e.branchId).push(e)
  }
  const branchesById = new Map()
  for (const b of graph.branches ?? []) branchesById.set(b.id, b)

  for (const [branchId, edgeArr] of branchEdges) {
    const branch = branchesById.get(branchId)
    if (!branch) continue
    const { sqmm, reason } = _loadBasedGaugeForBranch(branch, edgeArr, graph)
    if (sqmm == null) continue
    const catalogGauge = getWireGauge(sqmm)
    if (!catalogGauge) continue
    // Never reduce: keep the larger of (current edge gauge, computed).
    for (const e of edgeArr) {
      const existing = Number.isFinite(e.gaugeMm2) ? e.gaugeMm2 : 0
      e.gaugeMm2 = Math.max(existing, sqmm)
      e.sizingReason = reason
      e.meta = { ...(e.meta || null), strategy: 'LOAD_BASED' }
    }
  }

  return { ...graph, edges: nextEdges }
}
