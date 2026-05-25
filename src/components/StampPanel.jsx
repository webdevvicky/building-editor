// StampPanel — detail panel for selected stamps (select tool).
// Preserved interactions (do not remove during refactor):
//   click-to-place  : Canvas.jsx handleSVGClick (STAMP_TOOLS check)
//   drag-to-move    : Canvas.jsx handleStampMouseDown + handleMouseMove
//   resize via input: resizeStamp (arch) / updateStamp (civil) — no undo history by design,
//                     matches the resizeStamp pattern used for stairs/lift

import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { GRID_IN } from '../geometry'
import { toast } from './ui/Toast'
import SelectionPanel from './ui/SelectionPanel'
import { Button } from './ui/Button'
import { Field } from './ui/Field'

const CIVIL_TYPES = new Set(['sump', 'overhead_tank', 'septic_tank'])

const STAMP_LABELS = {
  stairs:        'Staircase',
  lift:          'Lift',
  sump:          'Sump',
  overhead_tank: 'Overhead Tank',
  septic_tank:   'Septic Tank',
}

export default function StampPanel() {
  const selectedStampId = useStore(s => s.selectedStampId)
  const stamps          = useStore(s => s.stamps)
  const resizeStamp     = useStore(s => s.resizeStamp)
  const updateStamp     = useStore(s => s.updateStamp)
  const deleteStamp     = useStore(s => s.deleteStamp)
  const selectStamp     = useStore(s => s.selectStamp)
  const undo            = useStore(s => s.undo)
  const unit            = useStore(s => s.unit)

  const stamp   = stamps[selectedStampId]
  const isCivil = stamp ? CIVIL_TYPES.has(stamp.type) : false

  const [w,     setW]     = useState('')
  const [h,     setH]     = useState('')
  const [depth, setDepth] = useState('')
  const [name,  setName]  = useState('')

  useEffect(() => {
    if (!stamp) return
    setW(Math.round(stamp.w / GRID_IN * 10) / 10)
    setH(Math.round(stamp.h / GRID_IN * 10) / 10)
    if (isCivil) {
      setDepth(stamp.depth ? Math.round(stamp.depth / GRID_IN * 10) / 10 : '')
      setName(stamp.name || '')
    }
  }, [selectedStampId, stamp?.w, stamp?.h, stamp?.depth, stamp?.name])

  if (!stamp) return null

  const label        = STAMP_LABELS[stamp.type] || stamp.type
  const hasExcavation = stamp.type === 'sump' || stamp.type === 'septic_tank'

  function handleW(val) {
    setW(val)
    const n = parseFloat(val)
    if (n > 0) {
      if (isCivil) updateStamp(stamp.id, { w: Math.max(GRID_IN, n * GRID_IN) })
      else resizeStamp(stamp.id, n, parseFloat(h) || stamp.h / GRID_IN)
    }
  }

  function handleH(val) {
    setH(val)
    const n = parseFloat(val)
    if (n > 0) {
      if (isCivil) updateStamp(stamp.id, { h: Math.max(GRID_IN, n * GRID_IN) })
      else resizeStamp(stamp.id, parseFloat(w) || stamp.w / GRID_IN, n)
    }
  }

  function handleDepth(val) {
    setDepth(val)
    const n = parseFloat(val)
    if (n > 0) updateStamp(stamp.id, { depth: Math.max(GRID_IN, n * GRID_IN) })
  }

  function handleName(val) {
    setName(val)
    updateStamp(stamp.id, { name: val })
  }

  function fmtVol() {
    if (!stamp.depth || !stamp.w || !stamp.h) return '—'
    const ft3 = Math.round((stamp.w * stamp.h * stamp.depth) / 1728 * 100) / 100
    if (unit === 'm') return `${Math.round(ft3 * 0.0283 * 100) / 100} m³`
    return `${ft3} ft³`
  }

  return (
    <SelectionPanel
      title={label}
      onClose={() => selectStamp(null)}
      width={260}
    >
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            const stampName = stamp.name || label
            deleteStamp(stamp.id)
            toast.action(`Deleted ${stampName}.`, {
              label: 'Undo', onClick: () => undo(), duration: 5000,
            })
          }}
        >
          Delete
        </Button>
      </div>

      {isCivil && (
        <Field label="Name">
          <input type="text" value={name}
            onChange={e => handleName(e.target.value)}
            onKeyDown={e => e.stopPropagation()}
          />
        </Field>
      )}

      <Field label="Width" inline hint="ft">
        <input type="number" value={w} min={1} step={0.5}
          onChange={e => handleW(e.target.value)}
          onKeyDown={e => e.stopPropagation()}
        />
      </Field>

      <Field label={stamp.type === 'stairs' ? 'Depth' : 'Length'} inline hint="ft">
        <input type="number" value={h} min={1} step={0.5}
          onChange={e => handleH(e.target.value)}
          onKeyDown={e => e.stopPropagation()}
        />
      </Field>

      {isCivil && (
        <Field label="Depth" inline hint="ft">
          <input type="number" value={depth} min={1} step={0.5}
            onChange={e => handleDepth(e.target.value)}
            onKeyDown={e => e.stopPropagation()}
          />
        </Field>
      )}

      {hasExcavation && (
        <div style={{
          marginTop: 'var(--space-1)',
          padding: 'var(--space-2)',
          background: 'var(--color-bg-muted)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-secondary)',
        }}>
          Excavation: <strong>{fmtVol()}</strong>
        </div>
      )}

      <div style={{
        marginTop: 'var(--space-3)',
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)',
      }}>
        Drag to reposition · Delete key to remove
      </div>
    </SelectionPanel>
  )
}
