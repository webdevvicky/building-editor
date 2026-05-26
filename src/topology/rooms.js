// Topology — room polygon and room-set selectors.
//
// Pure helpers that walk a set of wall ids and produce a closed-loop node
// order, plus state-reading selectors that compute room polygons, areas,
// validity, and the canonical "valid room set" used to gate BOQ totals.
//
// State contract: every state-reading function accepts a `state` whose
// shape includes { rooms, walls, nodes } plus method-dispatch helpers
// (getWallArea, getRoomPolygon, etc.). This contract is honored by both
// the live Zustand store and the floor-scoped wrapper in boq/scope.js,
// so topology calls auto-scope when invoked via the scoped state.

import { GRID_IN, doRoomsOverlap } from '../geometry.js'
import { safeR2 as r2 } from '../lib/numbers.js'

const DEFAULT_FLOOR_ID = 'F1'

// ── Pure polygon helpers ────────────────────────────────────────────────────

// Walk a set of wallIds to discover the closed polygon's node order.
// Returns the node-id sequence (length === wallIds.length), or null if the
// walls don't form a closed loop. Stale wall references (an id not present
// in `walls`) cause an early null return rather than a partial polygon —
// callers must handle null.
export function walkPolygonNodeOrder(wallIds, walls) {
  const adj = {}
  for (const wid of wallIds) {
    const w = walls[wid]
    if (!w) return null
    if (!adj[w.n1]) adj[w.n1] = []
    if (!adj[w.n2]) adj[w.n2] = []
    adj[w.n1].push(w.n2)
    adj[w.n2].push(w.n1)
  }
  const nodeIds = Object.keys(adj)
  if (nodeIds.length < 3) return null
  let best = []
  for (const startId of nodeIds) {
    const p = [startId]
    let prev = null, current = startId
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const next = (adj[current] || []).find(n => n !== prev && !p.includes(n))
      if (!next) break
      p.push(next); prev = current; current = next
    }
    if (p.length > best.length) best = p
    if (best.length === nodeIds.length) break
  }
  const isClosed =
    best.length === nodeIds.length &&
    (adj[best[best.length - 1]] || []).includes(best[0])
  return isClosed ? best : null
}

// Walks every wall flagged isPlot and returns the world-coordinate vertex
// polygon (in node order), or null if plot walls don't close a loop.
// Plot polygon is floor-agnostic by design (site boundary is single).
export function buildPlotPolygon(walls, nodes) {
  const plotWalls = Object.values(walls).filter(w => w.isPlot)
  if (plotWalls.length < 3) return null
  const plotWallIds = plotWalls.map(w => w.id)
  const order = walkPolygonNodeOrder(plotWallIds, walls)
  if (!order) return null
  return order.map(id => nodes[id]).filter(Boolean)
}

// ── State-reading selectors ─────────────────────────────────────────────────

// Returns the room polygon as a vertex array {x,y}[] in node order, or null
// if the room is malformed (missing walls, doesn't close).
export function getRoomPolygon(state, roomId) {
  const room = state.rooms[roomId]
  if (!room || room.wallIds.length < 3) return null
  const nodeOrder = walkPolygonNodeOrder(room.wallIds, state.walls)
  if (!nodeOrder) return null
  return nodeOrder.map(id => state.nodes[id]).filter(Boolean)
}

// Returns room floor area in ft². Uses shoelace on the walked polygon.
export function getRoomArea(state, roomId) {
  const room = state.rooms[roomId]
  if (!room || room.wallIds.length < 2) return 0
  const nodeOrder = walkPolygonNodeOrder(room.wallIds, state.walls)
  if (!nodeOrder || nodeOrder.length < 3) return 0
  const pts = nodeOrder.map(id => state.nodes[id]).filter(Boolean)
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return r2(Math.abs(area) / 2 / (GRID_IN * GRID_IN))
}

// Sum of net wall area across a room's wallIds. Delegates to state.getWallArea
// (which honors virtual walls + openings). Note that the live store's
// getWallArea is independent of room identity, so this remains correct under
// the floor-scoped wrapper (which guards by roomIdSet).
export function getRoomWallArea(state, roomId) {
  const room = state.rooms[roomId]
  if (!room) return 0
  return r2(room.wallIds.reduce((t, wid) => t + state.getWallArea(wid), 0))
}

// Pure topology: walls exist + form a closed loop. No overlap check.
export function isRoomStructurallyValid(state, roomId) {
  const room = state.rooms[roomId]
  if (!room || room.wallIds.length < 3) return false
  return walkPolygonNodeOrder(room.wallIds, state.walls) !== null
}

// Returns name of first structurally-valid room on the SAME FLOOR that
// overlaps roomId, or null. Floor scope: rooms on different floors NEVER
// conflict (multi-storey buildings have overlapping footprints by design).
export function getOverlappingRoomName(state, roomId) {
  const subject = state.rooms[roomId]
  if (!subject) return null
  const polyA = getRoomPolygon(state, roomId)
  if (!polyA) return null
  const subjectFloorId = subject.floorId ?? DEFAULT_FLOOR_ID
  for (const [otherId, room] of Object.entries(state.rooms)) {
    if (otherId === roomId) continue
    if ((room.floorId ?? DEFAULT_FLOOR_ID) !== subjectFloorId) continue
    if (!isRoomStructurallyValid(state, otherId)) continue
    const polyB = getRoomPolygon(state, otherId)
    if (!polyB) continue
    if (doRoomsOverlap(polyA, polyB)) return room.name
  }
  return null
}

export function hasRoomOverlap(state, roomId) {
  return getOverlappingRoomName(state, roomId) !== null
}

// Returns ids of structurally valid, non-overlapping rooms.
// All finish-gated totals and getTotalFloorArea filter THIS set — never raw
// Object.keys(state.rooms).
//
// Floor scope: overlap is a same-floor concept only. The pairwise loop only
// compares rooms on the same floorId. Both rooms in an overlapping pair are
// excluded (so neither double-counts in the BOQ).
export function getValidRoomIds(state) {
  const rooms = state.rooms
  const structuralIds = Object.keys(rooms).filter(id => isRoomStructurallyValid(state, id))
  const polys = structuralIds.map(id => ({
    id,
    poly: getRoomPolygon(state, id),
    floorId: rooms[id].floorId ?? DEFAULT_FLOOR_ID,
  })).filter(r => r.poly)
  const overlapExcluded = new Set()
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      if (polys[i].floorId !== polys[j].floorId) continue
      if (doRoomsOverlap(polys[i].poly, polys[j].poly)) {
        if (import.meta.env?.DEV)
          // eslint-disable-next-line no-console
          console.warn(`[topology] Rooms "${rooms[polys[i].id].name}" and "${rooms[polys[j].id].name}" overlap on floor ${polys[i].floorId} — both excluded.`)
        overlapExcluded.add(polys[i].id)
        overlapExcluded.add(polys[j].id)
      }
    }
  }
  return polys.filter(r => !overlapExcluded.has(r.id)).map(r => r.id)
}

// Generic: sum getRoomArea over valid rooms where predicate(room) is true.
// Used by all finish-gated total selectors.
export function sumRoomAreas(state, predicate) {
  return r2(
    getValidRoomIds(state)
      .filter(id => predicate(state.rooms[id]))
      .reduce((t, id) => t + getRoomArea(state, id), 0)
  )
}

// ── Centroid + roof + shaft (MEP foundation) ────────────────────────────────

// Returns {x,y} centroid in world inches, or null if the room polygon is
// malformed. Used by every MEP discipline for auto-placement heuristics
// (DB seeding, fan placement, sprinkler coverage centering).
export function getRoomCentroid(state, roomId) {
  const poly = getRoomPolygon(state, roomId)
  if (!poly || poly.length === 0) return null
  let cx = 0, cy = 0
  for (const p of poly) { cx += p.x; cy += p.y }
  return { x: cx / poly.length, y: cy / poly.length }
}

// Union polygon of all valid rooms on the top floor — the roof footprint
// solar panel placement uses. Phase 1 returns the polygon of the largest
// room (single-room approximation); Phase 2.3 enhances with true polygon
// union when L-shaped roofs become routine.
export function getRoofPolygon(state, floorId) {
  if (!floorId) return null
  const validIds = getValidRoomIds(state).filter(
    id => (state.rooms[id]?.floorId ?? DEFAULT_FLOOR_ID) === floorId
  )
  if (validIds.length === 0) return null
  let bestPoly = null, bestArea = -1
  for (const id of validIds) {
    const poly = getRoomPolygon(state, id)
    if (!poly) continue
    const area = getRoomArea(state, id)
    if (area > bestArea) { bestArea = area; bestPoly = poly }
  }
  return bestPoly
}

// ── Polygon-derived geometric helpers (Rev 2 Correction 2) ─────────────────
//
// Perimeter and longest-edge MUST derive from getRoomPolygon edge loop,
// NEVER from summing wall.wallIds entity lengths. Walls are topology
// artifacts that change shape after splitWall (one wall becomes two,
// midpoint nodes get inserted on partition walls). Polygon perimeter
// is geometric truth — invariant under wall splitting.
//
// Consumers: skirting Rft, dado Sft, kitchen counter `longest_wall`
// mode, balcony handrail length. Any future cornice / facade / railing
// math also lands here.

// Sum of edge lengths around the room polygon, in feet.
// Returns 0 for malformed rooms (no polygon).
export function getRoomPerimeterFt(state, roomId) {
  const poly = getRoomPolygon(state, roomId)
  if (!poly || poly.length < 3) return 0
  let totalIn = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    totalIn += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return r2(totalIn / GRID_IN)
}

// Longest single polygon edge, in feet. Used by kitchen counter
// `defaultLengthMode: 'longest_wall'` to pick the dominant edge to
// place the counter against.
export function getLongestPolygonEdgeFt(state, roomId) {
  const poly = getRoomPolygon(state, roomId)
  if (!poly || poly.length < 3) return 0
  let bestIn = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const lenIn = Math.hypot(b.x - a.x, b.y - a.y)
    if (lenIn > bestIn) bestIn = lenIn
  }
  return r2(bestIn / GRID_IN)
}

// Returns polygons of all SHAFT rooms on a floor (rooms with type 'SHAFT' or
// room.isShaft truthy). Risers prefer to traverse these; validation checks
// that riser XY lies inside at least one shaft polygon.
export function getShaftPolygons(state, floorId) {
  const out = []
  for (const room of Object.values(state.rooms)) {
    if (floorId && (room.floorId ?? DEFAULT_FLOOR_ID) !== floorId) continue
    const isShaft = room.type === 'SHAFT' || room.isShaft === true
    if (!isShaft) continue
    const poly = getRoomPolygon(state, room.id)
    if (poly) out.push({ roomId: room.id, polygon: poly })
  }
  return out
}
