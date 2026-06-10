// Rule: a beam endpoint should be SUPPORTED — terminate on a column, another
// beam (beam-to-beam), or a wall (bearing), all of which resolve to a real
// support point. A free POINT end (beam terminating in space, incl. an endpoint
// detached by a parent delete) or an unresolvable ref is "no support".
//
// Geometry resolves through the canonical resolveBeamEndpoint — no direct
// endpoint coordinate access.

import { resolveBeamEndpoint } from '../../topology/beams.js'

function endpointIsSupported(state, ref) {
  if (ref == null) return false
  if (ref.type !== 'COLUMN' && ref.type !== 'BEAM' && ref.type !== 'WALL') return false
  return resolveBeamEndpoint(state, ref) !== null
}

export const beamNoSupport = {
  id: 'beam_no_support',
  severity: 'warning',
  category: 'structural',
  version: 2,
  order: 120,
  scope: 'structural',
  affectedBy: ['beams', 'columns', 'walls'],
  dismissable: true,
  message: 'Beam endpoint is unsupported (free end — not a column, beam, or wall).',
  check(state) {
    const issues = []
    for (const beam of Object.values(state.beams)) {
      const fromOk = endpointIsSupported(state, beam.endpoints?.from)
      const toOk   = endpointIsSupported(state, beam.endpoints?.to)
      if (!fromOk || !toOk) issues.push({ entityType: 'beam', entityId: beam.id })
    }
    return { ok: issues.length === 0, issues }
  },
}
