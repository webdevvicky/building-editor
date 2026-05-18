// Rule: an electrical circuit's combined load exceeds the IS-732 cap for
// its circuit class. Surfaces as a validation warning in the BOQ footer.
//
// Per IS-732 / NBC 2016 the LIGHTING + FAN caps are 800W per 1.5 sqmm
// circuit; SOCKETS_5A/15A caps are 2000W per 2.5 sqmm circuit. AC /
// GEYSER / EV are one-circuit-per-point (no cap to exceed).

import { groupPointsIntoCircuits, getCircuitPolicy } from '../../electrical/circuitGrouping.js'
import { sortedFloorList } from '../../../topology/index.js'

const DEFAULT_FLOOR_ID = 'F1'

export const mepDbLoadExceeded = {
  id: 'mep_db_load_exceeded',
  severity: 'warning',
  category: 'mep',
  message: 'Circuit load exceeds IS-732 cap — split into multiple circuits.',
  check(state) {
    if (!state) return { ok: true, issues: [] }
    const issues = []

    // Walk every floor; for each floor, group its points into circuits
    // and report any whose loadW exceeds the policy cap.
    const floors = sortedFloorList(state)
    const floorIds = floors.length
      ? floors.map(f => f.id)
      : [state.currentFloorId ?? DEFAULT_FLOOR_ID]

    for (const fid of floorIds) {
      const circuits = groupPointsIntoCircuits(state, fid)
      // (1) Direct over-load: a single circuit's bound load exceeds the
      //     IS-732 cap. By design groupPointsIntoCircuits bins under the
      //     cap, so this only fires when a single point's load is
      //     above the cap (e.g., misconfigured AC point on a 1.5 sqmm
      //     class). Conservative — still worth flagging.
      for (const c of circuits) {
        const policy = getCircuitPolicy(c.circuitClass)
        if (!policy) continue
        if (!Number.isFinite(policy.loadCapW)) continue
        if (c.loadW <= policy.loadCapW) continue
        issues.push({
          entityType: 'ELECTRICAL',
          entityId:   c.id,
          message:    `Circuit ${c.id} load ${Math.round(c.loadW)}W exceeds ${c.circuitClass} cap of ${policy.loadCapW}W`,
        })
      }
      // (2) Over-density: aggregate point count for a (floor, class)
      //     exceeds the pointCapN — i.e., needs multiple circuits. The
      //     binning step handles this transparently, but the user is
      //     flagged so they verify the design (sub-DB / sub-circuit
      //     load shedding may be more economical).
      const byClass = new Map()
      for (const c of circuits) {
        if (!byClass.has(c.circuitClass)) byClass.set(c.circuitClass, { count: 0, loadW: 0, circuits: 0 })
        const acc = byClass.get(c.circuitClass)
        acc.count    += c.points.length
        acc.loadW    += c.loadW
        acc.circuits += 1
      }
      for (const [cls, acc] of [...byClass.entries()].sort()) {
        const policy = getCircuitPolicy(cls)
        if (!policy || policy.oneCircuitPerPoint) continue   // AC/GEYSER/EV: one-per-point is by design
        if (acc.circuits <= 1) continue
        if (acc.count <= policy.pointCapN) continue          // not over-dense
        issues.push({
          entityType: 'ELECTRICAL',
          entityId:   `${fid}_${cls}`,
          message:    `${cls} on ${fid} has ${acc.count} points (cap ${policy.pointCapN}/circuit) — needs ${acc.circuits} circuits`,
        })
      }
    }
    issues.sort((a, b) => a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0)
    return { ok: issues.length === 0, issues }
  },
}
