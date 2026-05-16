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

const panelStyle = {
  position: 'absolute', top: 56, left: 16,
  background: '#fff', border: '1px solid #ccc', borderRadius: 8,
  padding: '12px 14px', zIndex: 10, minWidth: 240, fontSize: 13,
  maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
}
const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
const fieldRow = { marginTop: 8 }
const label    = { color: '#888', marginBottom: 2, fontSize: 11 }
const deleteBtn = {
  background: '#fff0f0', border: '1px solid #e74c3c', borderRadius: 4,
  color: '#e74c3c', cursor: 'pointer', fontSize: 11, padding: '3px 8px',
}

const SOURCE_COLOR = {
  INSTANCE:        { bg: '#e8f5e9', fg: '#2e7d32' },
  CLASS:           { bg: '#e3f2fd', fg: '#1565c0' },
  PROJECT_DEFAULT: { bg: '#fff8e1', fg: '#a37200' },
  ESTIMATE:        { bg: '#f5f5f5', fg: '#888' },
}
function resBadge(source) {
  const c = SOURCE_COLOR[source] ?? SOURCE_COLOR.ESTIMATE
  return {
    marginTop: 4, padding: '4px 8px', borderRadius: 4,
    fontSize: 11, background: c.bg, color: c.fg, lineHeight: 1.3,
  }
}
const applyBtn = {
  marginTop: 6, padding: '4px 10px', fontSize: 11,
  background: '#fafafa', border: '1px solid #bbb', borderRadius: 4,
  color: '#444', cursor: 'pointer', width: '100%',
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
    deleteBeam(selectedBeamId)
    selectBeam(null)
  }

  function handleApplyToMatching() {
    const peers = Object.values(state.beams).filter(
      b => b.id !== selectedBeamId && (b.beamClass ?? b.level) === beamClass
    )
    if (peers.length === 0) {
      window.alert('No matching beams to update — no other explicit beams share this class.')
      return
    }
    const specLabel = beam.reinforcementSpecId
      ? (specs[beam.reinforcementSpecId]?.label ?? beam.reinforcementSpecId)
      : 'no spec (clear)'
    const ok = window.confirm(
      `Apply "${specLabel}" to ${peers.length} other ${lvl?.label ?? beamClass} beam${peers.length === 1 ? '' : 's'}?`
    )
    if (!ok) return
    applyReinforcementSpecToMatching({
      elementType: 'BEAM',
      sourceEntityId: selectedBeamId,
      specId: beam.reinforcementSpecId ?? null,
    })
  }

  return (
    <div style={panelStyle}>
      <div style={rowStyle}>
        <strong>Beam</strong>
        <button style={deleteBtn} onClick={handleDelete}>Delete</button>
      </div>

      <div style={fieldRow}>
        <div style={label}>Class</div>
        <div>{lvl?.label ?? beamClass}</div>
      </div>

      {dims && (
        <div style={fieldRow}>
          <div style={label}>Section</div>
          <div>{dims.widthIn}″ × {dims.depthIn}″</div>
        </div>
      )}

      <div style={fieldRow}>
        <div style={label}>Steel spec (BBS)</div>
        <select
          value={beam.reinforcementSpecId ?? ''}
          onChange={e => setBeamReinforcementSpec(selectedBeamId, e.target.value || null)}
          onKeyDown={e => e.stopPropagation()}
          style={{ width: '100%', fontSize: 13 }}
        >
          <option value="">— Inherit —</option>
          {beamSpecs.map(sp => <option key={sp.id} value={sp.id}>{sp.label}</option>)}
        </select>
        <div style={resBadge(resolved.source)}>
          <span style={{ fontWeight: 600 }}>{resolved.specLabel}</span>
          <span style={{ opacity: 0.75 }}> · {humanizeAssignmentSource(resolved.source)}</span>
        </div>
        <button
          style={applyBtn}
          onClick={handleApplyToMatching}
          title="Copy this beam's spec to all other beams of the same class"
        >Apply to matching beams</button>
        {beamSpecs.length === 0 && (
          <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>
            Open BBS panel to define beam specs.
          </div>
        )}
      </div>
    </div>
  )
}
