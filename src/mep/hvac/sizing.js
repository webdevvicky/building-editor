// HVAC refrigerant + condensate sizing — Phase 1 CATALOG strategy.
//
// Phase 1 sizing: each refrigerant / condensate edge already carries
// diameterMm + pipeOdIn assigned at network build time from the catalog
// (paired indoor / outdoor unit catalog entries → copper od → mm). This
// module exists for parity with plumbing/electrical sizing — when the
// LOAD_BASED strategy (Phase 2) lands, it will recompute pipe size from
// total refrigerant load + equivalent-length tables here.
//
// Pure: returns a sized clone of the graph; never mutates input.

import { SIZING_STRATEGIES, selectStrategy } from '../shared/sizingStrategy.js'

export function sizeHvacBranches(graph, ctx = {}) {
  if (!graph || !graph.edges) return graph
  const projectSettings = ctx.projectSettings ?? ctx.state?.projectSettings ?? {}
  const strategyId = projectSettings?.mepSizing?.HVAC ?? 'CATALOG'
  const strategyImpl = selectStrategy(strategyId)
  void strategyImpl
  if (strategyId !== 'CATALOG' && SIZING_STRATEGIES[strategyId]?.shipPhase !== 'PHASE_0') {
    // Strategy lands in a later phase — fall through to CATALOG.
  }

  // Phase 1 CATALOG path: edges already carry diameterMm + pipeOdIn from
  // network.js. Defensive clone so callers expecting a fresh graph reference
  // (parity with plumbing/electrical sizing) get one.
  const nextEdges = {}
  for (const [eid, e] of Object.entries(graph.edges)) nextEdges[eid] = { ...e }
  return { ...graph, edges: nextEdges }
}
