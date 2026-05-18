export const CATALOG_VERSION = '2026-05-ISI-8088'
export const CATALOG_SOURCE = 'ISI 8088'

const ZONES = Object.freeze({ WALL: 1.00, CEILING: 1.05, FLOOR: 1.00, SHAFT: 1.05, EXTERNAL: 1.10, UNDERGROUND: 1.00 })

export const COPPER_REFRIGERANT_DIAMETERS = Object.freeze([
  Object.freeze({
    nominalIn: '1/4', odMm: 6.35, irMm: 5.35,
    pressureClass: 'ACR-Type-L',
    fixtureUnitsCarried: 0, maxFlowLpm: 0,
    ratePerMRateKey: 'hvac_copper_1_4in',
    elbowRateKey: 'hvac_copper_elbow_1_4in',
    teeRateKey: 'hvac_copper_tee_1_4in',
    reducerToPrevRateKey: null,
    zoneMultipliers: ZONES,
    ifcMaterial: 'IfcMaterial_Copper',
    classificationCode: 'Pr_65_52_07_19',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    nominalIn: '3/8', odMm: 9.52, irMm: 8.32,
    pressureClass: 'ACR-Type-L',
    fixtureUnitsCarried: 0, maxFlowLpm: 0,
    ratePerMRateKey: 'hvac_copper_3_8in',
    elbowRateKey: 'hvac_copper_elbow_3_8in',
    teeRateKey: 'hvac_copper_tee_3_8in',
    reducerToPrevRateKey: 'hvac_copper_reducer_3_8_to_1_4',
    zoneMultipliers: ZONES,
    ifcMaterial: 'IfcMaterial_Copper',
    classificationCode: 'Pr_65_52_07_21',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    nominalIn: '1/2', odMm: 12.70, irMm: 11.10,
    pressureClass: 'ACR-Type-L',
    fixtureUnitsCarried: 0, maxFlowLpm: 0,
    ratePerMRateKey: 'hvac_copper_1_2in',
    elbowRateKey: 'hvac_copper_elbow_1_2in',
    teeRateKey: 'hvac_copper_tee_1_2in',
    reducerToPrevRateKey: 'hvac_copper_reducer_1_2_to_3_8',
    zoneMultipliers: ZONES,
    ifcMaterial: 'IfcMaterial_Copper',
    classificationCode: 'Pr_65_52_07_23',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    nominalIn: '5/8', odMm: 15.88, irMm: 13.88,
    pressureClass: 'ACR-Type-L',
    fixtureUnitsCarried: 0, maxFlowLpm: 0,
    ratePerMRateKey: 'hvac_copper_5_8in',
    elbowRateKey: 'hvac_copper_elbow_5_8in',
    teeRateKey: 'hvac_copper_tee_5_8in',
    reducerToPrevRateKey: 'hvac_copper_reducer_5_8_to_1_2',
    zoneMultipliers: ZONES,
    ifcMaterial: 'IfcMaterial_Copper',
    classificationCode: 'Pr_65_52_07_24',
    version: CATALOG_VERSION,
  }),
])

export function getCopperDiameter(nominalIn) {
  return COPPER_REFRIGERANT_DIAMETERS.find(d => d.nominalIn === nominalIn) || null
}
export function listCopperDiameters() { return COPPER_REFRIGERANT_DIAMETERS }
