// Pluggable sizing-strategy registry for MEP branches.
//
// Each MEP discipline picks a strategy when sizing a pipe/wire/duct branch.
// The strategy is keyed by id so the choice can be persisted in
// projectSettings.mepSizing.{PLUMBING|ELECTRICAL|...}.
//
// Strategy impl signature (all are pure functions):
//   sizeBranch(branch, ctx) → { diameterMm?, gaugeMm2?, gradient?, reason }
//
// Branch shape (provided by the caller — usually the discipline sizing
// module that wraps the strategy dispatch):
//   {
//     id, systemId, fixtureUnits?, loadW?, lengthFt?, lengthM?,
//     diversityClass?, leaves?: [{ type, fixtureUnits?, loadW? }],
//   }
//
// ctx provides catalog + constant tables so strategies stay pure:
//   {
//     pipeCatalog: [...]                 // CPVC / UPVC diameter table
//     wireGauges:  [...]                 // wire gauge table
//     resistanceByGauge: { sqmm: Ω/m },
//     diversityFactor: number (resolved)
//     voltage: 230, vdLimitPct: 3,
//     fixtureUnits: { TYPE: FU }         // fallback when leaves lack FU
//     pointLoads:   { TYPE: W }          // fallback when leaves lack W
//     gradient:     1/80 | 1/40          // for GRADIENT_DRAIN
//     catalogDefault: { diameterMm? | gaugeMm2? }   // CATALOG fallback
//   }

import { listCpvcDiameters } from '../catalogs/pipeStandards/cpvc.js'
import { listUpvcDiameters } from '../catalogs/pipeStandards/upvc.js'
import { listWireGauges } from '../catalogs/wireGauges.js'
import {
  NOMINAL_VOLTAGE_V,
  MAX_VOLTAGE_DROP_PERCENT,
  RESISTANCE_OHM_PER_M_BY_SQMM,
  POWER_FACTOR,
  DRAIN_GRADIENTS,
} from '../catalogs/loads/electricalConstants.js'

// ── CATALOG ──────────────────────────────────────────────────────────────

function _catalogSizeBranch(branch, ctx) {
  const def = ctx?.catalogDefault ?? {}
  if (def.diameterMm != null) {
    return {
      diameterMm: def.diameterMm,
      reason: 'CATALOG: catalog default diameter for dominant fixture',
    }
  }
  if (def.gaugeMm2 != null) {
    return {
      gaugeMm2: def.gaugeMm2,
      reason: 'CATALOG: catalog default gauge for dominant point type',
    }
  }
  return { reason: 'CATALOG: no catalog default available for branch' }
}

// ── HUNTER ───────────────────────────────────────────────────────────────
//
// Plumbing fixture-unit sizing. Sum FU of all downstream fixtures on the
// branch, then pick the SMALLEST pipe diameter whose fixtureUnitsCarried
// is >= the total FU. CPVC for supply, UPVC for drainage.

function _resolveCatalog(ctx, branch) {
  // Caller-provided catalog wins.
  if (Array.isArray(ctx?.pipeCatalog) && ctx.pipeCatalog.length > 0) return ctx.pipeCatalog
  // Otherwise pick by systemId: supply → CPVC, drain → UPVC.
  const sys = branch?.systemId ?? ''
  if (sys === 'SOIL_DRAIN' || sys === 'RAINWATER' || sys === 'WASTE_DRAIN') {
    return listUpvcDiameters()
  }
  return listCpvcDiameters()
}

function _sumBranchFu(branch, ctx) {
  if (branch == null) return 0
  // Explicit aggregate wins.
  if (Number.isFinite(branch.fixtureUnits)) return branch.fixtureUnits
  const leaves = Array.isArray(branch.leaves) ? branch.leaves : []
  let sum = 0
  for (const leaf of leaves) {
    if (Number.isFinite(leaf?.fixtureUnits)) {
      sum += leaf.fixtureUnits
      continue
    }
    const tableFu = ctx?.fixtureUnits?.[leaf?.type]
    if (Number.isFinite(tableFu)) sum += tableFu
  }
  return sum
}

function _hunterSizeBranch(branch, ctx) {
  const totalFu = _sumBranchFu(branch, ctx)
  const cat = _resolveCatalog(ctx, branch)
  // Iterate sorted ascending by nominalMm — first row whose FU >= total wins.
  const sorted = [...cat].sort((a, b) => a.nominalMm - b.nominalMm)
  for (const row of sorted) {
    if ((row.fixtureUnitsCarried ?? 0) >= totalFu) {
      return {
        diameterMm: row.nominalMm,
        reason: `HUNTER FU=${totalFu} → ${row.nominalMm}mm`,
      }
    }
  }
  // FU exceeds the largest catalog entry — return the largest with a note.
  const last = sorted[sorted.length - 1]
  if (last) {
    return {
      diameterMm: last.nominalMm,
      reason: `HUNTER FU=${totalFu} exceeds catalog cap → ${last.nominalMm}mm (max)`,
    }
  }
  return { reason: `HUNTER FU=${totalFu} → no pipe catalog available` }
}

// ── LOAD_BASED ───────────────────────────────────────────────────────────
//
// Electrical voltage-drop sizing. Sum point loads, apply diversity factor,
// compute current at 230V, walk wire-gauge catalog ascending and pick the
// smallest gauge where:
//   - I <= gauge.maxLoadW / 230   (ampacity check, IS 732)
//   - VD% = (I × R × L × 2) / V × 100  <= 3%  (R = Ω/m, L = meters, 2 = round-trip)

function _sumBranchLoadW(branch, ctx) {
  if (branch == null) return 0
  if (Number.isFinite(branch.loadW)) return branch.loadW
  const leaves = Array.isArray(branch.leaves) ? branch.leaves : []
  let sum = 0
  for (const leaf of leaves) {
    if (Number.isFinite(leaf?.loadW)) { sum += leaf.loadW; continue }
    const tableW = ctx?.pointLoads?.[leaf?.type]
    if (Number.isFinite(tableW)) sum += tableW
  }
  return sum
}

function _branchLengthM(branch) {
  if (Number.isFinite(branch?.lengthM)) return branch.lengthM
  if (Number.isFinite(branch?.lengthFt)) return branch.lengthFt * 0.3048
  return 0
}

function _loadBasedSizeBranch(branch, ctx) {
  const rawW = _sumBranchLoadW(branch, ctx)
  const diversity = Number.isFinite(ctx?.diversityFactor) ? ctx.diversityFactor : 1.0
  const designW = rawW * diversity
  const voltage = Number.isFinite(ctx?.voltage) ? ctx.voltage : NOMINAL_VOLTAGE_V
  const vdLimit = Number.isFinite(ctx?.vdLimitPct) ? ctx.vdLimitPct : MAX_VOLTAGE_DROP_PERCENT
  const lengthM = _branchLengthM(branch)
  const pf = Number.isFinite(ctx?.powerFactor) ? ctx.powerFactor : POWER_FACTOR
  const current = voltage > 0 ? designW / (voltage * pf) : 0

  const gauges = (Array.isArray(ctx?.wireGauges) && ctx.wireGauges.length > 0)
    ? ctx.wireGauges
    : listWireGauges()
  const resTable = ctx?.resistanceByGauge ?? RESISTANCE_OHM_PER_M_BY_SQMM

  // Ascending by sqmm.
  const sorted = [...gauges].sort((a, b) => a.sqmm - b.sqmm)
  for (const g of sorted) {
    const ampacity = (g.maxLoadW ?? 0) / voltage
    if (current > ampacity) continue
    const rPerM = resTable[g.sqmm]
    if (rPerM == null) continue
    // Round-trip drop: outgoing + return conductor.
    const vDrop = current * rPerM * lengthM * 2
    const vdPct = (vDrop / voltage) * 100
    if (vdPct <= vdLimit) {
      return {
        gaugeMm2: g.sqmm,
        reason: `LOAD_BASED W=${Math.round(designW)} VD=${vdPct.toFixed(2)}% → ${g.sqmm}sqmm`,
      }
    }
  }
  // No gauge satisfies — return the largest with an overflow note.
  const last = sorted[sorted.length - 1]
  if (last) {
    const rPerM = resTable[last.sqmm] ?? 0
    const vDrop = current * rPerM * lengthM * 2
    const vdPct = voltage > 0 ? (vDrop / voltage) * 100 : 0
    return {
      gaugeMm2: last.sqmm,
      reason: `LOAD_BASED W=${Math.round(designW)} VD=${vdPct.toFixed(2)}% exceeds limit → ${last.sqmm}sqmm (max)`,
    }
  }
  return { reason: `LOAD_BASED W=${Math.round(designW)} → no wire catalog available` }
}

// ── GRADIENT_DRAIN ───────────────────────────────────────────────────────
//
// Drainage gradient sizing. Diameter is already chosen by FU (HUNTER on
// UPVC). This strategy records the required gradient on the branch's
// meta so verification + downstream BOQ can assert it. Phase 1 routes
// are planar polylines — the gradient is a logical attribute, not a Z
// translation.

function _gradientDrainSizeBranch(branch, ctx) {
  // Default to soil unless ctx/branch overrides.
  let gradient = ctx?.gradient
  if (!Number.isFinite(gradient)) {
    const sys = branch?.systemId ?? ''
    gradient = (sys === 'WASTE_DRAIN' || branch?.drainClass === 'WASTE')
      ? DRAIN_GRADIENTS.WASTE
      : DRAIN_GRADIENTS.SOIL
  }
  // Diameter from FU (delegate to HUNTER on the UPVC catalog).
  const hunterResult = _hunterSizeBranch(branch, ctx)
  const denom = Math.round(1 / gradient)
  return {
    diameterMm: hunterResult.diameterMm ?? null,
    gradient,
    reason: `GRADIENT_DRAIN 1:${denom} ${hunterResult.reason ?? ''}`.trim(),
  }
}

// ── Registry ─────────────────────────────────────────────────────────────

export const SIZING_STRATEGIES = Object.freeze({
  CATALOG: Object.freeze({
    id: 'CATALOG',
    label: 'Catalog Default',
    shipPhase: 'PHASE_0',
    impl: _catalogSizeBranch,
  }),
  HUNTER: Object.freeze({
    id: 'HUNTER',
    label: 'Hunter Curve (fixture units)',
    shipPhase: 'PHASE_2_6',
    impl: _hunterSizeBranch,
  }),
  LOAD_BASED: Object.freeze({
    id: 'LOAD_BASED',
    label: 'Load Based (voltage drop)',
    shipPhase: 'PHASE_2_6',
    impl: _loadBasedSizeBranch,
  }),
  GRADIENT_DRAIN: Object.freeze({
    id: 'GRADIENT_DRAIN',
    label: 'Gradient Drain (slope + fixture units)',
    shipPhase: 'PHASE_2_6',
    impl: _gradientDrainSizeBranch,
  }),
})

export function selectStrategy(strategyId) {
  const s = SIZING_STRATEGIES[strategyId]
  return s ? s.impl : null
}

export function listStrategies() {
  // Deterministic order: sort by id.
  return Object.values(SIZING_STRATEGIES).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  )
}
