export const CATALOG_VERSION = '2026-05-IS-9537'
export const CATALOG_SOURCE = 'IS 9537'

const ZONES = Object.freeze({ WALL: 1.00, CEILING: 1.05, FLOOR: 1.00, SHAFT: 1.05, EXTERNAL: 1.10, UNDERGROUND: 1.00 })

export const PVC_CONDUIT_DIAMETERS = Object.freeze([
  Object.freeze({
    nominalMm: 20, odMm: 20, irMm: 17.4,
    pressureClass: 'Heavy-Duty',
    fixtureUnitsCarried: 0, maxFlowLpm: 0,
    ratePerMRateKey: 'electrical_conduit_pvc_20mm',
    elbowRateKey: 'electrical_conduit_pvc_elbow_20mm',
    teeRateKey: 'electrical_conduit_pvc_tee_20mm',
    reducerToPrevRateKey: null,
    zoneMultipliers: ZONES,
    ifcMaterial: 'IfcMaterial_PVC',
    classificationCode: 'Pr_65_52_19_20',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    nominalMm: 25, odMm: 25, irMm: 22.1,
    pressureClass: 'Heavy-Duty',
    fixtureUnitsCarried: 0, maxFlowLpm: 0,
    ratePerMRateKey: 'electrical_conduit_pvc_25mm',
    elbowRateKey: 'electrical_conduit_pvc_elbow_25mm',
    teeRateKey: 'electrical_conduit_pvc_tee_25mm',
    reducerToPrevRateKey: 'electrical_conduit_pvc_reducer_25_20',
    zoneMultipliers: ZONES,
    ifcMaterial: 'IfcMaterial_PVC',
    classificationCode: 'Pr_65_52_19_25',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    nominalMm: 32, odMm: 32, irMm: 28.6,
    pressureClass: 'Heavy-Duty',
    fixtureUnitsCarried: 0, maxFlowLpm: 0,
    ratePerMRateKey: 'electrical_conduit_pvc_32mm',
    elbowRateKey: 'electrical_conduit_pvc_elbow_32mm',
    teeRateKey: 'electrical_conduit_pvc_tee_32mm',
    reducerToPrevRateKey: 'electrical_conduit_pvc_reducer_32_25',
    zoneMultipliers: ZONES,
    ifcMaterial: 'IfcMaterial_PVC',
    classificationCode: 'Pr_65_52_19_32',
    version: CATALOG_VERSION,
  }),
])

export function getPvcConduitDiameter(nominalMm) {
  return PVC_CONDUIT_DIAMETERS.find(d => d.nominalMm === nominalMm) || null
}
export function listPvcConduitDiameters() { return PVC_CONDUIT_DIAMETERS }
