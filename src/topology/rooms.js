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

import { GRID_IN, DEFAULT_WALL_THICK_IN, doRoomsOverlap } from '../geometry.js'
import { safeR2 as r2 } from '../lib/numbers.js'
import { createMemo } from './cache.js'

const DEFAULT_FLOOR_ID = 'F1'
const MITER_CAP_MULTIPLIER = 3   // Correction 3: cap = 3 × max(adjacentHalfThicknesses)

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
  if (!room) return null
  // Phase W — prefer room.nodeOrder (authoritative, T-junction-aware).
  let nodeOrder = (Array.isArray(room.nodeOrder) && room.nodeOrder.length >= 3)
    ? room.nodeOrder
    : null
  if (!nodeOrder) {
    if (!room.wallIds || room.wallIds.length < 3) return null
    nodeOrder = walkPolygonNodeOrder(room.wallIds, state.walls)
  }
  if (!nodeOrder) return null
  return nodeOrder.map(id => state.nodes[id]).filter(Boolean)
}

// Returns room floor area in ft². Uses shoelace on the walked polygon.
//
// Phase W — prefers room.nodeOrder (authoritative, T-junction-aware).
// Falls back to walkPolygonNodeOrder for legacy fixtures without nodeOrder.
export function getRoomArea(state, roomId) {
  const room = state.rooms[roomId]
  if (!room) return 0
  let nodeOrder = (Array.isArray(room.nodeOrder) && room.nodeOrder.length >= 3)
    ? room.nodeOrder
    : null
  if (!nodeOrder) {
    if (!room.wallIds || room.wallIds.length < 2) return 0
    nodeOrder = walkPolygonNodeOrder(room.wallIds, state.walls)
  }
  if (!nodeOrder || nodeOrder.length < 3) return 0
  const pts = nodeOrder.map(id => state.nodes[id]).filter(Boolean)
  if (pts.length < 3) return 0
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
// Phase W: prefers room.nodeOrder (authoritative). Falls back to
// walkPolygonNodeOrder for legacy fixtures without nodeOrder.
export function isRoomStructurallyValid(state, roomId) {
  const room = state.rooms[roomId]
  if (!room) return false
  if (Array.isArray(room.nodeOrder) && room.nodeOrder.length >= 3) {
    // Every nodeOrder entry must reference an existing node.
    for (const nid of room.nodeOrder) {
      if (!state.nodes?.[nid]) return false
    }
    return true
  }
  if (!room.wallIds || room.wallIds.length < 3) return false
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

// ── Dimension-mode kernel (Area 1 — Option C) ──────────────────────────────
//
// All clear-internal geometry routes through getRoomGeometry. The kernel
// computes an inset polygon by walking the room's centerline polygon edges
// and offsetting each edge inward by that wall's halfThickness.
//
// Correction 1 — primary primitive is EffectiveRoomEdge[] from
//   getRoomPolygonInsetEdges. Polygon point arrays derive from edges.
// Correction 2 — single source for canvas + BOQ + panels.
// Correction 3 — miter cap = 3 × max(adjacentHalfThicknesses) (deterministic).
// Correction 4 — collapsed polygon = zero-area edges with collapsed=true,
//   warnings populated. Never null.
// Correction 9 — getRoomGeometry(state, roomId, mode) is the single entry
//   point; all geometry consumers go through it.
//
// EffectiveRoomEdge shape:
//   {
//     wallId:           string,
//     a:                { x, y },         // inset polygon vertex (inches)
//     b:                { x, y },
//     lengthFt:         number,
//     insetDistanceIn:  number,           // half-thickness applied to this edge
//     sourceEdgeIndex:  number,           // 0..N-1 in node-order walk
//   }
//
// Centerline mode returns the same shape with insetDistanceIn=0 so consumers
// can use the same primitive regardless of mode (no per-mode branches).

function _polygonSignedAreaIn2(pts) {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return a / 2
}

function _halfThicknessForWall(wall) {
  if (!wall) return 0
  if (wall.isVirtual) return 0
  if (wall.isPlot)    return 0
  return (wall.thickness ?? DEFAULT_WALL_THICK_IN) / 2
}

// Intersect two infinite lines, each represented as point + direction.
// Returns the intersection point, or null if parallel.
function _intersectLines(p1, d1, p2, d2) {
  const denom = d1.x * d2.y - d1.y * d2.x
  if (Math.abs(denom) < 1e-9) return null
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denom
  return { x: p1.x + t * d1.x, y: p1.y + t * d1.y }
}

// Walks a room's centerline polygon and returns the wallId of each edge in
// node order. Returns null if the polygon doesn't close, a node is missing,
// or any edge can't be matched to a wallId.
function _walkEdgesWithWallIds(state, room) {
  const nodeOrder = walkPolygonNodeOrder(room.wallIds, state.walls)
  if (!nodeOrder || nodeOrder.length < 3) return null
  const pts = nodeOrder.map(id => state.nodes[id])
  if (pts.some(p => !p)) return null
  const N = nodeOrder.length
  const edgeWallIds = []
  for (let i = 0; i < N; i++) {
    const aId = nodeOrder[i]
    const bId = nodeOrder[(i + 1) % N]
    const wid = room.wallIds.find(id => {
      const w = state.walls[id]
      return w && ((w.n1 === aId && w.n2 === bId) || (w.n1 === bId && w.n2 === aId))
    })
    if (!wid) return null
    edgeWallIds.push(wid)
  }
  return { nodeOrder, pts, edgeWallIds, N }
}

function _computeInsetEdgesForRoom(state, room) {
  const walked = _walkEdgesWithWallIds(state, room)
  if (!walked) return null
  const { pts, edgeWallIds, N } = walked

  // Winding determines inward perpendicular direction.
  // Y-up math convention: CCW (positive signed area) → inward = rotate +90°
  //   (i.e. (dx, dy) → (-dy, dx)).
  // CW → inward = rotate -90° → (dy, -dx).
  const signedArea = _polygonSignedAreaIn2(pts)
  const isCCW = signedArea > 0

  // Per-edge geometry: direction unit vector + inward perp + halfThickness +
  // offset-line origin (a vertex translated by inward * halfThickness).
  const edgeGeom = []
  for (let i = 0; i < N; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % N]
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len === 0) {
      // Degenerate edge — keep the slot so per-corner indexing stays correct.
      edgeGeom.push(null)
      continue
    }
    const dux = dx / len, duy = dy / len
    const inX = isCCW ? -duy :  duy
    const inY = isCCW ?  dux : -dux
    const wall = state.walls[edgeWallIds[i]]
    const halfIn = _halfThicknessForWall(wall)
    edgeGeom.push({
      a, b,
      dir:           { x: dux, y: duy },
      inward:        { x: inX, y: inY },
      halfIn,
      offsetOrigin:  { x: a.x + inX * halfIn, y: a.y + inY * halfIn },
    })
  }

  // Compute new vertex i = intersection of offset(edge i-1) with offset(edge i).
  const newVerts = new Array(N)
  const warnings = []
  for (let i = 0; i < N; i++) {
    const prev = edgeGeom[(i - 1 + N) % N]
    const cur  = edgeGeom[i]
    if (!prev || !cur) { newVerts[i] = pts[i]; continue }
    const intersection = _intersectLines(prev.offsetOrigin, prev.dir, cur.offsetOrigin, cur.dir)
    if (intersection === null) {
      // Parallel offset lines — collinear consecutive edges (post-splitWall).
      // Shift the shared vertex by max(half) along the (shared) inward perp.
      const maxHalf = Math.max(prev.halfIn, cur.halfIn)
      newVerts[i] = {
        x: pts[i].x + cur.inward.x * maxHalf,
        y: pts[i].y + cur.inward.y * maxHalf,
      }
      continue
    }
    // Miter cap (Correction 3): cap = 3 × max(adjacentHalfThicknesses).
    const maxHalf = Math.max(prev.halfIn, cur.halfIn)
    const capIn = MITER_CAP_MULTIPLIER * maxHalf
    if (capIn > 0) {
      const orig = pts[i]
      const dxC = intersection.x - orig.x, dyC = intersection.y - orig.y
      const dist = Math.hypot(dxC, dyC)
      if (dist > capIn) {
        const k = capIn / dist
        newVerts[i] = { x: orig.x + dxC * k, y: orig.y + dyC * k }
        warnings.push({
          code: 'MITER_CAPPED',
          cornerIndex: i,
          originalDistanceIn: r2(dist),
          cappedDistanceIn:   r2(capIn),
        })
        continue
      }
    }
    newVerts[i] = intersection
  }

  // Build the EffectiveRoomEdge[] from new vertices, preserving wallId map.
  const edges = []
  for (let i = 0; i < N; i++) {
    const a = newVerts[i]
    const b = newVerts[(i + 1) % N]
    const lenIn = Math.hypot(b.x - a.x, b.y - a.y)
    const halfIn = edgeGeom[i]?.halfIn ?? 0
    edges.push({
      wallId:          edgeWallIds[i],
      a:               { x: a.x, y: a.y },
      b:               { x: b.x, y: b.y },
      lengthFt:        r2(lenIn / GRID_IN),
      insetDistanceIn: r2(halfIn),
      sourceEdgeIndex: i,
    })
  }

  // Collapse detection: winding flipped OR new area near zero.
  // Threshold: 1 in² is well below any real room.
  const newArea = _polygonSignedAreaIn2(newVerts)
  const flipped = Math.sign(newArea) !== Math.sign(signedArea) && signedArea !== 0
  const tiny    = Math.abs(newArea) < 1
  const collapsed = flipped || tiny
  if (collapsed) {
    warnings.push({
      code: 'INSET_COLLAPSED',
      originalAreaIn2: r2(signedArea),
      insetAreaIn2:    r2(newArea),
    })
  }

  // Attach hidden metadata on the returned array so consumers can read
  // collapsed/warnings without changing the EffectiveRoomEdge[] return type
  // (Correction 1).
  Object.defineProperty(edges, '_collapsed',     { value: collapsed,        enumerable: false })
  Object.defineProperty(edges, '_warnings',      { value: warnings,         enumerable: false })
  Object.defineProperty(edges, '_signedAreaIn2', { value: newArea,          enumerable: false })
  return edges
}

// Memoized: keyed on (rooms, walls, nodes, projectSettings) refs.
// Recomputes every room's inset edges as one batch — typical project has
// 5-30 rooms, sub-millisecond cost.
const _insetEdgesMemo = createMemo()

function _buildAllInsetEdges(state) {
  const m = new Map()
  for (const [rid, room] of Object.entries(state.rooms)) {
    m.set(rid, _computeInsetEdgesForRoom(state, room))
  }
  return m
}

// PUBLIC: get the inset edges for a room as EffectiveRoomEdge[].
// - Returns null for structurally malformed rooms (no closed polygon).
// - For collapsed rooms returns the (degenerate) edges with hidden
//   _collapsed=true (Correction 4).
export function getRoomPolygonInsetEdges(state, roomId) {
  if (!state?.rooms?.[roomId]) return null
  const map = _insetEdgesMemo(
    [state.rooms, state.walls, state.nodes, state.projectSettings],
    () => _buildAllInsetEdges(state)
  )
  return map.get(roomId) ?? null
}

// Resolve dimension mode from projectSettings. Default 'centerline' for
// legacy projects with no field set; new projects opt in via 'clear_internal'.
export function resolveDimensionMode(state) {
  return state?.projectSettings?.dimensionMode ?? 'centerline'
}

// Build a centerline-mode "edges" view with insetDistanceIn=0 so consumers
// see the same EffectiveRoomEdge[] shape regardless of mode.
function _centerlineEdges(state, roomId) {
  const room = state.rooms[roomId]
  if (!room) return null
  const walked = _walkEdgesWithWallIds(state, room)
  if (!walked) return null
  const { pts, edgeWallIds, N } = walked
  const edges = []
  for (let i = 0; i < N; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % N]
    const lenIn = Math.hypot(b.x - a.x, b.y - a.y)
    edges.push({
      wallId:          edgeWallIds[i],
      a:               { x: a.x, y: a.y },
      b:               { x: b.x, y: b.y },
      lengthFt:        r2(lenIn / GRID_IN),
      insetDistanceIn: 0,
      sourceEdgeIndex: i,
    })
  }
  Object.defineProperty(edges, '_collapsed', { value: false, enumerable: false })
  Object.defineProperty(edges, '_warnings',  { value: [],    enumerable: false })
  return edges
}

// PUBLIC: per-wall effective length for canvas labels (Correction 2).
// Routes through getRoomPolygonInsetEdges (the EffectiveRoomEdge primitive
// — Correction 1) rather than doing centerlineLen − halfThickness math,
// which is inaccurate at non-orthogonal angles.
//
// For walls bound to a room, returns the matching edge's lengthFt (so a
// partition's effective length matches both rooms' inner-face length, and
// an external wall's effective length matches the owning room's inner face).
//
// For unbound walls (plot, virtual, free-standing), returns centerline.
export function getEffectiveWallLengthFt(state, wallId, mode = null) {
  const resolvedMode = mode ?? resolveDimensionMode(state)
  if (resolvedMode === 'centerline') {
    return state.getWallLength?.(wallId) ?? _bareCenterlineLengthFt(state, wallId)
  }
  for (const room of Object.values(state.rooms ?? {})) {
    if (!room.wallIds?.includes(wallId)) continue
    const edges = getRoomPolygonInsetEdges(state, room.id)
    if (!edges) continue
    const edge = edges.find(e => e.wallId === wallId)
    if (edge) return edge.lengthFt
  }
  return state.getWallLength?.(wallId) ?? _bareCenterlineLengthFt(state, wallId)
}

function _bareCenterlineLengthFt(state, wallId) {
  const wall = state.walls?.[wallId]
  if (!wall) return 0
  const a = state.nodes?.[wall.n1], b = state.nodes?.[wall.n2]
  if (!a || !b) return 0
  return r2(Math.hypot(b.x - a.x, b.y - a.y) / GRID_IN)
}

// PUBLIC entry point — Correction 9. Every geometry consumer goes through here.
// Returns:
//   {
//     mode:        'centerline' | 'clear_internal',
//     polygon:     {x,y}[]                  — derived from insetEdges (Correction 1)
//     insetEdges:  EffectiveRoomEdge[],
//     area:        number ft²,
//     perimeter:   number ft,
//     longestWall: number ft,
//     collapsed:   boolean,
//     warnings:    [{code, ...}],
//   }
// Returns null only for structurally malformed rooms (matches getRoomPolygon).
export function getRoomGeometry(state, roomId, mode = null) {
  const resolvedMode = mode ?? resolveDimensionMode(state)
  if (resolvedMode === 'clear_internal') {
    const edges = getRoomPolygonInsetEdges(state, roomId)
    if (!edges) return null
    const polygon = edges.map(e => ({ x: e.a.x, y: e.a.y }))
    const perimeter = edges.reduce((s, e) => s + e.lengthFt, 0)
    const longestWall = edges.reduce((m, e) => Math.max(m, e.lengthFt), 0)
    const collapsed = edges._collapsed === true
    const area = collapsed
      ? 0
      : r2(Math.abs(edges._signedAreaIn2 ?? 0) / (GRID_IN * GRID_IN))
    return {
      mode: 'clear_internal',
      polygon,
      insetEdges: edges,
      area,
      perimeter: r2(perimeter),
      longestWall: r2(longestWall),
      collapsed,
      warnings: edges._warnings ?? [],
    }
  }
  // Centerline mode.
  const polygon = getRoomPolygon(state, roomId)
  if (!polygon) return null
  const insetEdges = _centerlineEdges(state, roomId) ?? []
  return {
    mode: 'centerline',
    polygon,
    insetEdges,
    area:        getRoomArea(state, roomId),
    perimeter:   getRoomPerimeterFt(state, roomId),
    longestWall: getLongestPolygonEdgeFt(state, roomId),
    collapsed:   false,
    warnings:    [],
  }
}
