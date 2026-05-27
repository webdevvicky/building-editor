// Selection-driven detail panel for a single opening (door or window).
//
// Opens when state.selectedOpening = { wallId, openingId } is set.
// Mirrors the ColumnPanel / PlumbingFixturePanel pattern.
//
// Edit affordances:
//   - Type switcher (Door <-> Window)  — flips role-specific fields via updateOpening normalization
//   - Width, Height, Offset (feet) numeric inputs — clamped server-side
//   - Door swing direction (when type === 'door')
//   - Window sunshade flag (when type === 'window')
//   - Delete button (dialog.confirm + toast.action undo)

import { Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { GRID_IN } from '../geometry'
import { getEffectiveWallLengthFt } from '../topology/index.js'
import SelectionPanel from './ui/SelectionPanel'
import { Button } from './ui/Button'
import { Field } from './ui/Field'
import FeetInchesInput from './ui/FeetInchesInput'
import { DEFAULT_PRECISION } from '../lib/units'
import { useUnits } from '../hooks/useUnits'
import { dialog } from './ui/Dialog'
import { toast } from './ui/Toast'
import { getOpeningSubtypesByParent, SUBTYPE_SOURCE } from '../constants/joinery'
import { resolveOpeningHardware, HARDWARE_RESOLUTION_SOURCE } from '../specs/hardware/resolution.js'
import {
  listHardwareSetsByAppliesTo,
  listWindowHardwareSetsByAppliesTo,
} from '../specs/hardware/hardwareSets.js'

// 4 door orientations — mirrored from OpeningPanel.jsx
const ORIENT_LABELS = ['↖', '↙', '↗', '↘']
const ORIENT_TIPS   = [
  'Hinge at start, opens left',
  'Hinge at start, opens right',
  'Hinge at end, opens left',
  'Hinge at end, opens right',
]

export default function OpeningDetailPanel() {
  const sel              = useStore(s => s.selectedOpening)
  const walls            = useStore(s => s.walls)
  const getWallLength    = useStore(s => s.getWallLength)
  const updateOpening    = useStore(s => s.updateOpening)
  const removeOpening    = useStore(s => s.removeOpening)
  const selectOpening    = useStore(s => s.selectOpening)
  const setOpeningSubtype = useStore(s => s.setOpeningSubtype)
  const setOpeningGrill   = useStore(s => s.setOpeningGrill)
  const setOpeningHardware = useStore(s => s.setOpeningHardware)
  const projectSettings   = useStore(s => s.projectSettings)
  const undo             = useStore(s => s.undo)
  const { fmtLength }    = useUnits()

  // Resolve the selected opening. Bail out gracefully if anything is missing.
  const wall    = sel ? walls[sel.wallId] : null
  const opening = wall ? (wall.openings ?? []).find(o => o.id === sel.openingId) : null

  if (!sel || !wall || !opening) return null

  const wallLenFt = getWallLength(sel.wallId) ?? 0
  // Effective wall length honors projectSettings.dimensionMode. Centerline
  // is the data-anchor for opening offsets (stored in inches from a node);
  // effective is what the user actually sees on the inner face. Show both
  // when modes diverge so users can reconcile placement vs inner-face span.
  const dimensionMode = projectSettings?.dimensionMode ?? 'centerline'
  const wallLenEffFt = getEffectiveWallLengthFt(useStore.getState(), sel.wallId, dimensionMode)
  const showDualWallLen = dimensionMode === 'clear_internal'
                       && Math.abs(wallLenEffFt - wallLenFt) > 0.01
  const isDoor   = opening.type === 'door'
  const isWindow = opening.type === 'window'

  function setOffsetQuick(pos) {
    const widthIn = opening.width
    const wallIn  = wallLenFt * GRID_IN
    let nextIn = 0
    if (pos === 'start')  nextIn = 0
    else if (pos === 'center') nextIn = Math.max(0, (wallIn - widthIn) / 2)
    else if (pos === 'end')    nextIn = Math.max(0, wallIn - widthIn)
    updateOpening(sel.wallId, sel.openingId, { offset: nextIn })
  }

  function setType(next) {
    if (next === opening.type) return
    updateOpening(sel.wallId, sel.openingId, { type: next })
  }
  function setOrient(o) {
    updateOpening(sel.wallId, sel.openingId, { orient: o })
  }
  function setSunshade(checked) {
    updateOpening(sel.wallId, sel.openingId, { hasSunshade: !!checked })
  }

  async function handleDelete() {
    const label = isDoor ? 'door' : 'window'
    const ok = await dialog.confirm(`Delete this ${label}?`, {
      title: `Delete ${label}`,
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    removeOpening(sel.wallId, sel.openingId)
    toast.action(`Deleted ${label}.`, {
      label: 'Undo',
      onClick: () => undo?.(),
      duration: 5000,
    })
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <SelectionPanel
      title={isDoor ? 'Door' : 'Window'}
      onClose={() => selectOpening(null, null)}
      width={280}
    >
      {/* Type switcher */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <Button
          variant={isDoor ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setType('door')}
        >
          Door
        </Button>
        <Button
          variant={isWindow ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setType('window')}
        >
          Window
        </Button>
      </div>

      {/* Width × Height */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
        <Field label="W" inline>
          <FeetInchesInput
            value={opening.width / GRID_IN}
            onCommit={ft => updateOpening(sel.wallId, sel.openingId, { width: ft * GRID_IN })}
            min={0.5}
            precision={DEFAULT_PRECISION.opening}
          />
        </Field>
        <Field label="H" inline>
          <FeetInchesInput
            value={opening.height / GRID_IN}
            onCommit={ft => updateOpening(sel.wallId, sel.openingId, { height: ft * GRID_IN })}
            min={0.5}
            precision={DEFAULT_PRECISION.opening}
          />
        </Field>
      </div>

      {/* Offset + quick buttons */}
      <div style={{ marginBottom: 'var(--space-2)' }}>
        <Field
          label="Starts at"
          inline
          hint={
            showDualWallLen
              ? `Wall is ${fmtLength(wallLenEffFt)} clear · ${fmtLength(wallLenFt)} centerline (offsets measured from centerline)`
              : `Wall is ${fmtLength(wallLenFt)} long`
          }
        >
          <FeetInchesInput
            value={opening.offset / GRID_IN}
            onCommit={ft => updateOpening(sel.wallId, sel.openingId, { offset: ft * GRID_IN })}
            min={0}
            precision={DEFAULT_PRECISION.opening}
          />
        </Field>
        <div style={{ display: 'flex', gap: 'var(--space-1)', marginTop: 'var(--space-1)' }}>
          <Button variant="secondary" size="sm" onClick={() => setOffsetQuick('start')}>Start</Button>
          <Button variant="secondary" size="sm" onClick={() => setOffsetQuick('center')}>Center</Button>
          <Button variant="secondary" size="sm" onClick={() => setOffsetQuick('end')}>End</Button>
        </div>
      </div>

      {/* Door swing selector */}
      {isDoor && (
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <div style={{
            color: 'var(--color-text-secondary)',
            fontSize: 'var(--text-xs)',
            marginBottom: 'var(--space-1)',
          }}>Swing direction</div>
          <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
            {ORIENT_LABELS.map((lbl, i) => (
              <Button
                key={i}
                variant={(opening.orient ?? 0) === i ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setOrient(i)}
                title={ORIENT_TIPS[i]}
              >
                {lbl}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Subtype dropdown (Rev 2) */}
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <Field label="Subtype" inline hint={opening.subtypeSource === SUBTYPE_SOURCE.HEURISTIC ? 'Auto-detected' : null}>
          <select
            value={opening.subtype ?? ''}
            onChange={e => setOpeningSubtype(sel.wallId, sel.openingId, e.target.value)}
          >
            {getOpeningSubtypesByParent(opening.type).map(s => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </Field>
      </div>

      {/* Grill checkbox (Rev 2) — visible on windows + main doors */}
      {(isWindow || opening.subtype === 'MAIN_DOOR') && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          marginBottom: 'var(--space-3)',
        }}>
          <input
            type="checkbox" id="opening-detail-grill"
            checked={opening.hasGrill === true}
            onChange={e => setOpeningGrill(sel.wallId, sel.openingId, e.target.checked ? true : null)}
            style={{ cursor: 'pointer' }}
          />
          <label htmlFor="opening-detail-grill" style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
          }}>
            Has MS grill
          </label>
        </div>
      )}

      {/* Sunshade checkbox */}
      {isWindow && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          marginBottom: 'var(--space-3)',
        }}>
          <input
            type="checkbox" id="opening-detail-sunshade"
            checked={!!opening.hasSunshade}
            onChange={e => setSunshade(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <label htmlFor="opening-detail-sunshade" style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
          }}>
            Has sunshade (chajja)
          </label>
        </div>
      )}

      {/* Hardware (Gap 4/5) */}
      {opening.subtype && (() => {
        const isDoorSubtype = opening.subtype === 'MAIN_DOOR' || opening.subtype === 'INTERNAL_DOOR'
        const availableSets = isDoorSubtype
          ? listHardwareSetsByAppliesTo(opening.subtype)
          : listWindowHardwareSetsByAppliesTo(opening.subtype)
        const resolved = resolveOpeningHardware({ projectSettings }, opening)
        const overrideCount = (opening.hardwareOverrides?.add?.length ?? 0)
          + (opening.hardwareOverrides?.remove?.length ?? 0)
        return (
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <div style={{
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-bold)',
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: 0.6,
              marginBottom: 'var(--space-2)',
            }}>Hardware</div>

            {/* Source badge */}
            <div style={{
              fontSize: 'var(--text-xs)',
              color: resolved.source === HARDWARE_RESOLUTION_SOURCE.EXPLICIT
                ? 'var(--color-primary)'
                : 'var(--color-text-muted)',
              marginBottom: 'var(--space-1)',
              fontWeight: resolved.source === HARDWARE_RESOLUTION_SOURCE.EXPLICIT
                ? 'var(--weight-semibold)'
                : 'var(--weight-regular)',
            }}>
              {resolved.source === HARDWARE_RESOLUTION_SOURCE.EXPLICIT
                && `Custom override: ${resolved.setLabel ?? '(none)'}`}
              {resolved.source === HARDWARE_RESOLUTION_SOURCE.PROJECT_DEFAULT
                && `Project default: ${resolved.setLabel ?? '(none)'}`}
              {resolved.source === HARDWARE_RESOLUTION_SOURCE.NONE
                && 'No hardware configured'}
            </div>

            {/* Set picker */}
            <Field label="Set">
              <select
                value={opening.hardwareSetId ?? ''}
                onKeyDown={e => e.stopPropagation()}
                onChange={e => setOpeningHardware(sel.wallId, sel.openingId, {
                  hardwareSetId: e.target.value || null,
                })}
              >
                <option value="">Use project default</option>
                {availableSets.map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </Field>

            {/* Resolved items preview */}
            {resolved.items.length > 0 && (
              <div style={{
                marginTop: 'var(--space-2)',
                padding: 'var(--space-2)',
                background: 'var(--color-bg-muted)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--text-xs)',
              }}>
                <div style={{ color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                  Resolves to {resolved.items.length} item{resolved.items.length !== 1 ? 's' : ''}:
                </div>
                {resolved.items.map((it, i) => (
                  <div key={i} style={{
                    color: 'var(--color-text-muted)',
                    marginLeft: 'var(--space-2)',
                  }}>
                    • {it.itemId} × {it.qty} {it.source === 'OVERRIDE_ADD' ? '(added)' : ''}
                  </div>
                ))}
              </div>
            )}

            {/* Advanced overrides — collapsed stub */}
            <details style={{ marginTop: 'var(--space-2)' }}>
              <summary style={{
                cursor: 'pointer',
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-secondary)',
              }}>
                Advanced overrides ({overrideCount} active)
              </summary>
              <div style={{
                marginTop: 'var(--space-2)',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-muted)',
              }}>
                Add / remove individual items from the resolved set.
                Schema is wired — full UI lands in a follow-on commit.
              </div>
              {(opening.hardwareOverrides?.add?.length > 0
                || opening.hardwareOverrides?.remove?.length > 0) && (
                <div style={{ marginTop: 'var(--space-1)' }}>
                  {opening.hardwareOverrides?.add?.map(a => (
                    <div key={a.itemId} style={{ fontSize: 'var(--text-xs)' }}>
                      + {a.itemId} × {a.qty}
                    </div>
                  ))}
                  {opening.hardwareOverrides?.remove?.map(r => (
                    <div key={r} style={{ fontSize: 'var(--text-xs)' }}>− {r}</div>
                  ))}
                  <Button size="sm" variant="ghost"
                    onClick={() => setOpeningHardware(sel.wallId, sel.openingId, {
                      hardwareOverrides: null,
                    })}>
                    Clear overrides
                  </Button>
                </div>
              )}
            </details>
          </div>
        )
      })()}

      {/* Delete */}
      <div style={{
        borderTop: '1px solid var(--color-border)',
        paddingTop: 'var(--space-2)',
        marginTop: 'var(--space-2)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}>
        <Button variant="danger" size="sm" onClick={handleDelete}>
          <Trash2 size={14} strokeWidth={2} style={{ marginRight: 4 }} />
          Delete {isDoor ? 'door' : 'window'}
        </Button>
      </div>
    </SelectionPanel>
  )
}
