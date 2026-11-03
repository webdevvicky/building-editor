// One authority for inherited bar settings. The saved snapshot, not the latest
// network response, is the input to every calculation of an existing drawing.
export const OFFLINE_BBS_SETTINGS = Object.freeze({
  coverColumnMm: 25, coverFootingMm: 40, coverSlabMm: 20, coverBeamMm: 25,
  stockBarLengthM: 12, lapLengthFactor: 50, steelWastagePct: 3, concreteWastagePct: 2,
})
export const OFFLINE_BBS_SNAPSHOT = Object.freeze({
  source: 'IS_CODE', settingsVersion: 'offline-is-code-1', settings: OFFLINE_BBS_SETTINGS,
})
const COVER_KEYS = Object.freeze({
  COLUMN: 'coverColumnMm', BEAM: 'coverBeamMm', FOOTING: 'coverFootingMm',
  FOUNDATION: 'coverFootingMm', STRAP: 'coverBeamMm', SLAB: 'coverSlabMm',
  SUNSHADE: 'coverSlabMm', LOFT: 'coverSlabMm', STAIRCASE: 'coverSlabMm',
})

export function effectiveBbsSettings(state) {
  const snapshot = state?.projectSettings?.bbsSettings
  if (state?.bbsSettingsRequired && snapshot?.source !== 'ERP') throw new Error('Company bar settings have not loaded. Retry before calculating bars.')
  if (snapshot) return snapshot.settings
  return OFFLINE_BBS_SETTINGS
}

export function resolveBbsSpec(state, spec, params) {
  const defaults = effectiveBbsSettings(state)
  const coverKey = COVER_KEYS[spec.elementType]
  if (!coverKey) throw new Error(`No bar settings registered for ${spec.elementType}`)
  return {
    ...spec,
    coverMm: spec.coverMm ?? defaults[coverKey],
    padCoverMm: spec.padCoverMm ?? defaults.coverFootingMm,
    lapLengthMultiplier: spec.lapLengthMultiplier ?? params.lapLengthFactor[params.defaultLapKey],
    developmentLengthMultiplier: spec.developmentLengthMultiplier ?? params.developmentLengthFactor[params.defaultGradeKey],
    explicitDevelopmentLengthMultiplier: spec.developmentLengthMultiplier,
    explicitLapLengthMultiplier: spec.lapLengthMultiplier,
  }
}

export function effectiveStockBarLength(state) {
  return state?.projectSettings?.bbsDefaults?.standardBarLengthM
    ?? state?.projectSettings?.is2502Params?.standardBarLengthM
    ?? effectiveBbsSettings(state).stockBarLengthM
}

export function resolveCuttingParams(state, catalog, sitePractice) {
  const mode = state?.projectSettings?.bbsAllowanceMode === 'SITE_PRACTICE' ? 'SITE_PRACTICE' : 'IS_STRICT'
  const saved = state?.projectSettings?.bbsSettings
  const defaults = effectiveBbsSettings(state)
  const inherited = saved?.source === 'ERP'
    ? { lapLengthFactor: Object.fromEntries(Object.keys(catalog.lapLengthFactor).map(key => [key, defaults.lapLengthFactor])) }
    : {}
  const layers = [mode === 'SITE_PRACTICE' ? sitePractice : {}, inherited, state?.projectSettings?.is2502Params ?? {}]
  const merged = { ...catalog }
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      merged[key] = value && typeof value === 'object' && !Array.isArray(value)
        ? { ...merged[key], ...value } : value
    }
  }
  return { ...merged, standardBarLengthM: effectiveStockBarLength(state), allowanceMode: mode }
}

// Explicit spec overrides apply to every generator, including anchorage and dowels.
export function cuttingParamsForSpec(params, spec) {
  const mergeFactor = (table, factor) => factor == null ? table
    : Object.fromEntries(Object.keys(table).map(key => [key, factor]))
  return {
    ...params,
    lapLengthFactor: mergeFactor(params.lapLengthFactor, spec?.explicitLapLengthMultiplier),
    developmentLengthFactor: mergeFactor(params.developmentLengthFactor, spec?.explicitDevelopmentLengthMultiplier),
  }
}

export function validateEditorConfig(config) {
  if (!config || typeof config.settingsVersion !== 'string' || !config.settingsVersion.trim()) throw new Error('Invalid company bar settings version')
  const bounds = { coverColumnMm: [10, 100], coverFootingMm: [10, 100], coverSlabMm: [10, 100], coverBeamMm: [10, 100],
    stockBarLengthM: [6, 12], lapLengthFactor: [20, 100], steelWastagePct: [0, 20], concreteWastagePct: [0, 20] }
  for (const [key, [min, max]] of Object.entries(bounds)) {
    const value = config.settings?.[key]
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid company bar setting: ${key}`)
  }
  if (![6, 9, 12].includes(config.settings.stockBarLengthM)) throw new Error('Invalid stock bar length')
  return { source: 'ERP', settingsVersion: config.settingsVersion, settings: { ...config.settings } }
}
