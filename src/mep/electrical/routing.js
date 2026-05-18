// Electrical route builder.
//
// For each circuit edge in the system graph, produce a polyline along the
// floor wall-perimeter that joins the DB (or per-room SWITCHBOARD) to the
// leaf point. Lighting + fan circuits get a synthetic SWITCHBOARD node in
// each room (mounted on the door-side wall at 4ft) — points in the same
// room are fed from the switchboard rather than direct from the DB.
//
// Deterministic everywhere:
//   - edge iteration order: sorted by edge id.
//   - within-room point order: (distFromDB, id).
//   - BFS along wall-perimeter graph uses deterministic neighbor sort
//     (provided by walkWallPerimeter in shared/geometry.js).
//
// Emits warnings for over-load circuits as `mep_db_load_exceeded`.
// Pure: never mutates the graph or state.

import {
  getFloorWallPerimeterGraph,
  getNearestWallToPoint,
  getWallIdsOnFloor,
  getRoomCentroid,
  getExternalAccessibleWalls,
} from '../../topology/index.js'
import { walkWallPerimeter, polylineLengthFt } from '../shared/geometry.js'
import { getZone } from '../shared/routingZones.js'
import { getWireGauge } from '../catalogs/wireGauges.js'
import { getCircuitPolicy } from './circuitGrouping.js'
import { sizeElectricalBranches } from './sizing.js'

const DEFAULT_FLOOR_ID = 'F1'

// Per-system zone selection.
const SYSTEM_TO_ZONE = Object.freeze({
  LIGHTING:   'CEILING',
  POWER_5A:   'WALL',
  POWER_15A:  'WALL',
  AC:         'WALL',
  GEYSER:     'WALL',
  EV:         'WALL',
  SUBMAIN:    'SHAFT',
  SOLAR_TIE:  'EXTERNAL',
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

// Walk a perimeter path and return a polyline [{x,y}, ...].
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

// Synthetic switchboard for a room: door-side external-accessible wall if
// available, else nearest wall to the room centroid. Returns
// { x, y, wallId, mountHeightFt } | null. mountHeightFt = 4 (switch height).
function _synthesizeSwitchboard(state, roomId, floorId) {
  const room = state.rooms?.[roomId]
  if (!room || !room.wallIds || room.wallIds.length === 0) return null
  const centroid = getRoomCentroid(state, roomId)
  if (!centroid) return null
  // Prefer walls that border this room AND have a door (door-side switch).
  const candidateIds = new Set()
  for (const wid of room.wallIds) {
    const w = state.walls?.[wid]
    if (!w) continue
    if ((w.openings ?? []).some(o => o.type === 'door')) candidateIds.add(wid)
  }
  if (candidateIds.size === 0) {
    // Fall back to any wall of the room.
    for (const wid of room.wallIds) candidateIds.add(wid)
  }
  const snap = getNearestWallToPoint(state, centroid, candidateIds)
  if (!snap) return null
  // Place at wall midpoint along the wall direction (snap projection),
  // but offset to actual wall surface — Phase 1 just uses the projection.
  return {
    x: snap.projected.x,
    y: snap.projected.y,
    wallId: snap.wallId,
    mountHeightFt: 4,
    roomId,
    floorId,
  }
}

export function buildElectricalRoutes(graph, state) {
  const warnings = []
  if (!graph || !graph.edges || !state) return { routes: [], warnings }

  const sized = sizeElectricalBranches(graph, { state, projectSettings: state.projectSettings })

  const routes = []

  // Per-floor perimeter-graph cache for this build.
  const perimByFloor = new Map()
  const perimFor = (fid) => {
    if (!perimByFloor.has(fid)) perimByFloor.set(fid, getFloorWallPerimeterGraph(state, fid))
    return perimByFloor.get(fid)
  }

  // Index edges by branch so we can install per-room switchboards for
  // LIGHTING branches before emitting their routes.
  const edgesByBranch = new Map()
  for (const e of Object.values(sized.edges)) {
    if (!edgesByBranch.has(e.branchId)) edgesByBranch.set(e.branchId, [])
    edgesByBranch.get(e.branchId).push(e)
  }

  // Per-branch processing — sorted by branch id for determinism.
  const branchIds = [...edgesByBranch.keys()].sort()

  let routeSeq = 0
  const mintRouteId = (eid) => `route_${eid}_${String(routeSeq++).padStart(4, '0')}`

  for (const branchId of branchIds) {
    const branchEdges = edgesByBranch.get(branchId)
    if (!branchEdges || branchEdges.length === 0) continue
    const sysId = branchEdges[0].systemId
    const branch = (sized.branches ?? []).find(b => b.id === branchId)
    const floorId = branch?.floorId ?? DEFAULT_FLOOR_ID
    const perim = perimFor(floorId)
    const baseZone = SYSTEM_TO_ZONE[sysId] ?? 'WALL'

    // Validate load cap.
    if (branch) {
      const policy = getCircuitPolicy(branch.circuitClass)
      if (policy && Number.isFinite(policy.loadCapW) && branch.loadW > policy.loadCapW) {
        warnings.push({
          ruleId:    'mep_db_load_exceeded',
          severity:  'warning',
          category:  'mep',
          entityType:'ELECTRICAL',
          entityId:  branchId,
          message:   `Circuit ${branch.circuitId ?? branchId} load ${Math.round(branch.loadW)}W exceeds cap ${policy.loadCapW}W`,
        })
      }
    }

    // For LIGHTING / FAN systems, group leaf edges by roomId so we can
    // route DB → switchboard → leaves. POWER + AC + GEYSER + EV: route
    // DB → point directly. SUBMAIN: TRUNK edges from main DB to floor DBs.
    const useSwitchboard = sysId === 'LIGHTING'

    if (useSwitchboard) {
      // Group leaf edges by the room of their leaf point.
      const byRoom = new Map()
      for (const e of branchEdges) {
        const toNode = sized.nodes[e.toNodeId]
        const rid = toNode?.roomId ?? '_'
        if (!byRoom.has(rid)) byRoom.set(rid, [])
        byRoom.get(rid).push(e)
      }
      // DB position — same for every leaf on this branch (root node).
      const dbNode = sized.nodes[branchEdges[0].fromNodeId]
      if (!dbNode) continue

      for (const rid of [...byRoom.keys()].sort()) {
        const roomEdges = byRoom.get(rid)
        // Switchboard per room (synthetic — no entity in store).
        const swb = rid !== '_' ? _synthesizeSwitchboard(state, rid, floorId) : null
        let feedX, feedY
        if (swb) {
          feedX = swb.x; feedY = swb.y
          // Emit a route from DB → switchboard (still CEILING zone — lighting homerun).
          const polylineDbToSwb = _perimeterPolyline(perim, dbNode.x, dbNode.y, swb.x, swb.y)
          const lenFtDbSwb = polylineLengthFt(polylineDbToSwb)
          const zoneMult = getZone(baseZone)?.quantityMultiplier ?? 1
          routes.push({
            id: mintRouteId(`${branchId}_swb_${rid}`),
            kind: 'WIRING',
            gaugeMm2: roomEdges[0].gaugeMm2,
            diameterMm: getWireGauge(roomEdges[0].gaugeMm2)?.conduitMm ?? null,
            polyline: polylineDbToSwb,
            lengthFt: lenFtDbSwb,
            adjustedLengthFt: lenFtDbSwb * zoneMult,
            fromEntityId: dbNode.entityId,
            toEntityId: null,           // synthetic switchboard, no store entity
            systemId: sysId,
            branchId,
            circuitId: roomEdges[0].circuitId ?? null,
            edgeId: null,
            floorId,
            zone: baseZone,
            zonesPerSegment: new Array(Math.max(0, polylineDbToSwb.length - 1)).fill(baseZone),
            switchboardRoomId: rid,
          })
        } else {
          feedX = dbNode.x; feedY = dbNode.y
        }

        // Sort leaves by (distFromFeed, id) for stable nearest-first chain.
        const orderedEdges = [...roomEdges].sort((a, b) => {
          const na = sized.nodes[a.toNodeId], nb = sized.nodes[b.toNodeId]
          if (!na || !nb) return a.id < b.id ? -1 : 1
          const da = Math.hypot(na.x - feedX, na.y - feedY)
          const db = Math.hypot(nb.x - feedX, nb.y - feedY)
          if (da !== db) return da - db
          return a.id < b.id ? -1 : 1
        })

        for (const e of orderedEdges) {
          const toNode = sized.nodes[e.toNodeId]
          if (!toNode) continue
          const polyline = _perimeterPolyline(perim, feedX, feedY, toNode.x, toNode.y)
          const lenFt = polylineLengthFt(polyline)
          const zoneMult = getZone(baseZone)?.quantityMultiplier ?? 1
          routes.push({
            id: mintRouteId(e.id),
            kind: 'WIRING',
            gaugeMm2: e.gaugeMm2,
            diameterMm: getWireGauge(e.gaugeMm2)?.conduitMm ?? null,
            polyline,
            lengthFt: lenFt,
            adjustedLengthFt: lenFt * zoneMult,
            fromEntityId: swb ? null : dbNode.entityId,
            toEntityId: toNode.entityId ?? null,
            systemId: sysId,
            branchId,
            circuitId: e.circuitId ?? null,
            edgeId: e.id,
            floorId,
            zone: baseZone,
            zonesPerSegment: new Array(Math.max(0, polyline.length - 1)).fill(baseZone),
          })
        }
      }
      continue
    }

    // SUBMAIN: cross-floor TRUNK. Route through external wall on each
    // floor (shaft proxy in Phase 1 — risers create the vertical drop).
    if (sysId === 'SUBMAIN') {
      const dbNode = sized.nodes[branchEdges[0].fromNodeId]
      if (!dbNode) continue
      for (const e of [...branchEdges].sort((a, b) => a.id < b.id ? -1 : 1)) {
        const toNode = sized.nodes[e.toNodeId]
        if (!toNode) continue
        // Phase 1: straight-line; physical riser entities provide the
        // vertical drop. polylineLengthFt() handles the horizontal portion.
        const polyline = [
          { x: dbNode.x, y: dbNode.y },
          { x: toNode.x, y: toNode.y },
        ]
        const lenFt = polylineLengthFt(polyline)
        const zoneMult = getZone(baseZone)?.quantityMultiplier ?? 1
        routes.push({
          id: mintRouteId(e.id),
          kind: 'WIRING',
          gaugeMm2: e.gaugeMm2,
          diameterMm: getWireGauge(e.gaugeMm2)?.conduitMm ?? null,
          polyline,
          lengthFt: lenFt,
          adjustedLengthFt: lenFt * zoneMult,
          fromEntityId: dbNode.entityId,
          toEntityId: toNode.entityId ?? null,
          systemId: sysId,
          branchId,
          circuitId: e.circuitId ?? null,
          edgeId: e.id,
          floorId,
          zone: baseZone,
          zonesPerSegment: new Array(Math.max(0, polyline.length - 1)).fill(baseZone),
        })
      }
      continue
    }

    // POWER / AC / GEYSER / EV — direct DB → point in nearest-first order.
    const dbNode = sized.nodes[branchEdges[0].fromNodeId]
    if (!dbNode) continue
    const orderedEdges = [...branchEdges].sort((a, b) => {
      const na = sized.nodes[a.toNodeId], nb = sized.nodes[b.toNodeId]
      if (!na || !nb) return a.id < b.id ? -1 : 1
      const ra = na.roomId ?? '', rb = nb.roomId ?? ''
      if (ra !== rb) return ra < rb ? -1 : 1
      const da = Math.hypot(na.x - dbNode.x, na.y - dbNode.y)
      const db = Math.hypot(nb.x - dbNode.x, nb.y - dbNode.y)
      if (da !== db) return da - db
      return a.id < b.id ? -1 : 1
    })

    for (const e of orderedEdges) {
      const toNode = sized.nodes[e.toNodeId]
      if (!toNode) continue
      const polyline = _perimeterPolyline(perim, dbNode.x, dbNode.y, toNode.x, toNode.y)
      const lenFt = polylineLengthFt(polyline)
      const zoneMult = getZone(baseZone)?.quantityMultiplier ?? 1
      routes.push({
        id: mintRouteId(e.id),
        kind: 'WIRING',
        gaugeMm2: e.gaugeMm2,
        diameterMm: getWireGauge(e.gaugeMm2)?.conduitMm ?? null,
        polyline,
        lengthFt: lenFt,
        adjustedLengthFt: lenFt * zoneMult,
        fromEntityId: dbNode.entityId,
        toEntityId: toNode.entityId ?? null,
        systemId: sysId,
        branchId,
        circuitId: e.circuitId ?? null,
        edgeId: e.id,
        floorId,
        zone: baseZone,
        zonesPerSegment: new Array(Math.max(0, polyline.length - 1)).fill(baseZone),
      })
    }
  }

  routes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  warnings.sort((a, b) =>
    a.ruleId === b.ruleId
      ? (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0)
      : a.ruleId < b.ruleId ? -1 : 1
  )
  // Reference candidate wall sets so unused-import linters don't trip — these
  // are used by suggestions.js / dbPlacement.js but re-exported here for
  // discipline-internal helpers that might want them.
  void getWallIdsOnFloor
  void getExternalAccessibleWalls
  return { routes, warnings }
}
