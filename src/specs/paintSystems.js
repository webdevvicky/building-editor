// Paint system registry — coverage rates per layer for paint material
// estimation (Gap 6).
//
// Engineers historically estimated paint by area (Sft) but procurement
// needs gallons / litres + layer counts. Each system declares the layer
// stack (neutralizer → putty → primer ×2 → finish ×2) with manufacturer
// coverage rates (Sft per gallon, typical for Asian Paints / Berger).
//
// Per-room override slot: room.paintSystemId (null = project default).
// Project default: projectSettings.defaultInteriorPaintSystemId /
// defaultExteriorPaintSystemId.
//
// efficiencyFactor (Addition 3): reserved field on every layer. v1
// computation multiplies coverage by efficiencyFactor (defaulted to 1.0
// — no effect today). v2 will lower it for rough plaster / texture paint.

export const CATALOG_VERSION = '2026-05-26-IS-2932-LATEX'
export const CATALOG_SOURCE  = 'IS 2932 / IS 5410 / IS 5411 / Asian Paints + Berger spec sheets'

// Coverage rates: Sft per gallon (2-coat application unless noted).
// Layers run in spec.layers order; sandpaper is units, not gallons.

function freeze(o) { return Object.freeze(o) }

export const PAINT_SYSTEM_REGISTRY = Object.freeze([
  freeze({
    id: 'STD_ACRYLIC_INTERIOR',
    label: 'Standard acrylic interior (3-coat)',
    appliesContext: 'interior_walls_and_ceiling',
    layers: Object.freeze([
      freeze({ id: 'NEUTRALIZER', label: 'Concrete neutralizer',                coats: 1, coverageSftPerGallon: 100, efficiencyFactor: 1.0 }),
      freeze({ id: 'PUTTY',       label: 'Wall putty',                          coats: 1, coverageSftPerGallon:  50, efficiencyFactor: 1.0 }),
      freeze({ id: 'PRIMER',      label: 'Primer (acrylic latex)',              coats: 2, coverageSftPerGallon:  80, efficiencyFactor: 1.0 }),
      freeze({ id: 'FINISH',      label: 'Finish coat (acrylic latex)',         coats: 2, coverageSftPerGallon:  60, efficiencyFactor: 1.0 }),
      freeze({ id: 'SANDPAPER',   label: 'Sandpaper sheets',                    coats: 1, unitsPerSft: 0.02,         efficiencyFactor: 1.0 }),
    ]),
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'PREMIUM_INTERIOR_LUXURY',
    label: 'Premium interior luxury (gloss/silk, 4-coat)',
    appliesContext: 'interior_walls_and_ceiling',
    layers: Object.freeze([
      freeze({ id: 'NEUTRALIZER', label: 'Concrete neutralizer',                coats: 1, coverageSftPerGallon: 100, efficiencyFactor: 1.0 }),
      freeze({ id: 'PUTTY',       label: 'Wall putty (premium)',                coats: 2, coverageSftPerGallon:  50, efficiencyFactor: 1.0 }),
      freeze({ id: 'PRIMER',      label: 'Acrylic primer',                      coats: 2, coverageSftPerGallon:  80, efficiencyFactor: 1.0 }),
      freeze({ id: 'FINISH',      label: 'Premium silk / luxury finish',        coats: 2, coverageSftPerGallon:  55, efficiencyFactor: 1.0 }),
      freeze({ id: 'SANDPAPER',   label: 'Sandpaper sheets',                    coats: 1, unitsPerSft: 0.03,         efficiencyFactor: 1.0 }),
    ]),
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'EXTERIOR_WEATHERSHIELD',
    label: 'Exterior weathershield (acrylic, 3-coat)',
    appliesContext: 'exterior_walls',
    layers: Object.freeze([
      freeze({ id: 'NEUTRALIZER',     label: 'Cement primer / neutralizer',     coats: 1, coverageSftPerGallon:  90, efficiencyFactor: 1.0 }),
      freeze({ id: 'EXT_PRIMER',      label: 'Exterior alkali-resistant primer',coats: 1, coverageSftPerGallon:  80, efficiencyFactor: 1.0 }),
      freeze({ id: 'EXT_FINISH',      label: 'Weathershield finish coat',       coats: 2, coverageSftPerGallon:  50, efficiencyFactor: 1.0 }),
    ]),
    version: CATALOG_VERSION,
  }),
])

export function getPaintSystem(id) {
  return PAINT_SYSTEM_REGISTRY.find(s => s.id === id) ?? null
}

export function listPaintSystems() {
  return PAINT_SYSTEM_REGISTRY
}

export const DEFAULT_INTERIOR_PAINT_SYSTEM_ID = 'STD_ACRYLIC_INTERIOR'
export const DEFAULT_EXTERIOR_PAINT_SYSTEM_ID = 'EXTERIOR_WEATHERSHIELD'
