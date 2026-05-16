// Excavation quantity computation (Phase 1.6b).
//
// Three layers, summed to a total:
//   1. Bulk excavation     — overall building footprint × bulk depth.
//                            Bulk depth defaults to plinth height (the basement of the
//                            ground floor) unless projectSettings.excavationSettings
//                            overrides it.
//   2. Per-foundation pits — additional volume for foundation pits below bulk.
//                            volume = footprintFt2 × (pitDepthFt - bulkDepthFt)  if positive
//                            (the pit goes deeper than bulk, so only the excess counts).
//   3. Per-civil-stamp     — already returned by getSumpCivilQty / getSepticCivilQty.
//
// Working margin (overcut around each pit for formwork access) is included via
// projectSettings.excavationSettings.workingMarginFt — default 0.5 ft per side.

function r2(n) { return Math.round(n * 100) / 100 }

const DEFAULT_WORKING_MARGIN_FT = 0.5

function getBulkDepthFt(state) {
  const ps = state.projectSettings
  return ps.excavationSettings?.bulkDepthFt ?? ps.heights?.plinthHeightFt ?? 1.5
}

function getWorkingMarginFt(state) {
  return state.projectSettings.excavationSettings?.workingMarginFt ?? DEFAULT_WORKING_MARGIN_FT
}

function buildingFootprintFt2(state) {
  // Sum of valid room areas on the current floor (F1 for single-floor projects).
  const ids = state.getValidRoomIds()
  return ids.reduce((s, id) => s + state.getRoomArea(id), 0)
}

export function computeExcavationQuantities(state) {
  const bulkDepthFt    = getBulkDepthFt(state)
  const marginFt       = getWorkingMarginFt(state)
  const footprintFt2   = buildingFootprintFt2(state)
  const bulkVolFt3     = footprintFt2 * bulkDepthFt

  // ── Per-foundation pits (excess depth below bulk) ─────────────────────
  const fdnQ = state.getFoundationQuantities()
  const perFoundation = []
  let foundationExtraVolFt3 = 0
  for (const [ctId, q] of Object.entries(fdnQ.byColumnTypeInline)) {
    const pitDepthFt   = q.depthFt
    const extraDepthFt = Math.max(0, pitDepthFt - bulkDepthFt)
    if (extraDepthFt === 0 || !q.count) continue
    // Working margin around each pit: (L + 2m) × (W + 2m), not just footprint.
    const pitLFt = q.lengthFt + 2 * marginFt
    const pitWFt = q.widthFt  + 2 * marginFt
    const volPerPit = pitLFt * pitWFt * extraDepthFt
    const volTotal  = volPerPit * q.count
    foundationExtraVolFt3 += volTotal
    perFoundation.push({
      key:           `inline_${ctId}`,
      label:         q.label,
      count:         q.count,
      pitDimFt:      `${r2(pitLFt)}×${r2(pitWFt)}×${r2(extraDepthFt)}`,
      volFt3:        r2(volTotal),
    })
  }
  for (const [fid, q] of Object.entries(fdnQ.byFoundation)) {
    // Foundation entities — use footprint + working-margin envelope.
    if (!q.footprintFt2) continue
    const depthFt = q.concreteVolFt3 && q.footprintFt2 ? q.concreteVolFt3 / q.footprintFt2 : 0
    const extraDepthFt = Math.max(0, depthFt - bulkDepthFt)
    if (extraDepthFt === 0) continue
    // Working margin approximation: scale footprint by √(1 + 4m/√A) ≈ +marginFt around perimeter.
    const sqrtA   = Math.sqrt(q.footprintFt2)
    const envelopeFt2 = Math.pow(sqrtA + 2 * marginFt, 2)
    const volTotal    = envelopeFt2 * extraDepthFt
    foundationExtraVolFt3 += volTotal
    perFoundation.push({
      key:      `fdn_${fid}`,
      label:    q.label,
      count:    1,
      pitDimFt: `${r2(sqrtA + 2 * marginFt)}²×${r2(extraDepthFt)}`,
      volFt3:   r2(volTotal),
    })
  }

  // ── Per-civil-stamp (already computed by store selectors) ─────────────
  const stamps = state.stamps || {}
  const civilStamps = []
  let civilTotalFt3 = 0
  for (const stamp of Object.values(stamps)) {
    if (!stamp.depth) continue
    if (stamp.type !== 'sump' && stamp.type !== 'septic_tank') continue
    const wFt = stamp.w / 12, hFt = stamp.h / 12, dFt = stamp.depth / 12
    // Working margin
    const lEnvFt = wFt + 2 * marginFt
    const wEnvFt = hFt + 2 * marginFt
    const vol = lEnvFt * wEnvFt * dFt
    civilTotalFt3 += vol
    civilStamps.push({
      key:    stamp.id,
      label:  stamp.name ?? stamp.type,
      type:   stamp.type,
      volFt3: r2(vol),
    })
  }

  const totalVolFt3 = r2(bulkVolFt3 + foundationExtraVolFt3 + civilTotalFt3)

  return {
    bulk: {
      footprintFt2: r2(footprintFt2),
      depthFt:      r2(bulkDepthFt),
      volFt3:       r2(bulkVolFt3),
    },
    perFoundation,
    civilStamps,
    workingMarginFt: marginFt,
    subtotals: {
      bulk:         r2(bulkVolFt3),
      foundation:   r2(foundationExtraVolFt3),
      civil:        r2(civilTotalFt3),
    },
    totalVolFt3,
  }
}
