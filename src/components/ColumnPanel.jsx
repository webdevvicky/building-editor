import { useStore } from '../store'
import { getColumnDimLabel } from '../lib/columnShapes'
import { resolveColumnReinforcementSpec, humanizeAssignmentSource } from '../specs/resolution'
import { dialog } from './ui/Dialog'

const panelStyle = {
  position: 'absolute', top: 56, left: 16,
  background: '#fff', border: '1px solid #ccc', borderRadius: 8,
  padding: '12px 14px', zIndex: 10, minWidth: 220, fontSize: 13,
  maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
}

const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }

const deleteBtn = {
  background: '#fff0f0', border: '1px solid #e74c3c', borderRadius: 4,
  color: '#e74c3c', cursor: 'pointer', fontSize: 11, padding: '3px 8px',
}

const attachedBadge = {
  fontSize: 10, padding: '2px 6px', borderRadius: 3,
  background: '#e8f0f8', color: '#2471a3',
}

const standaloneBadge = {
  fontSize: 10, padding: '2px 6px', borderRadius: 3,
  background: '#f0f0f0', color: '#555',
}

const detachBtn = {
  background: '#fff', border: '1px solid #aaa', borderRadius: 4,
  color: '#555', cursor: 'pointer', fontSize: 11, padding: '3px 8px',
}

const fieldRow = { marginTop: 8 }
const label = { color: '#888', marginBottom: 2, fontSize: 11 }

const SOURCE_COLOR = {
  INSTANCE:        { bg: '#e8f5e9', fg: '#2e7d32' },
  TYPE:            { bg: '#e3f2fd', fg: '#1565c0' },
  CLASS:           { bg: '#e3f2fd', fg: '#1565c0' },
  PROJECT_DEFAULT: { bg: '#fff8e1', fg: '#a37200' },
  ESTIMATE:        { bg: '#f5f5f5', fg: '#888' },
}
function resolutionBadge(source) {
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

export default function ColumnPanel() {
  const selectedColumnId = useStore(s => s.selectedColumnId)
  const columns          = useStore(s => s.columns)
  const projectSettings  = useStore(s => s.projectSettings)
  const selectColumn     = useStore(s => s.selectColumn)
  const setColumnType    = useStore(s => s.setColumnType)
  const detachColumn     = useStore(s => s.detachColumn)
  const deleteColumn     = useStore(s => s.deleteColumn)
  const setColumnFloorSpan = useStore(s => s.setColumnFloorSpan)
  const setColumnReinforcementSpec = useStore(s => s.setColumnReinforcementSpec)
  const getFoundationForColumn = useStore(s => s.getFoundationForColumn)
  const applyReinforcementSpecToMatching = useStore(s => s.applyReinforcementSpecToMatching)
  // Subscribe so the resolution badge re-renders when the spec map or
  // bbsDefaults change in BBSSpecPanel.
  const reinforcementSpecs = useStore(s => s.projectSettings?.reinforcementSpecs)
  const bbsDefaults        = useStore(s => s.projectSettings?.bbsDefaults)
  const allColumns         = useStore(s => s.columns)
  // Reference both so eslint doesn't flag them as unused — they exist only
  // to make the badge reactive to spec/default edits.
  void reinforcementSpecs; void bbsDefaults; void allColumns;

  if (!selectedColumnId) return null
  const column = columns[selectedColumnId]
  if (!column) return null

  const columnTypes = projectSettings?.columnTypes ?? []
  const colType = columnTypes.find(t => t.id === column.columnTypeId)

  const xFt = (column.x / 12).toFixed(2)
  const yFt = (column.y / 12).toFixed(2)

  const dimLabel = colType ? getColumnDimLabel(colType) : '—'

  function handleDelete() {
    deleteColumn(selectedColumnId)
    selectColumn(null)
  }

  return (
    <div style={panelStyle}>
      <div style={rowStyle}>
        <strong>Column</strong>
        <button style={deleteBtn} onClick={handleDelete}>Delete</button>
      </div>

      <div style={fieldRow}>
        <div style={label}>Type</div>
        <select
          value={column.columnTypeId}
          onChange={e => setColumnType(selectedColumnId, e.target.value)}
          style={{ width: '100%', fontSize: 13 }}
        >
          {columnTypes.map(t => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
      </div>

      <div style={fieldRow}>
        <div style={label}>Position</div>
        <div>{xFt} ft, {yFt} ft</div>
      </div>

      <div style={{ ...fieldRow, ...rowStyle }}>
        {column.attachedNodeId !== null ? (
          <>
            <span style={attachedBadge}>Attached to node</span>
            <button style={detachBtn} onClick={() => detachColumn(selectedColumnId)}>Detach</button>
          </>
        ) : (
          <span style={standaloneBadge}>Standalone</span>
        )}
      </div>

      <div style={fieldRow}>
        <div style={label}>Dimensions</div>
        <div>{dimLabel}</div>
      </div>

      {/* Phase 1.9 — base / top floor pickers (multi-floor only) */}
      {(() => {
        const floors = [...(projectSettings.floors ?? [])].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
        if (floors.length <= 1) return null
        const baseId = column.baseFloorId ?? floors[0].id
        const topId  = column.topFloorId  ?? baseId
        return (
          <>
            <div style={fieldRow}>
              <div style={label}>Base floor</div>
              <select
                value={baseId}
                onChange={e => setColumnFloorSpan(selectedColumnId, e.target.value, topId)}
                onKeyDown={e => e.stopPropagation()}
                style={{ width: '100%', fontSize: 13 }}
              >
                {floors.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
            <div style={fieldRow}>
              <div style={label}>Top floor</div>
              <select
                value={topId}
                onChange={e => setColumnFloorSpan(selectedColumnId, baseId, e.target.value)}
                onKeyDown={e => e.stopPropagation()}
                style={{ width: '100%', fontSize: 13 }}
              >
                {floors.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
          </>
        )
      })()}

      {/* Phase 1.7+ — Reinforcement spec (BBS) with centralized resolution */}
      {(() => {
        const specs = projectSettings.reinforcementSpecs ?? {}
        const colSpecs = Object.values(specs).filter(s => s.elementType === 'COLUMN')
        const state = useStore.getState()
        const resolved = resolveColumnReinforcementSpec(state, selectedColumnId)
        const handleApplyToMatching = async () => {
          const peers = Object.values(state.columns)
            .filter(c => c.id !== selectedColumnId && c.columnTypeId === column.columnTypeId)
          if (peers.length === 0) {
            await dialog.alert('No matching columns to update — this is the only column of its type.', { title: 'No matching columns' })
            return
          }
          const specLabel = column.reinforcementSpecId
            ? (specs[column.reinforcementSpecId]?.label ?? column.reinforcementSpecId)
            : 'no spec (clear)'
          const ok = await dialog.confirm(
            `Apply "${specLabel}" to ${peers.length} other column${peers.length === 1 ? '' : 's'} of type ${colType?.label ?? column.columnTypeId}?`,
            { title: 'Apply to matching columns?', confirmLabel: 'Apply', variant: 'default' }
          )
          if (!ok) return
          applyReinforcementSpecToMatching({
            elementType: 'COLUMN',
            sourceEntityId: selectedColumnId,
            specId: column.reinforcementSpecId ?? null,
          })
        }
        return (
          <div style={fieldRow}>
            <div style={label}>Steel spec (BBS)</div>
            <select
              value={column.reinforcementSpecId ?? ''}
              onChange={e => setColumnReinforcementSpec(selectedColumnId, e.target.value || null)}
              onKeyDown={e => e.stopPropagation()}
              style={{ width: '100%', fontSize: 13 }}
            >
              <option value="">— Inherit —</option>
              {colSpecs.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <div style={resolutionBadge(resolved.source)}>
              <span style={{ fontWeight: 600 }}>{resolved.specLabel}</span>
              <span style={{ opacity: 0.75 }}> · {humanizeAssignmentSource(resolved.source)}</span>
            </div>
            <button
              style={applyBtn}
              onClick={handleApplyToMatching}
              title="Copy this column's spec to all other columns of the same type"
            >Apply to matching columns</button>
            {colSpecs.length === 0 && (
              <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>
                Open BBS panel to define column specs.
              </div>
            )}
          </div>
        )
      })()}

      {/* Phase 1.8 — Foundation attachment indicator */}
      {(() => {
        const fdn = getFoundationForColumn(selectedColumnId)
        if (!fdn) return null
        return (
          <div style={{ ...fieldRow, padding: '6px 8px', background: '#f0f7ff', borderRadius: 4, fontSize: 11, color: '#2471a3' }}>
            Attached to foundation: <strong>{fdn.label ?? fdn.type}</strong>
          </div>
        )
      })()}
    </div>
  )
}
