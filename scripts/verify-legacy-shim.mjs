// scripts/verify-legacy-shim.mjs
//
// Arch 1 Correction 5 (C5) — kill-switch enforcement for the legacy
// state accessor shim.
//
// After SHIM_KILL_BY date, the LEGACY_ACCESSORS list MUST be empty
// (every accessor has been migrated to its real slice). This script
// fails CI when the date passes with any entry still defined.
//
// Pre-kill-date behavior: the script PASSES and lists how many days
// remain. The shim is allowed to exist until migration completes.

import {
  LEGACY_ACCESSORS, SHIM_KILL_BY,
} from '../src/store/legacyAccessors.js'

const passed = []
const failed = []
function check(name, cond, info) {
  (cond ? passed : failed).push(`${name}${info ? '  (' + info + ')' : ''}`)
}

const today = new Date()
const killDate = new Date(SHIM_KILL_BY)

check('SHIM_KILL_BY parses as valid date',
      !Number.isNaN(killDate.getTime()),
      `got "${SHIM_KILL_BY}"`)

const msPerDay = 86_400_000
const daysRemaining = Math.floor((killDate - today) / msPerDay)
const expired = today > killDate

// Pre-kill-date: report status, no failure.
// Post-kill-date: enforce empty accessor list.
if (!expired) {
  passed.push(`Kill-switch valid: ${daysRemaining} days until ${SHIM_KILL_BY}`)
  passed.push(`Legacy accessors registered: ${LEGACY_ACCESSORS.length}`)
  // Surface a status banner so reviewers see migration progress.
  console.log(`\n📅 Legacy shim kill-switch: ${SHIM_KILL_BY} (${daysRemaining} days remaining)`)
  console.log(`    ${LEGACY_ACCESSORS.length} legacy accessors still registered`)
  if (LEGACY_ACCESSORS.length > 30) {
    console.log(`    → migration in progress; reduce before ${SHIM_KILL_BY}`)
  } else if (LEGACY_ACCESSORS.length > 0) {
    console.log(`    → close to clean; ${LEGACY_ACCESSORS.length} accessors remain`)
  }
} else {
  // Past the date — accessor list must be empty.
  if (LEGACY_ACCESSORS.length === 0) {
    passed.push(`Kill-switch passed cleanly: 0 legacy accessors remain`)
  } else {
    failed.push(
      `KILL-SWITCH EXPIRED: ${SHIM_KILL_BY} passed but ${LEGACY_ACCESSORS.length} legacy accessors still registered`,
    )
    for (const acc of LEGACY_ACCESSORS.slice(0, 10)) {
      failed.push(`   ${acc.path} (slice=${acc.slice}, killBy=${acc.killBy})`)
    }
    if (LEGACY_ACCESSORS.length > 10) {
      failed.push(`   ... and ${LEGACY_ACCESSORS.length - 10} more`)
    }
  }
}

// Each accessor entry must declare a killBy date.
const missingKillBy = LEGACY_ACCESSORS.filter(a => !a.killBy)
check('Every accessor declares killBy',
      missingKillBy.length === 0,
      missingKillBy.length ? `missing: ${missingKillBy.map(a => a.path).join(', ')}` : '')

// All accessor killBy dates equal SHIM_KILL_BY (one source).
const inconsistent = LEGACY_ACCESSORS.filter(a => a.killBy !== SHIM_KILL_BY)
check('Every accessor killBy === SHIM_KILL_BY (single source)',
      inconsistent.length === 0,
      inconsistent.length ? `mismatched: ${inconsistent.map(a => a.path).join(', ')}` : '')

console.log(`\nPASSED: ${passed.length}`)
for (const p of passed) console.log(`   ${p}`)
if (failed.length > 0) {
  console.log(`\nFAILED:`)
  for (const f of failed) console.log(`   ${f}`)
  process.exit(1)
}
console.log('\n✓ verify-legacy-shim passed.')
