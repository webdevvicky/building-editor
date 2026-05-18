// HVAC system-graph builder.
//
// Produces a SystemGraph keyed by 4 sub-systems: SPLIT_AC, VENTILATION,
// REFRIGERANT, CONDENSATE.
//
//   - SPLIT_AC carries the indoor + outdoor unit nodes (and their pairing
//     metadata) so the routing engine + BOQ can iterate "AC pairs".
//   - REFRIGERANT carries one branch per indoor→outdoor pair, with TWO
//     edges per pair (gas + liquid copper). Diameters resolve from catalog.
//   - CONDENSATE carries one branch per indoor unit (indoor → nearest
//     external wall for drainage exit).
//   - VENTILATION carries EXHAUST_FAN_HVAC + FRESH_AIR_INLET unit nodes
//     (no edges in Phase 1 — point-only).
//
// All sorts deterministic. Memoized on `hvacUnits` reference change.
//
// Pure: never mutates state.

import { getHvacUnit } from '../catalogs/hvacUnits.js'
import { getCopperDiameter } from '../catalogs/pipeStandards/copper.js'
import {
  branchIdFor,
  edgeIdFor,
  nodeIdFor,
  sortNodesDeterministically,
  sortEdgesDeterministically,
} from '../shared/systemGraph.js'
import { RISER_KINDS } from '../shared/risers.js'
import { pointInRoom } from '../shared/geometry.js'

const DEFAULT_FLOOR_ID = 'F1'

// SystemId registry — 4 HVAC sub-systems.
const SYSTEM_DEFS = Object.freeze([
  Object.freeze({ id: 'SPLIT_AC',    systemType: 'SPLIT_AC' }),
  Object.freeze({ id: 'REFRIGERANT', systemType: 'REFRIGERANT' }),
  Object.freeze({ id: 'CONDENSATE',  systemType: 'CONDENSATE' }),
  Object.freeze({ id: 'VENTILATION', systemType: 'VENTILATION' }),
])

// Unit-type → system membership for the unit-node assignment pass.
// (Refrigerant + condensate edges are derived from pairing, not catalog
// membership.)
const UNIT_TYPE_TO_SYSTEM = Object.freeze({
  AC_INDOOR_UNIT:    'SPLIT_AC',
  AC_OUTDOOR_UNIT:   'SPLIT_AC',
  DUCTED_AC_INDOOR:  'SPLIT_AC',
  DUCTED_AC_OUTDOOR: 'SPLIT_AC',
  EXHAUST_FAN_HVAC:  'VENTILATION',
  FRESH_AIR_INLET:   'VENTILATION',
})

const INDOOR_TYPES  = Object.freeze(new Set(['AC_INDOOR_UNIT',  'DUCTED_AC_INDOOR']))
const OUTDOOR_TYPES = Object.freeze(new Set(['AC_OUTDOOR_UNIT', 'DUCTED_AC_OUTDOOR']))

function _emptyGraph() {
  return {
    nodes: {},
    edges: {},
    systems: SYSTEM_DEFS.map(d => ({
      id: d.id, discipline: 'HVAC', systemType: d.systemType,
      branchIds: [], riserIds: [],
    })),
    branches: [],
  }
}

function _resolveUnitRoom(state, u) {
  if (u.roomId) return u.roomId
  const fid = u.floorId ?? DEFAULT_FLOOR_ID
  return pointInRoom(state, u.x, u.y, fid)
}

// Single-cell memo.
let _cache = null

export function buildHvacSystemGraph(state, opts = {}) {
  void opts
  if (!state) return _emptyGraph()
  const unitsMap  = state.hvacUnits ?? {}
  const risersMap = state.risers    ?? {}
  if (_cache && _cache.units === unitsMap && _cache.risers === risersMap) {
    return _cache.result
  }
  const result = _build(state, unitsMap, risersMap)
  _cache = { units: unitsMap, risers: risersMap, result }
  return result
}

function _build(state, unitsMap, risersMap) {
  const nodes = {}
  const edges = {}
  const branches = []
  const systemById = {}
  for (const def of SYSTEM_DEFS) {
    systemById[def.id] = {
      id: def.id, discipline: 'HVAC', systemType: def.systemType,
      branchIds: [], riserIds: [],
    }
  }

  // Backfill roomId on shallow clones — never mutate input.
  const allUnits = Object.values(unitsMap)
    .filter(Boolean)
    .map(u => u.roomId ? u : { ...u, roomId: _resolveUnitRoom(state, u) })
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

  // ── Unit nodes per sub-system ────────────────────────────────────────
  // Each unit gets ONE node in its primary sub-system (SPLIT_AC or
  // VENTILATION). REFRIGERANT and CONDENSATE get their own indoor-unit
  // node copies via edge endpoints below (so each system is self-contained
  // for graph-walk consumers).
  for (const u of allUnits) {
    const sysId = UNIT_TYPE_TO_SYSTEM[u.type]
    if (!sysId) continue
    const nodeId = nodeIdFor(u.id, 'UNIT', sysId)
    nodes[nodeId] = {
      id: nodeId,
      entityId: u.id,
      kind: 'UNIT',
      discipline: 'HVAC',
      systemId: sysId,
      branchId: null,
      x: u.x, y: u.y,
      floorId: u.floorId ?? DEFAULT_FLOOR_ID,
      roomId: u.roomId ?? null,
      unitType: u.type,
      capacityTons: u.capacityTons ?? null,
      pairedOutdoorId: u.pairedOutdoorId ?? null,
      pairedIndoorId:  u.pairedIndoorId  ?? null,
    }
  }

  // ── REFRIGERANT — one branch per indoor↔outdoor pair (gas + liquid) ──
  //
  // For each indoor unit with a paired outdoor unit, emit two edges:
  //   - liquid (smaller od; from catalog: indoor.refrigerantPipeOdIn for
  //     liquid, outdoor.refrigerantPipeOdIn for gas — mirrors a typical
  //     split-AC kit's labelling).
  //
  // Diameters resolve through getCopperDiameter() — no magic numbers.
  const indoorUnits = allUnits.filter(u => INDOOR_TYPES.has(u.type))
  for (const indoor of indoorUnits) {
    const outdoorId = indoor.pairedOutdoorId
    if (!outdoorId) continue
    const outdoor = unitsMap[outdoorId]
    if (!outdoor || !OUTDOOR_TYPES.has(outdoor.type)) continue

    const indoorCat  = getHvacUnit(indoor.type)
    const outdoorCat = getHvacUnit(outdoor.type)
    if (!indoorCat || !outdoorCat) continue

    // Two refrigerant edges per pair. The "liquid" leg uses the indoor
    // unit's catalog od; the "gas" leg uses the outdoor unit's catalog od
    // (industry convention — gas line is the larger of the pair).
    const liquidOdIn = indoorCat.refrigerantPipeOdIn
    const gasOdIn    = outdoorCat.refrigerantPipeOdIn
    const liquidCat  = getCopperDiameter(liquidOdIn)
    const gasCat     = getCopperDiameter(gasOdIn)

    const indoorNodeId  = nodeIdFor(indoor.id,  'UNIT_INDOOR',  'REFRIGERANT')
    const outdoorNodeId = nodeIdFor(outdoor.id, 'UNIT_OUTDOOR', 'REFRIGERANT')

    const indoorFloorId  = indoor.floorId  ?? DEFAULT_FLOOR_ID
    const outdoorFloorId = outdoor.floorId ?? DEFAULT_FLOOR_ID

    nodes[indoorNodeId] = {
      id: indoorNodeId,
      entityId: indoor.id,
      kind: 'UNIT_INDOOR',
      discipline: 'HVAC',
      systemId: 'REFRIGERANT',
      branchId: null,
      x: indoor.x, y: indoor.y,
      floorId: indoorFloorId,
      roomId: indoor.roomId ?? null,
      unitType: indoor.type,
    }
    nodes[outdoorNodeId] = {
      id: outdoorNodeId,
      entityId: outdoor.id,
      kind: 'UNIT_OUTDOOR',
      discipline: 'HVAC',
      systemId: 'REFRIGERANT',
      branchId: null,
      x: outdoor.x, y: outdoor.y,
      floorId: outdoorFloorId,
      roomId: outdoor.roomId ?? null,
      unitType: outdoor.type,
    }

    const leafEntityIds = [indoor.id, outdoor.id].sort()
    const branchId = branchIdFor('REFRIGERANT', leafEntityIds)
    nodes[indoorNodeId].branchId  = branchId
    nodes[outdoorNodeId].branchId = branchId

    const liquidEdgeId = edgeIdFor(indoorNodeId, outdoorNodeId, 'REFRIGERANT', 'LIQUID')
    const gasEdgeId    = edgeIdFor(indoorNodeId, outdoorNodeId, 'REFRIGERANT', 'GAS')

    edges[liquidEdgeId] = {
      id: liquidEdgeId,
      fromNodeId: indoorNodeId,
      toNodeId:   outdoorNodeId,
      systemId:   'REFRIGERANT',
      branchId,
      kind: 'LIQUID',
      zone: 'WALL',
      lengthIn: 0,
      diameterMm: liquidCat?.odMm ?? null,
      pipeOdIn:   liquidOdIn ?? null,
      gaugeMm2:   null,
    }
    edges[gasEdgeId] = {
      id: gasEdgeId,
      fromNodeId: indoorNodeId,
      toNodeId:   outdoorNodeId,
      systemId:   'REFRIGERANT',
      branchId,
      kind: 'GAS',
      zone: 'WALL',
      lengthIn: 0,
      diameterMm: gasCat?.odMm ?? null,
      pipeOdIn:   gasOdIn ?? null,
      gaugeMm2:   null,
    }

    branches.push({
      id: branchId,
      systemId: 'REFRIGERANT',
      circuitId: null,
      circuitClass: 'REFRIGERANT',
      capacityTons: indoor.capacityTons ?? indoorCat.capacityTons ?? null,
      pairedIndoorId:  indoor.id,
      pairedOutdoorId: outdoor.id,
      floorId: indoorFloorId,
      crossFloor: indoorFloorId !== outdoorFloorId,
      nodeIds: [indoorNodeId, outdoorNodeId].sort(),
      edgeIds: [liquidEdgeId, gasEdgeId].sort(),
      leafEntityIds,
    })
    systemById.REFRIGERANT.branchIds.push(branchId)
  }

  // ── CONDENSATE — one branch per indoor unit ──────────────────────────
  //
  // The drainage exit point is resolved by the routing engine (it walks
  // the floor's external walls). At the graph layer we just mint the
  // indoor node + a synthetic EXIT node placeholder; routing.js will
  // override the EXIT node's coordinates via _resolveCondensateExit().
  for (const indoor of indoorUnits) {
    const cat = getHvacUnit(indoor.type)
    const diaMm = cat?.condensateDiameterMm
    if (!diaMm) continue

    const indoorNodeId = nodeIdFor(indoor.id, 'UNIT_INDOOR', 'CONDENSATE')
    const exitNodeId   = nodeIdFor(indoor.id, 'EXIT',        'CONDENSATE')

    const fid = indoor.floorId ?? DEFAULT_FLOOR_ID

    nodes[indoorNodeId] = {
      id: indoorNodeId,
      entityId: indoor.id,
      kind: 'UNIT_INDOOR',
      discipline: 'HVAC',
      systemId: 'CONDENSATE',
      branchId: null,
      x: indoor.x, y: indoor.y,
      floorId: fid,
      roomId: indoor.roomId ?? null,
      unitType: indoor.type,
    }
    nodes[exitNodeId] = {
      id: exitNodeId,
      entityId: null,
      kind: 'EXIT',
      discipline: 'HVAC',
      systemId: 'CONDENSATE',
      branchId: null,
      x: indoor.x, y: indoor.y,   // routing.js relocates onto external wall
      floorId: fid,
      roomId: null,
      meta: { needsLocation: true, sourceIndoorId: indoor.id },
    }

    const leafEntityIds = [indoor.id]
    const branchId = branchIdFor('CONDENSATE', leafEntityIds)
    nodes[indoorNodeId].branchId = branchId
    nodes[exitNodeId].branchId   = branchId

    const edgeId = edgeIdFor(indoorNodeId, exitNodeId, 'CONDENSATE', 'DRAIN')
    edges[edgeId] = {
      id: edgeId,
      fromNodeId: indoorNodeId,
      toNodeId:   exitNodeId,
      systemId:   'CONDENSATE',
      branchId,
      kind: 'DRAIN',
      zone: 'CEILING',
      lengthIn: 0,
      diameterMm: diaMm,
      pipeOdIn:   null,
      gaugeMm2:   null,
    }

    branches.push({
      id: branchId,
      systemId: 'CONDENSATE',
      circuitId: null,
      circuitClass: 'CONDENSATE',
      capacityTons: null,
      pairedIndoorId: indoor.id,
      pairedOutdoorId: null,
      floorId: fid,
      crossFloor: false,
      nodeIds: [indoorNodeId, exitNodeId].sort(),
      edgeIds: [edgeId],
      leafEntityIds,
    })
    systemById.CONDENSATE.branchIds.push(branchId)
  }

  // ── SPLIT_AC + VENTILATION: bookkeeping branches (point-only) ────────
  //
  // Each AC pair becomes a SPLIT_AC branch (mirrors REFRIGERANT pairing
  // so BOQ can iterate "ac pairs" without traversing the refrigerant
  // edges). VENTILATION carries one branch per unit (no edges).
  for (const indoor of indoorUnits) {
    const outdoorId = indoor.pairedOutdoorId
    if (!outdoorId) continue
    const outdoor = unitsMap[outdoorId]
    if (!outdoor) continue
    const leafEntityIds = [indoor.id, outdoor.id].sort()
    const branchId = branchIdFor('SPLIT_AC', leafEntityIds)
    const indoorNodeId  = nodeIdFor(indoor.id,  'UNIT', 'SPLIT_AC')
    const outdoorNodeId = nodeIdFor(outdoor.id, 'UNIT', 'SPLIT_AC')
    if (nodes[indoorNodeId])  nodes[indoorNodeId].branchId  = branchId
    if (nodes[outdoorNodeId]) nodes[outdoorNodeId].branchId = branchId
    branches.push({
      id: branchId,
      systemId: 'SPLIT_AC',
      circuitId: null,
      circuitClass: 'SPLIT_AC',
      capacityTons: indoor.capacityTons ?? getHvacUnit(indoor.type)?.capacityTons ?? null,
      pairedIndoorId:  indoor.id,
      pairedOutdoorId: outdoor.id,
      floorId: indoor.floorId ?? DEFAULT_FLOOR_ID,
      crossFloor: (indoor.floorId ?? DEFAULT_FLOOR_ID) !== (outdoor.floorId ?? DEFAULT_FLOOR_ID),
      nodeIds: [indoorNodeId, outdoorNodeId].filter(id => nodes[id]).sort(),
      edgeIds: [],
      leafEntityIds,
    })
    systemById.SPLIT_AC.branchIds.push(branchId)
  }

  for (const u of allUnits) {
    if (UNIT_TYPE_TO_SYSTEM[u.type] !== 'VENTILATION') continue
    const leafEntityIds = [u.id]
    const branchId = branchIdFor('VENTILATION', leafEntityIds)
    const nodeId = nodeIdFor(u.id, 'UNIT', 'VENTILATION')
    if (nodes[nodeId]) nodes[nodeId].branchId = branchId
    branches.push({
      id: branchId,
      systemId: 'VENTILATION',
      circuitId: null,
      circuitClass: 'VENTILATION',
      capacityTons: null,
      pairedIndoorId:  null,
      pairedOutdoorId: null,
      floorId: u.floorId ?? DEFAULT_FLOOR_ID,
      crossFloor: false,
      nodeIds: [nodeId].filter(id => nodes[id]),
      edgeIds: [],
      leafEntityIds,
    })
    systemById.VENTILATION.branchIds.push(branchId)
  }

  // ── Risers — attach HVAC_REFRIGERANT / HVAC_CONDENSATE ───────────────
  for (const r of Object.values(risersMap)) {
    if (!r) continue
    if (r.kind === RISER_KINDS.HVAC_REFRIGERANT) systemById.REFRIGERANT.riserIds.push(r.id)
    else if (r.kind === RISER_KINDS.HVAC_CONDENSATE) systemById.CONDENSATE.riserIds.push(r.id)
  }
  for (const sysId of Object.keys(systemById)) systemById[sysId].riserIds.sort()

  // Deterministic emission order.
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
