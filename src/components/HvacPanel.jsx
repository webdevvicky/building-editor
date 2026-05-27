// HvacPanel — selection-driven side panel for HVAC units.
//
// Mounted in App.jsx. Self-gates on selectedHvacUnitId.
// Mirrors ElectricalPointPanel.jsx exactly — same shape, same UX, same
// imperative dialog/toast contract.
//
// Suggestions live in src/mep/hvac/suggestions.js (engines subagent, parallel
// work); we probe dynamically so the panel works without it and the Apply UI
// hides until the suggestion module exists.

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useUnits } from '../hooks/useUnits'
import { listHvacUnits, getHvacUnit } from '../mep/catalogs/index.js'
import { resolveRefrigerantPipeOD, humanizeMepSource } from '../mep/resolution.js'
import { dialog } from './ui/Dialog'
import { toast } from './ui/Toast'
import SelectionPanel from './ui/SelectionPanel'
import { Button } from './ui/Button'
import { Field } from './ui/Field'

// The hvac suggestions module is owned by the engines subagent and may not
// exist yet. Probe at mount time and gate the "Apply defaults" UI on it.
function useSuggestFn() {
  const [fn, setFn] = useState(null)
  useEffect(() => {
    let alive = true
    import('../mep/hvac/suggestions.js')
      .then(mod => { if (alive) setFn(() => mod.suggestHvacUnitsForRoom ?? null) })
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

function isIndoorUnit(type) {
  return type === 'AC_INDOOR_UNIT' || type === 'DUCTED_AC_INDOOR'
}
function isOutdoorUnit(type) {
  return type === 'AC_OUTDOOR_UNIT' || type === 'DUCTED_AC_OUTDOOR'
}

export default function HvacPanel() {
  const { fmtCoord } = useUnits()
  const selectedHvacUnitId = useStore(s => s.selectedHvacUnitId)
  const hvacUnits          = useStore(s => s.hvacUnits)
  const rooms              = useStore(s => s.rooms)
  const walls              = useStore(s => s.walls)
  const updateHvacUnit     = useStore(s => s.updateHvacUnit)
  const deleteHvacUnit     = useStore(s => s.deleteHvacUnit)
  const selectHvacUnit     = useStore(s => s.selectHvacUnit)
  const applyRoomMepDefaults = useStore(s => s.applyRoomMepDefaults)
  const setHvacPairing     = useStore(s => s.setHvacPairing)
  const undo               = useStore(s => s.undo)
  const suggestFn          = useSuggestFn()

  if (!selectedHvacUnitId) return null
  const unit = hvacUnits[selectedHvacUnitId]
  if (!unit) return null

  const catalog = getHvacUnit(unit.type)
  const allTypes = listHvacUnits()
  const room = unit.roomId ? rooms[unit.roomId] : null
  const wall = unit.wallId ? walls[unit.wallId] : null

  const effectiveCapacity = unit.capacityTons ?? catalog?.capacityTons ?? 0

  // Paired-unit lookup
  const pairedOutdoor = unit.pairedOutdoorId ? hvacUnits[unit.pairedOutdoorId] : null
  const pairedIndoor  = unit.pairedIndoorId  ? hvacUnits[unit.pairedIndoorId]  : null
  const indoor = isIndoorUnit(unit.type)
  const outdoor = isOutdoorUnit(unit.type)

  async function handleDelete() {
    const uLabel = catalog?.label ?? unit.type
    const ok = await dialog.confirm(`Delete this ${uLabel}?`, {
      title: 'Delete HVAC unit',
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    deleteHvacUnit(unit.id)
    toast.action(`Deleted ${uLabel}.`, {
      label: 'Undo',
      onClick: () => undo(),
      duration: 5000,
    })
  }

  async function handleApplyDefaults() {
    if (!unit.roomId || !suggestFn) return
    const state = useStore.getState()
    const suggestions = suggestFn(state, unit.roomId) ?? []
    if (!suggestions.length) {
      await dialog.alert('No HVAC defaults defined for this room type.', {
        title: 'No defaults',
      })
      return
    }
    const ok = await dialog.confirm(
      `Place ${suggestions.length} default unit${suggestions.length === 1 ? '' : 's'} in "${room?.name ?? 'this room'}"?`,
      {
        title: 'Apply HVAC defaults',
        confirmLabel: 'Apply',
      },
    )
    if (!ok) return
    applyRoomMepDefaults(unit.roomId, { hvac: suggestions })
    toast.success(`Applied ${suggestions.length} default unit${suggestions.length === 1 ? '' : 's'}.`)
  }

  // Phase 1 placeholder — find the nearest outdoor unit that sits on an
  // external wall and link them. The real auto-pair engine ships with the
  // hvac engines subagent.
  async function handleAutoPair() {
    const state = useStore.getState()
    const candidates = Object.values(state.hvacUnits).filter(u =>
      isOutdoorUnit(u.type) && u.floorId === unit.floorId && u.id !== unit.id,
    )
    if (!candidates.length) {
      await dialog.alert('No outdoor units on this floor to pair with.', {
        title: 'No outdoor units',
      })
      return
    }
    // External-wall preference: outdoor units snapped to a wall flagged as
    // external (or any wall if external info isn't available) win.
    const externalIds = typeof state.getExternalWallIds === 'function'
      ? state.getExternalWallIds()
      : null
    const scoreFor = (u) => {
      const d = Math.hypot(u.x - unit.x, u.y - unit.y)
      const externalBonus = externalIds && u.wallId && externalIds.has?.(u.wallId) ? -10000 : 0
      return d + externalBonus
    }
    const best = candidates.slice().sort((a, b) => scoreFor(a) - scoreFor(b))[0]
    // Phase 4 Tier-2 Item 24: route through setHvacPairing with 'AUTO'
    // source so the badge correctly distinguishes auto-paired from manual.
    setHvacPairing(unit.id, best.id, 'AUTO')
    toast.success(`Paired with ${getHvacUnit(best.type)?.label ?? best.type}.`)
  }

  return (
    <SelectionPanel
      title="HVAC unit"
      onClose={() => selectHvacUnit(null)}
      width={260}
    >
      <div style={{ marginBottom: 'var(--space-2)' }}>
        <Button variant="danger" size="sm" onClick={handleDelete}>
          Delete
        </Button>
      </div>

      <Field label="Type">
        <select
          value={unit.type}
          onChange={e => updateHvacUnit(unit.id, { type: e.target.value })}
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
                Snapped (t={Number(unit.wallT ?? 0).toFixed(2)})
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
          {fmtCoord(unit.x / 12, unit.y / 12)}
        </div>
      </div>

      {/* Phase 4 Tier-2 Item 26 + ADD 2: per-instance refrigerant OD
          override. Inches. Resolution flows through src/mep/resolution.js. */}
      {(() => {
        const resolved = resolveRefrigerantPipeOD(unit, catalog)
        return (
          <Field label={`Refrigerant OD (in) — ${humanizeMepSource(resolved.source)}`}>
            <input
              type="number"
              min={0}
              step={0.125}
              value={unit.refrigerantPipeOdInOverride ?? ''}
              placeholder={String(catalog?.refrigerantPipeOdIn ?? 0)}
              onChange={e => {
                const v = e.target.value
                updateHvacUnit(unit.id, {
                  refrigerantPipeOdInOverride: v === '' ? null : Number(v),
                })
              }}
              onKeyDown={e => e.stopPropagation()}
            />
          </Field>
        )
      })()}

      <Field label="Capacity (tons)">
        <input
          type="number"
          min={0}
          step={0.5}
          value={unit.capacityTons ?? ''}
          placeholder={String(catalog?.capacityTons ?? 0)}
          onChange={e => {
            const v = e.target.value
            updateHvacUnit(unit.id, { capacityTons: v === '' ? null : Number(v) })
          }}
          onKeyDown={e => e.stopPropagation()}
        />
      </Field>

      {(indoor || outdoor) && (() => {
        // Phase 4 Tier-2 Item 24: manual pairing picker + AUTO/MANUAL badge.
        // Candidates = all units of the opposite side on the same floor,
        // excluding self. Auto-pair button stays available as a shortcut
        // when no partner is set.
        const wantOutdoor = indoor
        const candidates = Object.values(hvacUnits).filter(u => {
          if (u.id === unit.id) return false
          if (u.floorId !== unit.floorId) return false
          return wantOutdoor
            ? (u.type === 'AC_OUTDOOR_UNIT' || u.type === 'DUCTED_AC_OUTDOOR')
            : (u.type === 'AC_INDOOR_UNIT'  || u.type === 'DUCTED_AC_INDOOR')
        })
        const partner = indoor ? pairedOutdoor : pairedIndoor
        const sideLabel = wantOutdoor ? 'outdoor' : 'indoor'
        const source = unit.pairingSource ?? null
        return (
          <>
            <Field label={`Paired ${sideLabel} unit`}>
              <select
                value={partner ? partner.id : ''}
                onChange={e => setHvacPairing(unit.id, e.target.value || null, 'MANUAL')}
                onKeyDown={e => e.stopPropagation()}
              >
                <option value="">— Unpaired —</option>
                {candidates.map(c => {
                  const cCatalog = getHvacUnit(c.type)
                  return (
                    <option key={c.id} value={c.id}>
                      {(cCatalog?.label ?? c.type)} ({Math.round(c.x / 12)}', {Math.round(c.y / 12)}')
                    </option>
                  )
                })}
              </select>
            </Field>
            {partner && source && (
              <div style={fieldRow}>
                <span style={{
                  fontSize: 'var(--text-xs)',
                  padding: '2px var(--space-2)',
                  borderRadius: 'var(--radius-sm)',
                  background: source === 'MANUAL'
                    ? 'var(--color-warning-bg)'
                    : 'var(--color-success-bg)',
                  color: source === 'MANUAL'
                    ? 'var(--color-warning)'
                    : 'var(--color-success)',
                }}>
                  {source}
                </span>
                {source === 'MANUAL' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setHvacPairing(unit.id, null, 'AUTO')}
                    title="Clear pairing — auto-pair engine can re-link"
                  >
                    Clear
                  </Button>
                )}
              </div>
            )}
            {indoor && !pairedOutdoor && candidates.length > 0 && (
              <div style={{ marginTop: 'var(--space-2)' }}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleAutoPair}
                  title="Pick nearest outdoor unit automatically"
                >
                  Auto-pair with nearest outdoor unit
                </Button>
              </div>
            )}
          </>
        )
      })()}

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
          <div>Default capacity: <strong>{effectiveCapacity} TR</strong></div>
          {catalog.refrigerantPipeOdIn && (
            <div>Refrigerant OD: <strong>{catalog.refrigerantPipeOdIn}"</strong></div>
          )}
          {catalog.condensateDiameterMm && (
            <div>Condensate: <strong>{catalog.condensateDiameterMm} mm</strong></div>
          )}
          <div>Default load: <strong>{catalog.defaultLoadW} W</strong></div>
        </div>
      )}

      {unit.roomId && suggestFn && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleApplyDefaults}
            title="Place ISHRAE / NBC HVAC defaults into this room"
          >
            Apply HVAC defaults to room
          </Button>
        </div>
      )}
    </SelectionPanel>
  )
}
