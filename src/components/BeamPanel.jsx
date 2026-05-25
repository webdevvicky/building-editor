// Phase 1.7+ — Selected beam editor (explicit beams only).
//
// Mounted when selectedBeamId points at an EXPLICIT beam. Wall-derived beams
// stay unselectable by design — they have no persistent entity to bind a
// per-instance reinforcementSpecId to and resolve via class default →
// project default → ESTIMATE through src/specs/resolution.js.
//
// Resolution badge + Apply-to-matching button mirror ColumnPanel.

import { useStore } from '../store'
import { BEAM_LEVEL_REGISTRY } from '../constants/structural'
import { resolveBeamReinforcementSpec, humanizeAssignmentSource } from '../specs/resolution'
import { dialog } from './ui/Dialog'
import { toast } from './ui/Toast'
import SelectionPanel from './ui/SelectionPanel'
import { Button } from './ui/Button'
import { Field } from './ui/Field'

const fieldRow = { marginTop: 'var(--space-2)' }
const label    = { color: 'var(--color-text-muted)', marginBottom: 2, fontSize: 'var(--text-xs)' }

const SOURCE_COLOR = {
  INSTANCE:        { bg: 'var(--color-success-bg)', fg: 'var(--color-success)' },
  CLASS:           { bg: 'var(--color-primary-bg)', fg: 'var(--color-primary)' },
  PROJECT_DEFAULT: { bg: 'var(--color-warning-bg)', fg: 'var(--color-warning)' },
  ESTIMATE:        { bg: 'var(--color-bg-muted)',   fg: 'var(--color-text-muted)' },
}
function resBadge(source) {
  const c = SOURCE_COLOR[source] ?? SOURCE_COLOR.ESTIMATE
  return {
    marginTop: 'var(--space-1)',
    padding: 'var(--space-1) var(--space-2)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--text-xs)',
    background: c.bg,
    color: c.fg,
    lineHeight: 1.3,
  }
}

export default function BeamPanel() {
  const selectedBeamId = useStore(s => s.selectedBeamId)
  const beams          = useStore(s => s.beams)
  const projectSettings = useStore(s => s.projectSettings)
  // Subscribe to spec catalog + defaults so the badge stays reactive.
  const reinforcementSpecs = useStore(s => s.projectSettings?.reinforcementSpecs)
  const bbsDefaults        = useStore(s => s.projectSettings?.bbsDefaults)
  void reinforcementSpecs; void bbsDefaults;

  const selectBeam = useStore(s => s.selectBeam)
  const deleteBeam = useStore(s => s.deleteBeam)
  const undo       = useStore(s => s.undo)
  const setBeamReinforcementSpec = useStore(s => s.setBeamReinforcementSpec)
  const applyReinforcementSpecToMatching = useStore(s => s.applyReinforcementSpecToMatching)

  if (!selectedBeamId) return null
  const beam = beams[selectedBeamId]
  // Wall-derived beam ids start with "derived_" and never appear in state.beams.
  if (!beam) return null

  const beamClass = beam.beamClass ?? beam.level
  const lvl = BEAM_LEVEL_REGISTRY.find(l => l.id === beamClass)
  const dims = projectSettings?.beamDimensions?.[beam.level]
  const specs = projectSettings?.reinforcementSpecs ?? {}
  const beamSpecs = Object.values(specs).filter(sp => sp.elementType === 'BEAM')

  const state = useStore.getState()
  const resolved = resolveBeamReinforcementSpec(state, beam)

  function handleDelete() {
    const label = lvl?.label || beamClass || selectedBeamId.slice(0, 4)
    deleteBeam(selectedBeamId)
    selectBeam(null)
    toast.action(`Deleted ${label} beam.`, {
      label: 'Undo', onClick: () => undo(), duration: 5000,
    })
  }

  async function handleApplyToMatching() {
    const peers = Object.values(state.beams).filter(
      b => b.id !== selectedBeamId && (b.beamClass ?? b.level) === beamClass
    )
    if (peers.length === 0) {
      await dialog.alert('No matching beams to update — no other explicit beams share this class.', { title: 'No matching beams' })
      return
    }
    const specLabel = beam.reinforcementSpecId
      ? (specs[beam.reinforcementSpecId]?.label ?? beam.reinforcementSpecId)
      : 'no spec (clear)'
    const ok = await dialog.confirm(
      `Apply "${specLabel}" to ${peers.length} other ${lvl?.label ?? beamClass} beam${peers.length === 1 ? '' : 's'}?`,
      { title: 'Apply to matching beams?', confirmLabel: 'Apply', variant: 'default' }
    )
    if (!ok) return
    applyReinforcementSpecToMatching({
      elementType: 'BEAM',
      sourceEntityId: selectedBeamId,
      specId: beam.reinforcementSpecId ?? null,
    })
  }

  return (
    <SelectionPanel
      title="Beam"
      onClose={() => selectBeam(null)}
      width={260}
    >
      <div style={{ marginBottom: 'var(--space-2)' }}>
        <Button variant="danger" size="sm" onClick={handleDelete}>Delete</Button>
      </div>

      <div style={fieldRow}>
        <div style={label}>Class</div>
        <div style={{ fontSize: 'var(--text-base)' }}>{lvl?.label ?? beamClass}</div>
      </div>

      {dims && (
        <div style={fieldRow}>
          <div style={label}>Section</div>
          <div style={{ fontSize: 'var(--text-base)' }}>{dims.widthIn}″ × {dims.depthIn}″</div>
        </div>
      )}

      <Field label="Steel spec (BBS)">
        <select
          value={beam.reinforcementSpecId ?? ''}
          onChange={e => setBeamReinforcementSpec(selectedBeamId, e.target.value || null)}
          onKeyDown={e => e.stopPropagation()}
        >
          <option value="">— Inherit —</option>
          {beamSpecs.map(sp => <option key={sp.id} value={sp.id}>{sp.label}</option>)}
        </select>
      </Field>
      <div style={resBadge(resolved.source)}>
        <span style={{ fontWeight: 'var(--weight-semibold)' }}>{resolved.specLabel}</span>
        <span style={{ opacity: 0.75 }}> · {humanizeAssignmentSource(resolved.source)}</span>
      </div>
      <div style={{ marginTop: 'var(--space-2)' }}>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleApplyToMatching}
          title="Copy this beam's spec to all other beams of the same class"
        >
          Apply to matching beams
        </Button>
      </div>
      {beamSpecs.length === 0 && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
          Open BBS panel to define beam specs.
        </div>
      )}
    </SelectionPanel>
  )
}
