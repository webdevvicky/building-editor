export const CATALOG_VERSION = '2026-05-IS-2065'
export const CATALOG_SOURCE = 'IS 2065 / NBC 2016'

export const PLUMBING_FIXTURE_REGISTRY = Object.freeze([
  Object.freeze({
    id: 'WC', label: 'Water Closet', discipline: 'PLUMBING',
    hasWaterInlet: true, hasDrainOutlet: true, hasHotWaterInlet: false,
    supplyDiameterMm: 15, drainDiameterMm: 110, fixtureUnits: 6, flowLpm: 12,
    ifcType: 'IfcSanitaryTerminal', classificationCode: 'Pr_40_30_84_94',
    glyphId: 'glyph_wc', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'WASH_BASIN', label: 'Wash Basin', discipline: 'PLUMBING',
    hasWaterInlet: true, hasDrainOutlet: true, hasHotWaterInlet: true,
    supplyDiameterMm: 15, drainDiameterMm: 32, fixtureUnits: 2, flowLpm: 8,
    ifcType: 'IfcSanitaryTerminal', classificationCode: 'Pr_40_30_84_05',
    glyphId: 'glyph_wash_basin', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'KITCHEN_SINK', label: 'Kitchen Sink', discipline: 'PLUMBING',
    hasWaterInlet: true, hasDrainOutlet: true, hasHotWaterInlet: true,
    supplyDiameterMm: 15, drainDiameterMm: 40, fixtureUnits: 3, flowLpm: 10,
    ifcType: 'IfcSanitaryTerminal', classificationCode: 'Pr_40_30_84_75',
    glyphId: 'glyph_kitchen_sink', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'SHOWER', label: 'Shower', discipline: 'PLUMBING',
    hasWaterInlet: true, hasDrainOutlet: true, hasHotWaterInlet: true,
    supplyDiameterMm: 15, drainDiameterMm: 50, fixtureUnits: 2, flowLpm: 12,
    ifcType: 'IfcSanitaryTerminal', classificationCode: 'Pr_40_30_84_77',
    glyphId: 'glyph_shower', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'FLOOR_TRAP', label: 'Floor Trap', discipline: 'PLUMBING',
    hasWaterInlet: false, hasDrainOutlet: true, hasHotWaterInlet: false,
    supplyDiameterMm: null, drainDiameterMm: 50, fixtureUnits: 1, flowLpm: 0,
    ifcType: 'IfcWasteTerminal', classificationCode: 'Pr_65_52_84_35',
    glyphId: 'glyph_floor_trap', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'FLOOR_DRAIN', label: 'Floor Drain', discipline: 'PLUMBING',
    hasWaterInlet: false, hasDrainOutlet: true, hasHotWaterInlet: false,
    supplyDiameterMm: null, drainDiameterMm: 75, fixtureUnits: 2, flowLpm: 0,
    ifcType: 'IfcWasteTerminal', classificationCode: 'Pr_65_52_84_34',
    glyphId: 'glyph_floor_drain', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'GARDEN_TAP', label: 'Garden Tap', discipline: 'PLUMBING',
    hasWaterInlet: true, hasDrainOutlet: false, hasHotWaterInlet: false,
    supplyDiameterMm: 15, drainDiameterMm: null, fixtureUnits: 1, flowLpm: 10,
    ifcType: 'IfcSanitaryTerminal', classificationCode: 'Pr_40_30_84_36',
    glyphId: 'glyph_garden_tap', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'WASHING_MACHINE', label: 'Washing Machine Point', discipline: 'PLUMBING',
    hasWaterInlet: true, hasDrainOutlet: true, hasHotWaterInlet: false,
    supplyDiameterMm: 15, drainDiameterMm: 40, fixtureUnits: 3, flowLpm: 10,
    ifcType: 'IfcSanitaryTerminal', classificationCode: 'Pr_40_30_84_92',
    glyphId: 'glyph_washing_machine', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'DISHWASHER', label: 'Dishwasher Point', discipline: 'PLUMBING',
    hasWaterInlet: true, hasDrainOutlet: true, hasHotWaterInlet: true,
    supplyDiameterMm: 15, drainDiameterMm: 32, fixtureUnits: 2, flowLpm: 8,
    ifcType: 'IfcSanitaryTerminal', classificationCode: 'Pr_40_30_84_29',
    glyphId: 'glyph_dishwasher', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'FIRE_TANK_INLET', label: 'Fire Tank Inlet', discipline: 'PLUMBING',
    hasWaterInlet: true, hasDrainOutlet: false, hasHotWaterInlet: false,
    supplyDiameterMm: 50, drainDiameterMm: null, fixtureUnits: 0, flowLpm: 200,
    ifcType: 'IfcPipeFitting', classificationCode: 'Pr_65_52_29',
    glyphId: 'glyph_fire_tank_inlet', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'SUMP', label: 'Underground Sump', discipline: 'PLUMBING',
    hasWaterInlet: true, hasDrainOutlet: false, hasHotWaterInlet: false,
    supplyDiameterMm: 25, drainDiameterMm: null, fixtureUnits: 0, flowLpm: 60,
    ifcType: 'IfcTank', classificationCode: 'Pr_60_60_84_82',
    glyphId: 'glyph_sump', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'OHT', label: 'Overhead Tank', discipline: 'PLUMBING',
    hasWaterInlet: true, hasDrainOutlet: true, hasHotWaterInlet: false,
    supplyDiameterMm: 25, drainDiameterMm: 25, fixtureUnits: 0, flowLpm: 60,
    ifcType: 'IfcTank', classificationCode: 'Pr_60_60_84_56',
    glyphId: 'glyph_oht', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'GEYSER', label: 'Geyser / Water Heater', discipline: 'PLUMBING',
    hasWaterInlet: true, hasDrainOutlet: false, hasHotWaterInlet: false,
    supplyDiameterMm: 15, drainDiameterMm: null, fixtureUnits: 1, flowLpm: 10,
    ifcType: 'IfcElectricAppliance', classificationCode: 'Pr_75_75_91_88',
    glyphId: 'glyph_geyser', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'SOLAR_HEATER', label: 'Solar Water Heater', discipline: 'PLUMBING',
    hasWaterInlet: true, hasDrainOutlet: false, hasHotWaterInlet: false,
    supplyDiameterMm: 20, drainDiameterMm: null, fixtureUnits: 1, flowLpm: 12,
    ifcType: 'IfcSolarDevice', classificationCode: 'Pr_75_75_91_78',
    glyphId: 'glyph_solar_heater', version: CATALOG_VERSION,
  }),
])

export function getFixtureType(id) {
  return PLUMBING_FIXTURE_REGISTRY.find(f => f.id === id) || null
}
export function listFixtureTypes() { return PLUMBING_FIXTURE_REGISTRY }
