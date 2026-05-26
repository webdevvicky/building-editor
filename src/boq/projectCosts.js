// Project costs computation (Gap 8) — labor / supervision / overhead /
// profit / GST roll-up on top of the materials BOQ grand total.
//
// projectSettings.projectCosts = {
//   laborMode:        'percent' | 'lumpsum',
//   laborPercent:     15,
//   laborLumpsum:     0,
//   supervisionMode:  'percent' | 'lumpsum',
//   supervisionPercent: 5,
//   supervisionLumpsum: 0,
//   overheadPercent:  0,
//   profitPercent:    0,
//   gstPercent:       18,
//   gstAppliesToLabor: false,
// }
//
// Renders on Summary sheet / PDF cover — NOT as BOQ lines.

import { safeR2 as r2 } from '../lib/numbers.js'

export const DEFAULT_PROJECT_COSTS = Object.freeze({
  laborMode:          'percent',
  laborPercent:       15,
  laborLumpsum:       0,
  supervisionMode:    'percent',
  supervisionPercent: 5,
  supervisionLumpsum: 0,
  overheadPercent:    0,
  profitPercent:      0,
  gstPercent:         18,
  gstAppliesToLabor:  false,
})

function _component(mode, percent, lumpsum, base) {
  if (mode === 'lumpsum') return Math.max(0, lumpsum ?? 0)
  return Math.max(0, base * ((percent ?? 0) / 100))
}

export function computeProjectCosts(materialSubtotal, pc) {
  const cfg = { ...DEFAULT_PROJECT_COSTS, ...(pc ?? {}) }
  const safeBase = Math.max(0, materialSubtotal ?? 0)

  const laborCost       = _component(cfg.laborMode,       cfg.laborPercent,       cfg.laborLumpsum,       safeBase)
  const supervisionCost = _component(cfg.supervisionMode, cfg.supervisionPercent, cfg.supervisionLumpsum, safeBase)
  const overheadCost    = safeBase * ((cfg.overheadPercent ?? 0) / 100)
  const profitCost      = safeBase * ((cfg.profitPercent   ?? 0) / 100)

  const gstBase = cfg.gstAppliesToLabor
    ? (safeBase + laborCost + supervisionCost + overheadCost + profitCost)
    : safeBase
  const gstCost = gstBase * ((cfg.gstPercent ?? 0) / 100)

  const grandTotal = safeBase + laborCost + supervisionCost + overheadCost + profitCost + gstCost

  const breakdown = [
    { label: 'Materials subtotal',                                amount: r2(safeBase),       basisLabel: '' },
    { label: cfg.laborMode === 'lumpsum'
        ? 'Labor (lumpsum)'
        : `Labor (${cfg.laborPercent}% of materials)`,            amount: r2(laborCost),      basisLabel: cfg.laborMode },
    { label: cfg.supervisionMode === 'lumpsum'
        ? 'Supervision (lumpsum)'
        : `Supervision (${cfg.supervisionPercent}% of materials)`, amount: r2(supervisionCost), basisLabel: cfg.supervisionMode },
    ...(cfg.overheadPercent > 0
        ? [{ label: `Overhead (${cfg.overheadPercent}%)`, amount: r2(overheadCost), basisLabel: 'percent' }] : []),
    ...(cfg.profitPercent   > 0
        ? [{ label: `Profit (${cfg.profitPercent}%)`,     amount: r2(profitCost),   basisLabel: 'percent' }] : []),
    { label: `GST (${cfg.gstPercent}%${cfg.gstAppliesToLabor ? ' on all' : ' on materials'})`,
      amount: r2(gstCost), basisLabel: 'gst' },
  ]

  return {
    materialSubtotal: r2(safeBase),
    laborCost:        r2(laborCost),
    supervisionCost:  r2(supervisionCost),
    overheadCost:     r2(overheadCost),
    profitCost:       r2(profitCost),
    gstCost:          r2(gstCost),
    grandTotal:       r2(grandTotal),
    breakdown,
    config:           cfg,
  }
}
