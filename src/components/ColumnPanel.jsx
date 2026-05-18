import { useStore } from '../store'
import { getColumnDimLabel } from '../lib/columnShapes'
import { resolveColumnReinforcementSpec, humanizeAssignmentSource } from '../specs/resolution'
import { dialog } from './ui/Dialog'
import { Panel } from './ui/Panel'
import { Button } from './ui/Button'
import { Field } from './ui/Field'

const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }

const fieldRow = { marginTop: 'var(--space-2)' }
const label = { color: 'var(--color-text-muted)', marginBottom: 2, fontSize: 'var(--text-xs)' }

const SOURCE_COLOR = {
  INSTANCE:        { bg: 'var(--color-success-bg)',  fg: 'var(--color-success)' },
  TYPE:            { bg: 'var(--color-primary-bg)',  fg: 'var(--color-primary)' },
  CLASS:           { bg: 'var(--color-primary-bg)',  fg: 'var(--color-primary)' },
  PROJECT_DEFAULT: { bg: 'var(--color-warning-bg)',  fg: 'var(--color-warning)' },
  ESTIMATE:        { bg: 'var(--color-bg-muted)',    fg: 'var(--color-text-muted)' },
}
function resolutionBadge(source) {
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
    <Panel
      title="Column"
      onClose={() => selectColumn(null)}
      width={260}
      position={{ top: 56, left: 16 }}
    >
      <div style={{ marginBottom: 'var(--space-2)' }}>
        <Button variant="danger" size="sm" onClick={handleDelete}>Delete</Button>
      </div>

      <Field label="Type">
        <select
          value={column.columnTypeId}
          onChange={e => setColumnType(selectedColumnId, e.target.value)}
        >
          {columnTypes.map(t => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
      </Field>

      <div style={fieldRow}>
        <div style={label}>Position</div>
        <div style={{ fontSize: 'var(--text-base)' }}>{xFt} ft, {yFt} ft</div>
      </div>

      <div style={{ ...fieldRow, ...rowStyle }}>
        {column.attachedNodeId !== null ? (
          <>
            <span style={{
              fontSize: 'var(--text-xs)',
              padding: '2px var(--space-2)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-primary-bg)',
              color: 'var(--color-primary)',
            }}>Attached to node</span>
            <Button variant="secondary" size="sm" onClick={() => detachColumn(selectedColumnId)}>Detach</Button>
          </>
        ) : (
          <span style={{
            fontSize: 'var(--text-xs)',
            padding: '2px var(--space-2)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-bg-muted)',
            color: 'var(--color-text-secondary)',
          }}>Standalone</span>
        )}
      </div>

      <div style={fieldRow}>
        <div style={label}>Dimensions</div>
        <div style={{ fontSize: 'var(--text-base)' }}>{dimLabel}</div>
      </div>

      {/* Phase 1.9 — base / top floor pickers (multi-floor only) */}
      {(() => {
        const floors = [...(projectSettings.floors ?? [])].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
        if (floors.length <= 1) return null
        const baseId = column.baseFloorId ?? floors[0].id
        const topId  = column.topFloorId  ?? baseId
        return (
          <>
            <Field label="Base floor">
              <select
                value={baseId}
                onChange={e => setColumnFloorSpan(selectedColumnId, e.target.value, topId)}
                onKeyDown={e => e.stopPropagation()}
              >
                {floors.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </Field>
            <Field label="Top floor">
              <select
                value={topId}
                onChange={e => setColumnFloorSpan(selectedColumnId, baseId, e.target.value)}
                onKeyDown={e => e.stopPropagation()}
              >
                {floors.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </Field>
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
          <>
            <Field label="Steel spec (BBS)">
              <select
                value={column.reinforcementSpecId ?? ''}
                onChange={e => setColumnReinforcementSpec(selectedColumnId, e.target.value || null)}
                onKeyDown={e => e.stopPropagation()}
              >
                <option value="">— Inherit —</option>
                {colSpecs.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
            <div style={resolutionBadge(resolved.source)}>
              <span style={{ fontWeight: 'var(--weight-semibold)' }}>{resolved.specLabel}</span>
              <span style={{ opacity: 0.75 }}> · {humanizeAssignmentSource(resolved.source)}</span>
            </div>
            <div style={{ marginTop: 'var(--space-2)' }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleApplyToMatching}
                title="Copy this column's spec to all other columns of the same type"
              >
                Apply to matching columns
              </Button>
            </div>
            {colSpecs.length === 0 && (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
                Open BBS panel to define column specs.
              </div>
            )}
          </>
        )
      })()}

      {/* Phase 1.8 — Foundation attachment indicator */}
      {(() => {
        const fdn = getFoundationForColumn(selectedColumnId)
        if (!fdn) return null
        return (
          <div style={{
            ...fieldRow,
            padding: 'var(--space-2)',
            background: 'var(--color-primary-bg)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-primary)',
          }}>
            Attached to foundation: <strong>{fdn.label ?? fdn.type}</strong>
          </div>
        )
      })()}
    </Panel>
  )
}
