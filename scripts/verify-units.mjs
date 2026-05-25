// Verification script for src/lib/units.js — formatter + parser + composites.
//
// Run via: node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-units.mjs

import {
  formatFeetInches, parseFeetInches,
  formatLength, formatArea, formatVolume, formatCoord,
  formatInches, parseInches,
} from '../src/lib/units.js'

let pass = 0, fail = 0
function eq(actual, expected, label) {
  const ok = actual === expected
  if (ok) { pass++; console.log(`  ✓ ${label}  → ${JSON.stringify(actual)}`) }
  else    { fail++; console.error(`  ✗ ${label}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`) }
}
function near(actual, expected, eps, label) {
  const ok = typeof actual === 'number' && Math.abs(actual - expected) <= eps
  if (ok) { pass++; console.log(`  ✓ ${label}  → ${actual}`) }
  else    { fail++; console.error(`  ✗ ${label}\n      expected: ${expected} ±${eps}\n      actual:   ${actual}`) }
}
function isNull(actual, label) {
  if (actual === null) { pass++; console.log(`  ✓ ${label}  → null`) }
  else                 { fail++; console.error(`  ✗ ${label} expected null, got ${JSON.stringify(actual)}`) }
}

console.log('\n── formatFeetInches — whole feet ─────────────────')
eq(formatFeetInches(10),     `10'-0"`,    'whole 10')
eq(formatFeetInches(0),      `0"`,         'zero')
eq(formatFeetInches(1),      `1'-0"`,     'whole 1')

console.log('\n── formatFeetInches — half-inch precision (default) ──')
eq(formatFeetInches(10.5),   `10'-6"`,    '10.5 = 10\'-6"')
eq(formatFeetInches(10.375), `10'-4½"`,   '10.375 = 10\'-4½"')
eq(formatFeetInches(10.625), `10'-7½"`,   '10.625 = 10\'-7½"')

console.log('\n── formatFeetInches — sub-foot rule ──────────────')
eq(formatFeetInches(0.75),    `9"`,    '0.75 = 9"')
eq(formatFeetInches(0.5),     `6"`,    '0.5 = 6"')
eq(formatFeetInches(1/24),    `½"`,    '1/24 ft = ½"')
eq(formatFeetInches(0.0417),  `½"`,    '0.0417 ft ≈ ½" (rounded)')

console.log('\n── formatFeetInches — negative ────────────────────')
eq(formatFeetInches(-3.5),    `−3'-6"`,  '−3.5 = −3\'-6"')
eq(formatFeetInches(-0.75),   `−9"`,     '−0.75 = −9"')

console.log('\n── formatFeetInches — 12" rollup ──────────────────')
// At precision 1/2, 10 + 11.99 inches rounds to 12" → carry to 11'-0".
eq(formatFeetInches(10 + 11.99 / 12), `11'-0"`, '12" rollup at 1/2 precision')
eq(formatFeetInches(0.999), `1'-0"`, '0.999 ft → 1\'-0" (carry boundary)')

console.log('\n── formatFeetInches — negative sub-foot ───────────')
eq(formatFeetInches(-0.75), `−9"`, '−0.75 → −9"')
eq(formatFeetInches(-0.5),  `−6"`, '−0.5 → −6"')

console.log('\n── formatFeetInches — alternate precision ─────────')
eq(formatFeetInches(10.0625, { precision: '1/4' }), `10'-¾"`, '10.0625 at 1/4 → 10\'-¾"')
eq(formatFeetInches(10.5,    { precision: '1' }),   `10'-6"`, '10.5 at whole-inch')

console.log('\n── formatFeetInches — nullish ─────────────────────')
eq(formatFeetInches(null),       '', 'null → ""')
eq(formatFeetInches(undefined),  '', 'undefined → ""')
eq(formatFeetInches(NaN),        '', 'NaN → ""')

console.log('\n── parseFeetInches — bare numbers ─────────────────')
eq(parseFeetInches('10'),      10,     'bare 10')
eq(parseFeetInches('10.5'),    10.5,   'bare 10.5')
eq(parseFeetInches('-3.25'),  -3.25,  'bare -3.25')

console.log('\n── parseFeetInches — unit suffixes ────────────────')
eq(parseFeetInches('10ft'),    10,     '10ft')
eq(parseFeetInches("10'"),     10,     "10'")
near(parseFeetInches('9in'),   0.75,   1e-9, '9in → 0.75')
eq(parseFeetInches('9"'),      0.75,   '9" → 0.75')

console.log('\n── parseFeetInches — composite forms ──────────────')
eq(parseFeetInches(`10'6"`),    10.5,   '10\'6"')
eq(parseFeetInches(`10'-6"`),   10.5,   '10\'-6" (dash form)')
eq(parseFeetInches(`10' 6"`),   10.5,   '10\' 6" (space form)')
near(parseFeetInches(`10'-4 1/2"`), 10.375, 1e-9, '10\'-4 1/2"')
near(parseFeetInches(`10'-4½"`),    10.375, 1e-9, '10\'-4½" (unicode)')
eq(parseFeetInches(`0'-9"`),    0.75,   '0\'-9" → 0.75')
eq(parseFeetInches(`-3'-6"`),  -3.5,   '−3\'-6"')

console.log('\n── parseFeetInches — bad input ────────────────────')
isNull(parseFeetInches(''),       'empty')
isNull(parseFeetInches('abc'),    'garbage')
isNull(parseFeetInches('  '),     'whitespace')
isNull(parseFeetInches(null),     'null')
isNull(parseFeetInches(undefined),'undefined')

console.log('\n── round-trip ──────────────────────────────────────')
for (const x of [0, 0.5, 0.75, 1, 1.5, 3.5, 10.5, 10.375, -3.5]) {
  const str = formatFeetInches(x)
  const parsed = parseFeetInches(str)
  near(parsed, x, 0.05, `round-trip ${x} → "${str}" → ${parsed}`)
}

console.log('\n── formatLength — unit modes ──────────────────────')
eq(formatLength(10.5, 'ft'),    `10.5 ft`,   '10.5 in ft mode')
eq(formatLength(10.5, 'ft-in'), `10'-6"`,    '10.5 in ft-in mode')
eq(formatLength(10,   'm'),     `3.05 m`,    '10 ft → 3.05 m')

console.log('\n── formatArea / formatVolume ──────────────────────')
eq(formatArea(320, 'ft'),    `320 Sft`,    '320 ft² as Sft')
eq(formatArea(320, 'ft-in'), `320 Sft`,    '320 ft² in ft-in still Sft')
eq(formatArea(320, 'm'),     `29.73 m²`,   '320 ft² → m²')
eq(formatVolume(14, 'ft'),   `14 Cft`,     '14 ft³ as Cft')
eq(formatVolume(14, 'm'),    `0.4 m³`,     '14 ft³ → m³')

console.log('\n── formatCoord ────────────────────────────────────')
eq(formatCoord(12.5, 8.75, 'ft-in'), `12'-6", 8'-9"`, 'coord in ft-in')
eq(formatCoord(12.5, 8.75, 'ft'),    `12.5 ft, 8.75 ft`, 'coord in ft')

console.log('\n── formatInches / parseInches ─────────────────────')
eq(formatInches(9),    `9"`,    '9 inches')
eq(formatInches(4.5),  `4½"`,   '4.5 inches')
eq(formatInches(0),    `0"`,    '0 inches')
near(parseInches('9'),     9,    1e-9, 'parseInches 9')
near(parseInches('9"'),    9,    1e-9, 'parseInches 9"')
near(parseInches('4 1/2'), 4.5,  1e-9, 'parseInches 4 1/2')
near(parseInches('4½'),    4.5,  1e-9, 'parseInches 4½')

console.log(`\n══════════════════════════════════════════════════════`)
console.log(`Verify-units: ${pass} pass, ${fail} fail`)
console.log(`══════════════════════════════════════════════════════\n`)
process.exit(fail === 0 ? 0 : 1)
