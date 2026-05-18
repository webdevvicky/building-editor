// Electrical sizing constants — voltage / resistance / drop limits.
//
// Source: IS 732 (Indian electrical installation code) + IS 8130
// (copper conductor resistivity). All values single-phase residential
// 230V AC.
//
// Resistance values are nominal conductor resistance per meter at 20°C
// for stranded copper, derived from copper resistivity ρ ≈ 0.01724
// Ω·mm²/m → R/m = ρ / A.  Cross-checked against IS 8130 Table 3 (DC
// resistance at 20°C for circular-conductor copper cables).
//
// Pure constants. No state, no side effects.

export const CATALOG_VERSION = '2026-05-IS-732-8130'
export const CATALOG_SOURCE = 'IS 732 / IS 8130'

// Indian residential single-phase nominal voltage (V).
export const NOMINAL_VOLTAGE_V = 230

// Voltage-drop limit (percent of nominal). IS 732 cl. 13.3.1 caps total
// final-circuit drop at 3% from origin of installation to any point.
export const MAX_VOLTAGE_DROP_PERCENT = 3

// Copper conductor resistance Ω per meter at 20°C, indexed by cross-section
// in mm². Single-conductor copper, stranded, derived from ρ_Cu = 0.01724
// Ω·mm²/m. Values rounded to 5 significant figures.
export const RESISTANCE_OHM_PER_M_BY_SQMM = Object.freeze({
  1.0: 0.01724,
  1.5: 0.01149,
  2.5: 0.006896,
  4.0: 0.004310,
  6.0: 0.002873,
  10:  0.001724,
  16:  0.001078,
})

export function getResistanceOhmPerM(sqmm) {
  return RESISTANCE_OHM_PER_M_BY_SQMM[sqmm] ?? null
}

// Power factor for residential (mixed inductive + resistive). IS 732
// uses 0.85 for general LV calcs; we follow.
export const POWER_FACTOR = 0.85

// Drainage gradient table (rise/run). Re-exported from drainage.js so
// strategy code can read it without a plumbing import. Kept in sync.
export const DRAIN_GRADIENTS = Object.freeze({
  SOIL:  1 / 80,   // 12.5 mm/m — IS 1742
  WASTE: 1 / 40,   // 25 mm/m   — IS 1742
})
