// EditorReadOnlyBanner — a top banner shown when the editor is latched read-only.
//
// Engaged when reopen hit an integrity failure (the server's canonical document
// failed its checksum and no local snapshot rescued it). Writes are blocked to
// protect saved data; the only recovery is a reload. Renders nothing otherwise, so
// it is invisible in the standalone editor and in a healthy ERP session.

import { useSyncExternalStore } from 'react'
import {
  subscribeEditorReadOnly, editorReadOnlyReason, isEditorReadOnly,
} from '../projects/editorWriteGuard'

const snapshot = () => (isEditorReadOnly() ? editorReadOnlyReason() : null)

const wrap = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  zIndex: 'var(--z-modal, 1000)',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  padding: 'var(--space-2) var(--space-3)',
  background: 'var(--color-danger, #dc2626)',
  color: '#fff',
  fontSize: 'var(--text-sm)',
  boxShadow: 'var(--shadow-md, 0 2px 8px rgba(0,0,0,0.2))',
}
const btn = {
  marginLeft: 'auto',
  border: '1px solid rgba(255,255,255,0.7)',
  background: 'transparent',
  color: '#fff',
  cursor: 'pointer',
  borderRadius: 'var(--radius-sm, 6px)',
  padding: 'var(--space-1) var(--space-2)',
  fontSize: 'var(--text-xs)',
  fontWeight: 'var(--weight-medium)',
  flex: '0 0 auto',
}

export default function EditorReadOnlyBanner() {
  const reason = useSyncExternalStore(subscribeEditorReadOnly, snapshot, snapshot)
  if (!reason) return null
  return (
    <div style={wrap} role="alert" aria-live="assertive">
      <strong>Read-only</strong>
      <span>{reason}</span>
      <button type="button" style={btn} onClick={() => window.location.reload()}>Reload</button>
    </div>
  )
}
