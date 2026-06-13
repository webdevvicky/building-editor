// SyncStatusBadge — subscribes to the cloudSync status store and renders
// a compact pill showing synced / unsynced / syncing / error.
//
// A "Save to cloud" micro-button triggers an immediate push and is shown
// when status is 'unsynced' or 'error'. It is hidden while syncing.
//
// Usage (mount near the toolbar, once per active project):
//   <SyncStatusBadge conn={conn} />
// where conn is the cloud connection record from getCloudConn(projectId).

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { subscribeSyncStatus, syncToCloud } from '../projects/cloudSync'
import './SyncStatusBadge.css'

const LABELS = {
  idle:     'Cloud: idle',
  syncing:  'Syncing…',
  synced:   'Synced',
  unsynced: 'Unsaved changes',
  error:    'Sync error',
}

const TOOLTIPS = {
  idle:     'No cloud sync has run yet for this session.',
  syncing:  'Uploading snapshot to ERP…',
  synced:   'All changes saved to ERP cloud.',
  unsynced: 'Local changes have not been pushed to the ERP yet.',
}

/**
 * @param {{ conn: {erpUrl:string, editorProjectId:string, apiKey:string} }} props
 */
export default function SyncStatusBadge({ conn }) {
  const [syncState, setSyncState] = useState({ status: 'idle', lastError: null, lastSyncedAt: null })
  const [pushing, setPushing] = useState(false)

  useEffect(() => {
    const unsub = subscribeSyncStatus((s) => setSyncState(s))
    return unsub
  }, [])

  const { status, lastError, lastSyncedAt } = syncState

  const tooltipText = status === 'error'
    ? (lastError ?? 'Unknown error')
    : status === 'synced' && lastSyncedAt
      ? `Last synced: ${new Date(lastSyncedAt).toLocaleTimeString()}`
      : TOOLTIPS[status] ?? ''

  async function handleSaveNow() {
    if (pushing || status === 'syncing') return
    setPushing(true)
    try {
      const state = useStore.getState()
      await syncToCloud(state, conn)
    } finally {
      setPushing(false)
    }
  }

  const showSaveBtn = conn && (status === 'unsynced' || status === 'error' || status === 'idle')
  const saving = pushing || status === 'syncing'

  return (
    <div
      className={`sync-badge sync-badge--${status}`}
      role="status"
      aria-label={LABELS[status] ?? status}
    >
      <span className="sync-badge__dot" aria-hidden="true" />
      <span className="sync-badge__label">{LABELS[status] ?? status}</span>

      {showSaveBtn && (
        <button
          type="button"
          className="sync-badge__btn"
          onClick={handleSaveNow}
          disabled={saving || !conn}
          aria-label="Save to cloud now"
        >
          {saving ? 'Saving…' : 'Save now'}
        </button>
      )}

      {tooltipText && (
        <span className="sync-badge__tooltip" aria-hidden="true">
          {tooltipText}
        </span>
      )}
    </div>
  )
}
