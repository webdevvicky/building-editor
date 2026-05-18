// Fire route builder.
//
// Detection loop: wire-perimeter polyline along the CEILING zone connecting
// the alarm panel through every detection leaf back to the panel.
// Sprinkler branch: GI pipe along the CEILING zone from the riser tap on
// each floor to every sprinkler head on that floor.
//
// Routes are emitted along the floor wall-perimeter graph (BFS) so polyline
// geometry matches the building footprint. Pure: returns { routes, warnings }
// — no graph or state mutation.

import {
  getFloorWallPerimeterGraph,
} from '../../topology/index.js'
import { walkWallPerimeter, polylineLengthFt } from '../shared/geometry.js'
import { getZone } from '../shared/routingZones.js'
import { sizeFireBranches } from './sizing.js'

const DEFAULT_FLOOR_ID = 'F1'

// Per-edge-system route-kind labels.
const SYSTEM_TO_ROUTE_KIND = Object.freeze({
  DETECTION: 'FIRE_DETECTION_CABLE',
  SPRINKLER: 'FIRE_SPRINKLER_PIPE',
})

// Snap a free point to the nearest node in the wall-perimeter graph.
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

// Walk a perimeter path between two world-space points → polyline.
function _perimeterPolyline(perim, fromX, fromY, toX, toY) {
  const fromSnap = _snapToGraphNode(perim, fromX, fromY)
  const toSnap   = _snapToGraphNode(perim, toX, toY)
  if (!fromSnap || !toSnap || !perim?.adjacency) {
    return [{ x: fromX, y: fromY }, { x: toX, y: toY }]
  }
  const wallPath = walkWallPerimeter(perim, fromSnap.nodeId, toSnap.nodeId)
  const pts = []
  if (Math.hypot(fromX - fromSnap.x, fromY - fromSnap.y) > 1) {
    pts.push({ x: fromX, y: fromY })
  }
  if (wallPath && wallPath.length > 0) pts.push(...wallPath)
  if (Math.hypot(toX - toSnap.x, toY - toSnap.y) > 1) {
    pts.push({ x: toX, y: toY })
  }
  return pts.length >= 2 ? pts : [{ x: fromX, y: fromY }, { x: toX, y: toY }]
}

export function buildFireRoutes(graph, state) {
  const warnings = []
  if (!graph || !graph.edges || !state) return { routes: [], warnings }

  const sized = sizeFireBranches(graph, { state, projectSettings: state.projectSettings })

  const routes = []

  // Per-floor perimeter-graph cache for this build.
  const perimByFloor = new Map()
  const perimFor = (fid) => {
    if (!perimByFloor.has(fid)) perimByFloor.set(fid, getFloorWallPerimeterGraph(state, fid))
    return perimByFloor.get(fid)
  }

  let routeSeq = 0
  const mintRouteId = (eid) => `route_${eid}_${String(routeSeq++).padStart(4, '0')}`

  // Sort edge ids for stable emission.
  const edgeIds = Object.keys(sized.edges).sort()
  for (const eid of edgeIds) {
    const e = sized.edges[eid]
    if (!e) continue
    const fromN = sized.nodes[e.fromNodeId]
    const toN   = sized.nodes[e.toNodeId]
    if (!fromN || !toN) continue

    // Both DETECTION and SPRINKLER route along CEILING. Use the from-node's
    // floor as the anchor; cross-floor detection loops are flattened to the
    // panel's floor in Phase 1 (the riser carries the vertical drop).
    const floorId = fromN.floorId ?? toN.floorId ?? DEFAULT_FLOOR_ID
    const perim   = perimFor(floorId)

    const polyline = _perimeterPolyline(perim, fromN.x, fromN.y, toN.x, toN.y)
    const baseZone = 'CEILING'
    const zonesPerSegment = new Array(Math.max(0, polyline.length - 1)).fill(baseZone)

    const lenFt    = polylineLengthFt(polyline)
    const zoneMult = getZone(baseZone)?.quantityMultiplier ?? 1
    const adjLenFt = lenFt * zoneMult

    const routeKind = SYSTEM_TO_ROUTE_KIND[e.systemId] ?? null
    if (!routeKind) continue   // EQUIPMENT system has no edges

    routes.push({
      id: mintRouteId(e.id),
      kind: routeKind,
      diameterMm: e.diameterMm ?? null,
      nominalMm:  e.nominalMm  ?? null,
      pipeOdIn:   e.pipeOdIn   ?? null,
      gaugeMm2:   e.gaugeMm2   ?? null,
      cableTypeId: e.cableTypeId ?? null,
      polyline,
      lengthFt: lenFt,
      adjustedLengthFt: adjLenFt,
      fromEntityId: fromN.entityId,
      toEntityId:   toN.entityId,
      systemId: e.systemId,
      branchId: e.branchId,
      circuitId: null,
      edgeId: e.id,
      floorId,
      zone: baseZone,
      zonesPerSegment,
    })
  }

  routes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  warnings.sort((a, b) =>
    a.ruleId === b.ruleId
      ? (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0)
      : a.ruleId < b.ruleId ? -1 : 1
  )

  return { routes, warnings }
}
