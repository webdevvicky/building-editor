export const CATALOG_VERSION = '2026-05-IS-2065'
export const CATALOG_SOURCE = 'IS 2065 / NBC 2016'

export const ROOM_PLUMBING_DEFAULTS = Object.freeze({
  BATHROOM: Object.freeze([
    Object.freeze({ type: 'WC', n: 1 }),
    Object.freeze({ type: 'WASH_BASIN', n: 1 }),
    Object.freeze({ type: 'SHOWER', n: 1 }),
    Object.freeze({ type: 'FLOOR_TRAP', n: 1 }),
  ]),
  TOILET: Object.freeze([
    Object.freeze({ type: 'WC', n: 1 }),
    Object.freeze({ type: 'WASH_BASIN', n: 1 }),
    Object.freeze({ type: 'FLOOR_TRAP', n: 1 }),
  ]),
  KITCHEN: Object.freeze([
    Object.freeze({ type: 'KITCHEN_SINK', n: 1 }),
    Object.freeze({ type: 'FLOOR_TRAP', n: 1 }),
  ]),
  UTILITY: Object.freeze([
    Object.freeze({ type: 'WASHING_MACHINE', n: 1 }),
    Object.freeze({ type: 'FLOOR_DRAIN', n: 1 }),
  ]),
})

export function getPlumbingDefaultsForRoom(roomType) {
  return ROOM_PLUMBING_DEFAULTS[roomType] || Object.freeze([])
}
