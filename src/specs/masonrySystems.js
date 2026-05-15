// Masonry system registry — groups MATERIAL_LIBRARY units by construction system.
// A "system" pairs a unit family with a bonding method; consumers like the
// OpeningPanel picker iterate systems (for grouping) and resolve to units
// (for quantity calculation via MATERIAL_LIBRARY).
//
// Forward compatibility:
//   - Adding a new system = one entry here. Existing wall.materialKey stays valid.
//   - When ERP integration lands, this registry stays — only MATERIAL_LIBRARY
//     swaps to a fetched product catalog.

import { BONDING } from '../materials'

export const MASONRY_SYSTEMS = {
  CLAY_BRICK: {
    id:           'CLAY_BRICK',
    label:        'Clay Brick (cement mortar)',
    bondingType:  BONDING.CEMENT_SAND,
    description:  'Traditional fired clay bricks with cement-sand mortar (1:6).',
    units:        ['IS_MODULAR_BRICK', 'RED_CLAY_BRICK', 'FLY_ASH_BRICK'],
  },
  AAC_BLOCK_THIN: {
    id:           'AAC_BLOCK_THIN',
    label:        'AAC Block (thin-bed)',
    bondingType:  BONDING.THIN_BED,
    description:  'Autoclaved aerated concrete blocks with 3 mm thin-bed adhesive.',
    units:        ['AAC_BLOCK'],
  },
  CLC_BLOCK_THIN: {
    id:           'CLC_BLOCK_THIN',
    label:        'CLC Block (thin-bed)',
    bondingType:  BONDING.THIN_BED,
    description:  'Cellular lightweight concrete blocks with thin-bed adhesive.',
    units:        ['CLC_BLOCK'],
  },
  CONCRETE_BLOCK: {
    id:           'CONCRETE_BLOCK',
    label:        'Concrete Block (cement mortar)',
    bondingType:  BONDING.CEMENT_SAND,
    description:  'Solid or hollow concrete blocks with cement-sand mortar.',
    units:        ['CONCRETE_SOLID_BLOCK', 'CONCRETE_HOLLOW_BLOCK'],
  },
}

// Returns the system that owns a given unit key, or null.
export function getSystemForUnit(unitKey) {
  for (const sys of Object.values(MASONRY_SYSTEMS)) {
    if (sys.units.includes(unitKey)) return sys
  }
  return null
}

// Returns the systemId for a given unit key, or null.
export function getSystemIdForUnit(unitKey) {
  return getSystemForUnit(unitKey)?.id ?? null
}
