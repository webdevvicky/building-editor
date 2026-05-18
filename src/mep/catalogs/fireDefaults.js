export const CATALOG_VERSION = '2026-05-NBC-2016'
export const CATALOG_SOURCE = 'NBC 2016'

const SMOKE_ONLY = Object.freeze([Object.freeze({ type: 'SMOKE_DETECTOR', n: 1 })])

export const ROOM_FIRE_DEFAULTS = Object.freeze({
  BEDROOM: SMOKE_ONLY,
  MASTER_BEDROOM: SMOKE_ONLY,
  LIVING: SMOKE_ONLY,
  DINING: SMOKE_ONLY,
  BATHROOM: SMOKE_ONLY,
  TOILET: SMOKE_ONLY,
  BALCONY: SMOKE_ONLY,
  UTILITY: SMOKE_ONLY,
  OTHER: SMOKE_ONLY,
  KITCHEN: Object.freeze([
    Object.freeze({ type: 'HEAT_DETECTOR', n: 1 }),
    Object.freeze({ type: 'FIRE_EXTINGUISHER', n: 1 }),
  ]),
  STAIRCASE: Object.freeze([
    Object.freeze({ type: 'SMOKE_DETECTOR', n: 1 }),
    Object.freeze({ type: 'MANUAL_CALL_POINT', n: 1 }),
  ]),
  ENTRY: Object.freeze([
    Object.freeze({ type: 'MANUAL_CALL_POINT', n: 1 }),
    Object.freeze({ type: 'FIRE_ALARM_PANEL', n: 1 }),
  ]),
})

export const BUILDING_FIRE_DEFAULTS = Object.freeze({
  groundFloorEntrance: Object.freeze([
    Object.freeze({ type: 'FIRE_ALARM_PANEL', n: 1 }),
  ]),
  highRise15mPlus: Object.freeze([
    Object.freeze({ type: 'FIRE_HOSE_REEL', n: 1 }),
  ]),
})

export function getFireDefaultsForRoom(roomType) {
  return ROOM_FIRE_DEFAULTS[roomType] || ROOM_FIRE_DEFAULTS.OTHER
}
