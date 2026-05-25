// ElvPanel — selection-driven side panel for ELV (extra-low-voltage) devices.
//
// Mirrors FirePanel.jsx exactly — same shape, same UX, same imperative
// dialog/toast contract. Mounted in App.jsx; self-gates on
// selectedElvDeviceId.
//
// ELV suggestions live in src/mep/elv/suggestions.js (engines subagent,
// parallel work); we probe dynamically so the panel works without the
// module and the Apply UI hides until it lands.

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { listElvDevices, getElvDevice } from '../mep/catalogs/index.js'
import { dialog } from './ui/Dialog'
import { toast } from './ui/Toast'
import { Panel } from './ui/Panel'
import { Button } from './ui/Button'
import { Field } from './ui/Field'
import { useUnits } from '../hooks/useUnits'

// Sub-system grouping (display only — drives the badge in the panel).
// CCTV bucket covers video surveillance; DATA bucket covers structured
// cabling / wifi / TV; SECURITY covers intrusion + door-entry; AV reserved
// for future TV/AV expansion.
function deviceSubSystem(type) {
  switch (type) {
    case 'CCTV_CAMERA':       return 'CCTV'
    case 'DATA_POINT':        return 'DATA'
    case 'WIFI_AP':           return 'DATA'
    case 'TV_POINT_ELV':      return 'AV'
    case 'VIDEO_DOOR_PHONE':  return 'SECURITY'
    case 'INTERCOM':          return 'SECURITY'
    case 'ALARM_SENSOR':      return 'SECURITY'
    case 'ELV_RACK':          return 'DATA'
    default:                  return 'ELV'
  }
}

function useSuggestFn() {
  const [fn, setFn] = useState(null)
  useEffect(() => {
    let alive = true
    import('../mep/elv/suggestions.js')
      .then(mod => { if (alive) setFn(() => mod.suggestElvDevicesForRoom ?? null) })
      .catch(() => { /* engine module not built yet — Apply UI stays hidden */ })
    return () => { alive = false }
  }, [])
  return fn
}

const fieldRow = { marginTop: 'var(--space-2)' }
const labelStyle = {
  color: 'var(--color-text-muted)',
  marginBottom: 2,
  fontSize: 'var(--text-xs)',
}

export default function ElvPanel() {
  const selectedElvDeviceId  = useStore(s => s.selectedElvDeviceId)
  const elvDevices           = useStore(s => s.elvDevices)
  const rooms                = useStore(s => s.rooms)
  const walls                = useStore(s => s.walls)
  const updateElvDevice      = useStore(s => s.updateElvDevice)
  const deleteElvDevice      = useStore(s => s.deleteElvDevice)
  const selectElvDevice      = useStore(s => s.selectElvDevice)
  const applyRoomMepDefaults = useStore(s => s.applyRoomMepDefaults)
  const undo                 = useStore(s => s.undo)
  const { fmtCoord }         = useUnits()
  const suggestFn            = useSuggestFn()

  if (!selectedElvDeviceId) return null
  const device = elvDevices[selectedElvDeviceId]
  if (!device) return null

  const catalog  = getElvDevice(device.type)
  const allTypes = listElvDevices()
  const room = device.roomId ? rooms[device.roomId] : null
  const wall = device.wallId ? walls[device.wallId] : null
  const subSystem = deviceSubSystem(device.type)

  async function handleDelete() {
    const label = catalog?.label ?? device.type
    const ok = await dialog.confirm(`Delete this ${label}?`, {
      title: 'Delete ELV device',
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    deleteElvDevice(device.id)
    toast.action(`Deleted ${label}.`, {
      label: 'Undo',
      onClick: () => undo(),
      duration: 5000,
    })
  }

  async function handleApplyDefaults() {
    if (!device.roomId || !suggestFn) return
    const state = useStore.getState()
    const suggestions = suggestFn(state, device.roomId) ?? []
    if (!suggestions.length) {
      await dialog.alert('No ELV defaults defined for this room type.', {
        title: 'No defaults',
      })
      return
    }
    const ok = await dialog.confirm(
      `Place ${suggestions.length} default device${suggestions.length === 1 ? '' : 's'} in "${room?.name ?? 'this room'}"?`,
      {
        title: 'Apply ELV defaults',
        confirmLabel: 'Apply',
      },
    )
    if (!ok) return
    applyRoomMepDefaults(device.roomId, { elv: suggestions })
    toast.success(`Applied ${suggestions.length} default device${suggestions.length === 1 ? '' : 's'}.`)
  }

  return (
    <Panel
      title="ELV device"
      onClose={() => selectElvDevice(null)}
      width={260}
      position={{ top: 56, left: 16 }}
    >
      <div style={{ marginBottom: 'var(--space-2)' }}>
        <Button variant="danger" size="sm" onClick={handleDelete}>
          Delete
        </Button>
      </div>

      <Field label="Type">
        <select
          value={device.type}
          onChange={e => updateElvDevice(device.id, { type: e.target.value })}
          onKeyDown={e => e.stopPropagation()}
        >
          {allTypes.map(t => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
      </Field>

      <div style={fieldRow}>
        <div style={labelStyle}>Sub-system</div>
        <div style={{ fontSize: 'var(--text-sm)' }}>
          <span style={{
            fontSize: 'var(--text-xs)',
            padding: '2px var(--space-2)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-primary-bg)',
            color: 'var(--color-primary)',
            fontWeight: 'var(--weight-semibold)',
          }}>
            {subSystem}
          </span>
        </div>
      </div>

      <div style={fieldRow}>
        <div style={labelStyle}>Room</div>
        <div style={{ fontSize: 'var(--text-sm)' }}>
          {room ? room.name : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
        </div>
      </div>

      <div style={fieldRow}>
        <div style={labelStyle}>Wall snap</div>
        <div style={{ fontSize: 'var(--text-sm)' }}>
          {wall
            ? <span style={{
                fontSize: 'var(--text-xs)',
                padding: '2px var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-primary-bg)',
                color: 'var(--color-primary)',
              }}>
                Snapped (t={Number(device.wallT ?? 0).toFixed(2)})
              </span>
            : <span style={{
                fontSize: 'var(--text-xs)',
                padding: '2px var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-bg-muted)',
                color: 'var(--color-text-secondary)',
              }}>
                Free
              </span>}
        </div>
      </div>

      <div style={fieldRow}>
        <div style={labelStyle}>Position</div>
        <div style={{ fontSize: 'var(--text-sm)' }}>
          {fmtCoord(device.x / 12, device.y / 12)}
        </div>
      </div>

      {catalog && (
        <div style={{
          ...fieldRow,
          padding: 'var(--space-2)',
          background: 'var(--color-bg-muted)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-secondary)',
          lineHeight: 1.5,
        }}>
          {catalog.mountHeightFt != null && (
            <div>Mount height: <strong>{catalog.mountHeightFt} ft</strong></div>
          )}
          {catalog.cableTypeId && (
            <div>Cable: <strong>{catalog.cableTypeId}</strong></div>
          )}
          {catalog.classificationCode && (
            <div>Code: <strong>{catalog.classificationCode}</strong></div>
          )}
        </div>
      )}

      {device.roomId && suggestFn && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleApplyDefaults}
            title="Place ELV defaults into this room"
          >
            Apply ELV defaults to room
          </Button>
        </div>
      )}
    </Panel>
  )
}
