export const CATALOG_VERSION = '2026-05-IS-732'
export const CATALOG_SOURCE = 'IS 732 / NBC 2016'

export const ELECTRICAL_POINT_REGISTRY = Object.freeze([
  Object.freeze({
    id: 'LIGHT', label: 'Light Point', discipline: 'ELECTRICAL',
    defaultLoadW: 15, circuitClass: 'LIGHTING',
    wireGaugeMm2: 1.5, mountHeightFt: 9,
    ifcType: 'IfcLightFixture', classificationCode: 'Pr_70_70_05',
    glyphId: 'glyph_light', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'FAN', label: 'Ceiling Fan Point', discipline: 'ELECTRICAL',
    defaultLoadW: 80, circuitClass: 'FAN',
    wireGaugeMm2: 1.5, mountHeightFt: 9,
    ifcType: 'IfcFlowTerminal', classificationCode: 'Pr_75_53_29',
    glyphId: 'glyph_fan', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'EXHAUST_FAN', label: 'Exhaust Fan Point', discipline: 'ELECTRICAL',
    defaultLoadW: 60, circuitClass: 'FAN',
    wireGaugeMm2: 1.5, mountHeightFt: 8,
    ifcType: 'IfcFlowTerminal', classificationCode: 'Pr_75_53_29_30',
    glyphId: 'glyph_exhaust_fan', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'SOCKET_5A', label: '5A Socket', discipline: 'ELECTRICAL',
    defaultLoadW: 100, circuitClass: 'SOCKETS_5A',
    wireGaugeMm2: 2.5, mountHeightFt: 1,
    ifcType: 'IfcOutlet', classificationCode: 'Pr_70_70_55_05',
    glyphId: 'glyph_socket_5a', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'SOCKET_15A', label: '15A Socket', discipline: 'ELECTRICAL',
    defaultLoadW: 1500, circuitClass: 'SOCKETS_15A',
    wireGaugeMm2: 2.5, mountHeightFt: 1,
    ifcType: 'IfcOutlet', classificationCode: 'Pr_70_70_55_15',
    glyphId: 'glyph_socket_15a', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'AC_INDOOR_POINT', label: 'AC Indoor Power Point', discipline: 'ELECTRICAL',
    defaultLoadW: 1500, circuitClass: 'AC',
    wireGaugeMm2: 4, mountHeightFt: 8,
    ifcType: 'IfcOutlet', classificationCode: 'Pr_70_70_55_02',
    glyphId: 'glyph_ac_indoor_point', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'GEYSER_POINT', label: 'Geyser Power Point', discipline: 'ELECTRICAL',
    defaultLoadW: 2000, circuitClass: 'GEYSER',
    wireGaugeMm2: 4, mountHeightFt: 7,
    ifcType: 'IfcOutlet', classificationCode: 'Pr_70_70_55_38',
    glyphId: 'glyph_geyser_point', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'TV_POINT', label: 'TV Point', discipline: 'ELECTRICAL',
    defaultLoadW: 200, circuitClass: 'SOCKETS_5A',
    wireGaugeMm2: 1.5, mountHeightFt: 3,
    ifcType: 'IfcOutlet', classificationCode: 'Pr_70_70_55_85',
    glyphId: 'glyph_tv_point', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'DB', label: 'Distribution Board', discipline: 'ELECTRICAL',
    defaultLoadW: 0, circuitClass: 'SUBMAIN',
    wireGaugeMm2: 16, mountHeightFt: 5,
    ifcType: 'IfcElectricDistributionBoard', classificationCode: 'Pr_65_52_26',
    glyphId: 'glyph_db', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'SWITCHBOARD', label: 'Switchboard', discipline: 'ELECTRICAL',
    defaultLoadW: 0, circuitClass: 'LIGHTING',
    wireGaugeMm2: 1.5, mountHeightFt: 4,
    ifcType: 'IfcSwitchingDevice', classificationCode: 'Pr_70_70_72',
    glyphId: 'glyph_switchboard', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'ENERGY_METER', label: 'Energy Meter', discipline: 'ELECTRICAL',
    defaultLoadW: 0, circuitClass: 'METER',
    wireGaugeMm2: 16, mountHeightFt: 5,
    ifcType: 'IfcFlowMeter', classificationCode: 'Pr_70_70_46_30',
    glyphId: 'glyph_energy_meter', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'EV_CHARGER', label: 'EV Charger Point', discipline: 'ELECTRICAL',
    defaultLoadW: 3500, circuitClass: 'EV',
    wireGaugeMm2: 6, mountHeightFt: 4,
    ifcType: 'IfcOutlet', classificationCode: 'Pr_70_70_55_25',
    glyphId: 'glyph_ev_charger', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'INVERTER_TIE_POINT', label: 'Inverter Tie-In Point', discipline: 'ELECTRICAL',
    defaultLoadW: 0, circuitClass: 'SOLAR',
    wireGaugeMm2: 6, mountHeightFt: 5,
    ifcType: 'IfcOutlet', classificationCode: 'Pr_70_70_55_50',
    glyphId: 'glyph_inverter_tie_point', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'AC_OUTDOOR_POINT', label: 'AC Outdoor Power Point', discipline: 'ELECTRICAL',
    defaultLoadW: 1500, circuitClass: 'AC',
    wireGaugeMm2: 4, mountHeightFt: 7,
    ifcType: 'IfcOutlet', classificationCode: 'Pr_70_70_55_03',
    glyphId: 'glyph_ac_outdoor_point', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'SUB_DB', label: 'Sub Distribution Board', discipline: 'ELECTRICAL',
    defaultLoadW: 0, circuitClass: 'SUBMAIN',
    wireGaugeMm2: 10, mountHeightFt: 5,
    ifcType: 'IfcElectricDistributionBoard', classificationCode: 'Pr_65_52_26_70',
    glyphId: 'glyph_sub_db', version: CATALOG_VERSION,
  }),
])

export function getPointType(id) {
  return ELECTRICAL_POINT_REGISTRY.find(p => p.id === id) || null
}
export function listPointTypes() { return ELECTRICAL_POINT_REGISTRY }
