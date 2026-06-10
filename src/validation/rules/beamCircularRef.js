// Rule: beam-to-beam endpoint references must not form a cycle (A frames into
// B frames into A). A cycle makes the endpoint geometry unresolvable
// (resolveBeamEndpoint returns null via its cycle guard). ERROR severity —
// not dismissable.

export const beamCircularRef = {
  id: 'beam_circular_ref',
  severity: 'error',
  category: 'structural',
  version: 1,
  order: 121,
  scope: 'structural',
  affectedBy: ['beams'],
  dismissable: false,
  message: 'Beam has a circular beam-to-beam endpoint reference.',
  check(state) {
    const beams = state.beams ?? {}
    const issues = []
    for (const beam of Object.values(beams)) {
      const seen = new Set()
      const stack = []
      for (const which of ['from', 'to']) {
        const ep = beam.endpoints?.[which]
        if (ep?.type === 'BEAM' && ep.beamId) stack.push(ep.beamId)
      }
      let cyclic = false
      while (stack.length) {
        const id = stack.pop()
        if (id === beam.id) { cyclic = true; break }
        if (seen.has(id)) continue
        seen.add(id)
        const bb = beams[id]
        if (!bb) continue
        for (const which of ['from', 'to']) {
          const ep = bb.endpoints?.[which]
          if (ep?.type === 'BEAM' && ep.beamId) stack.push(ep.beamId)
        }
      }
      if (cyclic) issues.push({ entityType: 'beam', entityId: beam.id })
    }
    return { ok: issues.length === 0, issues }
  },
}
