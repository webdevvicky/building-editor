// Rule: explicit beams should terminate on columns at both ends.

import { resolveBeamEndpoint } from '../../topology/beams.js'

function endpointIsColumn(state, ref) {
  if (ref?.type !== 'COLUMN') return false
  if (!state.columns[ref.columnId]) return false
  return resolveBeamEndpoint(state, ref) !== null
}

export const beamNoSupport = {
  id: 'beam_no_support',
  severity: 'warning',
  category: 'structural',
  message: 'Explicit beam endpoint is not a column.',
  check(state) {
    const issues = []
    for (const beam of Object.values(state.beams)) {
      const fromOk = endpointIsColumn(state, beam.endpoints?.from)
      const toOk   = endpointIsColumn(state, beam.endpoints?.to)
      if (!fromOk || !toOk) issues.push({ entityType: 'beam', entityId: beam.id })
    }
    return { ok: issues.length === 0, issues }
  },
}
