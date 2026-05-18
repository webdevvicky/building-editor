export const CATALOG_VERSION = '2026-05-IPC-HUNTER'
export const CATALOG_SOURCE = 'IPC (Hunter\'s Method)'

export const FIXTURE_UNITS = Object.freeze({
  WC: 6,
  WASH_BASIN: 2,
  KITCHEN_SINK: 3,
  SHOWER: 2,
  FLOOR_TRAP: 1,
  FLOOR_DRAIN: 2,
  GARDEN_TAP: 1,
  WASHING_MACHINE: 3,
  DISHWASHER: 2,
  FIRE_TANK_INLET: 0,
  SUMP: 0,
  OHT: 0,
  GEYSER: 1,
  SOLAR_HEATER: 1,
})

export function getFixtureUnits(fixtureType) {
  return FIXTURE_UNITS[fixtureType] ?? 0
}
