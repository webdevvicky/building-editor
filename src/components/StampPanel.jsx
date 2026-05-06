import { useState, useEffect } from 'react'
import { useStore } from '../store'

const GRID = 20

export default function StampPanel() {
  const selectedStampId = useStore(s => s.selectedStampId)
  const stamps          = useStore(s => s.stamps)
  const resizeStamp     = useStore(s => s.resizeStamp)
  const deleteStamp     = useStore(s => s.deleteStamp)

  const stamp = stamps[selectedStampId]

  const [w, setW] = useState('')
  const [h, setH] = useState('')

  useEffect(() => {
    if (stamp) {
      setW(Math.round(stamp.w / GRID * 10) / 10)
      setH(Math.round(stamp.h / GRID * 10) / 10)
    }
  }, [selectedStampId, stamp?.w, stamp?.h])

  if (!stamp) return null

  const label = stamp.type === 'stairs' ? 'Staircase' : 'Lift'

  function handleW(val) {
    setW(val)
    const n = parseFloat(val)
    if (n > 0) resizeStamp(stamp.id, n, parseFloat(h) || stamp.h / GRID)
  }

  function handleH(val) {
    setH(val)
    const n = parseFloat(val)
    if (n > 0) resizeStamp(stamp.id, parseFloat(w) || stamp.w / GRID, n)
  }

  return (
    <div style={{
      position: 'absolute', top: 56, right: 16,
      background: '#fff', border: '1px solid #ccc', borderRadius: 8,
      padding: '12px 14px', zIndex: 10, minWidth: 200, fontSize: 13,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontWeight: 700, color: '#333' }}>{label}</span>
        <button onClick={() => deleteStamp(stamp.id)}
          style={{ background: '#fff0f0', border: '1px solid #e74c3c', borderRadius: 4,
            color: '#e74c3c', cursor: 'pointer', fontSize: 11, padding: '3px 8px', fontWeight: 600 }}>
          Delete
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
        <label style={{ color: '#555', width: 50 }}>Width</label>
        <input type="number" value={w} min={1} step={0.5}
          onChange={e => handleW(e.target.value)}
          onKeyDown={e => e.stopPropagation()}
          style={{ width: 60, padding: '3px 6px', border: '1px solid #ccc', borderRadius: 4 }}
        />
        <span style={{ color: '#999', fontSize: 11 }}>ft</span>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <label style={{ color: '#555', width: 50 }}>
          {stamp.type === 'stairs' ? 'Depth' : 'Height'}
        </label>
        <input type="number" value={h} min={1} step={0.5}
          onChange={e => handleH(e.target.value)}
          onKeyDown={e => e.stopPropagation()}
          style={{ width: 60, padding: '3px 6px', border: '1px solid #ccc', borderRadius: 4 }}
        />
        <span style={{ color: '#999', fontSize: 11 }}>ft</span>
      </div>

      <div style={{ marginTop: 10, fontSize: 11, color: '#aaa' }}>
        Drag to reposition · Delete key to remove
      </div>
    </div>
  )
}
