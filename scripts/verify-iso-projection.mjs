// scripts/verify-iso-projection.mjs
//
// Sanity-check the parameterised iso projection.
//   1. At { azimuthDeg: 45, elevationDeg: 30 }, the new projection must
//      reproduce the historical fixed formula byte-for-byte (within 1e-9).
//   2. Cardinal azimuths (45/135/225/315) produce distinct, non-degenerate
//      bases.
//   3. viewForward returns the expected direction at the default view.
//   4. The basis returned by makeViewBasis is frozen + has the documented
//      shape so downstream code can rely on it.
//
// Usage: node scripts/verify-iso-projection.mjs

import {
  COS30, SIN30, DEFAULT_VIEW, DEFAULT_BASIS, TOP_VIEW_THRESHOLD_DEG,
  makeViewBasis, worldToIso, viewForward,
} from '../src/iso/projection.js'

const TOL = 1e-9
let pass = 0, fail = 0

function ok(label, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else      { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}

function approxEq(a, b, tol = TOL) {
  return Math.abs(a - b) <= tol
}

// ── 1. Default view reproduces fixed formula ─────────────────────────────
console.log('\n1. Default view (45/30) matches historical fixed formula')

const samples = [
  [0, 0, 0], [12, 0, 0], [0, 12, 0], [0, 0, 12],
  [12, 12, 0], [12, 0, 12], [0, 12, 12], [12, 12, 12],
  [-12, 0, 0], [0, -12, 0], [-12, -12, 24], [120, 240, 96],
]

const basis45_30 = makeViewBasis(DEFAULT_VIEW)
for (const [x, y, z] of samples) {
  const expectedSx =  (x - y) * COS30
  const expectedSy = -(x + y) * SIN30 - z
  const { sx, sy } = worldToIso(x, y, z, basis45_30)
  const okSx = approxEq(sx, expectedSx)
  const okSy = approxEq(sy, expectedSy)
  ok(
    `(${x},${y},${z}) → (${sx.toFixed(4)}, ${sy.toFixed(4)})`,
    okSx && okSy,
    `expected (${expectedSx.toFixed(4)}, ${expectedSy.toFixed(4)})`,
  )
}

// ── 2. DEFAULT_BASIS equals makeViewBasis(DEFAULT_VIEW) ─────────────────
console.log('\n2. DEFAULT_BASIS is preconfigured for the default view')
for (const [x, y, z] of samples.slice(0, 4)) {
  const a = worldToIso(x, y, z, DEFAULT_BASIS)
  const b = worldToIso(x, y, z, basis45_30)
  ok(
    `DEFAULT_BASIS matches makeViewBasis(DEFAULT_VIEW) at (${x},${y},${z})`,
    approxEq(a.sx, b.sx) && approxEq(a.sy, b.sy),
  )
}

// ── 3. worldToIso defaults to DEFAULT_BASIS when basis omitted ──────────
console.log('\n3. worldToIso(x,y,z) without basis uses DEFAULT_BASIS')
for (const [x, y, z] of samples.slice(0, 4)) {
  const a = worldToIso(x, y, z)
  const b = worldToIso(x, y, z, DEFAULT_BASIS)
  ok(`omitted-basis call equals explicit DEFAULT_BASIS at (${x},${y},${z})`,
     approxEq(a.sx, b.sx) && approxEq(a.sy, b.sy))
}

// ── 4. Cardinal azimuths produce distinct bases ─────────────────────────
console.log('\n4. NE/SE/SW/NW cardinals produce distinct projections')
const azimuths = [45, 135, 225, 315]
const projectionsAtUnitX = azimuths.map(az => {
  const b = makeViewBasis({ azimuthDeg: az, elevationDeg: 30 })
  return worldToIso(12, 0, 0, b)
})
for (let i = 0; i < azimuths.length; i++) {
  for (let j = i + 1; j < azimuths.length; j++) {
    const a = projectionsAtUnitX[i], b = projectionsAtUnitX[j]
    const distinct = !approxEq(a.sx, b.sx) || !approxEq(a.sy, b.sy)
    ok(`az=${azimuths[i]} vs az=${azimuths[j]} project (12,0,0) differently`,
       distinct,
       distinct ? '' : `both → (${a.sx}, ${a.sy})`)
  }
}

// ── 5. Elevation extremes behave monotonically on +Z point ──────────────
console.log('\n5. Elevation affects Z-mapping monotonically')
const elevations = [10, 30, 50, 70]
let prevSy = Infinity
let monotonic = true
for (const el of elevations) {
  const b = makeViewBasis({ azimuthDeg: 45, elevationDeg: el })
  const { sy } = worldToIso(0, 0, 12, b)
  if (sy > prevSy) { monotonic = false; break }
  prevSy = sy
}
ok('higher elevation does not move (0,0,+z) downward', monotonic)

// ── 6. viewForward returns the expected default direction ───────────────
console.log('\n6. viewForward(DEFAULT_BASIS) ≈ (1, 1, 0)')
const fwd = viewForward(DEFAULT_BASIS)
ok('forward.x ≈ 1', approxEq(fwd[0], 1))
ok('forward.y ≈ 1', approxEq(fwd[1], 1))
ok('forward.z ≈ 0', approxEq(fwd[2], 0))

// ── 6b. Top-view (el=90) uses true plan projection ──────────────────────
console.log('\n6b. Top-down preset (az=0, el=90) projects as plan view')
const topBasis = makeViewBasis({ azimuthDeg: 0, elevationDeg: 90 })
ok('right basis is non-zero (engineering-iso degeneracy avoided)',
   topBasis.right[0] !== 0 || topBasis.right[1] !== 0)
ok('right basis has zero z component',  topBasis.right[2]   === 0)
ok('up basis has zero z component',     topBasis.up[2]      === 0)
ok('forward axis points down (-z)',     topBasis.forward[2] === -1)
ok('forward axis has zero x',           topBasis.forward[0] === 0)
ok('forward axis has zero y',           topBasis.forward[1] === 0)

// At az=0, east (+x) should be screen-right, north (+y) should be screen-up.
const eastTop = worldToIso(12, 0, 0, topBasis)
ok('east (+x) projects to screen-right (positive sx)', eastTop.sx > 0)
ok('east (+x) projects on horizontal axis (sy ≈ 0)',   approxEq(eastTop.sy, 0))
const northTop = worldToIso(0, 12, 0, topBasis)
ok('north (+y) projects to screen-up (negative sy in SVG)', northTop.sy < 0)
ok('north (+y) projects on vertical axis (sx ≈ 0)',         approxEq(northTop.sx, 0))

// Z (elevation) should NOT shift the screen position in plan view —
// floors stack on top of each other geometrically, only the depth-sort
// distinguishes them.
const grndTop = worldToIso(36, 24, 0, topBasis)
const roofTop = worldToIso(36, 24, 240, topBasis)   // 20 ft up
ok('elevation does not displace plan-view (sx)', approxEq(grndTop.sx, roofTop.sx))
ok('elevation does not displace plan-view (sy)', approxEq(grndTop.sy, roofTop.sy))

// Threshold gate — anything just below TOP_VIEW_THRESHOLD_DEG should use
// the engineering-iso path (right basis depends on cos(el) and is non-zero).
const belowTop = makeViewBasis({ azimuthDeg: 45, elevationDeg: TOP_VIEW_THRESHOLD_DEG - 1 })
ok('just below threshold still uses engineering-iso path',
   belowTop.forward[2] === 0)   // engineering-iso forward has z=0

// ── 7. Basis is frozen ──────────────────────────────────────────────────
console.log('\n7. Returned basis is frozen')
ok('basis is frozen',  Object.isFrozen(basis45_30))
ok('basis.right is frozen', Object.isFrozen(basis45_30.right))
ok('basis.up is frozen',    Object.isFrozen(basis45_30.up))
ok('basis.forward is frozen', Object.isFrozen(basis45_30.forward))

// ── Summary ─────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60))
console.log(`PASS: ${pass}    FAIL: ${fail}`)
console.log('─'.repeat(60))
if (fail > 0) process.exit(1)
