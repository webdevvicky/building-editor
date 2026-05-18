// Phase 1.8 — Foundation editor modal panel.
//
// Visibility: shown when activeTool === 'foundations' (closes cleanly when tool changes).
// Authority: foundation.columnIds[] / wallIds[] are the single source of truth.
// Goes through selectors getFoundationForColumn / getFoundationForWall / getColumnsByFoundation
// from the store — never traverses foundations inline.

import { useStore } from '../store'
import { resolveFootingReinforcementSpec, humanizeAssignmentSource } from '../specs/resolution'
import { dialog } from './ui/Dialog'
import { Modal } from './ui/Modal.jsx'
import { Button } from './ui/Button.jsx'

const FOUNDATION_TYPES = ['ISOLATED', 'COMBINED', 'RAFT', 'STRIP', 'PILE']

const TYPE_COLORS = {
  ISOLATED: { background: 'var(--color-success-bg)', color: 'var(--color-success)' },
  COMBINED: { background: 'var(--color-primary-bg)', color: 'var(--color-primary)' },
  RAFT:     { background: 'var(--color-warning-bg)', color: 'var(--color-warning)' },
  STRIP:    { background: 'var(--color-bg-muted)',   color: 'var(--color-text-secondary)' },
  PILE:     { background: 'var(--color-error-bg)',   color: 'var(--color-error)' },
}

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
  width: 80,
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
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-3) var(--space-3)',
  marginBottom: 'var(--space-3)',
  cursor: 'pointer',
  background: 'var(--color-surface)',
}
const cardSelected = {
  ...card,
  borderColor: 'var(--color-primary)',
  background: 'var(--color-primary-bg)',
  boxShadow: 'var(--shadow-focus)',
}

const chip = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px var(--space-2)',
  borderRadius: 'var(--radius-full)',
  fontSize: 'var(--text-xs)',
  fontWeight: 'var(--weight-semibold)',
  marginRight: 'var(--space-2)',
}

const selectStyle = {
  fontSize: 'var(--text-base)',
  padding: '3px var(--space-2)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
}

const textInput = {
  flex: 1,
  fontSize: 'var(--text-base)',
  padding: '3px var(--space-2)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
}

const attachListStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  maxHeight: 140,
  overflowY: 'auto',
  padding: 'var(--space-1)',
  background: 'var(--color-bg-subtle)',
}

const FDN_SOURCE_COLOR = {
  INSTANCE:        { bg: 'var(--color-success-bg)', fg: 'var(--color-success)' },
  TYPE:            { bg: 'var(--color-primary-bg)', fg: 'var(--color-primary)' },
  CLASS:           { bg: 'var(--color-primary-bg)', fg: 'var(--color-primary)' },
  PROJECT_DEFAULT: { bg: 'var(--color-warning-bg)', fg: 'var(--color-warning)' },
  ESTIMATE:        { bg: 'var(--color-bg-muted)',   fg: 'var(--color-text-muted)' },
}
function fdnResBadge(source) {
  const c = FDN_SOURCE_COLOR[source] ?? FDN_SOURCE_COLOR.ESTIMATE
  return {
    marginTop: 'var(--space-1)',
    padding: '3px var(--space-2)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--text-xs)',
    background: c.bg,
    color: c.fg,
    display: 'inline-block',
    lineHeight: 1.3,
    fontWeight: 'var(--weight-medium)',
  }
}

// When `decimals` is set, the displayed value is rounded for visual
// cleanliness — useful for stored constants like PCC bedding (2/12 ft =
// 0.16666…) so the input shows "0.17" not the full float. Stored value
// is unchanged; the round only affects the input's value attribute.
//
// Pass the toFixed STRING (not Number(toFixed(...))) so trailing zeros
// survive: 0.10 displays as "0.10", 0.17 displays as "0.17". The
// Number-round trip strips trailing zeros and was the source of a
// reported "010"-style display glitch.
function NumField({ label, value, onChange, min = 0, step = 0.5, decimals }) {
  const raw = value ?? 0
  const shown = typeof decimals === 'number'
    ? raw.toFixed(decimals)
    : raw
  return (
    <div style={fieldRow}>
      <span style={lbl}>{label}</span>
      <input
        type="number" min={min} step={step}
        style={numInput} value={shown}
        onKeyDown={e => e.stopPropagation()}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
      />
    </div>
  )
}

function geometrySummary(f) {
  const g = f.geometry || {}
  switch (f.type) {
    case 'ISOLATED':
    case 'COMBINED':
      return `${g.lengthFt ?? 0}×${g.widthFt ?? 0}×${g.depthFt ?? 0} ft`
    case 'RAFT':
      return `${g.areaFt2 ?? 0} ft² × ${g.depthFt ?? 0} ft`
    case 'STRIP':
      return `W ${g.widthFt ?? 0} × D ${g.depthFt ?? 0} ft`
    case 'PILE': {
      const n = g.pilesCount ?? 0
      const dia = g.pileDiamIn ?? 0
      const len = g.pileLengthFt ?? 0
      return `${n}× Ø${dia}″ / ${len} ft + cap ${g.capLengthFt ?? 0}×${g.capWidthFt ?? 0}`
    }
    default:
      return '—'
  }
}

export default function FoundationPanel() {
  const activeTool             = useStore(s => s.activeTool)
  const foundations            = useStore(s => s.foundations)
  const selectedFoundationId   = useStore(s => s.selectedFoundationId)
  const columns                = useStore(s => s.columns)
  const walls                  = useStore(s => s.walls)
  const projectSettings        = useStore(s => s.projectSettings)
  const getTotalFloorArea      = useStore(s => s.getTotalFloorArea)
  const getWallLength          = useStore(s => s.getWallLength)

  const addFoundation              = useStore(s => s.addFoundation)
  const updateFoundation           = useStore(s => s.updateFoundation)
  const deleteFoundation           = useStore(s => s.deleteFoundation)
  const attachColumnToFoundation   = useStore(s => s.attachColumnToFoundation)
  const detachColumnFromFoundation = useStore(s => s.detachColumnFromFoundation)
  const attachWallToFoundation     = useStore(s => s.attachWallToFoundation)
  const detachWallFromFoundation   = useStore(s => s.detachWallFromFoundation)
  const selectFoundation           = useStore(s => s.selectFoundation)
  const setFoundationReinforcementSpec = useStore(s => s.setFoundationReinforcementSpec)
  const applyReinforcementSpecToMatching = useStore(s => s.applyReinforcementSpecToMatching)
  const setTool                    = useStore(s => s.setTool)

  const open = activeTool === 'foundations'
  const onClose = () => setTool('select')

  const fdnList    = Object.values(foundations)
  const selected   = selectedFoundationId ? foundations[selectedFoundationId] : null
  const columnTypes = projectSettings?.columnTypes ?? []

  const columnTypeLabel = (ctId) =>
    columnTypes.find(t => t.id === ctId)?.label ?? ctId

  // Patches geometry while preserving existing keys (per task brief).
  const patchGeometry = (id, partial) => {
    const current = foundations[id]?.geometry || {}
    updateFoundation(id, { geometry: { ...current, ...partial } })
  }

  function renderEditor(f) {
    const g = f.geometry || {}
    return (
      <div>
        <div style={fieldRow}>
          <span style={lbl}>Label</span>
          <input
            type="text" style={textInput}
            value={f.label ?? ''}
            placeholder={`${f.type} foundation`}
            onKeyDown={e => e.stopPropagation()}
            onChange={e => updateFoundation(f.id, { label: e.target.value || null })}
          />
        </div>
        <div style={fieldRow}>
          <span style={lbl}>Concrete grade</span>
          <select
            style={selectStyle}
            value={f.grade ?? 'M20'}
            onKeyDown={e => e.stopPropagation()}
            onChange={e => updateFoundation(f.id, { grade: e.target.value })}
          >
            {['M15', 'M20', 'M25', 'M30'].map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>

        {/* Phase 1.7+ — Reinforcement spec with centralized resolution */}
        {(() => {
          const specs = projectSettings.reinforcementSpecs ?? {}
          const footingSpecs = Object.values(specs).filter(sp => sp.elementType === 'FOOTING')
          const state = useStore.getState()
          const resolved = resolveFootingReinforcementSpec(state, { foundationId: f.id })
          const handleApply = async () => {
            const peers = Object.values(state.foundations)
              .filter(o => o.id !== f.id && o.type === f.type)
            if (peers.length === 0) {
              await dialog.alert('No matching foundations to update — this is the only foundation of its type.', { title: 'No matching foundations' })
              return
            }
            const specLabel = f.reinforcementSpecId
              ? (specs[f.reinforcementSpecId]?.label ?? f.reinforcementSpecId)
              : 'no spec (clear)'
            const ok = await dialog.confirm(
              `Apply "${specLabel}" to ${peers.length} other ${f.type} foundation${peers.length === 1 ? '' : 's'}?`,
              { title: 'Apply to matching foundations?', confirmLabel: 'Apply', variant: 'default' }
            )
            if (!ok) return
            applyReinforcementSpecToMatching({
              elementType: 'FOUNDATION',
              sourceEntityId: f.id,
              specId: f.reinforcementSpecId ?? null,
            })
          }
          return (
            <>
              <div style={fieldRow}>
                <span style={lbl}>Steel spec (BBS)</span>
                <select
                  style={selectStyle}
                  value={f.reinforcementSpecId ?? ''}
                  onKeyDown={e => e.stopPropagation()}
                  onChange={e => setFoundationReinforcementSpec(f.id, e.target.value || null)}
                >
                  <option value="">— Inherit —</option>
                  {footingSpecs.map(sp => <option key={sp.id} value={sp.id}>{sp.label}</option>)}
                </select>
              </div>
              <div style={{ ...fieldRow, marginTop: -2 }}>
                <span style={lbl}></span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span style={fdnResBadge(resolved.source)}>
                    {resolved.specLabel} · {humanizeAssignmentSource(resolved.source)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleApply}
                    title="Copy this spec to all other foundations of the same type"
                  >
                    Apply to matching
                  </Button>
                </div>
              </div>
            </>
          )
        })()}

        <div style={divider} />
        <div style={sectionHead}>Geometry</div>

        {(f.type === 'ISOLATED' || f.type === 'COMBINED') && (
          <>
            <NumField label="Length (ft)" step={0.5} value={g.lengthFt}
              onChange={v => patchGeometry(f.id, { lengthFt: v })} />
            <NumField label="Width (ft)" step={0.5} value={g.widthFt}
              onChange={v => patchGeometry(f.id, { widthFt: v })} />
            <NumField label="Depth (ft)" step={0.25} value={g.depthFt}
              onChange={v => patchGeometry(f.id, { depthFt: v })} />
            <NumField label="PCC depth (ft)" step={0.25} decimals={2} value={f.pccDepthFt}
              onChange={v => updateFoundation(f.id, { pccDepthFt: v })} />
            <NumField label="Plum concrete depth (ft)" step={0.25} decimals={2} value={f.plumDepthFt}
              onChange={v => updateFoundation(f.id, { plumDepthFt: v })} />
          </>
        )}

        {f.type === 'RAFT' && (
          <>
            <NumField label="Area (ft²)" step={1} value={g.areaFt2}
              onChange={v => patchGeometry(f.id, { areaFt2: v })} />
            <div style={{ ...fieldRow, marginTop: -4, marginBottom: 'var(--space-3)' }}>
              <span style={lbl}></span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => patchGeometry(f.id, { areaFt2: Math.round((getTotalFloorArea() || 0) * 100) / 100 })}
              >
                Use building footprint
              </Button>
            </div>
            <NumField label="Depth (ft)" step={0.25} value={g.depthFt}
              onChange={v => patchGeometry(f.id, { depthFt: v })} />
            <NumField label="PCC depth (ft)" step={0.25} decimals={2} value={f.pccDepthFt}
              onChange={v => updateFoundation(f.id, { pccDepthFt: v })} />
          </>
        )}

        {f.type === 'STRIP' && (
          <>
            <NumField label="Width (ft)" step={0.25} value={g.widthFt}
              onChange={v => patchGeometry(f.id, { widthFt: v })} />
            <NumField label="Depth (ft)" step={0.25} value={g.depthFt}
              onChange={v => patchGeometry(f.id, { depthFt: v })} />
            <NumField label="PCC depth (ft)" step={0.25} decimals={2} value={f.pccDepthFt}
              onChange={v => updateFoundation(f.id, { pccDepthFt: v })} />
          </>
        )}

        {f.type === 'PILE' && (
          <>
            <NumField label="Pile diameter (in)" step={1} value={g.pileDiamIn}
              onChange={v => patchGeometry(f.id, { pileDiamIn: v })} />
            <NumField label="Pile length (ft)" step={1} value={g.pileLengthFt}
              onChange={v => patchGeometry(f.id, { pileLengthFt: v })} />
            <NumField label="Piles count" step={1} value={g.pilesCount}
              onChange={v => patchGeometry(f.id, { pilesCount: v })} />
            <NumField label="Cap length (ft)" step={0.5} value={g.capLengthFt}
              onChange={v => patchGeometry(f.id, { capLengthFt: v })} />
            <NumField label="Cap width (ft)" step={0.5} value={g.capWidthFt}
              onChange={v => patchGeometry(f.id, { capWidthFt: v })} />
            <NumField label="Cap depth (ft)" step={0.25} value={g.capDepthFt}
              onChange={v => patchGeometry(f.id, { capDepthFt: v })} />
            <NumField label="PCC depth (ft)" step={0.25} decimals={2} value={f.pccDepthFt}
              onChange={v => updateFoundation(f.id, { pccDepthFt: v })} />
          </>
        )}

        {/* Column attach list — COMBINED + PILE + ISOLATED can host columns */}
        {(f.type === 'COMBINED' || f.type === 'PILE' || f.type === 'ISOLATED') && (
          <>
            <div style={divider} />
            <div style={sectionHead}>Attached columns ({(f.columnIds || []).length})</div>
            <div style={attachListStyle}>
              {Object.values(columns).length === 0 && (
                <div
                  style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-text-muted)',
                    padding: 'var(--space-1)',
                  }}
                >
                  No columns placed yet.
                </div>
              )}
              {Object.values(columns).map(col => {
                const attached = (f.columnIds || []).includes(col.id)
                const otherFdn = fdnList.find(of => of.id !== f.id && (of.columnIds || []).includes(col.id))
                return (
                  <label
                    key={col.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      padding: '3px var(--space-1)',
                      fontSize: 'var(--text-sm)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={attached}
                      onKeyDown={e => e.stopPropagation()}
                      onChange={e => {
                        if (e.target.checked) attachColumnToFoundation(col.id, f.id)
                        else detachColumnFromFoundation(col.id)
                      }}
                    />
                    <span style={{ flex: 1 }}>
                      {columnTypeLabel(col.columnTypeId)} @ ({Math.round(col.x / 12)}, {Math.round(col.y / 12)})
                    </span>
                    {otherFdn && !attached && (
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)' }}>
                        on {otherFdn.label ?? otherFdn.type}
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          </>
        )}

        {/* Wall attach list — STRIP only */}
        {f.type === 'STRIP' && (
          <>
            <div style={divider} />
            <div style={sectionHead}>Attached walls ({(f.wallIds || []).length})</div>
            <div style={attachListStyle}>
              {Object.values(walls).length === 0 && (
                <div
                  style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-text-muted)',
                    padding: 'var(--space-1)',
                  }}
                >
                  No walls drawn yet.
                </div>
              )}
              {Object.values(walls).map(w => {
                const attached = (f.wallIds || []).includes(w.id)
                const otherFdn = fdnList.find(of => of.id !== f.id && (of.wallIds || []).includes(w.id))
                const lenFt = getWallLength(w.id) || 0
                return (
                  <label
                    key={w.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      padding: '3px var(--space-1)',
                      fontSize: 'var(--text-sm)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={attached}
                      onKeyDown={e => e.stopPropagation()}
                      onChange={e => {
                        if (e.target.checked) attachWallToFoundation(w.id, f.id)
                        else detachWallFromFoundation(w.id)
                      }}
                    />
                    <span style={{ flex: 1 }}>
                      Wall {w.id.slice(0, 6)} — {Math.round(lenFt * 100) / 100} ft
                    </span>
                    {otherFdn && !attached && (
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)' }}>
                        on {otherFdn.label ?? otherFdn.type}
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Foundations"
      width={520}
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}
    >
      <div style={sectionHead}>Defined foundations ({fdnList.length})</div>

      {fdnList.length === 0 && (
        <div
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-muted)',
            marginBottom: 'var(--space-2)',
          }}
        >
          No foundations yet. Add one below to start grouping columns/walls.
        </div>
      )}

      {fdnList.map(f => {
        const isSel = f.id === selectedFoundationId
        const badge = TYPE_COLORS[f.type] ?? TYPE_COLORS.ISOLATED
        return (
          <div
            key={f.id}
            style={isSel ? cardSelected : card}
            onClick={() => selectFoundation(f.id)}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--space-1)' }}>
              <span style={{ ...chip, ...badge }}>{f.type}</span>
              <strong style={{ flex: 1, fontSize: 'var(--text-base)', color: 'var(--color-text)' }}>
                {f.label ?? `${f.type} foundation`}
              </strong>
              <Button
                variant="danger"
                size="sm"
                onClick={e => { e.stopPropagation(); deleteFoundation(f.id) }}
              >
                Delete
              </Button>
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
              {geometrySummary(f)}
              <span style={{ color: 'var(--color-text-muted)' }}> · </span>
              {(f.columnIds || []).length} col{(f.columnIds || []).length === 1 ? '' : 's'}
              <span style={{ color: 'var(--color-text-muted)' }}> · </span>
              {(f.wallIds || []).length} wall{(f.wallIds || []).length === 1 ? '' : 's'}
            </div>
          </div>
        )
      })}

      {selected && (
        <>
          <div style={divider} />
          <div style={sectionHead}>Editing {selected.label ?? selected.type}</div>
          {renderEditor(selected)}
        </>
      )}

      <div style={divider} />
      <div style={sectionHead}>Add foundation</div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <select
          id="fdn-new-type"
          style={selectStyle}
          defaultValue="ISOLATED"
          onKeyDown={e => e.stopPropagation()}
        >
          {FOUNDATION_TYPES.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            const sel = document.getElementById('fdn-new-type')
            const type = sel?.value || 'ISOLATED'
            const id = addFoundation(type, {})
            selectFoundation(id)
          }}
        >
          + Add foundation
        </Button>
      </div>
    </Modal>
  )
}
