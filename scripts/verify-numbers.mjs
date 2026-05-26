// scripts/verify-numbers.mjs
//
// Arch 8 (Phase 1) — guards against silent NaN propagation in BOQ math.
// safeR2 / safeRound / safeNum / safeClamp must return finite values for
// every input class.

import { safeR2, safeRound, safeNum, safeClamp } from '../src/lib/numbers.js'

const passed = []
const failed = []
function check(name, cond, info) {
  (cond ? passed : failed).push(`${name}${info ? '  (' + info + ')' : ''}`)
}

// ── safeR2 ─────────────────────────────────────────────────────────────────
check('safeR2(undefined) === 0',       safeR2(undefined) === 0)
check('safeR2(null) === 0',            safeR2(null) === 0)
check('safeR2(NaN) === 0',             safeR2(NaN) === 0)
check('safeR2(Infinity) === 0',        safeR2(Infinity) === 0)
check('safeR2(-Infinity) === 0',       safeR2(-Infinity) === 0)
check('safeR2(0) === 0',               safeR2(0) === 0)
check('safeR2(1) === 1',               safeR2(1) === 1)
// 1.005 is a famous JS floating-point edge: 1.005 * 100 = 100.4999...
// Math.round → 100 → 1.00. This matches the legacy r2 behavior and is
// what every BOQ aggregator has always returned. Documented here so
// future readers don't "fix" it.
check('safeR2(1.005) === 1 (FP edge)',  safeR2(1.005) === 1,
                                        `got ${safeR2(1.005)}`)
check('safeR2(1.006) === 1.01',         safeR2(1.006) === 1.01,
                                        `got ${safeR2(1.006)}`)
check('safeR2(1.005000001) === 1.01',   safeR2(1.005000001) === 1.01)
check('safeR2(-3.14159) === -3.14',    safeR2(-3.14159) === -3.14)
check('safeR2(0.999) === 1',           safeR2(0.999) === 1)
check('safeR2 propagates 2dp on big',  safeR2(12345.678) === 12345.68)
// Non-numeric input never crashes
check('safeR2("9") === 0 (string)',    safeR2('9') === 0)
check('safeR2({}) === 0 (object)',     safeR2({}) === 0)
check('safeR2([]) === 0 (array)',      safeR2([]) === 0)

// ── safeRound ──────────────────────────────────────────────────────────────
check('safeRound(undefined, 4) === 0', safeRound(undefined, 4) === 0)
check('safeRound(1.23456, 3) === 1.235', safeRound(1.23456, 3) === 1.235)
check('safeRound(0.6666, 0) === 1',    safeRound(0.6666, 0) === 1)
// Same FP edge as safeR2(1.005). safeRound default precision === 2.
check('safeRound default = 2 dp',      safeRound(1.005) === safeR2(1.005),
                                       `got ${safeRound(1.005)} vs safeR2 ${safeR2(1.005)}`)

// ── safeNum ────────────────────────────────────────────────────────────────
check('safeNum(undefined) === 0',      safeNum(undefined) === 0)
check('safeNum(undefined, 7) === 7',   safeNum(undefined, 7) === 7)
check('safeNum(NaN, 12) === 12',       safeNum(NaN, 12) === 12)
check('safeNum(3.14) === 3.14',        safeNum(3.14) === 3.14)
check('safeNum(-1, 5) === -1',         safeNum(-1, 5) === -1)

// ── safeClamp ──────────────────────────────────────────────────────────────
check('safeClamp(undefined, 0, 10) === 0', safeClamp(undefined, 0, 10) === 0)
check('safeClamp(NaN, 1, 10) === 1',   safeClamp(NaN, 1, 10) === 1)
check('safeClamp(5, 0, 10) === 5',     safeClamp(5, 0, 10) === 5)
check('safeClamp(-3, 0, 10) === 0',    safeClamp(-3, 0, 10) === 0)
check('safeClamp(99, 0, 10) === 10',   safeClamp(99, 0, 10) === 10)

// ── BONDING contract (runs at import time; this just confirms module loaded) ──
const { BONDING, BONDING_KEYS } = await import('../src/materials.js')
check('BONDING is frozen',             Object.isFrozen(BONDING))
check('BONDING_KEYS is frozen',        Object.isFrozen(BONDING_KEYS))
check('BONDING.CEMENT_SAND value',     BONDING.CEMENT_SAND === 'CEMENT_SAND_MORTAR')
check('BONDING.THIN_BED value',        BONDING.THIN_BED === 'THIN_BED_ADHESIVE')
check('BONDING_KEYS matches BONDING keys',
      BONDING_KEYS.length === Object.keys(BONDING).length &&
      BONDING_KEYS.every(k => k in BONDING))

console.log(`\nPASSED: ${passed.length}`)
for (const p of passed) console.log(`   ${p}`)
if (failed.length > 0) {
  console.log(`\nFAILED: ${failed.length}`)
  for (const f of failed) console.log(`   ${f}`)
  process.exit(1)
}
console.log('\n✓ verify-numbers passed.')
