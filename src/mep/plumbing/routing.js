// Plumbing route builder — turns system-graph edges into wall-perimeter
// polylines with zone classification, lengths, and validation warnings.
//
// Pure: returns { routes, warnings }; never mutates the graph or state.
//
// Routing algorithm per edge:
//   1. Resolve from + to (x,y). FIXTUREs use their stored position.
//      JUNCTIONs with meta.needsLocation are placed via
//      inferSoilStackLocation() in drainage.js.
//   2. Snap each endpoint to the floor's wall-perimeter graph (nearest
//      graph node) — this is the structural "rail" the polyline rides.
//   3. BFS along the perimeter graph (deterministic neighbour order)
//      between the two snapped node ids.
//   4. Prepend the un-snapped endpoint when its distance to the snap is
//      meaningful (> 1 inch) so the polyline reaches the fixture itself.
//   5. Zone-classify each segment per system type.
//
// Sizing is deferred to sizing.js — but routes emit the catalog-default
// diameter for convenience (network builder already wrote diameterMm on
// the edge when present; routing.js just copies it through).

import {
  getFloorWallPerimeterGraph,
  getRoomsOnFloor,
  getWetRoomIds,
  getRoomsOnFloor as _getRoomsOnFloor,
} from '../../topology/index.js'
import { walkWallPerimeter, polylineLengthFt } from '../shared/geometry.js'
import { getZone, ROUTING_ZONES } from '../shared/routingZones.js'
import { inferSoilStackLocation } from './drainage.js'
import { sizePlumbingBranches } from './sizing.js'

void ROUTING_ZONES
void _getRoomsOnFloor

const DEFAULT_FLOOR_ID = 'F1'

const SYSTEM_TO_ROUTE_KIND = Object.freeze({
  COLD_SUPPLY: 'CPVC_SUPPLY',
  HOT_SUPPLY:  'CPVC_HOT',
  SOIL_DRAIN:  'UPVC_DRAIN',
  RAINWATER:   'UPVC_RAIN',
})

// Per-system default zone. WALL for supply, FLOOR for drains.
const SYSTEM_TO_ZONE = Object.freeze({
  COLD_SUPPLY: 'WALL',
  HOT_SUPPLY:  'CEILING',
  SOIL_DRAIN:  'FLOOR',
  RAINWATER:   'EXTERNAL',
})

// Snap a point to the nearest node in the wall-perimeter graph.
function _snapToGraphNode(perimGraph, x, y) {
  if (!perimGraph || !perimGraph.nodes) return null
  let best = null
  for (const nid of Object.keys(perimGraph.nodes).sort()) {
    const n = perimGraph.nodes[nid]
    const d = Math.hypot(x - n.x, y - n.y)
    if (!best || d < best.distance) best = { nodeId: nid, distance: d, x: n.x, y: n.y }
  }
  return best
}

// Resolve a SystemNode position. Junctions with needsLocation flag get
// back-filled via inferSoilStackLocation.
function _resolveNodePosition(node, state) {
  if (!node) return null
  if (node.kind === 'JUNCTION' && node.meta?.needsLocation && node.meta?.wetRoomId) {
    const loc = inferSoilStackLocation(state, node.meta.wetRoomId)
    if (loc) return { x: loc.x, y: loc.y, floorId: node.floorId }
    return null
  }
  return { x: node.x, y: node.y, floorId: node.floorId }
}

// Build routes per edge. Deterministic — graph.edges is already sorted by id.
export function buildPlumbingRoutes(graph, state) {
  const warnings = []
  if (!graph || !graph.edges || !state) return { routes: [], warnings }

  // Phase 1 sizing pass — assign diameters before routing so each route
  // ships out with its size set. Pure: returns a sized clone of the graph.
  const sized = sizePlumbingBranches(graph, { state, projectSettings: state.projectSettings })

  const routes = []

  // Per-floor perimeter-graph cache for the duration of this build.
  const perimByFloor = new Map()
  const perimFor = (fid) => {
    if (!perimByFloor.has(fid)) perimByFloor.set(fid, getFloorWallPerimeterGraph(state, fid))
    return perimByFloor.get(fid)
  }

  // Sort edge ids for stable emission.
  const edgeIds = Object.keys(sized.edges).sort()
  for (const eid of edgeIds) {
    const e = sized.edges[eid]
    const fromN = sized.nodes[e.fromNodeId]
    const toN   = sized.nodes[e.toNodeId]
    if (!fromN || !toN) continue
    const fromPos = _resolveNodePosition(fromN, state)
    const toPos   = _resolveNodePosition(toN, state)
    if (!fromPos || !toPos) continue

    // Phase 1 simplification: routes follow the perimeter of the floor
    // they originate on. Cross-floor edges (e.g. fixture → riser top)
    // are out of scope until Phase 2.4 risers.
    const floorId = fromPos.floorId ?? toPos.floorId ?? DEFAULT_FLOOR_ID
    const perim = perimFor(floorId)

    const fromSnap = _snapToGraphNode(perim, fromPos.x, fromPos.y)
    const toSnap   = _snapToGraphNode(perim, toPos.x, toPos.y)

    let polyline
    if (fromSnap && toSnap && perim?.adjacency) {
      const wallPath = walkWallPerimeter(perim, fromSnap.nodeId, toSnap.nodeId)
      const pts = []
      // Include the original from-point if it's off-graph; the snap is the entry.
      if (Math.hypot(fromPos.x - fromSnap.x, fromPos.y - fromSnap.y) > 1) {
        pts.push({ x: fromPos.x, y: fromPos.y })
      }
      if (wallPath && wallPath.length > 0) pts.push(...wallPath)
      // Tail: original to-point if off-graph.
      if (Math.hypot(toPos.x - toSnap.x, toPos.y - toSnap.y) > 1) {
        pts.push({ x: toPos.x, y: toPos.y })
      }
      polyline = pts.length >= 2 ? pts : [{ x: fromPos.x, y: fromPos.y }, { x: toPos.x, y: toPos.y }]
    } else {
      // Fallback: straight line. Wall-perimeter graph missing or both
      // endpoints lie off any wall (unusual — most fixtures snap somewhere).
      polyline = [{ x: fromPos.x, y: fromPos.y }, { x: toPos.x, y: toPos.y }]
    }

    const baseZone = e.zone ?? SYSTEM_TO_ZONE[e.systemId] ?? 'WALL'
    const zonesPerSegment = new Array(polyline.length - 1).fill(baseZone)
    const lengthFt = polylineLengthFt(polyline)
    const zone = getZone(baseZone)
    const multiplier = zone?.quantityMultiplier ?? 1

    routes.push({
      id: `route_${eid}`,
      kind: SYSTEM_TO_ROUTE_KIND[e.systemId] ?? 'PIPE',
      diameterMm: e.diameterMm ?? null,
      polyline,
      lengthFt,
      adjustedLengthFt: lengthFt * multiplier,
      fromEntityId: fromN.entityId ?? null,
      toEntityId: toN.entityId ?? null,
      systemId: e.systemId,
      branchId: e.branchId,
      edgeId: eid,
      floorId,
      zone: baseZone,
      zonesPerSegment,
    })
  }

  // Emit wet-room-without-floor-trap warnings.
  // For each wet room on each floor, check that at least one FLOOR_TRAP
  // fixture lives inside it (roomId match).
  warnings.push(..._emitFloorTrapWarnings(state))

  // Deterministic emission
  routes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

  return { routes, warnings }
}

function _emitFloorTrapWarnings(state) {
  const warnings = []
  const fixtures = Object.values(state.plumbingFixtures ?? {})
  const wetRoomIds = new Set(getWetRoomIds(state))
  if (wetRoomIds.size === 0) return warnings

  // Build (floorId, roomId) → has floor-trap?
  const haveTrap = new Set()
  for (const fx of fixtures) {
    if (fx.type !== 'FLOOR_TRAP') continue
    if (fx.roomId) haveTrap.add(fx.roomId)
  }

  // For each wet room, check.
  for (const rid of [...wetRoomIds].sort()) {
    if (haveTrap.has(rid)) continue
    const room = state.rooms?.[rid]
    if (!room) continue
    warnings.push({
      ruleId:    'mep_no_floor_trap',
      severity:  'warning',
      category:  'mep',
      entityType:'PLUMBING',
      entityId:  rid,
      message:   `Wet room "${room.name ?? rid}" has no floor trap`,
    })
  }
  return warnings
}

// Convenience — list wet rooms on a floor. Wrapper used by other modules.
export function listWetRoomsOnFloor(state, floorId) {
  return getRoomsOnFloor(state, floorId)
    .filter(r => ['TOILET', 'KITCHEN', 'UTILITY', 'BATHROOM'].includes(r.type))
    .sort((a, b) => a.id < b.id ? -1 : 1)
}
