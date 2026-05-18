export const CATALOG_VERSION = '2026-05-ISHRAE'
export const CATALOG_SOURCE = 'ISHRAE / NBC 2016'

export const HVAC_UNIT_REGISTRY = Object.freeze([
  Object.freeze({
    id: 'AC_INDOOR_UNIT', label: 'AC Indoor Unit (Split)', discipline: 'HVAC',
    capacityTons: 1.5, defaultLoadW: 1500,
    refrigerantPipeOdIn: '3/8', condensateDiameterMm: 25,
    ifcType: 'IfcUnitaryEquipment', classificationCode: 'Pr_75_53_03_30',
    glyphId: 'glyph_ac_indoor_unit', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'AC_OUTDOOR_UNIT', label: 'AC Outdoor Unit (Condenser)', discipline: 'HVAC',
    capacityTons: 1.5, defaultLoadW: 1500,
    refrigerantPipeOdIn: '1/4', condensateDiameterMm: 25,
    ifcType: 'IfcUnitaryEquipment', classificationCode: 'Pr_75_53_03_18',
    glyphId: 'glyph_ac_outdoor_unit', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'EXHAUST_FAN_HVAC', label: 'HVAC Exhaust Fan', discipline: 'HVAC',
    capacityTons: 0, defaultLoadW: 60,
    refrigerantPipeOdIn: null, condensateDiameterMm: null,
    ifcType: 'IfcFan', classificationCode: 'Pr_75_53_29_30',
    glyphId: 'glyph_exhaust_fan_hvac', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'FRESH_AIR_INLET', label: 'Fresh Air Inlet', discipline: 'HVAC',
    capacityTons: 0, defaultLoadW: 0,
    refrigerantPipeOdIn: null, condensateDiameterMm: null,
    ifcType: 'IfcAirTerminal', classificationCode: 'Pr_75_53_07_38',
    glyphId: 'glyph_fresh_air_inlet', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'DUCTED_AC_INDOOR', label: 'Ducted AC Indoor', discipline: 'HVAC',
    capacityTons: 3, defaultLoadW: 3500,
    refrigerantPipeOdIn: '1/2', condensateDiameterMm: 32,
    ifcType: 'IfcUnitaryEquipment', classificationCode: 'Pr_75_53_03_28',
    glyphId: 'glyph_ducted_ac_indoor', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'DUCTED_AC_OUTDOOR', label: 'Ducted AC Outdoor', discipline: 'HVAC',
    capacityTons: 3, defaultLoadW: 3500,
    refrigerantPipeOdIn: '5/8', condensateDiameterMm: 32,
    ifcType: 'IfcUnitaryEquipment', classificationCode: 'Pr_75_53_03_19',
    glyphId: 'glyph_ducted_ac_outdoor', version: CATALOG_VERSION,
  }),
])

export function getHvacUnit(id) {
  return HVAC_UNIT_REGISTRY.find(u => u.id === id) || null
}
export function listHvacUnits() { return HVAC_UNIT_REGISTRY }
