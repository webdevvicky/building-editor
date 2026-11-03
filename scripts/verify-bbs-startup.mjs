// A reopened structural drawing with no saved ERP bar-settings snapshot: startup -> review -> apply -> save.
// Also: an integrity-failed reopen shows the real error, not an endless loading message.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { makeMemoryAdapter } from '../src/projects/storage/indexedDb.js'
import { setAssetStorage } from '../src/projects/storage/getAssetStorage.js'
import { useStore } from '../src/store.js'
import { loadBbsSettings, applyPendingBbsSettings, resetDeferredWritePipeline } from '../src/projects/bbsSettingsSession.js'
import { beginWritePipeline, startWritePipeline } from '../src/projects/writePipeline.js'
import { stopSyncEngine } from '../src/projects/syncEngine.js'
import { stopSyncCoordinator } from '../src/projects/syncCoordinator.js'
import { teardownCanonicalSyncQueue, getCanonicalSyncStatus } from '../src/projects/canonicalSyncQueue.js'
import { teardownLiveSyncQueue, isQueueActive } from '../src/projects/liveSyncQueue.js'
import { buildSnapshot } from '../src/projects/_snapshot.js'
import { computeRebarGroups } from '../src/bbs/index.js'

setAssetStorage(makeMemoryAdapter())
const state = useStore.getState
const conn = { erpUrl: 'https://erp.test', buildingId: 'building-a', getToken: async () => 'editor-token' }
const config = { settingsVersion: 'company-v1', settings: { coverColumnMm: 40, coverFootingMm: 50, coverBeamMm: 25, coverSlabMm: 20, stockBarLengthM: 9, lapLengthFactor: 60, steelWastagePct: 4, concreteWastagePct: 2 } }
const originalFetch = globalThis.fetch
globalThis.fetch = async (url) => {
  if (String(url).endsWith('/editor-config')) return { ok: true, json: async () => ({ data: config }) }
  return { ok: true, json: async () => ({ data: {} }) }
}
try {
  // Author a structural drawing as a standalone editor would, then reopen it with no ERP snapshot.
  state().loadProject({ nodes: {}, walls: {}, rooms: {}, columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {}, projectSettings: undefined })
  state().setProjectSettings({
    columnTypes: [{ id: 'C1', label: 'C1', shape: 'rect', widthIn: 9, depthIn: 18 }],
    reinforcementSpecs: { C: { id: 'C', label: 'Column', elementType: 'COLUMN', longitudinalBarCount: 4, longitudinalBarDiaMm: 16, stirrupBarDiaMm: 8, stirrupSpacingIn: 6 } },
    bbsDefaults: { COLUMN: 'C' },
  })
  state().addRectangleRoom(0, 0, 144, 120)
  state().addColumn(0, 0, 'C1')
  const snapshot = buildSnapshot(state())
  assert.ok(snapshot.projectSettings.bbsSettings == null || snapshot.projectSettings.bbsSettings.source !== 'ERP')

  state().loadProject(snapshot)
  resetDeferredWritePipeline()
  useStore.setState({ bbsSettingsRequired: true })
  assert.equal(await loadBbsSettings(useStore, conn), true)
  assert.equal(state().bbsSettingsStatus, 'review', 'pending initial adoption is explicit')
  assert.equal(state().bbsSettingsPending.settingsVersion, 'company-v1')

  // Startup must not run any calculation before the review (this used to throw "have not loaded").
  await beginWritePipeline(useStore, conn, 'building-a', 1)
  assert.equal(isQueueActive(), false, 'sync is deferred until the review is applied')

  assert.equal(await applyPendingBbsSettings(useStore), true)
  assert.equal(state().bbsSettingsStatus, 'ready')
  assert.equal(state().projectSettings.bbsSettings.source, 'ERP')
  assert.equal(isQueueActive(), true, 'apply resumed the write pipeline')
  assert.equal(computeRebarGroups(state()).standardBarLengthM, 9)
  const saved = buildSnapshot(state())
  assert.equal(saved.projectSettings.bbsSettings.settingsVersion, 'company-v1')
  stopSyncCoordinator(); stopSyncEngine(); teardownLiveSyncQueue(); teardownCanonicalSyncQueue()

  // A failed initialisation resets the partial state it created.
  const brokenStore = { getState: () => { throw new Error('engine start failed') }, subscribe: () => () => {} }
  await assert.rejects(startWritePipeline(brokenStore, conn, 'building-a', { knownBaseVersion: 1 }), /engine start failed/)
  assert.equal(getCanonicalSyncStatus().active, false, 'canonical queue reset')
  assert.equal(isQueueActive(), false, 'live queue reset')

  // Integrity-failed reopen: JSX cannot run in node, so assert the wiring in source.
  const app = fs.readFileSync('src/App.jsx', 'utf8')
  assert.match(app, /return <><EditorReadOnlyBanner \/><BbsSettingsBanner \/><\/>/, 'read-only banner renders outside the settings gate')
  const session = fs.readFileSync('src/projects/erpSession.js', 'utf8')
  const branch = session.slice(session.indexOf("res?.source === 'integrity-failed'"))
  assert.ok(branch.indexOf("bbsSettingsStatus: 'aborted'") > 0 && branch.indexOf("bbsSettingsStatus: 'aborted'") < branch.indexOf('return true'), 'integrity failure ends in a terminal state')
  const banner = fs.readFileSync('src/components/BbsSettingsBanner.jsx', 'utf8')
  assert.match(banner, /status === 'aborted'/)
  const { engageEditorReadOnly, editorReadOnlyReason, _resetEditorWriteGuard } = await import('../src/projects/editorWriteGuard.js')
  _resetEditorWriteGuard()
  engageEditorReadOnly('failed an integrity check. Please reload the page')
  assert.match(editorReadOnlyReason(), /integrity check.*reload/)
  console.log('PASS: reopened drawing waits for review, apply resumes sync and saves; integrity failure stays visible')
} finally { globalThis.fetch = originalFetch }
