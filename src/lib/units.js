// Feet-inches formatter + parser + composite helpers.
//
// State always stores decimal feet (or inches for sub-foot things like wall
// thickness, beam section, slab thk). This module is the SINGLE source of
// truth for converting between machine numbers and the strings Indian
// construction engineers expect.
//
// Glyphs: ASCII apostrophe (') and straight double-quote (").
// Fractions: Unicode glyphs ¼ ½ ¾ at default precision='1/2' or '1/4'.
//
// Sub-foot rule — |x| < 1 ft renders as INCHES ONLY (`9"`, `4½"`, `0"`)
// never as `0'-9"`. Residential walls (9"), bedding (2"), beam section
// etc. read naturally that way.
//
// Public API:
//   formatFeetInches(decimalFt, opts?)         → string
//   parseFeetInches(input)                     → number | null
//   formatLength(decimalFt, unit, opts?)       → string  (mode-aware)
//   formatArea(sqFt, unit)                     → string
//   formatVolume(cuFt, unit)                   → string
//   formatCoord(xFt, yFt, unit)                → string
//   DEFAULT_PRECISION                          → frozen map per entity

export const DEFAULT_PRECISION = Object.freeze({
  wall:       '1/2',
  opening:    '1/2',
  height:     '1',
  foundation: '1/2',
  staircase:  '1/2',
  display:    '1/2',
})

const FRACTION_GLYPHS = Object.freeze({
  '1/4': '¼',
  '1/2': '½',
  '3/4': '¾',
})

function _denominatorFor(precision) {
  switch (precision) {
    case '1':   return 1
    case '1/4': return 4
    case '1/2':
    default:    return 2
  }
}

// Round a value to the nearest 1/denominator.
function _roundToFraction(value, denominator) {
  return Math.round(value * denominator) / denominator
}

// Convert an inches value (possibly fractional, possibly carrying to 12)
// into a { whole, num, den } triple for rendering. Always positive input;
// caller handles sign.
function _splitInches(inchesValue, denominator) {
  const rounded = _roundToFraction(inchesValue, denominator)
  const whole = Math.floor(rounded)
  const frac  = rounded - whole
  if (frac === 0) return { whole, num: 0, den: 1 }
  // Reduce frac to lowest terms by checking against denominator scale.
  const num = Math.round(frac * denominator)
  const den = denominator
  // Lowest-terms reduce (only needed for 2/4 → 1/2 case).
  const g = _gcd(num, den)
  return { whole, num: num / g, den: den / g }
}

function _gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b)
  while (b) { [a, b] = [b, a % b] }
  return a || 1
}

// Format the inch part as "N", "N½", "½", etc.
function _renderInches(inchesValue, denominator) {
  const { whole, num, den } = _splitInches(inchesValue, denominator)
  if (num === 0) return `${whole}`
  const glyph = FRACTION_GLYPHS[`${num}/${den}`] ?? `${num}/${den}`
  return whole === 0 ? glyph : `${whole}${glyph}`
}

/**
 * formatFeetInches(decimalFt, opts?) → string
 *
 * Renders a decimal-feet measurement as a feet-inches string. Returns ""
 * for nullish / NaN inputs so callers can fall back to a placeholder.
 */
export function formatFeetInches(decimalFt, opts = {}) {
  if (decimalFt === null || decimalFt === undefined) return ''
  const n = Number(decimalFt)
  if (!Number.isFinite(n)) return ''
  const precision   = opts.precision ?? '1/2'
  const denominator = _denominatorFor(precision)
  const sign = n < 0 ? '−' : ''
  const abs  = Math.abs(n)

  // Sub-foot rule: render as inches only — UNLESS rounding lands on 12"
  // (e.g. 0.999 ft at precision 1/2 rounds to 12" → must carry to 1'-0").
  if (abs < 1) {
    const inchesValue = abs * 12
    const roundedInches = _roundToFraction(inchesValue, denominator)
    if (roundedInches < 12) {
      const rendered = _renderInches(inchesValue, denominator)
      return `${sign}${rendered}"`
    }
    // 12" rollup: fall through to ≥ 1ft path with feet=1, inches=0.
  }

  // ≥ 1 ft path. Split into feet + inches, handle 12" rollup.
  let feet = Math.floor(abs)
  let inchesValue = (abs - feet) * 12
  // Round inches with the precision; if it lands on 12, carry to feet.
  const rounded = _roundToFraction(inchesValue, denominator)
  if (rounded >= 12) {
    feet += Math.floor(rounded / 12)
    inchesValue = rounded - Math.floor(rounded / 12) * 12
  } else {
    inchesValue = rounded
  }
  const inchesStr = _renderInches(inchesValue, denominator)
  return `${sign}${feet}'-${inchesStr}"`
}

// ── Parser ──────────────────────────────────────────────────────────────
//
// Accepts every reasonable user form (decimal, feet-only, inches-only,
// feet+inches with fraction, dash or space separator, unicode fractions).
// Returns decimal feet or null when unparseable.

// Normalize unicode fraction glyphs to ASCII "1/2" form for the regex.
const UNICODE_FRACTIONS = Object.freeze({
  '¼': '1/4', '½': '1/2', '¾': '3/4',
  '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8',
  '⅓': '1/3', '⅔': '2/3',
})

function _normalizeUnicode(s) {
  let out = s
  for (const [glyph, ascii] of Object.entries(UNICODE_FRACTIONS)) {
    out = out.split(glyph).join(' ' + ascii)
  }
  // Replace various unicode minus / dash variants with ASCII.
  out = out.replace(/[−–—]/g, '-')
  // Replace curly quotes with straight.
  out = out.replace(/[’′]/g, "'").replace(/[”″]/g, '"')
  return out
}

/**
 * parseFeetInches(input) → number | null
 *
 * See module docstring for accepted forms.
 */
export function parseFeetInches(input) {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') return Number.isFinite(input) ? input : null
  let s = String(input).trim()
  if (s === '') return null
  s = _normalizeUnicode(s)
  // Strip trailing "ft" / "in" tokens (we infer unit from punctuation instead).
  // But we keep ' and " markers.
  // Bare decimal short-circuit: "10", "10.5", "-3.25" → feet directly.
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const v = Number(s)
    return Number.isFinite(v) ? v : null
  }
  // Bare "Nft" → feet.
  const ftOnly = s.match(/^(-?\d+(?:\.\d+)?)\s*ft$/i)
  if (ftOnly) return Number(ftOnly[1])
  // Bare "Nin" → inches (sub-foot).
  const inOnly = s.match(/^(-?\d+(?:\.\d+)?(?:\s+\d+\/\d+)?)\s*in$/i)
  if (inOnly) return _inchesExprToFeet(inOnly[1])

  // Main regex: optional sign, optional feet+', optional inches+",
  // optional fraction inside inches.
  // Examples it matches:
  //   10'         → feet=10
  //   10'-6"      → feet=10, inches=6
  //   10' 6"      → feet=10, inches=6
  //   10'-6 1/2"  → feet=10, inches=6.5
  //   6"          → inches=6
  //   1/2"        → inches=0.5
  //   0'-9"       → feet=0,  inches=9 (sub-foot via explicit 0')
  const re = /^(-)?\s*(?:(\d+(?:\.\d+)?)\s*')?\s*[-\s]?\s*(?:(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?\s*")?\s*$/
  const m = s.match(re)
  if (!m) return null
  const [, signRaw, feetRaw, inWholeRaw, fracNumRaw, fracDenRaw] = m
  // Reject empty (regex matches empty string).
  if (feetRaw === undefined && inWholeRaw === undefined && fracNumRaw === undefined) return null
  const feet = feetRaw  !== undefined ? Number(feetRaw)  : 0
  let inches = inWholeRaw !== undefined ? Number(inWholeRaw) : 0
  if (fracNumRaw !== undefined && fracDenRaw !== undefined) {
    const den = Number(fracDenRaw)
    if (!den) return null
    inches += Number(fracNumRaw) / den
  }
  const sign = signRaw === '-' ? -1 : 1
  return sign * (feet + inches / 12)
}

// Internal: "6", "6 1/2", "0.5" → inches as decimal → feet.
function _inchesExprToFeet(expr) {
  const parts = expr.trim().split(/\s+/)
  let inches = 0
  for (const p of parts) {
    if (p.includes('/')) {
      const [n, d] = p.split('/').map(Number)
      if (!d) return null
      inches += n / d
    } else {
      const v = Number(p)
      if (!Number.isFinite(v)) return null
      inches += v
    }
  }
  return inches / 12
}

// ── Composite formatters (unit-mode aware) ──────────────────────────────

function _round2(n) { return Math.round(n * 100) / 100 }

/**
 * formatLength(decimalFt, unit, opts?) → string
 *   unit='ft'    → "10.5 ft"
 *   unit='ft-in' → "10'-6""
 *   unit='m'     → "3.20 m"
 */
export function formatLength(decimalFt, unit = 'ft', opts = {}) {
  if (decimalFt === null || decimalFt === undefined) return ''
  const n = Number(decimalFt)
  if (!Number.isFinite(n)) return ''
  if (unit === 'm')     return `${_round2(n * 0.3048)} m`
  if (unit === 'ft-in') return formatFeetInches(n, opts)
  return `${_round2(n)} ft`
}

/**
 * formatArea(sqFt, unit) → string
 *   'ft' / 'ft-in' → "320 Sft"
 *   'm'            → "29.73 m²"
 */
export function formatArea(sqFt, unit = 'ft') {
  if (sqFt === null || sqFt === undefined) return ''
  const n = Number(sqFt)
  if (!Number.isFinite(n)) return ''
  if (unit === 'm') return `${_round2(n * 0.0929)} m²`
  return `${_round2(n)} Sft`
}

/**
 * formatVolume(cuFt, unit) → string
 *   'ft' / 'ft-in' → "14 Cft"
 *   'm'            → "0.40 m³"
 */
export function formatVolume(cuFt, unit = 'ft') {
  if (cuFt === null || cuFt === undefined) return ''
  const n = Number(cuFt)
  if (!Number.isFinite(n)) return ''
  if (unit === 'm') return `${_round2(n * 0.0283)} m³`
  return `${_round2(n)} Cft`
}

/**
 * formatCoord(xFt, yFt, unit) → string
 *   'ft'    → "12.50 ft, 8.75 ft"
 *   'ft-in' → "12'-6", 8'-9""
 *   'm'     → "3.81 m, 2.67 m"
 */
export function formatCoord(xFt, yFt, unit = 'ft') {
  return `${formatLength(xFt, unit)}, ${formatLength(yFt, unit)}`
}

// Format inches directly (for wall.thickness, beam section, slab thk —
// values stored in inches in the underlying entity).
export function formatInches(inchesValue, opts = {}) {
  if (inchesValue === null || inchesValue === undefined) return ''
  const n = Number(inchesValue)
  if (!Number.isFinite(n)) return ''
  const denominator = _denominatorFor(opts.precision ?? '1/2')
  const sign = n < 0 ? '−' : ''
  const abs = Math.abs(n)
  return `${sign}${_renderInches(abs, denominator)}"`
}

// Parse an inch-only string ("9"", "4½"", "6 1/2", "9") → inches.
// Accepts: bare decimal, "N", "N.M", "N M/D", "N½", "N\"", "N M/D\"".
export function parseInches(input) {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') return Number.isFinite(input) ? input : null
  let s = String(input).trim()
  if (s === '') return null
  s = _normalizeUnicode(s)
  // Strip trailing " or "in" — they're confirmation, not data.
  s = s.replace(/"\s*$/, '').replace(/\s*in\s*$/i, '').trim()
  if (s === '') return null
  // Bare decimal — primary case.
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  // Mixed "N M/D" form (e.g. "4 1/2", normalized from "4½").
  const mixed = s.match(/^(-?)(\d+(?:\.\d+)?)?\s*(?:(\d+)\/(\d+))?$/)
  if (mixed) {
    const [, sign, wholeRaw, numRaw, denRaw] = mixed
    if (wholeRaw === undefined && numRaw === undefined) return null
    const whole = wholeRaw ? Number(wholeRaw) : 0
    const frac  = (numRaw && denRaw) ? Number(numRaw) / Number(denRaw) : 0
    return (sign === '-' ? -1 : 1) * (whole + frac)
  }
  // Fall through: maybe a feet-inches form smuggled in. Return null
  // (caller should use parseFeetInches for those).
  return null
}

// ── Defensive unit-mode normalization ────────────────────────────────────
//
// Saved projects from before the 'ft-in' mode existed have unit='ft'.
// Imported / corrupted state may have undefined, null, '', or junk
// strings. Normalize ALL of these to a valid mode before passing to
// any formatter. Used by useUnits hook and export paths.

export function normalizeUnitMode(unit) {
  return unit === 'm' || unit === 'ft-in' ? unit : 'ft'
}

// ── formatQuantity — single quantity renderer for BOQ / PDF / Excel ──────
//
// Linear quantities (Rft / FT) become feet-inches in ft-in mode;
// areas (Sft / FT2) and volumes (Cft / FT3) stay as-is in ft modes,
// convert to m² / m³ in metric mode.
//
// `unitType` is one of the strings from src/constants/units.js (UNITS).
// `displayMode` is the user preference ('ft' | 'ft-in' | 'm').
//
// This is the SINGLE renderer that BOQ panel, PDF export, Excel export,
// CSV export should call so display stays in lock-step everywhere.

export function formatQuantity(value, unitType, displayMode = 'ft') {
  const mode = normalizeUnitMode(displayMode)
  if (value === null || value === undefined) return ''
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  switch (unitType) {
    // Lengths — feet-inches in ft-in mode, metric, decimal otherwise.
    case 'Rft':
    case 'ft':
      return formatLength(n, mode)
    // Areas
    case 'Sft':
    case 'ft²':
      return formatArea(n, mode)
    // Volumes
    case 'Cft':
    case 'ft³':
      return formatVolume(n, mode)
    case 'm³':
      // Already metric; bypass mode.
      return `${_round2(n)} m³`
    // Inches (sub-foot dimensions).
    case 'in':
      return formatInches(n)
    // Counts / mass / bags — pass-through.
    case 'nos':
      return n.toLocaleString('en-IN')
    case 'kg':
      return `${_round2(n)} kg`
    case 'bags':
      return `${_round2(n)} bags`
    default:
      return `${_round2(n)} ${unitType}`
  }
}
