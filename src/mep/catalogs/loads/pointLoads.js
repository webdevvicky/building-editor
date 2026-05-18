export const CATALOG_VERSION = '2026-05-IS-732'
export const CATALOG_SOURCE = 'IS 732 / NBC 2016'

export const POINT_LOADS_W = Object.freeze({
  LIGHT: 15,
  FAN: 80,
  EXHAUST_FAN: 60,
  SOCKET_5A: 100,
  SOCKET_15A: 1500,
  AC_INDOOR_POINT: 1500,
  GEYSER_POINT: 2000,
  TV_POINT: 200,
  DB: 0,
  SWITCHBOARD: 0,
  ENERGY_METER: 0,
  EV_CHARGER: 3500,
  INVERTER_TIE_POINT: 0,
  AC_OUTDOOR_POINT: 1500,
  SUB_DB: 0,
})

export function getPointLoadW(pointType) {
  return POINT_LOADS_W[pointType] ?? 0
}
