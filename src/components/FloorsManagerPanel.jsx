import { useStore } from '../store'

const overlay = {
  position: 'fixed', top: '50%', left: '50%',
  transform: 'translate(-50%, -50%)', zIndex: 100,
  width: 480, maxHeight: '80vh', overflowY: 'auto',
  background: '#fff', borderRadius: 8,
  padding: 20, boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
  fontSize: 13,
}

const headerRow = {
  display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', marginBottom: 16,
}

const closeBtn = {
  background: 'none', border: 'none', fontSize: 18,
  cursor: 'pointer', color: '#555', lineHeight: 1, padding: '0 4px',
}

const floorCard = {
  border: '1px solid #eee',
  borderRadius: 4,
  padding: '8px 10px',
  marginBottom: 8,
}

const cardHeaderRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 8,
}

const labelInput = {
  fontSize: 12,
  fontWeight: 600,
  border: '1px solid #ddd',
  borderRadius: 3,
  padding: '2px 6px',
  flex: 1,
}

const seqBadge = {
  fontSize: 10,
  color: '#888',
  background: '#f4f4f4',
  borderRadius: 3,
  padding: '2px 6px',
  fontWeight: 600,
}

const deleteBtnStyle = (disabled) => ({
  background: disabled ? '#f8f8f8' : '#fff0f0',
  border: `1px solid ${disabled ? '#ddd' : '#e74c3c'}`,
  borderRadius: 3,
  color: disabled ? '#bbb' : '#e74c3c',
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontSize: 10,
  padding: '2px 6px',
})

const fieldRow = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }
const lbl     = { color: '#666', minWidth: 160, fontSize: 12 }
const numInput = { width: 72, fontSize: 13 }

const addBtn = {
  fontSize: 12,
  background: '#f0f7ff',
  border: '1px solid #3498db',
  borderRadius: 4,
  color: '#2471a3',
  cursor: 'pointer',
  padding: '6px 12px',
  marginTop: 8,
}

const hint = { fontSize: 10, color: '#aaa', marginTop: 6 }

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

  if (activeTool !== 'floors') return null

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
    <div style={overlay}>
      <div style={headerRow}>
        <strong style={{ fontSize: 15 }}>Floors</strong>
        <button style={closeBtn} onClick={() => setTool('select')}>×</button>
      </div>

      {floors.length === 0 && (
        <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
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
              <button
                style={deleteBtnStyle(deleteDisabled)}
                disabled={deleteDisabled}
                title={tooltip}
                onClick={() => handleRemove(f)}
              >✕</button>
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
                <span style={{ fontSize: 10, color: '#aaa' }}>(project default)</span>
              )}
            </div>

            {blocked && (
              <div style={{ fontSize: 10, color: '#888' }}>
                Contains: {summarizeCounts(counts)}
              </div>
            )}
          </div>
        )
      })}

      <button style={addBtn} onClick={() => addFloor()}>+ Add floor</button>

      <div style={hint}>
        Floors are listed in build order (lowest sequence first). Use the canvas
        floor switcher to move between floors while editing.
      </div>
    </div>
  )
}
