// Plumbing diameter assignment — Phase 1 CATALOG strategy.
//
// Reads projectSettings.mepSizing.PLUMBING (default 'CATALOG'). For each
// edge in the system graph, assign diameterMm based on:
//   - the dominant fixture's catalog default (for leaf branch edges),
//   - the max of children for trunk/parent edges (when a system has
//     multiple branches feeding into a single root).
//
// HUNTER + GRADIENT_DRAIN strategies land in Phase 2.6 — they're stubbed
// in src/mep/shared/sizingStrategy.js. For Phase 1 we run CATALOG only.
//
// Pure: returns a new graph with edges' diameterMm filled in; never
// mutates the input.

import { getFixtureType } from '../catalogs/fixtureTypes.js'
import { getCpvcDiameter } from '../catalogs/pipeStandards/cpvc.js'
import { getUpvcDiameter } from '../catalogs/pipeStandards/upvc.js'
import { SIZING_STRATEGIES, selectStrategy } from '../shared/sizingStrategy.js'

const DEFAULT_TRUNK_UPGRADE_BRANCH_COUNT = 3

// Per-system pipe-standard registry. Drives trunk sizing + catalog lookups.
const SYSTEM_PIPE_STANDARD = Object.freeze({
  COLD_SUPPLY: 'CPVC',
  HOT_SUPPLY:  'CPVC',
  SOIL_DRAIN:  'UPVC',
  RAINWATER:   'UPVC',
})

function _catalogDiameterFor(standard, mm) {
  if (standard === 'CPVC') return getCpvcDiameter(mm)
  if (standard === 'UPVC') return getUpvcDiameter(mm)
  return null
}

// Resolve the consumer fixture's catalog diameter for a given system.
function _leafDiameterMm(fxNode, state, systemId) {
  if (!fxNode || fxNode.kind !== 'FIXTURE') return null
  const fx = state.plumbingFixtures?.[fxNode.entityId]
  if (!fx) return null
  const cat = getFixtureType(fx.type)
  if (!cat) return null
  if (systemId === 'SOIL_DRAIN' || systemId === 'RAINWATER') return cat.drainDiameterMm ?? null
  // COLD_SUPPLY / HOT_SUPPLY
  return cat.supplyDiameterMm ?? null
}

// Pick the next-up catalog size for a trunk based on branch count or
// max child diameter. Phase 1 heuristic: COLD_SUPPLY trunk = 25mm CPVC
// when branch count >= 3 (else 20mm). SOIL_DRAIN trunk = max child.
function _trunkDiameterMm({ systemId, childDiameters, branchCount }) {
  if (systemId === 'COLD_SUPPLY' || systemId === 'HOT_SUPPLY') {
    if (branchCount >= DEFAULT_TRUNK_UPGRADE_BRANCH_COUNT) return 25
    return 20
  }
  // Drainage trunks: max child diameter (most permissive — never reduce mid-line).
  if (childDiameters.length === 0) return null
  return Math.max(...childDiameters)
}

export function sizePlumbingBranches(graph, ctx = {}) {
  if (!graph || !graph.edges) return graph
  const projectSettings = ctx.projectSettings ?? ctx.state?.projectSettings ?? {}
  const strategyId = projectSettings?.mepSizing?.PLUMBING ?? 'CATALOG'
  const strategyImpl = selectStrategy(strategyId)
  // Phase 1: CATALOG only.
  void strategyImpl
  if (strategyId !== 'CATALOG' && SIZING_STRATEGIES[strategyId]?.shipPhase !== 'PHASE_0') {
    // Strategy lands in a later phase — fall through to CATALOG.
  }

  const state = ctx.state ?? ctx
  const nextEdges = {}
  for (const [eid, e] of Object.entries(graph.edges)) nextEdges[eid] = { ...e }

  // Pass 1: leaf diameters for FIXTURE-incident edges.
  for (const e of Object.values(nextEdges)) {
    const fromN = graph.nodes[e.fromNodeId]
    const toN   = graph.nodes[e.toNodeId]
    const fixtureNode = fromN?.kind === 'FIXTURE' ? fromN
                     : toN?.kind === 'FIXTURE'   ? toN
                     : null
    if (!fixtureNode) continue
    const mm = _leafDiameterMm(fixtureNode, state, e.systemId)
    e.diameterMm = mm
  }

  // Pass 2: trunk upgrade per branch.
  // Group edges by (systemId, branchId); the edge whose endpoints are
  // both non-FIXTURE OR which is the branch's "root edge" (touches a
  // root node) is treated as a trunk. Phase 1 doesn't emit a separate
  // trunk edge — the root-to-leaf edges already are the branch edges.
  // So we instead upgrade the SINGLE edge with the most downstream
  // fixtures per branch — which under the Phase-1 star topology is
  // every edge (they all touch the root). Workaround: set the branch's
  // edges to the trunk diameter whenever branchCount >= threshold.
  const branchEdges = new Map()  // (systemId|branchId) → [edge]
  for (const e of Object.values(nextEdges)) {
    const key = `${e.systemId}|${e.branchId}`
    if (!branchEdges.has(key)) branchEdges.set(key, [])
    branchEdges.get(key).push(e)
  }
  // Count branches per system for the trunk-upgrade heuristic.
  const branchesPerSystem = {}
  for (const sys of graph.systems ?? []) {
    branchesPerSystem[sys.id] = (sys.branchIds ?? []).length
  }
  for (const [key, edgeArr] of branchEdges) {
    const [systemId] = key.split('|')
    const childDiameters = edgeArr.map(e => e.diameterMm).filter(d => d != null)
    const branchCount = branchesPerSystem[systemId] ?? 1
    const trunkMm = _trunkDiameterMm({ systemId, childDiameters, branchCount })
    if (trunkMm == null) continue
    // Keep leaf size when it's larger than the computed trunk; never reduce.
    for (const e of edgeArr) {
      if (e.diameterMm == null || trunkMm > e.diameterMm) {
        // Validate against catalog — find the next-up standard size.
        const standard = SYSTEM_PIPE_STANDARD[systemId]
        const cat = _catalogDiameterFor(standard, trunkMm)
        if (cat) e.diameterMm = trunkMm
      }
    }
  }

  return {
    ...graph,
    edges: nextEdges,
  }
}
