import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { GRID_IN, DEFAULT_WALL_HEIGHT_IN, DEFAULT_WALL_THICK_IN } from '../geometry'
import { getEffectiveWallLengthFt } from '../topology/index.js'
import { MATERIAL_LIBRARY } from '../materials'
import { MASONRY_SYSTEMS } from '../specs/masonrySystems'
import { toast } from './ui/Toast'
import SelectionPanel from './ui/SelectionPanel'
import { Button } from './ui/Button'
import { Field } from './ui/Field'
import FeetInchesInput from './ui/FeetInchesInput'
import InchesInput from './ui/InchesInput'
import { DEFAULT_PRECISION } from '../lib/units'
import { useUnits } from '../hooks/useUnits'

const PRESETS = {
  door:   { width: 3, height: 7 },
  window: { width: 4, height: 4 },
}

// 4 door orientations: [hinge side, swing direction]
// 0: hinge at start, opens left   1: hinge at start, opens right
// 2: hinge at end,   opens left   3: hinge at end,   opens right
const ORIENT_LABELS = ['↖', '↙', '↗', '↘']
const ORIENT_TIPS   = [
  'Hinge at start, opens left',
  'Hinge at start, opens right',
  'Hinge at end, opens left',
  'Hinge at end, opens right',
]

export default function OpeningPanel() {
  const selectedWallId      = useStore(s => s.selectedWallId)
  const walls               = useStore(s => s.walls)
  const getWallLength       = useStore(s => s.getWallLength)
  const addOpening          = useStore(s => s.addOpening)
  const removeOpening       = useStore(s => s.removeOpening)
  const setOpeningOrient    = useStore(s => s.setOpeningOrient)
  const deleteWall          = useStore(s => s.deleteWall)
  const undo                = useStore(s => s.undo)
  const setWallHeight       = useStore(s => s.setWallHeight)
  const setWallThickness    = useStore(s => s.setWallThickness)
  const setWallIsPlot       = useStore(s => s.setWallIsPlot)
  const setWallIsVirtual    = useStore(s => s.setWallIsVirtual)
  const setWallMaterial     = useStore(s => s.setWallMaterial)
  const setDraftOpening     = useStore(s => s.setDraftOpening)
  const setWallBeamFlags    = useStore(s => s.setWallBeamFlags)
  const classifyWallBeamFlags = useStore(s => s.classifyWallBeamFlags)
  const setOpeningSunshade  = useStore(s => s.setOpeningSunshade)
  const selectWall          = useStore(s => s.selectWall)
  const selectOpening       = useStore(s => s.selectOpening)
  const { fmtLength }       = useUnits()

  const [type,   setType]   = useState('door')
  const [width,  setWidth]  = useState(3)
  const [height, setHeight] = useState(7)
  const [offset, setOffset] = useState(0)
  const [orient, setOrient] = useState(0)
  const [sunshadePreview, setSunshadePreview] = useState(false)

  // Push current form state to store so Canvas can show a live preview
  useEffect(() => {
    if (!selectedWallId) return
    setDraftOpening({ type, width: Number(width) * GRID_IN, height: Number(height) * GRID_IN, offset: Number(offset) * GRID_IN, orient })
  }, [type, width, height, offset, orient, selectedWallId])

  // Clear preview when panel unmounts
  useEffect(() => () => setDraftOpening(null), [])

  // Reset sunshade preview when switching away from window type
  useEffect(() => { if (type !== 'window') setSunshadePreview(false) }, [type])

  if (!selectedWallId) return null
  const wall = walls[selectedWallId]
  if (!wall) return null

  const wallHeight = Math.round((wall.height ?? DEFAULT_WALL_HEIGHT_IN) / GRID_IN * 100) / 100
  const wallLen    = getWallLength(selectedWallId)
  // Effective length (clear-internal mode aware). Centerline stays the
  // authoritative axis for opening offsets (data semantics unchanged);
  // effective surfaces what the user sees on the inner face.
  const dimensionMode = useStore.getState().projectSettings?.dimensionMode ?? 'centerline'
  const wallLenEff = getEffectiveWallLengthFt(useStore.getState(), selectedWallId, dimensionMode)
  const showDualWallLen = dimensionMode === 'clear_internal'
                       && Math.abs(wallLenEff - wallLen) > 0.01
  const openings   = wall.openings || []

  const w = Number(width)
  const h = Number(height)
  const o = Number(offset)

  const errHeight  = h > wallHeight ? `Opening height (${fmtLength(h)}) exceeds wall height (${fmtLength(wallHeight)})` : null
  const errFit     = (o + w) > wallLen ? `Doesn't fit — ${fmtLength(o)} + ${fmtLength(w)} = ${fmtLength(o + w)}, wall is ${fmtLength(wallLen)}` : null
  const errOverlap = openings.some(ex => !(o + w <= ex.offset / GRID_IN || o >= ex.offset / GRID_IN + ex.width / GRID_IN))
    ? 'Overlaps an existing opening' : null
  const errNeg     = o < 0 ? 'Offset cannot be negative' : null
  const error      = errNeg || errFit || errHeight || errOverlap

  // Beam flags for selected wall
  const beamFlags = selectedWallId ? classifyWallBeamFlags(selectedWallId) : null

  function selectType(t) {
    setType(t)
    setWidth(PRESETS[t].width)
    setHeight(PRESETS[t].height)
  }

  function setOffsetQuick(pos) {
    if (pos === 'start')  setOffset(0)
    if (pos === 'center') setOffset(Math.max(0, Math.round((wallLen - w) / 2 * 10) / 10))
    if (pos === 'end')    setOffset(Math.max(0, Math.round((wallLen - w) * 10) / 10))
  }

  function handleAdd() {
    if (error) return
    addOpening(selectedWallId, {
      offset: o * GRID_IN, width: w * GRID_IN, height: h * GRID_IN,
      type, orient: type === 'door' ? orient : 0,
      hasSunshade: type === 'window' ? sunshadePreview : false,
    })
  }

  return (
    <SelectionPanel
      title="Wall Properties"
      onClose={() => selectWall(null)}
      width={260}
    >
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            deleteWall(selectedWallId)
            toast.action('Wall deleted.', { label: 'Undo', onClick: () => undo(), duration: 5000 })
          }}
        >
          Delete wall
        </Button>
      </div>

      {/* Wall height — stored in inches, displayed in feet (FeetInchesInput) */}
      <Field label="Height" inline>
        <FeetInchesInput
          value={(wall.height ?? DEFAULT_WALL_HEIGHT_IN) / GRID_IN}
          onCommit={ft => setWallHeight(selectedWallId, ft * GRID_IN)}
          min={1}
          precision={DEFAULT_PRECISION.height}
        />
      </Field>

      {/* Wall thickness — stored in inches, displayed as inches (InchesInput) */}
      <Field label="Thickness" inline>
        <InchesInput
          value={wall.thickness ?? DEFAULT_WALL_THICK_IN}
          onCommit={inches => setWallThickness(selectedWallId, inches)}
          min={1}
          precision="1"
        />
      </Field>

      {/* Material picker — grouped by masonry system (Phase 1.6c) */}
      <Field label="Material">
        <select
          value={wall.materialKey ?? 'IS_MODULAR_BRICK'}
          onChange={e => setWallMaterial(selectedWallId, e.target.value)}
          onKeyDown={e => e.stopPropagation()}
        >
          {Object.values(MASONRY_SYSTEMS).map(sys => (
            <optgroup key={sys.id} label={sys.label}>
              {sys.units.map(unitKey => {
                const mat = MATERIAL_LIBRARY[unitKey]
                if (!mat) return null
                return <option key={unitKey} value={unitKey}>{mat.name}</option>
              })}
            </optgroup>
          ))}
        </select>
      </Field>

      <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', marginBottom: 'var(--space-3)' }}>
        {showDualWallLen
          ? `Length: ${fmtLength(wallLenEff)} clear · ${fmtLength(wallLen)} centerline`
          : `Length: ${fmtLength(wallLen)}`}
      </div>

      {/* Plot boundary toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
        <input type="checkbox" id="isPlot" checked={wall.isPlot ?? false}
          onChange={e => setWallIsPlot(selectedWallId, e.target.checked)} style={{ cursor: 'pointer' }}
        />
        <label htmlFor="isPlot" style={{
          color: wall.isPlot ? 'var(--color-warning)' : 'var(--color-text-secondary)',
          fontWeight: wall.isPlot ? 'var(--weight-bold)' : 'var(--weight-regular)',
          cursor: 'pointer',
          fontSize: 'var(--text-sm)',
        }}>
          Plot boundary wall
        </label>
      </div>

      {/* Virtual wall toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <input type="checkbox" id="isVirtual" checked={wall.isVirtual ?? false}
          onChange={e => setWallIsVirtual(selectedWallId, e.target.checked)} style={{ cursor: 'pointer' }}
        />
        <label htmlFor="isVirtual" style={{
          color: wall.isVirtual ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
          fontWeight: wall.isVirtual ? 'var(--weight-bold)' : 'var(--weight-regular)',
          cursor: 'pointer',
          fontSize: 'var(--text-sm)',
        }}>
          Virtual wall (open plan)
        </label>
      </div>

      {/* Wall beam flags */}
      <div style={{ borderTop: '1px solid var(--color-border)', margin: 'var(--space-2) 0' }} />
      <div style={{
        fontWeight: 'var(--weight-semibold)',
        marginBottom: 'var(--space-2)',
        color: 'var(--color-text-secondary)',
        fontSize: 'var(--text-sm)',
      }}>Beam flags</div>
      {['plinth', 'lintel', 'roof'].map(level => {
        const flagKey  = `has${level.charAt(0).toUpperCase()}${level.slice(1)}Beam`
        const rawVal   = wall[flagKey] ?? null
        const resolved = beamFlags ? beamFlags[flagKey] : false
        const badge    = rawVal === null
          ? (resolved ? 'auto (on)' : 'auto (off)')
          : (rawVal ? 'forced on' : 'forced off')
        const badgeColor = rawVal === null
          ? 'var(--color-text-muted)'
          : rawVal ? 'var(--color-success)' : 'var(--color-error)'
        return (
          <div key={level} style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)',
          }}>
            <input type="checkbox"
              checked={resolved}
              onChange={() => {
                const cur  = wall[flagKey]
                // Toggle cycle: null → true → false → null
                const next = cur === null ? true : cur === true ? false : null
                setWallBeamFlags(selectedWallId, { [flagKey]: next })
              }}
              style={{ cursor: 'pointer' }}
            />
            <span style={{
              color: 'var(--color-text-secondary)',
              flex: 1,
              fontSize: 'var(--text-sm)',
              textTransform: 'capitalize',
            }}>{level} beam</span>
            <span style={{
              fontSize: 'var(--text-xs)',
              color: badgeColor,
              background: 'var(--color-bg-muted)',
              padding: '1px var(--space-1)',
              borderRadius: 'var(--radius-sm)',
            }}>
              {badge}
            </span>
          </div>
        )
      })}

      <div style={{ borderTop: '1px solid var(--color-border)', margin: 'var(--space-2) 0' }} />
      <div style={{
        fontWeight: 'var(--weight-semibold)',
        marginBottom: 'var(--space-2)',
        color: 'var(--color-text-secondary)',
        fontSize: 'var(--text-sm)',
      }}>Add Opening</div>

      {/* Type toggle */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <Button
          variant={type === 'door' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => selectType('door')}
        >
          Door
        </Button>
        <Button
          variant={type === 'window' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => selectType('window')}
        >
          Window
        </Button>
      </div>

      {/* Sunshade pre-add toggle — window only */}
      {type === 'window' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
          <input type="checkbox" id="sunshadeChk" checked={sunshadePreview}
            onChange={e => setSunshadePreview(e.target.checked)} style={{ cursor: 'pointer' }} />
          <label htmlFor="sunshadeChk" style={{
            fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', cursor: 'pointer',
          }}>
            Sunshade (chajja)
          </label>
        </div>
      )}

      {/* W × H */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
        <Field label="W" inline>
          <FeetInchesInput
            value={Number(width)}
            onCommit={ft => setWidth(ft)}
            min={0.5}
            precision={DEFAULT_PRECISION.opening}
          />
        </Field>
        <Field label="H" inline error={errHeight ? ' ' : undefined}>
          <FeetInchesInput
            value={Number(height)}
            onCommit={ft => setHeight(ft)}
            min={0.5}
            precision={DEFAULT_PRECISION.opening}
          />
        </Field>
      </div>

      {/* Door swing selector */}
      {type === 'door' && (
        <div style={{ marginBottom: 'var(--space-2)' }}>
          <div style={{
            color: 'var(--color-text-secondary)',
            fontSize: 'var(--text-xs)',
            marginBottom: 'var(--space-1)',
          }}>Swing direction</div>
          <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
            {ORIENT_LABELS.map((lbl, i) => (
              <Button
                key={i}
                variant={orient === i ? 'primary' : 'secondary'}
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

      {/* Offset */}
      <div style={{ marginBottom: 'var(--space-1)' }}>
        <Field label="Starts at" inline hint="from start" error={(errFit || errNeg) ? ' ' : undefined}>
          <FeetInchesInput
            value={Number(offset)}
            onCommit={ft => setOffset(ft)}
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

      {error && (
        <div style={{
          color: 'var(--color-error)',
          fontSize: 'var(--text-xs)',
          margin: 'var(--space-2) 0',
        }}>{error}</div>
      )}

      <div style={{ marginTop: 'var(--space-2)' }}>
        <Button variant="primary" size="md" onClick={handleAdd} disabled={!!error}>
          + Add {type}
        </Button>
      </div>

      {/* Opening list */}
      {/* Existing openings — clickable rows that open OpeningDetailPanel.
          Per-opening edit / delete now lives in that detail panel; this
          list is a navigation overview only. */}
      <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 'var(--space-3)' }}>
        {openings.length === 0 && (
          <div style={{
            color: 'var(--color-text-muted)',
            fontSize: 'var(--text-sm)',
            paddingTop: 'var(--space-2)',
          }}>No openings</div>
        )}
        {openings.map(op => (
          <button
            key={op.id}
            type="button"
            onClick={() => selectOpening(selectedWallId, op.id)}
            title="Click to edit or delete this opening"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
              padding: 'var(--space-1) var(--space-2)',
              borderBottom: '1px solid var(--color-bg-muted)',
              background: 'transparent',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background var(--motion-fast) var(--ease-out)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-hover)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
              {op.type === 'window' ? '▭ Window' : '▮ Door'}{' '}
              {fmtLength(op.width / GRID_IN)} × {fmtLength(op.height / GRID_IN)} @ {fmtLength(op.offset / GRID_IN)}
            </span>
            <span style={{
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-xs)',
            }}>Edit →</span>
          </button>
        ))}
      </div>
    </SelectionPanel>
  )
}
