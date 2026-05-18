export const CATALOG_VERSION = '2026-05-CABLES'
export const CATALOG_SOURCE = 'Industry standard'

export const CABLE_TYPES = Object.freeze([
  Object.freeze({
    id: 'CAT6', label: 'CAT6 Data Cable',
    cores: 8, sqmm: 0.5, shielded: false,
    ratePerMRateKey: 'elv_cable_cat6',
    ifcMaterial: 'IfcCableMaterial_CAT6',
    classificationCode: 'Pr_65_52_22_18',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'CCTV_COAX_RG6', label: 'CCTV RG6 Coaxial',
    cores: 1, sqmm: 1.0, shielded: true,
    ratePerMRateKey: 'elv_cable_rg6',
    ifcMaterial: 'IfcCableMaterial_Coaxial',
    classificationCode: 'Pr_65_52_22_64',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'FIRE_RATED_2C', label: 'Fire-Rated 2-Core Cable',
    cores: 2, sqmm: 1.5, shielded: true,
    ratePerMRateKey: 'elv_cable_fire_rated_2c',
    ifcMaterial: 'IfcCableMaterial_FireRated',
    classificationCode: 'Pr_65_52_22_36',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'SOLAR_DC_4SQ', label: 'Solar DC Cable 4 sqmm',
    cores: 1, sqmm: 4, shielded: false,
    ratePerMRateKey: 'elv_cable_solar_dc_4sq',
    ifcMaterial: 'IfcCableMaterial_SolarDC',
    classificationCode: 'Pr_65_52_22_72',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'SOLAR_DC_6SQ', label: 'Solar DC Cable 6 sqmm',
    cores: 1, sqmm: 6, shielded: false,
    ratePerMRateKey: 'elv_cable_solar_dc_6sq',
    ifcMaterial: 'IfcCableMaterial_SolarDC',
    classificationCode: 'Pr_65_52_22_74',
    version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'SPEAKER_CABLE', label: 'Speaker Cable',
    cores: 2, sqmm: 1.5, shielded: false,
    ratePerMRateKey: 'elv_cable_speaker',
    ifcMaterial: 'IfcCableMaterial_Audio',
    classificationCode: 'Pr_65_52_22_82',
    version: CATALOG_VERSION,
  }),
])

export function getCableType(id) {
  return CABLE_TYPES.find(c => c.id === id) || null
}
export function listCableTypes() { return CABLE_TYPES }
