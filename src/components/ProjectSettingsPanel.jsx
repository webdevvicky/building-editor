import { useStore } from '../store'
import { BEAM_LEVEL_REGISTRY } from '../constants/structural'
import { PLASTER_SYSTEMS } from '../specs/plasterSystems'
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
  minWidth: 160,
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
  margin: 'var(--space-1) 0',
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

const labelInput = {
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-semibold)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '2px var(--space-2)',
  flex: 1,
  marginRight: 'var(--space-2)',
  color: 'var(--color-text)',
  background: 'var(--color-surface)',
}

const ctCard = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--space-2) var(--space-3)',
  marginBottom: 'var(--space-2)',
  background: 'var(--color-surface)',
}

const hintText = {
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-muted)',
  marginBottom: 'var(--space-2)',
}

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
  const setColumnTypeEntry      = useStore(s => s.setColumnTypeEntry)
  const addColumnType           = useStore(s => s.addColumnType)
  const removeColumnType        = useStore(s => s.removeColumnType)
  const setProjectSettings      = useStore(s => s.setProjectSettings)
  const setFoundationDefaults   = useStore(s => s.setFoundationDefaults)

  const open = activeTool === 'settings'
  const onClose = () => setTool('select')

  const {
    heights,
    beamDimensions,
    slabSettings,
    sunshadeSettings,
    parapetSettings,
    staircaseDefaults,
    columnTypes,
    rccSpecs,
  } = projectSettings ?? {}

  const steelRatios = rccSpecs?.steelKgPerM3 ?? {}

  const STEEL_ELEMENTS = [
    { key: 'FOOTING',     label: 'Footings' },
    { key: 'COLUMN',      label: 'Columns' },
    { key: 'BEAM',        label: 'Beams' },
    { key: 'SLAB',        label: 'Slabs' },
    { key: 'STAIRCASE',   label: 'Staircases' },
    { key: 'CIVIL_STAMP', label: 'Civil (sump/septic)' },
  ]

  // If settings haven't been loaded yet, just don't render anything inside —
  // the Modal scaffolding is still presented if open.
  if (!open || !projectSettings) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Project Settings"
        width={560}
        footer={<Button variant="ghost" onClick={onClose}>Close</Button>}
      >
        <div />
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Project Settings"
      width={560}
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}
    >
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

      {/* 1b. Default Plaster System (Phase 1.6f) */}
      <div style={sectionHead}>Default Plaster System</div>
      <div style={fieldRow}>
        <span style={lbl}>System</span>
        <select
          style={selectStyle}
          value={projectSettings?.defaultPlasterSystemId ?? ''}
          onKeyDown={e => e.stopPropagation()}
          onChange={e => setProjectSettings({ defaultPlasterSystemId: e.target.value })}
        >
          {Object.values(PLASTER_SYSTEMS).map(sys => (
            <option key={sys.id} value={sys.id}>{sys.label}</option>
          ))}
        </select>
      </div>
      <div style={hintText}>Per-room override available in Room panel.</div>

      <div style={divider} />

      {/* 1c. Foundation Defaults (Phase 1.6e — plum concrete) */}
      <div style={sectionHead}>Foundation Defaults</div>
      <NumField
        label="Plum concrete depth (ft)" step={0.25} min={0}
        value={projectSettings?.foundationDefaults?.plumDepthFt ?? 0}
        onChange={v => setFoundationDefaults({ plumDepthFt: v })}
      />
      <div style={hintText}>
        Mass concrete (typically M15 with 30–40% stone) under footings. 0 disables.
      </div>

      <div style={divider} />

      {/* 2. Beam Dimensions */}
      <div style={sectionHead}>Beam Dimensions</div>
      {BEAM_LEVEL_REGISTRY.map(lvl => {
        const dims = beamDimensions[lvl.id] ?? { widthIn: lvl.defaultWidthIn, depthIn: lvl.defaultDepthIn }
        return (
          <div key={lvl.id}>
            <div
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-muted)',
                marginBottom: 'var(--space-1)',
              }}
            >
              {lvl.label}
            </div>
            <div style={fieldRow}>
              <span style={lbl}>Width (in)</span>
              <input
                type="number" min={1} step={1} style={numInput}
                value={dims.widthIn}
                onKeyDown={e => e.stopPropagation()}
                onChange={e => setBeamDimension(lvl.id, { widthIn: parseFloat(e.target.value) })}
              />
            </div>
            <div style={fieldRow}>
              <span style={lbl}>Depth (in)</span>
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
      <div style={hintText}>Steel reinforcement (kg/m³ of RCC)</div>
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
        <div key={ct.id} style={ctCard}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 'var(--space-2)',
            }}
          >
            <input
              style={labelInput}
              value={ct.label}
              onKeyDown={e => e.stopPropagation()}
              onChange={e => setColumnTypeEntry(ct.id, { label: e.target.value })}
            />
            <Button variant="danger" size="sm" onClick={() => removeColumnType(ct.id)}>
              ✕
            </Button>
          </div>
          <div
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              marginBottom: 'var(--space-1)',
            }}
          >
            Section
          </div>
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
          <div
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              marginBottom: 'var(--space-1)',
              marginTop: 'var(--space-1)',
            }}
          >
            Footing
          </div>
          <NumField label="Length (ft)" step={0.5} value={ct.footingLengthFt ?? 4}
            onChange={v => setColumnTypeEntry(ct.id, { footingLengthFt: v })} />
          <NumField label="Width (ft)" step={0.5} value={ct.footingWidthFt ?? 4}
            onChange={v => setColumnTypeEntry(ct.id, { footingWidthFt: v })} />
          <NumField label="Depth (ft)" step={0.25} value={ct.footingDepthFt ?? 1}
            onChange={v => setColumnTypeEntry(ct.id, { footingDepthFt: v })} />
        </div>
      ))}
      <Button variant="primary" size="sm" onClick={() => addColumnType({})}>
        + Add Column Type
      </Button>

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
    </Modal>
  )
}
