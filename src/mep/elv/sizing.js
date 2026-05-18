// ELV cable sizing — Phase 1 CATALOG strategy.
//
// Phase 1: every edge already carries cableTypeId / gaugeMm2 from
// network.js, taken from the ELV device catalog (CCTV → CCTV_COAX_RG6,
// DATA → CAT6, SECURITY → FIRE_RATED_2C, AV → CAT6 / CCTV_COAX_RG6).
// This module exists for parity with the other discipline sizings —
// Phase 2 LOAD_BASED will recompute cable selection from PoE budget +
// distance-vs-attenuation rules.
//
// Pure: returns a sized clone of the graph; never mutates input.

import { SIZING_STRATEGIES, selectStrategy } from '../shared/sizingStrategy.js'

export function sizeElvBranches(graph, ctx = {}) {
  if (!graph || !graph.edges) return graph
  const projectSettings = ctx.projectSettings ?? ctx.state?.projectSettings ?? {}
  const strategyId = projectSettings?.mepSizing?.ELV ?? 'CATALOG'
  const strategyImpl = selectStrategy(strategyId)
  void strategyImpl
  if (strategyId !== 'CATALOG' && SIZING_STRATEGIES[strategyId]?.shipPhase !== 'PHASE_0') {
    // Strategy lands in a later phase — fall through to CATALOG.
  }

  // CATALOG path: clone edges defensively so callers expecting a fresh
  // graph reference (parity with other discipline sizings) get one.
  const nextEdges = {}
  for (const [eid, e] of Object.entries(graph.edges)) nextEdges[eid] = { ...e }
  return { ...graph, edges: nextEdges }
}
