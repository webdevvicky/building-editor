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
    store.setState({ bbsSettingsStatus: 'ready', bbsSettingsPending: !initial && saved?.settingsVersion !== latest.settingsVersion ? latest : null })
    return true
  } catch (error) {
    store.setState({ bbsSettingsStatus: 'error', bbsSettingsError: error instanceof Error ? error.message : 'Could not load company bar settings.' })
    return false
  }
}

/** The explicit review/apply action is the only writer of new settings on an existing drawing. */
export function applyPendingBbsSettings(store) {
  const pending = store.getState().bbsSettingsPending
  if (!pending) return
  store.getState().setProjectSettings({ bbsSettings: pending })
  store.setState({ bbsSettingsPending: null })
}
