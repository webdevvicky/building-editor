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
  COS30, SIN30, DEFAULT_VIEW, DEFAULT_BASIS,
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
