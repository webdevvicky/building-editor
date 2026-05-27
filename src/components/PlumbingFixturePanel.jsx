// PlumbingFixturePanel — selection-driven side panel for plumbing fixtures.
//
// Mounted in App.jsx. Self-gates on selectedPlumbingFixtureId.
// Provides: type change, room/wall readout, delete (with undo toast),
// and "Apply IS-2065 plumbing defaults to room" when the fixture is in a room.
//
// Suggestions live in src/mep/plumbing/suggestions.js (sibling engines subagent);
// this panel imports defensively so it doesn't break if that module isn't
// wired yet — the Apply button hides until the suggestion function exists.

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useUnits } from '../hooks/useUnits'
import { listFixtureTypes, getFixtureType } from '../mep/catalogs/index.js'
import { resolveFixtureFlowLpm, humanizeMepSource } from '../mep/resolution.js'
import { dialog } from './ui/Dialog'
import { toast } from './ui/Toast'
import SelectionPanel from './ui/SelectionPanel'
import { Button } from './ui/Button'
import { Field } from './ui/Field'

// The plumbing suggestions module is owned by the engines subagent and may
// not exist yet. Probe at mount time and gate the "Apply defaults" UI on it.
function useSuggestFn() {
  const [fn, setFn] = useState(null)
  useEffect(() => {
    let alive = true
    import('../mep/plumbing/suggestions.js')
      .then(mod => { if (alive) setFn(() => mod.suggestPlumbingFixturesForRoom ?? null) })
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

export default function PlumbingFixturePanel() {
  const { fmtCoord } = useUnits()
  const selectedPlumbingFixtureId = useStore(s => s.selectedPlumbingFixtureId)
  const plumbingFixtures          = useStore(s => s.plumbingFixtures)
  const rooms                     = useStore(s => s.rooms)
  const walls                     = useStore(s => s.walls)
  const updatePlumbingFixture     = useStore(s => s.updatePlumbingFixture)
  const deletePlumbingFixture     = useStore(s => s.deletePlumbingFixture)
  const selectPlumbingFixture     = useStore(s => s.selectPlumbingFixture)
  const applyRoomMepDefaults      = useStore(s => s.applyRoomMepDefaults)
  const undo                      = useStore(s => s.undo)
  const suggestFn                 = useSuggestFn()

  if (!selectedPlumbingFixtureId) return null
  const fixture = plumbingFixtures[selectedPlumbingFixtureId]
  if (!fixture) return null

  const catalog = getFixtureType(fixture.type)
  const allTypes = listFixtureTypes()
  const room = fixture.roomId ? rooms[fixture.roomId] : null
  const wall = fixture.wallId ? walls[fixture.wallId] : null

  async function handleDelete() {
    const fxLabel = catalog?.label ?? fixture.type
    const ok = await dialog.confirm(`Delete this ${fxLabel}?`, {
      title: 'Delete fixture',
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    deletePlumbingFixture(fixture.id)
    toast.action(`Deleted ${fxLabel}.`, {
      label: 'Undo',
      onClick: () => undo(),
      duration: 5000,
    })
  }

  async function handleApplyDefaults() {
    if (!fixture.roomId || !suggestFn) return
    const state = useStore.getState()
    const suggestions = suggestFn(state, fixture.roomId) ?? []
    if (!suggestions.length) {
      await dialog.alert('No plumbing defaults defined for this room type.', {
        title: 'No defaults',
      })
      return
    }
    const ok = await dialog.confirm(
      `Place ${suggestions.length} default fixture${suggestions.length === 1 ? '' : 's'} in "${room?.name ?? 'this room'}"?`,
      {
        title: 'Apply plumbing defaults',
        confirmLabel: 'Apply',
      },
    )
    if (!ok) return
    applyRoomMepDefaults(fixture.roomId, { plumbing: suggestions })
    toast.success(`Applied ${suggestions.length} default fixtures.`)
  }

  return (
    <SelectionPanel
      title="Plumbing fixture"
      onClose={() => selectPlumbingFixture(null)}
      width={260}
    >
      <div style={{ marginBottom: 'var(--space-2)' }}>
        <Button variant="danger" size="sm" onClick={handleDelete}>
          Delete
        </Button>
      </div>

      <Field label="Type">
        <select
          value={fixture.type}
          onChange={e => updatePlumbingFixture(fixture.id, { type: e.target.value })}
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
                Snapped (t={Number(fixture.wallT ?? 0).toFixed(2)})
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
          {fmtCoord(fixture.x / 12, fixture.y / 12)}
        </div>
      </div>

      {/* Phase 4 Tier-2 Item 26 + ADD 2: per-instance flow override.
          Resolved via src/mep/resolution.js — UI never inlines the
          INSTANCE → CATALOG fallback chain. */}
      {(() => {
        const resolved = resolveFixtureFlowLpm(fixture, catalog)
        return (
          <Field label={`Flow (L/min) — ${humanizeMepSource(resolved.source)}`}>
            <input
              type="number"
              min={0}
              step={0.5}
              value={fixture.flowLpmOverride ?? ''}
              placeholder={String(catalog?.flowLpm ?? 0)}
              onChange={e => {
                const v = e.target.value
                updatePlumbingFixture(fixture.id, {
                  flowLpmOverride: v === '' ? null : Number(v),
                })
              }}
              onKeyDown={e => e.stopPropagation()}
            />
          </Field>
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
          <div>Water inlet: <strong>{catalog.hasWaterInlet ? 'yes' : 'no'}</strong></div>
          <div>Drain outlet: <strong>{catalog.hasDrainOutlet ? 'yes' : 'no'}</strong></div>
          <div>Hot inlet: <strong>{catalog.hasHotWaterInlet ? 'yes' : 'no'}</strong></div>
          {catalog.fixtureUnits != null && (
            <div>Fixture units: <strong>{catalog.fixtureUnits}</strong></div>
          )}
        </div>
      )}

      {fixture.roomId && suggestFn && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleApplyDefaults}
            title="Place IS-2065 plumbing defaults into this room"
          >
            Apply IS-2065 defaults to room
          </Button>
        </div>
      )}
    </SelectionPanel>
  )
}
