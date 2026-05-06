import { useState } from 'react'
import { useStore } from '../store'

export default function RoomPanel() {
  const activeTool     = useStore(s => s.activeTool)
  const pendingWallIds = useStore(s => s.pendingWallIds)
  const walls          = useStore(s => s.walls)
  const rooms          = useStore(s => s.rooms)
  const isRoomValid    = useStore(s => s.isRoomValid)
  const getRoomArea    = useStore(s => s.getRoomArea)
  const unit           = useStore(s => s.unit)
  const saveRoom       = useStore(s => s.saveRoom)
  const deleteRoom     = useStore(s => s.deleteRoom)

  const [name, setName] = useState('')

  if (activeTool !== 'room') return null

  // Compute corner connection status
  const connections = {}
  pendingWallIds.forEach(wid => {
    const w = walls[wid]; if (!w) return
    connections[w.n1] = (connections[w.n1] || 0) + 1
    connections[w.n2] = (connections[w.n2] || 0) + 1
  })
  const openCorners   = Object.values(connections).filter(c => c < 2).length
  const closedCorners = Object.values(connections).filter(c => c >= 2).length
  const isClosed      = pendingWallIds.length >= 3 && openCorners === 0

  function handleSave() {
    const trimmed = name.trim()
    if (!trimmed || !isClosed) return
    saveRoom(trimmed)
    setName('')
  }

  function fmtArea(sqFt) {
    if (unit === 'm') return `${Math.round(sqFt * 0.0929 * 100) / 100} m²`
    return `${sqFt} ft²`
  }

  const roomList = Object.values(rooms)

  return (
    <div style={{
      position: 'absolute', top: 56, right: 16,
      background: '#fff', border: '1px solid #ccc', borderRadius: 8,
      padding: '12px 14px', zIndex: 10,
      display: 'flex', flexDirection: 'column', gap: 8, minWidth: 230,
    }}>
      <div style={{ fontWeight: 700, color: '#333', fontSize: 13 }}>Room Tool</div>

      {/* Instructions */}
      {pendingWallIds.length === 0 ? (
        <div style={{ fontSize: 12, color: '#888', lineHeight: 1.5 }}>
          Click walls to mark a room boundary.<br/>
          All corners must be connected (green ✓).
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>
            {pendingWallIds.length} wall{pendingWallIds.length > 1 ? 's' : ''} selected
          </div>

          {/* Corner status */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
              background: closedCorners > 0 ? '#eafaf1' : '#f5f5f5',
              color: closedCorners > 0 ? '#27ae60' : '#aaa',
            }}>
              ✓ {closedCorners} closed
            </span>
            {openCorners > 0 && (
              <span style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                background: '#fff5f5', color: '#e74c3c',
              }}>
                ! {openCorners} open
              </span>
            )}
          </div>

          {/* Helpful message */}
          {openCorners > 0 && (
            <div style={{ fontSize: 11, color: '#e74c3c', background: '#fff5f5',
              border: '1px solid #fcc', borderRadius: 4, padding: '6px 8px', lineHeight: 1.5 }}>
              <strong>Red corners</strong> need one more wall.<br/>
              Select the missing wall(s) to close the loop.
            </div>
          )}
          {isClosed && (
            <div style={{ fontSize: 11, color: '#27ae60', background: '#eafaf1',
              border: '1px solid #a9dfbf', borderRadius: 4, padding: '6px 8px' }}>
              ✓ All corners connected — ready to save!
            </div>
          )}
        </div>
      )}

      {/* Name + save */}
      <input type="text" placeholder="Room name" value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleSave()}
        style={{ padding: '5px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: 13 }}
      />

      <button onClick={handleSave}
        disabled={!name.trim() || !isClosed}
        style={{
          padding: '6px 0', background: '#27ae60', color: '#fff',
          border: 'none', borderRadius: 4, fontWeight: 600, fontSize: 13,
          cursor: name.trim() && isClosed ? 'pointer' : 'not-allowed',
          opacity: name.trim() && isClosed ? 1 : 0.4,
        }}>
        Save Room
      </button>

      {/* Saved rooms list */}
      {roomList.length > 0 && (
        <div style={{ borderTop: '1px solid #eee', paddingTop: 8 }}>
          <div style={{ fontSize: 11, color: '#999', marginBottom: 6, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Saved rooms
          </div>
          {roomList.map(room => {
            const valid = isRoomValid(room.id)
            const area  = valid ? fmtArea(getRoomArea(room.id)) : null
            return (
              <div key={room.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '4px 0', borderBottom: '1px solid #f5f5f5',
              }}>
                <div>
                  <span style={{ fontSize: 12, color: valid ? '#27ae60' : '#e74c3c', fontWeight: 600 }}>
                    {room.name}
                  </span>
                  {area && <span style={{ fontSize: 11, color: '#999', marginLeft: 6 }}>{area}</span>}
                  {!valid && <span style={{ fontSize: 10, color: '#e74c3c', marginLeft: 4 }}>⚠ invalid</span>}
                </div>
                <button onClick={() => deleteRoom(room.id)}
                  style={{ background: 'none', border: 'none', color: '#e74c3c',
                    cursor: 'pointer', fontSize: 14, fontWeight: 700, padding: '0 4px' }}>
                  ×
                </button>
              </div>
            )
          })}
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 6 }}>
            Switch to Select → click room to view details
          </div>
        </div>
      )}
    </div>
  )
}
