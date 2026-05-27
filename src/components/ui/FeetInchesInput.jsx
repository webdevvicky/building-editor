// FeetInchesInput — controlled input that displays feet-inches on blur,
// raw decimal on focus, and round-trips through parseFeetInches on commit.
//
// State always stays in DECIMAL FEET. The component holds a local raw
// string for in-progress editing but never owns the canonical value.
//
// Props:
//   value         — committed decimal feet (number)
//   onCommit(ft)  — fires on blur / Enter when parsed value differs from `value`
//   min, max      — optional clamp applied after parse (numeric, in feet)
//   precision     — passed to formatFeetInches ('1/2' default)
//   disabled      — pass-through
//   placeholder   — pass-through (rendered when value is null/empty)
//   autoFocus     — pass-through
//   onKeyDown     — extra handler (Esc/etc. parent wants to observe)
//
// Behavior:
//   mount / value-change-while-unfocused → display = formatLength(value, unitMode)
//   focus                                 → display = bare decimal (eg "10.5"); select all
//   type                                  → display = raw user text (no parse)
//   blur / Enter                          → parse → onCommit(clamp) → re-format
//   Escape                                → revert + blur

import { useEffect, useRef, useState } from 'react'
import { parseFeetInches, formatFeetInches } from '../../lib/units.js'
import { useUnits } from '../../hooks/useUnits.js'

function _formatForDisplay(value, unit, precision) {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  if (unit === 'ft-in') return formatFeetInches(value, { precision })
  if (unit === 'm')     return `${Math.round(value * 0.3048 * 100) / 100}`
  return `${Math.round(value * 100) / 100}`
}

export default function FeetInchesInput(props) {
  const {
    value,
    onCommit,
    min = -Infinity,
    max = Infinity,
    precision = '1/2',
    disabled = false,
    placeholder = '',
    autoFocus = false,
    onKeyDown,
  } = props
  const { unit } = useUnits()
  const [raw, setRaw] = useState(() => _formatForDisplay(value, unit, precision))
  const focusedRef = useRef(false)
  const inputRef = useRef(null)

  // React silently swallows unknown props on user components. This guard
  // surfaces the integration mistake that caused BE-Bug-002 (CalibrationModal
  // passed onChange instead of onCommit).
  useEffect(() => {
    if (import.meta.env.DEV && 'onChange' in props) {
      // eslint-disable-next-line no-console
      console.error(
        '[FeetInchesInput] onChange is not supported. Use onCommit(ft) — fired on blur/Enter. See component contract.'
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-format when external value (or unit) changes — but ONLY when not
  // focused, so we don't clobber the user's in-progress typing.
  useEffect(() => {
    if (!focusedRef.current) {
      setRaw(_formatForDisplay(value, unit, precision))
    }
  }, [value, unit, precision])

  function handleFocus(e) {
    focusedRef.current = true
    // On focus, show bare decimal — much easier to edit than "10'-6"".
    if (value !== null && value !== undefined && Number.isFinite(value)) {
      const decimal = unit === 'm'
        ? `${Math.round(value * 0.3048 * 100) / 100}`
        : `${Math.round(value * 1000) / 1000}`
      setRaw(decimal)
    } else {
      setRaw('')
    }
    // Select all so the next keystroke replaces.
    requestAnimationFrame(() => {
      try { e.target.select() } catch {}
    })
  }

  function commit() {
    const parsed = parseFeetInches(raw)
    if (parsed === null) {
      // Unparseable — silently revert to last good value.
      setRaw(_formatForDisplay(value, unit, precision))
      return
    }
    // If unit is metres and user typed bare digits, treat as metres → feet.
    let asFeet = parsed
    if (unit === 'm' && !/['"]/.test(String(raw)) && /^-?\d/.test(String(raw))) {
      asFeet = Number(raw) / 0.3048
    }
    const clamped = Math.max(min, Math.min(max, asFeet))
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
