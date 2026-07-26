// scripts/verify-readonly-gate.mjs
//
// Verifies the generalized editor write gate (doc 48A Phase 0):
//   - HARD read-only (integrity / stale base) blocks the WHOLE sync tick
//     (isEditorHardReadOnly) so a blank/diverged canvas never overwrites good data,
//   - CONNECTION LOST (offline) surfaces the read-only banner + pauses uploads
//     (isEditorReadOnly) but is NOT hard (local accept keeps running → offline
//     durability preserved) and is RELEASABLE on reconnect,
//   - the hard latch is one-way and its reason outranks an offline notice.
//
// Pure Node: editorWriteGuard has no browser deps at import time.

import assert from 'node:assert'
import {
  engageEditorReadOnly,
  setEditorConnectionLost,
  isEditorReadOnly,
  isEditorHardReadOnly,
  isEditorConnectionLost,
  editorReadOnlyReason,
  subscribeEditorReadOnly,
  _resetEditorWriteGuard,
} from '../src/projects/editorWriteGuard.js'

let pass = 0, fail = 0
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}`) }
}

// 1. Clean start.
_resetEditorWriteGuard()
ok('starts clear (not read-only)', !isEditorReadOnly() && !isEditorHardReadOnly())

// 2. Connection loss → read-only SURFACE on, but NOT hard (local accept must continue).
let notified = 0
const unsub = subscribeEditorReadOnly(() => { notified++ })
setEditorConnectionLost(true)
ok('offline → isEditorReadOnly() true (banner + upload pause)', isEditorReadOnly())
ok('offline → isEditorHardReadOnly() FALSE (local accept preserved)', !isEditorHardReadOnly())
ok('offline → isEditorConnectionLost() true', isEditorConnectionLost())
ok('offline notified subscribers', notified >= 1)

// 3. Connection loss is RELEASABLE — reconnect clears it.
setEditorConnectionLost(false)
ok('reconnect → not read-only again', !isEditorReadOnly() && !isEditorConnectionLost())

// 4. Stale base / integrity → HARD latch: both surfaces on, and it is one-way.
engageEditorReadOnly('diverged base — reload')
ok('hard engage → isEditorHardReadOnly() true', isEditorHardReadOnly())
ok('hard engage → isEditorReadOnly() true', isEditorReadOnly())
ok('hard reason surfaced', editorReadOnlyReason() === 'diverged base — reload')
engageEditorReadOnly('a different reason')
ok('hard latch is one-way (first reason wins)', editorReadOnlyReason() === 'diverged base — reload')

// 5. Hard reason OUTRANKS an offline notice.
setEditorConnectionLost(true)
ok('hard reason outranks offline notice', editorReadOnlyReason() === 'diverged base — reload')

// 6. Clearing offline does NOT release the hard latch.
setEditorConnectionLost(false)
ok('hard latch survives an offline clear', isEditorHardReadOnly() && isEditorReadOnly())

unsub()
_resetEditorWriteGuard()

console.log(`\nverify-readonly-gate: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
