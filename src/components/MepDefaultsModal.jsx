// MepDefaultsModal — appears after a room is saved and offers to apply
// IS-2065 plumbing defaults (electrical/HVAC/etc. wire in later phases).
//
// Listens for the `mep:room-created` window event dispatched from RoomPanel
// after a successful saveRoom(). The event detail carries `{ roomId }`.
//
// Suggestions module is owned by the engines subagent; we probe it
// dynamically and only render the modal when it exists AND returns at least
// one default for the room's type.

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { dialog } from './ui/Dialog'
import { toast } from './ui/Toast'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { getFixtureType } from '../mep/catalogs/index.js'

function useSuggestFn() {
  const [fn, setFn] = useState(null)
  useEffect(() => {
    let alive = true
    import('../mep/plumbing/suggestions.js')
      .then(mod => { if (alive) setFn(() => mod.suggestPlumbingFixturesForRoom ?? null) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  return fn
}

export default function MepDefaultsModal() {
  const applyRoomMepDefaults = useStore(s => s.applyRoomMepDefaults)
  const suggestFn = useSuggestFn()

  // Pending offer state. `null` = no offer open. `{ roomId, suggestions, selected }`
  // = a modal is being shown for the room.
  const [pending, setPending] = useState(null)

  // Keep the latest suggestion-fn ref so the event listener (mounted once)
  // can call into it without re-binding on every render.
  useEffect(() => {
    function handler(ev) {
      const roomId = ev?.detail?.roomId
      if (!roomId || !suggestFn) return
      const state = useStore.getState()
      const room = state.rooms?.[roomId]
      if (!room) return
      const suggestions = suggestFn(state, roomId) ?? []
      if (!suggestions.length) return
      setPending({
        roomId,
        roomName: room.name,
        suggestions,
        selected: suggestions.map(() => true),
      })
    }
    window.addEventListener('mep:room-created', handler)
    return () => window.removeEventListener('mep:room-created', handler)
  }, [suggestFn])

  if (!pending) return null

  function close() { setPending(null) }

  function toggle(i) {
    setPending(p => {
      if (!p) return p
      const next = [...p.selected]
      next[i] = !next[i]
      return { ...p, selected: next }
    })
  }

  async function apply() {
    const chosen = pending.suggestions.filter((_, i) => pending.selected[i])
    if (!chosen.length) {
      await dialog.alert('Select at least one fixture to apply, or skip.', {
        title: 'Nothing selected',
      })
      return
    }
    applyRoomMepDefaults(pending.roomId, { plumbing: chosen })
    toast.success(`Placed ${chosen.length} plumbing default${chosen.length === 1 ? '' : 's'}.`)
    setPending(null)
  }

  return (
    <Modal
      open={!!pending}
      onClose={close}
      title={`Apply plumbing defaults to "${pending.roomName}"?`}
      width={460}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={close}>
            Skip
          </Button>
          <Button variant="primary" size="sm" onClick={apply}>
            Apply selected
          </Button>
        </>
      }
    >
      <div style={{
        fontSize: 'var(--text-sm)',
        color: 'var(--color-text-secondary)',
        marginBottom: 'var(--space-3)',
        lineHeight: 1.5,
      }}>
        IS-2065 / NBC 2016 suggests the following fixtures for this room type.
        Uncheck any you don&apos;t want, then Apply.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {pending.suggestions.map((sug, i) => {
          const catalog = getFixtureType(sug.type)
          return (
            <label
              key={`${sug.type}-${i}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-2)',
                background: 'var(--color-bg-muted)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                fontSize: 'var(--text-sm)',
              }}
            >
              <input
                type="checkbox"
                checked={pending.selected[i]}
                onChange={() => toggle(i)}
                style={{ cursor: 'pointer', accentColor: 'var(--color-primary)' }}
              />
              <span style={{
                fontWeight: 'var(--weight-medium)',
                color: 'var(--color-text)',
              }}>
                {catalog?.label ?? sug.type}
              </span>
              {catalog?.fixtureUnits != null && (
                <span style={{
                  marginLeft: 'auto',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-muted)',
                }}>
                  {catalog.fixtureUnits} FU
                </span>
              )}
            </label>
          )
        })}
      </div>
    </Modal>
  )
}
