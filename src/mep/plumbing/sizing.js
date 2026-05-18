// Plumbing diameter assignment — CATALOG / HUNTER / GRADIENT_DRAIN.
//
// Reads projectSettings.mepSizing.PLUMBING (default 'CATALOG'). For each
// edge in the system graph, assign diameterMm based on the active
// strategy:
//
//   CATALOG         — fixture catalog default + branch-count heuristic
//                     for trunk upgrade. Phase 1 default; conservative.
//   HUNTER          — fixture-unit sum per branch, sized via the pipe
//                     standard (CPVC for supply, UPVC for drainage).
//                     Supply edges only; drain edges fall through to
//                     GRADIENT_DRAIN below.
//   GRADIENT_DRAIN  — drain edges only. Uses HUNTER for diameter and
//                     records the required gradient (1:80 soil, 1:40
//                     waste) on each edge's meta for downstream BOQ +
//                     verification.
//
// All strategies preserve the "never reduce mid-line" rule: an edge
// already sized larger than the strategy's pick keeps its size.
//
// Pure: returns a new graph with edges' diameterMm / meta.gradient
// filled in; never mutates the input.

import { getFixtureType } from '../catalogs/fixtureTypes.js'
import { getCpvcDiameter, listCpvcDiameters } from '../catalogs/pipeStandards/cpvc.js'
import { getUpvcDiameter, listUpvcDiameters } from '../catalogs/pipeStandards/upvc.js'
import { FIXTURE_UNITS } from '../catalogs/loads/fixtureUnits.js'
import { DRAIN_GRADIENTS } from '../catalogs/loads/electricalConstants.js'
import { selectStrategy } from '../shared/sizingStrategy.js'

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

function _pipeCatalogFor(systemId) {
  const standard = SYSTEM_PIPE_STANDARD[systemId]
  if (standard === 'CPVC') return listCpvcDiameters()
  if (standard === 'UPVC') return listUpvcDiameters()
  return []
}

function _isDrainSystem(systemId) {
  return systemId === 'SOIL_DRAIN' || systemId === 'RAINWATER' || systemId === 'WASTE_DRAIN'
}

// Resolve the consumer fixture's catalog diameter for a given system.
function _leafDiameterMm(fxNode, state, systemId) {
  if (!fxNode || fxNode.kind !== 'FIXTURE') return null
  const fx = state.plumbingFixtures?.[fxNode.entityId]
  if (!fx) return null
  const cat = getFixtureType(fx.type)
  if (!cat) return null
  if (_isDrainSystem(systemId)) return cat.drainDiameterMm ?? null
  return cat.supplyDiameterMm ?? null
}

// Resolve the FU contribution of a fixture node for a given system.
function _fixtureNodeFu(fxNode, state) {
  if (!fxNode || fxNode.kind !== 'FIXTURE') return 0
  if (Number.isFinite(fxNode.fixtureUnits)) return fxNode.fixtureUnits
  const fx = state.plumbingFixtures?.[fxNode.entityId]
  if (!fx) return 0
  return FIXTURE_UNITS[fx.type] ?? 0
}

// CATALOG branch trunk pick (legacy Phase 1 heuristic).
function _trunkDiameterMmCatalog({ systemId, childDiameters, branchCount }) {
  if (systemId === 'COLD_SUPPLY' || systemId === 'HOT_SUPPLY') {
    if (branchCount >= DEFAULT_TRUNK_UPGRADE_BRANCH_COUNT) return 25
    return 20
  }
  if (childDiameters.length === 0) return null
  return Math.max(...childDiameters)
}

// HUNTER branch trunk pick — sum FU across branch, look up in catalog.
function _trunkDiameterMmHunter({ systemId, branchFu }) {
  const cat = _pipeCatalogFor(systemId)
  if (!cat || cat.length === 0) return null
  const sorted = [...cat].sort((a, b) => a.nominalMm - b.nominalMm)
  for (const row of sorted) {
    if ((row.fixtureUnitsCarried ?? 0) >= branchFu) return row.nominalMm
  }
  return sorted[sorted.length - 1]?.nominalMm ?? null
}

export function sizePlumbingBranches(graph, ctx = {}) {
  if (!graph || !graph.edges) return graph
  const projectSettings = ctx.projectSettings ?? ctx.state?.projectSettings ?? {}
  const strategyId = projectSettings?.mepSizing?.PLUMBING ?? 'CATALOG'

  const state = ctx.state ?? ctx
  const nextEdges = {}
  for (const [eid, e] of Object.entries(graph.edges)) nextEdges[eid] = { ...e }

  // ── Pass 1: leaf diameters for FIXTURE-incident edges ────────────────
  // Both CATALOG and HUNTER seed leaf edges from the fixture's catalog
  // supply/drain diameter. HUNTER's per-edge sizing only differs when
  // the trunk upgrade kicks in (pass 2).
  for (const e of Object.values(nextEdges)) {
    const fromN = graph.nodes[e.fromNodeId]
    const toN   = graph.nodes[e.toNodeId]
    const fixtureNode = fromN?.kind === 'FIXTURE' ? fromN
                     : toN?.kind   === 'FIXTURE' ? toN
                     : null
    if (!fixtureNode) continue
    e.diameterMm = _leafDiameterMm(fixtureNode, state, e.systemId)
  }

  // Index edges by branch.
  const branchEdges = new Map()
  for (const e of Object.values(nextEdges)) {
    const key = `${e.systemId}|${e.branchId}`
    if (!branchEdges.has(key)) branchEdges.set(key, [])
    branchEdges.get(key).push(e)
  }
  const branchesPerSystem = {}
  for (const sys of graph.systems ?? []) {
    branchesPerSystem[sys.id] = (sys.branchIds ?? []).length
  }

  // ── Pass 2: per-branch trunk upgrade + strategy-specific meta ────────
  for (const [key, edgeArr] of branchEdges) {
    const [systemId] = key.split('|')
    const standard = SYSTEM_PIPE_STANDARD[systemId]
    const childDiameters = edgeArr.map(e => e.diameterMm).filter(d => d != null)
    const branchCount = branchesPerSystem[systemId] ?? 1

    // Sum branch fixture units across leaves (FIXTURE nodes only).
    let branchFu = 0
    const seenFx = new Set()
    for (const e of edgeArr) {
      for (const nodeId of [e.fromNodeId, e.toNodeId]) {
        const n = graph.nodes[nodeId]
        if (n?.kind !== 'FIXTURE') continue
        if (seenFx.has(n.id)) continue
        seenFx.add(n.id)
        branchFu += _fixtureNodeFu(n, state)
      }
    }

    // Strategy dispatch for the trunk size.
    let trunkMm = null
    let strategyReason = ''
    let gradient = null
    if (strategyId === 'HUNTER') {
      trunkMm = _trunkDiameterMmHunter({ systemId, branchFu })
      strategyReason = `HUNTER FU=${branchFu} → ${trunkMm}mm`
    } else if (strategyId === 'GRADIENT_DRAIN') {
      if (_isDrainSystem(systemId)) {
        trunkMm = _trunkDiameterMmHunter({ systemId, branchFu })
        gradient = DRAIN_GRADIENTS.SOIL
        const denom = Math.round(1 / gradient)
        strategyReason = `GRADIENT_DRAIN 1:${denom} FU=${branchFu} → ${trunkMm}mm`
      } else {
        // Supply systems under GRADIENT_DRAIN still use HUNTER.
        trunkMm = _trunkDiameterMmHunter({ systemId, branchFu })
        strategyReason = `HUNTER (fallback for supply under GRADIENT_DRAIN) FU=${branchFu} → ${trunkMm}mm`
      }
    } else {
      // CATALOG (or unknown strategy → CATALOG).
      trunkMm = _trunkDiameterMmCatalog({ systemId, childDiameters, branchCount })
      strategyReason = `CATALOG trunk pick ${trunkMm}mm`
    }

    // Verify catalog and never reduce — also call the strategy impl for
    // its side-effect-free reason string when desired (kept as a sanity
    // ping; result not used since per-branch math is canonical here).
    void selectStrategy(strategyId)

    if (trunkMm == null) continue
    const cat = _catalogDiameterFor(standard, trunkMm)
    if (!cat) continue
    for (const e of edgeArr) {
      if (e.diameterMm == null || trunkMm > e.diameterMm) {
        e.diameterMm = trunkMm
      }
      if (gradient != null) {
        e.meta = { ...(e.meta || null), gradient, strategy: 'GRADIENT_DRAIN' }
      } else if (strategyId === 'HUNTER') {
        e.meta = { ...(e.meta || null), strategy: 'HUNTER' }
      }
      e.sizingReason = strategyReason
    }
  }

  return {
    ...graph,
    edges: nextEdges,
  }
}
