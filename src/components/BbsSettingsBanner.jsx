import { Button } from './ui/Button.jsx'
import { useStore } from '../store.js'
import { getErpLaunchContext } from '../projects/erpLaunchContext.js'
import { initErpSession } from '../projects/erpSession.js'
import { applyPendingBbsSettings } from '../projects/bbsSettingsSession.js'

export default function BbsSettingsBanner() {
  const status = useStore(s => s.bbsSettingsStatus)
  const error = useStore(s => s.bbsSettingsError)
  const pending = useStore(s => s.bbsSettingsPending)
  const saved = useStore(s => s.projectSettings.bbsSettings)
  const connected = !!getErpLaunchContext()
  const labels = { coverColumnMm: 'Column cover (mm)', coverFootingMm: 'Footing cover (mm)', coverSlabMm: 'Slab cover (mm)', coverBeamMm: 'Beam cover (mm)', stockBarLengthM: 'Stock bar length (m)', lapLengthFactor: 'Lap length (× diameter)', steelWastagePct: 'Steel wastage (%)', concreteWastagePct: 'Concrete wastage (%)' }
  const missing = connected && status === 'ready' && saved?.source !== 'ERP' && !pending
  if (connected && status === 'ready' && !pending && !missing) return null
  return <div role={error ? 'alert' : 'status'} style={{ padding: '8px 16px', background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', flexShrink: 0, maxHeight: '40vh', overflowY: 'auto' }}>
    {!connected ? (saved?.source === 'ERP' ? 'Offline mode — using this drawing’s saved company bar settings and explicit overrides.' : 'Offline mode — using built-in IS-code bar defaults and explicit overrides.')
      : status === 'aborted' ? 'Company bar settings were not loaded because this building could not be opened safely. Reload the page.'
      : status === 'error' ? `${error} Bar calculations are unavailable until settings load.`
      : missing ? 'Company bar settings are required before editing this drawing.'
      : status === 'review' ? 'Company bar settings must be reviewed and applied before editing this drawing.'
      : status !== 'ready' ? 'Loading company bar settings…'
      : 'Company bar settings changed — review'}
    {connected && (status === 'error' || missing) && <Button onClick={() => initErpSession().catch(err => useStore.setState({ bbsSettingsStatus: 'error', bbsSettingsError: err.message }))}>Retry</Button>}
    {connected && pending && <details open={status === 'review'}>
      <summary>Review bar settings</summary>
      <table><thead><tr><th>Setting</th><th>Drawing</th><th>Current company/project</th></tr></thead><tbody>
        {Object.entries(pending.settings).map(([key, value]) => <tr key={key}><td>{labels[key]}</td><td>{saved?.settings?.[key] ?? 'Not recorded'}</td><td>{value}</td></tr>)}
      </tbody></table>
      <p>Applying recalculates bars using these settings and re-sends them to the ERP. Explicit member and spec overrides remain.</p>
      <Button variant="primary" onClick={() => applyPendingBbsSettings(useStore)}>Apply reviewed settings</Button>
    </details>}
  </div>
}
