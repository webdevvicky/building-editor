export const CATALOG_VERSION = '2026-05-ELV'
export const CATALOG_SOURCE = 'Industry standard'

export const ELV_DEVICE_REGISTRY = Object.freeze([
  Object.freeze({
    id: 'CCTV_CAMERA', label: 'CCTV Camera', discipline: 'ELV',
    cableTypeId: 'CCTV_COAX_RG6', mountHeightFt: 9,
    ifcType: 'IfcAudioVisualAppliance', classificationCode: 'Pr_75_75_06_18',
    glyphId: 'glyph_cctv_camera', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'VIDEO_DOOR_PHONE', label: 'Video Door Phone', discipline: 'ELV',
    cableTypeId: 'CAT6', mountHeightFt: 5,
    ifcType: 'IfcCommunicationsAppliance', classificationCode: 'Pr_75_75_06_92',
    glyphId: 'glyph_video_door_phone', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'INTERCOM', label: 'Intercom', discipline: 'ELV',
    cableTypeId: 'CAT6', mountHeightFt: 4,
    ifcType: 'IfcCommunicationsAppliance', classificationCode: 'Pr_75_75_06_44',
    glyphId: 'glyph_intercom', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'DATA_POINT', label: 'Data / LAN Point', discipline: 'ELV',
    cableTypeId: 'CAT6', mountHeightFt: 1,
    ifcType: 'IfcOutlet', classificationCode: 'Pr_70_70_55_22',
    glyphId: 'glyph_data_point', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'TV_POINT_ELV', label: 'TV Outlet (ELV)', discipline: 'ELV',
    cableTypeId: 'CCTV_COAX_RG6', mountHeightFt: 3,
    ifcType: 'IfcOutlet', classificationCode: 'Pr_70_70_55_85',
    glyphId: 'glyph_tv_point_elv', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'WIFI_AP', label: 'Wi-Fi Access Point', discipline: 'ELV',
    cableTypeId: 'CAT6', mountHeightFt: 9,
    ifcType: 'IfcCommunicationsAppliance', classificationCode: 'Pr_75_75_06_95',
    glyphId: 'glyph_wifi_ap', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'ALARM_SENSOR', label: 'Intrusion Alarm Sensor', discipline: 'ELV',
    cableTypeId: 'FIRE_RATED_2C', mountHeightFt: 7,
    ifcType: 'IfcSensor', classificationCode: 'Pr_75_75_31_06',
    glyphId: 'glyph_alarm_sensor', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'ELV_RACK', label: 'ELV Equipment Rack', discipline: 'ELV',
    cableTypeId: 'CAT6', mountHeightFt: 5,
    ifcType: 'IfcSystemFurnitureElement', classificationCode: 'Pr_75_75_06_64',
    glyphId: 'glyph_elv_rack', version: CATALOG_VERSION,
  }),
])

export function getElvDevice(id) {
  return ELV_DEVICE_REGISTRY.find(d => d.id === id) || null
}
export function listElvDevices() { return ELV_DEVICE_REGISTRY }
