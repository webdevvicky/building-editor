// Opening-hardware resolver — single home for the fallback chain.
//
// Fallback (mirrors src/specs/resolution.js for BBS):
//   opening.hardwareSetId
//     → projectSettings.doorHardwareDefaults[opening.subtype]   (door subtypes)
//     → projectSettings.windowHardwareDefaults[opening.subtype] (window/ventilator)
//     → NONE (no hardware emitted)
//
// Per-opening fine-grained adjustments stack ON TOP of the resolved set:
//   opening.hardwareOverrides = { add: [{itemId, qty}], remove: [itemId] }
//
// Returns:
//   {
//     setId, setLabel,
//     source: 'EXPLICIT' | 'PROJECT_DEFAULT' | 'NONE',
//     items:  [{ itemId, qty, source: 'SET' | 'OVERRIDE_ADD' }],
//     parent: 'door' | 'window' | null,
//   }

import { getAnyHardwareSet } from './hardwareSets.js'

export const HARDWARE_RESOLUTION_SOURCE = Object.freeze({
  EXPLICIT:        'EXPLICIT',         // opening.hardwareSetId set
  PROJECT_DEFAULT: 'PROJECT_DEFAULT',  // inherits from per-subtype default
  NONE:            'NONE',             // no set resolved (eg. ventilator with no project default)
})

function _subtypeToDefault(state, subtype) {
  const ps = state?.projectSettings
  if (!ps) return null
  if (subtype === 'WINDOW' || subtype === 'VENTILATOR') {
    return ps.windowHardwareDefaults?.[subtype] ?? null
  }
  return ps.doorHardwareDefaults?.[subtype] ?? null
}

// Resolve hardware for a single opening shape:
//   { id, subtype, hardwareSetId?, hardwareOverrides? }
export function resolveOpeningHardware(state, opening) {
  if (!opening) {
    return { setId: null, setLabel: null, source: HARDWARE_RESOLUTION_SOURCE.NONE, items: [], parent: null }
  }
  const explicit = opening.hardwareSetId ?? null
  const fallback = explicit ?? _subtypeToDefault(state, opening.subtype)
  const set = fallback ? getAnyHardwareSet(fallback) : null
  const source = explicit
    ? HARDWARE_RESOLUTION_SOURCE.EXPLICIT
    : (fallback ? HARDWARE_RESOLUTION_SOURCE.PROJECT_DEFAULT : HARDWARE_RESOLUTION_SOURCE.NONE)

  // Compose items: set items minus removals plus additions.
  const removeSet = new Set((opening.hardwareOverrides?.remove ?? []))
  const items = []
  if (set) {
    for (const it of set.items) {
      if (removeSet.has(it.itemId)) continue
      items.push({ itemId: it.itemId, qty: it.qty, source: 'SET' })
    }
  }
  for (const add of (opening.hardwareOverrides?.add ?? [])) {
    if (!add?.itemId) continue
    items.push({ itemId: add.itemId, qty: add.qty ?? 1, source: 'OVERRIDE_ADD' })
  }

  return {
    setId:    fallback ?? null,
    setLabel: set?.label ?? null,
    source,
    items,
    parent:   opening.type ?? null,
  }
}

export function humanizeHardwareSource(source) {
  if (source === HARDWARE_RESOLUTION_SOURCE.EXPLICIT)         return 'per-opening override'
  if (source === HARDWARE_RESOLUTION_SOURCE.PROJECT_DEFAULT)  return 'project default'
  return 'none'
}
