import { useStore } from '../store'

const wrap = {
  position: 'absolute',
  top: 56,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  zIndex: 10,
  pointerEvents: 'none',
}

const row = {
  display: 'flex',
  gap: 4,
  background: '#fff',
  padding: 4,
  borderRadius: 8,
  border: '1px solid #ddd',
  boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
  pointerEvents: 'auto',
}

const tabBtn = (active) => ({
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid #ccc',
  background: active ? '#333' : '#fff',
  color: active ? '#fff' : '#333',
  cursor: 'pointer',
  fontWeight: 500,
  fontSize: 12,
  lineHeight: 1.2,
})

const caption = {
  fontSize: 10,
  color: '#888',
  background: 'rgba(255,255,255,0.85)',
  padding: '1px 6px',
  borderRadius: 4,
}

export default function FloorSwitcher() {
  const projectSettings   = useStore(s => s.projectSettings)
  const currentFloorId    = useStore(s => s.currentFloorId)
  const setCurrentFloorId = useStore(s => s.setCurrentFloorId)

  const floors = [...(projectSettings?.floors ?? [])].sort(
    (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)
  )

  if (floors.length <= 1) return null

  const activeIdx = floors.findIndex(f => f.id === currentFloorId)
  const displayIdx = activeIdx === -1 ? 1 : activeIdx + 1

  return (
    <div style={wrap}>
      <div style={row}>
        {floors.map(f => (
          <button
            key={f.id}
            onClick={() => setCurrentFloorId(f.id)}
            style={tabBtn(f.id === currentFloorId)}
            title={`Switch to ${f.label}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div style={caption}>Floor {displayIdx} / {floors.length}</div>
    </div>
  )
}
