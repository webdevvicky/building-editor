// Phase 1.7 — Reinforcement Spec editor.
//
// Mounted when activeTool === 'bbs'. Reads + writes
// projectSettings.reinforcementSpecs (map of spec id → spec) and
// projectSettings.bbsDefaults (map of elementType → spec id) via the
// generic setProjectSettings action. Both keys are defensively defaulted
// to {} when absent — no store-schema change required for this UI to ship.

import { useState } from 'react'
import { useStore } from '../store'
import { REINFORCEMENT_SPEC_PRESETS } from '../specs/reinforcementSpecs'
import { BEAM_LEVEL_REGISTRY } from '../constants/structural'
import { dialog } from './ui/Dialog'
import { toast } from './ui/Toast'
import { Modal } from './ui/Modal.jsx'
import { Button } from './ui/Button.jsx'

const sectionHead = {
  fontSize: 'var(--text-xs)',
  fontWeight: 'var(--weight-bold)',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
  letterSpacing: 0.5,
  marginBottom: 'var(--space-2)',
  marginTop: 'var(--space-4)',
}
const fieldRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  marginBottom: 'var(--space-2)',
}
const lbl = {
  color: 'var(--color-text-secondary)',
  minWidth: 140,
  fontSize: 'var(--text-sm)',
}
const numInput = {
  width: 72,
  fontSize: 'var(--text-base)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '2px var(--space-2)',
  color: 'var(--color-text)',
  background: 'var(--color-surface)',
}
const divider = {
  borderTop: '1px solid var(--color-border)',
  margin: 'var(--space-2) 0',
}
const card = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--space-2) var(--space-3)',
  marginBottom: 'var(--space-2)',
  background: 'var(--color-surface)',
}
const defaultPill = {
  fontSize: 'var(--text-xs)',
  background: 'var(--color-success-bg)',
  color: 'var(--color-success)',
  border: '1px solid var(--color-success-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '1px var(--space-2)',
  marginLeft: 'var(--space-2)',
  fontWeight: 'var(--weight-medium)',
}

const textInput = {
  flex: 1,
  fontSize: 'var(--text-sm)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '2px var(--space-2)',
  color: 'var(--color-text)',
  background: 'var(--color-surface)',
}

const selectStyle = {
  flex: 1,
  fontSize: 'var(--text-base)',
  padding: '3px var(--space-2)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text)',
  background: 'var(--color-surface)',
}

const ELEMENT_TYPES = ['COLUMN', 'BEAM', 'FOOTING', 'SLAB']

function NumField({ label, value, onChange, step = 1, min = 0 }) {
  return (
    <div style={fieldRow}>
      <span style={lbl}>{label}</span>
      <input
        type="number" min={min} step={step}
        style={numInput} value={value ?? 0}
        onKeyDown={e => e.stopPropagation()}
        onChange={e => onChange(parseFloat(e.target.value))}
      />
    </div>
  )
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div style={fieldRow}>
      <span style={lbl}>{label}</span>
      <select
        style={selectStyle}
        value={value ?? ''}
        onKeyDown={e => e.stopPropagation()}
        onChange={e => onChange(e.target.value)}
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

function SpecEditor({ spec, onChange }) {
  if (!spec) return null
  const setField = (k, v) => onChange({ ...spec, [k]: v })
  const setNested = (k, sub, v) => onChange({ ...spec, [k]: { ...spec[k], [sub]: v } })

  return (
    <div>
      <div style={fieldRow}>
        <span style={lbl}>Label</span>
        <input
          style={textInput}
          value={spec.label ?? ''}
          onKeyDown={e => e.stopPropagation()}
          onChange={e => setField('label', e.target.value)}
        />
      </div>

      {spec.elementType === 'COLUMN' && (
        <>
          <NumField label="Long. bar count"      value={spec.longitudinalBarCount} step={1}
            onChange={v => setField('longitudinalBarCount', v)} />
          <NumField label="Long. bar dia (mm)"   value={spec.longitudinalBarDiaMm} step={2}
            onChange={v => setField('longitudinalBarDiaMm', v)} />
          <NumField label="Stirrup dia (mm)"     value={spec.stirrupBarDiaMm} step={2}
            onChange={v => setField('stirrupBarDiaMm', v)} />
          <NumField label="Stirrup spacing (in)" value={spec.stirrupSpacingIn} step={0.5}
            onChange={v => setField('stirrupSpacingIn', v)} />
          <NumField label="Cover (mm)"           value={spec.coverMm} step={5}
            onChange={v => setField('coverMm', v)} />
          <NumField label="Lap × dia"            value={spec.lapLengthMultiplier} step={5}
            onChange={v => setField('lapLengthMultiplier', v)} />
        </>
      )}

      {spec.elementType === 'BEAM' && (
        <>
          <NumField label="Top bars count"        value={spec.topBars?.count}    step={1}
            onChange={v => setNested('topBars', 'count', v)} />
          <NumField label="Top bar dia (mm)"      value={spec.topBars?.diaMm}    step={2}
            onChange={v => setNested('topBars', 'diaMm', v)} />
          <NumField label="Bottom bars count"     value={spec.bottomBars?.count} step={1}
            onChange={v => setNested('bottomBars', 'count', v)} />
          <NumField label="Bottom bar dia (mm)"   value={spec.bottomBars?.diaMm} step={2}
            onChange={v => setNested('bottomBars', 'diaMm', v)} />
          <NumField label="Stirrup dia (mm)"      value={spec.stirrupBarDiaMm}   step={2}
            onChange={v => setField('stirrupBarDiaMm', v)} />
          <NumField label="Stirrup spacing (in)"  value={spec.stirrupSpacingIn}  step={0.5}
            onChange={v => setField('stirrupSpacingIn', v)} />
          <NumField label="Cover (mm)"            value={spec.coverMm}           step={5}
            onChange={v => setField('coverMm', v)} />
        </>
      )}

      {spec.elementType === 'FOOTING' && (
        <>
          <NumField label="X bars count"     value={spec.xBars?.count} step={1}
            onChange={v => setNested('xBars', 'count', v)} />
          <NumField label="X bar dia (mm)"   value={spec.xBars?.diaMm} step={2}
            onChange={v => setNested('xBars', 'diaMm', v)} />
          <NumField label="Y bars count"     value={spec.yBars?.count} step={1}
            onChange={v => setNested('yBars', 'count', v)} />
          <NumField label="Y bar dia (mm)"   value={spec.yBars?.diaMm} step={2}
            onChange={v => setNested('yBars', 'diaMm', v)} />
          <NumField label="Dev. length × dia" value={spec.developmentLengthMultiplier} step={5}
            onChange={v => setField('developmentLengthMultiplier', v)} />
          <NumField label="Cover (mm)"       value={spec.coverMm} step={5}
            onChange={v => setField('coverMm', v)} />
        </>
      )}

      {spec.elementType === 'SLAB' && (
        <>
          <NumField label="Main bar dia (mm)"     value={spec.mainBarDiaMm}    step={2}
            onChange={v => setField('mainBarDiaMm', v)} />
          <NumField label="Main spacing (in)"     value={spec.mainBarSpacingIn} step={0.5}
            onChange={v => setField('mainBarSpacingIn', v)} />
          <NumField label="Dist. bar dia (mm)"    value={spec.distBarDiaMm}    step={2}
            onChange={v => setField('distBarDiaMm', v)} />
          <NumField label="Dist. spacing (in)"    value={spec.distBarSpacingIn} step={0.5}
            onChange={v => setField('distBarSpacingIn', v)} />
          <NumField label="Cover (mm)"            value={spec.coverMm}         step={5}
            onChange={v => setField('coverMm', v)} />
          <div style={{ ...fieldRow, cursor: 'pointer' }}
               onClick={() => setField('twoWay', !spec.twoWay)}>
            <span style={lbl}>Two-way</span>
            <input type="checkbox" checked={!!spec.twoWay} readOnly />
          </div>
        </>
      )}
    </div>
  )
}

export default function BBSSpecPanel() {
  const activeTool         = useStore(s => s.activeTool)
  const setTool            = useStore(s => s.setTool)
  const projectSettings    = useStore(s => s.projectSettings)
  const setProjectSettings = useStore(s => s.setProjectSettings)
  const undo               = useStore(s => s.undo)

  const [selectedId, setSelectedId] = useState(null)
  const [creating, setCreating]     = useState(false)
  const [newType, setNewType]       = useState('COLUMN')

  const open = activeTool === 'bbs'
  const onClose = () => setTool('select')

  const specMap  = projectSettings?.reinforcementSpecs ?? {}
  const defaults = projectSettings?.bbsDefaults ?? {}
  const specs = Object.values(specMap)
  const selected = selectedId ? specMap[selectedId] : null

  const updateSpecMap = (next) =>
    setProjectSettings({ reinforcementSpecs: next })

  const applyPreset = (preset) => {
    if (specMap[preset.id]) return
    updateSpecMap({ ...specMap, [preset.id]: { ...preset } })
  }
  const applyAllPresets = () => {
    const next = { ...specMap }
    for (const p of Object.values(REINFORCEMENT_SPEC_PRESETS)) {
      if (!next[p.id]) next[p.id] = { ...p }
    }
    updateSpecMap(next)
  }
  const updateSelected = (next) => {
    updateSpecMap({ ...specMap, [next.id]: next })
  }
  const removeSpec = (id) => {
    const specLabel = specMap[id]?.label || id
    const next = { ...specMap }
    delete next[id]
    updateSpecMap(next)
    // also clear from defaults if referenced. BEAM defaults are per-class
    // (nested object); other element-type defaults are flat specIds.
    const nextDefaults = { ...defaults }
    for (const k of Object.keys(nextDefaults)) {
      if (k === 'BEAM' && nextDefaults.BEAM && typeof nextDefaults.BEAM === 'object') {
        const nextBeam = { ...nextDefaults.BEAM }
        for (const cls of Object.keys(nextBeam)) {
          if (nextBeam[cls] === id) delete nextBeam[cls]
        }
        nextDefaults.BEAM = nextBeam
      } else if (nextDefaults[k] === id) {
        delete nextDefaults[k]
      }
    }
    setProjectSettings({ bbsDefaults: nextDefaults })
    if (selectedId === id) setSelectedId(null)
    toast.action(`Deleted reinforcement spec "${specLabel}".`, {
      label: 'Undo', onClick: () => undo(), duration: 5000,
    })
  }
  const setAsDefault = async (spec) => {
    // BEAM defaults are per-class { plinth, lintel, roof }. Other element
    // types use a flat specId. When prompted, pick a single class to set —
    // user can refine via the Project defaults panel rows below.
    if (spec.elementType === 'BEAM') {
      const classChoice = await dialog.prompt(
        `Apply as default for which beam class? (${BEAM_LEVEL_REGISTRY.map(l => l.id).join(' | ')})`,
        { title: 'Set beam class default', defaultValue: 'plinth' }
      )
      if (!classChoice || !BEAM_LEVEL_REGISTRY.some(l => l.id === classChoice)) return
      const beamDefaults = { ...(defaults.BEAM ?? {}) }
      beamDefaults[classChoice] = spec.id
      setProjectSettings({ bbsDefaults: { ...defaults, BEAM: beamDefaults } })
      return
    }
    setProjectSettings({ bbsDefaults: { ...defaults, [spec.elementType]: spec.id } })
  }
  const setBeamClassDefault = (classId, specId) => {
    const beamDefaults = { ...(defaults.BEAM ?? {}) }
    if (specId) beamDefaults[classId] = specId
    else delete beamDefaults[classId]
    setProjectSettings({ bbsDefaults: { ...defaults, BEAM: beamDefaults } })
  }

  const createSpec = () => {
    const id = `${newType}_${Date.now().toString(36)}`
    const base = { id, label: `New ${newType.toLowerCase()} spec`, elementType: newType }
    let spec
    if (newType === 'COLUMN') {
      spec = { ...base, longitudinalBarCount: 4, longitudinalBarDiaMm: 12,
        stirrupBarDiaMm: 8, stirrupSpacingIn: 6, coverMm: 25, lapLengthMultiplier: 50 }
    } else if (newType === 'BEAM') {
      spec = { ...base, topBars: { count: 2, diaMm: 12 }, bottomBars: { count: 2, diaMm: 12 },
        stirrupBarDiaMm: 8, stirrupSpacingIn: 6, coverMm: 25 }
    } else if (newType === 'FOOTING') {
      spec = { ...base, xBars: { count: 6, diaMm: 12 }, yBars: { count: 6, diaMm: 12 },
        developmentLengthMultiplier: 50, coverMm: 40 }
    } else {
      spec = { ...base, mainBarDiaMm: 10, mainBarSpacingIn: 6,
        distBarDiaMm: 8, distBarSpacingIn: 8, coverMm: 20, twoWay: false }
    }
    updateSpecMap({ ...specMap, [id]: spec })
    setSelectedId(id)
    setCreating(false)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Bar Bending Schedule — Reinforcement Specs"
      width={520}
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}
    >
      <div style={sectionHead}>Presets</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
        {Object.values(REINFORCEMENT_SPEC_PRESETS).map(p => (
          <Button
            key={p.id}
            variant="secondary"
            size="sm"
            disabled={!!specMap[p.id]}
            onClick={() => applyPreset(p)}
          >
            + {p.id}
          </Button>
        ))}
        <Button variant="primary" size="sm" onClick={applyAllPresets}>Apply all</Button>
      </div>

      <div style={divider} />

      <div style={sectionHead}>Specs ({specs.length})</div>
      {specs.length === 0 && (
        <div
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            marginBottom: 'var(--space-2)',
          }}
        >
          No specs yet. Apply a preset above or create a new one below.
        </div>
      )}
      {specs.map(s => {
        const isDefault = s.elementType === 'BEAM'
          ? Object.values(defaults.BEAM ?? {}).includes(s.id)
          : defaults[s.elementType] === s.id
        const isSelected = selectedId === s.id
        const cardStyle = isSelected
          ? { ...card, borderColor: 'var(--color-primary)' }
          : card
        return (
          <div key={s.id} style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div
                style={{ cursor: 'pointer', flex: 1 }}
                onClick={() => setSelectedId(isSelected ? null : s.id)}
              >
                <span style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>
                  {s.label}
                </span>
                <span
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-muted)',
                    marginLeft: 'var(--space-2)',
                  }}
                >
                  {s.elementType}
                </span>
                {isDefault && <span style={defaultPill}>DEFAULT</span>}
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                {!isDefault && (
                  <Button variant="secondary" size="sm" onClick={() => setAsDefault(s)}>
                    Set default
                  </Button>
                )}
                <Button variant="danger" size="sm" onClick={() => removeSpec(s.id)}>
                  ✕
                </Button>
              </div>
            </div>
            {isSelected && (
              <div style={{ marginTop: 'var(--space-2)' }}>
                <SpecEditor spec={s} onChange={updateSelected} />
              </div>
            )}
          </div>
        )
      })}

      <div style={divider} />

      <div style={sectionHead}>Add new spec</div>
      {!creating ? (
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          + Add new spec
        </Button>
      ) : (
        <div style={card}>
          <SelectField label="Element type" value={newType}
            onChange={setNewType} options={ELEMENT_TYPES} />
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <Button variant="primary" size="sm" onClick={createSpec}>Create</Button>
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div style={divider} />

      <div style={sectionHead}>Project defaults</div>
      <div
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
          marginBottom: 'var(--space-2)',
        }}
      >
        Entities without a specific reinforcementSpecId fall back to these
        defaults. Entities without spec AND without default fall back to the
        kg/m³ estimate.
      </div>
      {ELEMENT_TYPES.map(et => {
        if (et === 'BEAM') {
          // Per-class defaults — one row per beam class (plinth / lintel / roof).
          // No global beam fallback: unset class → ESTIMATE for beams of that class.
          const beamDefaults = defaults.BEAM ?? {}
          const beamSpecs = Object.values(specMap).filter(sp => sp.elementType === 'BEAM')
          return (
            <div key={et}>
              <div style={{ ...fieldRow, marginBottom: 2 }}>
                <span style={lbl}>BEAM (per class)</span>
              </div>
              {BEAM_LEVEL_REGISTRY.map(lvl => (
                <div key={lvl.id} style={{ ...fieldRow, paddingLeft: 'var(--space-3)' }}>
                  <span style={{ ...lbl, minWidth: 120, fontSize: 'var(--text-xs)' }}>
                    {lvl.label}
                  </span>
                  <select
                    style={{ ...selectStyle, fontSize: 'var(--text-sm)' }}
                    value={beamDefaults[lvl.id] ?? ''}
                    onKeyDown={e => e.stopPropagation()}
                    onChange={e => setBeamClassDefault(lvl.id, e.target.value || null)}
                  >
                    <option value="">— (use kg/m³ estimate) —</option>
                    {beamSpecs.map(sp => <option key={sp.id} value={sp.id}>{sp.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )
        }
        return (
          <div key={et} style={fieldRow}>
            <span style={lbl}>{et}</span>
            <span
              style={{
                fontSize: 'var(--text-sm)',
                color: defaults[et] ? 'var(--color-success)' : 'var(--color-text-muted)',
              }}
            >
              {defaults[et] ? specMap[defaults[et]]?.label ?? defaults[et] : '— (use kg/m³ estimate)'}
            </span>
          </div>
        )
      })}
    </Modal>
  )
}
