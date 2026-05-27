// scripts/verify-underlay.mjs
//
// Phase 4 Tier-2 Step 19. Covers:
//   - Pure calibration math round-trip (10 sample distances)
//   - buildCalibration shape + null on invalid input
//   - renderDimensionsInches respects calibration
//   - Underlay state setter round-trips via the live store
//   - Asset deletion removes the IDB record
//
// Pure Node — no DOM. Uses the in-memory storage adapter exposed by
// indexedDb.js for the assets coverage.

import {
  computeInchesPerPixel,
  buildCalibration,
  renderDimensionsInches,
  DEFAULT_PLACEMENT,
} from '../src/underlay/calibration.js'
import {
  storeAsset, getAsset, deleteAsset, ASSET_TYPES,
} from '../src/projects/storage/assets.js'
import { makeMemoryAdapter } from '../src/projects/storage/indexedDb.js'
import { useStore } from '../src/store.js'

const passed = []
const failed = []
function check(name, cond, info) {
  (cond ? passed : failed).push(`${name}${info ? '  (' + info + ')' : ''}`)
}

// ── 1. computeInchesPerPixel ────────────────────────────────────────
// 10-sample round trip — pick a length, derive ipp, re-derive length.
const samples = [
  { p1: { x: 0, y: 0 },   p2: { x: 100, y: 0 },   knownFt: 10 },
  { p1: { x: 0, y: 0 },   p2: { x: 0,   y: 100 }, knownFt: 10 },
  { p1: { x: 0, y: 0 },   p2: { x: 300, y: 400 }, knownFt: 50 },   // hypot = 500
  { p1: { x: 10, y: 20 }, p2: { x: 110, y: 20 },  knownFt: 14 },
  { p1: { x: 5, y: 5 },   p2: { x: 305, y: 5 },   knownFt: 30 },
  { p1: { x: 0, y: 0 },   p2: { x: 50, y: 0 },    knownFt: 7.5 },
  { p1: { x: 0, y: 0 },   p2: { x: 200, y: 0 },   knownFt: 14.5 },
  { p1: { x: 1, y: 1 },   p2: { x: 101, y: 1 },   knownFt: 12 },
  { p1: { x: 0, y: 0 },   p2: { x: 600, y: 800 }, knownFt: 100 },  // hypot 1000
  { p1: { x: 0, y: 0 },   p2: { x: 250, y: 0 },   knownFt: 25 },
]
for (let i = 0; i < samples.length; i++) {
  const { p1, p2, knownFt } = samples[i]
  const ipp = computeInchesPerPixel(p1, p2, knownFt)
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
  const derivedFt = (ipp * dist) / 12
  const err = Math.abs(derivedFt - knownFt)
  check(`sample ${i + 1}: round-trip within 1e-9 ft`,
        err < 1e-9, `err=${err}`)
}

// ── 2. Edge cases ───────────────────────────────────────────────────
check('computeInchesPerPixel returns null for coincident points',
      computeInchesPerPixel({ x: 5, y: 5 }, { x: 5, y: 5 }, 10) === null)
check('computeInchesPerPixel returns null for zero length',
      computeInchesPerPixel({ x: 0, y: 0 }, { x: 100, y: 0 }, 0) === null)
check('computeInchesPerPixel returns null for negative length',
      computeInchesPerPixel({ x: 0, y: 0 }, { x: 100, y: 0 }, -5) === null)
check('computeInchesPerPixel returns null for NaN coord',
      computeInchesPerPixel({ x: NaN, y: 0 }, { x: 100, y: 0 }, 10) === null)
check('computeInchesPerPixel returns null for missing point',
      computeInchesPerPixel(null, { x: 100, y: 0 }, 10) === null)

// ── 3. buildCalibration ─────────────────────────────────────────────
const cal = buildCalibration({ x: 0, y: 0 }, { x: 100, y: 0 }, 10)
check('buildCalibration returns a frozen record',
      cal && Object.isFrozen(cal))
check('buildCalibration sets p1Px + p2Px',
      cal.p1Px.x === 0 && cal.p2Px.x === 100)
check('buildCalibration carries knownLengthFt',
      cal.knownLengthFt === 10)
check('buildCalibration derives inchesPerPixel correctly (10ft / 100px = 1.2)',
      Math.abs(cal.inchesPerPixel - 1.2) < 1e-9, `got ${cal.inchesPerPixel}`)
check('buildCalibration returns null on invalid input',
      buildCalibration({ x: 0, y: 0 }, { x: 0, y: 0 }, 10) === null)

// ── 4. renderDimensionsInches ───────────────────────────────────────
const underlayA = {
  naturalSize: { wPx: 800, hPx: 600 },
  calibration: { inchesPerPixel: 2 },
}
const dims = renderDimensionsInches(underlayA)
check('renderDimensionsInches: wIn = wPx × ipp', dims.wIn === 1600)
check('renderDimensionsInches: hIn = hPx × ipp', dims.hIn === 1200)
const noCalibDims = renderDimensionsInches({ naturalSize: { wPx: 100, hPx: 50 } })
check('renderDimensionsInches: uncalibrated falls back to 1:1',
      noCalibDims.wIn === 100 && noCalibDims.hIn === 50)
check('renderDimensionsInches: null underlay returns zeros',
      renderDimensionsInches(null).wIn === 0)

// ── 5. DEFAULT_PLACEMENT ────────────────────────────────────────────
check('DEFAULT_PLACEMENT is frozen',  Object.isFrozen(DEFAULT_PLACEMENT))
check('DEFAULT_PLACEMENT.xIn === 0',  DEFAULT_PLACEMENT.xIn === 0)
check('DEFAULT_PLACEMENT.yIn === 0',  DEFAULT_PLACEMENT.yIn === 0)
check('DEFAULT_PLACEMENT.rotationDeg === 0', DEFAULT_PLACEMENT.rotationDeg === 0)

// ── 6. Per-floor underlay round-trip (FIX 3) ─────────────────────────
// Underlay now lives on each floor: projectSettings.floors[i].underlay.
// Setters take an optional floorId (defaulting to currentFloorId).
// getFloorUnderlay(floorId?) is the canonical read.

function _floorUnderlay(state, floorId) {
  const fid = floorId ?? state.currentFloorId
  return state.projectSettings?.floors?.find(f => f.id === fid)?.underlay ?? null
}

const s0 = useStore.getState()
const F1 = s0.currentFloorId
check('store starts with no underlay on the base floor',
      _floorUnderlay(s0) == null)

s0.setUnderlay({
  kind: 'image',
  storageKey: 'tmp::key',
  originalFileName: 'plan.png',
  naturalSize: { wPx: 800, hPx: 600 },
  placement: { ...DEFAULT_PLACEMENT },
  calibration: null,
  opacity: 0.35,
  visible: true,
})
const s1 = useStore.getState()
check('setUnderlay sets the record on the current floor',
      _floorUnderlay(s1)?.kind === 'image' &&
      _floorUnderlay(s1)?.storageKey === 'tmp::key')
check('getFloorUnderlay() returns the same record',
      s1.getFloorUnderlay()?.storageKey === 'tmp::key')

s1.setUnderlayCalibration(cal)
const s2 = useStore.getState()
check('setUnderlayCalibration writes calibration',
      _floorUnderlay(s2).calibration?.inchesPerPixel === 1.2)

s2.setUnderlayPlacement({ xIn: 100 })
const s3 = useStore.getState()
check('setUnderlayPlacement deep-merges xIn',
      _floorUnderlay(s3).placement.xIn === 100 &&
      _floorUnderlay(s3).placement.yIn === 0)

s3.setUnderlayOpacity(0.7)
const s4 = useStore.getState()
check('setUnderlayOpacity stores in [0.05, 1]',
      _floorUnderlay(s4).opacity === 0.7)

s4.setUnderlayOpacity(5)
const s5 = useStore.getState()
check('setUnderlayOpacity clamps to 1',
      _floorUnderlay(s5).opacity === 1)

s5.setUnderlayOpacity(0)
const s6 = useStore.getState()
check('setUnderlayOpacity clamps lower bound to 0.05',
      _floorUnderlay(s6).opacity === 0.05)

s6.setUnderlayVisible(false)
const s7 = useStore.getState()
check('setUnderlayVisible toggles visible',
      _floorUnderlay(s7).visible === false)

// ── Per-floor isolation: a second floor's underlay does not leak ─────
const newFloorId = s7.addFloor()
const s7b = useStore.getState()
check('addFloor injects underlay: null on the new floor',
      _floorUnderlay(s7b, newFloorId) === null)

s7b.setUnderlay({
  kind: 'image',
  storageKey: 'tmp::key-floor-2',
  originalFileName: 'second.png',
  naturalSize: { wPx: 400, hPx: 300 },
  placement: { ...DEFAULT_PLACEMENT },
  calibration: null,
  opacity: 0.5,
  visible: true,
}, newFloorId)
const s7c = useStore.getState()
check('per-floor: floor 2 carries its own underlay',
      _floorUnderlay(s7c, newFloorId)?.storageKey === 'tmp::key-floor-2')
check('per-floor: floor 1 underlay is untouched by floor 2 writes',
      _floorUnderlay(s7c, F1)?.storageKey === 'tmp::key')

s7c.clearUnderlay(newFloorId)
const s7d = useStore.getState()
check('clearUnderlay(floor 2) leaves floor 1 underlay alone',
      _floorUnderlay(s7d, newFloorId) === null &&
      _floorUnderlay(s7d, F1)?.storageKey === 'tmp::key')

s7d.clearUnderlay()   // default → current floor (F1)
const s8 = useStore.getState()
check('clearUnderlay() nulls the current floor record',
      _floorUnderlay(s8) === null)

// ── 7. Asset round-trip through the in-memory storage ──────────────
const adapter = makeMemoryAdapter()
const key = await storeAsset(adapter, 'pproj', ASSET_TYPES.UNDERLAY,
  new Uint8Array([1, 2, 3]),
  { mimeType: 'image/png', naturalSize: { wPx: 200, hPx: 100 } })
const rec = await getAsset(adapter, key)
check('verify-underlay: storeAsset → getAsset round-trip',
      rec?.naturalSize?.wPx === 200 && rec.mimeType === 'image/png')
const removed = await deleteAsset(adapter, key)
check('verify-underlay: deleteAsset removes the asset',
      removed === true && (await getAsset(adapter, key)) === null)

console.log(`\nPASSED: ${passed.length}`)
for (const p of passed) console.log(`   ${p}`)
if (failed.length > 0) {
  console.log(`\nFAILED:`)
  for (const f of failed) console.log(`   ${f}`)
  process.exit(1)
}
console.log('\n✓ verify-underlay passed.')
