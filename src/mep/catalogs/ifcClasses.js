export const CATALOG_VERSION = '2026-05-IFC-4.3'
export const CATALOG_SOURCE = 'IFC 4.3'

export const IFC_CLASSES = Object.freeze({
  WC: 'IfcSanitaryTerminal',
  WASH_BASIN: 'IfcSanitaryTerminal',
  KITCHEN_SINK: 'IfcSanitaryTerminal',
  SHOWER: 'IfcSanitaryTerminal',
  FLOOR_TRAP: 'IfcWasteTerminal',
  FLOOR_DRAIN: 'IfcWasteTerminal',
  GARDEN_TAP: 'IfcSanitaryTerminal',
  WASHING_MACHINE: 'IfcSanitaryTerminal',
  DISHWASHER: 'IfcSanitaryTerminal',
  FIRE_TANK_INLET: 'IfcPipeFitting',
  SUMP: 'IfcTank',
  OHT: 'IfcTank',
  GEYSER: 'IfcElectricAppliance',
  SOLAR_HEATER: 'IfcSolarDevice',

  LIGHT: 'IfcLightFixture',
  FAN: 'IfcFlowTerminal',
  EXHAUST_FAN: 'IfcFlowTerminal',
  SOCKET_5A: 'IfcOutlet',
  SOCKET_15A: 'IfcOutlet',
  AC_INDOOR_POINT: 'IfcOutlet',
  GEYSER_POINT: 'IfcOutlet',
  TV_POINT: 'IfcOutlet',
  DB: 'IfcElectricDistributionBoard',
  SWITCHBOARD: 'IfcSwitchingDevice',
  ENERGY_METER: 'IfcFlowMeter',
  EV_CHARGER: 'IfcOutlet',
  INVERTER_TIE_POINT: 'IfcOutlet',
  AC_OUTDOOR_POINT: 'IfcOutlet',
  SUB_DB: 'IfcElectricDistributionBoard',

  AC_INDOOR_UNIT: 'IfcUnitaryEquipment',
  AC_OUTDOOR_UNIT: 'IfcUnitaryEquipment',
  EXHAUST_FAN_HVAC: 'IfcFan',
  FRESH_AIR_INLET: 'IfcAirTerminal',
  DUCTED_AC_INDOOR: 'IfcUnitaryEquipment',
  DUCTED_AC_OUTDOOR: 'IfcUnitaryEquipment',

  SMOKE_DETECTOR: 'IfcSensor',
  HEAT_DETECTOR: 'IfcSensor',
  MANUAL_CALL_POINT: 'IfcAlarm',
  FIRE_ALARM_PANEL: 'IfcController',
  SPRINKLER_HEAD: 'IfcFireSuppressionTerminal',
  FIRE_HOSE_REEL: 'IfcFireSuppressionTerminal',
  FIRE_EXTINGUISHER: 'IfcFireSuppressionTerminal',
  SPRINKLER_VALVE: 'IfcValve',

  CCTV_CAMERA: 'IfcAudioVisualAppliance',
  VIDEO_DOOR_PHONE: 'IfcCommunicationsAppliance',
  INTERCOM: 'IfcCommunicationsAppliance',
  DATA_POINT: 'IfcOutlet',
  TV_POINT_ELV: 'IfcOutlet',
  WIFI_AP: 'IfcCommunicationsAppliance',
  ALARM_SENSOR: 'IfcSensor',
  ELV_RACK: 'IfcSystemFurnitureElement',

  SOLAR_PANEL: 'IfcSolarDevice',
  SOLAR_INVERTER: 'IfcElectricGenerator',
  SOLAR_BATTERY: 'IfcElectricFlowStorageDevice',
  GENERATION_METER: 'IfcFlowMeter',
  EXPORT_METER: 'IfcFlowMeter',
  DC_COMBINER: 'IfcElectricDistributionBoard',
})

export function getIfcClass(entityType) {
  return IFC_CLASSES[entityType] || null
}
