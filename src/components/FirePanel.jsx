// FirePanel — selection-driven side panel for fire-protection devices.
//
// Mirrors HvacPanel.jsx exactly — same shape, same UX, same imperative
// dialog/toast contract. Mounted in App.jsx; self-gates on
// selectedFireDeviceId.
//
// Fire suggestions live in src/mep/fire/suggestions.js (engines subagent,
// parallel work); we probe dynamically so the panel works without the
// module and the Apply UI hides until it lands.

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useUnits } from '../hooks/useUnits'
import { listFireDevices, getFireDevice } from '../mep/catalogs/index.js'
import { dialog } from './ui/Dialog'
import { toast } from './ui/Toast'
import SelectionPanel from './ui/SelectionPanel'
import { Button } from './ui/Button'
import { Field } from './ui/Field'

function useSuggestFn() {
  const [fn, setFn] = useState(null)
  useEffect(() => {
    let alive = true
    import('../mep/fire/suggestions.js')
      .then(mod => { if (alive) setFn(() => mod.suggestFireDevicesForRoom ?? null) })
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

export default function FirePanel() {
  const { fmtCoord } = useUnits()
  const selectedFireDeviceId = useStore(s => s.selectedFireDeviceId)
  const fireDevices          = useStore(s => s.fireDevices)
  const rooms                = useStore(s => s.rooms)
  const walls                = useStore(s => s.walls)
  const updateFireDevice     = useStore(s => s.updateFireDevice)
  const deleteFireDevice     = useStore(s => s.deleteFireDevice)
  const selectFireDevice     = useStore(s => s.selectFireDevice)
  const applyRoomMepDefaults = useStore(s => s.applyRoomMepDefaults)
  const undo                 = useStore(s => s.undo)
  const suggestFn            = useSuggestFn()

  if (!selectedFireDeviceId) return null
  const device = fireDevices[selectedFireDeviceId]
  if (!device) return null

  const catalog  = getFireDevice(device.type)
  const allTypes = listFireDevices()
  const room = device.roomId ? rooms[device.roomId] : null
  const wall = device.wallId ? walls[device.wallId] : null

  async function handleDelete() {
    const label = catalog?.label ?? device.type
    const ok = await dialog.confirm(`Delete this ${label}?`, {
      title: 'Delete fire device',
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    deleteFireDevice(device.id)
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
      await dialog.alert('No fire defaults defined for this room type.', {
        title: 'No defaults',
      })
      return
    }
    const ok = await dialog.confirm(
      `Place ${suggestions.length} default device${suggestions.length === 1 ? '' : 's'} in "${room?.name ?? 'this room'}"?`,
      {
        title: 'Apply fire defaults',
        confirmLabel: 'Apply',
      },
    )
    if (!ok) return
    applyRoomMepDefaults(device.roomId, { fire: suggestions })
    toast.success(`Applied ${suggestions.length} default device${suggestions.length === 1 ? '' : 's'}.`)
  }

  return (
    <SelectionPanel
      title="Fire device"
      onClose={() => selectFireDevice(null)}
      width={260}
    >
      <div style={{ marginBottom: 'var(--space-2)' }}>
        <Button variant="danger" size="sm" onClick={handleDelete}>
          Delete
        </Button>
      </div>

      <Field label="Type">
        <select
          value={device.type}
          onChange={e => updateFireDevice(device.id, { type: e.target.value })}
          onKeyDown={e => e.stopPropagation()}
        >
          {allTypes.map(t => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
      </Field>

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
          {catalog.coverageAreaFt2 > 0 && (
            <div>Coverage area: <strong>{catalog.coverageAreaFt2} ft²</strong></div>
          )}
          {catalog.mountHeightFt != null && (
            <div>Mount height: <strong>{catalog.mountHeightFt} ft</strong></div>
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
            title="Place NBC 2016 fire defaults into this room"
          >
            Apply fire defaults to room
          </Button>
        </div>
      )}
    </SelectionPanel>
  )
}
