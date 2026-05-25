// Joinery registry — opening subtype definitions for BOQ joinery aggregator.
//
// Every opening (door / window) carries a `subtype` field. Subtypes split
// the BOQ procurement rollup into procurement-relevant buckets:
//
//   MAIN_DOOR      — primary entrance door (1 per residence typically).
//                    Larger, heavier, often safety-grilled.
//   INTERNAL_DOOR  — bedroom / toilet / utility internal doors.
//   WINDOW         — standard window with shutters.
//   VENTILATOR     — small fixed louver above doors / in toilets.
//                    No shutter; frame + area only.

export const OPENING_SUBTYPE = Object.freeze({
  MAIN_DOOR:     'MAIN_DOOR',
  INTERNAL_DOOR: 'INTERNAL_DOOR',
  WINDOW:        'WINDOW',
  VENTILATOR:    'VENTILATOR',
})

export const OPENING_SUBTYPE_REGISTRY = Object.freeze([
  Object.freeze({ id: OPENING_SUBTYPE.MAIN_DOOR,     label: 'Main door',     parentType: 'door',   hasShutter: true  }),
  Object.freeze({ id: OPENING_SUBTYPE.INTERNAL_DOOR, label: 'Internal door', parentType: 'door',   hasShutter: true  }),
  Object.freeze({ id: OPENING_SUBTYPE.WINDOW,        label: 'Window',        parentType: 'window', hasShutter: true  }),
  Object.freeze({ id: OPENING_SUBTYPE.VENTILATOR,    label: 'Ventilator',    parentType: 'window', hasShutter: false }),
])

// Used as both source-of-truth label dictionary AND parent-type filter
// in OpeningDetailPanel's subtype dropdown.
export function getOpeningSubtypeDef(id) {
  return OPENING_SUBTYPE_REGISTRY.find(s => s.id === id) ?? null
}

export function getOpeningSubtypesByParent(parentType) {
  return OPENING_SUBTYPE_REGISTRY.filter(s => s.parentType === parentType)
}

// Subtype source tracking — surface "Auto-detected" badge in panel when
// heuristic picked the value vs the user.
export const SUBTYPE_SOURCE = Object.freeze({
  EXPLICIT:  'EXPLICIT',
  HEURISTIC: 'HEURISTIC',
})

// Ventilator detection thresholds — small opening = louver.
export const VENTILATOR_MAX_HEIGHT_IN = 18
export const VENTILATOR_MAX_WIDTH_IN  = 36
