import { CATALOG_VERSION as fixturesV } from './fixtureTypes.js'
import { CATALOG_VERSION as pointsV } from './pointTypes.js'
import { CATALOG_VERSION as hvacUnitsV } from './hvacUnits.js'
import { CATALOG_VERSION as fireDevicesV } from './fireDevices.js'
import { CATALOG_VERSION as elvDevicesV } from './elvDevices.js'
import { CATALOG_VERSION as solarV } from './solarEquipment.js'
import { CATALOG_VERSION as cpvcV } from './pipeStandards/cpvc.js'
import { CATALOG_VERSION as upvcV } from './pipeStandards/upvc.js'
import { CATALOG_VERSION as giV } from './pipeStandards/gi.js'
import { CATALOG_VERSION as copperV } from './pipeStandards/copper.js'
import { CATALOG_VERSION as pvcConduitV } from './pipeStandards/pvcConduit.js'
import { CATALOG_VERSION as pexV } from './pipeStandards/pexInsulated.js'
import { CATALOG_VERSION as wiresV } from './wireGauges.js'
import { CATALOG_VERSION as cablesV } from './cableTypes.js'
import { CATALOG_VERSION as is732V } from './is732Defaults.js'
import { CATALOG_VERSION as plumbingDefV } from './plumbingDefaults.js'
import { CATALOG_VERSION as hvacDefV } from './hvacDefaults.js'
import { CATALOG_VERSION as fireDefV } from './fireDefaults.js'
import { CATALOG_VERSION as elvDefV } from './elvDefaults.js'
import { CATALOG_VERSION as fuV } from './loads/fixtureUnits.js'
import { CATALOG_VERSION as plV } from './loads/pointLoads.js'
import { CATALOG_VERSION as dfV } from './loads/diversityFactors.js'
import { CATALOG_VERSION as ifcV } from './ifcClasses.js'
import { CATALOG_VERSION as classV } from './classificationCodes.js'

export {
  PLUMBING_FIXTURE_REGISTRY, getFixtureType, listFixtureTypes,
} from './fixtureTypes.js'
export {
  ELECTRICAL_POINT_REGISTRY, getPointType, listPointTypes,
} from './pointTypes.js'
export {
  HVAC_UNIT_REGISTRY, getHvacUnit, listHvacUnits,
} from './hvacUnits.js'
export {
  FIRE_DEVICE_REGISTRY, getFireDevice, listFireDevices,
} from './fireDevices.js'
export {
  ELV_DEVICE_REGISTRY, getElvDevice, listElvDevices,
} from './elvDevices.js'
export {
  SOLAR_EQUIPMENT_REGISTRY, getSolarEquipment, listSolarEquipment,
} from './solarEquipment.js'
export {
  CPVC_DIAMETERS, getCpvcDiameter, listCpvcDiameters,
} from './pipeStandards/cpvc.js'
export {
  UPVC_DIAMETERS, getUpvcDiameter, listUpvcDiameters,
} from './pipeStandards/upvc.js'
export {
  GI_DIAMETERS, getGiDiameter, listGiDiameters,
} from './pipeStandards/gi.js'
export {
  COPPER_REFRIGERANT_DIAMETERS, getCopperDiameter, listCopperDiameters,
} from './pipeStandards/copper.js'
export {
  PVC_CONDUIT_DIAMETERS, getPvcConduitDiameter, listPvcConduitDiameters,
} from './pipeStandards/pvcConduit.js'
export {
  PEX_INSULATED_DIAMETERS, getPexInsulatedDiameter, listPexInsulatedDiameters,
} from './pipeStandards/pexInsulated.js'
export {
  WIRE_GAUGES, getWireGauge, listWireGauges,
} from './wireGauges.js'
export {
  CABLE_TYPES, getCableType, listCableTypes,
} from './cableTypes.js'
export {
  ROOM_ELECTRICAL_DEFAULTS, getElectricalDefaultsForRoom,
} from './is732Defaults.js'
export {
  ROOM_PLUMBING_DEFAULTS, getPlumbingDefaultsForRoom,
} from './plumbingDefaults.js'
export {
  ROOM_HVAC_DEFAULTS, getHvacDefaultsForRoom,
} from './hvacDefaults.js'
export {
  ROOM_FIRE_DEFAULTS, BUILDING_FIRE_DEFAULTS, getFireDefaultsForRoom,
} from './fireDefaults.js'
export {
  ROOM_ELV_DEFAULTS, getElvDefaultsForRoom,
} from './elvDefaults.js'
export {
  FIXTURE_UNITS, getFixtureUnits,
} from './loads/fixtureUnits.js'
export {
  POINT_LOADS_W, getPointLoadW,
} from './loads/pointLoads.js'
export {
  DIVERSITY_FACTORS, getDiversityFactor,
} from './loads/diversityFactors.js'
export {
  IFC_CLASSES, getIfcClass,
} from './ifcClasses.js'
export {
  CLASSIFICATION_CODES, getClassificationCode,
} from './classificationCodes.js'

export const CATALOG_VERSIONS = Object.freeze({
  fixtures: fixturesV,
  points: pointsV,
  hvacUnits: hvacUnitsV,
  fireDevices: fireDevicesV,
  elvDevices: elvDevicesV,
  solarEquipment: solarV,
  cpvc: cpvcV,
  upvc: upvcV,
  gi: giV,
  copper: copperV,
  pvcConduit: pvcConduitV,
  pexInsulated: pexV,
  wireGauges: wiresV,
  cableTypes: cablesV,
  is732Defaults: is732V,
  plumbingDefaults: plumbingDefV,
  hvacDefaults: hvacDefV,
  fireDefaults: fireDefV,
  elvDefaults: elvDefV,
  fixtureUnits: fuV,
  pointLoads: plV,
  diversityFactors: dfV,
  ifcClasses: ifcV,
  classificationCodes: classV,
})
