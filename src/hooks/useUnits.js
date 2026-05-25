// useUnits — single React entry-point to the unit preference + formatters.
//
// Every component that needs to display measurements imports this hook.
// Replaces the old pattern of pulling `state.unit` + inlining
// `if (unit === 'm') ...` everywhere.
//
// Returned object identity is stable while `unit` doesn't change, so
// passing { fmtLength, ... } into memoized children stays safe.

import { useMemo } from 'react'
import { useStore } from '../store'
import {
  formatLength, formatArea, formatVolume, formatCoord,
  formatFeetInches, formatInches, formatQuantity,
  parseFeetInches, parseInches, normalizeUnitMode,
} from '../lib/units.js'

export function useUnits() {
  const rawUnit = useStore(s => s.unit)
  const unit    = normalizeUnitMode(rawUnit)
  const setUnit = useStore(s => s.setUnit)
  return useMemo(() => ({
    unit, setUnit,
    fmtLength:  (ft, opts)  => formatLength(ft, unit, opts),
    fmtArea:    (ft2)       => formatArea(ft2, unit),
    fmtVolume:  (ft3)       => formatVolume(ft3, unit),
    fmtCoord:   (xFt, yFt)  => formatCoord(xFt, yFt, unit),
    fmtFeetIn:  (ft, opts)  => formatFeetInches(ft, opts),
    fmtInches:  (inches, opts) => formatInches(inches, opts),
    fmtQuantity: (value, unitType) => formatQuantity(value, unitType, unit),
    parseLength: parseFeetInches,
    parseInches: parseInches,
  }), [unit, setUnit])
}
