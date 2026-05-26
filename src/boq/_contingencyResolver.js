// Contingency resolver (Gap 2 / Addition 2) — single-source % lookup.
//
// projectSettings.contingency:
//   {
//     defaultPercent:    10,
//     overrides:         { steel: 5, joinery: 5, plumbing: 5, ... },
//     excludedCategories:['project_costs', ...],
//     displayMode:       'clean' | 'detailed',   // exporters only
//   }
//
// Returns 0 when:
//   - contingency block absent (Phase A — pre-Gap-2 state)
//   - line.category in excludedCategories
//   - line.unit ∈ {nos, set, lumpsum}  (fixed counts never get %)
//
// Otherwise: overrides[category] ?? defaultPercent.

import { UNITS } from '../constants/units.js'

const FIXED_COUNT_UNITS = new Set([UNITS.NOS, 'set', 'lumpsum'])

function _readContingency(state) {
  return state?.projectSettings?.contingency ?? null
}

export function resolveContingencyPctForLine(state, line) {
  if (!line) return 0
  const cont = _readContingency(state)
  if (!cont) return 0
  if (cont.defaultPercent === undefined && (!cont.overrides || Object.keys(cont.overrides).length === 0)) return 0
  const excluded = new Set(cont.excludedCategories ?? [])
  if (excluded.has(line.category)) return 0
  if (FIXED_COUNT_UNITS.has(line.unit)) return 0
  if (line.contingencyPct === 0) return 0
  const override = cont.overrides?.[line.category]
  if (typeof override === 'number') return override
  return cont.defaultPercent ?? 0
}

export function resolveContingencyDisplayMode(state) {
  return _readContingency(state)?.displayMode ?? 'clean'
}

export function resolveContingencyDefaults(state) {
  const c = _readContingency(state)
  return {
    defaultPercent: c?.defaultPercent ?? 0,
    overrides:      c?.overrides ?? {},
    displayMode:    c?.displayMode ?? 'clean',
    excludedCategories: c?.excludedCategories ?? [],
  }
}
