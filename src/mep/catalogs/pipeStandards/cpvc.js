export const CATALOG_VERSION = '2026-05-IS-15778'
export const CATALOG_SOURCE = 'IS 15778:2007'

const ZONES = Object.freeze({ WALL: 1.00, CEILING: 1.05, FLOOR: 1.00, SHAFT: 1.05, EXTERNAL: 1.10, UNDERGROUND: 1.00 })

export const CPVC_DIAMETERS = Object.freeze([
  Object.freeze({
    nominalMm: 15, odMm: 16.6, irMm: 13.4,
    pressureClass: 'SDR-11',
    fixtureUnitsCarried: 4, maxFlowLpm: 30,
    ratePerMRateKey: 'plumbing_cpvc_15mm',
    elbowRateKey: 'plumbing_cpvc_elbow_15mm',
    teeRateKey: 'plumbing_cpvc_tee_15mm',
    reducerToPrevRateKey: null,
    zoneMultipliers: ZONES,
    ifcMaterial: 'PEMaterial_CPVC_Sch80',
    classificationCode: 'Pr_65_52_07_15',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    nominalMm: 20, odMm: 22.2, irMm: 18.0,
    pressureClass: 'SDR-11',
    fixtureUnitsCarried: 10, maxFlowLpm: 60,
    ratePerMRateKey: 'plumbing_cpvc_20mm',
    elbowRateKey: 'plumbing_cpvc_elbow_20mm',
    teeRateKey: 'plumbing_cpvc_tee_20mm',
    reducerToPrevRateKey: 'plumbing_cpvc_reducer_20_15',
    zoneMultipliers: ZONES,
    ifcMaterial: 'PEMaterial_CPVC_Sch80',
    classificationCode: 'Pr_65_52_07_20',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    nominalMm: 25, odMm: 28.6, irMm: 23.4,
    pressureClass: 'SDR-11',
    fixtureUnitsCarried: 20, maxFlowLpm: 100,
    ratePerMRateKey: 'plumbing_cpvc_25mm',
    elbowRateKey: 'plumbing_cpvc_elbow_25mm',
    teeRateKey: 'plumbing_cpvc_tee_25mm',
    reducerToPrevRateKey: 'plumbing_cpvc_reducer_25_20',
    zoneMultipliers: ZONES,
    ifcMaterial: 'PEMaterial_CPVC_Sch80',
    classificationCode: 'Pr_65_52_07_25',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    nominalMm: 32, odMm: 34.8, irMm: 28.4,
    pressureClass: 'SDR-11',
    fixtureUnitsCarried: 40, maxFlowLpm: 160,
    ratePerMRateKey: 'plumbing_cpvc_32mm',
    elbowRateKey: 'plumbing_cpvc_elbow_32mm',
    teeRateKey: 'plumbing_cpvc_tee_32mm',
    reducerToPrevRateKey: 'plumbing_cpvc_reducer_32_25',
    zoneMultipliers: ZONES,
    ifcMaterial: 'PEMaterial_CPVC_Sch80',
    classificationCode: 'Pr_65_52_07_32',
    version: CATALOG_VERSION,
  }),
])

export function getCpvcDiameter(nominalMm) {
  return CPVC_DIAMETERS.find(d => d.nominalMm === nominalMm) || null
}
export function listCpvcDiameters() { return CPVC_DIAMETERS }
