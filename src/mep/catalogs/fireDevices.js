export const CATALOG_VERSION = '2026-05-NBC-2016'
export const CATALOG_SOURCE = 'NBC 2016'

export const FIRE_DEVICE_REGISTRY = Object.freeze([
  Object.freeze({
    id: 'SMOKE_DETECTOR', label: 'Smoke Detector', discipline: 'FIRE',
    coverageAreaFt2: 800, mountHeightFt: 9,
    ifcType: 'IfcSensor', classificationCode: 'Pr_75_75_31_85',
    glyphId: 'glyph_smoke_detector', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'HEAT_DETECTOR', label: 'Heat Detector', discipline: 'FIRE',
    coverageAreaFt2: 500, mountHeightFt: 9,
    ifcType: 'IfcSensor', classificationCode: 'Pr_75_75_31_42',
    glyphId: 'glyph_heat_detector', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'MANUAL_CALL_POINT', label: 'Manual Call Point', discipline: 'FIRE',
    coverageAreaFt2: 0, mountHeightFt: 4.5,
    ifcType: 'IfcAlarm', classificationCode: 'Pr_75_75_31_50',
    glyphId: 'glyph_manual_call_point', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'FIRE_ALARM_PANEL', label: 'Fire Alarm Panel', discipline: 'FIRE',
    coverageAreaFt2: 0, mountHeightFt: 5,
    ifcType: 'IfcController', classificationCode: 'Pr_75_75_31_28',
    glyphId: 'glyph_fire_alarm_panel', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'SPRINKLER_HEAD', label: 'Sprinkler Head', discipline: 'FIRE',
    coverageAreaFt2: 130, mountHeightFt: 9,
    ifcType: 'IfcFireSuppressionTerminal', classificationCode: 'Pr_75_75_31_82',
    glyphId: 'glyph_sprinkler_head', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'FIRE_HOSE_REEL', label: 'Fire Hose Reel', discipline: 'FIRE',
    coverageAreaFt2: 3000, mountHeightFt: 4,
    ifcType: 'IfcFireSuppressionTerminal', classificationCode: 'Pr_75_75_31_36',
    glyphId: 'glyph_fire_hose_reel', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'FIRE_EXTINGUISHER', label: 'Fire Extinguisher', discipline: 'FIRE',
    coverageAreaFt2: 1000, mountHeightFt: 3.5,
    ifcType: 'IfcFireSuppressionTerminal', classificationCode: 'Pr_75_75_31_34',
    glyphId: 'glyph_fire_extinguisher', version: CATALOG_VERSION,
  }),
  Object.freeze({
    id: 'SPRINKLER_VALVE', label: 'Sprinkler Control Valve', discipline: 'FIRE',
    coverageAreaFt2: 0, mountHeightFt: 5,
    ifcType: 'IfcValve', classificationCode: 'Pr_65_52_88_82',
    glyphId: 'glyph_sprinkler_valve', version: CATALOG_VERSION,
  }),
])

export function getFireDevice(id) {
  return FIRE_DEVICE_REGISTRY.find(d => d.id === id) || null
}
export function listFireDevices() { return FIRE_DEVICE_REGISTRY }
