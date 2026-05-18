import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { ROOM_TYPES, ROOM_TYPE_LABELS } from '../roomPresets'
import { Panel } from './ui/Panel'
import { Button } from './ui/Button'
import { Field } from './ui/Field'

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
  const setTool        = useStore(s => s.setTool)

  const [name,        setName]        = useState('')
  const [pendingType, setPendingType] = useState('OTHER')
  const [saveError,   setSaveError]   = useState(null)

  useEffect(() => { setSaveError(null) }, [pendingWallIds])

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
    const result = saveRoom(trimmed, pendingType)
    if (result?.error) {
      setSaveError(result)
    } else {
      setName('')
      setPendingType('OTHER')
      setSaveError(null)
    }
  }

  function fmtArea(sqFt) {
    if (unit === 'm') return `${Math.round(sqFt * 0.0929 * 100) / 100} m²`
    return `${sqFt} ft²`
  }

  const roomList = Object.values(rooms)

  const closedBadgeStyle = {
    fontSize: 'var(--text-xs)',
    padding: 'var(--space-1) var(--space-2)',
    borderRadius: 'var(--radius-full)',
    fontWeight: 'var(--weight-semibold)',
    background: closedCorners > 0 ? 'var(--color-success-bg)' : 'var(--color-bg-muted)',
    color: closedCorners > 0 ? 'var(--color-success)' : 'var(--color-text-muted)',
  }

  const openBadgeStyle = {
    fontSize: 'var(--text-xs)',
    padding: 'var(--space-1) var(--space-2)',
    borderRadius: 'var(--radius-full)',
    fontWeight: 'var(--weight-semibold)',
    background: 'var(--color-error-bg)',
    color: 'var(--color-error)',
  }

  return (
    <Panel
      title="Room Tool"
      onClose={() => setTool('select')}
      width={260}
      position={{ top: 56, left: 16 }}
    >
      {/* Instructions */}
      {pendingWallIds.length === 0 ? (
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          Click walls to mark a room boundary.<br/>
          All corners must be connected (green ✓).
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
            {pendingWallIds.length} wall{pendingWallIds.length > 1 ? 's' : ''} selected
          </div>

          {/* Corner status */}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <span style={closedBadgeStyle}>
              ✓ {closedCorners} closed
            </span>
            {openCorners > 0 && (
              <span style={openBadgeStyle}>
                ! {openCorners} open
              </span>
            )}
          </div>

          {/* Helpful message */}
          {openCorners > 0 && (
            <div style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-error)',
              background: 'var(--color-error-bg)',
              border: '1px solid var(--color-error-border)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-2)',
              lineHeight: 1.5,
            }}>
              <strong>Red corners</strong> need one more wall.<br/>
              Select the missing wall(s) to close the loop.
            </div>
          )}
          {isClosed && (
            <div style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-success)',
              background: 'var(--color-success-bg)',
              border: '1px solid var(--color-success-border)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-2)',
            }}>
              ✓ All corners connected — ready to save!
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
        <Field label="Type">
          <select value={pendingType} onChange={e => setPendingType(e.target.value)}>
            {ROOM_TYPES.map(t => (
              <option key={t} value={t}>{ROOM_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </Field>

        <Field label="Name">
          <input type="text" placeholder="Room name" value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
        </Field>

        <Button
          variant="primary"
          size="md"
          onClick={handleSave}
          disabled={!name.trim() || !isClosed}
        >
          Save Room
        </Button>
      </div>

      {/* Save blocked: overlap error */}
      {saveError?.error === 'overlap' && (
        <div style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-error)',
          background: 'var(--color-error-bg)',
          border: '1px solid var(--color-error-border)',
          borderRadius: 'var(--radius-sm)',
          padding: 'var(--space-2)',
          lineHeight: 1.6,
          marginTop: 'var(--space-2)',
        }}>
          <strong>Overlaps existing room '{saveError.conflictName}'.</strong><br/>
          To proceed:<br/>
          • Delete '{saveError.conflictName}' first, OR<br/>
          • Adjust this room's boundaries to not overlap
        </div>
      )}

      {/* Saved rooms list */}
      {roomList.length > 0 && (
        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
          <div style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            marginBottom: 'var(--space-2)',
            fontWeight: 'var(--weight-semibold)',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}>
            Saved rooms
          </div>
          {roomList.map(room => {
            const valid = isRoomValid(room.id)
            const area  = valid ? fmtArea(getRoomArea(room.id)) : null
            return (
              <div key={room.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: 'var(--space-1) 0',
                borderBottom: '1px solid var(--color-bg-muted)',
              }}>
                <div>
                  <span style={{
                    fontSize: 'var(--text-sm)',
                    color: valid ? 'var(--color-success)' : 'var(--color-error)',
                    fontWeight: 'var(--weight-semibold)',
                  }}>
                    {room.name}
                  </span>
                  {area && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginLeft: 'var(--space-2)' }}>{area}</span>}
                  {!valid && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)', marginLeft: 'var(--space-1)' }}>⚠ invalid</span>}
                </div>
                <Button variant="ghost" size="sm" onClick={() => deleteRoom(room.id)} title="Delete room">
                  ×
                </Button>
              </div>
            )
          })}
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
            Switch to Select → click room to view details
          </div>
        </div>
      )}
    </Panel>
  )
}
