// Fire system-graph builder.
//
// Produces a SystemGraph keyed by 3 sub-systems:
//   - DETECTION  — closed loop from FIRE_ALARM_PANEL through every detector
//                  (smoke + heat) + manual call points and back to panel.
//                  Wired with fire-rated cable, routed in the CEILING zone.
//   - SPRINKLER  — tree from the FIRE_MAIN riser top → per-floor branch line
//                  → individual sprinkler heads. GI pipe, CEILING zone.
//                  Coverage per head comes from the device catalog (NBC).
//   - EQUIPMENT  — point-only (hose reels, extinguishers). No edges.
//
// Sprinkler-head auto-placement is the suggestion engine's job; this builder
// only consumes already-placed heads from state.fireDevices.
//
// Deterministic everywhere. Memoized on (fireDevices, risers) reference change.
// Pure: never mutates state.

import { getFireDevice } from '../catalogs/fireDevices.js'
import { getGiDiameter } from '../catalogs/pipeStandards/gi.js'
import { getCableType } from '../catalogs/cableTypes.js'
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

// Standard sprinkler branch-line size (GI 32 mm) — typical light hazard
// residential. Heads tap off this branch line. Sizing.js can upgrade in
// Phase 2 with hydraulic calc.
const SPRINKLER_BRANCH_GI_NOMINAL_MM = 32

// Detection cable — fire-rated 2-core (per NBC 2016 for analog addressable
// loop). Catalog id from cableTypes.js.
const DETECTION_CABLE_ID = 'FIRE_RATED_2C'

// SystemId registry — 3 fire sub-systems.
const SYSTEM_DEFS = Object.freeze([
  Object.freeze({ id: 'DETECTION', systemType: 'DETECTION' }),
  Object.freeze({ id: 'SPRINKLER', systemType: 'SPRINKLER' }),
  Object.freeze({ id: 'EQUIPMENT', systemType: 'EQUIPMENT' }),
])

// Device-type → primary system membership.
const DEVICE_TYPE_TO_SYSTEM = Object.freeze({
  SMOKE_DETECTOR:    'DETECTION',
  HEAT_DETECTOR:     'DETECTION',
  MANUAL_CALL_POINT: 'DETECTION',
  FIRE_ALARM_PANEL:  'DETECTION',
  SPRINKLER_HEAD:    'SPRINKLER',
  SPRINKLER_VALVE:   'SPRINKLER',
  FIRE_HOSE_REEL:    'EQUIPMENT',
  FIRE_EXTINGUISHER: 'EQUIPMENT',
})

const DETECTION_LEAF_TYPES = Object.freeze(new Set([
  'SMOKE_DETECTOR', 'HEAT_DETECTOR', 'MANUAL_CALL_POINT',
]))

function _emptyGraph() {
  return {
    nodes: {},
    edges: {},
    systems: SYSTEM_DEFS.map(d => ({
      id: d.id, discipline: 'FIRE', systemType: d.systemType,
      branchIds: [], riserIds: [],
    })),
    branches: [],
  }
}

function _resolveDeviceRoom(state, d) {
  if (d.roomId) return d.roomId
  const fid = d.floorId ?? DEFAULT_FLOOR_ID
  return pointInRoom(state, d.x, d.y, fid)
}

// Single-cell memo.
let _cache = null

export function buildFireSystemGraph(state, opts = {}) {
  void opts
  if (!state) return _emptyGraph()
  const devicesMap = state.fireDevices ?? {}
  const risersMap  = state.risers      ?? {}
  if (_cache && _cache.devices === devicesMap && _cache.risers === risersMap) {
    return _cache.result
  }
  const result = _build(state, devicesMap, risersMap)
  _cache = { devices: devicesMap, risers: risersMap, result }
  return result
}

// Centroid-aware deterministic ordering: (floorId, roomId, centroidX,
// centroidY, id). Returns a shallow-cloned device with roomId backfilled.
function _orderDevices(state, devicesMap) {
  return Object.values(devicesMap)
    .filter(Boolean)
    .map(d => d.roomId ? d : { ...d, roomId: _resolveDeviceRoom(state, d) })
    .sort((a, b) => {
      const fa = a.floorId ?? DEFAULT_FLOOR_ID
      const fb = b.floorId ?? DEFAULT_FLOOR_ID
      if (fa !== fb) return fa < fb ? -1 : 1
      const ra = a.roomId ?? ''
      const rb = b.roomId ?? ''
      if (ra !== rb) return ra < rb ? -1 : 1
      if (a.x !== b.x) return a.x - b.x
      if (a.y !== b.y) return a.y - b.y
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
}

// Find a FIRE_ALARM_PANEL on a given floor (or anywhere if none on floor).
function _findPanel(allDevices, floorId) {
  let onFloor = null, anywhere = null
  for (const d of allDevices) {
    if (d.type !== 'FIRE_ALARM_PANEL') continue
    if (!anywhere) anywhere = d
    if ((d.floorId ?? DEFAULT_FLOOR_ID) === floorId && !onFloor) onFloor = d
  }
  return onFloor ?? anywhere
}

function _build(state, devicesMap, risersMap) {
  const nodes = {}
  const edges = {}
  const branches = []
  const systemById = {}
  for (const def of SYSTEM_DEFS) {
    systemById[def.id] = {
      id: def.id, discipline: 'FIRE', systemType: def.systemType,
      branchIds: [], riserIds: [],
    }
  }

  const allDevices = _orderDevices(state, devicesMap)

  // ── Primary device nodes ─────────────────────────────────────────────
  for (const d of allDevices) {
    const sysId = DEVICE_TYPE_TO_SYSTEM[d.type]
    if (!sysId) continue
    const nodeId = nodeIdFor(d.id, 'DEVICE', sysId)
    nodes[nodeId] = {
      id: nodeId,
      entityId: d.id,
      kind: 'DEVICE',
      discipline: 'FIRE',
      systemId: sysId,
      branchId: null,
      x: d.x, y: d.y,
      floorId: d.floorId ?? DEFAULT_FLOOR_ID,
      roomId: d.roomId ?? null,
      deviceType: d.type,
    }
  }

  // ── DETECTION — closed loop from panel through detectors back to panel ─
  //
  // Per NBC: addressable fire-alarm loop. Visit every detection leaf in
  // deterministic order; close the loop with one edge from the last leaf
  // back to the panel.
  const detectionLeaves = allDevices.filter(d => DETECTION_LEAF_TYPES.has(d.type))
  const cableCat = getCableType(DETECTION_CABLE_ID)

  // For each panel: build one loop covering every detection leaf that
  // sits on a floor reachable from this panel (Phase 1: all leaves
  // wired to the first panel; multi-panel zoning lands in Phase 2).
  const panels = allDevices.filter(d => d.type === 'FIRE_ALARM_PANEL')
  if (panels.length > 0 && detectionLeaves.length > 0) {
    const panel = panels[0]      // single-loop assumption — deterministic
    const panelNodeId = nodeIdFor(panel.id, 'DEVICE', 'DETECTION')
    const sequence = [panel, ...detectionLeaves, panel]
    const leafEntityIds = detectionLeaves.map(l => l.id).sort()
    const branchId = branchIdFor('DETECTION', [panel.id, ...leafEntityIds])
    const branchNodeIds = [panelNodeId]
    const branchEdgeIds = []

    if (nodes[panelNodeId]) nodes[panelNodeId].branchId = branchId

    for (let i = 1; i < sequence.length; i++) {
      const a = sequence[i - 1]
      const b = sequence[i]
      const fromNodeId = nodeIdFor(a.id, 'DEVICE', 'DETECTION')
      const toNodeId   = nodeIdFor(b.id, 'DEVICE', 'DETECTION')
      if (!nodes[fromNodeId] || !nodes[toNodeId]) continue
      // Tag every detection node with this branchId.
      nodes[toNodeId].branchId = branchId
      if (i === 1) nodes[fromNodeId].branchId = branchId

      // Last edge (close-the-loop) → distinct kind so route emission can
      // mark it. Detection edges otherwise share the LOOP kind so the
      // routing engine treats them uniformly.
      const isCloseLoop = (i === sequence.length - 1)
      const edgeKind = isCloseLoop ? 'LOOP_CLOSE' : 'LOOP'
      // Wrap counter into the edge id payload so two consecutive panel
      // visits don't collapse to the same edge id.
      const edgeId = edgeIdFor(fromNodeId, toNodeId, 'DETECTION', `${edgeKind}_${i}`)
      edges[edgeId] = {
        id: edgeId,
        fromNodeId,
        toNodeId,
        systemId: 'DETECTION',
        branchId,
        kind: edgeKind,
        zone: 'CEILING',
        lengthIn: 0,
        diameterMm: null,
        pipeOdIn:   null,
        gaugeMm2:   cableCat?.sqmm ?? null,
        cableTypeId: DETECTION_CABLE_ID,
        loopIndex: i,
      }
      branchEdgeIds.push(edgeId)
      if (!branchNodeIds.includes(toNodeId)) branchNodeIds.push(toNodeId)
    }

    branches.push({
      id: branchId,
      systemId: 'DETECTION',
      circuitId: null,
      circuitClass: 'DETECTION_LOOP',
      capacityTons: null,
      panelId: panel.id,
      floorId: panel.floorId ?? DEFAULT_FLOOR_ID,
      crossFloor: false,
      nodeIds: [...branchNodeIds].sort(),
      edgeIds: [...branchEdgeIds].sort(),
      leafEntityIds,
      cableTypeId: DETECTION_CABLE_ID,
    })
    systemById.DETECTION.branchIds.push(branchId)
  }

  // ── SPRINKLER — tree from riser top → branch per floor → heads ────────
  //
  // Each floor that hosts sprinkler heads becomes one branch. The riser
  // sits at (riser.x, riser.y) on its toFloorId. Each branch has one
  // synthetic RISER_TAP node (the branch root) and one edge per head.
  const giCat = getGiDiameter(SPRINKLER_BRANCH_GI_NOMINAL_MM)
  const sprinklerRisers = Object.values(risersMap)
    .filter(r => r && r.kind === RISER_KINDS.FIRE_MAIN)
    .sort((a, b) => a.id < b.id ? -1 : 1)
  const sprinklerHeads  = allDevices.filter(d => d.type === 'SPRINKLER_HEAD')

  // Group heads by floor.
  const headsByFloor = new Map()
  for (const h of sprinklerHeads) {
    const fid = h.floorId ?? DEFAULT_FLOOR_ID
    if (!headsByFloor.has(fid)) headsByFloor.set(fid, [])
    headsByFloor.get(fid).push(h)
  }

  // For each floor with heads: find a serving riser (the one whose
  // [from..to] range covers this floor — Phase 1: first riser in
  // deterministic order is the building's only fire main).
  const servingRiser = sprinklerRisers[0] ?? null

  for (const fid of [...headsByFloor.keys()].sort()) {
    const heads = headsByFloor.get(fid) ?? []
    if (heads.length === 0) continue

    // Synthetic riser-tap node (one per floor) — branch root.
    const tapEntityId = servingRiser ? `${servingRiser.id}__${fid}` : `fire_main__${fid}`
    const tapNodeId   = nodeIdFor(tapEntityId, 'RISER_TAP', 'SPRINKLER')
    const tapX = servingRiser?.x ?? heads[0].x
    const tapY = servingRiser?.y ?? heads[0].y
    nodes[tapNodeId] = {
      id: tapNodeId,
      entityId: servingRiser?.id ?? null,
      kind: 'RISER_TAP',
      discipline: 'FIRE',
      systemId: 'SPRINKLER',
      branchId: null,
      x: tapX, y: tapY,
      floorId: fid,
      roomId: null,
      meta: { needsLocation: !servingRiser },
    }

    const leafEntityIds = heads.map(h => h.id).sort()
    const branchId = branchIdFor('SPRINKLER', [tapEntityId, ...leafEntityIds])
    nodes[tapNodeId].branchId = branchId

    const branchNodeIds = [tapNodeId]
    const branchEdgeIds = []
    for (const h of heads) {
      const headNodeId = nodeIdFor(h.id, 'DEVICE', 'SPRINKLER')
      if (!nodes[headNodeId]) continue
      nodes[headNodeId].branchId = branchId
      const edgeId = edgeIdFor(tapNodeId, headNodeId, 'SPRINKLER', 'BRANCH')
      edges[edgeId] = {
        id: edgeId,
        fromNodeId: tapNodeId,
        toNodeId:   headNodeId,
        systemId:   'SPRINKLER',
        branchId,
        kind: 'BRANCH',
        zone: 'CEILING',
        lengthIn: 0,
        diameterMm: giCat?.odMm ?? null,
        nominalMm:  SPRINKLER_BRANCH_GI_NOMINAL_MM,
        pipeOdIn:   null,
        gaugeMm2:   null,
      }
      branchNodeIds.push(headNodeId)
      branchEdgeIds.push(edgeId)
    }

    branches.push({
      id: branchId,
      systemId: 'SPRINKLER',
      circuitId: null,
      circuitClass: 'SPRINKLER_BRANCH',
      capacityTons: null,
      riserId: servingRiser?.id ?? null,
      floorId: fid,
      crossFloor: false,
      nodeIds: [...branchNodeIds].sort(),
      edgeIds: [...branchEdgeIds].sort(),
      leafEntityIds,
      nominalMm:  SPRINKLER_BRANCH_GI_NOMINAL_MM,
    })
    systemById.SPRINKLER.branchIds.push(branchId)
  }

  // ── EQUIPMENT — point-only branches per floor ─────────────────────────
  // One bookkeeping branch per floor that holds extinguishers + hose reels
  // so BOQ iteration over branches still surfaces these counts.
  const equipmentByFloor = new Map()
  for (const d of allDevices) {
    if (DEVICE_TYPE_TO_SYSTEM[d.type] !== 'EQUIPMENT') continue
    const fid = d.floorId ?? DEFAULT_FLOOR_ID
    if (!equipmentByFloor.has(fid)) equipmentByFloor.set(fid, [])
    equipmentByFloor.get(fid).push(d)
  }
  for (const fid of [...equipmentByFloor.keys()].sort()) {
    const items = equipmentByFloor.get(fid) ?? []
    if (items.length === 0) continue
    const leafEntityIds = items.map(d => d.id).sort()
    const branchId = branchIdFor('EQUIPMENT', leafEntityIds)
    const branchNodeIds = []
    for (const d of items) {
      const nodeId = nodeIdFor(d.id, 'DEVICE', 'EQUIPMENT')
      if (!nodes[nodeId]) continue
      nodes[nodeId].branchId = branchId
      branchNodeIds.push(nodeId)
    }
    branches.push({
      id: branchId,
      systemId: 'EQUIPMENT',
      circuitId: null,
      circuitClass: 'EQUIPMENT',
      capacityTons: null,
      floorId: fid,
      crossFloor: false,
      nodeIds: [...branchNodeIds].sort(),
      edgeIds: [],
      leafEntityIds,
    })
    systemById.EQUIPMENT.branchIds.push(branchId)
  }

  // ── Risers — attach FIRE_MAIN risers to SPRINKLER system ──────────────
  for (const r of Object.values(risersMap)) {
    if (!r) continue
    if (r.kind === RISER_KINDS.FIRE_MAIN) systemById.SPRINKLER.riserIds.push(r.id)
  }
  for (const sysId of Object.keys(systemById)) systemById[sysId].riserIds.sort()

  // Catalog-tag membership reference (linter happy + reads).
  void getFireDevice

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
