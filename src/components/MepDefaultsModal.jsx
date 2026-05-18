// MepDefaultsModal — appears after a room is saved and offers to apply
// IS-2065 plumbing + IS-732 electrical defaults (HVAC/fire/ELV wire in
// later phases).
//
// Listens for the `mep:room-created` window event dispatched from RoomPanel
// after a successful saveRoom(). The event detail carries `{ roomId }`.
//
// Suggestion modules are owned by the engines subagent; we probe each
// dynamically and only render a discipline group when its module exists
// AND returns at least one default for the room's type. The modal opens
// as long as any discipline has suggestions.

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { dialog } from './ui/Dialog'
import { toast } from './ui/Toast'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { getFixtureType, getPointType, getHvacUnit, getFireDevice, getElvDevice } from '../mep/catalogs/index.js'

function useSuggestFns() {
  const [fns, setFns] = useState({ plumbing: null, electrical: null, hvac: null, fire: null, elv: null })
  useEffect(() => {
    let alive = true
    Promise.allSettled([
      import('../mep/plumbing/suggestions.js'),
      import('../mep/electrical/suggestions.js'),
      import('../mep/hvac/suggestions.js'),
      import('../mep/fire/suggestions.js'),
      import('../mep/elv/suggestions.js'),
    ]).then(([p, e, h, f, l]) => {
      if (!alive) return
      setFns({
        plumbing:   p.status === 'fulfilled' ? (p.value.suggestPlumbingFixturesForRoom ?? null) : null,
        electrical: e.status === 'fulfilled' ? (e.value.suggestElectricalPointsForRoom ?? null) : null,
        hvac:       h.status === 'fulfilled' ? (h.value.suggestHvacUnitsForRoom ?? null) : null,
        fire:       f.status === 'fulfilled' ? (f.value.suggestFireDevicesForRoom ?? null) : null,
        elv:        l.status === 'fulfilled' ? (l.value.suggestElvDevicesForRoom ?? null) : null,
      })
    })
    return () => { alive = false }
  }, [])
  return fns
}

export default function MepDefaultsModal() {
  const applyRoomMepDefaults = useStore(s => s.applyRoomMepDefaults)
  const suggestFns = useSuggestFns()

  // Pending offer state. `null` = no offer open. Otherwise:
  // { roomId, roomName, plumbing: { suggestions, selected }, electrical: {...} }
  const [pending, setPending] = useState(null)

  useEffect(() => {
    function handler(ev) {
      const roomId = ev?.detail?.roomId
      if (!roomId) return
      const state = useStore.getState()
      const room = state.rooms?.[roomId]
      if (!room) return

      const plumbingSugs = suggestFns.plumbing
        ? (suggestFns.plumbing(state, roomId) ?? [])
        : []
      const electricalSugs = suggestFns.electrical
        ? (suggestFns.electrical(state, roomId) ?? [])
        : []
      const hvacSugs = suggestFns.hvac
        ? (suggestFns.hvac(state, roomId) ?? [])
        : []
      const fireSugs = suggestFns.fire
        ? (suggestFns.fire(state, roomId) ?? [])
        : []
      const elvSugs = suggestFns.elv
        ? (suggestFns.elv(state, roomId) ?? [])
        : []

      if (!plumbingSugs.length && !electricalSugs.length && !hvacSugs.length && !fireSugs.length && !elvSugs.length) return

      setPending({
        roomId,
        roomName: room.name,
        plumbing: {
          suggestions: plumbingSugs,
          selected: plumbingSugs.map(() => true),
        },
        electrical: {
          suggestions: electricalSugs,
          selected: electricalSugs.map(() => true),
        },
        hvac: {
          suggestions: hvacSugs,
          selected: hvacSugs.map(() => true),
        },
        fire: {
          suggestions: fireSugs,
          selected: fireSugs.map(() => true),
        },
        elv: {
          suggestions: elvSugs,
          selected: elvSugs.map(() => true),
        },
      })
    }
    window.addEventListener('mep:room-created', handler)
    return () => window.removeEventListener('mep:room-created', handler)
  }, [suggestFns])

  if (!pending) return null

  function close() { setPending(null) }

  function toggle(disc, i) {
    setPending(p => {
      if (!p) return p
      const group = p[disc]
      const nextSel = [...group.selected]
      nextSel[i] = !nextSel[i]
      return { ...p, [disc]: { ...group, selected: nextSel } }
    })
  }

  async function apply() {
    const chosenPlumbing   = pending.plumbing.suggestions.filter((_, i) => pending.plumbing.selected[i])
    const chosenElectrical = pending.electrical.suggestions.filter((_, i) => pending.electrical.selected[i])
    const chosenHvac       = pending.hvac.suggestions.filter((_, i) => pending.hvac.selected[i])
    const chosenFire       = pending.fire.suggestions.filter((_, i) => pending.fire.selected[i])
    const chosenElv        = pending.elv.suggestions.filter((_, i) => pending.elv.selected[i])
    const total = chosenPlumbing.length + chosenElectrical.length + chosenHvac.length + chosenFire.length + chosenElv.length
    if (!total) {
      await dialog.alert('Select at least one item to apply, or skip.', {
        title: 'Nothing selected',
      })
      return
    }
    applyRoomMepDefaults(pending.roomId, {
      plumbing: chosenPlumbing,
      electrical: chosenElectrical,
      hvac: chosenHvac,
      fire: chosenFire,
      elv: chosenElv,
    })
    const parts = []
    if (chosenPlumbing.length)   parts.push(`${chosenPlumbing.length} plumbing`)
    if (chosenElectrical.length) parts.push(`${chosenElectrical.length} electrical`)
    if (chosenHvac.length)       parts.push(`${chosenHvac.length} HVAC`)
    if (chosenFire.length)       parts.push(`${chosenFire.length} fire`)
    if (chosenElv.length)        parts.push(`${chosenElv.length} ELV`)
    toast.success(`Placed ${parts.join(' + ')} default${total === 1 ? '' : 's'}.`)
    setPending(null)
  }

  const hasPlumbing   = pending.plumbing.suggestions.length > 0
  const hasElectrical = pending.electrical.suggestions.length > 0
  const hasHvac       = pending.hvac.suggestions.length > 0
  const hasFire       = pending.fire.suggestions.length > 0
  const hasElv        = pending.elv.suggestions.length > 0

  return (
    <Modal
      open={!!pending}
      onClose={close}
      title={`Apply MEP defaults to "${pending.roomName}"?`}
      width={480}
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
        IS-2065 / IS-732 / ISHRAE / NBC 2016 suggest the following items
        for this room type. Uncheck any you don&apos;t want, then Apply.
      </div>

      {hasPlumbing && (
        <SuggestionGroup
          title="Plumbing (IS-2065)"
          suggestions={pending.plumbing.suggestions}
          selected={pending.plumbing.selected}
          onToggle={i => toggle('plumbing', i)}
          renderItem={(sug) => {
            const catalog = getFixtureType(sug.type)
            return {
              label: catalog?.label ?? sug.type,
              meta: catalog?.fixtureUnits != null ? `${catalog.fixtureUnits} FU` : null,
            }
          }}
        />
      )}

      {hasElectrical && (
        <SuggestionGroup
          title="Electrical (IS-732)"
          suggestions={pending.electrical.suggestions}
          selected={pending.electrical.selected}
          onToggle={i => toggle('electrical', i)}
          renderItem={(sug) => {
            const catalog = getPointType(sug.type)
            return {
              label: catalog?.label ?? sug.type,
              meta: catalog?.defaultLoadW != null ? `${catalog.defaultLoadW} W` : null,
            }
          }}
        />
      )}

      {hasHvac && (
        <SuggestionGroup
          title="HVAC (ISHRAE / NBC)"
          suggestions={pending.hvac.suggestions}
          selected={pending.hvac.selected}
          onToggle={i => toggle('hvac', i)}
          renderItem={(sug) => {
            const catalog = getHvacUnit(sug.type)
            return {
              label: catalog?.label ?? sug.type,
              meta: catalog?.capacityTons ? `${catalog.capacityTons} TR` : null,
            }
          }}
        />
      )}

      {hasFire && (
        <SuggestionGroup
          title="Fire (NBC 2016)"
          suggestions={pending.fire.suggestions}
          selected={pending.fire.selected}
          onToggle={i => toggle('fire', i)}
          renderItem={(sug) => {
            const catalog = getFireDevice(sug.type)
            return {
              label: catalog?.label ?? sug.type,
              meta: catalog?.coverageAreaFt2 > 0 ? `${catalog.coverageAreaFt2} ft² cov.` : null,
            }
          }}
        />
      )}

      {hasElv && (
        <SuggestionGroup
          title="ELV"
          suggestions={pending.elv.suggestions}
          selected={pending.elv.selected}
          onToggle={i => toggle('elv', i)}
          renderItem={(sug) => {
            const catalog = getElvDevice(sug.type)
            return {
              label: catalog?.label ?? sug.type,
              meta: catalog?.mountHeightFt != null ? `${catalog.mountHeightFt} ft mount` : null,
            }
          }}
        />
      )}
    </Modal>
  )
}

function SuggestionGroup({ title, suggestions, selected, onToggle, renderItem }) {
  return (
    <div style={{ marginBottom: 'var(--space-3)' }}>
      <div style={{
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        fontWeight: 'var(--weight-semibold)',
        marginBottom: 'var(--space-2)',
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {suggestions.map((sug, i) => {
          const item = renderItem(sug)
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
                checked={selected[i]}
                onChange={() => onToggle(i)}
                style={{ cursor: 'pointer', accentColor: 'var(--color-primary)' }}
              />
              <span style={{
                fontWeight: 'var(--weight-medium)',
                color: 'var(--color-text)',
              }}>
                {item.label}
              </span>
              {item.meta && (
                <span style={{
                  marginLeft: 'auto',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-muted)',
                }}>
                  {item.meta}
                </span>
              )}
            </label>
          )
        })}
      </div>
    </div>
  )
}
