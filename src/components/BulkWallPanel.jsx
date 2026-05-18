import { useStore } from '../store'
import { Panel } from './ui/Panel'
import { Field } from './ui/Field'

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

  const checkLabel = (active) => ({
    color: active ? 'var(--color-text)' : 'var(--color-text-secondary)',
    fontWeight: active ? 'var(--weight-semibold)' : 'var(--weight-regular)',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
  })

  const title = (
    <div>
      <div style={{ fontWeight: 'var(--weight-bold)', color: 'var(--color-warning)' }}>
        {selected.length} walls selected
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2, fontWeight: 'var(--weight-regular)' }}>
        Ctrl+click to add/remove
      </div>
    </div>
  )

  return (
    <Panel
      title={title}
      onClose={cancelAction}
      width={260}
      position={{ top: 56, left: 16 }}
      className="ui-panel--bulk"
    >
      {/* Height */}
      <Field label="Height" inline hint="ft">
        <input type="number" defaultValue={uniformHeight} placeholder={heights.length > 1 ? 'mixed' : ''} min={1}
          onBlur={e => applyHeight(e.target.value)}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') applyHeight(e.target.value) }}
        />
      </Field>

      {/* Thickness */}
      <Field label="Thickness" inline hint="ft">
        <input type="number" defaultValue={uniformThick} placeholder={thicknesses.length > 1 ? 'mixed' : ''} min={0.1} step={0.1}
          onBlur={e => applyThickness(e.target.value)}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') applyThickness(e.target.value) }}
        />
      </Field>

      <div style={{ borderTop: '1px solid var(--color-border)', margin: 'var(--space-3) 0' }} />

      {/* Plot boundary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <input type="checkbox" id="bulkPlot"
          checked={allPlot}
          ref={el => { if (el) el.indeterminate = anyPlot && !allPlot }}
          onChange={e => setBulkWallProp(selectedWallIds, 'isPlot', e.target.checked)}
          style={{ cursor: 'pointer' }}
        />
        <label htmlFor="bulkPlot" style={checkLabel(allPlot)}>Plot boundary wall</label>
      </div>

      {/* Virtual */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
        <input type="checkbox" id="bulkVirtual"
          checked={allVirtual}
          ref={el => { if (el) el.indeterminate = anyVirtual && !allVirtual }}
          onChange={e => setBulkWallProp(selectedWallIds, 'isVirtual', e.target.checked)}
          style={{ cursor: 'pointer' }}
        />
        <label htmlFor="bulkVirtual" style={checkLabel(allVirtual)}>Virtual wall (open plan)</label>
      </div>

      <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
        Press Esc or click empty canvas to deselect
      </div>
    </Panel>
  )
}
