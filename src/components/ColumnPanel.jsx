import { useStore } from '../store'
import { getColumnDimLabel } from '../lib/columnShapes'

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

export default function ColumnPanel() {
  const selectedColumnId = useStore(s => s.selectedColumnId)
  const columns          = useStore(s => s.columns)
  const projectSettings  = useStore(s => s.projectSettings)
  const selectColumn     = useStore(s => s.selectColumn)
  const setColumnType    = useStore(s => s.setColumnType)
  const detachColumn     = useStore(s => s.detachColumn)
  const deleteColumn     = useStore(s => s.deleteColumn)

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
    </div>
  )
}
