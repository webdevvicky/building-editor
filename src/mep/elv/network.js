// ELV system-graph builder.
//
// Produces a SystemGraph keyed by 4 sub-systems:
//   - CCTV     — each CCTV_CAMERA → central VIDEO_DOOR_PHONE (preferred)
//                or ELV_RACK (fallback). Star topology.
//   - DATA     — each DATA_POINT → ELV_RACK (patch panel).
//   - SECURITY — each ALARM_SENSOR + VIDEO_DOOR_PHONE → INTERCOM panel.
//   - AV       — each TV_POINT_ELV + WIFI_AP → ELV_RACK.
//
// Topology is STAR for every sub-system (no daisy-chain). Each leaf gets
// one edge to its central hub. Wired via the per-device-type cableTypeId
// taken from the ELV device catalog — no magic numbers.
//
// Deterministic everywhere. Memoized on (elvDevices, risers) reference
// change. Pure: never mutates state.

import { getElvDevice } from '../catalogs/elvDevices.js'
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

// SystemId registry — 4 ELV sub-systems.
const SYSTEM_DEFS = Object.freeze([
  Object.freeze({ id: 'CCTV',     systemType: 'CCTV' }),
  Object.freeze({ id: 'DATA',     systemType: 'DATA' }),
  Object.freeze({ id: 'SECURITY', systemType: 'SECURITY' }),
  Object.freeze({ id: 'AV',       systemType: 'AV' }),
])

// Leaf device-type → primary sub-system membership.
// (Hubs — ELV_RACK / VIDEO_DOOR_PHONE / INTERCOM — are not in this table;
// they are resolved separately by sub-system below.)
const LEAF_TYPE_TO_SYSTEM = Object.freeze({
  CCTV_CAMERA:  'CCTV',
  DATA_POINT:   'DATA',
  ALARM_SENSOR: 'SECURITY',
  TV_POINT_ELV: 'AV',
  WIFI_AP:      'AV',
})

// VIDEO_DOOR_PHONE appears as a leaf in SECURITY and as the preferred CCTV
// hub. To keep node uniqueness per (entityId, systemId), it gets one node
// per sub-system it participates in.

function _emptyGraph() {
  return {
    nodes: {},
    edges: {},
    systems: SYSTEM_DEFS.map(d => ({
      id: d.id, discipline: 'ELV', systemType: d.systemType,
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

export function buildElvSystemGraph(state, opts = {}) {
  void opts
  if (!state) return _emptyGraph()
  const devicesMap = state.elvDevices ?? {}
  const risersMap  = state.risers     ?? {}
  if (_cache && _cache.devices === devicesMap && _cache.risers === risersMap) {
    return _cache.result
  }
  const result = _build(state, devicesMap, risersMap)
  _cache = { devices: devicesMap, risers: risersMap, result }
  return result
}

// Centroid-aware deterministic ordering: (floorId, roomId, x, y, id).
// Returns a shallow-cloned device with roomId backfilled when missing.
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

// Pick a hub of `type` for a given floor — prefer same-floor, fall back to
// any floor. Deterministic tie-break by id.
function _pickHub(allDevices, type, floorId) {
  let onFloor = null, anywhere = null
  for (const d of allDevices) {
    if (d.type !== type) continue
    if (!anywhere) anywhere = d
    if ((d.floorId ?? DEFAULT_FLOOR_ID) === floorId && !onFloor) onFloor = d
  }
  return onFloor ?? anywhere
}

function _ensureDeviceNode(nodes, d, sysId) {
  const nodeId = nodeIdFor(d.id, 'DEVICE', sysId)
  if (!nodes[nodeId]) {
    nodes[nodeId] = {
      id: nodeId,
      entityId: d.id,
      kind: 'DEVICE',
      discipline: 'ELV',
      systemId: sysId,
      branchId: null,
      x: d.x, y: d.y,
      floorId: d.floorId ?? DEFAULT_FLOOR_ID,
      roomId: d.roomId ?? null,
      deviceType: d.type,
    }
  }
  return nodeId
}

// Build one star sub-system: every leaf in `leaves` connects to the
// per-floor hub of `hubPriorityTypes` (first available type wins).
//
// Edge `kind` and cable type come from the leaf's catalog entry, so cable
// selection is data-driven — no magic strings in the wiring logic.
function _buildStarSubsystem({
  sysId,
  leaves,
  hubPriorityTypes,
  allDevices,
  nodes,
  edges,
  branches,
  systemById,
  edgeKind,
}) {
  if (!leaves || leaves.length === 0) return

  // Group leaves by floor; one branch per floor → its serving hub.
  const leavesByFloor = new Map()
  for (const d of leaves) {
    const fid = d.floorId ?? DEFAULT_FLOOR_ID
    if (!leavesByFloor.has(fid)) leavesByFloor.set(fid, [])
    leavesByFloor.get(fid).push(d)
  }

  for (const fid of [...leavesByFloor.keys()].sort()) {
    const flrLeaves = leavesByFloor.get(fid) ?? []
    if (flrLeaves.length === 0) continue

    // Resolve hub by priority. First type with a candidate wins.
    let hub = null
    for (const hubType of hubPriorityTypes) {
      hub = _pickHub(allDevices, hubType, fid)
      if (hub) break
    }
    if (!hub) continue   // no hub anywhere — skip this floor's branch

    const hubNodeId = _ensureDeviceNode(nodes, hub, sysId)
    const leafEntityIds = flrLeaves.map(l => l.id).sort()
    const branchId = branchIdFor(sysId, [hub.id, ...leafEntityIds])
    nodes[hubNodeId].branchId = branchId

    const branchNodeIds = [hubNodeId]
    const branchEdgeIds = []

    for (const leaf of flrLeaves) {
      const leafNodeId = _ensureDeviceNode(nodes, leaf, sysId)
      nodes[leafNodeId].branchId = branchId
      // Cable from the leaf's catalog entry — single source of truth.
      const cat = getElvDevice(leaf.type)
      const cableTypeId = cat?.cableTypeId ?? null
      const cableCat = cableTypeId ? getCableType(cableTypeId) : null
      const edgeId = edgeIdFor(leafNodeId, hubNodeId, sysId, edgeKind)
      edges[edgeId] = {
        id: edgeId,
        fromNodeId: hubNodeId,
        toNodeId:   leafNodeId,
        systemId:   sysId,
        branchId,
        kind: edgeKind,
        zone: 'CEILING',
        lengthIn: 0,
        diameterMm: null,
        pipeOdIn:   null,
        gaugeMm2:   cableCat?.sqmm ?? null,
        cableTypeId,
      }
      branchNodeIds.push(leafNodeId)
      branchEdgeIds.push(edgeId)
    }

    branches.push({
      id: branchId,
      systemId: sysId,
      circuitId: null,
      circuitClass: `${sysId}_STAR`,
      capacityTons: null,
      hubEntityId: hub.id,
      hubType: hub.type,
      floorId: fid,
      crossFloor: false,
      nodeIds: [...branchNodeIds].sort(),
      edgeIds: [...branchEdgeIds].sort(),
      leafEntityIds,
    })
    systemById[sysId].branchIds.push(branchId)
  }
}

function _build(state, devicesMap, risersMap) {
  const nodes = {}
  const edges = {}
  const branches = []
  const systemById = {}
  for (const def of SYSTEM_DEFS) {
    systemById[def.id] = {
      id: def.id, discipline: 'ELV', systemType: def.systemType,
      branchIds: [], riserIds: [],
    }
  }

  const allDevices = _orderDevices(state, devicesMap)

  // Pre-create nodes for all leaf devices in their primary sub-system.
  for (const d of allDevices) {
    const sysId = LEAF_TYPE_TO_SYSTEM[d.type]
    if (!sysId) continue
    _ensureDeviceNode(nodes, d, sysId)
  }

  // ── CCTV — cameras → VIDEO_DOOR_PHONE (preferred) or ELV_RACK ─────────
  _buildStarSubsystem({
    sysId: 'CCTV',
    leaves: allDevices.filter(d => d.type === 'CCTV_CAMERA'),
    hubPriorityTypes: ['VIDEO_DOOR_PHONE', 'ELV_RACK'],
    allDevices, nodes, edges, branches, systemById,
    edgeKind: 'STAR',
  })

  // ── DATA — DATA_POINT → ELV_RACK (patch panel) ───────────────────────
  _buildStarSubsystem({
    sysId: 'DATA',
    leaves: allDevices.filter(d => d.type === 'DATA_POINT'),
    hubPriorityTypes: ['ELV_RACK'],
    allDevices, nodes, edges, branches, systemById,
    edgeKind: 'STAR',
  })

  // ── SECURITY — ALARM_SENSOR + VIDEO_DOOR_PHONE → INTERCOM ────────────
  _buildStarSubsystem({
    sysId: 'SECURITY',
    leaves: allDevices.filter(d => d.type === 'ALARM_SENSOR' || d.type === 'VIDEO_DOOR_PHONE'),
    hubPriorityTypes: ['INTERCOM', 'ELV_RACK'],
    allDevices, nodes, edges, branches, systemById,
    edgeKind: 'STAR',
  })

  // ── AV — TV_POINT_ELV + WIFI_AP → ELV_RACK ───────────────────────────
  _buildStarSubsystem({
    sysId: 'AV',
    leaves: allDevices.filter(d => d.type === 'TV_POINT_ELV' || d.type === 'WIFI_AP'),
    hubPriorityTypes: ['ELV_RACK'],
    allDevices, nodes, edges, branches, systemById,
    edgeKind: 'STAR',
  })

  // ── Risers — attach ELV_TRUNKING risers to every ELV sub-system ──────
  for (const r of Object.values(risersMap)) {
    if (!r) continue
    if (r.kind === RISER_KINDS.ELV_TRUNKING) {
      for (const def of SYSTEM_DEFS) systemById[def.id].riserIds.push(r.id)
    }
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
