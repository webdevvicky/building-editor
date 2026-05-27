// Underlay calibration modal — Phase 4 Tier-2 Steps 15 + 18 + two-click capture.
//
// Two modes:
//   1) Two-click capture (canonical): user clicks p1, then p2 on the canvas
//      while activeTool === 'calibrate_underlay'. Once both points exist in
//      state.selection.calibrationCapture, the modal opens and prompts for
//      the real distance between them. Applied via buildCalibration.
//   2) Full-width fallback: opens when activeTool === 'calibrate_underlay'
//      with no captured points yet — user can type a known full-width.
//      Faster for engineers who know "this drawing is X ft wide" without
//      hunting an exact reference segment.
//
// Calibration is stored in IMAGE PIXEL space (ADD 8). World coords are
// derived at render time — never persisted.

import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { Modal } from './ui/Modal.jsx'
import { Button } from './ui/Button.jsx'
import { Field } from './ui/Field.jsx'
import FeetInchesInput from './ui/FeetInchesInput.jsx'
import { buildCalibration } from '../underlay/calibration.js'
import { toast } from './ui/Toast'

function _selectFloorUnderlay(state) {
  const fid = state.currentFloorId
  const floors = state.projectSettings?.floors
  if (!floors) return null
  return floors.find(f => f.id === fid)?.underlay ?? null
}

export default function CalibrationModal() {
  const activeTool = useStore(s => s.activeTool)
  const setTool    = useStore(s => s.setTool)
  // Per-floor (Fix 3): calibration always targets the current floor's
  // underlay. Switching floors mid-calibration is a user error — the
  // visible underlay changes underneath them.
  const underlay   = useStore(_selectFloorUnderlay)
  const currentFloorId = useStore(s => s.currentFloorId)
  const capture    = useStore(s => s.selection?.calibrationCapture ?? null)
  const setSelection = useStore(s => s.setSelection)
  const setUnderlayCalibration = useStore(s => s.setUnderlayCalibration)

  const toolActive = activeTool === 'calibrate_underlay'
  const haveBothPoints = !!(capture?.p1Px && capture?.p2Px)
  // Modal opens when the tool is active AND either both points are
  // captured OR no points are captured (full-width fallback).
  const open = toolActive && (haveBothPoints || !capture)

  const [lengthFt, setLengthFt] = useState(null)
  const [mode, setMode] = useState('two-click')  // 'two-click' | 'full-width'

  // When the modal opens, set the right mode + pre-fill length from prior
  // calibration when present.
  useEffect(() => {
    if (!open) return
    setLengthFt(underlay?.calibration?.knownLengthFt ?? null)
    setMode(haveBothPoints ? 'two-click' : 'full-width')
  }, [open, haveBothPoints, underlay?.calibration?.knownLengthFt])

  // Tool switched away (Esc / other tool button) — drop any captured points
  // so re-entering the tool starts fresh.
  useEffect(() => {
    if (!toolActive && capture) {
      setSelection({ calibrationCapture: null })
    }
  }, [toolActive, capture, setSelection])

  function close() {
    setSelection({ calibrationCapture: null })
    setTool('select')
  }

  function handleApply() {
    if (!underlay?.naturalSize) {
      close()
      return
    }
    const known = Number(lengthFt)
    if (!Number.isFinite(known) || known <= 0) {
      toast.error('Enter a positive length in feet.')
      return
    }
    let calibration = null
    if (mode === 'two-click' && haveBothPoints) {
      calibration = buildCalibration(capture.p1Px, capture.p2Px, known)
    } else {
      // Full-width fallback — use image left edge → right edge.
      calibration = buildCalibration(
        { x: 0,                          y: 0 },
        { x: underlay.naturalSize.wPx,   y: 0 },
        known,
      )
    }
    if (!calibration) {
      toast.error('Could not compute calibration — points may be coincident.')
      return
    }
    setUnderlayCalibration(calibration, currentFloorId)
    toast.success(`Calibrated — 1 px = ${calibration.inchesPerPixel.toFixed(4)} in`)
    close()
  }

  // Tool active but only ONE point clicked — render a tiny status hint
  // rather than opening the modal. Lets the user complete the second click.
  if (toolActive && capture?.p1Px && !capture?.p2Px) {
    return (
      <div style={{
        position: 'fixed',
        top: 80,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 'var(--z-toast)',
        background: 'var(--color-surface-raised)',
        color: 'var(--color-text)',
        padding: 'var(--space-2) var(--space-4)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md)',
        fontSize: 'var(--text-sm)',
      }}>
        First point captured at ({Math.round(capture.p1Px.x)},{' '}
        {Math.round(capture.p1Px.y)}) — click the second point. <br/>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
          Press Esc to cancel.
        </span>
      </div>
    )
  }

  if (!open) return null
  if (!underlay) {
    return (
      <Modal open onClose={close} title="No underlay loaded" width={420}
        footer={<Button onClick={close}>Close</Button>}>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
          Import a floor-plan PDF or image first (View &amp; Settings →
          Underlay → Import PDF / image).
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open onClose={close}
      title="Calibrate underlay scale"
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={handleApply}>Apply</Button>
        </>
      }
    >
      {/* Mode tab — switching wipes the captured points if user changes
          their mind. */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <Button
          size="sm"
          variant={mode === 'two-click' ? 'primary' : 'ghost'}
          onClick={() => setMode('two-click')}
          disabled={!haveBothPoints}
          title={haveBothPoints
            ? 'Use the two points you clicked on the canvas'
            : 'Click two reference points on the canvas first'}
        >
          Two clicked points
        </Button>
        <Button
          size="sm"
          variant={mode === 'full-width' ? 'primary' : 'ghost'}
          onClick={() => setMode('full-width')}
        >
          Full drawing width
        </Button>
      </div>

      {mode === 'two-click' && haveBothPoints && (() => {
        const dx = capture.p2Px.x - capture.p1Px.x
        const dy = capture.p2Px.y - capture.p1Px.y
        const distPx = Math.hypot(dx, dy)
        return (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)',
            marginBottom: 'var(--space-3)', lineHeight: 1.5 }}>
            Reference segment captured.
            <div style={{ marginTop: 'var(--space-1)', color: 'var(--color-text-muted)',
              fontSize: 'var(--text-xs)' }}>
              ({Math.round(capture.p1Px.x)}, {Math.round(capture.p1Px.y)}) →
              ({Math.round(capture.p2Px.x)}, {Math.round(capture.p2Px.y)}) ·
              {' '}{distPx.toFixed(1)} px
            </div>
          </div>
        )
      })()}

      {mode === 'full-width' && (
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)',
          marginBottom: 'var(--space-3)', lineHeight: 1.5 }}>
          Enter the real-world width that the imported drawing represents.
          <div style={{ marginTop: 'var(--space-1)', color: 'var(--color-text-muted)',
            fontSize: 'var(--text-xs)' }}>
            Image dimensions: {underlay.naturalSize.wPx} × {underlay.naturalSize.hPx} px
            {underlay.originalFileName && <> · {underlay.originalFileName}</>}
          </div>
        </div>
      )}

      <Field label={mode === 'two-click' ? 'Distance between clicked points' : 'Full drawing width'}>
        <FeetInchesInput value={lengthFt} onChange={setLengthFt} autoFocus />
      </Field>

      {underlay.calibration && (
        <div style={{
          marginTop: 'var(--space-3)',
          padding: 'var(--space-2)',
          background: 'var(--color-bg-muted)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
        }}>
          Current calibration: 1 px = {underlay.calibration.inchesPerPixel.toFixed(4)} in
        </div>
      )}
    </Modal>
  )
}
