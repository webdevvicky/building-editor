// Cross-discipline clash detection — Phase 2.5.
//
// Pure: takes an array of PolylineRoute objects (from every discipline,
// already merged) and returns intersection ClashEvent[]. Never reads
// from the store, never mutates state.
//
// Algorithm:
//   1. Filter routes by floorId — only same-floor routes can clash (vertical
//      stacking is governed by zone height, not by 2D intersection).
//   2. Bucket routes by floor, then by (discipline, route) so we only check
//      across-discipline pairs.
//   3. For every cross-discipline route pair on the same floor, iterate
//      segments and test pairwise segment-segment intersection. A clash
//      contributes the intersection point in world inches.
//   4. Snap each intersection point to a ~6 inch dedup grid; the first
//      clash record wins for a given (routeA, routeB, snapKey) triple.
//   5. Severity comes from a frozen matrix keyed on the sorted discipline
//      pair (so PLUMBING|ELECTRICAL and ELECTRICAL|PLUMBING resolve to the
//      same row). Default falls back to 'warning'.
//   6. Output is sorted deterministically by (floorId, disciplineA,
//      disciplineB, x, y, routeAId, routeBId) so two invocations on the
//      same input emit byte-identical arrays.
//
// Discipline inference: prefer route.kind (set by every discipline's
// routing.js) and fall back to route.systemId for older callers. SOLAR
// routes are accepted ahead of Phase 2.6 wiring.

import { fnv1aHash } from './systemGraph.js'

// ── Frozen lookup tables ────────────────────────────────────────────────────

const KIND_TO_DISCIPLINE = Object.freeze({
  // Plumbing
  CPVC_SUPPLY: 'PLUMBING',
  CPVC_HOT:    'PLUMBING',
  UPVC_DRAIN:  'PLUMBING',
  UPVC_RAIN:   'PLUMBING',

  // Electrical
  WIRING:      'ELECTRICAL',
  SUBMAIN:     'ELECTRICAL',

  // HVAC
  REFRIGERANT_GAS:    'HVAC',
  REFRIGERANT_LIQUID: 'HVAC',
  CONDENSATE:         'HVAC',
  DUCT:               'HVAC',

  // Fire
  FIRE_DETECTION_CABLE: 'FIRE',
  FIRE_SPRINKLER_PIPE:  'FIRE',

  // ELV
  CCTV_CABLE:     'ELV',
  DATA_CABLE:     'ELV',
  SECURITY_CABLE: 'ELV',
  AV_CABLE:       'ELV',

  // Solar (Phase 2.6 — accepted by the matrix today)
  SOLAR_DC_CABLE: 'SOLAR',
  SOLAR_AC_CABLE: 'SOLAR',
})

// Fallback systemId → discipline lookup. Used when route.kind is missing
// (older / future emitters may key on systemId only).
const SYSTEM_ID_TO_DISCIPLINE = Object.freeze({
  COLD_SUPPLY: 'PLUMBING',
  HOT_SUPPLY:  'PLUMBING',
  SOIL_DRAIN:  'PLUMBING',
  RAINWATER:   'PLUMBING',
  LIGHTING:    'ELECTRICAL',
  POWER_5A:    'ELECTRICAL',
  POWER_15A:   'ELECTRICAL',
  AC:          'ELECTRICAL',
  GEYSER:      'ELECTRICAL',
  EV:          'ELECTRICAL',
  SOLAR_TIE:   'ELECTRICAL',
})

// Severity matrix. KEY ORDER IS ALWAYS ALPHABETICAL — `severityFor` sorts
// the input pair before lookup, so each pair is stored exactly once under
// its sorted-pair key. Default for unlisted pairs is 'warning'.
const SEVERITY_MATRIX = Object.freeze({
  'ELECTRICAL|PLUMBING':  'error',     // Water on live conductor — code-blocker.
  'ELECTRICAL|FIRE':      'error',     // Fire detection wiring must stay separated.
  'ELECTRICAL|HVAC':      'warning',
  'ELECTRICAL|ELV':       'warning',   // Cross-talk / induction risk on low-voltage data.
  'ELECTRICAL|SOLAR':     'warning',
  'HVAC|PLUMBING':        'warning',   // Condensate/refrigerant crossing soil stack.
  'FIRE|PLUMBING':        'info',      // Sprinkler-pipe crossing supply — note for coordination.
  'ELV|PLUMBING':         'info',
  'PLUMBING|SOLAR':       'info',
  'FIRE|HVAC':            'warning',
  'ELV|HVAC':             'info',
  'HVAC|SOLAR':           'info',
  'ELV|FIRE':             'info',
  'FIRE|SOLAR':           'info',
  'ELV|SOLAR':            'info',
})

// Dedup snap radius (world inches). 6 inches = a quarter-foot — fine
// enough that two real crossings on the same wall stay distinct, coarse
// enough that float drift on the same intersection collapses to one.
const SNAP_GRID_IN = 6
// Numerical tolerance for segment-segment denominators.
const PARALLEL_EPS = 1e-9
// Inclusive endpoint slack for the t/u parameter ranges. Routes that
// share an endpoint (e.g. a tee splitting off at a junction inside the
// same discipline) would otherwise generate clashes against an
// adjoining segment with a t == 0 / u == 0 numerical knife-edge. We
// stay STRICTLY inside both segments by a tiny epsilon to avoid that.
const PARAM_EPS = 1e-9

// Public sentinel kept for callers that previously checked for the
// stub. Always true once Phase 2.5 ships. (Old Phase 1 sentinel was
// `PHASE_1_STUB`; rename + flip.)
export const PHASE_2_5 = true

// ── Discipline inference ────────────────────────────────────────────────────

function disciplineOf(route) {
  if (!route) return null
  if (route.discipline) return route.discipline                          // explicit wins
  const byKind = KIND_TO_DISCIPLINE[route.kind]
  if (byKind) return byKind
  const bySys = SYSTEM_ID_TO_DISCIPLINE[route.systemId]
  if (bySys) return bySys
  return null
}

// ── Segment-segment intersection (2D, parametric) ───────────────────────────

function _segmentIntersection(a1, a2, b1, b2) {
  const r_px = a2.x - a1.x
  const r_py = a2.y - a1.y
  const s_px = b2.x - b1.x
  const s_py = b2.y - b1.y
  const denom = r_px * s_py - r_py * s_px
  if (Math.abs(denom) < PARALLEL_EPS) return null               // parallel or collinear
  const qmp_x = b1.x - a1.x
  const qmp_y = b1.y - a1.y
  const t = (qmp_x * s_py - qmp_y * s_px) / denom
  const u = (qmp_x * r_py - qmp_y * r_px) / denom
  if (t < PARAM_EPS || t > 1 - PARAM_EPS) return null
  if (u < PARAM_EPS || u > 1 - PARAM_EPS) return null
  return { x: a1.x + t * r_px, y: a1.y + t * r_py, t, u }
}

// ── Severity lookup ─────────────────────────────────────────────────────────

function severityFor(disciplineA, disciplineB) {
  // Normalize to sorted-pair key so the matrix lookup is direction-agnostic.
  const [lo, hi] = [disciplineA, disciplineB].sort()
  return SEVERITY_MATRIX[`${lo}|${hi}`] ?? 'warning'
}

// ── Snap-point dedup key ────────────────────────────────────────────────────

function _snapKey(point) {
  const sx = Math.round(point.x / SNAP_GRID_IN)
  const sy = Math.round(point.y / SNAP_GRID_IN)
  return `${sx},${sy}`
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * @param {Array<object>} routes - PolylineRoute objects from any discipline.
 * @param {object} [options] - Reserved for future tuning (clearance envelopes,
 *   discipline filters). No-op in Phase 2.5.
 * @returns {Array<object>} ClashEvent[] sorted deterministically.
 */
// eslint-disable-next-line no-unused-vars
export function detectClashes(routes, options = {}) {
  if (!Array.isArray(routes) || routes.length < 2) return []

  // Bucket by floorId; only same-floor pairs can clash.
  const byFloor = new Map()
  for (const r of routes) {
    if (!r) continue
    const poly = r.polyline ?? r.points
    if (!Array.isArray(poly) || poly.length < 2) continue
    const discipline = disciplineOf(r)
    if (!discipline) continue
    const floorId = r.floorId ?? 'F1'
    if (!byFloor.has(floorId)) byFloor.set(floorId, [])
    byFloor.get(floorId).push({ route: r, polyline: poly, discipline, floorId })
  }

  const events = []
  const seen = new Set()

  // Stable floor traversal.
  const floorIds = [...byFloor.keys()].sort()
  for (const floorId of floorIds) {
    const bucket = byFloor.get(floorId)
    // Stable route ordering inside the floor — sort by (discipline, id).
    bucket.sort((a, b) => {
      if (a.discipline !== b.discipline) return a.discipline < b.discipline ? -1 : 1
      return a.route.id < b.route.id ? -1 : a.route.id > b.route.id ? 1 : 0
    })

    for (let i = 0; i < bucket.length; i++) {
      const A = bucket[i]
      for (let j = i + 1; j < bucket.length; j++) {
        const B = bucket[j]
        if (A.discipline === B.discipline) continue           // same-discipline pairs skipped
        // Canonical orientation: alphabetical discipline order so the
        // emitted event is deterministic regardless of input order.
        let routeA, routeB, discA, discB
        if (A.discipline <= B.discipline) {
          routeA = A; routeB = B; discA = A.discipline; discB = B.discipline
        } else {
          routeA = B; routeB = A; discA = B.discipline; discB = A.discipline
        }

        const polyA = routeA.polyline
        const polyB = routeB.polyline
        for (let aI = 0; aI < polyA.length - 1; aI++) {
          const a1 = polyA[aI], a2 = polyA[aI + 1]
          for (let bI = 0; bI < polyB.length - 1; bI++) {
            const b1 = polyB[bI], b2 = polyB[bI + 1]
            const hit = _segmentIntersection(a1, a2, b1, b2)
            if (!hit) continue
            const snap = _snapKey(hit)
            const dedupKey = `${floorId}|${routeA.route.id}|${routeB.route.id}|${snap}`
            if (seen.has(dedupKey)) continue
            seen.add(dedupKey)
            const severity = severityFor(discA, discB)
            const id = fnv1aHash(dedupKey)
            events.push({
              id,
              routeAId:    routeA.route.id,
              routeBId:    routeB.route.id,
              disciplineA: discA,
              disciplineB: discB,
              point:       { x: hit.x, y: hit.y },
              floorId,
              severity,
              message: `${discA} route ${routeA.route.id} clashes with ${discB} route ${routeB.route.id} at (${(hit.x / 12).toFixed(2)}ft, ${(hit.y / 12).toFixed(2)}ft)`,
            })
          }
        }
      }
    }
  }

  // Deterministic global ordering.
  events.sort((a, b) => {
    if (a.floorId !== b.floorId)         return a.floorId < b.floorId ? -1 : 1
    if (a.disciplineA !== b.disciplineA) return a.disciplineA < b.disciplineA ? -1 : 1
    if (a.disciplineB !== b.disciplineB) return a.disciplineB < b.disciplineB ? -1 : 1
    if (a.point.x !== b.point.x)         return a.point.x - b.point.x
    if (a.point.y !== b.point.y)         return a.point.y - b.point.y
    if (a.routeAId !== b.routeAId)       return a.routeAId < b.routeAId ? -1 : 1
    if (a.routeBId !== b.routeBId)       return a.routeBId < b.routeBId ? -1 : 1
    return 0
  })

  return events
}

// Internal exports for verify-mep — discipline inference + severity lookup
// can be exercised directly without standing up a full route fixture.
export { disciplineOf, severityFor, KIND_TO_DISCIPLINE, SEVERITY_MATRIX }
