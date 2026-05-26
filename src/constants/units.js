// Unit constants registry — single source of truth for BOQ line `unit` field
// strings. All emitters under src/boq/ import from here. Raw unit strings
// ('ft²', 'Sft', 'kg', etc.) MUST NOT appear inline in any emitter.
//
// Convention:
//   - Legacy structural/MEP lines use FT2 / FT3 (the existing display).
//   - New joinery / tiles / grills emitters use SFT / CFT (Indian
//     residential convention). They are aliases for the same physical
//     quantity but match the headers procurement teams expect.
//   - RFT = running feet (linear) — frames, skirting, handrails.
//
// Grep guard: `grep -rn "unit: '" src/boq/` must return zero matches.

export const UNITS = Object.freeze({
  NOS:    'nos',     // count
  RFT:    'Rft',     // running feet (linear)
  SFT:    'Sft',     // square feet (Indian residential header)
  CFT:    'Cft',     // cubic feet (Indian residential header)
  KG:     'kg',      // kilograms
  BAG:    'bags',    // cement / adhesive bags
  M3:     'm³',      // cubic metres
  SQM:    'sqm',     // square metres (ceiling finish materials)
  FT:     'ft',      // raw length
  FT2:    'ft²',     // square feet (legacy structural display)
  FT3:    'ft³',     // cubic feet (legacy structural display)
  GALLON: 'gal',     // paint coverage (Indian residential convention)
  LITRE:  'L',       // alt paint coverage
})
