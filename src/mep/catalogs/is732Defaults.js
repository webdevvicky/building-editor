export const CATALOG_VERSION = '2026-05-IS-732'
export const CATALOG_SOURCE = 'IS 732 / NBC 2016'

export const ROOM_ELECTRICAL_DEFAULTS = Object.freeze({
  BEDROOM: Object.freeze([
    Object.freeze({ type: 'LIGHT', n: 2 }),
    Object.freeze({ type: 'FAN', n: 1 }),
    Object.freeze({ type: 'SOCKET_5A', n: 4 }),
    Object.freeze({ type: 'AC_INDOOR_POINT', n: 1 }),
    // Smart-defaults spec — typical Indian residential bedroom has a TV point.
    Object.freeze({ type: 'TV_POINT', n: 1 }),
  ]),
  MASTER_BEDROOM: Object.freeze([
    Object.freeze({ type: 'LIGHT', n: 2 }),
    Object.freeze({ type: 'FAN', n: 1 }),
    Object.freeze({ type: 'SOCKET_5A', n: 6 }),
    Object.freeze({ type: 'AC_INDOOR_POINT', n: 1 }),
  ]),
  BATHROOM: Object.freeze([
    Object.freeze({ type: 'LIGHT', n: 1 }),
    Object.freeze({ type: 'EXHAUST_FAN', n: 1 }),
    Object.freeze({ type: 'GEYSER_POINT', n: 1 }),
  ]),
  TOILET: Object.freeze([
    Object.freeze({ type: 'LIGHT', n: 1 }),
    Object.freeze({ type: 'EXHAUST_FAN', n: 1 }),
    Object.freeze({ type: 'GEYSER_POINT', n: 1 }),
  ]),
  KITCHEN: Object.freeze([
    Object.freeze({ type: 'LIGHT', n: 1 }),
    Object.freeze({ type: 'FAN', n: 1 }),
    Object.freeze({ type: 'EXHAUST_FAN', n: 1 }),   // Smart-defaults spec
    Object.freeze({ type: 'SOCKET_15A', n: 6 }),
    Object.freeze({ type: 'GEYSER_POINT', n: 1 }),
  ]),
  LIVING: Object.freeze([
    Object.freeze({ type: 'LIGHT', n: 4 }),         // Smart-defaults spec (was 2)
    Object.freeze({ type: 'FAN', n: 2 }),
    Object.freeze({ type: 'SOCKET_5A', n: 6 }),
    Object.freeze({ type: 'TV_POINT', n: 1 }),
    Object.freeze({ type: 'AC_INDOOR_POINT', n: 1 }), // Smart-defaults spec
  ]),
  DINING: Object.freeze([
    Object.freeze({ type: 'LIGHT', n: 1 }),
    Object.freeze({ type: 'FAN', n: 1 }),
    Object.freeze({ type: 'SOCKET_5A', n: 2 }),
  ]),
  BALCONY: Object.freeze([
    Object.freeze({ type: 'LIGHT', n: 1 }),
    Object.freeze({ type: 'SOCKET_5A', n: 1 }),
  ]),
  STAIRCASE: Object.freeze([
    Object.freeze({ type: 'LIGHT', n: 1 }),
  ]),
  OTHER: Object.freeze([
    Object.freeze({ type: 'LIGHT', n: 1 }),
    Object.freeze({ type: 'SOCKET_5A', n: 2 }),
  ]),
})

export function getElectricalDefaultsForRoom(roomType) {
  return ROOM_ELECTRICAL_DEFAULTS[roomType] || ROOM_ELECTRICAL_DEFAULTS.OTHER
}
