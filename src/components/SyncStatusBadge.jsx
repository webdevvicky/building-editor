// SyncStatusBadge — live ERP sync status, bottom-right.
//
// Subscribes to the liveSyncQueue. Shows idle / syncing N / N failed, and
// exposes "Retry failed" + "Resync all". Renders ONLY when the queue is active
// (ERP-launch mode) — invisible in the standalone editor.

import { useSyncExternalStore } from 'react'
import {
  getSyncStatus, subscribeSyncStatus, retryFailed, resyncAll,
} from '../projects/liveSyncQueue'

const wrap = {
  position: 'fixed',
  right: 'var(--space-3)',
  bottom: 'var(--space-3)',
  zIndex: 'var(--z-toast)',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  padding: 'var(--space-1) var(--space-3)',
  borderRadius: 'var(--radius-pill, 999px)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface, #fff)',
  boxShadow: 'var(--shadow-md, 0 2px 8px rgba(0,0,0,0.12))',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text)',
}
const dot = (color) => ({ width: 8, height: 8, borderRadius: '50%', background: color, flex: '0 0 auto' })
const btn = {
  border: 'none', background: 'transparent', cursor: 'pointer',
  color: 'var(--color-primary)', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', padding: 0,
}

export default function SyncStatusBadge() {
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus)
  if (!status.active) return null

  const { pending, failed, draining } = status
  let color = 'var(--color-success, #16a34a)'
  let label = 'ERP synced'
  if (failed > 0) { color = 'var(--color-danger, #dc2626)'; label = `${failed} failed` }
  else if (pending > 0 || draining) { color = 'var(--color-warning, #d97706)'; label = `Syncing ${pending}…` }

  return (
    <div style={wrap} role="status" aria-live="polite">
      <span style={dot(color)} />
      <span>{label}</span>
      {failed > 0 && (
        <button type="button" style={btn} onClick={retryFailed}>Retry failed</button>
      )}
      <button type="button" style={{ ...btn, color: 'var(--color-text-secondary)' }} onClick={resyncAll}>Resync all</button>
    </div>
  )
}
