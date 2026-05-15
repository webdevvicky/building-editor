import { useStore } from '../store'
import { BEAM_LEVEL_REGISTRY } from '../constants/structural'
import { getColumnDimLabel } from '../lib/columnShapes'

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

const fieldRow = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }

const lbl = { color: '#666', minWidth: 160, fontSize: 12 }

const numInput = { width: 72, fontSize: 13 }

const divider = { borderTop: '1px solid #f0f0f0', margin: '4px 0' }

const tableStyle = { width: '100%', fontSize: 12, borderCollapse: 'collapse' }
const thStyle = { textAlign: 'left', color: '#888', fontWeight: 600, paddingBottom: 4 }
const tdStyle = { paddingBottom: 4, paddingRight: 8 }

function NumField({ label, value, onChange, min = 0, step = 0.5 }) {
  return (
    <div style={fieldRow}>
      <span style={lbl}>{label}</span>
      <input
        type="number" min={min} step={step}
        style={numInput} value={value}
        onKeyDown={e => e.stopPropagation()}
        onChange={e => onChange(parseFloat(e.target.value))}
      />
    </div>
  )
}

function CheckField({ label, value, onChange }) {
  return (
    <div style={{ ...fieldRow, cursor: 'pointer' }} onClick={() => onChange(!value)}>
      <span style={lbl}>{label}</span>
      <input
        type="checkbox" checked={!!value} readOnly
        onKeyDown={e => e.stopPropagation()}
      />
    </div>
  )
}

export default function ProjectSettingsPanel() {
  const projectSettings      = useStore(s => s.projectSettings)
  const activeTool           = useStore(s => s.activeTool)
  const setTool              = useStore(s => s.setTool)
  const setHeights           = useStore(s => s.setHeights)
  const setBeamDimension     = useStore(s => s.setBeamDimension)
  const setSlabSettings      = useStore(s => s.setSlabSettings)
  const setSunshadeSettings  = useStore(s => s.setSunshadeSettings)
  const setParapetSettings   = useStore(s => s.setParapetSettings)
  const setStaircaseDefaults = useStore(s => s.setStaircaseDefaults)
  const setRccSpecs          = useStore(s => s.setRccSpecs)
  const setColumnTypeEntry   = useStore(s => s.setColumnTypeEntry)
  const addColumnType        = useStore(s => s.addColumnType)
  const removeColumnType     = useStore(s => s.removeColumnType)

  if (activeTool !== 'settings') return null

  const {
    heights,
    beamDimensions,
    slabSettings,
    sunshadeSettings,
    parapetSettings,
    staircaseDefaults,
    columnTypes,
    rccSpecs,
  } = projectSettings

  const steelRatios = rccSpecs?.steelKgPerM3 ?? {}

  const STEEL_ELEMENTS = [
    { key: 'FOOTING',     label: 'Footings' },
    { key: 'COLUMN',      label: 'Columns' },
    { key: 'BEAM',        label: 'Beams' },
    { key: 'SLAB',        label: 'Slabs' },
    { key: 'STAIRCASE',   label: 'Staircases' },
    { key: 'CIVIL_STAMP', label: 'Civil (sump/septic)' },
  ]

  return (
    <div style={overlay}>
      <div style={headerRow}>
        <strong style={{ fontSize: 15 }}>Project Settings</strong>
        <button style={closeBtn} onClick={() => setTool('select')}>×</button>
      </div>

      {/* 1. Floor Heights */}
      <div style={sectionHead}>Floor Heights</div>
      <NumField
        label="Plinth height (ft)" step={0.5}
        value={heights.plinthHeightFt}
        onChange={v => setHeights({ plinthHeightFt: v })}
      />
      <NumField
        label="Floor height (ft)" step={0.5}
        value={heights.floorHeightFt}
        onChange={v => setHeights({ floorHeightFt: v })}
      />

      <div style={divider} />

      {/* 2. Beam Dimensions */}
      <div style={sectionHead}>Beam Dimensions</div>
      {BEAM_LEVEL_REGISTRY.map(lvl => {
        const dims = beamDimensions[lvl.id] ?? { widthIn: lvl.defaultWidthIn, depthIn: lvl.defaultDepthIn }
        return (
          <div key={lvl.id}>
            <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>{lvl.label}</div>
            <div style={fieldRow}>
              <span style={{ ...lbl, minWidth: 160 }}>Width (in)</span>
              <input
                type="number" min={1} step={1} style={numInput}
                value={dims.widthIn}
                onKeyDown={e => e.stopPropagation()}
                onChange={e => setBeamDimension(lvl.id, { widthIn: parseFloat(e.target.value) })}
              />
            </div>
            <div style={fieldRow}>
              <span style={{ ...lbl, minWidth: 160 }}>Depth (in)</span>
              <input
                type="number" min={1} step={1} style={numInput}
                value={dims.depthIn}
                onKeyDown={e => e.stopPropagation()}
                onChange={e => setBeamDimension(lvl.id, { depthIn: parseFloat(e.target.value) })}
              />
            </div>
          </div>
        )
      })}

      <div style={divider} />

      {/* 3. Slab Settings */}
      <div style={sectionHead}>Slab Settings</div>
      <NumField
        label="Main thickness (in)" step={1}
        value={slabSettings.mainThicknessIn}
        onChange={v => setSlabSettings({ mainThicknessIn: v })}
      />
      <NumField
        label="Sunken depth (in)" step={1}
        value={slabSettings.sunkenDepthIn}
        onChange={v => setSlabSettings({ sunkenDepthIn: v })}
      />

      <div style={divider} />

      {/* 4. Sunshade Settings */}
      <div style={sectionHead}>Sunshade Settings</div>
      <CheckField
        label="Enabled"
        value={sunshadeSettings.enabled}
        onChange={v => setSunshadeSettings({ enabled: v })}
      />
      <NumField
        label="Projection (ft)" step={0.5}
        value={sunshadeSettings.projectionFt}
        onChange={v => setSunshadeSettings({ projectionFt: v })}
      />
      <NumField
        label="Thickness (in)" step={1}
        value={sunshadeSettings.thicknessIn}
        onChange={v => setSunshadeSettings({ thicknessIn: v })}
      />

      <div style={divider} />

      {/* 5. Parapet Settings */}
      <div style={sectionHead}>Parapet Settings</div>
      <CheckField
        label="Enabled"
        value={parapetSettings.enabled}
        onChange={v => setParapetSettings({ enabled: v })}
      />
      <NumField
        label="Height (ft)" step={0.5}
        value={parapetSettings.heightFt}
        onChange={v => setParapetSettings({ heightFt: v })}
      />
      <NumField
        label="Thickness (in)" step={1}
        value={parapetSettings.thicknessIn}
        onChange={v => setParapetSettings({ thicknessIn: v })}
      />

      <div style={divider} />

      {/* 6. RCC Specifications — steel ratios per element */}
      <div style={sectionHead}>RCC Specifications</div>
      <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>Steel reinforcement (kg/m³ of RCC)</div>
      {STEEL_ELEMENTS.map(({ key, label }) => (
        <NumField
          key={key}
          label={label}
          step={1}
          value={steelRatios[key] ?? 0}
          onChange={v => setRccSpecs({ steelKgPerM3: { [key]: v } })}
        />
      ))}

      <div style={divider} />

      {/* 7. Column & Footing Types — editable */}
      <div style={sectionHead}>Column &amp; Footing Types</div>
      {(columnTypes ?? []).map(ct => (
        <div key={ct.id} style={{ border: '1px solid #eee', borderRadius: 4, padding: '8px 10px', marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <input
              style={{ fontSize: 12, fontWeight: 600, border: '1px solid #ddd', borderRadius: 3, padding: '2px 6px', flex: 1, marginRight: 8 }}
              value={ct.label}
              onKeyDown={e => e.stopPropagation()}
              onChange={e => setColumnTypeEntry(ct.id, { label: e.target.value })}
            />
            <button
              style={{ background: '#fff0f0', border: '1px solid #e74c3c', borderRadius: 3, color: '#e74c3c', cursor: 'pointer', fontSize: 10, padding: '2px 6px' }}
              onClick={() => removeColumnType(ct.id)}
            >✕</button>
          </div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Section</div>
          {ct.shape === 'circle' ? (
            <NumField label="Diameter (in)" step={1} value={ct.diamIn ?? 12}
              onChange={v => setColumnTypeEntry(ct.id, { diamIn: v })} />
          ) : (
            <>
              <NumField label="Width (in)" step={1} value={ct.widthIn ?? 9}
                onChange={v => setColumnTypeEntry(ct.id, { widthIn: v })} />
              <NumField label="Depth (in)" step={1} value={ct.depthIn ?? 9}
                onChange={v => setColumnTypeEntry(ct.id, { depthIn: v })} />
            </>
          )}
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4, marginTop: 4 }}>Footing</div>
          <NumField label="Length (ft)" step={0.5} value={ct.footingLengthFt ?? 4}
            onChange={v => setColumnTypeEntry(ct.id, { footingLengthFt: v })} />
          <NumField label="Width (ft)" step={0.5} value={ct.footingWidthFt ?? 4}
            onChange={v => setColumnTypeEntry(ct.id, { footingWidthFt: v })} />
          <NumField label="Depth (ft)" step={0.25} value={ct.footingDepthFt ?? 1}
            onChange={v => setColumnTypeEntry(ct.id, { footingDepthFt: v })} />
        </div>
      ))}
      <button
        style={{ fontSize: 11, background: '#f0f7ff', border: '1px solid #3498db', borderRadius: 4, color: '#2471a3', cursor: 'pointer', padding: '4px 10px', marginBottom: 8 }}
        onClick={() => addColumnType({})}
      >+ Add Column Type</button>

      <div style={divider} />

      {/* 8. Staircase Defaults */}
      <div style={sectionHead}>Staircase Defaults</div>
      <NumField
        label="Tread (in)" step={1}
        value={staircaseDefaults.treadIn}
        onChange={v => setStaircaseDefaults({ treadIn: v })}
      />
      <NumField
        label="Riser (in)" step={0.5}
        value={staircaseDefaults.riserIn}
        onChange={v => setStaircaseDefaults({ riserIn: v })}
      />
      <NumField
        label="Waist slab (in)" step={1}
        value={staircaseDefaults.waistSlabIn}
        onChange={v => setStaircaseDefaults({ waistSlabIn: v })}
      />
      <NumField
        label="Landing width (ft)" step={0.5}
        value={staircaseDefaults.landingFtWidth}
        onChange={v => setStaircaseDefaults({ landingFtWidth: v })}
      />
      <NumField
        label="Landing length (ft)" step={0.5}
        value={staircaseDefaults.landingFtLength}
        onChange={v => setStaircaseDefaults({ landingFtLength: v })}
      />
      <NumField
        label="Flight width (ft)" step={0.5}
        value={staircaseDefaults.flightWidthFt}
        onChange={v => setStaircaseDefaults({ flightWidthFt: v })}
      />
    </div>
  )
}
