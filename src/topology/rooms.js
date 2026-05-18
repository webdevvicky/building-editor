// Topology — room polygon math.
//
// Pure helpers that walk a set of wall ids and produce a closed-loop node
// order. Used by every selector that needs "the polygon of room R" or the
// "site boundary polygon."

// Walk a set of wallIds to discover the closed polygon's node order.
// Returns the node-id sequence (length === wallIds.length), or null if the
// walls don't form a closed loop.
//
// Stale wall references (an id not present in `walls`) cause an early null
// return rather than a partial polygon — callers must handle null.
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
