// ProjectionMismatchBanner — warns when the ERP holds building geometry this
// canvas is not showing (canonical document missing or stale). Offers an
// explicit "Load from ERP" reconstruction; renders nothing when in sync.

import { useState, useSyncExternalStore } from 'react'
import {
  subscribeProjectionMismatch, projectionMismatch, loadFromErp, dismissProjectionMismatch,
} from '../projects/projectionGuard'
import { useStore } from '../store'

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
  background: 'var(--color-warning, #d97706)',
  color: '#fff',
  fontSize: 'var(--text-sm)',
  boxShadow: 'var(--shadow-md, 0 2px 8px rgba(0,0,0,0.2))',
}
const btn = {
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

export default function ProjectionMismatchBanner() {
  const mismatch = useSyncExternalStore(subscribeProjectionMismatch, projectionMismatch)
  const loadProject = useStore((s) => s.loadProject)
  const [busy, setBusy] = useState(false)
  if (!mismatch) return null

  const onLoad = async () => {
    setBusy(true)
    try {
      const { skipped } = await loadFromErp(loadProject)
      if (skipped?.rooms?.length) {
        console.warn('[projectionGuard] rooms skipped (no dimensions):', skipped.rooms)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={wrap} role="alert">
      <span aria-hidden="true">⚠️</span>
      <span>
        ERP data mismatch: the ERP holds {mismatch.projRooms} room{mismatch.projRooms === 1 ? '' : 's'} /{' '}
        {mismatch.projWalls} walls for this building, but this canvas shows {mismatch.canvasRooms} /{' '}
        {mismatch.canvasWalls}. The saved drawing document is missing or stale — anything you draw here
        will NOT reflect what the ERP already knows. Load the ERP geometry to continue safely
        (structural/MEP elements stay ERP-side and are not redrawn).
      </span>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
        <button style={btn} onClick={onLoad} disabled={busy}>
          {busy ? 'Loading…' : 'Load from ERP'}
        </button>
        <button style={btn} onClick={dismissProjectionMismatch} disabled={busy}>
          Dismiss
        </button>
      </span>
    </div>
  )
}
