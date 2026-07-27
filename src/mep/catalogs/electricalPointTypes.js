// electricalPointTypes.js — the CANONICAL electrical point-type classification
// (Stream 2). This is the single field the editor captures and syncs so the ERP can
// later route each placed point to its own assembly (6A switch ≠ 16A AC point). It is
// deliberately independent of the fine-grained IS-732 catalog (`pointTypes.js`, which
// drives glyph/load/wire-gauge): `POINT_TYPE_TO_CATALOG` maps a canonical type to a
// catalog id so a placed point still renders a sensible glyph today.

export const DEFAULT_POINT_TYPE = 'LIGHT'

/** The frozen canonical enum (matches the approved product spec). */
export const ELECTRICAL_POINT_TYPES = Object.freeze([
  'LIGHT',
  'FAN',
  'EXHAUST',
  'SWITCH_6A',
  'SOCKET_6A',
  'SOCKET_16A',
  'AC',
  'GEYSER',
  'HOB',
  'CHIMNEY',
  'RO',
  'INVERTER',
  'EXTERNAL_LIGHT',
  'SWITCHBOARD_8_MODULE',
  'SWITCHBOARD_6_MODULE',
  'SWITCHBOARD_4_MODULE',
  'SWITCHBOARD_3_MODULE',
])

export const POINT_TYPE_LABELS = Object.freeze({
  LIGHT: 'Light',
  FAN: 'Fan',
  EXHAUST: 'Exhaust Fan',
  SWITCH_6A: '6A Switch',
  SOCKET_6A: '6A Socket',
  SOCKET_16A: '16A Socket',
  AC: 'AC Point',
  GEYSER: 'Geyser',
  HOB: 'Hob',
  CHIMNEY: 'Chimney',
  RO: 'RO',
  INVERTER: 'Inverter',
  EXTERNAL_LIGHT: 'External Light',
  SWITCHBOARD_8_MODULE: 'Switch Box (8-Module)',
  SWITCHBOARD_6_MODULE: 'Switch Box (6-Module)',
  SWITCHBOARD_4_MODULE: 'Switch Box (4-Module)',
  SWITCHBOARD_3_MODULE: 'Switch Box (3-Module)',
})

/** Canonical point type → an IS-732 catalog id (`pointTypes.js`) for glyph + load +
 *  wire-gauge coherence. Coarse by design; the canonical `pointType` is the BOQ key. */
export const POINT_TYPE_TO_CATALOG = Object.freeze({
  LIGHT: 'LIGHT',
  FAN: 'FAN',
  EXHAUST: 'EXHAUST_FAN',
  SWITCH_6A: 'SWITCHBOARD',
  SOCKET_6A: 'SOCKET_5A',
  SOCKET_16A: 'SOCKET_15A',
  AC: 'AC_INDOOR_POINT',
  GEYSER: 'GEYSER_POINT',
  HOB: 'SOCKET_15A',
  CHIMNEY: 'SOCKET_15A',
  RO: 'SOCKET_5A',
  INVERTER: 'SOCKET_15A',
  EXTERNAL_LIGHT: 'LIGHT',
  SWITCHBOARD_8_MODULE: 'SWITCHBOARD',
  SWITCHBOARD_6_MODULE: 'SWITCHBOARD',
  SWITCHBOARD_4_MODULE: 'SWITCHBOARD',
  SWITCHBOARD_3_MODULE: 'SWITCHBOARD',
})

/** Grouping for the placement palette (display only). */
export const POINT_TYPE_GROUPS = Object.freeze([
  Object.freeze({ label: 'Points', types: Object.freeze(['LIGHT', 'FAN', 'EXHAUST', 'EXTERNAL_LIGHT']) }),
  Object.freeze({
    label: 'Switches & Sockets',
    types: Object.freeze([
      'SWITCH_6A', 'SOCKET_6A', 'SOCKET_16A',
      'SWITCHBOARD_8_MODULE', 'SWITCHBOARD_6_MODULE', 'SWITCHBOARD_4_MODULE', 'SWITCHBOARD_3_MODULE',
    ]),
  }),
  Object.freeze({ label: 'Appliances', types: Object.freeze(['AC', 'GEYSER', 'HOB', 'CHIMNEY', 'RO', 'INVERTER']) }),
])

/** Guard: is `v` a valid canonical point type? */
export function isElectricalPointType(v) {
  return ELECTRICAL_POINT_TYPES.includes(v)
}

/** The catalog id (for glyph/load) a canonical point type maps to. */
export function catalogTypeFor(pointType) {
  return POINT_TYPE_TO_CATALOG[pointType] ?? 'LIGHT'
}
