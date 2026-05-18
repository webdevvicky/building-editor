// Electrical system-graph builder.
//
// Produces a SystemGraph keyed by 7 systems: LIGHTING, POWER_5A, POWER_15A,
// AC, GEYSER, SUBMAIN, SOLAR_TIE, EV. (SOLAR_TIE + EV are reserved — they
// exist even when no points yet so consumers can iterate the full set.)
//
// Each system carries Circuits (branches) per IS-732 grouping rules.
// Each branch carries nodes (DB / SWITCHBOARD / POINT / RISER_TOP /
// RISER_BOT) and edges from DB → switchboard / DB → leaf point.
//
// Deterministic — sort comparators explicit. Memoized on
// (electricalPoints, risers) reference change.

import { getPointType } from '../catalogs/pointTypes.js'
import {
  branchIdFor,
  edgeIdFor,
  nodeIdFor,
  sortNodesDeterministically,
  sortEdgesDeterministically,
} from '../shared/systemGraph.js'
import { RISER_KINDS } from '../shared/risers.js'
import { pointInRoom } from '../shared/geometry.js'
import { sortedFloorList } from '../../topology/index.js'
import { groupPointsIntoCircuits } from './circuitGrouping.js'

const DEFAULT_FLOOR_ID = 'F1'

// SystemId registry. The 7 actively-grouped sub-systems + SOLAR_TIE/EV
// always present (Phase 1 spec).
const SYSTEM_DEFS = Object.freeze([
  Object.freeze({ id: 'LIGHTING',   systemType: 'LIGHTING' }),
  Object.freeze({ id: 'POWER_5A',   systemType: 'POWER_5A' }),
  Object.freeze({ id: 'POWER_15A',  systemType: 'POWER_15A' }),
  Object.freeze({ id: 'AC',         systemType: 'AC' }),
  Object.freeze({ id: 'GEYSER',     systemType: 'GEYSER' }),
  Object.freeze({ id: 'SUBMAIN',    systemType: 'SUBMAIN' }),
  Object.freeze({ id: 'SOLAR_TIE',  systemType: 'SOLAR_TIE' }),
  Object.freeze({ id: 'EV',         systemType: 'EV' }),
])

// Map IS-732 circuitClass → top-level systemId.
const CIRCUIT_CLASS_TO_SYSTEM = Object.freeze({
  LIGHTING:    'LIGHTING',
  FAN:         'LIGHTING',
  SOCKETS_5A:  'POWER_5A',
  SOCKETS_15A: 'POWER_15A',
  AC:          'AC',
  GEYSER:      'GEYSER',
  EV:          'EV',
  SOLAR:       'SOLAR_TIE',
  SUBMAIN:     'SUBMAIN',
  METER:       'SUBMAIN',
})

function _emptyGraph() {
  return {
    nodes: {},
    edges: {},
    systems: SYSTEM_DEFS.map(d => ({
      id: d.id, discipline: 'ELECTRICAL', systemType: d.systemType,
      branchIds: [], riserIds: [],
    })),
    branches: [],
  }
}

// Resolve a point's containing room by spatial query when null.
function _resolvePointRoom(state, pt) {
  if (pt.roomId) return pt.roomId
  const fid = pt.floorId ?? DEFAULT_FLOOR_ID
  return pointInRoom(state, pt.x, pt.y, fid)
}

// Find the DB serving a given floor. Each floor has at most one main
// DB (type === 'DB'); deterministic tie-break by id.
function _findDbForFloor(state, floorId) {
  const candidates = Object.values(state.electricalPoints ?? {})
    .filter(p => p && p.type === 'DB' && (p.floorId ?? DEFAULT_FLOOR_ID) === floorId)
  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.id < b.id ? -1 : 1)
  return candidates[0]
}

// Find the main DB (ground floor = first floor in sorted sequence).
function _findMainDb(state) {
  const floors = sortedFloorList(state)
  if (floors.length === 0) {
    // No floors registered — fall back to any DB.
    const all = Object.values(state.electricalPoints ?? {})
      .filter(p => p && p.type === 'DB')
      .sort((a, b) => a.id < b.id ? -1 : 1)
    return all[0] ?? null
  }
  for (const f of floors) {
    const db = _findDbForFloor(state, f.id)
    if (db) return db
  }
  return null
}

// Single-cell memo.
let _cache = null

export function buildElectricalSystemGraph(state, opts = {}) {
  void opts
  if (!state) return _emptyGraph()
  const pointsMap = state.electricalPoints ?? {}
  const risersMap = state.risers ?? {}
  if (_cache && _cache.points === pointsMap && _cache.risers === risersMap) {
    return _cache.result
  }
  const result = _build(state, pointsMap, risersMap)
  _cache = { points: pointsMap, risers: risersMap, result }
  return result
}

function _build(state, pointsMap, risersMap) {
  const nodes = {}
  const edges = {}
  const branches = []
  const systemById = {}
  for (const def of SYSTEM_DEFS) {
    systemById[def.id] = {
      id: def.id, discipline: 'ELECTRICAL', systemType: def.systemType,
      branchIds: [], riserIds: [],
    }
  }

  // Backfill point.roomId on shallow clones — never mutate input.
  const allPoints = Object.values(pointsMap)
    .filter(Boolean)
    .map(p => p.roomId ? p : { ...p, roomId: _resolvePointRoom(state, p) })

  // Floors present (by points).
  const floorIdSet = new Set()
  for (const p of allPoints) floorIdSet.add(p.floorId ?? DEFAULT_FLOOR_ID)

  // ── Per-floor circuits → branches under their system ─────────────────
  // For each floor, find the DB, then walk the circuits emitted by
  // groupPointsIntoCircuits().
  for (const fid of [...floorIdSet].sort()) {
    const db = _findDbForFloor(state, fid)
    if (!db) continue   // no DB ⇒ no circuits (warnings emitted elsewhere)

    // Mint a DB node per system that has circuits on this floor —
    // node identity is (db.id, 'DB', systemId).
    const circuits = groupPointsIntoCircuits(state, fid)
    if (circuits.length === 0) continue

    for (const circuit of circuits) {
      const sysId = CIRCUIT_CLASS_TO_SYSTEM[circuit.circuitClass]
      if (!sysId) continue
      const dbNodeId = nodeIdFor(db.id, 'DB', sysId)
      if (!nodes[dbNodeId]) {
        nodes[dbNodeId] = {
          id: dbNodeId,
          entityId: db.id,
          kind: 'DB',
          discipline: 'ELECTRICAL',
          systemId: sysId,
          branchId: null,
          x: db.x, y: db.y,
          floorId: fid,
        }
      }

      // Leaf entity ids for branch id derivation.
      const leafEntityIds = [...circuit.points].sort()
      const branchId = branchIdFor(sysId, leafEntityIds)
      const branchNodeIds = [dbNodeId]
      const branchEdgeIds = []

      for (const pid of leafEntityIds) {
        const pt = pointsMap[pid] || allPoints.find(p => p.id === pid)
        if (!pt) continue
        const ptNodeId = nodeIdFor(pt.id, 'POINT', sysId)
        nodes[ptNodeId] = {
          id: ptNodeId,
          entityId: pt.id,
          kind: 'POINT',
          discipline: 'ELECTRICAL',
          systemId: sysId,
          branchId,
          x: pt.x, y: pt.y,
          floorId: pt.floorId ?? fid,
          roomId: pt.roomId ?? null,
          pointType: pt.type,
          circuitClass: circuit.circuitClass,
        }
        const edgeId = edgeIdFor(dbNodeId, ptNodeId, sysId, 'BRANCH')
        edges[edgeId] = {
          id: edgeId,
          fromNodeId: dbNodeId,
          toNodeId: ptNodeId,
          systemId: sysId,
          branchId,
          kind: 'BRANCH',
          zone: sysId === 'LIGHTING' ? 'CEILING' : 'WALL',
          lengthIn: 0,
          gaugeMm2: circuit.gaugeMm2,
          diameterMm: null,  // electrical routes carry gaugeMm2, not diameterMm
          circuitId: circuit.id,
        }
        branchNodeIds.push(ptNodeId)
        branchEdgeIds.push(edgeId)
      }

      branches.push({
        id: branchId,
        systemId: sysId,
        circuitId: circuit.id,
        circuitClass: circuit.circuitClass,
        gaugeMm2: circuit.gaugeMm2,
        mcbAmps: circuit.mcbAmps,
        loadW: circuit.loadW,
        floorId: fid,
        nodeIds: branchNodeIds.sort(),
        edgeIds: branchEdgeIds.sort(),
        leafEntityIds,
      })
      systemById[sysId].branchIds.push(branchId)
    }
  }

  // ── SUBMAIN: main DB → per-floor DBs ───────────────────────────────────
  const mainDb = _findMainDb(state)
  if (mainDb) {
    const mainDbNodeId = nodeIdFor(mainDb.id, 'DB', 'SUBMAIN')
    nodes[mainDbNodeId] = {
      id: mainDbNodeId,
      entityId: mainDb.id,
      kind: 'DB',
      discipline: 'ELECTRICAL',
      systemId: 'SUBMAIN',
      branchId: null,
      x: mainDb.x, y: mainDb.y,
      floorId: mainDb.floorId ?? DEFAULT_FLOOR_ID,
    }

    const floors = sortedFloorList(state)
    const otherFloorDbs = []
    for (const f of floors) {
      if (f.id === (mainDb.floorId ?? DEFAULT_FLOOR_ID)) continue
      const db = _findDbForFloor(state, f.id)
      if (db) otherFloorDbs.push(db)
    }
    otherFloorDbs.sort((a, b) => a.id < b.id ? -1 : 1)

    if (otherFloorDbs.length > 0) {
      const leafEntityIds = otherFloorDbs.map(d => d.id).sort()
      const branchId = branchIdFor('SUBMAIN', leafEntityIds)
      const branchNodeIds = [mainDbNodeId]
      const branchEdgeIds = []
      for (const db of otherFloorDbs) {
        const dbNodeId = nodeIdFor(db.id, 'DB', 'SUBMAIN')
        nodes[dbNodeId] = {
          id: dbNodeId,
          entityId: db.id,
          kind: 'DB',
          discipline: 'ELECTRICAL',
          systemId: 'SUBMAIN',
          branchId,
          x: db.x, y: db.y,
          floorId: db.floorId ?? DEFAULT_FLOOR_ID,
        }
        const edgeId = edgeIdFor(mainDbNodeId, dbNodeId, 'SUBMAIN', 'TRUNK')
        edges[edgeId] = {
          id: edgeId,
          fromNodeId: mainDbNodeId,
          toNodeId: dbNodeId,
          systemId: 'SUBMAIN',
          branchId,
          kind: 'TRUNK',
          zone: 'SHAFT',
          lengthIn: 0,
          gaugeMm2: 10,
          diameterMm: null,
          circuitId: null,
        }
        branchNodeIds.push(dbNodeId)
        branchEdgeIds.push(edgeId)
      }
      branches.push({
        id: branchId,
        systemId: 'SUBMAIN',
        circuitId: null,
        circuitClass: 'SUBMAIN',
        gaugeMm2: 10,
        mcbAmps: 40,
        loadW: 0,
        floorId: mainDb.floorId ?? DEFAULT_FLOOR_ID,
        nodeIds: branchNodeIds.sort(),
        edgeIds: branchEdgeIds.sort(),
        leafEntityIds,
      })
      systemById.SUBMAIN.branchIds.push(branchId)
    }
  }

  // ── Risers — attach ELECTRICAL_SUBMAIN risers to SUBMAIN system ───────
  for (const r of Object.values(risersMap)) {
    if (!r) continue
    if (r.kind === RISER_KINDS.ELECTRICAL_SUBMAIN) systemById.SUBMAIN.riserIds.push(r.id)
    else if (r.kind === RISER_KINDS.SOLAR_DC_RISER) systemById.SOLAR_TIE.riserIds.push(r.id)
    else if (r.kind === RISER_KINDS.SOLAR_AC_RISER) systemById.SOLAR_TIE.riserIds.push(r.id)
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

// Helper: extract point-type catalog default load.
export function getCircuitClassForPoint(pt) {
  const cat = getPointType(pt?.type)
  return cat?.circuitClass ?? null
}
