import assert from 'node:assert/strict'
import fs from 'node:fs'
import { useStore } from '../src/store.js'
import { computeRebarGroups } from '../src/bbs/index.js'
import { resolveColumnReinforcementSpec } from '../src/specs/resolution.js'
import { getIs2502Params, developmentLengthMm } from '../src/specs/cuttingLength.js'
import { effectiveBbsSettings, effectiveStockBarLength, cuttingParamsForSpec, resolveBbsSpec } from '../src/specs/effectiveBbsSettings.js'
import { loadBbsSettings, applyPendingBbsSettings } from '../src/projects/bbsSettingsSession.js'
import { buildSnapshot } from '../src/projects/_snapshot.js'
import { ELEMENT_REGISTRY } from '../src/projects/elementRegistry.js'

const state = useStore.getState
state().loadProject({ nodes: {}, walls: {}, rooms: {}, columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {}, projectSettings: undefined })
state().setProjectSettings({
  columnTypes: [{ id: 'C1', label: 'C1', shape: 'rect', widthIn: 9, depthIn: 18 }],
  reinforcementSpecs: { C: { id: 'C', label: 'Column', elementType: 'COLUMN', longitudinalBarCount: 4, longitudinalBarDiaMm: 16, stirrupBarDiaMm: 8, stirrupSpacingIn: 6 } },
  bbsDefaults: { COLUMN: 'C' },
})
// Exercise the actual drawing action, not a hand-built entity map.
state().addRectangleRoom(0, 0, 144, 120)
const columnId = state().addColumn(0, 0, 'C1')
const conn = { erpUrl: 'https://erp.test', buildingId: 'building-a', getToken: async () => 'editor-token' }
const config = { settingsVersion: 'company-v1', settings: { coverColumnMm: 40, coverFootingMm: 50, coverBeamMm: 25, coverSlabMm: 20, stockBarLengthM: 9, lapLengthFactor: 60, steelWastagePct: 4, concreteWastagePct: 2 } }
let latest = config
let fail = false
const originalFetch = globalThis.fetch
globalThis.fetch = async (url, opts) => {
  assert.equal(url, 'https://erp.test/api/v1/building-structure/buildings/building-a/editor-config')
  assert.equal(opts.headers.Authorization, 'Bearer editor-token')
  if (fail) throw new Error('Network unavailable')
  return { ok: true, json: async () => ({ data: latest }) }
}
try {
  assert.equal(await loadBbsSettings(useStore, conn, { initial: true }), true)
  assert.equal(resolveColumnReinforcementSpec(state(), columnId).spec.coverMm, 40)
  assert.equal(getIs2502Params(state()).lapLengthFactor[getIs2502Params(state()).defaultLapKey], 60)
  const site = getIs2502Params({ ...state(), projectSettings: { ...state().projectSettings, bbsAllowanceMode: 'SITE_PRACTICE' } })
  assert.equal(site.lapLengthFactor[site.defaultLapKey], 60, 'site mode must not replace company lap')
  const first = computeRebarGroups(state())
  assert.equal(first.standardBarLengthM, 9)
  assert.equal(first.groups.find(g => g.role === 'LONGITUDINAL').meta.lapLengthMm, 960)
  const payload = ELEMENT_REGISTRY.COLUMN.toErpPayload(state().columns[columnId], state())
  assert.ok(payload.bars.length)
  const snapshot = buildSnapshot(state())
  assert.deepEqual(snapshot.projectSettings.bbsSettings.settings, config.settings)
  assert.equal(snapshot.projectSettings.bbsSettings.settingsVersion, 'company-v1')

  latest = { settingsVersion: 'company-v2', settings: { ...config.settings, coverColumnMm: 60, lapLengthFactor: 70, stockBarLengthM: 6 } }
  state().loadProject(snapshot)
  await loadBbsSettings(useStore, conn)
  assert.deepEqual(computeRebarGroups(state()), first, 'reopening must not redesign bars')
  assert.equal(state().bbsSettingsPending.settingsVersion, 'company-v2')
  applyPendingBbsSettings(useStore)
  assert.equal(resolveColumnReinforcementSpec(state(), columnId).spec.coverMm, 60)
  assert.notDeepEqual(computeRebarGroups(state()).groups, first.groups)
  assert.equal(state().projectSettings.bbsSettings.settingsVersion, 'company-v2')

  state().setProjectSettings({ reinforcementSpecs: { C: { ...state().projectSettings.reinforcementSpecs.C, coverMm: 35, lapLengthMultiplier: 45 } } })
  assert.equal(resolveColumnReinforcementSpec(state(), columnId).spec.coverMm, 35)
  assert.equal(computeRebarGroups(state()).groups.find(g => g.role === 'LONGITUDINAL').meta.lapLengthMm, 720)
  const params = cuttingParamsForSpec(getIs2502Params(state()), resolveBbsSpec(state(), { elementType: 'FOOTING', developmentLengthMultiplier: 65 }, getIs2502Params(state())))
  assert.equal(developmentLengthMm({ diaMm: 16, params }), 1040)
  state().setProjectSettings({ bbsDefaults: { COLUMN: 'C', standardBarLengthM: 12 } })
  assert.equal(effectiveStockBarLength(state()), 12)

  state().setProjectSettings({ reinforcementSpecs: { C: { ...state().projectSettings.reinforcementSpecs.C, coverMm: null, lapLengthMultiplier: null } },
    bbsDefaults: { COLUMN: 'C', standardBarLengthM: null } })
  assert.equal(resolveColumnReinforcementSpec(state(), columnId).spec.coverMm, 60)
  assert.equal(computeRebarGroups(state()).groups.find(g => g.role === 'LONGITUDINAL').meta.lapLengthMm, 1120)
  assert.equal(effectiveStockBarLength(state()), 6)
  const projectOverrideState = { ...state(), projectSettings: { ...state().projectSettings, is2502Params: {
    lapLengthFactor: { [getIs2502Params(state()).defaultLapKey]: 55 },
  } } }
  assert.equal(resolveColumnReinforcementSpec(projectOverrideState, columnId).spec.lapLengthMultiplier, 55)

  const saved = state().projectSettings.bbsSettings
  fail = true
  assert.equal(await loadBbsSettings(useStore, conn), false)
  assert.equal(state().bbsSettingsStatus, 'error')
  assert.deepEqual(state().projectSettings.bbsSettings, saved)
  fail = false
  assert.equal(await loadBbsSettings(useStore, conn), true, 'retry recovers')
  fail = true
  await loadBbsSettings(useStore, conn, { initial: true })
  assert.throws(() => effectiveBbsSettings(state()), /have not loaded/)
  fail = false
  latest = { settingsVersion: 'invalid', settings: {} }
  assert.equal(await loadBbsSettings(useStore, conn, { initial: true }), false)
  assert.throws(() => computeRebarGroups(state()), /have not loaded/)
  useStore.setState({ bbsSettingsRequired: false })
  assert.equal(effectiveBbsSettings(state()).coverColumnMm, 25)
  assert.throws(() => effectiveBbsSettings({ bbsSettingsRequired: true, projectSettings: { bbsSettings: { source: 'IS_CODE', settings: {} } } }), /have not loaded/)

  // Class guard: presets and generators must not re-introduce local inherited numbers.
  for (const file of ['src/specs/reinforcementSpecs.js', 'src/components/BBSSpecPanel.jsx', ...fs.readdirSync('src/bbs/generators').filter(x => x.endsWith('.js')).map(x => `src/bbs/generators/${x}`)]) {
    const code = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    assert.doesNotMatch(code, /(?:coverMm|padCoverMm|lapLengthMultiplier|developmentLengthMultiplier)\s*:\s*\d|(?:coverMm|padCoverMm)\s*\?\?\s*\d/, file)
  }
  console.log('PASS: company defaults, actual bars, overrides, saved versions, explicit apply, failure/retry, offline mode, and source guard')
} finally { globalThis.fetch = originalFetch }
