import { useStore } from '../store'
import { Modal } from './ui/Modal.jsx'
import { Button } from './ui/Button.jsx'

const floorCard = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--space-2) var(--space-3)',
  marginBottom: 'var(--space-2)',
}

const cardHeaderRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  marginBottom: 'var(--space-2)',
}

const labelInput = {
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-semibold)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '2px var(--space-2)',
  flex: 1,
  color: 'var(--color-text)',
  background: 'var(--color-surface)',
}

const seqBadge = {
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-muted)',
  background: 'var(--color-bg-muted)',
  borderRadius: 'var(--radius-sm)',
  padding: '2px var(--space-2)',
  fontWeight: 'var(--weight-semibold)',
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

const hint = {
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-muted)',
  marginTop: 'var(--space-2)',
}

function entityCounts(entities) {
  return {
    walls:      entities.walls.length,
    rooms:      entities.rooms.length,
    stamps:     entities.stamps.length,
    columns:    entities.columns.length,
    beams:      entities.beams.length,
    slabs:      entities.slabs.length,
    staircases: entities.staircases.length,
  }
}

function hasAnyEntities(counts) {
  return Object.values(counts).some(n => n > 0)
}

function summarizeCounts(counts) {
  const parts = []
  if (counts.walls)      parts.push(`${counts.walls} walls`)
  if (counts.rooms)      parts.push(`${counts.rooms} rooms`)
  if (counts.stamps)     parts.push(`${counts.stamps} stamps`)
  if (counts.columns)    parts.push(`${counts.columns} columns`)
  if (counts.beams)      parts.push(`${counts.beams} beams`)
  if (counts.slabs)      parts.push(`${counts.slabs} slabs`)
  if (counts.staircases) parts.push(`${counts.staircases} staircases`)
  return parts.join(', ')
}

export default function FloorsManagerPanel() {
  const projectSettings    = useStore(s => s.projectSettings)
  const activeTool         = useStore(s => s.activeTool)
  const setTool            = useStore(s => s.setTool)
  const addFloor           = useStore(s => s.addFloor)
  const removeFloor        = useStore(s => s.removeFloor)
  const updateFloor        = useStore(s => s.updateFloor)
  const getEntitiesOnFloor = useStore(s => s.getEntitiesOnFloor)
  const currentFloorId     = useStore(s => s.currentFloorId)
  const setCurrentFloorId  = useStore(s => s.setCurrentFloorId)

  const open = activeTool === 'floors'
  const onClose = () => setTool('select')

  const floors = [...(projectSettings?.floors ?? [])].sort(
    (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)
  )

  const defaultSlabIn = projectSettings?.slabSettings?.mainThicknessIn ?? 5

  function handleRemove(floor) {
    const counts = entityCounts(getEntitiesOnFloor(floor.id))
    if (hasAnyEntities(counts)) return
    if (floor.id === currentFloorId) {
      const fallback = floors.find(f => f.id !== floor.id)
      if (fallback) setCurrentFloorId(fallback.id)
    }
    removeFloor(floor.id)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Floors"
      width={480}
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}
    >
      {floors.length === 0 && (
        <div
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-muted)',
            marginBottom: 'var(--space-2)',
          }}
        >
          No floors defined. Add one below.
        </div>
      )}

      {floors.map((f, idx) => {
        const entities = getEntitiesOnFloor(f.id)
        const counts   = entityCounts(entities)
        const blocked  = hasAnyEntities(counts)
        const isFirst  = idx === 0
        const deleteDisabled = isFirst || blocked
        const tooltip = isFirst
          ? 'Cannot remove the base floor'
          : blocked
            ? `Floor has entities — remove them first (${summarizeCounts(counts)})`
            : 'Remove floor'

        const slabOverride = f.meta?.slabThicknessIn
        const slabEffective = slabOverride ?? defaultSlabIn

        return (
          <div key={f.id} style={floorCard}>
            <div style={cardHeaderRow}>
              <span style={seqBadge}>#{(f.sequence ?? idx) + 1}</span>
              <input
                style={labelInput}
                value={f.label ?? ''}
                onKeyDown={e => e.stopPropagation()}
                onChange={e => updateFloor(f.id, { label: e.target.value })}
              />
              <Button
                variant="danger"
                size="sm"
                disabled={deleteDisabled}
                title={tooltip}
                onClick={() => handleRemove(f)}
              >
                ✕
              </Button>
            </div>

            <div style={fieldRow}>
              <span style={lbl}>Plinth height (ft)</span>
              <input
                type="number" min={0} step={0.5} style={numInput}
                value={f.plinthHeightFt ?? 0}
                onKeyDown={e => e.stopPropagation()}
                onChange={e => updateFloor(f.id, { plinthHeightFt: parseFloat(e.target.value) })}
              />
            </div>

            <div style={fieldRow}>
              <span style={lbl}>Floor height (ft)</span>
              <input
                type="number" min={0} step={0.5} style={numInput}
                value={f.floorHeightFt ?? 0}
                onKeyDown={e => e.stopPropagation()}
                onChange={e => updateFloor(f.id, { floorHeightFt: parseFloat(e.target.value) })}
              />
            </div>

            <div style={fieldRow}>
              <span style={lbl}>Slab thickness (in)</span>
              <input
                type="number" min={0} step={0.5} style={numInput}
                value={slabEffective}
                placeholder={String(defaultSlabIn)}
                onKeyDown={e => e.stopPropagation()}
                onChange={e => {
                  const v = e.target.value
                  const nextMeta = { ...(f.meta ?? {}) }
                  if (v === '' || Number.isNaN(parseFloat(v))) {
                    delete nextMeta.slabThicknessIn
                  } else {
                    nextMeta.slabThicknessIn = parseFloat(v)
                  }
                  updateFloor(f.id, { meta: Object.keys(nextMeta).length ? nextMeta : null })
                }}
              />
              {slabOverride == null && (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  (project default)
                </span>
              )}
            </div>

            {blocked && (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                Contains: {summarizeCounts(counts)}
              </div>
            )}
          </div>
        )
      })}

      <Button variant="primary" size="sm" onClick={() => addFloor()}>
        + Add floor
      </Button>

      <div style={hint}>
        Floors are listed in build order (lowest sequence first). Use the canvas
        floor switcher to move between floors while editing.
      </div>
    </Modal>
  )
}
