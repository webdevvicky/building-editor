// Pure fitting classifier.
//
// Given a set of routes (polylines + sizes), classify every interior point
// into a fitting (elbow / tee / cross), and count reducers at size
// transitions between adjacent routes.
//
// All routing-zone knowledge stays inside individual route polylines (the
// zone-transition elbow accounting is handled by classifyZoneTransitions in
// geometry.js and folded into the route polyline upstream — by the time
// counts happen here, every direction change is a real fitting).

// Snap inches to nearest whole inch — sub-inch float jitter shouldn't fork
// the topology key. Tight enough that real corners stay distinct.
const _KEY_PRECISION_IN = 1

function _xyKey(p) {
  const kx = Math.round(p.x / _KEY_PRECISION_IN) * _KEY_PRECISION_IN
  const ky = Math.round(p.y / _KEY_PRECISION_IN) * _KEY_PRECISION_IN
  return `${kx},${ky}`
}

function _angleBetween(p1, p2, p3) {
  // Angle at p2 formed by segments p1→p2 and p2→p3, in degrees.
  const v1x = p1.x - p2.x, v1y = p1.y - p2.y
  const v2x = p3.x - p2.x, v2y = p3.y - p2.y
  const dot = v1x * v2x + v1y * v2y
  const m1 = Math.hypot(v1x, v1y)
  const m2 = Math.hypot(v2x, v2y)
  if (m1 === 0 || m2 === 0) return 180
  const cos = Math.max(-1, Math.min(1, dot / (m1 * m2)))
  return (Math.acos(cos) * 180) / Math.PI
}

// Public: classify three consecutive points as a STRAIGHT run or an ELBOW.
// Within 5° of 180° (i.e., near-straight) = STRAIGHT, else = ELBOW.
export function classifyCornerAngle(p1, p2, p3) {
  const ang = _angleBetween(p1, p2, p3)
  return Math.abs(180 - ang) <= 5 ? 'STRAIGHT' : 'ELBOW'
}

function _routeSizeKey(route) {
  if (route?.diameterMm != null) return `d${route.diameterMm}`
  if (route?.gaugeMm2 != null) return `g${route.gaugeMm2}`
  return ''
}

export function countFittings(routes, options = {}) {
  void options // reserved for future per-discipline tuning
  const result = {
    elbows: 0,
    tees: 0,
    crosses: 0,
    reducers: [],   // array of { at, from, to }
    valves: 0,      // populated by discipline modules; baseline is 0
    traps: 0,       // ditto — traps are plumbing-specific
  }
  if (!Array.isArray(routes) || routes.length === 0) return _summarize(result)

  // Build a map: xyKey → array of { routeIdx, ptIdx, kind: 'INTERIOR'|'ENDPOINT' }.
  // From this we determine degree at each xy point.
  const incidence = new Map()
  for (let ri = 0; ri < routes.length; ri++) {
    const r = routes[ri]
    const pts = r?.polyline
    if (!Array.isArray(pts) || pts.length < 2) continue
    for (let pi = 0; pi < pts.length; pi++) {
      const key = _xyKey(pts[pi])
      const kind = (pi === 0 || pi === pts.length - 1) ? 'ENDPOINT' : 'INTERIOR'
      const arr = incidence.get(key)
      const rec = { routeIdx: ri, ptIdx: pi, kind }
      if (arr) arr.push(rec); else incidence.set(key, [rec])
    }
  }

  // For each xy key, decide what fitting it is.
  //
  //   - Interior point on a single route: corner classification by angle.
  //   - Multiple endpoints meeting at a key: degree = number of distinct
  //     incident segments. Each endpoint contributes 1 segment, each
  //     interior point contributes 2.
  //
  // Degree → fitting:
  //   2  (elbow if non-straight)
  //   3  → TEE
  //   4  → CROSS
  //   >4 are uncommon — counted as crosses for safety.
  for (const [, recs] of incidence) {
    // Degree:
    let degree = 0
    for (const r of recs) degree += (r.kind === 'INTERIOR') ? 2 : 1

    if (degree === 2) {
      // Two possibilities:
      //   (a) one interior point on a single polyline → angle check.
      //   (b) two endpoints (different routes) meeting → straight join, no fitting.
      const interior = recs.find(r => r.kind === 'INTERIOR')
      if (interior) {
        const r = routes[interior.routeIdx]
        const p1 = r.polyline[interior.ptIdx - 1]
        const p2 = r.polyline[interior.ptIdx]
        const p3 = r.polyline[interior.ptIdx + 1]
        if (classifyCornerAngle(p1, p2, p3) === 'ELBOW') result.elbows++
      }
    } else if (degree === 3) {
      result.tees++
    } else if (degree >= 4) {
      result.crosses++
    }
  }

  // Reducers: at every junction (degree ≥ 3, OR endpoint-to-endpoint meeting)
  // count one reducer per adjacent route pair whose size differs.
  for (const [, recs] of incidence) {
    if (recs.length < 2) continue
    // Distinct route ids meeting here:
    const routeIdxs = [...new Set(recs.map(r => r.routeIdx))].sort((a, b) => a - b)
    if (routeIdxs.length < 2) continue
    for (let i = 0; i < routeIdxs.length; i++) {
      for (let j = i + 1; j < routeIdxs.length; j++) {
        const a = _routeSizeKey(routes[routeIdxs[i]])
        const b = _routeSizeKey(routes[routeIdxs[j]])
        if (a && b && a !== b) {
          const at = recs[0]
          const r0 = routes[at.routeIdx].polyline[at.ptIdx]
          result.reducers.push({ at: { x: r0.x, y: r0.y }, from: a, to: b })
        }
      }
    }
  }

  return _summarize(result)
}

function _summarize(r) {
  // Freeze the returned object lightly — keep mutable arrays for callers that
  // want to attach discipline-specific extras (valves, traps).
  return r
}
