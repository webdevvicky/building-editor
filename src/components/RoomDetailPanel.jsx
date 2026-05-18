import { useState } from 'react'
import { useStore } from '../store'
import { GRID_IN, DEFAULT_WALL_HEIGHT_IN } from '../geometry'
import { ROOM_TYPES, ROOM_TYPE_LABELS, ALL_FINISHES } from '../roomPresets'
import { PLASTER_SYSTEMS } from '../specs/plasterSystems'
import { toast } from './ui/Toast'
import { Panel } from './ui/Panel'
import { Button } from './ui/Button'
import { Field } from './ui/Field'

function Row({ label, value, sub }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-1)' }}>
      <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>{label}</span>
      <span style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-base)' }}>
        {value}
        {sub && <span style={{ color: 'var(--color-text-muted)', fontWeight: 'var(--weight-regular)', fontSize: 'var(--text-xs)', marginLeft: 'var(--space-1)' }}>{sub}</span>}
      </span>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 'var(--space-3)' }}>
      <div style={{
        fontSize: 'var(--text-xs)',
        fontWeight: 'var(--weight-bold)',
        color: 'var(--color-text-muted)',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        marginBottom: 'var(--space-2)',
      }}>{title}</div>
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
  const projectSettings = useStore(s => s.projectSettings)
  const getRoomArea    = useStore(s => s.getRoomArea)
  const isRoomValid    = useStore(s => s.isRoomValid)
  const renameRoom              = useStore(s => s.renameRoom)
  const deleteRoom              = useStore(s => s.deleteRoom)
  const selectRoom              = useStore(s => s.selectRoom)
  const undo                    = useStore(s => s.undo)
  const setRoomType             = useStore(s => s.setRoomType)
  const setRoomFinishes         = useStore(s => s.setRoomFinishes)
  const setRoomPlasterSystem    = useStore(s => s.setRoomPlasterSystem)
  const getOverlappingRoomName  = useStore(s => s.getOverlappingRoomName)

  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal]         = useState('')
  const [showWalls, setShowWalls]     = useState(false)

  if (!selectedRoomId) return null
  const room = rooms[selectedRoomId]
  if (!room) return null

  const valid               = isRoomValid(selectedRoomId)
  const hasMissingWalls     = room.wallIds.some(wid => !walls[wid])
  const overlappingRoomName = !valid && !hasMissingWalls
    ? getOverlappingRoomName(selectedRoomId)
    : null
  const floorArea           = valid ? getRoomArea(selectedRoomId) : 0

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

  const statusStyle = {
    fontSize: 'var(--text-xs)',
    marginTop: 'var(--space-1)',
    color: valid ? 'var(--color-success)' : 'var(--color-error)',
    fontWeight: 'var(--weight-semibold)',
  }

  const title = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: 0 }}>
      {editingName ? (
        <input autoFocus value={nameVal}
          onChange={e => setNameVal(e.target.value)}
          onBlur={saveName}
          onKeyDown={e => {
            e.stopPropagation()
            if (e.key === 'Enter') saveName()
            if (e.key === 'Escape') setEditingName(false)
          }}
          style={{
            width: '100%',
            fontSize: 'var(--text-md)',
            fontWeight: 'var(--weight-bold)',
            padding: '2px var(--space-1)',
            border: '1px solid var(--color-border-focus)',
            borderRadius: 'var(--radius-sm)',
            outline: 'none',
          }}
        />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span style={{
            fontWeight: 'var(--weight-bold)',
            fontSize: 'var(--text-md)',
            color: 'var(--color-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>{room.name}</span>
          <Button variant="ghost" size="sm" onClick={() => { setNameVal(room.name); setEditingName(true) }} title="Rename">
            ✏
          </Button>
        </div>
      )}
      <div style={statusStyle}>
        {valid
          ? '✓ Valid room'
          : hasMissingWalls    ? '⚠ Missing wall refs'
          : overlappingRoomName ? '⚠ Overlaps another room'
          : '⚠ Open loop'}
      </div>
    </div>
  )

  return (
    <Panel
      title={title}
      onClose={() => selectRoom(null)}
      width={260}
      position={{ top: 56, left: 16 }}
    >
      {!valid && (
        <div style={{
          background: 'var(--color-error-bg)',
          border: '1px solid var(--color-error-border)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-2) var(--space-3)',
          fontSize: 'var(--text-sm)',
          color: 'var(--color-error)',
          marginBottom: 'var(--space-3)',
        }}>
          {hasMissingWalls
            ? 'One or more wall references are missing — this room\'s geometry cannot be computed. Load a valid save to restore.'
            : overlappingRoomName
              ? `This room overlaps '${overlappingRoomName}'. Delete one of the rooms to resolve the conflict.`
              : 'Walls don\'t form a closed polygon. Add missing walls or virtual walls to complete the boundary.'}
        </div>
      )}

      {/* Room type selector */}
      <Field label="Room Type">
        <select value={room.type || 'OTHER'}
          onChange={e => setRoomType(room.id, e.target.value)}>
          {ROOM_TYPES.map(t => (
            <option key={t} value={t}>{ROOM_TYPE_LABELS[t]}</option>
          ))}
        </select>
      </Field>

      {/* Plaster system override (Phase 1.6f) */}
      <Field label="Plaster System">
        <select value={room.plasterSystemId ?? ''}
          onChange={e => setRoomPlasterSystem(room.id, e.target.value || null)}>
          <option value="">
            Use project default ({PLASTER_SYSTEMS[projectSettings?.defaultPlasterSystemId]?.label ?? '—'})
          </option>
          {Object.values(PLASTER_SYSTEMS).map(sys => (
            <option key={sys.id} value={sys.id}>{sys.label}</option>
          ))}
        </select>
      </Field>

      {/* Finish flags */}
      {(() => {
        const finishes = room.finishes ? { ...ALL_FINISHES, ...room.finishes } : { ...ALL_FINISHES }
        const FLAGS = [
          ['flooring',       'Flooring'],
          ['ceilingPlaster', 'Ceiling'],
          ['paint',          'Paint'],
          ['waterproofing',  'Waterproof'],
          ['roofing',        'Roofing'],
        ]
        return (
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <div style={{
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-bold)',
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: 0.6,
              marginBottom: 'var(--space-2)',
            }}>Finishes</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-1) var(--space-2)' }}>
              {FLAGS.map(([key, label]) => (
                <label key={key} style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                  fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', cursor: 'pointer',
                }}>
                  <input type="checkbox" checked={finishes[key]}
                    onChange={e => setRoomFinishes(room.id, { [key]: e.target.checked })}
                    style={{ cursor: 'pointer' }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        )
      })()}

      {valid && <>
        {/* Measurements */}
        <Section title="Area">
          <Row label="Floor"   value={fmtArea(floorArea)} />
          <Row label="Ceiling" value={fmtArea(ceilingArea)} />
          <Row label="Walls"   value={fmtArea(totalWallArea)}
            sub={`${realWalls.length} wall${realWalls.length !== 1 ? 's' : ''}${virtualWalls.length ? ` + ${virtualWalls.length} virtual` : ''}`} />
        </Section>

        <div style={{ borderTop: '1px solid var(--color-border)', margin: 'var(--space-2) 0' }} />

        {/* Openings */}
        <Section title="Openings">
          {doors.length === 0 && windows.length === 0 && (
            <div style={{ color: 'var(--color-text-disabled)', fontSize: 'var(--text-sm)' }}>No doors or windows</div>
          )}
          {doors.length > 0 && (
            <div style={{ marginBottom: 'var(--space-1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>Doors</span>
                <span style={{ fontWeight: 'var(--weight-semibold)' }}>{doors.length}</span>
              </div>
              {doors.map((d, i) => (
                <div key={i} style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginLeft: 'var(--space-3)', marginBottom: 1 }}>
                  • {fmtLen(Math.round(d.width/GRID_IN*10)/10)} × {fmtLen(Math.round(d.height/GRID_IN*10)/10)}
                </div>
              ))}
            </div>
          )}
          {windows.length > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>Windows</span>
                <span style={{ fontWeight: 'var(--weight-semibold)' }}>{windows.length}</span>
              </div>
              {windows.map((w, i) => (
                <div key={i} style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginLeft: 'var(--space-3)', marginBottom: 1 }}>
                  • {fmtLen(Math.round(w.width/GRID_IN*10)/10)} × {fmtLen(Math.round(w.height/GRID_IN*10)/10)}
                </div>
              ))}
            </div>
          )}
        </Section>

        <div style={{ borderTop: '1px solid var(--color-border)', margin: 'var(--space-2) 0' }} />

        {/* Materials */}
        <Section title="Materials needed">
          {(() => {
            const fin = room.finishes || {}
            return <>
              <Row label="Flooring"          value={fmtArea(fin.flooring       ? flooringArea  : 0)} />
              <Row label="Plaster (walls)"   value={fmtArea(totalWallArea)} />
              <Row label="Plaster (ceiling)" value={fmtArea(fin.ceilingPlaster ? ceilingArea   : 0)} />
              <Row label="Paint total"       value={fmtArea(fin.paint          ? paintArea     : 0)} />
              <Row label="Waterproofing"     value={fmtArea(fin.waterproofing  ? floorArea     : 0)} />
              <Row label="Roofing"           value={fmtArea(fin.roofing        ? floorArea     : 0)} />
              {doors.length > 0 && (
                <Row label="Door frames"   value={`${doors.length} unit${doors.length > 1 ? 's' : ''}`} />
              )}
              {windows.length > 0 && (
                <Row label="Window frames" value={`${windows.length} unit${windows.length > 1 ? 's' : ''}`} />
              )}
            </>
          })()}
        </Section>

        {/* Wall breakdown (collapsible) */}
        <div style={{ borderTop: '1px solid var(--color-border)', margin: 'var(--space-2) 0' }} />
        <Button variant="ghost" size="sm" onClick={() => setShowWalls(v => !v)}>
          {showWalls ? '▾' : '▸'} Wall breakdown
        </Button>
        {showWalls && (
          <div style={{ marginTop: 'var(--space-2)' }}>
            {wallDetails.map((w, i) => (
              <div key={w.id} style={{
                marginBottom: 'var(--space-2)',
                padding: 'var(--space-2)',
                background: 'var(--color-bg-muted)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--text-xs)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{
                    color: w.isVirtual ? 'var(--color-text-muted)' : 'var(--color-text)',
                    fontWeight: 'var(--weight-semibold)',
                  }}>
                    {w.isVirtual ? '┅ Virtual' : w.isPlot ? '⬛ Plot wall' : `Wall ${i + 1}`}
                  </span>
                  <span style={{ color: 'var(--color-text-secondary)' }}>{fmtLen(w.lenFt)} × h{w.hFt}ft</span>
                </div>
                {!w.isVirtual && (
                  <div style={{ color: 'var(--color-text-muted)' }}>
                    Net area: {fmtArea(w.netArea)}
                    {w.openings.length > 0 && (
                      <span style={{ marginLeft: 'var(--space-2)' }}>
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
      <div style={{
        borderTop: '1px solid var(--color-border)',
        marginTop: 'var(--space-3)',
        paddingTop: 'var(--space-3)',
      }}>
        <div style={{ width: '100%' }}>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              const roomToDelete = rooms[room.id]
              deleteRoom(room.id)
              selectRoom(null)
              toast.action(`Deleted room "${roomToDelete?.name || 'Untitled'}".`, {
                label: 'Undo', onClick: () => undo(), duration: 5000,
              })
            }}
          >
            Delete room
          </Button>
        </div>
      </div>
    </Panel>
  )
}
