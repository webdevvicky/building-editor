export const CATALOG_VERSION = '2026-05-IS-1239'
export const CATALOG_SOURCE = 'IS 1239'

const ZONES = Object.freeze({ WALL: 1.00, CEILING: 1.05, FLOOR: 1.00, SHAFT: 1.05, EXTERNAL: 1.10, UNDERGROUND: 1.00 })

export const GI_DIAMETERS = Object.freeze([
  Object.freeze({
    nominalMm: 15, odMm: 21.3, irMm: 16.1,
    pressureClass: 'Medium',
    fixtureUnitsCarried: 4, maxFlowLpm: 30,
    ratePerMRateKey: 'plumbing_gi_15mm',
    elbowRateKey: 'plumbing_gi_elbow_15mm',
    teeRateKey: 'plumbing_gi_tee_15mm',
    reducerToPrevRateKey: null,
    zoneMultipliers: ZONES,
    ifcMaterial: 'IfcMaterial_GalvanizedSteel',
    classificationCode: 'Pr_65_52_07_40',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    nominalMm: 20, odMm: 26.9, irMm: 21.5,
    pressureClass: 'Medium',
    fixtureUnitsCarried: 10, maxFlowLpm: 60,
    ratePerMRateKey: 'plumbing_gi_20mm',
    elbowRateKey: 'plumbing_gi_elbow_20mm',
    teeRateKey: 'plumbing_gi_tee_20mm',
    reducerToPrevRateKey: 'plumbing_gi_reducer_20_15',
    zoneMultipliers: ZONES,
    ifcMaterial: 'IfcMaterial_GalvanizedSteel',
    classificationCode: 'Pr_65_52_07_41',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    nominalMm: 25, odMm: 33.7, irMm: 27.3,
    pressureClass: 'Medium',
    fixtureUnitsCarried: 20, maxFlowLpm: 100,
    ratePerMRateKey: 'plumbing_gi_25mm',
    elbowRateKey: 'plumbing_gi_elbow_25mm',
    teeRateKey: 'plumbing_gi_tee_25mm',
    reducerToPrevRateKey: 'plumbing_gi_reducer_25_20',
    zoneMultipliers: ZONES,
    ifcMaterial: 'IfcMaterial_GalvanizedSteel',
    classificationCode: 'Pr_65_52_07_42',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    nominalMm: 32, odMm: 42.4, irMm: 35.9,
    pressureClass: 'Medium',
    fixtureUnitsCarried: 40, maxFlowLpm: 160,
    ratePerMRateKey: 'plumbing_gi_32mm',
    elbowRateKey: 'plumbing_gi_elbow_32mm',
    teeRateKey: 'plumbing_gi_tee_32mm',
    reducerToPrevRateKey: 'plumbing_gi_reducer_32_25',
    zoneMultipliers: ZONES,
    ifcMaterial: 'IfcMaterial_GalvanizedSteel',
    classificationCode: 'Pr_65_52_07_43',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    nominalMm: 40, odMm: 48.3, irMm: 41.8,
    pressureClass: 'Medium',
    fixtureUnitsCarried: 70, maxFlowLpm: 240,
    ratePerMRateKey: 'plumbing_gi_40mm',
    elbowRateKey: 'plumbing_gi_elbow_40mm',
    teeRateKey: 'plumbing_gi_tee_40mm',
    reducerToPrevRateKey: 'plumbing_gi_reducer_40_32',
    zoneMultipliers: ZONES,
    ifcMaterial: 'IfcMaterial_GalvanizedSteel',
    classificationCode: 'Pr_65_52_07_44',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    nominalMm: 50, odMm: 60.3, irMm: 53.0,
    pressureClass: 'Medium',
    fixtureUnitsCarried: 120, maxFlowLpm: 380,
    ratePerMRateKey: 'plumbing_gi_50mm',
    elbowRateKey: 'plumbing_gi_elbow_50mm',
    teeRateKey: 'plumbing_gi_tee_50mm',
    reducerToPrevRateKey: 'plumbing_gi_reducer_50_40',
    zoneMultipliers: ZONES,
    ifcMaterial: 'IfcMaterial_GalvanizedSteel',
    classificationCode: 'Pr_65_52_07_45',
    version: CATALOG_VERSION,
  }),
])

export function getGiDiameter(nominalMm) {
  return GI_DIAMETERS.find(d => d.nominalMm === nominalMm) || null
}
export function listGiDiameters() { return GI_DIAMETERS }
