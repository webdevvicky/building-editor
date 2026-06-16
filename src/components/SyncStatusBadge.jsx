// SyncStatusBadge — subscribes to the cloudSync status store and renders a
// compact pill: "● <project name> — <status>".
//
// A "Sync now" button triggers an immediate push (bypassing the autosave
// debounce); shown whenever the connection is bound to the open project and a
// push isn't already in flight.
//
// Props:
//   conn   the global cloud connection record (from getCachedConn) — required
//   bound  true when the OPEN local project is the one bound to this connection
//          (conn.localProjectId === currentProjectId). When false, the global
//          sync-status store reflects a different project, so we show a neutral
//          "not syncing this project" state.

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { subscribeSyncStatus, syncToCloud } from '../projects/cloudSync'
import './SyncStatusBadge.css'

const STATUS_WORD = {
  idle:     'idle',
  syncing:  'syncing…',
  synced:   'synced',
  unsynced: 'unsynced',
  error:    'sync error',
}

export default function SyncStatusBadge({ conn, bound = true }) {
  const [syncState, setSyncState] = useState({ status: 'idle', lastError: null, lastSyncedAt: null })
  const [pushing, setPushing] = useState(false)

  useEffect(() => {
    const unsub = subscribeSyncStatus((s) => setSyncState(s))
    return unsub
  }, [])

  const name = conn?.projectName || conn?.editorProjectId || 'ERP'

  // When the open project isn't the bound one, the global status store reflects
  // a DIFFERENT project — ignore it and show a neutral state.
  const status = bound ? syncState.status : 'idle'
  const statusText = bound ? (STATUS_WORD[status] ?? status) : 'not syncing this project'

  const { lastError, lastSyncedAt } = syncState
  const tooltipText = !bound
    ? 'This local project is not the one linked to the ERP. Open the linked project to sync.'
    : status === 'error'
      ? (lastError ?? 'Unknown error')
      : status === 'synced' && lastSyncedAt
        ? `Last synced: ${new Date(lastSyncedAt).toLocaleTimeString()}`
        : ''

  async function handleSyncNow() {
    if (pushing || status === 'syncing' || !conn || !bound) return
    setPushing(true)
    try {
      await syncToCloud(useStore.getState(), conn)
    } finally {
      setPushing(false)
    }
  }

  const showSyncBtn = bound && !!conn && status !== 'syncing'
  const saving = pushing || status === 'syncing'

  return (
    <div
      className={`sync-badge sync-badge--${status}`}
      role="status"
      aria-label={`${name} — ${statusText}`}
    >
      <span className="sync-badge__dot" aria-hidden="true" />
      <span className="sync-badge__label">{name} — {statusText}</span>

      {showSyncBtn && (
        <button
          type="button"
          className="sync-badge__btn"
          onClick={handleSyncNow}
          disabled={saving}
          aria-label="Sync now"
        >
          {saving ? 'Syncing…' : 'Sync now'}
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
