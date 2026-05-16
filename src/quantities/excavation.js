// Excavation quantity computation (Phase 1.6b).
//
// Soil-removal model (additive — no vertical overlap between layers):
//
//   1. Bulk excavation     — top layer across the building footprint.
//                            Depth = projectSettings.excavationSettings.bulkDepthFt
//                                    (defaults to heights.plinthHeightFt — the plinth
//                                    height above grade, mirrored as below-grade dig).
//                            Volume = footprint × bulkDepth.
//                            When no rooms are saved, footprint = 0 and bulk = 0.
//
//   2. Per-foundation pits — extra dig BELOW the bulk layer for each footing pit.
//                            Each pit goes deeper by:
//                                footing_thickness + PCC_BEDDING_THICKNESS_FT
//                            from the bulk floor.  When bulk = 0 (no rooms yet) this
//                            is dug from grade — the math is the same either way.
//                            Per pit volume = pit_envelope × pit_extra_depth.
//                            Pit envelope = (L + 2·margin) × (W + 2·margin) for
//                            formwork access.
//
//   3. Per-civil-stamp     — full depth of sumps + septic tanks (independent of bulk).
//                            Each stamp's envelope × its declared depth.
//
// Working margin (overcut for formwork access) defaults to 0.5 ft per side;
// override via projectSettings.excavationSettings.workingMarginFt.
//
// Section visibility (in ExcavationSection.jsx): hides only when totalVolFt3 === 0.
// With any column / foundation / civil stamp present, the section is shown.

import { PCC_BEDDING_THICKNESS_FT } from '../constants/structural'
import { computeFoundationQuantities } from './foundations'

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

  // ── Per-foundation pits ───────────────────────────────────────────────
  // Pit extra depth (below bulk floor) = footing_thickness + PCC bedding.
  // This is additive to bulk excavation — they don't overlap vertically.
  const fdnQ = state.getFoundationQuantities()
  const perFoundation = []
  let foundationVolFt3 = 0

  for (const [ctId, q] of Object.entries(fdnQ.byColumnTypeInline)) {
    if (!q.count || !q.depthFt) continue
    const pitExtraDepthFt = q.depthFt + PCC_BEDDING_THICKNESS_FT
    const pitLFt          = q.lengthFt + 2 * marginFt
    const pitWFt          = q.widthFt  + 2 * marginFt
    const volPerPit       = pitLFt * pitWFt * pitExtraDepthFt
    const volTotal        = volPerPit * q.count
    foundationVolFt3     += volTotal
    perFoundation.push({
      key:      `inline_${ctId}`,
      label:    q.label,
      count:    q.count,
      pitDimFt: `${r2(pitLFt)}×${r2(pitWFt)}×${r2(pitExtraDepthFt)}`,
      volFt3:   r2(volTotal),
    })
  }
  // Phase 1.8: foundation-entity excavation uses computeFoundationQuantities
  // which knows the proper geometry per type (ISOLATED/COMBINED/RAFT/STRIP/PILE).
  const fdnEntities = computeFoundationQuantities(state).perFoundation
  for (const f of fdnEntities) {
    if (!f.excavVolFt3) continue
    foundationVolFt3 += f.excavVolFt3
    perFoundation.push({
      key:      `fdn_${f.id}`,
      label:    f.label,
      count:    1,
      pitDimFt: `${f.type}`,
      volFt3:   r2(f.excavVolFt3),
    })
  }

  // ── Per-civil-stamp (sump + septic, full depth always) ────────────────
  const stamps = state.stamps || {}
  const civilStamps = []
  let civilTotalFt3 = 0
  for (const stamp of Object.values(stamps)) {
    if (!stamp.depth) continue
    if (stamp.type !== 'sump' && stamp.type !== 'septic_tank') continue
    const wFt = stamp.w / 12, hFt = stamp.h / 12, dFt = stamp.depth / 12
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

  const totalVolFt3 = r2(bulkVolFt3 + foundationVolFt3 + civilTotalFt3)

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
      foundation:   r2(foundationVolFt3),
      civil:        r2(civilTotalFt3),
    },
    totalVolFt3,
  }
}
