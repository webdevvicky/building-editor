import { useStore } from '../store'
import { GRID_IN, DEFAULT_WALL_HEIGHT_IN, DEFAULT_WALL_THICK_IN } from '../geometry'
import SelectionPanel from './ui/SelectionPanel'
import { Field } from './ui/Field'
import FeetInchesInput from './ui/FeetInchesInput'
import InchesInput from './ui/InchesInput'
import { DEFAULT_PRECISION } from '../lib/units'

export default function BulkWallPanel() {
  const selectedWallIds  = useStore(s => s.selectedWallIds)
  const walls            = useStore(s => s.walls)
  const setBulkWallProp  = useStore(s => s.setBulkWallProp)
  const cancelAction     = useStore(s => s.cancelAction)

  if (selectedWallIds.length === 0) return null

  const selected = selectedWallIds.map(id => walls[id]).filter(Boolean)
  if (selected.length === 0) return null

  // Derive whether values are uniform across selected walls. Storage is
  // INCHES for both height and thickness (matches setWallHeight /
  // setWallThickness semantics). Display layer converts: height shown in
  // feet via FeetInchesInput, thickness shown in inches via InchesInput.
  const heights     = [...new Set(selected.map(w => w.height ?? DEFAULT_WALL_HEIGHT_IN))]
  const thicknesses = [...new Set(selected.map(w => w.thickness ?? DEFAULT_WALL_THICK_IN))]
  const allPlot     = selected.every(w => w.isPlot)
  const anyPlot     = selected.some(w => w.isPlot)
  const allVirtual  = selected.every(w => w.isVirtual)
  const anyVirtual  = selected.some(w => w.isVirtual)

  // Mixed → null (FeetInchesInput / InchesInput render placeholder).
  const uniformHeightIn = heights.length === 1 ? heights[0] : null
  const uniformThickIn  = thicknesses.length === 1 ? thicknesses[0] : null

  function applyHeightFt(ft) {
    if (ft > 0) setBulkWallProp(selectedWallIds, 'height', ft * GRID_IN)
  }

  function applyThicknessIn(inches) {
    if (inches > 0) setBulkWallProp(selectedWallIds, 'thickness', inches)
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
    <SelectionPanel
      title={title}
      onClose={cancelAction}
      width={260}
      className="ui-panel--bulk"
    >
      {/* Height — stored in inches, displayed as feet */}
      <Field label="Height" inline>
        <FeetInchesInput
          value={uniformHeightIn !== null ? uniformHeightIn / GRID_IN : null}
          onCommit={applyHeightFt}
          min={1}
          precision={DEFAULT_PRECISION.height}
          placeholder={heights.length > 1 ? 'mixed' : ''}
        />
      </Field>

      {/* Thickness — stored in inches, displayed as inches */}
      <Field label="Thickness" inline>
        <InchesInput
          value={uniformThickIn}
          onCommit={applyThicknessIn}
          min={1}
          precision="1"
          placeholder={thicknesses.length > 1 ? 'mixed' : ''}
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
    </SelectionPanel>
  )
}
