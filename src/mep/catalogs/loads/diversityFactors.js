export const CATALOG_VERSION = '2026-05-IS-732'
export const CATALOG_SOURCE = 'IS 732 / NBC 2016'

export const DIVERSITY_FACTORS = Object.freeze({
  LIGHTING: 1.0,
  FAN: 1.0,
  SOCKETS_5A: 0.66,
  SOCKETS_15A: 0.66,
  AC: 0.8,
  GEYSER: 0.5,
  EV: 1.0,
  SUBMAIN: 0.8,
  SOLAR: 1.0,
  METER: 1.0,
})

export function getDiversityFactor(circuitClass) {
  return DIVERSITY_FACTORS[circuitClass] ?? 1.0
}
