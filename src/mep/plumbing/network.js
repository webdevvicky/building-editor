// Plumbing system-graph builder.
//
// Produces a SystemGraph keyed by 4 systems: COLD_SUPPLY, HOT_SUPPLY,
// SOIL_DRAIN, RAINWATER. Each system carries branches; each branch carries
// nodes (FIXTURE / EQUIPMENT / JUNCTION / RISER_TOP / RISER_BOT) and edges.
//
// Deterministic — sort comparators are explicit at every iteration.
//
// Memoization: single-cell, refresh on (plumbingFixtures, risers) ref change.

import { getFixtureType } from '../catalogs/fixtureTypes.js'
import {
  branchIdFor,
  edgeIdFor,
  nodeIdFor,
  sortNodesDeterministically,
  sortEdgesDeterministically,
} from '../shared/systemGraph.js'
import { RISER_KINDS } from '../shared/risers.js'
import { pointInRoom } from '../shared/geometry.js'
import { findNearestSoilStack } from './drainage.js'
import { findGeyserForFixture } from './hotwater.js'

const DEFAULT_FLOOR_ID = 'F1'

const SYSTEM_DEFS = Object.freeze([
  Object.freeze({ id: 'COLD_SUPPLY', systemType: 'WATER_SUPPLY' }),
  Object.freeze({ id: 'HOT_SUPPLY',  systemType: 'HOT_WATER' }),
  Object.freeze({ id: 'SOIL_DRAIN',  systemType: 'SOIL' }),
  Object.freeze({ id: 'RAINWATER',   systemType: 'RAINWATER' }),
])

// Deterministic comparator: (roomId, type, id)
function _fixtureCmp(a, b) {
  const ra = a.roomId ?? '', rb = b.roomId ?? ''
  if (ra !== rb) return ra < rb ? -1 : 1
  if (a.type !== b.type) return a.type < b.type ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// Single-cell memo: rebuilds when plumbingFixtures or risers references change.
let _cache = null

export function buildPlumbingSystemGraph(state, opts = {}) {
  void opts
  if (!state) return _emptyGraph()
  const fixturesMap = state.plumbingFixtures ?? {}
  const risersMap   = state.risers ?? {}
  if (_cache && _cache.fixtures === fixturesMap && _cache.risers === risersMap) {
    return _cache.result
  }
  const result = _build(state, fixturesMap, risersMap)
  _cache = { fixtures: fixturesMap, risers: risersMap, result }
  return result
}

function _emptyGraph() {
  return {
    nodes: {},
    edges: {},
    systems: SYSTEM_DEFS.map(d => ({ id: d.id, discipline: 'PLUMBING', systemType: d.systemType, branchIds: [], riserIds: [] })),
    branches: [],
  }
}

function _resolveFixtureRoom(state, fx) {
  if (fx.roomId) return fx.roomId
  const fid = fx.floorId ?? DEFAULT_FLOOR_ID
  return pointInRoom(state, fx.x, fx.y, fid)
}

function _build(state, fixturesMap, risersMap) {
  const allFixtures = Object.values(fixturesMap).filter(Boolean).sort(_fixtureCmp)
  // Resolve roomId for every fixture (greenfield: stamp it on a shallow
  // clone so downstream code never has to second-guess). Original state
  // is not mutated.
  const fixtures = allFixtures.map(fx => fx.roomId ? fx : { ...fx, roomId: _resolveFixtureRoom(state, fx) })
  const allRisers   = Object.values(risersMap).filter(Boolean).sort((a, b) => a.id < b.id ? -1 : 1)

  const nodes = {}
  const edges = {}
  const branches = []
  const systemById = {}
  for (const def of SYSTEM_DEFS) {
    systemById[def.id] = {
      id: def.id, discipline: 'PLUMBING', systemType: def.systemType,
      branchIds: [], riserIds: [],
    }
  }

  // Attach risers to systems by kind so callers can iterate per-system risers.
  for (const r of allRisers) {
    if (r.kind === RISER_KINDS.PLUMBING_SUPPLY) systemById.COLD_SUPPLY.riserIds.push(r.id)
    else if (r.kind === RISER_KINDS.HOT_WATER_RISER) systemById.HOT_SUPPLY.riserIds.push(r.id)
    else if (r.kind === RISER_KINDS.SOIL_STACK) systemById.SOIL_DRAIN.riserIds.push(r.id)
    else if (r.kind === RISER_KINDS.RAINWATER_DOWN) systemById.RAINWATER.riserIds.push(r.id)
  }
  for (const sysId of Object.keys(systemById)) systemById[sysId].riserIds.sort()

  // ── COLD_SUPPLY ──────────────────────────────────────────────────────
  _buildSupplySystem({
    systemId: 'COLD_SUPPLY',
    edgeKind: 'BRANCH',
    fixtureFilter: fx => _hasColdSupply(fx),
    rootResolver: () => _resolveColdRoot(state, fixtures, allRisers),
    fixtures,
    state, nodes, edges, branches, systemById,
  })

  // ── HOT_SUPPLY ───────────────────────────────────────────────────────
  // Phase 1: local geyser per bathroom. Group consumers by their geyser.
  _buildHotSupplySystem({
    fixtures,
    state, nodes, edges, branches, systemById,
  })

  // ── SOIL_DRAIN ───────────────────────────────────────────────────────
  _buildDrainSystem({
    fixtures,
    allRisers,
    state, nodes, edges, branches, systemById,
  })

  // ── RAINWATER ────────────────────────────────────────────────────────
  // Phase 1: deferred unless explicit RAINWATER_DOWN risers exist (Phase 2.4).
  // No fixtures consume rainwater in the current catalog. System stays empty.

  // Deterministic emission order
  const nodesOut = {}
  for (const n of sortNodesDeterministically(Object.values(nodes))) nodesOut[n.id] = n
  const edgesOut = {}
  for (const e of sortEdgesDeterministically(Object.values(edges))) edgesOut[e.id] = e
  branches.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  for (const sysId of Object.keys(systemById)) systemById[sysId].branchIds.sort()

  return {
    nodes: nodesOut,
    edges: edgesOut,
    systems: SYSTEM_DEFS.map(d => systemById[d.id]),
    branches,
  }
}

// ── Catalog-aware fixture predicates ────────────────────────────────────────

function _hasColdSupply(fx) {
  const cat = getFixtureType(fx.type)
  if (!cat) return false
  // Instance override wins; fall back to catalog default.
  return fx.hasWaterInlet ?? cat.hasWaterInlet ?? false
}
function _hasHotSupply(fx) {
  const cat = getFixtureType(fx.type)
  if (!cat) return false
  return fx.hasHotWaterInlet ?? cat.hasHotWaterInlet ?? false
}
function _hasDrain(fx) {
  const cat = getFixtureType(fx.type)
  if (!cat) return false
  return fx.hasDrainOutlet ?? cat.hasDrainOutlet ?? false
}

// ── Root resolution ─────────────────────────────────────────────────────────

// Root for COLD_SUPPLY: OHT fixture if present; else top of first PLUMBING_SUPPLY riser.
function _resolveColdRoot(state, allFixtures, allRisers) {
  const oht = allFixtures.find(fx => fx.type === 'OHT')
  if (oht) return { kind: 'FIXTURE', entityId: oht.id, x: oht.x, y: oht.y, floorId: oht.floorId ?? DEFAULT_FLOOR_ID }
  const riser = allRisers.find(r => r.kind === RISER_KINDS.PLUMBING_SUPPLY)
  if (riser) return { kind: 'RISER_TOP', entityId: riser.id, x: riser.x ?? 0, y: riser.y ?? 0, floorId: riser.toFloorId ?? riser.fromFloorId ?? DEFAULT_FLOOR_ID }
  return null
}

// ── Supply system builder (COLD only — HOT has its own per-room logic) ──────

function _buildSupplySystem({ systemId, edgeKind, fixtureFilter, rootResolver, fixtures, state, nodes, edges, branches, systemById }) {
  void state
  const consumers = fixtures.filter(fixtureFilter)
  if (consumers.length === 0) return
  const root = rootResolver()
  if (!root) return

  const rootNodeId = nodeIdFor(root.entityId, root.kind, systemId)
  nodes[rootNodeId] = {
    id: rootNodeId,
    entityId: root.entityId,
    kind: root.kind === 'FIXTURE' ? 'FIXTURE' : 'RISER_TOP',
    discipline: 'PLUMBING',
    systemId,
    branchId: null,                // back-filled after branch id is minted
    x: root.x, y: root.y,
    floorId: root.floorId,
  }

  // Group consumers by floor; one branch per floor (Phase 1 simplification).
  const byFloor = new Map()
  for (const fx of consumers) {
    const fid = fx.floorId ?? DEFAULT_FLOOR_ID
    if (!byFloor.has(fid)) byFloor.set(fid, [])
    byFloor.get(fid).push(fx)
  }
  for (const fid of [...byFloor.keys()].sort()) {
    const group = byFloor.get(fid)
    const leafEntityIds = group.map(g => g.id).sort()
    const branchId = branchIdFor(systemId, leafEntityIds)
    const branchNodeIds = [rootNodeId]
    const branchEdgeIds = []
    for (const fx of group) {
      const fxNodeId = nodeIdFor(fx.id, 'FIXTURE', systemId)
      nodes[fxNodeId] = {
        id: fxNodeId,
        entityId: fx.id,
        kind: 'FIXTURE',
        discipline: 'PLUMBING',
        systemId,
        branchId,
        x: fx.x, y: fx.y,
        floorId: fx.floorId ?? DEFAULT_FLOOR_ID,
        fixtureUnits: getFixtureType(fx.type)?.fixtureUnits ?? 0,
      }
      const edgeId = edgeIdFor(rootNodeId, fxNodeId, systemId, edgeKind)
      edges[edgeId] = {
        id: edgeId,
        fromNodeId: rootNodeId,
        toNodeId: fxNodeId,
        systemId,
        branchId,
        kind: edgeKind,
        zone: 'WALL',
        lengthIn: 0,                // routing fills this in
        diameterMm: null,           // sizing fills this in
      }
      branchNodeIds.push(fxNodeId)
      branchEdgeIds.push(edgeId)
    }
    branches.push({
      id: branchId,
      systemId,
      nodeIds: branchNodeIds.sort(),
      edgeIds: branchEdgeIds.sort(),
      leafEntityIds,
    })
    systemById[systemId].branchIds.push(branchId)
    // Root's branchId is shared across floors — leave null (root belongs to all).
  }
}

// ── Hot supply builder — per-bathroom geyser ────────────────────────────────

function _buildHotSupplySystem({ fixtures, state, nodes, edges, branches, systemById }) {
  const consumers = fixtures.filter(_hasHotSupply).filter(fx => fx.type !== 'GEYSER')
  if (consumers.length === 0) return

  // Group consumers by geyser id; consumers without a geyser are skipped
  // (Phase 1 requires explicit local geyser placement).
  const byGeyser = new Map()
  for (const fx of consumers) {
    const gid = findGeyserForFixture(state, fx.id)
    if (!gid) continue
    if (!byGeyser.has(gid)) byGeyser.set(gid, [])
    byGeyser.get(gid).push(fx)
  }
  if (byGeyser.size === 0) return

  for (const gid of [...byGeyser.keys()].sort()) {
    const geyser = state.plumbingFixtures[gid]
    if (!geyser) continue
    const group = byGeyser.get(gid)
    const leafEntityIds = group.map(g => g.id).sort()
    const branchId = branchIdFor('HOT_SUPPLY', leafEntityIds)

    const geyserNodeId = nodeIdFor(gid, 'EQUIPMENT', 'HOT_SUPPLY')
    nodes[geyserNodeId] = {
      id: geyserNodeId,
      entityId: gid,
      kind: 'EQUIPMENT',
      discipline: 'PLUMBING',
      systemId: 'HOT_SUPPLY',
      branchId,
      x: geyser.x, y: geyser.y,
      floorId: geyser.floorId ?? DEFAULT_FLOOR_ID,
    }
    const branchNodeIds = [geyserNodeId]
    const branchEdgeIds = []
    for (const fx of group) {
      const fxNodeId = nodeIdFor(fx.id, 'FIXTURE', 'HOT_SUPPLY')
      nodes[fxNodeId] = {
        id: fxNodeId,
        entityId: fx.id,
        kind: 'FIXTURE',
        discipline: 'PLUMBING',
        systemId: 'HOT_SUPPLY',
        branchId,
        x: fx.x, y: fx.y,
        floorId: fx.floorId ?? DEFAULT_FLOOR_ID,
        fixtureUnits: getFixtureType(fx.type)?.fixtureUnits ?? 0,
      }
      const edgeId = edgeIdFor(geyserNodeId, fxNodeId, 'HOT_SUPPLY', 'BRANCH')
      edges[edgeId] = {
        id: edgeId,
        fromNodeId: geyserNodeId,
        toNodeId: fxNodeId,
        systemId: 'HOT_SUPPLY',
        branchId,
        kind: 'BRANCH',
        zone: 'WALL',
        lengthIn: 0,
        diameterMm: null,
      }
      branchNodeIds.push(fxNodeId)
      branchEdgeIds.push(edgeId)
    }
    branches.push({
      id: branchId,
      systemId: 'HOT_SUPPLY',
      nodeIds: branchNodeIds.sort(),
      edgeIds: branchEdgeIds.sort(),
      leafEntityIds,
    })
    systemById.HOT_SUPPLY.branchIds.push(branchId)
  }
}

// ── Drain system builder ────────────────────────────────────────────────────

function _buildDrainSystem({ fixtures, allRisers, state, nodes, edges, branches, systemById }) {
  const consumers = fixtures.filter(_hasDrain)
  if (consumers.length === 0) return

  // Group drain consumers by destination soil stack (riser id). Fixtures
  // with no nearby stack land in a synthetic per-floor JUNCTION whose
  // entityId is null — routing.js will place the junction at the wet-room
  // external corner via inferSoilStackLocation.
  const byTarget = new Map()  // target = riserId or `JCT:<floorId>:<roomId>`
  for (const fx of consumers) {
    const stackId = findNearestSoilStack(state, fx.id)
    let key
    if (stackId) {
      key = `R:${stackId}`
    } else {
      const fid = fx.floorId ?? DEFAULT_FLOOR_ID
      const rid = fx.roomId ?? '_'
      key = `JCT:${fid}:${rid}`
    }
    if (!byTarget.has(key)) byTarget.set(key, { fixtures: [], target: key })
    byTarget.get(key).fixtures.push(fx)
  }

  for (const key of [...byTarget.keys()].sort()) {
    const { fixtures: group } = byTarget.get(key)
    const leafEntityIds = group.map(g => g.id).sort()
    const branchId = branchIdFor('SOIL_DRAIN', leafEntityIds)

    let targetNodeId
    if (key.startsWith('R:')) {
      const riserId = key.slice(2)
      const riser = allRisers.find(r => r.id === riserId)
      if (!riser) continue
      targetNodeId = nodeIdFor(riserId, 'RISER_TOP', 'SOIL_DRAIN')
      nodes[targetNodeId] = {
        id: targetNodeId,
        entityId: riserId,
        kind: 'RISER_TOP',
        discipline: 'PLUMBING',
        systemId: 'SOIL_DRAIN',
        branchId,
        x: riser.x ?? 0, y: riser.y ?? 0,
        floorId: riser.fromFloorId ?? DEFAULT_FLOOR_ID,
      }
    } else {
      // Synthetic junction — coordinates land in routing via inferSoilStackLocation.
      const [, floorId, roomId] = key.split(':')
      targetNodeId = nodeIdFor(`${floorId}:${roomId}`, 'JUNCTION', 'SOIL_DRAIN')
      nodes[targetNodeId] = {
        id: targetNodeId,
        entityId: null,
        kind: 'JUNCTION',
        discipline: 'PLUMBING',
        systemId: 'SOIL_DRAIN',
        branchId,
        x: 0, y: 0,                 // back-filled by routing.js
        floorId,
        meta: { needsLocation: true, wetRoomId: roomId },
      }
    }

    const branchNodeIds = [targetNodeId]
    const branchEdgeIds = []
    for (const fx of group) {
      const fxNodeId = nodeIdFor(fx.id, 'FIXTURE', 'SOIL_DRAIN')
      nodes[fxNodeId] = {
        id: fxNodeId,
        entityId: fx.id,
        kind: 'FIXTURE',
        discipline: 'PLUMBING',
        systemId: 'SOIL_DRAIN',
        branchId,
        x: fx.x, y: fx.y,
        floorId: fx.floorId ?? DEFAULT_FLOOR_ID,
        fixtureUnits: getFixtureType(fx.type)?.fixtureUnits ?? 0,
      }
      const edgeId = edgeIdFor(fxNodeId, targetNodeId, 'SOIL_DRAIN', 'BRANCH')
      edges[edgeId] = {
        id: edgeId,
        fromNodeId: fxNodeId,
        toNodeId: targetNodeId,
        systemId: 'SOIL_DRAIN',
        branchId,
        kind: 'BRANCH',
        zone: 'FLOOR',
        lengthIn: 0,
        diameterMm: null,
      }
      branchNodeIds.push(fxNodeId)
      branchEdgeIds.push(edgeId)
    }
    branches.push({
      id: branchId,
      systemId: 'SOIL_DRAIN',
      nodeIds: branchNodeIds.sort(),
      edgeIds: branchEdgeIds.sort(),
      leafEntityIds,
    })
    systemById.SOIL_DRAIN.branchIds.push(branchId)
  }
}
