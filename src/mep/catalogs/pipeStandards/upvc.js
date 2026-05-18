export const CATALOG_VERSION = '2026-05-IS-13592'
export const CATALOG_SOURCE = 'IS 13592'

const ZONES = Object.freeze({ WALL: 1.00, CEILING: 1.05, FLOOR: 1.00, SHAFT: 1.05, EXTERNAL: 1.10, UNDERGROUND: 1.00 })

export const UPVC_DIAMETERS = Object.freeze([
  Object.freeze({
    nominalMm: 32, odMm: 32, irMm: 28.8,
    pressureClass: 'Type-A',
    fixtureUnitsCarried: 2, maxFlowLpm: 0,
    ratePerMRateKey: 'plumbing_upvc_32mm',
    elbowRateKey: 'plumbing_upvc_elbow_32mm',
    teeRateKey: 'plumbing_upvc_tee_32mm',
    reducerToPrevRateKey: null,
    zoneMultipliers: ZONES,
    ifcMaterial: 'PEMaterial_uPVC',
    classificationCode: 'Pr_65_52_07_72',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    nominalMm: 40, odMm: 40, irMm: 36.4,
    pressureClass: 'Type-A',
    fixtureUnitsCarried: 4, maxFlowLpm: 0,
    ratePerMRateKey: 'plumbing_upvc_40mm',
    elbowRateKey: 'plumbing_upvc_elbow_40mm',
    teeRateKey: 'plumbing_upvc_tee_40mm',
    reducerToPrevRateKey: 'plumbing_upvc_reducer_40_32',
    zoneMultipliers: ZONES,
    ifcMaterial: 'PEMaterial_uPVC',
    classificationCode: 'Pr_65_52_07_74',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    nominalMm: 50, odMm: 50, irMm: 46.2,
    pressureClass: 'Type-A',
    fixtureUnitsCarried: 8, maxFlowLpm: 0,
    ratePerMRateKey: 'plumbing_upvc_50mm',
    elbowRateKey: 'plumbing_upvc_elbow_50mm',
    teeRateKey: 'plumbing_upvc_tee_50mm',
    reducerToPrevRateKey: 'plumbing_upvc_reducer_50_40',
    zoneMultipliers: ZONES,
    ifcMaterial: 'PEMaterial_uPVC',
    classificationCode: 'Pr_65_52_07_75',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    nominalMm: 75, odMm: 75, irMm: 70.6,
    pressureClass: 'Type-A',
    fixtureUnitsCarried: 14, maxFlowLpm: 0,
    ratePerMRateKey: 'plumbing_upvc_75mm',
    elbowRateKey: 'plumbing_upvc_elbow_75mm',
    teeRateKey: 'plumbing_upvc_tee_75mm',
    reducerToPrevRateKey: 'plumbing_upvc_reducer_75_50',
    zoneMultipliers: ZONES,
    ifcMaterial: 'PEMaterial_uPVC',
    classificationCode: 'Pr_65_52_07_77',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    nominalMm: 110, odMm: 110, irMm: 103.6,
    pressureClass: 'Type-B',
    fixtureUnitsCarried: 40, maxFlowLpm: 0,
    ratePerMRateKey: 'plumbing_upvc_110mm',
    elbowRateKey: 'plumbing_upvc_elbow_110mm',
    teeRateKey: 'plumbing_upvc_tee_110mm',
    reducerToPrevRateKey: 'plumbing_upvc_reducer_110_75',
    zoneMultipliers: ZONES,
    ifcMaterial: 'PEMaterial_uPVC',
    classificationCode: 'Pr_65_52_07_78',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    nominalMm: 160, odMm: 160, irMm: 151.0,
    pressureClass: 'Type-B',
    fixtureUnitsCarried: 100, maxFlowLpm: 0,
    ratePerMRateKey: 'plumbing_upvc_160mm',
    elbowRateKey: 'plumbing_upvc_elbow_160mm',
    teeRateKey: 'plumbing_upvc_tee_160mm',
    reducerToPrevRateKey: 'plumbing_upvc_reducer_160_110',
    zoneMultipliers: ZONES,
    ifcMaterial: 'PEMaterial_uPVC',
    classificationCode: 'Pr_65_52_07_79',
    version: CATALOG_VERSION,
  }),
])

export function getUpvcDiameter(nominalMm) {
  return UPVC_DIAMETERS.find(d => d.nominalMm === nominalMm) || null
}
export function listUpvcDiameters() { return UPVC_DIAMETERS }
