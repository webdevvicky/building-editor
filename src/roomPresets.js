// ============================================================
// Room presets — templates for finish flags by room type.
//
// INVARIANT: Rooms ALWAYS store their own mutable copy of finishes.
// Never assign ROOM_PRESETS[type] directly to room.finishes.
// Always go through getPresetFinishes() or spread {...preset}.
//
// SCOPE BOUNDARY: finishes are booleans only.
// Do NOT evolve into { enabled, material, spec, rate, brand } here.
// Material specs and rates belong in Phase 3/4 (BOQ line items as
// first-class entities), not in room finish flags.
//
// Wall plaster is global by design — 95% of Indian residential construction
// has all walls plastered (structural surfacing for brick). Per-wall finish
// control (e.g., exposed brick feature walls) is Phase 2 work — needs
// wall-level finish flags, not room-level.
// ============================================================

export const ROOM_TYPES = [
  'BEDROOM', 'TOILET', 'KITCHEN', 'LIVING', 'DINING', 'FOYER',
  'STAIR', 'BALCONY', 'PARKING', 'SHAFT', 'TERRACE', 'GARDEN',
  'POOJA', 'STUDY', 'UTILITY', 'STORE', 'OTHER',
]

export const ROOM_TYPE_LABELS = {
  BEDROOM:  'Bedroom',
  TOILET:   'Toilet / Bathroom',
  KITCHEN:  'Kitchen',
  LIVING:   'Living Room',
  DINING:   'Dining Room',
  FOYER:    'Foyer / Entry',
  STAIR:    'Staircase',
  BALCONY:  'Balcony / Veranda',
  PARKING:  'Car Parking',
  SHAFT:    'Shaft / Void',
  TERRACE:  'Terrace / Courtyard',
  GARDEN:   'Garden',
  POOJA:    'Pooja Room',
  STUDY:    'Study / Office',
  UTILITY:  'Utility Room',
  STORE:    'Store Room',
  OTHER:    'Other',
}

// ALL_FINISHES: all five flags on (wallPlaster removed — global by design).
// Used for backward-compat migration of old rooms (preserves current BOQ behavior).
// Always spread when using — never assign this reference.
export const ALL_FINISHES = Object.freeze({
  flooring:       true,
  ceilingPlaster: true,
  paint:          true,
  waterproofing:  true,
  roofing:        true,
})

// Each preset is fully spelled out (no shared object references between types).
// Frozen so accidental mutation is caught at runtime.
export const ROOM_PRESETS = Object.freeze({
  BEDROOM:  Object.freeze({ flooring: true,  ceilingPlaster: true,  paint: true,  waterproofing: false, roofing: false }),
  TOILET:   Object.freeze({ flooring: true,  ceilingPlaster: true,  paint: true,  waterproofing: true,  roofing: false }),
  KITCHEN:  Object.freeze({ flooring: true,  ceilingPlaster: true,  paint: true,  waterproofing: false, roofing: false }),
  LIVING:   Object.freeze({ flooring: true,  ceilingPlaster: true,  paint: true,  waterproofing: false, roofing: false }),
  DINING:   Object.freeze({ flooring: true,  ceilingPlaster: true,  paint: true,  waterproofing: false, roofing: false }),
  FOYER:    Object.freeze({ flooring: true,  ceilingPlaster: true,  paint: true,  waterproofing: false, roofing: false }),
  STAIR:    Object.freeze({ flooring: true,  ceilingPlaster: true,  paint: true,  waterproofing: false, roofing: false }),
  BALCONY:  Object.freeze({ flooring: true,  ceilingPlaster: false, paint: true,  waterproofing: true,  roofing: false }),
  PARKING:  Object.freeze({ flooring: true,  ceilingPlaster: false, paint: false, waterproofing: false, roofing: false }),
  SHAFT:    Object.freeze({ flooring: false, ceilingPlaster: false, paint: false, waterproofing: false, roofing: false }),
  TERRACE:  Object.freeze({ flooring: false, ceilingPlaster: false, paint: false, waterproofing: true,  roofing: true  }),
  GARDEN:   Object.freeze({ flooring: false, ceilingPlaster: false, paint: false, waterproofing: false, roofing: false }),
  POOJA:    Object.freeze({ flooring: true,  ceilingPlaster: true,  paint: true,  waterproofing: false, roofing: false }),
  STUDY:    Object.freeze({ flooring: true,  ceilingPlaster: true,  paint: true,  waterproofing: false, roofing: false }),
  UTILITY:  Object.freeze({ flooring: true,  ceilingPlaster: false, paint: true,  waterproofing: false, roofing: false }),
  STORE:    Object.freeze({ flooring: true,  ceilingPlaster: false, paint: true,  waterproofing: false, roofing: false }),
  OTHER:    Object.freeze({
    // OTHER matches ALL_FINISHES intentionally: preserves backward compatibility
    // for old v1/v2 JSON during migration. Old rooms (no type field) become
    // OTHER + all-true, keeping their original BOQ contribution unchanged.
    flooring:       true,
    ceilingPlaster: true,
    paint:          true,
    waterproofing:  true,
    roofing:        true,
  }),
})

// Single safe way to get a fresh mutable copy of a preset.
// Falls back to OTHER for unknown/null types. Use this in store actions
// and migration — never assign ROOM_PRESETS[type] directly.
export function getPresetFinishes(type) {
  return { ...(ROOM_PRESETS[type] || ROOM_PRESETS.OTHER) }
}
