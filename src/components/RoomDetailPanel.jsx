import { useState } from 'react'
import { useStore } from '../store'
import { GRID_IN, DEFAULT_WALL_HEIGHT_IN } from '../geometry'

function Row({ label, value, sub }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
      <span style={{ color: '#555', fontSize: 12 }}>{label}</span>
      <span style={{ fontWeight: 600, fontSize: 13 }}>
        {value}
        {sub && <span style={{ color: '#aaa', fontWeight: 400, fontSize: 11, marginLeft: 4 }}>{sub}</span>}
      </span>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase',
        letterSpacing: 0.6, marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  )
}

export default function RoomDetailPanel() {
  const selectedRoomId = useStore(s => s.selectedRoomId)
  const rooms          = useStore(s => s.rooms)
  const walls          = useStore(s => s.walls)
  const nodes          = useStore(s => s.nodes)
  const unit           = useStore(s => s.unit)
  const getRoomArea    = useStore(s => s.getRoomArea)
  const isRoomValid    = useStore(s => s.isRoomValid)
  const renameRoom     = useStore(s => s.renameRoom)
  const deleteRoom     = useStore(s => s.deleteRoom)
  const selectRoom     = useStore(s => s.selectRoom)

  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal]         = useState('')
  const [showWalls, setShowWalls]     = useState(false)

  if (!selectedRoomId) return null
  const room = rooms[selectedRoomId]
  if (!room) return null

  const valid     = isRoomValid(selectedRoomId)
  const floorArea = valid ? getRoomArea(selectedRoomId) : 0

  // Build per-wall details
  const wallDetails = room.wallIds.map(wid => {
    const w = walls[wid]
    if (!w) return null
    const a = nodes[w.n1], b = nodes[w.n2]
    if (!a || !b) return null
    const lenFt      = Math.round(Math.hypot(b.x - a.x, b.y - a.y) / GRID_IN * 100) / 100
    const hFt        = Math.round((w.height ?? DEFAULT_WALL_HEIGHT_IN) / GRID_IN * 100) / 100
    const openings   = w.openings || []
    const openingArea = openings.reduce((s, o) => s + (o.width / GRID_IN) * (o.height / GRID_IN), 0)
    const netArea    = Math.round(Math.max(0, lenFt * hFt - openingArea) * 100) / 100
    return { id: wid, lenFt, hFt, openings, netArea, isVirtual: w.isVirtual ?? false, isPlot: w.isPlot ?? false }
  }).filter(Boolean)

  const realWalls    = wallDetails.filter(w => !w.isVirtual)
  const virtualWalls = wallDetails.filter(w => w.isVirtual)

  const totalWallArea  = Math.round(realWalls.reduce((s, w) => s + w.netArea, 0) * 100) / 100
  const ceilingArea    = floorArea
  const plasterArea    = Math.round((totalWallArea + ceilingArea) * 100) / 100
  const paintArea      = plasterArea
  const flooringArea   = floorArea

  const allOpenings = wallDetails.flatMap(w => w.openings)
  const doors       = allOpenings.filter(o => o.type === 'door')
  const windows     = allOpenings.filter(o => o.type === 'window')

  function fmtArea(sqFt) {
    if (unit === 'm') return `${Math.round(sqFt * 0.0929 * 100) / 100} m²`
    return `${sqFt} ft²`
  }
  function fmtLen(ft) {
    if (unit === 'm') return `${Math.round(ft * 0.3048 * 100) / 100} m`
    return `${ft} ft`
  }

  function saveName() {
    const trimmed = nameVal.trim()
    if (trimmed) renameRoom(room.id, trimmed)
    setEditingName(false)
  }

  return (
    <div style={{
      position: 'absolute', top: 56, left: 16,
      background: '#fff', border: '1px solid #ccc', borderRadius: 8,
      padding: '12px 14px', zIndex: 10, width: 260, fontSize: 13,
      maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
      boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
    }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {editingName ? (
            <input autoFocus value={nameVal}
              onChange={e => setNameVal(e.target.value)}
              onBlur={saveName}
              onKeyDown={e => {
                e.stopPropagation()
                if (e.key === 'Enter') saveName()
                if (e.key === 'Escape') setEditingName(false)
              }}
              style={{ width: '100%', fontSize: 14, fontWeight: 700, padding: '2px 4px',
                border: '1px solid #4a90e2', borderRadius: 4, outline: 'none' }}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#222', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{room.name}</span>
              <button onClick={() => { setNameVal(room.name); setEditingName(true) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa',
                  fontSize: 12, padding: 0, flexShrink: 0 }} title="Rename">✏</button>
            </div>
          )}
          <div style={{ fontSize: 11, marginTop: 2, color: valid ? '#27ae60' : '#e74c3c', fontWeight: 600 }}>
            {valid ? '✓ Valid room' : '⚠ Not a closed loop'}
          </div>
        </div>
        <button onClick={() => selectRoom(null)}
          style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer',
            fontSize: 18, lineHeight: 1, marginLeft: 8, flexShrink: 0 }}>×</button>
      </div>

      {!valid && (
        <div style={{ background: '#fff5f5', border: '1px solid #fcc', borderRadius: 6,
          padding: '8px 10px', fontSize: 12, color: '#c0392b', marginBottom: 10 }}>
          Walls don't form a closed polygon. Add missing walls or virtual walls to complete the boundary.
        </div>
      )}

      {valid && <>
        {/* Measurements */}
        <Section title="Area">
          <Row label="Floor"   value={fmtArea(floorArea)} />
          <Row label="Ceiling" value={fmtArea(ceilingArea)} />
          <Row label="Walls"   value={fmtArea(totalWallArea)}
            sub={`${realWalls.length} wall${realWalls.length !== 1 ? 's' : ''}${virtualWalls.length ? ` + ${virtualWalls.length} virtual` : ''}`} />
        </Section>

        <div style={{ borderTop: '1px solid #f0f0f0', margin: '8px 0' }} />

        {/* Openings */}
        <Section title="Openings">
          {doors.length === 0 && windows.length === 0 && (
            <div style={{ color: '#bbb', fontSize: 12 }}>No doors or windows</div>
          )}
          {doors.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ color: '#555', fontSize: 12 }}>Doors</span>
                <span style={{ fontWeight: 600 }}>{doors.length}</span>
              </div>
              {doors.map((d, i) => (
                <div key={i} style={{ fontSize: 11, color: '#888', marginLeft: 10, marginBottom: 1 }}>
                  • {fmtLen(Math.round(d.width/GRID_IN*10)/10)} × {fmtLen(Math.round(d.height/GRID_IN*10)/10)}
                </div>
              ))}
            </div>
          )}
          {windows.length > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ color: '#555', fontSize: 12 }}>Windows</span>
                <span style={{ fontWeight: 600 }}>{windows.length}</span>
              </div>
              {windows.map((w, i) => (
                <div key={i} style={{ fontSize: 11, color: '#888', marginLeft: 10, marginBottom: 1 }}>
                  • {fmtLen(Math.round(w.width/GRID_IN*10)/10)} × {fmtLen(Math.round(w.height/GRID_IN*10)/10)}
                </div>
              ))}
            </div>
          )}
        </Section>

        <div style={{ borderTop: '1px solid #f0f0f0', margin: '8px 0' }} />

        {/* Materials */}
        <Section title="Materials needed">
          <Row label="Flooring"        value={fmtArea(flooringArea)} />
          <Row label="Plaster (walls)" value={fmtArea(totalWallArea)} />
          <Row label="Plaster (ceiling)" value={fmtArea(ceilingArea)} />
          <Row label="Paint total"     value={fmtArea(paintArea)} />
          {doors.length > 0 && (
            <Row label="Door frames"   value={`${doors.length} unit${doors.length > 1 ? 's' : ''}`} />
          )}
          {windows.length > 0 && (
            <Row label="Window frames" value={`${windows.length} unit${windows.length > 1 ? 's' : ''}`} />
          )}
        </Section>

        {/* Wall breakdown (collapsible) */}
        <div style={{ borderTop: '1px solid #f0f0f0', margin: '8px 0' }} />
        <button onClick={() => setShowWalls(v => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4a90e2',
            fontSize: 12, padding: 0, marginBottom: showWalls ? 8 : 0, fontWeight: 600 }}>
          {showWalls ? '▾' : '▸'} Wall breakdown
        </button>
        {showWalls && (
          <div>
            {wallDetails.map((w, i) => (
              <div key={w.id} style={{ marginBottom: 6, padding: '6px 8px',
                background: '#f9f9f9', borderRadius: 4, fontSize: 11 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ color: w.isVirtual ? '#888' : '#333', fontWeight: 600 }}>
                    {w.isVirtual ? '┅ Virtual' : w.isPlot ? '⬛ Plot wall' : `Wall ${i + 1}`}
                  </span>
                  <span style={{ color: '#555' }}>{fmtLen(w.lenFt)} × h{w.hFt}ft</span>
                </div>
                {!w.isVirtual && (
                  <div style={{ color: '#888' }}>
                    Net area: {fmtArea(w.netArea)}
                    {w.openings.length > 0 && (
                      <span style={{ marginLeft: 6 }}>
                        ({w.openings.map(o => `${o.type === 'door' ? 'D' : 'W'} ${Math.round(o.width/GRID_IN*10)/10}×${Math.round(o.height/GRID_IN*10)/10}`).join(', ')})
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </>}

      {/* Delete room */}
      <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 10, paddingTop: 10 }}>
        <button onClick={() => { deleteRoom(room.id); selectRoom(null) }}
          style={{ width: '100%', padding: '5px', background: '#fff0f0', border: '1px solid #e74c3c',
            borderRadius: 4, color: '#e74c3c', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          Delete room
        </button>
      </div>
    </div>
  )
}
