// Topology — planar-graph face enumeration.
//
// PHASE R1 (interactive). Auto-suggest (`_save()` hooks, toast UI) is Phase R2
// and not implemented here.
//
// ALGORITHM — planar face enumeration via next-CCW-edge traversal
// (rotational system; standard combinatorial-embedding technique).
//
//   For each node N, sort the incident edges by angle CCW around N. This
//   gives each node a cyclic ordering of its neighbors.
//
//   For each directed edge (a → b):
//     Define `nextEdgeInFace(a → b)`:
//       1. At node b, locate the angle of the REVERSE edge (b → a) in
//          b's sorted neighbor list.
//       2. The "next CCW edge" is the entry IMMEDIATELY PRECEDING
//          (b → a)'s entry in the CCW-sorted list (wrapping at index 0).
//       3. Return (b → that-neighbor).
//
//   Walking these `next` edges from any starting directed edge yields one
//   face. Each undirected edge participates in TWO directed walks (one
//   each direction) — so each wall is part of TWO faces. The "outer"
//   (infinite) face is traversed CW; interior faces traverse CCW. We
//   detect outer faces by signed-area sign and discard them.
//
// CANONICAL FACE SHAPE (per Phase R1 adjustment 5)
//   After walking, every face is normalized:
//     - Rotate nodeOrder so the lexicographically-smallest nodeId is at
//       index 0.
//     - CCW winding is guaranteed by the algorithm (outer faces filtered
//       out via negative signed area).
//     - wallIds derived from the rotated nodeOrder; also exposed
//       SORTED ASCENDING for Set comparison via wallIds (canonical).
//   Equivalent faces serialize identically — memo cell stable, set
//   comparisons reliable.
//
// DEGENERATE REJECTION (per Phase R1 adjustment 6)
//   Reject any face with:
//     - `Math.abs(signedAreaFt2) < 0.5` (sliver / spurious snap loop).
//     - `nodeOrder` containing duplicate node ids (self-touching).
//
// HOVER CACHE (per Phase R1 adjustment 8)
//   `findFaceContainingEdge` runs at potentially 60Hz while the
//   `room_detect` tool is active. A per-floor `Map<wallId:directedKey,
//   face>` cache eliminates per-frame face-table walks. The cache lives
//   ALONGSIDE the per-floor face-table cell and is invalidated TOGETHER
//   with it. Invalidation rule (same as snap-architecture refinement
//   pattern): when `state.walls` or `state.nodes` reference changes,
//   `enumerateFloorFaces` recomputes; the hover cache is cleared in the
//   same call so no stale (wallId, side) pairs survive.
//
// PURITY
//   Pure & Node-testable. No React, no DOM, no Zustand dispatches.
//   Mirrors the snap module's discipline; verify-room-detection.mjs
//   bootstrap grep-checks for forbidden imports.

import { getFloorWallPerimeterGraph } from './adjacency.js'

const DEFAULT_FLOOR_ID = 'F1'

// Per-floor face-table cell. Map<floorId, { graphRef, faces, byEdgeSide, hoverCache }>.
// byEdgeSide maps `${wallId}:${fromNodeId}→${toNodeId}` → face (the face on
// the LEFT of the directed edge a→b). Two entries per wall — one each side.
// hoverCache holds resolved findFaceContainingEdge results keyed the same way.
const _faceCells = new Map()

// ── Pure helpers ────────────────────────────────────────────────────────

function _angleFromTo(fromNode, toNode) {
  return Math.atan2(toNode.y - fromNode.y, toNode.x - fromNode.x)
}

function _signedAreaFt2(polygon) {
  let a = 0
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length
    a += polygon[i].x * polygon[j].y - polygon[j].x * polygon[i].y
  }
  return a / 2 / 144   // in² → ft²
}

function _pointInPolygon(p, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y
    const xj = poly[j].x, yj = poly[j].y
    const intersect = ((yi > p.y) !== (yj > p.y))
      && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

// ── Core enumeration ────────────────────────────────────────────────────

function _enumerateUncached(state, graph) {
  const { nodes: gNodes, edges: gEdges, adjacency, floorId } = graph

  // Filter plot walls — they bound the site, not interior rooms. The
  // perimeter graph includes them (MEP routing needs them); face
  // enumeration excludes them by re-checking state.walls[wallId].isPlot.
  function isWallEligible(wallId) {
    const w = state.walls?.[wallId]
    if (!w) return false
    if (w.isPlot) return false
    return true
  }

  // Sort each node's neighbors by angle CCW.
  // Result: sortedNeighbors[nodeId] = [{ neighborId, wallId, angle }, ...]
  const sortedNeighbors = {}
  for (const nid of Object.keys(gNodes)) {
    const node = gNodes[nid]
    const entries = []
    for (const [otherNid, wallId] of Object.entries(adjacency[nid] ?? {})) {
      if (!isWallEligible(wallId)) continue
      const other = gNodes[otherNid]
      if (!other) continue
      entries.push({
        neighborId: otherNid,
        wallId,
        angle: _angleFromTo(node, other),
      })
    }
    // Stable tie-break on neighborId for determinism when two edges share
    // an angle (shouldn't happen given collinearOverlap checks in addWall,
    // but defensive).
    entries.sort((a, b) => {
      if (a.angle !== b.angle) return a.angle - b.angle
      return a.neighborId < b.neighborId ? -1 : a.neighborId > b.neighborId ? 1 : 0
    })
    sortedNeighbors[nid] = entries
  }

  // At node b, given incoming directed edge from a, find the next-CCW
  // edge leaving b for the face traversal.
  function nextEdge(a, b) {
    const list = sortedNeighbors[b]
    if (!list || list.length === 0) return null
    // Find the index of the entry pointing back to a (the reverse of incoming).
    const idx = list.findIndex(e => e.neighborId === a)
    if (idx === -1) return null
    // Predecessor in CCW order wraps to the end of the list.
    const prevIdx = (idx - 1 + list.length) % list.length
    const e = list[prevIdx]
    return { fromNodeId: b, toNodeId: e.neighborId, wallId: e.wallId }
  }

  const visited = new Set()
  const faces = []
  const safetyBound = Math.max(64, Object.keys(gEdges).length * 4 + 16)

  // Iterate eligible wallIds deterministically.
  const eligibleWallIds = Object.keys(gEdges).filter(isWallEligible).sort()

  for (const wallId of eligibleWallIds) {
    const edge = gEdges[wallId]
    const directions = [
      [edge.fromNodeId, edge.toNodeId],
      [edge.toNodeId,   edge.fromNodeId],
    ]
    for (const [startA, startB] of directions) {
      const key0 = `${startA}→${startB}`
      if (visited.has(key0)) continue

      const facePath = []   // node ids walked
      const faceWalls = []  // wallIds walked (parallel to facePath; wall from facePath[i] to facePath[(i+1)%n])
      let cur = { fromNodeId: startA, toNodeId: startB, wallId }
      let iter = 0
      let closed = false

      while (iter++ < safetyBound) {
        const k = `${cur.fromNodeId}→${cur.toNodeId}`
        if (visited.has(k) && (cur.fromNodeId !== startA || cur.toNodeId !== startB)) {
          // Walked into an already-visited directed edge that isn't our
          // start — face is degenerate / open. Discard.
          facePath.length = 0
          break
        }
        visited.add(k)
        facePath.push(cur.fromNodeId)
        faceWalls.push(cur.wallId)

        const next = nextEdge(cur.fromNodeId, cur.toNodeId)
        if (!next) { facePath.length = 0; break }
        if (next.fromNodeId === startA && next.toNodeId === startB) {
          closed = true
          break
        }
        cur = next
      }

      if (!closed || facePath.length < 3) continue

      // Degenerate: duplicate node ids (self-touching).
      const nodeSet = new Set(facePath)
      if (nodeSet.size !== facePath.length) continue

      // Compute polygon + signed area.
      const polygonRaw = facePath.map(nid => {
        const n = gNodes[nid]
        return { x: n.x, y: n.y }
      })
      const signedRaw = _signedAreaFt2(polygonRaw)

      // Outer face: traversed CW → negative signed area. Discard.
      if (signedRaw <= 0) continue

      // Degenerate: sliver / spurious snap loop.
      if (Math.abs(signedRaw) < 0.5) continue

      // Canonicalize: rotate so smallest nodeId is at index 0.
      let minIdx = 0
      for (let i = 1; i < facePath.length; i++) {
        if (facePath[i] < facePath[minIdx]) minIdx = i
      }
      const canonNodeOrder = [
        ...facePath.slice(minIdx),
        ...facePath.slice(0, minIdx),
      ]
      const canonWallsInOrder = [
        ...faceWalls.slice(minIdx),
        ...faceWalls.slice(0, minIdx),
      ]
      const canonPolygon = canonNodeOrder.map(nid => {
        const n = gNodes[nid]
        return Object.freeze({ x: n.x, y: n.y })
      })

      // Recompute signed area on canonical polygon for the frozen value.
      const signedCanon = _signedAreaFt2(canonPolygon)

      // Bounds + centroid + perimeter on the canonical polygon.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      let cx = 0, cy = 0, perimeterIn = 0
      for (let i = 0; i < canonPolygon.length; i++) {
        const p = canonPolygon[i]
        if (p.x < minX) minX = p.x
        if (p.x > maxX) maxX = p.x
        if (p.y < minY) minY = p.y
        if (p.y > maxY) maxY = p.y
        cx += p.x; cy += p.y
        const q = canonPolygon[(i + 1) % canonPolygon.length]
        perimeterIn += Math.hypot(q.x - p.x, q.y - p.y)
      }
      cx /= canonPolygon.length
      cy /= canonPolygon.length

      const canonWallIds = [...canonWallsInOrder].sort()

      faces.push(Object.freeze({
        wallIds:        Object.freeze(canonWallIds),         // sorted ascending — canonical Set key
        wallIdsInOrder: Object.freeze(canonWallsInOrder),    // walk order (parallel to nodeOrder)
        nodeOrder:      Object.freeze(canonNodeOrder),
        polygon:        Object.freeze(canonPolygon),
        signedAreaFt2:  signedCanon,
        perimeterFt:    perimeterIn / 12,
        centroid:       Object.freeze({ x: cx, y: cy }),
        bounds:         Object.freeze({ minX, minY, maxX, maxY }),
        floorId,
        isOuter:        false,
      }))
    }
  }

  // Deterministic sort: area desc, then first nodeId lex asc.
  faces.sort((a, b) => {
    if (a.signedAreaFt2 !== b.signedAreaFt2) return b.signedAreaFt2 - a.signedAreaFt2
    if (a.nodeOrder[0] < b.nodeOrder[0]) return -1
    if (a.nodeOrder[0] > b.nodeOrder[0]) return 1
    return 0
  })

  // Build byEdgeSide index: each directed edge along a face's walk maps
  // to that face. The face is on the LEFT of every directed edge in
  // its walk (CCW interior).
  const byEdgeSide = new Map()
  for (const face of faces) {
    for (let i = 0; i < face.nodeOrder.length; i++) {
      const fromN = face.nodeOrder[i]
      const toN   = face.nodeOrder[(i + 1) % face.nodeOrder.length]
      const wId   = face.wallIdsInOrder[i]
      byEdgeSide.set(`${wId}:${fromN}→${toN}`, face)
    }
  }

  return { faces, byEdgeSide }
}

// ── Public API ──────────────────────────────────────────────────────────

export function enumerateFloorFaces(state, floorId) {
  const fid = floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  const graph = getFloorWallPerimeterGraph(state, fid)
  const cell = _faceCells.get(fid)
  if (cell && cell.graphRef === graph) return cell.faces
  const { faces, byEdgeSide } = _enumerateUncached(state, graph)
  // Hover cache is invalidated TOGETHER with the face table — fresh Map.
  _faceCells.set(fid, {
    graphRef:   graph,
    faces,
    byEdgeSide,
    hoverCache: new Map(),
  })
  return faces
}

// Find the face on the side of `clickPoint` relative to `wallId`. Returns
// null if the wall is dangling (no enclosing face on the chosen side) OR
// the wall is ineligible (virtual / plot). Uses the per-floor hover cache.
export function findFaceContainingEdge(state, wallId, clickPoint) {
  const wall = state.walls?.[wallId]
  if (!wall || wall.isVirtual || wall.isPlot) return null
  const fid = wall.floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  enumerateFloorFaces(state, fid)   // ensure cache populated
  const cell = _faceCells.get(fid)
  if (!cell) return null

  const a = state.nodes?.[wall.n1]
  const b = state.nodes?.[wall.n2]
  if (!a || !b) return null

  // Determine click side via cross product against the 90° CCW perpendicular.
  // perp = (-dy, dx). side = perp · (P - midpoint).
  //   side > 0 → P on LEFT of (n1 → n2). Start traversal from (n1 → n2).
  //   side < 0 → P on RIGHT of (n1 → n2). Start traversal from (n2 → n1).
  const midX = (a.x + b.x) / 2
  const midY = (a.y + b.y) / 2
  const dx = b.x - a.x, dy = b.y - a.y
  const perpDx = -dy, perpDy = dx
  const toClickX = clickPoint.x - midX
  const toClickY = clickPoint.y - midY
  const side = perpDx * toClickX + perpDy * toClickY

  const key = side >= 0
    ? `${wallId}:${wall.n1}→${wall.n2}`
    : `${wallId}:${wall.n2}→${wall.n1}`

  if (cell.hoverCache.has(key)) return cell.hoverCache.get(key)
  const face = cell.byEdgeSide.get(key) ?? null
  cell.hoverCache.set(key, face)
  return face
}

// Find the smallest face containing the world point. Useful for tools
// that have a click point but no specific wall (e.g., future "click
// inside an area to detect room" mode). NOT used by Phase R1's
// room_detect tool — that one targets walls — but included for the
// topology API's completeness.
export function findFaceContainingPoint(state, floorId, worldXY) {
  const faces = enumerateFloorFaces(state, floorId)
  let best = null
  let bestArea = Infinity
  for (const face of faces) {
    if (_pointInPolygon(worldXY, face.polygon)) {
      if (face.signedAreaFt2 < bestArea) {
        bestArea = face.signedAreaFt2
        best = face
      }
    }
  }
  return best
}

// O(rooms-on-floor) check: returns roomId if a Room already exists with
// the EXACT same wall set as the face, else null. Comparison is
// order-agnostic (faces canonicalize wallIds sorted ascending; rooms
// store wallIds in walk order). We compare as Sets.
export function isFaceCoveredByRoom(state, faceWallIds) {
  const target = new Set(faceWallIds)
  for (const room of Object.values(state.rooms ?? {})) {
    if (!room.wallIds || room.wallIds.length !== target.size) continue
    let allMatch = true
    for (const wid of room.wallIds) {
      if (!target.has(wid)) { allMatch = false; break }
    }
    if (allMatch) return room.id
  }
  return null
}

// Faces on the given floor that no Room currently covers.
export function findUncoveredFaces(state, floorId) {
  const faces = enumerateFloorFaces(state, floorId)
  const out = []
  for (const face of faces) {
    if (isFaceCoveredByRoom(state, face.wallIds) === null) out.push(face)
  }
  return out
}

// Test seam — verify-room-detection.mjs uses this to reset between
// sections. Production code never calls this.
export function _resetFaceCaches() {
  _faceCells.clear()
}
