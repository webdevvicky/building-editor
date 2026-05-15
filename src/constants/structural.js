// Sand and aggregate ratios per m³ concrete reflect common Indian residential nominal mix
// practice (M20 ~ 1:1.5:3 by weight equivalent). Actual values vary by builder, package
// tier, and concrete design mix. Future ERP-integrated template system will allow
// per-builder overrides via projectSettings.concreteSettings.
// Current values: M7.5 PCC = 0.44 m³ sand + 0.88 m³ aggregate per m³ concrete;
// M20 RCC = 0.42 m³ sand + 0.84 m³ aggregate (split 35:65 between 10mm and 20mm).
// TODO Phase 2: Move to package template when ERP integration adds builder customization

export const CONCRETE_GRADE = {
  FOOTING: 'M20',
  COLUMN: 'M20',
  BEAM: 'M20',
  SLAB: 'M20',
  STAIRCASE: 'M20',
  PCC: 'M7_5',
}

export const CEMENT_KG_PER_M3 = { M7_5: 170, M15: 250, M20: 320, M25: 360 }

// Cement is by weight — no dry-to-wet factor applies.
// M7.5: 170 kg ÷ 50 kg/bag = 3.4 bags; M20: 320 kg ÷ 50 kg/bag = 6.4 bags
export const CEMENT_BAGS_PER_M3 = { M7_5: 3.4, M20: 6.4 }

export const STEEL_KG_PER_M3 = {
  FOOTING: 70,
  COLUMN: 130,
  BEAM: 110,
  SLAB: 90,
  STAIRCASE: 100,
  CIVIL_STAMP: 80,
}

// JRM spec: Foundation PCC uses 40mm gauge — 20mm aggregate only (no 10mm split for M7.5).
// M20 RCC: IS code split 10mm:20mm = 35:65.
export const AGGREGATE_SPLIT = {
  M7_5: { mm10Ratio: 0,    mm20Ratio: 1.0  },
  M20:  { mm10Ratio: 0.35, mm20Ratio: 0.65 },
}

// Dry-to-wet factor 1.54: procurement orders dry volumes, not wet-mix volumes.
// Applied ONLY to sand and aggregate — cement is weight-based, not subject to this factor.
export const DRY_WET_FACTOR = 1.54

// Per m³ of concrete — dry volumes (what procurement orders; multiply by DRY_WET_FACTOR
// to get wet volume if needed, but all BOQ output is in dry procurement quantities).
export const SAND_M3_PER_M3_DRY      = { M7_5: 0.44, M20: 0.42 }
export const AGGREGATE_M3_PER_M3_DRY = { M7_5: 0.88, M20: 0.84 }

// PCC bedding layer under every isolated footing — 50 mm standard Indian practice.
// Consumed by structuralSlice.js (getFootingQuantities) and columnFootingBeamFormulas.js.
export const PCC_BEDDING_THICKNESS_FT = 2 / 12
