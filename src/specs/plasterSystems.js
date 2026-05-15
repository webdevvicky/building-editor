// Plaster system registry.
// Replaces the dead `projectSettings.plasterThicknessMm` slot. Each system
// declares enough metadata to compute plaster quantities (cement bags / sand
// for cement-sand, kg / bags for gypsum/POP).
//
// Override resolution (in priority order):
//   1. room.plasterSystemId            (Phase 1.6f per-room override)
//   2. projectSettings.defaultPlasterSystemId
// Phase 2+ may add wall.plasterSystemId for feature walls — extend
// resolveRoomPlasterSystem to take a wall override when that lands.
//
// Quantity rates are illustrative starting points; ERP integration replaces
// them later. Source notes:
//   Cement-sand 12 mm: 0.18 bag cement/m², 0.013 m³ sand/m² (1:6 mix)
//   Cement-sand 15 mm: 0.22 bag cement/m², 0.016 m³ sand/m² (1:6 mix)
//   Gypsum 12 mm: 10 kg/m² typical premix gypsum plaster (25 kg bags)
//   POP 12 mm:    11 kg/m² typical premix POP punning  (25 kg bags)

export const PLASTER_KIND = {
  CEMENT_SAND: 'CEMENT_SAND',
  GYPSUM:      'GYPSUM',
  POP:         'POP',
}

export const PLASTER_SYSTEMS = {
  CEMENT_SAND_INTERNAL: {
    id:               'CEMENT_SAND_INTERNAL',
    label:            'Cement-Sand 12 mm (internal)',
    kind:             PLASTER_KIND.CEMENT_SAND,
    thicknessMm:      12,
    cementBagsPerM2:  0.18,
    sandM3PerM2:      0.013,
    appliesTo:        ['walls', 'ceiling'],
    appliesContext:   'internal',
  },
  CEMENT_SAND_EXTERNAL: {
    id:               'CEMENT_SAND_EXTERNAL',
    label:            'Cement-Sand 15 mm (external)',
    kind:             PLASTER_KIND.CEMENT_SAND,
    thicknessMm:      15,
    cementBagsPerM2:  0.22,
    sandM3PerM2:      0.016,
    appliesTo:        ['walls'],
    appliesContext:   'external',
  },
  CEMENT_SAND_CEILING: {
    id:               'CEMENT_SAND_CEILING',
    label:            'Cement-Sand 10 mm (ceiling)',
    kind:             PLASTER_KIND.CEMENT_SAND,
    thicknessMm:      10,
    cementBagsPerM2:  0.15,
    sandM3PerM2:      0.011,
    appliesTo:        ['ceiling'],
    appliesContext:   'internal',
  },
  GYPSUM: {
    id:               'GYPSUM',
    label:            'Gypsum 12 mm',
    kind:             PLASTER_KIND.GYPSUM,
    thicknessMm:      12,
    materialKgPerM2:  10,
    materialBagKg:    25,
    appliesTo:        ['walls', 'ceiling'],
    appliesContext:   'internal',
  },
  POP: {
    id:               'POP',
    label:            'POP punning 12 mm',
    kind:             PLASTER_KIND.POP,
    thicknessMm:      12,
    materialKgPerM2:  11,
    materialBagKg:    25,
    appliesTo:        ['walls', 'ceiling'],
    appliesContext:   'internal',
  },
}

export const DEFAULT_PLASTER_SYSTEM_ID = 'CEMENT_SAND_INTERNAL'

// Resolve plaster system for a given room. Falls back through:
//   room.plasterSystemId → projectSettings.defaultPlasterSystemId → DEFAULT_PLASTER_SYSTEM_ID
export function resolveRoomPlasterSystem(room, projectSettings) {
  const id = room?.plasterSystemId
    ?? projectSettings?.defaultPlasterSystemId
    ?? DEFAULT_PLASTER_SYSTEM_ID
  return PLASTER_SYSTEMS[id] ?? PLASTER_SYSTEMS[DEFAULT_PLASTER_SYSTEM_ID]
}

// 1 ft² = 0.092903 m²
export const FT2_TO_M2 = 0.092903
