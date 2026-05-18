export const CATALOG_VERSION = '2026-05-IS-694-732'
export const CATALOG_SOURCE = 'IS 694 / IS 732'

export const WIRE_GAUGES = Object.freeze([
  Object.freeze({
    sqmm: 1.0, maxLoadW: 1800, mcbAmps: 6,
    ratePerMRateKey: 'electrical_wire_1_0sqmm',
    conduitMm: 20, conduitRateKey: 'electrical_conduit_pvc_20mm',
    ifcMaterial: 'IfcCableMaterial_Copper',
    classificationCode: 'Pr_65_52_22_10',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    sqmm: 1.5, maxLoadW: 2400, mcbAmps: 10,
    ratePerMRateKey: 'electrical_wire_1_5sqmm',
    conduitMm: 20, conduitRateKey: 'electrical_conduit_pvc_20mm',
    ifcMaterial: 'IfcCableMaterial_Copper',
    classificationCode: 'Pr_65_52_22_15',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    sqmm: 2.5, maxLoadW: 4000, mcbAmps: 16,
    ratePerMRateKey: 'electrical_wire_2_5sqmm',
    conduitMm: 20, conduitRateKey: 'electrical_conduit_pvc_20mm',
    ifcMaterial: 'IfcCableMaterial_Copper',
    classificationCode: 'Pr_65_52_22_25',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    sqmm: 4, maxLoadW: 5800, mcbAmps: 25,
    ratePerMRateKey: 'electrical_wire_4sqmm',
    conduitMm: 25, conduitRateKey: 'electrical_conduit_pvc_25mm',
    ifcMaterial: 'IfcCableMaterial_Copper',
    classificationCode: 'Pr_65_52_22_40',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    sqmm: 6, maxLoadW: 7300, mcbAmps: 32,
    ratePerMRateKey: 'electrical_wire_6sqmm',
    conduitMm: 25, conduitRateKey: 'electrical_conduit_pvc_25mm',
    ifcMaterial: 'IfcCableMaterial_Copper',
    classificationCode: 'Pr_65_52_22_60',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    sqmm: 10, maxLoadW: 10500, mcbAmps: 40,
    ratePerMRateKey: 'electrical_wire_10sqmm',
    conduitMm: 32, conduitRateKey: 'electrical_conduit_pvc_32mm',
    ifcMaterial: 'IfcCableMaterial_Copper',
    classificationCode: 'Pr_65_52_22_70',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    sqmm: 16, maxLoadW: 13800, mcbAmps: 63,
    ratePerMRateKey: 'electrical_wire_16sqmm',
    conduitMm: 32, conduitRateKey: 'electrical_conduit_pvc_32mm',
    ifcMaterial: 'IfcCableMaterial_Copper',
    classificationCode: 'Pr_65_52_22_80',
    version: CATALOG_VERSION,
  }),
])

export function getWireGauge(sqmm) {
  return WIRE_GAUGES.find(w => w.sqmm === sqmm) || null
}
export function listWireGauges() { return WIRE_GAUGES }
