import { useStore } from '../store'

// Dev-only banner shown when the editor was launched with reopen=reconstruct
// (reconstruct INSPECTION mode). In that mode NO writers are wired — neither the
// canonical document nor the PG projection — so this makes the read-only state
// explicit and prevents a developer from assuming edits will persist. Removed
// together with the reconstruction path in Phase 3.
export default function ReconstructInspectionBanner() {
  const active = useStore((s) => s.erpInspectionMode)
  if (!active) return null
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 'var(--z-modal)',
        padding: 'var(--space-1) var(--space-3)',
        background: 'var(--color-warning-bg)',
        color: 'var(--color-warning)',
        fontSize: 'var(--text-sm)',
        fontWeight: 'var(--weight-semibold)',
        textAlign: 'center',
        borderBottom: '1px solid var(--color-warning)',
        pointerEvents: 'none',
      }}
    >
      ⚠ Viewing reconstructed model (development mode) — read-only, no changes are saved
    </div>
  )
}
