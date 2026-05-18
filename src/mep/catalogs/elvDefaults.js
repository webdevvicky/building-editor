export const CATALOG_VERSION = '2026-05-ELV'
export const CATALOG_SOURCE = 'Industry standard'

export const ROOM_ELV_DEFAULTS = Object.freeze({
  BEDROOM: Object.freeze([
    Object.freeze({ type: 'DATA_POINT', n: 1 }),
    Object.freeze({ type: 'TV_POINT_ELV', n: 1 }),
  ]),
  MASTER_BEDROOM: Object.freeze([
    Object.freeze({ type: 'DATA_POINT', n: 1 }),
    Object.freeze({ type: 'TV_POINT_ELV', n: 1 }),
  ]),
  LIVING: Object.freeze([
    Object.freeze({ type: 'DATA_POINT', n: 2 }),
    Object.freeze({ type: 'TV_POINT_ELV', n: 1 }),
  ]),
  KITCHEN: Object.freeze([
    Object.freeze({ type: 'DATA_POINT', n: 1 }),
  ]),
  ENTRY: Object.freeze([
    Object.freeze({ type: 'VIDEO_DOOR_PHONE', n: 1 }),
  ]),
})

export function getElvDefaultsForRoom(roomType) {
  return ROOM_ELV_DEFAULTS[roomType] || Object.freeze([])
}
