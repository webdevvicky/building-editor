export const CATALOG_VERSION = '2026-05-ISHRAE'
export const CATALOG_SOURCE = 'ISHRAE / NBC 2016'

export const ROOM_HVAC_DEFAULTS = Object.freeze({
  BEDROOM: Object.freeze([
    Object.freeze({ type: 'AC_INDOOR_UNIT', n: 1, capacityTons: 1.5 }),
    Object.freeze({ type: 'AC_OUTDOOR_UNIT', n: 1, capacityTons: 1.5 }),
  ]),
  MASTER_BEDROOM: Object.freeze([
    Object.freeze({ type: 'AC_INDOOR_UNIT', n: 1, capacityTons: 1.5 }),
    Object.freeze({ type: 'AC_OUTDOOR_UNIT', n: 1, capacityTons: 1.5 }),
  ]),
  LIVING: Object.freeze([
    Object.freeze({ type: 'AC_INDOOR_UNIT', n: 1, capacityTons: 1.5 }),
    Object.freeze({ type: 'AC_OUTDOOR_UNIT', n: 1, capacityTons: 1.5 }),
  ]),
  KITCHEN: Object.freeze([
    Object.freeze({ type: 'EXHAUST_FAN_HVAC', n: 1 }),
  ]),
})

export function getHvacDefaultsForRoom(roomType) {
  return ROOM_HVAC_DEFAULTS[roomType] || Object.freeze([])
}
