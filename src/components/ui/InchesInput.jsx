// InchesInput — sibling of FeetInchesInput for values stored in INCHES
// (wall thickness, beam section, slab thk, PCC bedding, etc.).
//
// Display always reads as inches ("9"", "4½"", "6 1/2""). Storage is the
// raw inches number. Round-trips through parseInches.

import { useEffect, useRef, useState } from 'react'
import { parseInches, formatInches } from '../../lib/units.js'
import { useUnits } from '../../hooks/useUnits.js'

function _formatForDisplay(value, unit, precision) {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  if (unit === 'm') {
    // Inches → mm for metric mode.
    return `${Math.round(value * 25.4)}`
  }
  return formatInches(value, { precision })
}

export default function InchesInput({
  value,
  onCommit,
  min = 0,
  max = Infinity,
  precision = '1/2',
  disabled = false,
  placeholder = '',
  autoFocus = false,
  onKeyDown,
}) {
  const { unit } = useUnits()
  const [raw, setRaw] = useState(() => _formatForDisplay(value, unit, precision))
  const focusedRef = useRef(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!focusedRef.current) {
      setRaw(_formatForDisplay(value, unit, precision))
    }
  }, [value, unit, precision])

  function handleFocus(e) {
    focusedRef.current = true
    if (value !== null && value !== undefined && Number.isFinite(value)) {
      setRaw(unit === 'm' ? `${Math.round(value * 25.4)}` : `${Math.round(value * 100) / 100}`)
    } else {
      setRaw('')
    }
    requestAnimationFrame(() => { try { e.target.select() } catch {} })
  }

  function commit() {
    let parsed
    if (unit === 'm') {
      // Metric mode — interpret bare number as millimetres → inches.
      const v = Number(raw)
      parsed = Number.isFinite(v) ? v / 25.4 : null
    } else {
      parsed = parseInches(raw)
    }
    if (parsed === null) {
      setRaw(_formatForDisplay(value, unit, precision))
      return
    }
    const clamped = Math.max(min, Math.min(max, parsed))
    if (clamped !== value) onCommit?.(clamped)
    setRaw(_formatForDisplay(clamped, unit, precision))
  }

  function handleBlur() {
    focusedRef.current = false
    commit()
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
      inputRef.current?.blur()
    } else if (e.key === 'Escape') {
      setRaw(_formatForDisplay(value, unit, precision))
      inputRef.current?.blur()
    }
    e.stopPropagation()
    onKeyDown?.(e)
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      value={raw}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      onFocus={handleFocus}
      onChange={e => setRaw(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    />
  )
}
