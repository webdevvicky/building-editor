// Static material library — intentional scaffolding.
// When jrm-saas ERP integration lands, replace this constant with an ERP product
// catalog fetch. Consumers (getMaterialQuantities, OpeningPanel, BOQPanel) stay the
// same — only this import source changes.

export const BONDING = {
  CEMENT_SAND: 'CEMENT_SAND_MORTAR',
  THIN_BED:    'THIN_BED_ADHESIVE',
}

// Field naming:
//   bricksPerFt3  — brick types (IS modular, red clay, fly ash)
//   blocksPerFt3  — block types (AAC, CLC, concrete solid/hollow)
// Consuming code: const unitCount = volFt3 * (mat.bricksPerFt3 ?? mat.blocksPerFt3)
//
// Mortar quantities (CEMENT_SAND types):
//   mortarVolPerFt3Wall      — ft³ of mortar per ft³ of wall volume
//   cementBagsPerFt3Mortar   — 50 kg bags per ft³ of wet mortar (1:6 mix, Indian site practice)
//   sandFt3PerFt3Mortar      — loose ft³ sand per ft³ of wet mortar (dry-to-wet factor included)
//
// Adhesive quantities (THIN_BED types):
//   adhesiveKgPerFt2  — kg of thin-bed adhesive per ft² of wall face area
//   adhesiveBagKg     — kg per bag (standard TN market: 40 kg)
//   AAC: 3.0 kg/m² = 0.28 kg/ft² (Birla Aerocon / Magicrete / UltraTech Xtralite spec)
//   CLC: 2.5 kg/m² = 0.23 kg/ft² (smoother surface, slightly lower usage)

export const MATERIAL_LIBRARY = {
  IS_MODULAR_BRICK: {
    name:        'IS Modular Brick (200×100×100)',
    dimensions:  { L: 200, W: 100, H: 100 },
    bondingType: BONDING.CEMENT_SAND,
    bricksPerFt3:          11.5,
    mortarVolPerFt3Wall:    0.21,
    cementBagsPerFt3Mortar: 0.18,
    sandFt3PerFt3Mortar:    1.30,
  },
  RED_CLAY_BRICK: {
    name:        'Red Clay Brick (230×110×75)',
    dimensions:  { L: 230, W: 110, H: 75 },
    bondingType: BONDING.CEMENT_SAND,
    bricksPerFt3:          11.5,
    mortarVolPerFt3Wall:    0.22,
    cementBagsPerFt3Mortar: 0.18,
    sandFt3PerFt3Mortar:    1.30,
  },
  FLY_ASH_BRICK: {
    name:        'Fly Ash Brick (230×110×75)',
    dimensions:  { L: 230, W: 110, H: 75 },
    bondingType: BONDING.CEMENT_SAND,
    bricksPerFt3:          11.5,
    mortarVolPerFt3Wall:    0.22,
    cementBagsPerFt3Mortar: 0.18,
    sandFt3PerFt3Mortar:    1.30,
  },
  AAC_BLOCK: {
    name:        'AAC Block (600×200×200)',
    dimensions:  { L: 600, W: 200, H: 200 },
    bondingType: BONDING.THIN_BED,
    blocksPerFt3:     1.14,
    adhesiveKgPerFt2: 0.28,
    adhesiveBagKg:    40,
  },
  CLC_BLOCK: {
    name:        'CLC Block (600×200×200)',
    dimensions:  { L: 600, W: 200, H: 200 },
    bondingType: BONDING.THIN_BED,
    blocksPerFt3:     1.14,
    adhesiveKgPerFt2: 0.23,
    adhesiveBagKg:    40,
  },
  CONCRETE_SOLID_BLOCK: {
    name:        'Concrete Solid Block (400×200×200)',
    dimensions:  { L: 400, W: 200, H: 200 },
    bondingType: BONDING.CEMENT_SAND,
    blocksPerFt3:          1.57,
    mortarVolPerFt3Wall:    0.18,
    cementBagsPerFt3Mortar: 0.18,
    sandFt3PerFt3Mortar:    1.30,
  },
  CONCRETE_HOLLOW_BLOCK: {
    name:        'Concrete Hollow Block (400×200×200)',
    dimensions:  { L: 400, W: 200, H: 200 },
    bondingType: BONDING.CEMENT_SAND,
    blocksPerFt3:          1.57,
    mortarVolPerFt3Wall:    0.10,   // hollow cores reduce mortar volume
    cementBagsPerFt3Mortar: 0.18,
    sandFt3PerFt3Mortar:    1.30,
  },
}
