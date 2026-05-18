export const CATALOG_VERSION = '2026-05-MNRE'
export const CATALOG_SOURCE = 'MNRE / IS 16221'

export const SOLAR_EQUIPMENT_REGISTRY = Object.freeze([
  Object.freeze({
    id: 'SOLAR_PANEL', label: 'Solar PV Panel (Mono 330W)', discipline: 'SOLAR',
    panelWattage: 330, dimFt2: 21,
    ifcType: 'IfcSolarDevice', classificationCode: 'Pr_70_70_75_78',
    glyphId: 'glyph_solar_panel', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'SOLAR_INVERTER', label: 'Solar Inverter', discipline: 'SOLAR',
    panelWattage: 0, dimFt2: 6,
    ifcType: 'IfcElectricGenerator', classificationCode: 'Pr_70_70_75_45',
    glyphId: 'glyph_solar_inverter', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'SOLAR_BATTERY', label: 'Solar Battery Bank', discipline: 'SOLAR',
    panelWattage: 0, dimFt2: 8,
    ifcType: 'IfcElectricFlowStorageDevice', classificationCode: 'Pr_70_70_75_10',
    glyphId: 'glyph_solar_battery', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'GENERATION_METER', label: 'Generation Meter', discipline: 'SOLAR',
    panelWattage: 0, dimFt2: 1,
    ifcType: 'IfcFlowMeter', classificationCode: 'Pr_70_70_46_36',
    glyphId: 'glyph_generation_meter', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'EXPORT_METER', label: 'Export / Net Meter', discipline: 'SOLAR',
    panelWattage: 0, dimFt2: 1,
    ifcType: 'IfcFlowMeter', classificationCode: 'Pr_70_70_46_32',
    glyphId: 'glyph_export_meter', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'DC_COMBINER', label: 'DC Combiner Box', discipline: 'SOLAR',
    panelWattage: 0, dimFt2: 2,
    ifcType: 'IfcElectricDistributionBoard', classificationCode: 'Pr_65_52_26_18',
    glyphId: 'glyph_dc_combiner', version: CATALOG_VERSION,
  }),
])

export function getSolarEquipment(id) {
  return SOLAR_EQUIPMENT_REGISTRY.find(e => e.id === id) || null
}
export function listSolarEquipment() { return SOLAR_EQUIPMENT_REGISTRY }
