// StampPanel — detail panel for selected stamps (select tool).
// Preserved interactions (do not remove during refactor):
//   click-to-place  : Canvas.jsx handleSVGClick (STAMP_TOOLS check)
//   drag-to-move    : Canvas.jsx handleStampMouseDown + handleMouseMove
//   resize via input: resizeStamp (arch) / updateStamp (civil) — no undo history by design,
//                     matches the resizeStamp pattern used for stairs/lift

import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { GRID_IN } from '../geometry'

const CIVIL_TYPES = new Set(['sump', 'overhead_tank', 'septic_tank'])

const STAMP_LABELS = {
  stairs:        'Staircase',
  lift:          'Lift',
  sump:          'Sump',
  overhead_tank: 'Overhead Tank',
  septic_tank:   'Septic Tank',
}

export default function StampPanel() {
  const selectedStampId = useStore(s => s.selectedStampId)
  const stamps          = useStore(s => s.stamps)
  const resizeStamp     = useStore(s => s.resizeStamp)
  const updateStamp     = useStore(s => s.updateStamp)
  const deleteStamp     = useStore(s => s.deleteStamp)
  const unit            = useStore(s => s.unit)

  const stamp   = stamps[selectedStampId]
  const isCivil = stamp ? CIVIL_TYPES.has(stamp.type) : false

  const [w,     setW]     = useState('')
  const [h,     setH]     = useState('')
  const [depth, setDepth] = useState('')
  const [name,  setName]  = useState('')

  useEffect(() => {
    if (!stamp) return
    setW(Math.round(stamp.w / GRID_IN * 10) / 10)
    setH(Math.round(stamp.h / GRID_IN * 10) / 10)
    if (isCivil) {
      setDepth(stamp.depth ? Math.round(stamp.depth / GRID_IN * 10) / 10 : '')
      setName(stamp.name || '')
    }
  }, [selectedStampId, stamp?.w, stamp?.h, stamp?.depth, stamp?.name])

  if (!stamp) return null

  const label        = STAMP_LABELS[stamp.type] || stamp.type
  const hasExcavation = stamp.type === 'sump' || stamp.type === 'septic_tank'

  function handleW(val) {
    setW(val)
    const n = parseFloat(val)
    if (n > 0) {
      if (isCivil) updateStamp(stamp.id, { w: Math.max(GRID_IN, n * GRID_IN) })
      else resizeStamp(stamp.id, n, parseFloat(h) || stamp.h / GRID_IN)
    }
  }

  function handleH(val) {
    setH(val)
    const n = parseFloat(val)
    if (n > 0) {
      if (isCivil) updateStamp(stamp.id, { h: Math.max(GRID_IN, n * GRID_IN) })
      else resizeStamp(stamp.id, parseFloat(w) || stamp.w / GRID_IN, n)
    }
  }

  function handleDepth(val) {
    setDepth(val)
    const n = parseFloat(val)
    if (n > 0) updateStamp(stamp.id, { depth: Math.max(GRID_IN, n * GRID_IN) })
  }

  function handleName(val) {
    setName(val)
    updateStamp(stamp.id, { name: val })
  }

  function fmtVol() {
    if (!stamp.depth || !stamp.w || !stamp.h) return '—'
    const ft3 = Math.round((stamp.w * stamp.h * stamp.depth) / 1728 * 100) / 100
    if (unit === 'm') return `${Math.round(ft3 * 0.0283 * 100) / 100} m³`
    return `${ft3} ft³`
  }

  const inputStyle = { width: 60, padding: '3px 6px', border: '1px solid #ccc', borderRadius: 4 }
  const rowStyle   = { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }
  const labelStyle = { color: '#555', width: 50 }

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

      {isCivil && (
        <div style={{ ...rowStyle, marginBottom: 10 }}>
          <label style={labelStyle}>Name</label>
          <input type="text" value={name}
            onChange={e => handleName(e.target.value)}
            onKeyDown={e => e.stopPropagation()}
            style={{ flex: 1, padding: '3px 6px', border: '1px solid #ccc', borderRadius: 4 }}
          />
        </div>
      )}

      <div style={rowStyle}>
        <label style={labelStyle}>Width</label>
        <input type="number" value={w} min={1} step={0.5}
          onChange={e => handleW(e.target.value)}
          onKeyDown={e => e.stopPropagation()}
          style={inputStyle}
        />
        <span style={{ color: '#999', fontSize: 11 }}>ft</span>
      </div>

      <div style={{ ...rowStyle, marginBottom: isCivil ? 8 : 0 }}>
        <label style={labelStyle}>
          {stamp.type === 'stairs' ? 'Depth' : 'Length'}
        </label>
        <input type="number" value={h} min={1} step={0.5}
          onChange={e => handleH(e.target.value)}
          onKeyDown={e => e.stopPropagation()}
          style={inputStyle}
        />
        <span style={{ color: '#999', fontSize: 11 }}>ft</span>
      </div>

      {isCivil && (
        <div style={rowStyle}>
          <label style={labelStyle}>Depth</label>
          <input type="number" value={depth} min={1} step={0.5}
            onChange={e => handleDepth(e.target.value)}
            onKeyDown={e => e.stopPropagation()}
            style={inputStyle}
          />
          <span style={{ color: '#999', fontSize: 11 }}>ft</span>
        </div>
      )}

      {hasExcavation && (
        <div style={{ marginTop: 4, padding: '6px 8px', background: '#f5f5f5',
          borderRadius: 4, fontSize: 11, color: '#555' }}>
          Excavation: <strong>{fmtVol()}</strong>
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: 11, color: '#aaa' }}>
        Drag to reposition · Delete key to remove
      </div>
    </div>
  )
}
