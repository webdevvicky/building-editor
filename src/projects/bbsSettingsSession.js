import { validateEditorConfig } from '../specs/effectiveBbsSettings.js'

/** Fetch after canonical reopen; a network response never replaces saved design inputs. */
export async function loadBbsSettings(store, conn, { initial = false } = {}) {
  store.setState({ bbsSettingsRequired: true, bbsSettingsStatus: 'loading', bbsSettingsError: null, bbsSettingsPending: null })
  if (initial) store.getState().setProjectSettings({ bbsSettings: null })
  try {
    const response = await fetch(`${conn.erpUrl.replace(/\/$/, '')}/api/v1/building-structure/buildings/${conn.buildingId}/editor-config`, {
      headers: { Authorization: `Bearer ${await conn.getToken()}` },
    })
    if (!response.ok) throw new Error(`Could not load company bar settings (${response.status}).`)
    const envelope = await response.json()
    const latest = validateEditorConfig(envelope.data ?? envelope)
    const saved = store.getState().projectSettings.bbsSettings
    if (saved?.source === 'ERP') validateEditorConfig(saved)
    if (initial) store.getState().setProjectSettings({ bbsSettings: latest })
    // A reopened drawing with no saved ERP snapshot adopts only by explicit review; until
    // then no bar calculation (so no sync start) may run.
    const adopting = !initial && saved?.source !== 'ERP'
    store.setState({
      bbsSettingsStatus: adopting ? 'review' : 'ready',
      bbsSettingsPending: !initial && (adopting || saved?.settingsVersion !== latest.settingsVersion) ? latest : null,
    })
    return true
  } catch (error) {
    store.setState({ bbsSettingsStatus: 'error', bbsSettingsError: error instanceof Error ? error.message : 'Could not load company bar settings.' })
    return false
  }
}

let _deferredStart = null

/** Park the write-pipeline start until the initial settings review is applied. */
export function deferWritePipeline(start) { _deferredStart = start }
export function resetDeferredWritePipeline() { _deferredStart = null }

/**
 * The explicit review/apply action is the only writer of new settings on an existing drawing.
 * When the review gated startup, applying also starts the write pipeline and re-projects
 * the bars; the workspace opens only once that succeeded.
 */
export async function applyPendingBbsSettings(store) {
  const pending = store.getState().bbsSettingsPending
  if (!pending) return true
  const start = _deferredStart
  store.getState().setProjectSettings({ bbsSettings: pending })
  store.setState({ bbsSettingsPending: null })
  if (!start) {
    store.setState({ bbsSettingsStatus: 'ready' })
    return true
  }
  store.setState({ bbsSettingsStatus: 'loading' })
  try {
    await start(true)
    _deferredStart = null
    store.setState({ bbsSettingsStatus: 'ready' })
    return true
  } catch (error) {
    store.setState({ bbsSettingsStatus: 'error', bbsSettingsError: error instanceof Error ? error.message : 'Could not start sync.' })
    return false
  }
}
