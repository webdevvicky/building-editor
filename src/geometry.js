// World coordinate system:
//   - Unit: inches (1 ft = 12 in)
//   - Origin: south-west (math convention, Y-up)
//   - Y-flip happens only at the SVG render boundary via w2s()

export const PX_PER_INCH          = 5 / 3   // 20px per foot — preserves original visual scale
export const GRID_IN               = 12      // snap grid = 1 foot
export const SNAP_IN               = 4       // zoom-invariant snap tolerance in inches
export const DEFAULT_WALL_HEIGHT_IN = 120    // 10 ft
export const DEFAULT_WALL_THICK_IN  = 9      // 0.75 ft = 9 in (full brick, Indian residential standard)

// Snap world inches to 1-foot grid
export function snapIn(inches) {
  return Math.round(inches / GRID_IN) * GRID_IN
}

// World inches (Y-up) → SVG pixels (Y-down)
export function w2s(worldX, worldY, pan, zoom) {
  return {
    x: pan.x + worldX * PX_PER_INCH * zoom,
    y: pan.y - worldY * PX_PER_INCH * zoom,
  }
}

// Screen pixels → world inches, no snap (raw).
// Snap math moved to src/snap/ — the unified resolver wraps this primitive
// and dispatches per-tool through SNAP_TARGETS + TOOL_SNAP_POLICY. Tools
// that need a snapped click call `resolveSnap` from `src/snap`; tools that
// need pixel accuracy (split, stamp drag, calibrate) call this directly.
// The previous `screenToWorld` (grid-snapped) helper has been removed —
// its job is now `resolveSnap(state, screenXY, ctx)` with `policy=[GRID]`.
export function screenToWorldRaw(clientX, clientY, svgRect, pan, zoom) {
  return {
    x:  (clientX - svgRect.left - pan.x) / zoom / PX_PER_INCH,
    y: -(clientY - svgRect.top  - pan.y) / zoom / PX_PER_INCH,
  }
}

// Signed area via shoelace (positive = CCW in Y-up math convention)
export function polygonSignedArea(pts) {
  let area = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return area / 2
}

// Ensure polygon winding; default CCW (positive area in Y-up convention)
export function normalizePolygonWinding(pts, targetCCW = true) {
  const isCCW = polygonSignedArea(pts) > 0
  return isCCW === targetCCW ? pts : [...pts].reverse()
}

// Point-in-polygon (ray-casting)
export function pointInPolygon(px, py, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y
    const xj = polygon[j].x, yj = polygon[j].y
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

// Check if point (px,py) lies on segment (ax,ay)–(bx,by), within SNAP_IN tolerance
export function isOnSegment(px, py, ax, ay, bx, by) {
  const cross = Math.abs((py - ay) * (bx - ax) - (px - ax) * (by - ay))
  const len   = Math.hypot(bx - ax, by - ay)
  if (len === 0) return false
  if (cross / len > SNAP_IN) return false
  return (
    px >= Math.min(ax, bx) - SNAP_IN && px <= Math.max(ax, bx) + SNAP_IN &&
    py >= Math.min(ay, by) - SNAP_IN && py <= Math.max(ay, by) + SNAP_IN
  )
}

// Detect collinear overlap between segments AB and CD
export function collinearOverlap(ax, ay, bx, by, cx, cy, dx, dy) {
  const lenAB = Math.hypot(bx - ax, by - ay)
  if (lenAB === 0) return false
  const crossC = Math.abs((cy - ay) * (bx - ax) - (cx - ax) * (by - ay))
  const crossD = Math.abs((dy - ay) * (bx - ax) - (dx - ax) * (by - ay))
  if (crossC / lenAB > SNAP_IN || crossD / lenAB > SNAP_IN) return false
  const tC = ((cx - ax) * (bx - ax) + (cy - ay) * (by - ay)) / (lenAB * lenAB)
  const tD = ((dx - ax) * (bx - ax) + (dy - ay) * (by - ay)) / (lenAB * lenAB)
  const lo = Math.max(0, Math.min(tC, tD))
  const hi = Math.min(1, Math.max(tC, tD))
  return hi - lo > 0.01
}

// Distance from world origin to closest point on segment, returns { x, y } in world inches
export function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return { x: ax, y: ay }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  return { x: snapIn(ax + t * dx), y: snapIn(ay + t * dy) }
}

// Find node near (x, y) within SNAP_IN tolerance
export function findNearbyNode(nodes, x, y) {
  return Object.values(nodes).find(
    n => Math.abs(n.x - x) < SNAP_IN && Math.abs(n.y - y) < SNAP_IN
  ) || null
}

// OVERLAP DEFINITION:
// Two rooms overlap iff one polygon's centroid lies inside the other.
//
// NOT overlap (allowed):
//   - Adjacent rooms sharing a wall (boundary contact)
//   - Rooms touching at a corner (point contact)
//
// IS overlap (blocked):
//   - Sub-room created inside parent room (the primary bug this fixes)
//   - One room fully contained inside another
//
// Centroid-only detection. Sufficient for axis-aligned rectangular rooms
// (current supported geometry). The centroid of a sub-room is always
// unambiguously inside the parent — boundary-point ambiguity doesn't apply.
//
// Vertex containment was removed: shared corner/edge nodes are exactly on
// the boundary of the neighbouring polygon, and pointInPolygon (ray-casting)
// returns true for some boundary points, producing false positives on
// adjacent rooms. Confirmed in testing (node at shared corner triggered it).
//
// Does NOT catch:
//   - L-shaped rooms whose centroids don't cross but edges intersect
//   - Diagonal/non-orthogonal layouts (future feature)
//   - Partial overlaps where neither centroid is inside the other
//
// Upgrade to full segment-intersection algorithm in Phase 2 when
// non-orthogonal walls and L-shaped rooms land.
export function doRoomsOverlap(polyA, polyB) {
  const cAx = polyA.reduce((s, p) => s + p.x, 0) / polyA.length
  const cAy = polyA.reduce((s, p) => s + p.y, 0) / polyA.length
  if (pointInPolygon(cAx, cAy, polyB)) return true

  const cBx = polyB.reduce((s, p) => s + p.x, 0) / polyB.length
  const cBy = polyB.reduce((s, p) => s + p.y, 0) / polyB.length
  if (pointInPolygon(cBx, cBy, polyA)) return true

  return false
}
