// HVAC route builder.
//
// Turns refrigerant + condensate edges into wall-perimeter polylines with
// zone classification, lengths, and validation warnings.
//
// Pure: returns { routes, warnings }; never mutates the graph or state.
//
// Per-edge algorithm:
//
//   REFRIGERANT (gas + liquid):
//     - Indoor unit (inside floor) → wall-perimeter graph → external wall
//       exit point → outdoor unit. Zone: WALL inside the building,
//       EXTERNAL once the route crosses the building envelope. The
//       external-exit point is the perimeter-graph node nearest the
//       outdoor unit on an external-accessible wall (door / external).
//
//   CONDENSATE:
//     - Indoor unit → nearest external wall (drainage exit). Zone:
//       CEILING for the indoor portion (gravity drain through false
//       ceiling), then EXTERNAL once at the wall penetration.
//
// DUCTED_AC routing (DUCTED_AC_INDOOR ↔ DUCTED_AC_OUTDOOR refrigerant
// paths) is stub-only in Phase 1: per CLAUDE.md MEP plan §13.4, duct
// network shapes are schema-only this phase. Refrigerant lines for
// ducted units still route normally (treated as long split-AC lines).

import {
  getFloorWallPerimeterGraph,
  getExternalAccessibleWalls,
  getNearestWallToPoint,
  getWallIdsOnFloor,
} from '../../topology/index.js'
import { walkWallPerimeter, polylineLengthFt } from '../shared/geometry.js'
import { getZone } from '../shared/routingZones.js'
import { sizeHvacBranches } from './sizing.js'

const DEFAULT_FLOOR_ID = 'F1'

// Per-edge-kind route-kind labels.
const REFRIGERANT_KIND_TO_ROUTE_KIND = Object.freeze({
  LIQUID: 'REFRIGERANT_LIQUID',
  GAS:    'REFRIGERANT_GAS',
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

// Resolve the external-wall exit point on a given floor that is closest
// to a reference point (typically the outdoor unit for refrigerant; the
// indoor unit for condensate). External-accessible walls (door-bearing)
// are preferred; fall back to any wall on the floor.
function _findExternalExitPoint(state, floorId, refPoint) {
  const externalAccessible = getExternalAccessibleWalls(state, floorId)
  let candidateIds
  if (externalAccessible.length > 0) {
    candidateIds = new Set(externalAccessible.map(w => w.id))
  } else {
    candidateIds = getWallIdsOnFloor(state, floorId)
  }
  if (!candidateIds || (candidateIds instanceof Set && candidateIds.size === 0)) {
    return null
  }
  return getNearestWallToPoint(state, refPoint, candidateIds)
}

// Walk a perimeter path between two world-space points, returning a polyline.
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

// Compute per-segment zone array for a polyline that splits at the
// external-exit point. `exitIdx` is the polyline index AT the exit; all
// segments BEFORE that index use the interior zone, all AFTER use
// EXTERNAL. If exitIdx is null/0, all segments use baseZone.
function _zonesPerSegmentWithExit(polyline, baseZone, exitIdx) {
  const segCount = Math.max(0, polyline.length - 1)
  if (!exitIdx || exitIdx <= 0) return new Array(segCount).fill(baseZone)
  const zones = new Array(segCount)
  for (let i = 0; i < segCount; i++) {
    zones[i] = i < exitIdx ? baseZone : 'EXTERNAL'
  }
  return zones
}

// Find polyline index that's closest to the exit world-point. Used to mark
// the WALL → EXTERNAL zone transition. Linear scan; segCounts are tiny.
function _findIndexNearestPoint(polyline, x, y) {
  if (!polyline || polyline.length === 0) return null
  let bestIdx = 0, bestD = Infinity
  for (let i = 0; i < polyline.length; i++) {
    const d = Math.hypot(polyline[i].x - x, polyline[i].y - y)
    if (d < bestD) { bestD = d; bestIdx = i }
  }
  return bestIdx
}

export function buildHvacRoutes(graph, state) {
  const warnings = []
  if (!graph || !graph.edges || !state) return { routes: [], warnings }

  const sized = sizeHvacBranches(graph, { state, projectSettings: state.projectSettings })

  const routes = []

  // Per-floor perimeter-graph cache for the lifetime of this build.
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

    if (e.systemId === 'REFRIGERANT') {
      // Indoor node is the floor anchor; outdoor node is the destination.
      const indoorNode  = fromN.kind === 'UNIT_INDOOR'  ? fromN : toN
      const outdoorNode = fromN.kind === 'UNIT_OUTDOOR' ? fromN : toN
      const floorId = indoorNode.floorId ?? DEFAULT_FLOOR_ID
      const perim   = perimFor(floorId)

      // Exit point — external wall closest to the outdoor unit on the
      // indoor unit's floor. (Refrigerant lines exit the indoor floor
      // through an external wall; if the outdoor unit is on a different
      // floor, a riser entity provides the vertical drop downstream.)
      const exit = _findExternalExitPoint(state, floorId, { x: outdoorNode.x, y: outdoorNode.y })
      let polyline
      let zonesPerSegment
      if (exit) {
        // Two-segment path: indoor → exit (along perimeter, WALL zone),
        // exit → outdoor (straight, EXTERNAL zone).
        const interior = _perimeterPolyline(
          perim, indoorNode.x, indoorNode.y, exit.projected.x, exit.projected.y,
        )
        // Append outdoor point only when it's not coincident with the exit.
        const exitIdx = interior.length - 1
        const tail = (Math.hypot(outdoorNode.x - exit.projected.x, outdoorNode.y - exit.projected.y) > 1)
          ? [{ x: outdoorNode.x, y: outdoorNode.y }]
          : []
        polyline = [...interior, ...tail]
        const transitionIdx = tail.length > 0 ? exitIdx : null
        zonesPerSegment = _zonesPerSegmentWithExit(polyline, 'WALL', transitionIdx ?? polyline.length - 1)
      } else {
        polyline = [
          { x: indoorNode.x,  y: indoorNode.y  },
          { x: outdoorNode.x, y: outdoorNode.y },
        ]
        zonesPerSegment = new Array(Math.max(0, polyline.length - 1)).fill('EXTERNAL')
      }

      // Adjusted length: per-segment zone multiplier.
      const lenFt = polylineLengthFt(polyline)
      let adjLenFt = 0
      for (let i = 1; i < polyline.length; i++) {
        const segIn = Math.hypot(polyline[i].x - polyline[i-1].x, polyline[i].y - polyline[i-1].y)
        const zoneId = zonesPerSegment[i - 1]
        adjLenFt += (segIn / 12) * (getZone(zoneId)?.quantityMultiplier ?? 1)
      }

      // Dominant zone for the route's top-level .zone field — EXTERNAL if
      // any segment is external (refrigerant lines spend most of their
      // length outside), else WALL.
      const dominantZone = zonesPerSegment.includes('EXTERNAL') ? 'EXTERNAL' : 'WALL'

      routes.push({
        id: mintRouteId(e.id),
        kind: REFRIGERANT_KIND_TO_ROUTE_KIND[e.kind] ?? 'REFRIGERANT_LIQUID',
        diameterMm: e.diameterMm ?? null,
        pipeOdIn:   e.pipeOdIn   ?? null,
        gaugeMm2:   null,
        polyline,
        lengthFt: lenFt,
        adjustedLengthFt: adjLenFt,
        fromEntityId: indoorNode.entityId,
        toEntityId:   outdoorNode.entityId,
        systemId: 'REFRIGERANT',
        branchId: e.branchId,
        circuitId: null,
        edgeId: e.id,
        floorId,
        zone: dominantZone,
        zonesPerSegment,
      })
      continue
    }

    if (e.systemId === 'CONDENSATE') {
      const indoorNode = fromN.kind === 'UNIT_INDOOR' ? fromN : toN
      const exitNode   = fromN.kind === 'EXIT'        ? fromN : toN
      const floorId = indoorNode.floorId ?? DEFAULT_FLOOR_ID
      const perim   = perimFor(floorId)

      // Resolve the EXIT node's real position via external wall nearest
      // the indoor unit (overrides the placeholder set in network.js).
      const exit = _findExternalExitPoint(state, floorId, { x: indoorNode.x, y: indoorNode.y })
      const exitX = exit?.projected.x ?? exitNode.x
      const exitY = exit?.projected.y ?? exitNode.y

      // Single-segment ceiling drop to the external wall.
      const polyline = _perimeterPolyline(perim, indoorNode.x, indoorNode.y, exitX, exitY)
      const zonesPerSegment = new Array(Math.max(0, polyline.length - 1)).fill('CEILING')
      // Final segment to the actual outside face: EXTERNAL — only if the
      // polyline ends right on the wall.
      if (zonesPerSegment.length > 0) {
        zonesPerSegment[zonesPerSegment.length - 1] = 'EXTERNAL'
      }

      const lenFt = polylineLengthFt(polyline)
      let adjLenFt = 0
      for (let i = 1; i < polyline.length; i++) {
        const segIn = Math.hypot(polyline[i].x - polyline[i-1].x, polyline[i].y - polyline[i-1].y)
        const zoneId = zonesPerSegment[i - 1]
        adjLenFt += (segIn / 12) * (getZone(zoneId)?.quantityMultiplier ?? 1)
      }

      routes.push({
        id: mintRouteId(e.id),
        kind: 'CONDENSATE',
        diameterMm: e.diameterMm ?? null,
        pipeOdIn:   null,
        gaugeMm2:   null,
        polyline,
        lengthFt: lenFt,
        adjustedLengthFt: adjLenFt,
        fromEntityId: indoorNode.entityId,
        toEntityId:   null,
        systemId: 'CONDENSATE',
        branchId: e.branchId,
        circuitId: null,
        edgeId: e.id,
        floorId,
        zone: 'CEILING',
        zonesPerSegment,
      })
      continue
    }

    // SPLIT_AC / VENTILATION sub-systems are point-only in Phase 1 — no
    // edges, no routes (covered by REFRIGERANT + CONDENSATE).
  }

  routes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  warnings.sort((a, b) =>
    a.ruleId === b.ruleId
      ? (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0)
      : a.ruleId < b.ruleId ? -1 : 1
  )

  return { routes, warnings }
}
