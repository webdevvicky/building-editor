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

const overlay = {
  position: 'fixed', top: '50%', left: '50%',
  transform: 'translate(-50%, -50%)', zIndex: 100,
  width: 480, maxHeight: '80vh', overflowY: 'auto',
  background: '#fff', borderRadius: 8,
  padding: 20, boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
  fontSize: 13,
}
const headerRow = {
  display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', marginBottom: 16,
}
const closeBtn = {
  background: 'none', border: 'none', fontSize: 18,
  cursor: 'pointer', color: '#555', lineHeight: 1, padding: '0 4px',
}
const sectionHead = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
  color: '#aaa', letterSpacing: 0.5, marginBottom: 6, marginTop: 16,
}
const fieldRow = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }
const lbl = { color: '#666', minWidth: 140, fontSize: 12 }
const numInput = { width: 72, fontSize: 13 }
const divider = { borderTop: '1px solid #f0f0f0', margin: '8px 0' }
const card = { border: '1px solid #eee', borderRadius: 4, padding: '8px 10px', marginBottom: 8 }
const primaryBtn = {
  fontSize: 11, background: '#f0f7ff', border: '1px solid #3498db',
  borderRadius: 4, color: '#2471a3', cursor: 'pointer', padding: '4px 10px',
}
const subtleBtn = {
  fontSize: 10, background: '#fafafa', border: '1px solid #ddd',
  borderRadius: 3, color: '#666', cursor: 'pointer', padding: '2px 6px',
}
const dangerBtn = {
  background: '#fff0f0', border: '1px solid #e74c3c',
  borderRadius: 3, color: '#e74c3c', cursor: 'pointer', fontSize: 10, padding: '2px 6px',
}
const defaultPill = {
  fontSize: 9, background: '#27ae60', color: '#fff',
  borderRadius: 2, padding: '1px 4px', marginLeft: 6,
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
        style={{ flex: 1, fontSize: 13, padding: '3px 6px', border: '1px solid #ccc', borderRadius: 4 }}
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
          style={{ flex: 1, fontSize: 12, border: '1px solid #ddd', borderRadius: 3, padding: '2px 6px' }}
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

  const [selectedId, setSelectedId] = useState(null)
  const [creating, setCreating]     = useState(false)
  const [newType, setNewType]       = useState('COLUMN')

  if (activeTool !== 'bbs') return null

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
  }
  const setAsDefault = (spec) => {
    // BEAM defaults are per-class { plinth, lintel, roof }. Other element
    // types use a flat specId. When prompted, pick a single class to set —
    // user can refine via the Project defaults panel rows below.
    if (spec.elementType === 'BEAM') {
      const classChoice = window.prompt(
        `Apply as default for which beam class? (${BEAM_LEVEL_REGISTRY.map(l => l.id).join(' | ')})`,
        'plinth'
      )
      if (!classChoice || !BEAM_LEVEL_REGISTRY.some(l => l.id === classChoice)) return
      const beamDefaults = { ...(defaults.BEAM ?? {}) }
      beamDefaults[classChoice] = spec.id
      setProjectSettings({ bbsDefaults: { ...defaults, BEAM: beamDefaults } })
      return
    }
    setProjectSettings({ bbsDefaults: { ...defaults, [spec.elementType]: spec.id } })
  }
  const clearBeamClassDefault = (classId) => {
    const beamDefaults = { ...(defaults.BEAM ?? {}) }
    delete beamDefaults[classId]
    setProjectSettings({ bbsDefaults: { ...defaults, BEAM: beamDefaults } })
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
    <div style={overlay}>
      <div style={headerRow}>
        <strong style={{ fontSize: 15 }}>Bar Bending Schedule — Reinforcement Specs</strong>
        <button style={closeBtn} onClick={() => setTool('select')}>×</button>
      </div>

      <div style={sectionHead}>Presets</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {Object.values(REINFORCEMENT_SPEC_PRESETS).map(p => (
          <button key={p.id} style={subtleBtn}
                  disabled={!!specMap[p.id]}
                  onClick={() => applyPreset(p)}>
            + {p.id}
          </button>
        ))}
        <button style={primaryBtn} onClick={applyAllPresets}>Apply all</button>
      </div>

      <div style={divider} />

      <div style={sectionHead}>Specs ({specs.length})</div>
      {specs.length === 0 && (
        <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>
          No specs yet. Apply a preset above or create a new one below.
        </div>
      )}
      {specs.map(s => {
        const isDefault = s.elementType === 'BEAM'
          ? Object.values(defaults.BEAM ?? {}).includes(s.id)
          : defaults[s.elementType] === s.id
        const isSelected = selectedId === s.id
        return (
          <div key={s.id} style={{ ...card, borderColor: isSelected ? '#3498db' : '#eee' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ cursor: 'pointer', flex: 1 }}
                   onClick={() => setSelectedId(isSelected ? null : s.id)}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>{s.label}</span>
                <span style={{ fontSize: 10, color: '#888', marginLeft: 6 }}>{s.elementType}</span>
                {isDefault && <span style={defaultPill}>DEFAULT</span>}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {!isDefault && (
                  <button style={subtleBtn} onClick={() => setAsDefault(s)}>
                    Set default
                  </button>
                )}
                <button style={dangerBtn} onClick={() => removeSpec(s.id)}>✕</button>
              </div>
            </div>
            {isSelected && (
              <div style={{ marginTop: 8 }}>
                <SpecEditor spec={s} onChange={updateSelected} />
              </div>
            )}
          </div>
        )
      })}

      <div style={divider} />

      <div style={sectionHead}>Add new spec</div>
      {!creating ? (
        <button style={primaryBtn} onClick={() => setCreating(true)}>+ Add new spec</button>
      ) : (
        <div style={card}>
          <SelectField label="Element type" value={newType}
            onChange={setNewType} options={ELEMENT_TYPES} />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button style={primaryBtn} onClick={createSpec}>Create</button>
            <button style={subtleBtn} onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={divider} />

      <div style={sectionHead}>Project defaults</div>
      <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>
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
                <div key={lvl.id} style={{ ...fieldRow, paddingLeft: 12 }}>
                  <span style={{ ...lbl, minWidth: 120, fontSize: 11 }}>{lvl.label}</span>
                  <select
                    style={{ flex: 1, fontSize: 12, padding: '2px 6px', border: '1px solid #ccc', borderRadius: 4 }}
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
            <span style={{ fontSize: 12, color: defaults[et] ? '#27ae60' : '#aaa' }}>
              {defaults[et] ? specMap[defaults[et]]?.label ?? defaults[et] : '— (use kg/m³ estimate)'}
            </span>
          </div>
        )
      })}
    </div>
  )
}
