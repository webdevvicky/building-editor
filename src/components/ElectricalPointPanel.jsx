// ElectricalPointPanel — selection-driven side panel for electrical points.
//
// Mounted in App.jsx. Self-gates on selectedElectricalPointId.
// Mirrors PlumbingFixturePanel.jsx exactly — same shape, same UX, same
// imperative dialog/toast contract.
//
// Suggestions live in src/mep/electrical/suggestions.js (sibling engines
// subagent, parallel work); we probe dynamically so the panel works
// without it and the Apply UI hides until the suggestion module exists.

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useUnits } from '../hooks/useUnits'
import { listPointTypes, getPointType } from '../mep/catalogs/index.js'
import { resolveWireGauge, humanizeMepSource } from '../mep/resolution.js'
import { dialog } from './ui/Dialog'
import { toast } from './ui/Toast'
import SelectionPanel from './ui/SelectionPanel'
import { Button } from './ui/Button'
import { Field } from './ui/Field'

// The electrical suggestions module is owned by the engines subagent and
// may not exist yet. Probe at mount time and gate the "Apply defaults"
// UI on it.
function useSuggestFn() {
  const [fn, setFn] = useState(null)
  useEffect(() => {
    let alive = true
    import('../mep/electrical/suggestions.js')
      .then(mod => { if (alive) setFn(() => mod.suggestElectricalPointsForRoom ?? null) })
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

export default function ElectricalPointPanel() {
  const { fmtCoord } = useUnits()
  const selectedElectricalPointId = useStore(s => s.selectedElectricalPointId)
  const electricalPoints          = useStore(s => s.electricalPoints)
  const rooms                     = useStore(s => s.rooms)
  const walls                     = useStore(s => s.walls)
  const updateElectricalPoint     = useStore(s => s.updateElectricalPoint)
  const deleteElectricalPoint     = useStore(s => s.deleteElectricalPoint)
  const selectElectricalPoint     = useStore(s => s.selectElectricalPoint)
  const applyRoomMepDefaults      = useStore(s => s.applyRoomMepDefaults)
  const undo                      = useStore(s => s.undo)
  const setSelection              = useStore(s => s.setSelection)
  const highlightedCircuitId      = useStore(s => s.selection?.electricalCircuitId ?? null)
  const suggestFn                 = useSuggestFn()

  if (!selectedElectricalPointId) return null
  const point = electricalPoints[selectedElectricalPointId]
  if (!point) return null

  const catalog = getPointType(point.type)
  const allTypes = listPointTypes()
  const room = point.roomId ? rooms[point.roomId] : null
  const wall = point.wallId ? walls[point.wallId] : null

  const effectiveLoadW       = point.loadW       ?? catalog?.defaultLoadW   ?? 0
  const effectiveMountHeight = point.mountHeightFt ?? catalog?.mountHeightFt ?? 0

  async function handleDelete() {
    const ptLabel = catalog?.label ?? point.type
    const ok = await dialog.confirm(`Delete this ${ptLabel}?`, {
      title: 'Delete point',
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    deleteElectricalPoint(point.id)
    toast.action(`Deleted ${ptLabel}.`, {
      label: 'Undo',
      onClick: () => undo(),
      duration: 5000,
    })
  }

  async function handleApplyDefaults() {
    if (!point.roomId || !suggestFn) return
    const state = useStore.getState()
    const suggestions = suggestFn(state, point.roomId) ?? []
    if (!suggestions.length) {
      await dialog.alert('No electrical defaults defined for this room type.', {
        title: 'No defaults',
      })
      return
    }
    const ok = await dialog.confirm(
      `Place ${suggestions.length} default point${suggestions.length === 1 ? '' : 's'} in "${room?.name ?? 'this room'}"?`,
      {
        title: 'Apply electrical defaults',
        confirmLabel: 'Apply',
      },
    )
    if (!ok) return
    applyRoomMepDefaults(point.roomId, { electrical: suggestions })
    toast.success(`Applied ${suggestions.length} default points.`)
  }

  return (
    <SelectionPanel
      title="Electrical point"
      onClose={() => selectElectricalPoint(null)}
      width={260}
    >
      <div style={{ marginBottom: 'var(--space-2)' }}>
        <Button variant="danger" size="sm" onClick={handleDelete}>
          Delete
        </Button>
      </div>

      <Field label="Type">
        <select
          value={point.type}
          onChange={e => updateElectricalPoint(point.id, { type: e.target.value })}
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
                Snapped (t={Number(point.wallT ?? 0).toFixed(2)})
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
          {fmtCoord(point.x / 12, point.y / 12)}
        </div>
      </div>

      <Field label="Load (W)">
        <input
          type="number"
          min={0}
          step={10}
          value={point.loadW ?? ''}
          placeholder={String(catalog?.defaultLoadW ?? 0)}
          onChange={e => {
            const v = e.target.value
            updateElectricalPoint(point.id, { loadW: v === '' ? null : Number(v) })
          }}
          onKeyDown={e => e.stopPropagation()}
        />
      </Field>

      {/* Phase 4 Tier-2 Item 26 + ADD 2: per-instance wire-gauge override.
          Resolution flows through src/mep/resolution.js — sizing engines
          and panels share the same INSTANCE → CATALOG chain. */}
      {(() => {
        const resolved = resolveWireGauge(point, catalog)
        return (
          <Field label={`Wire gauge (mm²) — ${humanizeMepSource(resolved.source)}`}>
            <input
              type="number"
              min={0}
              step={0.5}
              value={point.wireGaugeMm2Override ?? ''}
              placeholder={String(catalog?.wireGaugeMm2 ?? 0)}
              onChange={e => {
                const v = e.target.value
                updateElectricalPoint(point.id, {
                  wireGaugeMm2Override: v === '' ? null : Number(v),
                })
              }}
              onKeyDown={e => e.stopPropagation()}
            />
          </Field>
        )
      })()}

      <Field label="Mount height (ft)">
        <input
          type="number"
          min={0}
          step={0.5}
          value={point.mountHeightFt ?? ''}
          placeholder={String(catalog?.mountHeightFt ?? 0)}
          onChange={e => {
            const v = e.target.value
            updateElectricalPoint(point.id, { mountHeightFt: v === '' ? null : Number(v) })
          }}
          onKeyDown={e => e.stopPropagation()}
        />
      </Field>

      <div style={fieldRow}>
        <div style={labelStyle}>Circuit</div>
        <div style={{ fontSize: 'var(--text-sm)' }}>
          {point.circuitId ? (
            (() => {
              const active = highlightedCircuitId === point.circuitId
              return (
                <button
                  type="button"
                  onClick={() => setSelection({ electricalCircuitId: active ? null : point.circuitId })}
                  title={active
                    ? 'Click to clear circuit highlight'
                    : 'Click to highlight every point + wire on this circuit'}
                  style={{
                    fontSize: 'var(--text-xs)',
                    padding: '2px var(--space-2)',
                    borderRadius: 'var(--radius-sm)',
                    background: active ? 'var(--color-primary)' : 'var(--color-primary-bg)',
                    color: active ? 'var(--color-primary-text)' : 'var(--color-primary)',
                    border: '1px solid transparent',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {point.circuitId}{active ? ' ✓' : ''}
                </button>
              )
            })()
          ) : (
            <span style={{ color: 'var(--color-text-muted)' }}>Unassigned</span>
          )}
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
          <div>Circuit class: <strong>{catalog.circuitClass}</strong></div>
          <div>Wire gauge: <strong>{catalog.wireGaugeMm2} mm²</strong></div>
          <div>Default load: <strong>{effectiveLoadW} W</strong></div>
          <div>Default mount: <strong>{effectiveMountHeight} ft</strong></div>
        </div>
      )}

      {point.roomId && suggestFn && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleApplyDefaults}
            title="Place IS-732 electrical defaults into this room"
          >
            Apply IS-732 defaults to room
          </Button>
        </div>
      )}
    </SelectionPanel>
  )
}
