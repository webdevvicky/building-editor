import { useStore } from '../store'

export default function BulkWallPanel() {
  const selectedWallIds  = useStore(s => s.selectedWallIds)
  const walls            = useStore(s => s.walls)
  const setBulkWallProp  = useStore(s => s.setBulkWallProp)
  const cancelAction     = useStore(s => s.cancelAction)

  if (selectedWallIds.length === 0) return null

  const selected = selectedWallIds.map(id => walls[id]).filter(Boolean)
  if (selected.length === 0) return null

  // Derive whether values are uniform across selected walls
  const heights     = [...new Set(selected.map(w => w.height ?? 10))]
  const thicknesses = [...new Set(selected.map(w => w.thickness ?? 0.5))]
  const allPlot     = selected.every(w => w.isPlot)
  const anyPlot     = selected.some(w => w.isPlot)
  const allVirtual  = selected.every(w => w.isVirtual)
  const anyVirtual  = selected.some(w => w.isVirtual)

  const uniformHeight = heights.length === 1 ? heights[0] : ''
  const uniformThick  = thicknesses.length === 1 ? thicknesses[0] : ''

  function applyHeight(val) {
    const h = parseFloat(val)
    if (h > 0) setBulkWallProp(selectedWallIds, 'height', h)
  }

  function applyThickness(val) {
    const t = parseFloat(val)
    if (t > 0) setBulkWallProp(selectedWallIds, 'thickness', t)
  }

  const row = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }
  const inputStyle = { width: 60, padding: '3px 6px', border: '1px solid #ccc', borderRadius: 4, fontSize: 13 }
  const unit = { color: '#999', fontSize: 11 }
  const checkLabel = (active) => ({ color: active ? '#333' : '#555', fontWeight: active ? 600 : 400, cursor: 'pointer', fontSize: 13 })

  return (
    <div style={{
      position: 'absolute', top: 56, left: 16,
      background: '#fff', border: '2px solid #e67e22', borderRadius: 8,
      padding: '12px 14px', zIndex: 10, minWidth: 230, fontSize: 13,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <span style={{ fontWeight: 700, color: '#e67e22' }}>{selected.length} walls selected</span>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>Ctrl+click to add/remove</div>
        </div>
        <button onClick={cancelAction}
          style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>
          ×
        </button>
      </div>

      {/* Height */}
      <div style={row}>
        <label style={{ color: '#555', width: 70 }}>Height</label>
        <input type="number" defaultValue={uniformHeight} placeholder={heights.length > 1 ? 'mixed' : ''} min={1}
          onBlur={e => applyHeight(e.target.value)}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') applyHeight(e.target.value) }}
          style={inputStyle}
        />
        <span style={unit}>ft</span>
      </div>

      {/* Thickness */}
      <div style={row}>
        <label style={{ color: '#555', width: 70 }}>Thickness</label>
        <input type="number" defaultValue={uniformThick} placeholder={thicknesses.length > 1 ? 'mixed' : ''} min={0.1} step={0.1}
          onBlur={e => applyThickness(e.target.value)}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') applyThickness(e.target.value) }}
          style={inputStyle}
        />
        <span style={unit}>ft</span>
      </div>

      <div style={{ borderTop: '1px solid #eee', margin: '10px 0' }} />

      {/* Plot boundary */}
      <div style={{ ...row, marginBottom: 10 }}>
        <input type="checkbox" id="bulkPlot"
          checked={allPlot}
          ref={el => { if (el) el.indeterminate = anyPlot && !allPlot }}
          onChange={e => setBulkWallProp(selectedWallIds, 'isPlot', e.target.checked)}
          style={{ cursor: 'pointer' }}
        />
        <label htmlFor="bulkPlot" style={checkLabel(allPlot)}>Plot boundary wall</label>
      </div>

      {/* Virtual */}
      <div style={{ ...row, marginBottom: 4 }}>
        <input type="checkbox" id="bulkVirtual"
          checked={allVirtual}
          ref={el => { if (el) el.indeterminate = anyVirtual && !allVirtual }}
          onChange={e => setBulkWallProp(selectedWallIds, 'isVirtual', e.target.checked)}
          style={{ cursor: 'pointer' }}
        />
        <label htmlFor="bulkVirtual" style={checkLabel(allVirtual)}>Virtual wall (open plan)</label>
      </div>

      <div style={{ marginTop: 10, fontSize: 11, color: '#aaa' }}>
        Press Esc or click empty canvas to deselect
      </div>
    </div>
  )
}
