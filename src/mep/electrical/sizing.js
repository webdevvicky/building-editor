// Electrical wire-gauge assignment — Phase 1 CATALOG strategy.
//
// Each circuit's gauge is determined by IS-732 grouping rules
// (see circuitGrouping.js) and propagated to every edge in that branch
// at network build time. This module is the Phase-1 stub for the
// LOAD_BASED strategy: when projectSettings.mepSizing.ELECTRICAL is set
// to 'LOAD_BASED' (Phase 2), it will recompute gauge from total branch
// load + diversity factor + voltage drop.
//
// Pure: returns a sized clone of the graph; never mutates input.

import { SIZING_STRATEGIES, selectStrategy } from '../shared/sizingStrategy.js'

export function sizeElectricalBranches(graph, ctx = {}) {
  if (!graph || !graph.edges) return graph
  const projectSettings = ctx.projectSettings ?? ctx.state?.projectSettings ?? {}
  const strategyId = projectSettings?.mepSizing?.ELECTRICAL ?? 'CATALOG'
  const strategyImpl = selectStrategy(strategyId)
  void strategyImpl
  if (strategyId !== 'CATALOG' && SIZING_STRATEGIES[strategyId]?.shipPhase !== 'PHASE_0') {
    // Strategy lands in a later phase — fall through to CATALOG.
  }

  // Phase 1 CATALOG path: edges already carry gaugeMm2 from network.js
  // (assigned per circuit). Just return a defensive clone for callers
  // that expect a new graph reference (matches the plumbing pattern).
  const nextEdges = {}
  for (const [eid, e] of Object.entries(graph.edges)) nextEdges[eid] = { ...e }
  return { ...graph, edges: nextEdges }
}
