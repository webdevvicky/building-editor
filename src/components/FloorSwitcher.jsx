import { useStore } from '../store'
import { Button } from './ui/Button.jsx'
import { Plus } from 'lucide-react'

const wrap = {
  position: 'absolute',
  top: 56,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--space-1)',
  zIndex: 'var(--z-panel)',
  pointerEvents: 'none',
}

const row = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-1)',
  background: 'var(--color-surface)',
  padding: 'var(--space-1)',
  borderRadius: 'var(--radius-full)',
  border: '1px solid var(--color-border)',
  boxShadow: 'var(--shadow-sm)',
  pointerEvents: 'auto',
}

const caption = {
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-muted)',
  background: 'var(--color-surface)',
  padding: '1px var(--space-2)',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-border)',
}

const separator = {
  width: 1,
  height: 18,
  background: 'var(--color-border)',
  margin: '0 2px',
}

// Always visible — single-floor projects still need the Add Floor affordance
// so users can extend vertically without hunting through View & Settings.
export default function FloorSwitcher() {
  const projectSettings   = useStore(s => s.projectSettings)
  const currentFloorId    = useStore(s => s.currentFloorId)
  const setCurrentFloorId = useStore(s => s.setCurrentFloorId)
  const addFloor          = useStore(s => s.addFloor)

  const floors = [...(projectSettings?.floors ?? [])].sort(
    (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)
  )

  if (floors.length === 0) return null

  const activeIdx = floors.findIndex(f => f.id === currentFloorId)
  const displayIdx = activeIdx === -1 ? 1 : activeIdx + 1

  function handleAddFloor() {
    const id = addFloor()
    if (id) setCurrentFloorId(id)
  }

  return (
    <div style={wrap}>
      <div style={row}>
        {floors.map(f => {
          const active = f.id === currentFloorId
          return (
            <Button
              key={f.id}
              variant={active ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setCurrentFloorId(f.id)}
              title={`Switch to ${f.label}`}
            >
              {f.label}
            </Button>
          )
        })}
        <div style={separator} />
        <Button
          variant="ghost"
          size="sm"
          onClick={handleAddFloor}
          title="Add a new floor above"
        >
          <Plus size={14} strokeWidth={2} /> Add floor
        </Button>
      </div>
      <div style={caption}>Floor {displayIdx} / {floors.length}</div>
    </div>
  )
}
