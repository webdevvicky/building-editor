import { useState, useMemo } from 'react'
import { useStore } from '../store'
import { getBoqLines } from '../boq/lines.js'
import { GRID_IN, DEFAULT_WALL_HEIGHT_IN } from '../geometry'
import { getRoomGeometry, getEffectiveWallLengthFt } from '../topology/index.js'
import { ROOM_TYPES, ROOM_TYPE_LABELS, ALL_FINISHES } from '../roomPresets'
import { PLASTER_SYSTEMS } from '../specs/plasterSystems'
import { listPaintSystems } from '../specs/paintSystems.js'
import { listCeilingFinishSystems } from '../specs/ceilingFinishSystems.js'
import { toast } from './ui/Toast'
import SelectionPanel from './ui/SelectionPanel'
import { Button } from './ui/Button'
import { Field } from './ui/Field'
import FeetInchesInput from './ui/FeetInchesInput.jsx'
import { formatFeetInches, DEFAULT_PRECISION } from '../lib/units.js'
import {
  FULL_SENTINEL,
  _resolveDadoFt, _resolveDadoSource,
  _fullHeightFt, _resolveSkirtingSource,
} from '../quantities/tiles.js'

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

// Phase 4 Tier-2 Item 30 + ADD 7: room-scoped BOQ materials breakdown.
// Memoized on [roomId, boqRevision, ratesRevision] — getBoqLines() is
// expensive and these counters are the canonical invalidation signals.
// Categories included are limited to those that emit material qty (cement
// bags, paint gallons, tile counts, etc.) — pure area lines stay in the
// existing "Materials needed" section above.
const ROOM_MATERIAL_CATEGORIES = new Set([
  'masonry', 'plaster', 'paint_materials', 'ceiling_finish', 'tiles',
  'joinery', 'joinery_hardware', 'grills',
])
function RoomMaterialsBreakdown({ roomId }) {
  const boqRevision   = useStore(s => s.boqRevision ?? 0)
  const ratesRevision = useStore(s => s.ratesRevision ?? 0)
  const [open, setOpen] = useState(false)
  const lines = useMemo(() => {
    if (!roomId) return []
    const state = useStore.getState()
    const rates = state.ratesByKey ?? {}
    const all = getBoqLines(state, rates, { roomId })
    return all.filter(l => l.qty > 0 && ROOM_MATERIAL_CATEGORIES.has(l.category))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, boqRevision, ratesRevision])

  if (lines.length === 0) return null
  return (
    <div style={{ marginTop: 'var(--space-2)' }}>
      <Button variant="ghost" size="sm" onClick={() => setOpen(v => !v)}>
        {open ? '▾' : '▸'} Material quantities ({lines.length})
      </Button>
      {open && (
        <div style={{ marginTop: 'var(--space-2)' }}>
          {lines.map(l => (
            <Row
              key={`${l.id}::${l.rateKey}`}
              label={l.label}
              value={`${l.qty.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${l.unit}`}
            />
          ))}
        </div>
      )}
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
  const setRoomDado             = useStore(s => s.setRoomDado)
  const setRoomIncludeSkirting  = useStore(s => s.setRoomIncludeSkirting)
  const setRoomPaintSystem         = useStore(s => s.setRoomPaintSystem)
  const setRoomCeilingFinishSystem = useStore(s => s.setRoomCeilingFinishSystem)
  const setRoomKitchenCounter      = useStore(s => s.setRoomKitchenCounter)
  const setRoomBalconyHandrail     = useStore(s => s.setRoomBalconyHandrail)
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
  // Area 1 — dimension-mode display. dual readout shows clear-internal first
  // (engineers' tape-on-site value), centerline as the secondary reference.
  const dimensionMode  = projectSettings?.dimensionMode ?? 'centerline'
  const liveState      = useStore.getState()
  const roomGeom       = valid ? getRoomGeometry(liveState, selectedRoomId, 'clear_internal') : null
  const floorAreaClear = roomGeom?.area ?? floorArea

  // Build per-wall details. lenFt is the canvas-facing effective length
  // (matches the on-canvas label). centerlineLenFt is shown as a secondary
  // value when modes diverge.
  const wallDetails = room.wallIds.map(wid => {
    const w = walls[wid]
    if (!w) return null
    const a = nodes[w.n1], b = nodes[w.n2]
    if (!a || !b) return null
    const centerlineLenFt = Math.round(Math.hypot(b.x - a.x, b.y - a.y) / GRID_IN * 100) / 100
    const effectiveLenFt  = getEffectiveWallLengthFt(liveState, wid, dimensionMode)
    const lenFt      = effectiveLenFt
    const hFt        = Math.round((w.height ?? DEFAULT_WALL_HEIGHT_IN) / GRID_IN * 100) / 100
    const openings   = w.openings || []
    const openingArea = openings.reduce((s, o) => s + (o.width / GRID_IN) * (o.height / GRID_IN), 0)
    const netArea    = Math.round(Math.max(0, lenFt * hFt - openingArea) * 100) / 100
    return { id: wid, lenFt, centerlineLenFt, hFt, openings, netArea, isVirtual: w.isVirtual ?? false, isPlot: w.isPlot ?? false }
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
    <SelectionPanel
      title={title}
      onClose={() => selectRoom(null)}
      width={260}
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
        {/* ── Tiles & skirting overrides (2026-05-26) ─────────────── */}
        {(() => {
          const state = { rooms, walls, nodes, projectSettings }
          // Resolve effective dado + source for the badge.
          const effectiveDadoFt = _resolveDadoFt(room, state)
          const dadoSource      = _resolveDadoSource(room, state)
          const fullFt          = _fullHeightFt(state, room)

          // Source label for the badge.
          let dadoBadge
          if (dadoSource === 'override')      dadoBadge = 'Custom override'
          else if (dadoSource === 'override-full') dadoBadge = `Full height (${formatFeetInches(fullFt)})`
          else if (dadoSource === 'default')  dadoBadge = `Project default for ${ROOM_TYPE_LABELS[room.type] ?? room.type}`
          else if (dadoSource === 'default-full') dadoBadge = `Project default — Full (${formatFeetInches(fullFt)})`
          else                                dadoBadge = 'No dado'

          const isOverride = dadoSource === 'override' || dadoSource === 'override-full'
          const isFullActive = dadoSource === 'override-full'

          // Skirting effective state + source.
          const skirtingSource = _resolveSkirtingSource(room, state)
          const skirtingMode = room.includeSkirting === true  ? 'on'
                             : room.includeSkirting === false ? 'off'
                             : 'default'
          const SKIRTING_BADGES = {
            'override-on':              'Included (override)',
            'override-off':             'Excluded (override)',
            'default-on':               `Included (default for ${ROOM_TYPE_LABELS[room.type] ?? room.type})`,
            'default-off-dado':         'Excluded — dado supersedes',
            'default-off-type':         `Excluded — ${ROOM_TYPE_LABELS[room.type] ?? room.type} not in default list`,
            'default-off-no-flooring':  'Excluded — flooring disabled',
          }
          const skirtingBadge = SKIRTING_BADGES[skirtingSource] ?? '—'

          // Segmented button helper.
          const segBtn = (label, active, onClick, title) => (
            <button
              key={label}
              type="button"
              onClick={onClick}
              title={title}
              style={{
                flex: 1,
                fontSize: 'var(--text-xs)',
                padding: '4px var(--space-2)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                background: active ? 'var(--color-primary-bg)' : 'var(--color-surface)',
                color:      active ? 'var(--color-primary)'   : 'var(--color-text-secondary)',
                fontWeight: active ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          )

          return (
            <Section title="Tiles & skirting">
              {/* Floor tiles toggle (duplicated from Finishes — co-located here for tile workflow) */}
              <label style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)',
                cursor: 'pointer', marginBottom: 'var(--space-2)',
              }}>
                <input type="checkbox" checked={!!room.finishes?.flooring}
                  onChange={e => setRoomFinishes(room.id, { flooring: e.target.checked })}
                  style={{ cursor: 'pointer' }}
                />
                Include floor tiles
                <span style={{
                  marginLeft: 'auto',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-muted)',
                }}>(also in Finishes)</span>
              </label>

              {/* Dado height row */}
              <div style={{ marginBottom: 'var(--space-2)' }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  marginBottom: 4,
                }}>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                    Dado height
                  </span>
                  <span style={{
                    fontSize: 'var(--text-xs)',
                    color: isOverride ? 'var(--color-primary)' : 'var(--color-text-muted)',
                    fontWeight: isOverride ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                  }}>
                    {dadoBadge}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center', marginBottom: 4 }}>
                  <div style={{ flex: 1 }}>
                    <FeetInchesInput
                      value={effectiveDadoFt}
                      onCommit={ft => setRoomDado(room.id, ft)}
                      min={0}
                      precision={DEFAULT_PRECISION.foundation}
                    />
                  </div>
                  {isOverride && (
                    <Button size="sm" variant="ghost"
                      onClick={() => setRoomDado(room.id, null)}
                      title="Revert to project default">
                      Clear
                    </Button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                  {segBtn('None (0)',   room.dadoHeightFt === 0,             () => setRoomDado(room.id, 0),             'No wall tiles')}
                  {segBtn('Half (4\')', room.dadoHeightFt === 4,             () => setRoomDado(room.id, 4),             'Half-height dado')}
                  {segBtn('Full height', isFullActive,                       () => setRoomDado(room.id, FULL_SENTINEL), `Tracks floor height (${formatFeetInches(fullFt)})`)}
                </div>
              </div>

              {/* Skirting include tri-state */}
              <div>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  marginBottom: 4,
                }}>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                    Skirting
                  </span>
                  <span style={{
                    fontSize: 'var(--text-xs)',
                    color: skirtingMode !== 'default' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                    fontWeight: skirtingMode !== 'default' ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                  }}>
                    {skirtingBadge}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                  {segBtn('Default',   skirtingMode === 'default', () => setRoomIncludeSkirting(room.id, null),  'Use project default rule')}
                  {segBtn('Force on',  skirtingMode === 'on',      () => setRoomIncludeSkirting(room.id, true),  'Always include skirting')}
                  {segBtn('Force off', skirtingMode === 'off',     () => setRoomIncludeSkirting(room.id, false), 'Always exclude skirting')}
                </div>
              </div>
            </Section>
          )
        })()}

        {/* ── Paint system override (Gap 6) ──────────────────────── */}
        {(() => {
          const isPainted    = !!room.finishes?.paint
          const isOverride   = room.paintSystemId != null
          const defaultId    = projectSettings?.defaultInteriorPaintSystemId
          const paintSystems = listPaintSystems().filter(s => s.appliesContext !== 'exterior_walls')
          const defaultLabel = paintSystems.find(s => s.id === defaultId)?.label ?? '—'
          return (
            <Section title="Paint system">
              {!isPainted ? (
                <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                  Enable "Paint" in Finishes to configure.
                </div>
              ) : (
                <>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                    marginBottom: 4,
                  }}>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                      System
                    </span>
                    <span style={{
                      fontSize: 'var(--text-xs)',
                      color: isOverride ? 'var(--color-primary)' : 'var(--color-text-muted)',
                      fontWeight: isOverride ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                    }}>
                      {isOverride ? 'Custom override' : 'Project default'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <select
                        value={room.paintSystemId ?? ''}
                        onChange={e => setRoomPaintSystem(room.id, e.target.value || null)}
                        style={{ width: '100%' }}
                      >
                        <option value="">Use project default ({defaultLabel})</option>
                        {paintSystems.map(s => (
                          <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                      </select>
                    </div>
                    {isOverride && (
                      <Button size="sm" variant="ghost"
                        onClick={() => setRoomPaintSystem(room.id, null)}
                        title="Revert to project default">
                        Clear
                      </Button>
                    )}
                  </div>
                </>
              )}
            </Section>
          )
        })()}

        {/* ── Ceiling finish override (Gap 7) ────────────────────── */}
        {(() => {
          const hasCeilingPlaster = !!room.finishes?.ceilingPlaster
          const isOverride        = room.ceilingFinishId != null
          const defaultId         = projectSettings?.defaultCeilingFinishSystemId
          const ceilingSystems    = listCeilingFinishSystems()
          const defaultLabel      = ceilingSystems.find(s => s.id === defaultId)?.label ?? '—'
          return (
            <Section title="Ceiling finish">
              {!hasCeilingPlaster ? (
                <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                  Enable Ceiling plaster in Finishes to configure false-ceiling materials.
                </div>
              ) : (
                <>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                    marginBottom: 4,
                  }}>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                      Finish
                    </span>
                    <span style={{
                      fontSize: 'var(--text-xs)',
                      color: isOverride ? 'var(--color-primary)' : 'var(--color-text-muted)',
                      fontWeight: isOverride ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                    }}>
                      {isOverride ? 'Custom override' : 'Project default'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <select
                        value={room.ceilingFinishId ?? ''}
                        onChange={e => setRoomCeilingFinishSystem(room.id, e.target.value || null)}
                        style={{ width: '100%' }}
                      >
                        <option value="">Use project default ({defaultLabel})</option>
                        {ceilingSystems.map(s => (
                          <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                      </select>
                    </div>
                    {isOverride && (
                      <Button size="sm" variant="ghost"
                        onClick={() => setRoomCeilingFinishSystem(room.id, null)}
                        title="Revert to project default">
                        Clear
                      </Button>
                    )}
                  </div>
                </>
              )}
            </Section>
          )
        })()}

        {/* ── Kitchen counter override (KITCHEN-only) ────────────── */}
        {room.type === 'KITCHEN' && (() => {
          const defaultDepthFt   = projectSettings?.kitchenCounter?.defaultDepthFt ?? 2
          const defaultLengthMode = projectSettings?.kitchenCounter?.defaultLengthMode ?? 'longest_wall'
          const isOverride       = room.kitchenCounter != null
          return (
            <Section title="Kitchen counter override">
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                marginBottom: 4,
              }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                  Source
                </span>
                <span style={{
                  fontSize: 'var(--text-xs)',
                  color: isOverride ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  fontWeight: isOverride ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                }}>
                  {isOverride ? 'Custom override' : 'Project default (auto)'}
                </span>
              </div>
              {isOverride ? (
                <>
                  <Field label="Length">
                    <FeetInchesInput
                      value={room.kitchenCounter.lengthFt ?? 0}
                      onCommit={ft => setRoomKitchenCounter(room.id, { ...room.kitchenCounter, lengthFt: ft })}
                      min={0}
                      precision={DEFAULT_PRECISION.foundation}
                    />
                  </Field>
                  <Field label="Depth">
                    <FeetInchesInput
                      value={room.kitchenCounter.depthFt ?? defaultDepthFt}
                      onCommit={ft => setRoomKitchenCounter(room.id, { ...room.kitchenCounter, depthFt: ft })}
                      min={0}
                      precision={DEFAULT_PRECISION.foundation}
                    />
                  </Field>
                  <Button size="sm" variant="ghost" onClick={() => setRoomKitchenCounter(room.id, null)}>
                    Clear (use auto)
                  </Button>
                </>
              ) : (
                <>
                  <div style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-text-muted)',
                    marginBottom: 'var(--space-2)',
                  }}>
                    Auto: {defaultLengthMode === 'longest_wall' ? 'longest polygon edge' :
                           defaultLengthMode === 'half_perimeter' ? 'half room perimeter' : 'manual'} × {defaultDepthFt}ft depth
                  </div>
                  <Button size="sm" variant="ghost"
                    onClick={() => setRoomKitchenCounter(room.id, { lengthFt: 8, depthFt: defaultDepthFt })}>
                    Set manual override
                  </Button>
                </>
              )}
            </Section>
          )
        })()}

        {/* ── Balcony handrail override (BALCONY-only) ───────────── */}
        {room.type === 'BALCONY' && (() => {
          const grills          = projectSettings?.grills ?? {}
          const defaultEnabled  = grills.balconyHandrailEnabled !== false
          const defaultHeightFt = grills.balconyHandrailHeightFt ?? 3.5
          const override        = room.balconyHandrail
          const isOverride      = override != null
          const enabledMode     = !isOverride                ? 'default'
                                : override.enabled === true  ? 'on'
                                : override.enabled === false ? 'off'
                                : 'default'
          const effectiveHeight = isOverride && override.heightFt != null ? override.heightFt : defaultHeightFt

          const segBtn = (label, active, onClick, title) => (
            <button
              key={label}
              type="button"
              onClick={onClick}
              title={title}
              style={{
                flex: 1,
                fontSize: 'var(--text-xs)',
                padding: '4px var(--space-2)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                background: active ? 'var(--color-primary-bg)' : 'var(--color-surface)',
                color:      active ? 'var(--color-primary)'   : 'var(--color-text-secondary)',
                fontWeight: active ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          )

          return (
            <Section title="Balcony handrail">
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                marginBottom: 4,
              }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                  Include handrail
                </span>
                <span style={{
                  fontSize: 'var(--text-xs)',
                  color: isOverride ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  fontWeight: isOverride ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                }}>
                  {isOverride
                    ? (enabledMode === 'on' ? 'Forced on' : enabledMode === 'off' ? 'Forced off' : 'Custom override')
                    : `Project default (${defaultEnabled ? 'on' : 'off'})`}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-1)', marginBottom: 'var(--space-2)' }}>
                {segBtn('Default',   enabledMode === 'default', () => setRoomBalconyHandrail(room.id, null),                                    'Use project default rule')}
                {segBtn('Force on',  enabledMode === 'on',      () => setRoomBalconyHandrail(room.id, { enabled: true,  heightFt: effectiveHeight }), 'Always include handrail')}
                {segBtn('Force off', enabledMode === 'off',     () => setRoomBalconyHandrail(room.id, { enabled: false, heightFt: effectiveHeight }), 'Always exclude handrail')}
              </div>
              {isOverride && enabledMode !== 'off' && (
                <Field label="Height">
                  <FeetInchesInput
                    value={effectiveHeight}
                    onCommit={ft => setRoomBalconyHandrail(room.id, { ...override, heightFt: ft })}
                    min={0}
                    precision={DEFAULT_PRECISION.foundation}
                  />
                </Field>
              )}
            </Section>
          )
        })()}

        <div style={{ borderTop: '1px solid var(--color-border)', margin: 'var(--space-2) 0' }} />

        {/* Measurements — dimensionMode dual readout (Area 1) */}
        <Section title="Area">
          {dimensionMode === 'clear_internal' && Math.abs(floorAreaClear - floorArea) > 0.05 ? (
            <Row
              label="Floor"
              value={fmtArea(floorAreaClear)}
              sub={`clear · ${fmtArea(floorArea)} centerline`}
            />
          ) : (
            <Row label="Floor" value={fmtArea(floorArea)} />
          )}
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

        {/* Phase 4 Tier-2 Item 30 + ADD 7: per-room material quantities,
            memoized on [roomId, boqRevision, ratesRevision]. */}
        <RoomMaterialsBreakdown roomId={room.id} />

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
    </SelectionPanel>
  )
}
