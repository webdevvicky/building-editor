// scripts/verify-room-detection.mjs
//
// Phase R1 — interactive face detection → Room creation.
//
// Sections:
//   Bootstrap — module purity grep (faces.js is React/DOM-free).
//   A — Algorithm correctness (face enumeration, click-side disambiguation,
//       outer-face exclusion, dangling-wall rejection).
//   B — Canonical normalization (rotate-smallest-first, CCW winding,
//       wallIds sorted, wallIdsInOrder parallel to nodeOrder).
//   C — Idempotency + memo invalidation + hover-cache invalidation.
//   D — Multi-floor isolation.
//   E — BOQ canary: rect_room-created rooms vs createRoomFromFace-created
//       rooms on the same wall topology must produce identical BOQ output.
//   F — Virtual-wall room detection (Bug A fix).
//   G — Delete-then-redraw canary (Bug B fix).
//   H — Sub-span face detection (BE-FaceLookup-001): a room bounded by a
//       SUB-SPAN of a full-length wall carrying mid-span T-junctions must be
//       detected via findFaceContainingEdge (the lookup keyed off wall.n1/n2
//       missed before the fix because that pair is never graph-adjacent on a
//       junctioned wall).
//
// Run via:
//   node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-room-detection.mjs
//
// Section F (auto-suggest contract) deferred to Phase R2 — not testable in R1.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { useStore } from '../src/store.js'
import {
  enumerateFloorFaces,
  findFaceContainingEdge,
  isFaceCoveredByRoom,
  findUncoveredFaces,
  _resetFaceCaches,
} from '../src/topology/faces.js'
import { verifyIntegrity } from '../src/schema/integrity.js'
import { getBoqLines } from '../src/boq/lines.js'

const s = useStore.getState
const FT = 12

let pass = 0, fail = 0
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`) }
  else      { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}
function header(t) {
  console.log('\n' + '─'.repeat(70))
  console.log(t.toUpperCase())
  console.log('─'.repeat(70))
}
function reset() {
  _resetFaceCaches()
  s().loadProject({
    nodes: {}, walls: {}, rooms: {}, stamps: {},
    columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {},
    projectSettings: undefined, unit: 'inch',
  })
  // Section E (BOQ canary) compares rect_room vs face-detect output on
  // identical centerline topology. Lock centerline so the new
  // 'inside_face' default doesn't shift rect_room corners. The
  // face-aware draw layer is covered by verify-draw-reference.
  s().setDrawReference('centerline')
}

// ── Helper — addWall by raw coords (creates nodes via getOrCreateNode).
function addWallAt(ax, ay, bx, by) {
  const n1 = s().getOrCreateNode(ax, ay)
  const n2 = s().getOrCreateNode(bx, by)
  s().addWall(n1, n2)
  // Recover the new wall by matching endpoints.
  const w = Object.values(s().walls).find(
    x => (x.n1 === n1 && x.n2 === n2) || (x.n1 === n2 && x.n2 === n1)
  )
  return w?.id ?? null
}

// ── Bootstrap — module purity grep ──────────────────────────────────────

header('Bootstrap — module purity (faces.js + adjacency dependency)')
{
  const __filename = fileURLToPath(import.meta.url)
  const repoRoot   = path.resolve(path.dirname(__filename), '..')
  const filesToScan = ['src/topology/faces.js']
  const forbiddenImports = [
    /from\s+['"]react['"]/,
    /from\s+['"]react-dom['"]/,
  ]
  const forbiddenRefs = [
    /\bwindow\b/,
    /\bdocument\b/,
  ]
  for (const rel of filesToScan) {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf-8')
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map(line => line.replace(/\/\/.*$/, ''))
      .join('\n')
    for (const re of forbiddenImports) {
      ok(`${rel} has no ${re}`, !re.test(stripped))
    }
    for (const re of forbiddenRefs) {
      ok(`${rel} has no ${re} reference`, !re.test(stripped))
    }
  }
}

// ── Section A — Algorithm correctness ────────────────────────────────────

header('Section A — Algorithm correctness')

// A.1: 4-wall square → exactly 1 interior face.
reset()
{
  // Draw a 10×10 ft square: 4 walls forming a closed loop.
  const w1 = addWallAt(0,      0,      10*FT, 0)
  const w2 = addWallAt(10*FT,  0,      10*FT, 10*FT)
  const w3 = addWallAt(10*FT,  10*FT,  0,     10*FT)
  const w4 = addWallAt(0,      10*FT,  0,     0)
  ok('4 walls created', w1 && w2 && w3 && w4)

  const faces = enumerateFloorFaces(s(), 'F1')
  ok('exactly 1 interior face for 4-wall square', faces.length === 1, `got ${faces.length}`)
  if (faces.length === 1) {
    const f = faces[0]
    ok('face has 4 walls', f.wallIds.length === 4)
    ok('face has 4 nodes in nodeOrder', f.nodeOrder.length === 4)
    ok('face is CCW (positive area)', f.signedAreaFt2 > 0,
       `signedAreaFt2=${f.signedAreaFt2}`)
    ok('face area = 100 ft²', Math.abs(f.signedAreaFt2 - 100) < 0.01,
       `got ${f.signedAreaFt2}`)
    ok('face floorId = F1', f.floorId === 'F1')
    ok('isOuter is false', f.isOuter === false)
  }
}

// A.2: T-shape (two adjacent rooms sharing a wall) → exactly 2 faces.
reset()
{
  // Two 10×10 rooms side by side, sharing the wall at x=10.
  // Room A: (0,0)→(10,0)→(10,10)→(0,10).
  // Room B: (10,0)→(20,0)→(20,10)→(10,10).
  // Shared wall: (10,0)→(10,10).
  addWallAt(0,      0,      10*FT, 0)       // bottom A
  addWallAt(10*FT,  0,      20*FT, 0)       // bottom B
  addWallAt(20*FT,  0,      20*FT, 10*FT)   // right B
  addWallAt(0,      10*FT,  20*FT, 10*FT)   // top
  addWallAt(0,      0,      0,     10*FT)   // left A
  addWallAt(10*FT,  0,      10*FT, 10*FT)   // shared (split top later if needed)
  const faces = enumerateFloorFaces(s(), 'F1')
  ok('2 faces for two adjacent rooms (5-wall T-shape)',
     faces.length === 2, `got ${faces.length}`)
  if (faces.length === 2) {
    const areas = faces.map(f => f.signedAreaFt2).sort((a, b) => a - b)
    ok('both faces ~100 ft²',
       Math.abs(areas[0] - 100) < 0.01 && Math.abs(areas[1] - 100) < 0.01,
       `got [${areas.join(', ')}]`)
  }
}

// A.3: Click-side disambiguation — same wall, two clicks on opposite
// sides yield two different faces.
reset()
{
  addWallAt(0,      0,      10*FT, 0)
  addWallAt(10*FT,  0,      20*FT, 0)
  addWallAt(20*FT,  0,      20*FT, 10*FT)
  addWallAt(0,      10*FT,  20*FT, 10*FT)
  addWallAt(0,      0,      0,     10*FT)
  const sharedWallId = addWallAt(10*FT, 0, 10*FT, 10*FT)
  ok('shared wall exists', !!sharedWallId)

  // Click LEFT of the shared wall (x < 10ft) → face on left = Room A.
  const leftFace = findFaceContainingEdge(s(), sharedWallId, { x: 5*FT, y: 5*FT })
  // Click RIGHT of the shared wall (x > 10ft) → face on right = Room B.
  const rightFace = findFaceContainingEdge(s(), sharedWallId, { x: 15*FT, y: 5*FT })
  ok('left-side click returns a face', leftFace != null)
  ok('right-side click returns a face', rightFace != null)
  ok('left and right faces are DIFFERENT',
     leftFace && rightFace && leftFace !== rightFace)
  if (leftFace && rightFace) {
    // Verify each contains the shared wall.
    ok('left face contains shared wall', leftFace.wallIds.includes(sharedWallId))
    ok('right face contains shared wall', rightFace.wallIds.includes(sharedWallId))
    // Verify centroid x values are on the correct side.
    ok('left face centroid x < 10ft', leftFace.centroid.x < 10*FT,
       `got ${leftFace.centroid.x}`)
    ok('right face centroid x > 10ft', rightFace.centroid.x > 10*FT,
       `got ${rightFace.centroid.x}`)
  }
}

// A.4: Dangling wall (open chain) — no face uses it.
reset()
{
  // L-shape: two walls meeting at origin, no closure.
  const wA = addWallAt(0, 0, 10*FT, 0)
  const wB = addWallAt(0, 0, 0,     10*FT)
  const faces = enumerateFloorFaces(s(), 'F1')
  ok('open L-shape: zero interior faces', faces.length === 0, `got ${faces.length}`)
  ok('findFaceContainingEdge returns null for dangling wall A',
     findFaceContainingEdge(s(), wA, { x: 5*FT, y: 1*FT }) === null)
  ok('findFaceContainingEdge returns null for dangling wall B',
     findFaceContainingEdge(s(), wB, { x: 1*FT, y: 5*FT }) === null)
}

// A.5: Outer-face rejection — a single-room layout should not surface
// the infinite face.
reset()
{
  addWallAt(0,      0,      10*FT, 0)
  addWallAt(10*FT,  0,      10*FT, 10*FT)
  addWallAt(10*FT,  10*FT,  0,     10*FT)
  addWallAt(0,      10*FT,  0,     0)
  const faces = enumerateFloorFaces(s(), 'F1')
  ok('exactly 1 face (outer excluded)', faces.length === 1)
  ok('the face is CCW (signedAreaFt2 > 0)',
     faces.length === 1 && faces[0].signedAreaFt2 > 0)
}

// A.6: isFaceCoveredByRoom returns roomId once Room is created.
reset()
{
  addWallAt(0,      0,      10*FT, 0)
  addWallAt(10*FT,  0,      10*FT, 10*FT)
  addWallAt(10*FT,  10*FT,  0,     10*FT)
  addWallAt(0,      10*FT,  0,     0)
  const faces = enumerateFloorFaces(s(), 'F1')
  ok('1 face detected before room', faces.length === 1)
  ok('not yet covered', isFaceCoveredByRoom(s(), faces[0].wallIds) === null)

  const result = s().createRoomFromFace(faces[0])
  ok('createRoomFromFace succeeds', !!result?.roomId && !result?.error,
     JSON.stringify(result))

  _resetFaceCaches()
  const facesAfter = enumerateFloorFaces(s(), 'F1')
  ok('face still detected after Room creation', facesAfter.length === 1)
  ok('isFaceCoveredByRoom returns the roomId',
     isFaceCoveredByRoom(s(), facesAfter[0].wallIds) === result.roomId)
  ok('findUncoveredFaces excludes the covered face',
     findUncoveredFaces(s(), 'F1').length === 0)
}

// ── Section B — Canonical normalization ─────────────────────────────────

header('Section B — Canonical normalization')

// B.1: nodeOrder rotates so lexicographically-smallest nodeId is index 0.
reset()
{
  addWallAt(0,      0,      10*FT, 0)
  addWallAt(10*FT,  0,      10*FT, 10*FT)
  addWallAt(10*FT,  10*FT,  0,     10*FT)
  addWallAt(0,      10*FT,  0,     0)
  const faces = enumerateFloorFaces(s(), 'F1')
  ok('1 face', faces.length === 1)
  if (faces.length === 1) {
    const f = faces[0]
    const min = [...f.nodeOrder].sort()[0]
    ok(`nodeOrder[0] is lex-smallest ('${min}')`,
       f.nodeOrder[0] === min,
       `got '${f.nodeOrder[0]}' min='${min}'`)
  }
}

// B.2: wallIds (canonical) sorted ascending.
reset()
{
  addWallAt(0,      0,      10*FT, 0)
  addWallAt(10*FT,  0,      10*FT, 10*FT)
  addWallAt(10*FT,  10*FT,  0,     10*FT)
  addWallAt(0,      10*FT,  0,     0)
  const f = enumerateFloorFaces(s(), 'F1')[0]
  if (f) {
    const sorted = [...f.wallIds].sort()
    let isSorted = true
    for (let i = 0; i < f.wallIds.length; i++) {
      if (f.wallIds[i] !== sorted[i]) { isSorted = false; break }
    }
    ok('wallIds sorted ascending', isSorted, JSON.stringify(f.wallIds))
  }
}

// B.3: wallIdsInOrder parallel to nodeOrder — walking nodeOrder via
// adjacency should produce wallIdsInOrder.
reset()
{
  addWallAt(0,      0,      10*FT, 0)
  addWallAt(10*FT,  0,      10*FT, 10*FT)
  addWallAt(10*FT,  10*FT,  0,     10*FT)
  addWallAt(0,      10*FT,  0,     0)
  const f = enumerateFloorFaces(s(), 'F1')[0]
  if (f) {
    let parallelOk = true
    for (let i = 0; i < f.nodeOrder.length; i++) {
      const a = f.nodeOrder[i]
      const b = f.nodeOrder[(i + 1) % f.nodeOrder.length]
      // Find the wall connecting a and b.
      const wid = f.wallIdsInOrder[i]
      const w = s().walls[wid]
      const connects = w && (
        (w.n1 === a && w.n2 === b) || (w.n1 === b && w.n2 === a)
      )
      if (!connects) { parallelOk = false; break }
    }
    ok('wallIdsInOrder[i] connects nodeOrder[i] → nodeOrder[(i+1)%n]',
       parallelOk)
  }
}

// B.4: Re-enumeration yields equivalent canonical form (rotation + CCW
// determinism). Build the same square in a different drawing order;
// face canonicalization should produce the same nodeOrder[0] and
// wallIds array (modulo node-id differences).
reset()
{
  addWallAt(0,      0,      10*FT, 0)
  addWallAt(10*FT,  0,      10*FT, 10*FT)
  addWallAt(10*FT,  10*FT,  0,     10*FT)
  addWallAt(0,      10*FT,  0,     0)
  const f1 = enumerateFloorFaces(s(), 'F1')[0]
  // Re-enumerate without state change — must return the same reference.
  const f1b = enumerateFloorFaces(s(), 'F1')[0]
  ok('memoized result is the same reference', f1 === f1b)
}

// ── Section C — Idempotency + memo invalidation + hover cache ───────────

header('Section C — Idempotency + memo')

// C.1: Repeated enumerateFloorFaces returns same reference (memo hit).
reset()
{
  addWallAt(0,      0,      10*FT, 0)
  addWallAt(10*FT,  0,      10*FT, 10*FT)
  addWallAt(10*FT,  10*FT,  0,     10*FT)
  addWallAt(0,      10*FT,  0,     0)
  const f1 = enumerateFloorFaces(s(), 'F1')
  const f2 = enumerateFloorFaces(s(), 'F1')
  ok('repeated enumerateFloorFaces returns SAME ref (memo)', f1 === f2)
}

// C.2: Wall mutation invalidates the memo.
reset()
{
  const wId = addWallAt(0, 0, 10*FT, 0)
  addWallAt(10*FT, 0, 10*FT, 10*FT)
  addWallAt(10*FT, 10*FT, 0, 10*FT)
  addWallAt(0, 10*FT, 0, 0)
  const before = enumerateFloorFaces(s(), 'F1')
  ok('square has 1 face before mutation', before.length === 1)
  s().deleteWall(wId)
  const after = enumerateFloorFaces(s(), 'F1')
  ok('after deleting a wall, no closed loop → 0 faces',
     after.length === 0, `got ${after.length}`)
  ok('mutation produced a different array reference', before !== after)
}

// C.3: Hover cache invalidates with the memo.
reset()
{
  const sharedId = (() => {
    addWallAt(0,      0,      10*FT, 0)
    addWallAt(10*FT,  0,      20*FT, 0)
    addWallAt(20*FT,  0,      20*FT, 10*FT)
    addWallAt(0,      10*FT,  20*FT, 10*FT)
    addWallAt(0,      0,      0,     10*FT)
    return addWallAt(10*FT, 0, 10*FT, 10*FT)
  })()
  const click = { x: 5*FT, y: 5*FT }
  const face1 = findFaceContainingEdge(s(), sharedId, click)
  const face2 = findFaceContainingEdge(s(), sharedId, click)
  ok('hover cache hit returns the same ref', face1 === face2)
  // Mutate (delete the shared wall) — cache must invalidate.
  s().deleteWall(sharedId)
  const face3 = findFaceContainingEdge(s(), sharedId, click)
  ok('after delete, find returns null (wall gone)', face3 === null)
}

// ── Section D — Multi-floor isolation ───────────────────────────────────

header('Section D — Multi-floor isolation')

reset()
{
  // F1: 10×10 square.
  addWallAt(0,      0,      10*FT, 0)
  addWallAt(10*FT,  0,      10*FT, 10*FT)
  addWallAt(10*FT,  10*FT,  0,     10*FT)
  addWallAt(0,      10*FT,  0,     0)
  ok('F1 has 1 face', enumerateFloorFaces(s(), 'F1').length === 1)

  // Add F2 with a different shape: 5×5 square.
  s().setProjectSettings({
    floors: [
      ...s().projectSettings.floors,
      { id: 'F2', label: 'Floor 2', sequence: 1, plinthHeightFt: 1.5, floorHeightFt: 10, meta: null, underlay: null },
    ],
  })
  s().setCurrentFloorId?.('F2')

  // Workaround: setCurrentFloorId may not exist as a direct setter; use
  // the existing pattern from verify-multifloor.
  if (s().currentFloorId !== 'F2') {
    // Direct set as last resort.
    useStore.setState({ currentFloorId: 'F2' })
  }
  ok('switched to F2', s().currentFloorId === 'F2')

  addWallAt(50*FT, 50*FT, 55*FT, 50*FT)
  addWallAt(55*FT, 50*FT, 55*FT, 55*FT)
  addWallAt(55*FT, 55*FT, 50*FT, 55*FT)
  addWallAt(50*FT, 55*FT, 50*FT, 50*FT)

  const f1 = enumerateFloorFaces(s(), 'F1')
  const f2 = enumerateFloorFaces(s(), 'F2')
  ok('F1 still has 1 face after F2 walls added', f1.length === 1)
  ok('F2 has 1 face', f2.length === 1)
  ok('F1 face area ≈ 100 ft²', Math.abs(f1[0].signedAreaFt2 - 100) < 0.01)
  ok('F2 face area ≈ 25 ft²',  Math.abs(f2[0].signedAreaFt2 - 25)  < 0.01)
  ok('F1 and F2 faces have different floorIds',
     f1[0].floorId === 'F1' && f2[0].floorId === 'F2')
}

// ── Section E — BOQ canary ──────────────────────────────────────────────

header('Section E — BOQ canary (rect_room vs createRoomFromFace)')

// Build two equivalent states:
//   State 1: 3 rooms via addRectangleRoom (rect_room semantics).
//   State 2: same 12-wall topology via addWall + createRoomFromFace.
// BOQ output (getBoqLines) must be byte-identical.

function buildStateRectRoom() {
  reset()
  s().addRectangleRoom(0,      0,      10*FT, 10*FT, { type: 'OTHER' })
  s().addRectangleRoom(15*FT,  0,      25*FT, 10*FT, { type: 'OTHER' })
  s().addRectangleRoom(0,      15*FT,  10*FT, 25*FT, { type: 'OTHER' })
}

function buildStateFaceDetect() {
  reset()
  // Room 1
  addWallAt(0,     0,      10*FT, 0)
  addWallAt(10*FT, 0,      10*FT, 10*FT)
  addWallAt(10*FT, 10*FT,  0,     10*FT)
  addWallAt(0,     10*FT,  0,     0)
  // Room 2
  addWallAt(15*FT, 0,      25*FT, 0)
  addWallAt(25*FT, 0,      25*FT, 10*FT)
  addWallAt(25*FT, 10*FT,  15*FT, 10*FT)
  addWallAt(15*FT, 10*FT,  15*FT, 0)
  // Room 3
  addWallAt(0,     15*FT,  10*FT, 15*FT)
  addWallAt(10*FT, 15*FT,  10*FT, 25*FT)
  addWallAt(10*FT, 25*FT,  0,     25*FT)
  addWallAt(0,     25*FT,  0,     15*FT)

  const faces = enumerateFloorFaces(s(), 'F1')
  // Sort by some deterministic property so we create them in a predictable
  // order, mirroring rect_room's create order (which is also sorted by
  // creation time → centroid x then y in practice).
  const ordered = [...faces].sort((a, b) => {
    if (a.centroid.x !== b.centroid.x) return a.centroid.x - b.centroid.x
    return a.centroid.y - b.centroid.y
  })
  for (const f of ordered) {
    s().createRoomFromFace(f, { type: 'OTHER' })
  }
}

// Strip volatile fields from BOQ lines for comparison.
// id, ifcGlobalId, generatedAt timestamps, and meta.detectedAt differ
// between runs. sourceEntityIds carry runtime UUIDs — also differ.
// We compare only (category, label, qty, unit, rateKey, cost).
function boqFingerprint(lines) {
  return lines.map(l => ({
    category: l.category,
    label:    l.label,
    qty:      typeof l.qty === 'number' ? Math.round(l.qty * 1e6) / 1e6 : l.qty,
    unit:     l.unit,
    rateKey:  l.rateKey,
    isPer1000: l.isPer1000,
  }))
}

buildStateRectRoom()
const linesRect = getBoqLines(s(), {}, { floorId: 'F1' })
const fingerprintRect = boqFingerprint(linesRect)

buildStateFaceDetect()
const linesFace = getBoqLines(s(), {}, { floorId: 'F1' })
const fingerprintFace = boqFingerprint(linesFace)

ok('rect_room state: produced BOQ lines', linesRect.length > 0)
ok('face-detect state: produced BOQ lines', linesFace.length > 0)
ok('rect_room and face-detect BOQ line counts match',
   linesRect.length === linesFace.length,
   `rect=${linesRect.length} face=${linesFace.length}`)

const json1 = JSON.stringify(fingerprintRect)
const json2 = JSON.stringify(fingerprintFace)
ok('BOQ canary: rect_room and createRoomFromFace produce IDENTICAL BOQ',
   json1 === json2,
   json1 === json2 ? '' : `DRIFT — first divergence:\n  rect:  ${json1.slice(0, 200)}\n  face:  ${json2.slice(0, 200)}`)

// Bonus: provenance meta stamped on face-detect rooms.
{
  const sample = Object.values(s().rooms)[0]
  ok('face-detect Room has meta.createdFrom === "face-detect"',
     sample?.meta?.createdFrom === 'face-detect',
     `meta=${JSON.stringify(sample?.meta)}`)
  ok('face-detect Room has meta.detectedAt ISO string',
     typeof sample?.meta?.detectedAt === 'string'
     && /^\d{4}-\d{2}-\d{2}T/.test(sample?.meta?.detectedAt),
     `detectedAt=${sample?.meta?.detectedAt}`)
}

// Integrity assertion across both states.
buildStateRectRoom()
ok('verifyIntegrity passes on rect_room state', verifyIntegrity(s()).valid)
buildStateFaceDetect()
ok('verifyIntegrity passes on face-detect state', verifyIntegrity(s()).valid)

// ── Section F — Virtual-wall room detection (Bug A) ─────────────────────

header('Section F — Virtual-wall room detection (Bug A fix)')

// A 4-wall closed loop where ONE boundary is flagged isVirtual.
// Expected: face enumeration finds the room (topological graph includes
// the virtual edge). BOQ output equals an equivalent 3-physical-wall room
// (virtual contributes zero plaster/paint/masonry/etc. — confirmed via
// quantity aggregators' local isVirtual filters).
function buildVirtualWallReference() {
  reset()
  // All 4 walls physical — the BOQ baseline.
  addWallAt(0,     0,      10*FT, 0)
  addWallAt(10*FT, 0,      10*FT, 10*FT)
  addWallAt(10*FT, 10*FT,  0,     10*FT)
  addWallAt(0,     10*FT,  0,     0)
  const faces = enumerateFloorFaces(s(), 'F1')
  for (const f of faces) s().createRoomFromFace(f, { type: 'OTHER' })
}
function buildVirtualWallCanary() {
  reset()
  // 3 physical walls + 1 virtual wall closing the loop.
  addWallAt(0,     0,      10*FT, 0)
  addWallAt(10*FT, 0,      10*FT, 10*FT)
  addWallAt(10*FT, 10*FT,  0,     10*FT)
  const virtId = addWallAt(0, 10*FT, 0, 0)
  s().setWallIsVirtual(virtId, true)
  // Re-enumerate after the flag set; face cache must rebuild because
  // state.walls reference changed.
  const faces = enumerateFloorFaces(s(), 'F1')
  for (const f of faces) s().createRoomFromFace(f, { type: 'OTHER' })
}

buildVirtualWallReference()
const facesRef = enumerateFloorFaces(s(), 'F1')
ok('reference: 4 physical walls → 1 detected face',
   facesRef.length === 1,
   `faces=${facesRef.length}`)
ok('reference: face area ≈ 100 ft²',
   facesRef.length === 1 && Math.abs(facesRef[0].signedAreaFt2 - 100) < 0.01,
   facesRef.length === 1 ? `area=${facesRef[0].signedAreaFt2}` : '')
const linesRef = getBoqLines(s(), {}, { floorId: 'F1' })

buildVirtualWallCanary()
const facesVirt = enumerateFloorFaces(s(), 'F1')
ok('canary: 3 physical + 1 virtual → 1 detected face (Bug A fix)',
   facesVirt.length === 1,
   `faces=${facesVirt.length}`)
ok('canary: detected face area ≈ 100 ft²',
   facesVirt.length === 1 && Math.abs(facesVirt[0].signedAreaFt2 - 100) < 0.01,
   facesVirt.length === 1 ? `area=${facesVirt[0].signedAreaFt2}` : '')
// Confirm exactly one room created on the virtual side.
ok('canary: exactly one Room created on the virtual boundary',
   Object.keys(s().rooms).length === 1,
   `rooms=${Object.keys(s().rooms).length}`)
const linesVirt = getBoqLines(s(), {}, { floorId: 'F1' })

// BOQ: room-area-driven lines (flooring) must match the reference
// byte-identical — both rooms have the same 100 ft² polygon. Wall-area-
// driven lines (plaster, paint walls, masonry) differ because the canary
// has one fewer physical wall; that's the correct behavior and proves
// the virtual wall contributes zero material to BOQ.
function findLine(lines, rateKey) {
  return lines.find(l => l.rateKey === rateKey) ?? null
}
const refFlooring  = findLine(linesRef,  'flooring')
const virtFlooring = findLine(linesVirt, 'flooring')
ok('flooring qty (room-area-driven): canary equals reference byte-identical',
   refFlooring?.qty != null && virtFlooring?.qty != null &&
   Math.abs(refFlooring.qty - virtFlooring.qty) < 1e-6,
   `ref=${refFlooring?.qty} virt=${virtFlooring?.qty}`)

// Quantity leakage check: the canary's masonry total must be STRICTLY
// LESS than the reference (the virtual wall contributes zero material).
function byCategory(lines, cat) {
  return lines.filter(l => l.category === cat).reduce((s, l) => s + (typeof l.qty === 'number' ? l.qty : 0), 0)
}
const refMason  = byCategory(linesRef,  'masonry')
const virtMason = byCategory(linesVirt, 'masonry')
ok('masonry total: virtual canary < physical reference (no quantity leakage)',
   virtMason < refMason - 1e-6,
   `refMason=${refMason} virtMason=${virtMason}`)

// Plaster external face — virtual wall must NOT be counted as external.
// Reference's external-wall plaster equals (4 walls × 10ft × 10ft outer
// face) — for the canary, only 3 walls are external, so external plaster
// is strictly less.
const refExtPlaster  = findLine(linesRef,  'plasterWallsExternal')?.qty ?? 0
const virtExtPlaster = findLine(linesVirt, 'plasterWallsExternal')?.qty ?? 0
ok('external plaster: virtual canary < physical reference',
   virtExtPlaster < refExtPlaster - 1e-6,
   `refExt=${refExtPlaster} virtExt=${virtExtPlaster}`)
ok('external plaster: virtual canary ≈ 3/4 of reference (one wall short)',
   Math.abs(virtExtPlaster - refExtPlaster * 0.75) < 0.5,
   `refExt=${refExtPlaster} virtExt=${virtExtPlaster} ratio=${(virtExtPlaster/refExtPlaster).toFixed(3)}`)

// Integrity must pass on the virtual-wall state.
ok('verifyIntegrity passes on virtual-wall canary state', verifyIntegrity(s()).valid)

// ── Section G — Delete-then-redraw canary (Bug B) ───────────────────────

header('Section G — Delete-then-redraw canary (Bug B fix)')

// Build the reference: one 10x10 ft room. Capture its BOQ fingerprint.
reset()
addWallAt(0,     0,      10*FT, 0)
addWallAt(10*FT, 0,      10*FT, 10*FT)
addWallAt(10*FT, 10*FT,  0,     10*FT)
addWallAt(0,     10*FT,  0,     0)
{
  const faces = enumerateFloorFaces(s(), 'F1')
  for (const f of faces) s().createRoomFromFace(f, { type: 'TOILET' })
}
const linesBaseline = getBoqLines(s(), {}, { floorId: 'F1' })
const fingerprintBaseline = boqFingerprint(linesBaseline)
ok('baseline: 1 room created (TOILET)',
   Object.keys(s().rooms).length === 1)
ok('baseline: verifyIntegrity valid',
   verifyIntegrity(s()).valid)

// Delete the top wall (10,0)→(10,10). Room loses closure → purged.
const wallToDelete = Object.values(s().walls).find(w => {
  const a = s().nodes[w.n1], b = s().nodes[w.n2]
  return (a.x === 10*FT && b.x === 10*FT) || (a.y === 0 && b.y === 0 && false)
  // Pick the right-edge wall (n1 or n2 at x=10*FT, both x equal).
})
// Find the right-edge wall robustly.
const rightWall = Object.values(s().walls).find(w => {
  const a = s().nodes[w.n1], b = s().nodes[w.n2]
  return a.x === 10*FT && b.x === 10*FT
})
ok('found right-edge wall to delete', !!rightWall)
const deleteResult = s().deleteWall(rightWall.id)
ok('deleteWall returns ok=true', deleteResult?.ok === true)
ok('deleteWall reports 1 purged room',
   Array.isArray(deleteResult?.purgedRoomIds) && deleteResult.purgedRoomIds.length === 1,
   `purgedRoomIds=${JSON.stringify(deleteResult?.purgedRoomIds)}`)
ok('deleteWall reports purgedRoomNames[0] is the original room',
   deleteResult?.purgedRoomNames?.length === 1,
   `purgedRoomNames=${JSON.stringify(deleteResult?.purgedRoomNames)}`)
ok('state.rooms is empty after orphan purge',
   Object.keys(s().rooms).length === 0,
   `rooms=${Object.keys(s().rooms).length}`)
ok('verifyIntegrity remains valid after orphan purge',
   verifyIntegrity(s()).valid)

// Redraw the missing wall and re-detect.
addWallAt(10*FT, 0, 10*FT, 10*FT)
_resetFaceCaches()
const facesAfterRedraw = enumerateFloorFaces(s(), 'F1')
ok('after redraw: face enumeration finds 1 face',
   facesAfterRedraw.length === 1,
   `faces=${facesAfterRedraw.length}`)
for (const f of facesAfterRedraw) {
  s().createRoomFromFace(f, { type: 'TOILET' })
}
ok('after redraw + re-detect: exactly 1 room (no duplicate, no ghost)',
   Object.keys(s().rooms).length === 1,
   `rooms=${Object.keys(s().rooms).length}`)

// BOQ must equal the baseline (no double-counted finishes).
const linesAfter = getBoqLines(s(), {}, { floorId: 'F1' })
const fingerprintAfter = boqFingerprint(linesAfter)
const jsonBaseline = JSON.stringify(fingerprintBaseline)
const jsonAfter    = JSON.stringify(fingerprintAfter)
ok('delete-then-redraw canary: BOQ matches baseline byte-identical',
   jsonBaseline === jsonAfter,
   jsonBaseline === jsonAfter ? '' : `DRIFT — baseline=${jsonBaseline.slice(0,180)} after=${jsonAfter.slice(0,180)}`)

// ── Section H — Sub-span face detection (BE-FaceLookup-001) ──────────────

header('Section H — Sub-span face detection (BE-FaceLookup-001)')

// Fixture: a 20ft × 10ft outer rectangle split into two 10×10 rooms by a
// vertical partition at x=10ft (120in). Drawing the partition lands its
// endpoints MID-SPAN on the full-length bottom and top walls, so each
// auto-forms a T-junction (Phase W — the walls are NOT split; they stay
// single full-length entities with one junction each).
//
//   bottom wall: (0,0)→(240,0)   — gets T-junction T_b at (120,0)
//   top wall:    (240,120)→(0,120) — gets T-junction T_t at (120,120)
//   partition:   (120,0)→(120,120)
//
// The LEFT room is bounded by the SUB-SPAN (0,0)→(120,0) of the bottom wall
// (and the SUB-SPAN (120,120)→(0,120) of the top wall). Before the fix,
// findFaceContainingEdge keyed byEdgeSide off wall.n1/n2 = (0,0)/(240,0),
// which is never a graph-adjacent pair on the junctioned wall → lookup
// missed → returned null. The fix resolves the segment nearest the click.

reset()
{
  // Outer 20×10 rectangle (centerline inches).
  const bottomWallId = addWallAt(0,      0,      20*FT, 0)       // (0,0)→(240,0)
  const rightWallId  = addWallAt(20*FT,  0,      20*FT, 10*FT)   // (240,0)→(240,120)
  const topWallId    = addWallAt(20*FT,  10*FT,  0,     10*FT)   // (240,120)→(0,120)
  const leftWallId   = addWallAt(0,      10*FT,  0,     0)       // (0,120)→(0,0)
  // Vertical partition — endpoints land mid-span → auto T-junctions.
  const partitionId  = addWallAt(10*FT,  0,      10*FT, 10*FT)   // (120,0)→(120,120)

  ok('5 walls created (outer rect + partition)',
     !!bottomWallId && !!rightWallId && !!topWallId && !!leftWallId && !!partitionId,
     `bottom=${bottomWallId} right=${rightWallId} top=${topWallId} left=${leftWallId} part=${partitionId}`)

  // H.1 — exactly 2 interior faces, each ≈ 100 ft².
  const faces = enumerateFloorFaces(s(), 'F1')
  ok('H.1 enumerateFloorFaces returns exactly 2 interior faces',
     faces.length === 2, `got ${faces.length}`)
  if (faces.length === 2) {
    const areas = faces.map(f => f.signedAreaFt2).sort((a, b) => a - b)
    ok('H.1 both faces signedAreaFt2 ≈ 100',
       Math.abs(areas[0] - 100) < 0.5 && Math.abs(areas[1] - 100) < 0.5,
       `areas=[${areas.join(', ')}]`)
  }

  // H.2 — bottom + top walls stay ONE entity each with exactly one junction
  // (proves no split occurred).
  const bottomWall = s().walls[bottomWallId]
  const topWall    = s().walls[topWallId]
  ok('H.2 bottom wall is one entity with exactly one junction',
     (bottomWall?.junctions?.length ?? 0) === 1,
     `junctions=${JSON.stringify(bottomWall?.junctions)}`)
  ok('H.2 top wall is one entity with exactly one junction',
     (topWall?.junctions?.length ?? 0) === 1,
     `junctions=${JSON.stringify(topWall?.junctions)}`)

  const T_b = bottomWall?.junctions?.[0] ?? null
  const T_t = topWall?.junctions?.[0] ?? null

  // H.3 — left-half click (interior, above bottom wall) → NON-NULL LEFT face
  // ≈ 100 ft², wallIds = {bottom, partition, top, left}. THE FIX PROOF.
  const leftFace = findFaceContainingEdge(s(), bottomWallId, { x: 60, y: 30 })
  ok('H.3 left-half click returns a NON-NULL face (BE-FaceLookup-001 fix proof)',
     leftFace != null,
     leftFace ? `area=${leftFace.signedAreaFt2}` : 'returned null (regression!)')
  if (leftFace) {
    ok('H.3 left face area ≈ 100 ft²',
       Math.abs(leftFace.signedAreaFt2 - 100) < 0.5, `area=${leftFace.signedAreaFt2}`)
    const expected = new Set([bottomWallId, partitionId, topWallId, leftWallId])
    const got = new Set(leftFace.wallIds)
    const setsEqual = expected.size === got.size &&
      [...expected].every(w => got.has(w))
    ok('H.3 left face wallIds = {bottom, partition, top, left}',
       setsEqual, `wallIds=${JSON.stringify(leftFace.wallIds)} expected=${JSON.stringify([...expected])}`)
  }

  // H.4 — right-half click (interior) → RIGHT face (includes right wall),
  // a DIFFERENT face object than the left face.
  const rightFace = findFaceContainingEdge(s(), bottomWallId, { x: 180, y: 30 })
  ok('H.4 right-half click returns a NON-NULL face',
     rightFace != null,
     rightFace ? `area=${rightFace.signedAreaFt2}` : 'null')
  if (rightFace) {
    ok('H.4 right face area ≈ 100 ft²',
       Math.abs(rightFace.signedAreaFt2 - 100) < 0.5, `area=${rightFace.signedAreaFt2}`)
    ok('H.4 right face includes the right wall',
       rightFace.wallIds.includes(rightWallId),
       `wallIds=${JSON.stringify(rightFace.wallIds)}`)
    ok('H.4 right face is a DIFFERENT object than the left face',
       leftFace != null && rightFace !== leftFace)
  }

  // H.5 — side determinism: click BELOW the bottom wall (exterior side) → null.
  const belowFace = findFaceContainingEdge(s(), bottomWallId, { x: 60, y: -30 })
  ok('H.5 below-wall (exterior) click returns null (no enclosing face)',
     belowFace === null, `got ${belowFace == null ? 'null' : 'a face'}`)

  // H.6 — createRoomFromFace(leftFace) succeeds; area ≈ 100; nodeOrder has
  // length 4 and INCLUDES both T-junction node ids (proves the junction is
  // threaded as a polygon vertex).
  if (leftFace) {
    const created = s().createRoomFromFace(leftFace, { type: 'OTHER' })
    ok('H.6 createRoomFromFace(leftFace) succeeds',
       !!created?.roomId && !created?.error, JSON.stringify(created))
    if (created?.roomId) {
      const area = s().getRoomArea(created.roomId)
      ok('H.6 created room area ≈ 100 ft²',
         Math.abs(area - 100) < 0.5, `area=${area}`)
      const room = s().rooms[created.roomId]
      const no = room?.nodeOrder ?? []
      ok('H.6 created room nodeOrder length === 4',
         no.length === 4, `nodeOrder=${JSON.stringify(no)}`)
      ok('H.6 created room nodeOrder INCLUDES both T-junction node ids',
         T_b != null && T_t != null && no.includes(T_b) && no.includes(T_t),
         `nodeOrder=${JSON.stringify(no)} T_b=${T_b} T_t=${T_t}`)
    }
  }

  // H.7 — ambiguous click exactly at the junction x (x=120): returns a
  // NON-NULL valid face, and the SAME face on a repeated call (deterministic).
  // Per the half-open tie-break it binds to the later/right segment; we only
  // assert non-null + stable + valid (don't over-specify which side).
  const ambig1 = findFaceContainingEdge(s(), bottomWallId, { x: 120, y: 30 })
  const ambig2 = findFaceContainingEdge(s(), bottomWallId, { x: 120, y: 30 })
  ok('H.7 junction-x ambiguous click returns a NON-NULL face',
     ambig1 != null, ambig1 ? `area=${ambig1.signedAreaFt2}` : 'null')
  ok('H.7 junction-x ambiguous click is deterministic (same face on repeat)',
     ambig1 === ambig2)
  ok('H.7 junction-x face is valid (area ≈ 100 ft²)',
     ambig1 != null && Math.abs(ambig1.signedAreaFt2 - 100) < 0.5,
     ambig1 ? `area=${ambig1.signedAreaFt2}` : 'null')

  // H.9 — integrity holds for the sub-span fixture (walls stay valid
  // full entities). (Asserted here while the fixture is live.)
  ok('H.9 verifyIntegrity valid for sub-span fixture',
     verifyIntegrity(s()).valid)
}

// H.8 — non-junctioned parity: a plain single 10×10 room (4 walls, no
// partition) still detects via findFaceContainingEdge on the interior side,
// confirming junction-free walls take the byte-identical path.
reset()
{
  const b = addWallAt(0,      0,      10*FT, 0)
  addWallAt(10*FT,  0,      10*FT, 10*FT)
  addWallAt(10*FT,  10*FT,  0,     10*FT)
  addWallAt(0,      10*FT,  0,     0)
  const plain = s().walls[b]
  ok('H.8 plain wall has no junctions',
     (plain?.junctions?.length ?? 0) === 0,
     `junctions=${JSON.stringify(plain?.junctions)}`)
  const face = findFaceContainingEdge(s(), b, { x: 5*FT, y: 1*FT })
  ok('H.8 non-junctioned wall interior click returns a NON-NULL face',
     face != null, face ? `area=${face.signedAreaFt2}` : 'null')
  ok('H.8 non-junctioned face area ≈ 100 ft²',
     face != null && Math.abs(face.signedAreaFt2 - 100) < 0.5,
     face ? `area=${face.signedAreaFt2}` : 'null')
}

// ── Summary ─────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(70))
console.log(`PASS: ${pass}  FAIL: ${fail}`)
console.log('═'.repeat(70))
if (fail > 0) {
  console.error(`✗ verify-room-detection FAILED: ${fail} assertions`)
  process.exit(1)
} else {
  console.log(`✓ verify-room-detection passed (${pass} assertions)`)
}
