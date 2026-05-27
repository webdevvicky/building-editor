import { useStore } from '../store'
import { BEAM_LEVEL_REGISTRY } from '../constants/structural'
import { PLASTER_SYSTEMS } from '../specs/plasterSystems'
import { ROOM_TYPES, ROOM_TYPE_LABELS } from '../roomPresets'
import { Modal } from './ui/Modal.jsx'
import { Button } from './ui/Button.jsx'
import { Field } from './ui/Field.jsx'
import FeetInchesInput from './ui/FeetInchesInput.jsx'
import { DEFAULT_PRECISION, formatFeetInches } from '../lib/units.js'
import { FULL_SENTINEL, _fullHeightFt } from '../quantities/tiles.js'
// Phase 4 Commit A — catalogs + setters for the 9 new sections.
import { listPaintSystems } from '../specs/paintSystems.js'
import { listCeilingFinishSystems } from '../specs/ceilingFinishSystems.js'
// Area 2C Step 9 — Save current project as a template.
import { saveCurrentAsTemplate } from '../projects/templates.js'
import { buildSnapshot } from '../projects/_snapshot.js'
import { dialog } from './ui/Dialog'
import { toast } from './ui/Toast'
import {
  listHardwareSets, listHardwareSetsByAppliesTo,
  listWindowHardwareSets, listWindowHardwareSetsByAppliesTo,
} from '../specs/hardware/hardwareSets.js'

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

// FtField — feet-inches aware sibling of NumField. State stays in decimal feet;
// the input renders feet-inches in 'ft-in' mode and decimal feet otherwise.
function FtField({ label, value, onChange, min = 0, precision = DEFAULT_PRECISION.foundation }) {
  return (
    <Field label={label} inline>
      <FeetInchesInput
        value={value ?? 0}
        onCommit={ft => onChange(ft)}
        min={min}
        precision={precision}
      />
    </Field>
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
  const setTileDefaults         = useStore(s => s.setTileDefaults)
  // Phase 4 Commit A — 9 new setters.
  const setProjectMeta             = useStore(s => s.setProjectMeta)
  const setContingency             = useStore(s => s.setContingency)
  const setDefaultPaintSystems     = useStore(s => s.setDefaultPaintSystems)
  const setDefaultCeilingFinishSystem = useStore(s => s.setDefaultCeilingFinishSystem)
  const setDoorHardwareDefaults    = useStore(s => s.setDoorHardwareDefaults)
  const setWindowHardwareDefaults  = useStore(s => s.setWindowHardwareDefaults)
  const setProjectCosts            = useStore(s => s.setProjectCosts)
  const setMepSizingStrategy       = useStore(s => s.setMepSizingStrategy)
  // Area 1 — dimension convention setter (Option C).
  const setDimensionMode           = useStore(s => s.setDimensionMode)
  // The full-height sentinel resolution needs to read state.projectSettings
  // (floors + slabSettings) on every render — _fullHeightFt does that.

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
    tileDefaults,
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
      footer={
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button
            variant="secondary"
            onClick={async () => {
              const name = await dialog.prompt('Template name', {
                title: 'Save current project as template',
                defaultValue: '',
              })
              if (!name || !name.trim()) return
              const snap = buildSnapshot(useStore.getState())
              try {
                await saveCurrentAsTemplate(name.trim(), snap)
                toast.success(`Saved template "${name.trim()}"`)
              } catch (err) {
                toast.error(`Couldn't save template: ${err?.message ?? err}`)
              }
            }}
          >
            Save as template
          </Button>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      }
    >
      {/* 0a. Smart MEP defaults (Area 2D) */}
      <div style={sectionHead}>Smart MEP Defaults</div>
      <div style={fieldRow}>
        <span style={lbl}>Auto-place MEP</span>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-sm)' }}>
          <input
            type="checkbox"
            checked={projectSettings?.autoMepDefaultsEnabled !== false}
            onChange={e => setProjectSettings({ autoMepDefaultsEnabled: e.target.checked })}
          />
          <span>Enable</span>
        </label>
      </div>
      <div style={hintText}>
        When you add a new room, common MEP for the room type (plumbing
        fixtures, electrical points, HVAC, fire, ELV) is placed
        automatically. Disable to pick items manually via the defaults
        modal that opens after saveRoom.
      </div>

      <div style={divider} />

      {/* 0. Dimension convention (Area 1 — Option C) */}
      <div style={sectionHead}>Dimension Convention</div>
      <div style={fieldRow}>
        <span style={lbl}>Mode</span>
        <select
          style={selectStyle}
          value={projectSettings?.dimensionMode ?? 'centerline'}
          onKeyDown={e => e.stopPropagation()}
          onChange={e => setDimensionMode(e.target.value)}
        >
          <option value="centerline">Centerline (as-drawn)</option>
          <option value="clear_internal">Clear internal (recommended)</option>
        </select>
      </div>
      <div style={hintText}>
        Centerline measures from wall centerlines (matches structural drawings;
        over-quotes finishes by 7–14%). Clear internal measures inside the
        room (matches site tape; Indian construction convention). Affects
        floor area, perimeter, tile, paint, and ceiling quantities. New
        projects default to clear internal.
      </div>

      <div style={divider} />

      {/* 1. Floor Heights */}
      <div style={sectionHead}>Floor Heights</div>
      <FtField
        label="Plinth height"
        value={heights.plinthHeightFt}
        onChange={v => setHeights({ plinthHeightFt: v })}
        precision={DEFAULT_PRECISION.height}
      />
      <FtField
        label="Floor height"
        value={heights.floorHeightFt}
        onChange={v => setHeights({ floorHeightFt: v })}
        precision={DEFAULT_PRECISION.height}
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

      {/* 1d. Tiles — dado heights / skirting / allowances (2026-05-26) */}
      <div style={sectionHead}>Tiles</div>
      <div style={hintText}>
        Dado heights apply to wall tiles per room type. Use "Full" to
        track current floor height (auto-recomputes if floor height changes).
      </div>

      {/* Skirting height (currently 4" default; engineers want 3 / 4 / 6 ranges) */}
      <div style={fieldRow}>
        <span style={lbl}>Skirting height (in)</span>
        <input
          type="number" min={1} step={0.5}
          style={numInput}
          value={tileDefaults?.skirtingHeightIn ?? 4}
          onKeyDown={e => e.stopPropagation()}
          onChange={e => setTileDefaults({ skirtingHeightIn: parseFloat(e.target.value) })}
        />
        <div style={{ display: 'flex', gap: 'var(--space-1)', marginLeft: 'var(--space-2)' }}>
          {[3, 4, 6].map(n => (
            <Button key={n} size="sm" variant="ghost"
              onClick={() => setTileDefaults({ skirtingHeightIn: n })}>
              {n}"
            </Button>
          ))}
        </div>
      </div>

      {/* Per-room-type dado heights — 5 fixed buckets matching DEFAULT_PROJECT_SETTINGS */}
      <div style={{
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)',
        marginTop: 'var(--space-2)',
        marginBottom: 'var(--space-1)',
      }}>
        Dado height by room type
      </div>
      {['TOILET', 'KITCHEN', 'UTILITY', 'BALCONY', 'OTHER'].map(type => {
        const raw = tileDefaults?.dadoHeightsFt?.[type]
        const isFull = raw === FULL_SENTINEL
        const numericValue = isFull
          ? _fullHeightFt({ projectSettings }, { floorId: null })
          : (typeof raw === 'number' ? raw : 0)
        return (
          <div key={type} style={{ ...fieldRow, alignItems: 'center' }}>
            <span style={lbl}>{ROOM_TYPE_LABELS[type] ?? type}</span>
            <div style={{ flex: 1, display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
              <FeetInchesInput
                value={numericValue}
                onCommit={ft => setTileDefaults({ dadoHeightsFt: { [type]: ft } })}
                min={0}
                precision={DEFAULT_PRECISION.foundation}
              />
              {isFull && (
                <span style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-primary)',
                  fontWeight: 'var(--weight-semibold)',
                }}>
                  Full
                </span>
              )}
              <Button size="sm" variant={raw === 0 ? 'primary' : 'ghost'}
                onClick={() => setTileDefaults({ dadoHeightsFt: { [type]: 0 } })}
                title="No dado">
                None
              </Button>
              <Button size="sm" variant={raw === 4 ? 'primary' : 'ghost'}
                onClick={() => setTileDefaults({ dadoHeightsFt: { [type]: 4 } })}
                title="Half height (4')">
                Half
              </Button>
              <Button size="sm" variant={isFull ? 'primary' : 'ghost'}
                onClick={() => setTileDefaults({ dadoHeightsFt: { [type]: FULL_SENTINEL } })}
                title="Full height — tracks floor height">
                Full
              </Button>
            </div>
          </div>
        )
      })}

      {/* Skirting apply-to-types — multi-toggle over ROOM_TYPES */}
      <div style={{
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)',
        marginTop: 'var(--space-2)',
        marginBottom: 'var(--space-1)',
      }}>
        Apply skirting to room types
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: 'var(--space-1) var(--space-2)',
        marginBottom: 'var(--space-2)',
      }}>
        {ROOM_TYPES.map(type => {
          const active = (tileDefaults?.skirtingApplyToTypes ?? []).includes(type)
          return (
            <label key={type} style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
              fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', cursor: 'pointer',
            }}>
              <input type="checkbox" checked={active}
                onKeyDown={e => e.stopPropagation()}
                onChange={e => {
                  const cur = tileDefaults?.skirtingApplyToTypes ?? []
                  const next = e.target.checked
                    ? [...new Set([...cur, type])]
                    : cur.filter(t => t !== type)
                  setTileDefaults({ skirtingApplyToTypes: next })
                }}
                style={{ cursor: 'pointer' }}
              />
              {ROOM_TYPE_LABELS[type] ?? type}
            </label>
          )
        })}
      </div>

      {/* Tile allowances */}
      <NumField
        label="Floor tile allowance" step={0.05} min={1.0}
        value={tileDefaults?.floorTileAllowance ?? 1.05}
        onChange={v => setTileDefaults({ floorTileAllowance: v })}
      />
      <NumField
        label="Wall tile allowance" step={0.05} min={1.0}
        value={tileDefaults?.wallTileAllowance ?? 1.10}
        onChange={v => setTileDefaults({ wallTileAllowance: v })}
      />

      <div style={divider} />

      {/* 1c. Foundation Defaults (Phase 1.6e — plum concrete) */}
      <div style={sectionHead}>Foundation Defaults</div>
      <FtField
        label="Plum concrete depth" min={0}
        value={projectSettings?.foundationDefaults?.plumDepthFt ?? 0}
        onChange={v => setFoundationDefaults({ plumDepthFt: v })}
        precision={DEFAULT_PRECISION.foundation}
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
      <FtField
        label="Projection"
        value={sunshadeSettings.projectionFt}
        onChange={v => setSunshadeSettings({ projectionFt: v })}
        precision={DEFAULT_PRECISION.foundation}
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
      <FtField
        label="Height"
        value={parapetSettings.heightFt}
        onChange={v => setParapetSettings({ heightFt: v })}
        precision={DEFAULT_PRECISION.foundation}
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
          <FtField label="Length" value={ct.footingLengthFt ?? 4}
            onChange={v => setColumnTypeEntry(ct.id, { footingLengthFt: v })}
            precision={DEFAULT_PRECISION.foundation} />
          <FtField label="Width" value={ct.footingWidthFt ?? 4}
            onChange={v => setColumnTypeEntry(ct.id, { footingWidthFt: v })}
            precision={DEFAULT_PRECISION.foundation} />
          <FtField label="Depth" value={ct.footingDepthFt ?? 1}
            onChange={v => setColumnTypeEntry(ct.id, { footingDepthFt: v })}
            precision={DEFAULT_PRECISION.foundation} />
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
      <FtField
        label="Landing width"
        value={staircaseDefaults.landingFtWidth}
        onChange={v => setStaircaseDefaults({ landingFtWidth: v })}
        precision={DEFAULT_PRECISION.staircase}
      />
      <FtField
        label="Landing length"
        value={staircaseDefaults.landingFtLength}
        onChange={v => setStaircaseDefaults({ landingFtLength: v })}
        precision={DEFAULT_PRECISION.staircase}
      />
      <FtField
        label="Flight width"
        value={staircaseDefaults.flightWidthFt}
        onChange={v => setStaircaseDefaults({ flightWidthFt: v })}
        precision={DEFAULT_PRECISION.staircase}
      />

      {/* ═══════════════════════════════════════════════════════════════════
          Phase 4 Commit A — 9 new sections (BOQ Gaps 1-8 UI surface +
          MEP sizing strategy picker).
          ═══════════════════════════════════════════════════════════════════ */}

      <div style={divider} />

      {/* 9. Project Metadata (Gap 1) — header for Excel + PDF exports */}
      <div style={sectionHead}>Project Metadata</div>
      {[
        ['projectTitle', 'Project title'],
        ['ownerName',    'Owner'],
        ['location',     'Location'],
        ['preparedBy',   'Prepared by'],
        ['checkedBy',    'Checked by'],
        ['approvedBy',   'Approved by'],
      ].map(([key, label]) => (
        <div key={key} style={fieldRow}>
          <span style={lbl}>{label}</span>
          <input
            type="text"
            style={{ ...numInput, width: 240 }}
            value={projectSettings?.projectMeta?.[key] ?? ''}
            onKeyDown={e => e.stopPropagation()}
            onChange={e => setProjectMeta({ [key]: e.target.value })}
          />
        </div>
      ))}
      <div style={fieldRow}>
        <span style={lbl}>Date prepared</span>
        <input
          type="date"
          style={{ ...numInput, width: 160 }}
          value={projectSettings?.projectMeta?.preparedDate ?? ''}
          onKeyDown={e => e.stopPropagation()}
          onChange={e => setProjectMeta({ preparedDate: e.target.value || null })}
        />
      </div>
      <div style={hintText}>Surfaces on Excel cover sheet + PDF cover page.</div>

      <div style={divider} />

      {/* 10. Contingency (Gap 2) — defaultPercent + per-category overrides */}
      <div style={sectionHead}>Contingency</div>
      <NumField
        label="Default percent (%)" step={1} min={0}
        value={projectSettings?.contingency?.defaultPercent ?? 10}
        onChange={v => setContingency({ defaultPercent: v })}
      />
      <div style={fieldRow}>
        <span style={lbl}>Display mode</span>
        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
          {['clean', 'detailed'].map(mode => (
            <Button
              key={mode}
              size="sm"
              variant={(projectSettings?.contingency?.displayMode ?? 'clean') === mode ? 'primary' : 'ghost'}
              onClick={() => setContingency({ displayMode: mode })}
            >
              {mode === 'clean' ? 'Clean' : 'Detailed (Base | +% | Total)'}
            </Button>
          ))}
        </div>
      </div>
      <div style={{
        fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)',
        marginTop: 'var(--space-2)', marginBottom: 'var(--space-1)',
      }}>
        Per-category overrides
      </div>
      {[
        ['steel',              'Steel'],
        ['joinery',            'Joinery'],
        ['joinery_hardware',   'Joinery hardware'],
        ['plumbing_supply',    'Plumbing supply'],
        ['plumbing_drainage',  'Plumbing drainage'],
        ['plumbing_fixtures',  'Plumbing fixtures'],
        ['electrical_lighting','Electrical lighting'],
        ['electrical_power',   'Electrical power'],
        ['electrical_hvac',    'Electrical (HVAC)'],
      ].map(([cat, label]) => (
        <div key={cat} style={fieldRow}>
          <span style={lbl}>{label}</span>
          <input
            type="number" min={0} max={100} step={1}
            style={numInput}
            value={projectSettings?.contingency?.overrides?.[cat] ?? ''}
            placeholder={`(${projectSettings?.contingency?.defaultPercent ?? 10})`}
            onKeyDown={e => e.stopPropagation()}
            onChange={e => {
              const val = e.target.value === '' ? null : parseFloat(e.target.value)
              const next = { ...(projectSettings?.contingency?.overrides ?? {}) }
              if (val === null) delete next[cat]
              else next[cat] = val
              // setContingency does a deep merge on overrides, so passing
              // the FULL replacement requires writing through state directly.
              setContingency({ overrides: next })
            }}
          />
          <span style={{ marginLeft: 4, fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>%</span>
        </div>
      ))}
      <div style={hintText}>Blank = use default %. NOS / set / lumpsum units never get contingency.</div>

      <div style={divider} />

      {/* 11. Default Paint Systems (Gap 6) */}
      <div style={sectionHead}>Default Paint Systems</div>
      <div style={fieldRow}>
        <span style={lbl}>Interior</span>
        <select
          style={selectStyle}
          value={projectSettings?.defaultInteriorPaintSystemId ?? ''}
          onKeyDown={e => e.stopPropagation()}
          onChange={e => setDefaultPaintSystems({ interior: e.target.value })}
        >
          {listPaintSystems()
            .filter(s => s.appliesContext !== 'exterior_walls')
            .map(sys => <option key={sys.id} value={sys.id}>{sys.label}</option>)}
        </select>
      </div>
      <div style={fieldRow}>
        <span style={lbl}>Exterior</span>
        <select
          style={selectStyle}
          value={projectSettings?.defaultExteriorPaintSystemId ?? ''}
          onKeyDown={e => e.stopPropagation()}
          onChange={e => setDefaultPaintSystems({ exterior: e.target.value })}
        >
          {listPaintSystems()
            .filter(s => s.appliesContext !== 'interior_walls_and_ceiling')
            .map(sys => <option key={sys.id} value={sys.id}>{sys.label}</option>)}
        </select>
      </div>
      <div style={hintText}>Per-room override available in Room panel.</div>

      <div style={divider} />

      {/* 12. Default Ceiling Finish (Gap 7) */}
      <div style={sectionHead}>Default Ceiling Finish</div>
      <div style={fieldRow}>
        <span style={lbl}>System</span>
        <select
          style={selectStyle}
          value={projectSettings?.defaultCeilingFinishSystemId ?? 'NONE'}
          onKeyDown={e => e.stopPropagation()}
          onChange={e => setDefaultCeilingFinishSystem(e.target.value)}
        >
          {listCeilingFinishSystems().map(sys =>
            <option key={sys.id} value={sys.id}>{sys.label}</option>
          )}
        </select>
      </div>
      <div style={hintText}>
        Only rooms with Ceiling plaster checked get a finish.
        Per-room override available in Room panel.
      </div>

      <div style={divider} />

      {/* 13. Door Hardware Defaults (Gap 4) */}
      <div style={sectionHead}>Door Hardware Defaults</div>
      {[
        ['MAIN_DOOR',     'Main door'],
        ['INTERNAL_DOOR', 'Internal door'],
      ].map(([subtype, label]) => {
        const sets = listHardwareSetsByAppliesTo(subtype)
        return (
          <div key={subtype} style={fieldRow}>
            <span style={lbl}>{label}</span>
            <select
              style={selectStyle}
              value={projectSettings?.doorHardwareDefaults?.[subtype] ?? ''}
              onKeyDown={e => e.stopPropagation()}
              onChange={e => setDoorHardwareDefaults({ [subtype]: e.target.value || null })}
            >
              <option value="">(no default — no hardware)</option>
              {sets.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        )
      })}

      <div style={divider} />

      {/* 14. Window Hardware Defaults (Gap 5) */}
      <div style={sectionHead}>Window Hardware Defaults</div>
      {[
        ['WINDOW',     'Window'],
        ['VENTILATOR', 'Ventilator'],
      ].map(([subtype, label]) => {
        const sets = listWindowHardwareSetsByAppliesTo(subtype)
        return (
          <div key={subtype} style={fieldRow}>
            <span style={lbl}>{label}</span>
            <select
              style={selectStyle}
              value={projectSettings?.windowHardwareDefaults?.[subtype] ?? ''}
              onKeyDown={e => e.stopPropagation()}
              onChange={e => setWindowHardwareDefaults({ [subtype]: e.target.value || null })}
            >
              <option value="">(no default — no hardware)</option>
              {sets.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        )
      })}

      <div style={divider} />

      {/* 15. Project Costs (Gap 8) — labor + supervision + GST */}
      <div style={sectionHead}>Project Costs</div>
      <div style={hintText}>
        Labor, supervision, and GST are added to the materials subtotal on
        the Excel Summary + PDF cover. They are NOT individual BOQ lines.
      </div>
      {/* Labor */}
      <div style={fieldRow}>
        <span style={lbl}>Labor mode</span>
        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
          {['percent', 'lumpsum'].map(mode => (
            <Button
              key={mode} size="sm"
              variant={(projectSettings?.projectCosts?.laborMode ?? 'percent') === mode ? 'primary' : 'ghost'}
              onClick={() => setProjectCosts({ laborMode: mode })}
            >{mode === 'percent' ? '% of materials' : 'Lumpsum'}</Button>
          ))}
        </div>
      </div>
      {(projectSettings?.projectCosts?.laborMode ?? 'percent') === 'percent' ? (
        <NumField label="Labor (%)" step={1} min={0}
          value={projectSettings?.projectCosts?.laborPercent ?? 15}
          onChange={v => setProjectCosts({ laborPercent: v })} />
      ) : (
        <NumField label="Labor (Rs.)" step={1000} min={0}
          value={projectSettings?.projectCosts?.laborLumpsum ?? 0}
          onChange={v => setProjectCosts({ laborLumpsum: v })} />
      )}
      {/* Supervision */}
      <div style={fieldRow}>
        <span style={lbl}>Supervision mode</span>
        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
          {['percent', 'lumpsum'].map(mode => (
            <Button
              key={mode} size="sm"
              variant={(projectSettings?.projectCosts?.supervisionMode ?? 'percent') === mode ? 'primary' : 'ghost'}
              onClick={() => setProjectCosts({ supervisionMode: mode })}
            >{mode === 'percent' ? '% of materials' : 'Lumpsum'}</Button>
          ))}
        </div>
      </div>
      {(projectSettings?.projectCosts?.supervisionMode ?? 'percent') === 'percent' ? (
        <NumField label="Supervision (%)" step={1} min={0}
          value={projectSettings?.projectCosts?.supervisionPercent ?? 5}
          onChange={v => setProjectCosts({ supervisionPercent: v })} />
      ) : (
        <NumField label="Supervision (Rs.)" step={1000} min={0}
          value={projectSettings?.projectCosts?.supervisionLumpsum ?? 0}
          onChange={v => setProjectCosts({ supervisionLumpsum: v })} />
      )}
      <NumField label="Overhead (%)" step={1} min={0}
        value={projectSettings?.projectCosts?.overheadPercent ?? 0}
        onChange={v => setProjectCosts({ overheadPercent: v })} />
      <NumField label="Profit (%)" step={1} min={0}
        value={projectSettings?.projectCosts?.profitPercent ?? 0}
        onChange={v => setProjectCosts({ profitPercent: v })} />
      <NumField label="GST (%)" step={1} min={0}
        value={projectSettings?.projectCosts?.gstPercent ?? 18}
        onChange={v => setProjectCosts({ gstPercent: v })} />
      <CheckField
        label="GST applies to labor"
        value={projectSettings?.projectCosts?.gstAppliesToLabor ?? false}
        onChange={v => setProjectCosts({ gstAppliesToLabor: v })} />

      <div style={divider} />

      {/* 16. MEP Sizing Strategy — per-discipline picker */}
      <div style={sectionHead}>MEP Sizing Strategy</div>
      <div style={hintText}>
        CATALOG = catalog-driven (default). HUNTER = fixture-unit roll-up
        for plumbing. LOAD_BASED = electrical voltage-drop. GRADIENT_DRAIN
        = soil-stack slope tagging.
      </div>
      {[
        ['PLUMBING',   'Plumbing'],
        ['ELECTRICAL', 'Electrical'],
        ['HVAC',       'HVAC'],
        ['FIRE',       'Fire'],
        ['ELV',        'ELV'],
        ['SOLAR',      'Solar (deferred)'],
      ].map(([discipline, label]) => (
        <div key={discipline} style={fieldRow}>
          <span style={lbl}>{label}</span>
          <select
            style={selectStyle}
            value={projectSettings?.mepSizing?.[discipline] ?? 'CATALOG'}
            onKeyDown={e => e.stopPropagation()}
            onChange={e => setMepSizingStrategy(discipline, e.target.value)}
          >
            <option value="CATALOG">CATALOG (default)</option>
            <option value="HUNTER">HUNTER (plumbing fixture units)</option>
            <option value="LOAD_BASED">LOAD_BASED (electrical 3% drop)</option>
            <option value="GRADIENT_DRAIN">GRADIENT_DRAIN (1/80 soil, 1/40 waste)</option>
          </select>
        </div>
      ))}

      <div style={divider} />

      {/* 17. autoSunkenRoomTypes picker — Arch 8 fix folded into Commit A */}
      <div style={sectionHead}>Auto-Sunken Slab Room Types</div>
      <div style={hintText}>
        Room types that automatically get a sunken slab (lowered floor for
        plumbing fall). Default: Toilet + Balcony.
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: 'var(--space-1) var(--space-2)',
        marginBottom: 'var(--space-2)',
      }}>
        {ROOM_TYPES.map(type => {
          const active = (slabSettings.autoSunkenRoomTypes ?? []).includes(type)
          return (
            <label key={type} style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
              fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', cursor: 'pointer',
            }}>
              <input type="checkbox" checked={active}
                onKeyDown={e => e.stopPropagation()}
                onChange={e => {
                  const cur = slabSettings.autoSunkenRoomTypes ?? []
                  const next = e.target.checked
                    ? [...new Set([...cur, type])]
                    : cur.filter(t => t !== type)
                  setSlabSettings({ autoSunkenRoomTypes: next })
                }}
                style={{ cursor: 'pointer' }}
              />
              {ROOM_TYPE_LABELS[type] ?? type}
            </label>
          )
        })}
      </div>
    </Modal>
  )
}
