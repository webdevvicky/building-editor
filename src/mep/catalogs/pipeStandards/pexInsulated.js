export const CATALOG_VERSION = '2026-05-PEX'
export const CATALOG_SOURCE = 'Industry standard'

const ZONES = Object.freeze({ WALL: 1.00, CEILING: 1.05, FLOOR: 1.00, SHAFT: 1.05, EXTERNAL: 1.10, UNDERGROUND: 1.00 })

export const PEX_INSULATED_DIAMETERS = Object.freeze([
  Object.freeze({
    nominalMm: 15, odMm: 16.0, irMm: 12.0,
    pressureClass: 'PN-10',
    fixtureUnitsCarried: 4, maxFlowLpm: 30,
    ratePerMRateKey: 'plumbing_pex_insulated_15mm',
    elbowRateKey: 'plumbing_pex_elbow_15mm',
    teeRateKey: 'plumbing_pex_tee_15mm',
    reducerToPrevRateKey: null,
    zoneMultipliers: ZONES,
    ifcMaterial: 'IfcMaterial_PEX_Insulated',
    classificationCode: 'Pr_65_52_07_55',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    nominalMm: 20, odMm: 20.0, irMm: 16.0,
    pressureClass: 'PN-10',
    fixtureUnitsCarried: 10, maxFlowLpm: 60,
    ratePerMRateKey: 'plumbing_pex_insulated_20mm',
    elbowRateKey: 'plumbing_pex_elbow_20mm',
    teeRateKey: 'plumbing_pex_tee_20mm',
    reducerToPrevRateKey: 'plumbing_pex_reducer_20_15',
    zoneMultipliers: ZONES,
    ifcMaterial: 'IfcMaterial_PEX_Insulated',
    classificationCode: 'Pr_65_52_07_56',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    nominalMm: 25, odMm: 25.0, irMm: 20.4,
    pressureClass: 'PN-10',
    fixtureUnitsCarried: 20, maxFlowLpm: 100,
    ratePerMRateKey: 'plumbing_pex_insulated_25mm',
    elbowRateKey: 'plumbing_pex_elbow_25mm',
    teeRateKey: 'plumbing_pex_tee_25mm',
    reducerToPrevRateKey: 'plumbing_pex_reducer_25_20',
    zoneMultipliers: ZONES,
    ifcMaterial: 'IfcMaterial_PEX_Insulated',
    classificationCode: 'Pr_65_52_07_57',
    version: CATALOG_VERSION,
  }),
])

export function getPexInsulatedDiameter(nominalMm) {
  return PEX_INSULATED_DIAMETERS.find(d => d.nominalMm === nominalMm) || null
}
export function listPexInsulatedDiameters() { return PEX_INSULATED_DIAMETERS }
