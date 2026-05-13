import { useStore } from '../store'

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

  if (activeTool !== 'settings') return null

  const {
    heights,
    beamDimensions,
    slabSettings,
    sunshadeSettings,
    parapetSettings,
    staircaseDefaults,
    columnTypes,
    footingTypes,
  } = projectSettings

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
      {['plinth', 'lintel', 'roof'].map(level => {
        const dims = beamDimensions[level] ?? { widthIn: 9, depthIn: 12 }
        return (
          <div key={level}>
            <div style={{ fontSize: 11, color: '#999', marginBottom: 4, textTransform: 'capitalize' }}>{level}</div>
            <div style={fieldRow}>
              <span style={{ ...lbl, minWidth: 160 }}>Width (in)</span>
              <input
                type="number" min={1} step={1} style={numInput}
                value={dims.widthIn}
                onKeyDown={e => e.stopPropagation()}
                onChange={e => setBeamDimension(level, { widthIn: parseFloat(e.target.value) })}
              />
            </div>
            <div style={fieldRow}>
              <span style={{ ...lbl, minWidth: 160 }}>Depth (in)</span>
              <input
                type="number" min={1} step={1} style={numInput}
                value={dims.depthIn}
                onKeyDown={e => e.stopPropagation()}
                onChange={e => setBeamDimension(level, { depthIn: parseFloat(e.target.value) })}
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

      {/* 6. Column Types — read-only */}
      <div style={sectionHead}>Column Types</div>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Label</th>
            <th style={thStyle}>Section</th>
            <th style={thStyle}>Footing</th>
          </tr>
        </thead>
        <tbody>
          {(columnTypes ?? []).map(ct => (
            <tr key={ct.id}>
              <td style={tdStyle}>{ct.label}</td>
              <td style={tdStyle}>
                {ct.shape === 'circle' ? `Ø${ct.diamIn} in` : `${ct.widthIn}×${ct.depthIn} in`}
              </td>
              <td style={tdStyle}>{ct.footingTypeId}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={divider} />

      {/* 7. Footing Types — read-only */}
      <div style={sectionHead}>Footing Types</div>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Label</th>
            <th style={thStyle}>Size (ft)</th>
            <th style={thStyle}>Depth (ft)</th>
          </tr>
        </thead>
        <tbody>
          {(footingTypes ?? []).map(ft => (
            <tr key={ft.id}>
              <td style={tdStyle}>{ft.label}</td>
              <td style={tdStyle}>{ft.lengthFt} × {ft.widthFt}</td>
              <td style={tdStyle}>{ft.depthFt}</td>
            </tr>
          ))}
        </tbody>
      </table>

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
