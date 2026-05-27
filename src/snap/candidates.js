// Snap candidates — spatial-index seam.
//
// Targets call findCandidates / findNearestCandidate; they NEVER iterate
// state.nodes or state.walls directly. The initial implementation is an
// O(N) linear scan over the relevant state slice — same complexity as the
// old findNearbyNode. A future spatial index (R-tree / grid hash) plugs in
// here without changes to any target implementation.
//
// CONTRACT
//   findCandidates(state, type, x, y, radiusIn) → entity[]
//     Returns every entity of `type` whose snap point is within radiusIn
//     inches of (x, y). Distance is Euclidean. Returned in deterministic
//     order: ascending by distance, then ascending by stable identifier.
//
//   findNearestCandidate(state, type, x, y) →
//     { entity, point, distanceIn, sortKey } | null
//     Returns the single closest candidate of `type` regardless of radius.
//     The shape includes `sortKey` (a string) to feed the resolver's
//     deterministic tie-break.
//
// `type` values understood today:
//   'node'          — graph nodes on the current floor
//   'wallEndpoint'  — wall n1/n2 endpoints on the current floor
//   'wallMidpoint'  — midpoint of each wall on the current floor
//   'wallSegment'   — closest point on each wall segment on the current floor
//
// PURITY
//   Module is pure & Node-testable: no React, no DOM, no Zustand
//   dispatches. State is read-only.

const _EMPTY = Object.freeze([])

// Determine which floor the consumer is asking about. State may be the
// floor-scoped wrapper from boq/scope.js (which exposes currentFloorId) or
// the raw store. Fall back to the legacy single floor when absent.
function _currentFloorId(state) {
  return state?.currentFloorId
    ?? state?.projectSettings?.floors?.[0]?.id
    ?? 'F1'
}

function _nodeOnFloor(node, floorId) {
  const fids = node?.floorIds
  if (!Array.isArray(fids) || fids.length === 0) return true   // legacy
  return fids.includes(floorId)
}

function _floorWalls(state) {
  const fid = _currentFloorId(state)
  const walls = state?.walls ?? {}
  const out = []
  for (const id in walls) {
    const w = walls[id]
    if (!w) continue
    if (w.floorId != null && w.floorId !== fid) continue
    out.push(w)
  }
  return out
}

function _floorNodes(state) {
  const fid = _currentFloorId(state)
  const nodes = state?.nodes ?? {}
  const out = []
  for (const id in nodes) {
    const n = nodes[id]
    if (!n) continue
    if (!_nodeOnFloor(n, fid)) continue
    out.push(n)
  }
  return out
}

// Distance helpers (Euclidean, inches).
function _dist(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by
  return Math.sqrt(dx * dx + dy * dy)
}

// Closest point on segment AB to P. Returns { x, y, distanceIn, t }
// where t∈[0,1] is the parametric position along AB.
function _closestOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) {
    return { x: ax, y: ay, distanceIn: _dist(px, py, ax, ay), t: 0 }
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const x = ax + t * dx
  const y = ay + t * dy
  return { x, y, distanceIn: _dist(px, py, x, y), t }
}

// Deterministic comparator — distance asc, then sortKey lex asc.
function _byDistanceThenKey(a, b) {
  if (a.distanceIn !== b.distanceIn) return a.distanceIn - b.distanceIn
  if (a.sortKey < b.sortKey) return -1
  if (a.sortKey > b.sortKey) return 1
  return 0
}

export function findCandidates(state, type, x, y, radiusIn) {
  if (!state) return _EMPTY
  switch (type) {
    case 'node': {
      const out = []
      for (const n of _floorNodes(state)) {
        const d = _dist(n.x, n.y, x, y)
        if (d <= radiusIn) {
          out.push({
            entity:     n,
            point:      { x: n.x, y: n.y },
            distanceIn: d,
            sortKey:    `node:${n.id}`,
          })
        }
      }
      return out.sort(_byDistanceThenKey)
    }
    case 'wallEndpoint': {
      const out = []
      const nodes = state.nodes ?? {}
      for (const w of _floorWalls(state)) {
        const a = nodes[w.n1], b = nodes[w.n2]
        if (a) {
          const d = _dist(a.x, a.y, x, y)
          if (d <= radiusIn) {
            out.push({
              entity:     w,
              point:      { x: a.x, y: a.y },
              distanceIn: d,
              sortKey:    `wallEndpoint:${w.id}:n1`,
            })
          }
        }
        if (b) {
          const d = _dist(b.x, b.y, x, y)
          if (d <= radiusIn) {
            out.push({
              entity:     w,
              point:      { x: b.x, y: b.y },
              distanceIn: d,
              sortKey:    `wallEndpoint:${w.id}:n2`,
            })
          }
        }
      }
      return out.sort(_byDistanceThenKey)
    }
    case 'wallMidpoint': {
      const out = []
      const nodes = state.nodes ?? {}
      for (const w of _floorWalls(state)) {
        const a = nodes[w.n1], b = nodes[w.n2]
        if (!a || !b) continue
        const mx = (a.x + b.x) / 2
        const my = (a.y + b.y) / 2
        const d = _dist(mx, my, x, y)
        if (d <= radiusIn) {
          out.push({
            entity:     w,
            point:      { x: mx, y: my },
            distanceIn: d,
            sortKey:    `wallMidpoint:${w.id}`,
          })
        }
      }
      return out.sort(_byDistanceThenKey)
    }
    case 'wallSegment': {
      const out = []
      const nodes = state.nodes ?? {}
      for (const w of _floorWalls(state)) {
        const a = nodes[w.n1], b = nodes[w.n2]
        if (!a || !b) continue
        const c = _closestOnSegment(x, y, a.x, a.y, b.x, b.y)
        if (c.distanceIn <= radiusIn) {
          out.push({
            entity:     w,
            point:      { x: c.x, y: c.y },
            distanceIn: c.distanceIn,
            sortKey:    `wallSegment:${w.id}`,
          })
        }
      }
      return out.sort(_byDistanceThenKey)
    }
    default:
      return _EMPTY
  }
}

export function findNearestCandidate(state, type, x, y) {
  // Use a generous radius; callers that want a tolerance gate apply it
  // afterwards via distanceIn.
  const candidates = findCandidates(state, type, x, y, Infinity)
  return candidates.length > 0 ? candidates[0] : null
}
