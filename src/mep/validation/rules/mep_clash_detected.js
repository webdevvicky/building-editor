// Rule: cross-discipline route intersection ("clash").
//
// Iterates every discipline's route builder, collects the route arrays into
// one flat list, then defers to `detectClashes` (pure) to find segment-
// segment intersections across different disciplines on the same floor.
// Each clash event becomes one validation issue surfaced through the BOQ
// footer.
//
// Severity flows from the clash event itself (per the SEVERITY_MATRIX in
// clashDetection.js) — that's why the rule does not declare a top-level
// severity; the engine reads each issue's per-event severity from the
// `severity` field we attach (see engine.js: action-emitted events path
// reads the per-issue severity).

import { detectClashes } from '../../shared/clashDetection.js'
import { buildPlumbingSystemGraph } from '../../plumbing/network.js'
import { buildPlumbingRoutes }      from '../../plumbing/routing.js'
import { buildElectricalSystemGraph } from '../../electrical/network.js'
import { buildElectricalRoutes }      from '../../electrical/routing.js'
import { buildHvacSystemGraph } from '../../hvac/network.js'
import { buildHvacRoutes }      from '../../hvac/routing.js'
import { buildFireSystemGraph } from '../../fire/network.js'
import { buildFireRoutes }      from '../../fire/routing.js'
import { buildElvSystemGraph } from '../../elv/network.js'
import { buildElvRoutes }      from '../../elv/routing.js'

// Safely call a route builder. Discipline engines never throw on empty
// state, but a downstream change could; we contain the failure so a single
// broken discipline doesn't silence the rule for every other discipline.
function _safeRoutes(builderGraph, builderRoutes, state) {
  try {
    const g = builderGraph(state)
    const r = builderRoutes(g, state)
    if (Array.isArray(r)) return r
    if (Array.isArray(r?.routes)) return r.routes
    return []
  } catch {
    return []
  }
}

export const mepClashDetected = {
  id: 'mep_clash_detected',
  // Engine top-level severity is the default; per-event severity overrides
  // when the rule attaches `severity` to its issue records.
  severity: 'warning',
  category: 'mep',
  message: 'MEP route clash detected.',
  check(state) {
    if (!state) return { ok: true, issues: [] }
    const allRoutes = [
      ..._safeRoutes(buildPlumbingSystemGraph,   buildPlumbingRoutes,   state),
      ..._safeRoutes(buildElectricalSystemGraph, buildElectricalRoutes, state),
      ..._safeRoutes(buildHvacSystemGraph,       buildHvacRoutes,       state),
      ..._safeRoutes(buildFireSystemGraph,       buildFireRoutes,       state),
      ..._safeRoutes(buildElvSystemGraph,        buildElvRoutes,        state),
    ]
    if (allRoutes.length < 2) return { ok: true, issues: [] }

    const clashes = detectClashes(allRoutes)
    const issues = clashes.map(c => ({
      entityType: `${c.disciplineA}|${c.disciplineB}`,
      entityId:   c.routeAId,
      severity:   c.severity,
      message:    c.message,
      // Carry the full clash payload through so the BOQ footer / canvas
      // overlay can navigate / render it without reconstructing.
      meta: {
        clashId:     c.id,
        routeAId:    c.routeAId,
        routeBId:    c.routeBId,
        disciplineA: c.disciplineA,
        disciplineB: c.disciplineB,
        point:       c.point,
        floorId:     c.floorId,
      },
    }))
    return { ok: issues.length === 0, issues }
  },
}
