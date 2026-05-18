// Fire pipe + cable sizing — Phase 1 CATALOG strategy.
//
// Phase 1: every edge already carries diameterMm / nominalMm / cableTypeId
// from network.js (GI 32 mm sprinkler branch; fire-rated 2-core detection
// cable from the cable catalog). This module exists for parity with the
// other discipline sizings — Phase 2 LOAD_BASED will recompute sprinkler
// pipe size from head count + Hazen-Williams hydraulic calc.
//
// Pure: returns a sized clone of the graph; never mutates input.

import { SIZING_STRATEGIES, selectStrategy } from '../shared/sizingStrategy.js'

export function sizeFireBranches(graph, ctx = {}) {
  if (!graph || !graph.edges) return graph
  const projectSettings = ctx.projectSettings ?? ctx.state?.projectSettings ?? {}
  const strategyId = projectSettings?.mepSizing?.FIRE ?? 'CATALOG'
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
