// scripts/verify-draw-reference.mjs
//
// Face-aware draw reference (2026-05-28). The authoring boundary converts
// user-clicked face geometry to centerline before `addWall` /
// `addRectangleRoom` store wall nodes. Canonical storage stays
// centerline. The conversion uses the same offset kernel that powers
// the inset (clear_internal) + built-up calculations.
//
// Sections:
//   Bootstrap — module purity (faceToCenterline.js is React/DOM-free)
//   A — Round-trip kernel inversion (face → centerline → face within tolerance)
//   B — rect_room inside_face (drag 10×10 → centerline 10.75×10.75, carpet 10×10)
//   C — rect_room outside_face (drag 10×10 → centerline 9.25×9.25, built-up 10×10)
//   D — rect_room centerline (drag 10×10 → centerline 10×10, zero drift)
//   E — Closed-chain inside_face via faceToCenterline (4 face corners → centerline)
//   F — Open-chain inside_face (3-point chain, endpoint perpendicular projection)
//   G — Mixed snapped/unsnapped chain (pinned vertex preserves topology join)
//   H — Ghost rect label correctness across (drawReference × dimensionMode) matrix
//   I — loadProject default injection (greenfield 'inside_face' for any save)
//   J — settings round-trip via setDrawReference
//   K — Mid-workflow mode switch (commit outside_face chain, flip, commit inside_face chain)
//   L — Acute-angle open chain (very-acute corners + short terminal segment)
//   M — Zig-zag alternating reflex/convex chain (135°→45°→135° stress)
//   N — Closure-in-face-space ordering (closure detected on face buffer, not post-conversion)
//
// Run via:
//   node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-draw-reference.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { useStore } from '../src/store.js'
import {
  convertFacePointsToCenterline,
  isFaceChainClosed,
} from '../src/draw/faceToCenterline.js'
import {
  computeCarpetAreaSft,
  computeBuiltUpAreaSft,
  _resetBuildingAreaCaches,
} from '../src/topology/buildingArea.js'
import { _resetFaceCaches, enumerateFloorFaces } from '../src/topology/faces.js'
import { _resetSegmentClassifyCaches } from '../src/topology/segmentClassify.js'
import { verifyIntegrity } from '../src/schema/integrity.js'
import { getSnapRef } from '../src/snap/targets.js'

const s = useStore.getState
const FT = 12
const HALF_IN = 4.5   // 9" wall default → halfThickness 4.5"

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
  _resetSegmentClassifyCaches()
  _resetBuildingAreaCaches()
  s().loadProject({
    nodes: {}, walls: {}, rooms: {}, stamps: {},
    columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {},
    projectSettings: undefined, unit: 'inch',
  })
}
function addWallAt(ax, ay, bx, by) {
  const n1 = s().getOrCreateNode(ax, ay)
  const n2 = s().getOrCreateNode(bx, by)
  s().addWall(n1, n2)
  return Object.values(s().walls).find(
    x => (x.n1 === n1 && x.n2 === n2) || (x.n1 === n2 && x.n2 === n1)
  )?.id ?? null
}
function detectAndCreateRooms(type = 'OTHER', floorId) {
  const fid = floorId ?? 'F1'
  const faces = enumerateFloorFaces(s(), fid)
  const ordered = [...faces].sort((a, b) => {
    if (a.centroid.x !== b.centroid.x) return a.centroid.x - b.centroid.x
    return a.centroid.y - b.centroid.y
  })
  for (const f of ordered) s().createRoomFromFace(f, { type })
  return ordered.length
}

// ── Bootstrap — module purity ─────────────────────────────────────────

header('Bootstrap — module purity (faceToCenterline.js)')
{
  const __filename = fileURLToPath(import.meta.url)
  const repoRoot   = path.resolve(path.dirname(__filename), '..')
  const rel = 'src/draw/faceToCenterline.js'
  const src = fs.readFileSync(path.join(repoRoot, rel), 'utf-8')
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  const forbidden = [
    [/from\s+['"]react['"]/,      "from 'react'"],
    [/from\s+['"]react-dom['"]/,  "from 'react-dom'"],
    [/\bwindow\b/,                'window'],
    [/\bdocument\b/,              'document'],
  ]
  for (const [re, name] of forbidden) {
    ok(`faceToCenterline.js has no ${name} reference`, !re.test(stripped))
  }
  // The CLOSURE-IN-FACE-SPACE rule MUST be documented in the header.
  ok('CLOSURE-IN-FACE-SPACE rule documented in header',
     /CLOSURE-IN-FACE-SPACE/.test(src))
}

// ── Section A — Round-trip kernel inversion ───────────────────────────

header('Section A — Round-trip kernel inversion (face → centerline → face)')
{
  // Rectangle: 4 face corners at 0..10×0..10 → centerline 10.75×10.75 →
  // back to face 10×10. The kernel is its own inverse modulo the
  // direction flag.
  const faceRect = [
    { x: 0,      y: 0      },
    { x: 10*FT,  y: 0      },
    { x: 10*FT,  y: 10*FT  },
    { x: 0,      y: 10*FT  },
  ]
  // face → centerline (inside_face: offset outward)
  const toCenter = convertFacePointsToCenterline(
    faceRect,
    ['face', 'face', 'face', 'face'],
    { drawReference: 'inside_face', closed: true }
  )
  ok('A.1 rectangle: face → centerline produces 4 vertices',
     toCenter.points.length === 4 && !toCenter.collapsed)
  // Expected centerline: corners at (-4.5, -4.5), (124.5, -4.5), (124.5, 124.5), (-4.5, 124.5).
  const expCorners = [
    { x: -HALF_IN,         y: -HALF_IN         },
    { x: 10*FT + HALF_IN,  y: -HALF_IN         },
    { x: 10*FT + HALF_IN,  y: 10*FT + HALF_IN  },
    { x: -HALF_IN,         y: 10*FT + HALF_IN  },
  ]
  let maxErr = 0
  for (let i = 0; i < 4; i++) {
    const e = Math.hypot(toCenter.points[i].x - expCorners[i].x,
                         toCenter.points[i].y - expCorners[i].y)
    if (e > maxErr) maxErr = e
  }
  ok('A.2 centerline corners match expected within 1e-9',
     maxErr < 1e-9, `maxErr=${maxErr}`)

  // centerline → face (outside_face: offset inward — kernel inverse)
  const backToFace = convertFacePointsToCenterline(
    toCenter.points,
    ['face', 'face', 'face', 'face'],
    { drawReference: 'outside_face', closed: true }
  )
  let invErr = 0
  for (let i = 0; i < 4; i++) {
    const e = Math.hypot(backToFace.points[i].x - faceRect[i].x,
                         backToFace.points[i].y - faceRect[i].y)
    if (e > invErr) invErr = e
  }
  ok('A.3 round-trip rectangle: back-to-face matches input within 1e-9',
     invErr < 1e-9, `invErr=${invErr}`)

  // L-shape round-trip (5 convex + 1 concave outer corner). 6 vertices CCW:
  const faceL = [
    { x: 0,       y: 0       },
    { x: 20*FT,   y: 0       },
    { x: 20*FT,   y: 10*FT   },
    { x: 10*FT,   y: 10*FT   },
    { x: 10*FT,   y: 20*FT   },
    { x: 0,       y: 20*FT   },
  ]
  const lCenter = convertFacePointsToCenterline(
    faceL, ['face','face','face','face','face','face'],
    { drawReference: 'inside_face', closed: true }
  )
  ok('A.4 L-shape: face → centerline 6 vertices, not collapsed',
     lCenter.points.length === 6 && !lCenter.collapsed)
  const lBack = convertFacePointsToCenterline(
    lCenter.points, ['face','face','face','face','face','face'],
    { drawReference: 'outside_face', closed: true }
  )
  let lErr = 0
  for (let i = 0; i < 6; i++) {
    const e = Math.hypot(lBack.points[i].x - faceL[i].x,
                         lBack.points[i].y - faceL[i].y)
    if (e > lErr) lErr = e
  }
  ok('A.5 L-shape round-trip: back-to-face within 1e-9',
     lErr < 1e-9, `lErr=${lErr}`)
}

// ── Section B — rect_room inside_face ─────────────────────────────────

header('Section B — rect_room inside_face (drag = clear)')
{
  reset()
  // Default drawReference is 'inside_face' (from DEFAULT_PROJECT_SETTINGS).
  ok('B.1 default drawReference = inside_face',
     s().projectSettings.drawReference === 'inside_face')
  // Drag a 10×10 rectangle. Result: centerlines at 10.75×10.75; carpet 10×10.
  const r = s().addRectangleRoom(0, 0, 10*FT, 10*FT, { type: 'BEDROOM' })
  ok('B.2 rect_room created', r?.roomId && !r?.error)
  const carpet = computeCarpetAreaSft(s(), 'F1').areaSft
  ok('B.3 carpet ≈ 100 ft² (user dragged 10×10 inside-face = 10×10 clear)',
     Math.abs(carpet - 100) < 0.1, `carpet=${carpet}`)
  // Centerline polygon dimensions: 10.75×10.75.
  const builtUp = computeBuiltUpAreaSft(s(), 'F1').areaSft
  // outer-face = clear + 2*halfThickness on each axis = 10 + 2*0.375*2 = 10.75 + 2*0.375 = 11.5
  // 11.5² = 132.25
  ok('B.4 built-up ≈ 132.25 ft² (clear + 2 wall thicknesses each axis)',
     Math.abs(builtUp - 132.25) < 0.1, `builtUp=${builtUp}`)
  ok('B.5 verifyIntegrity passes', verifyIntegrity(s()).valid)
}

// ── Section C — rect_room outside_face ────────────────────────────────

header('Section C — rect_room outside_face (drag = plinth/built-up)')
{
  reset()
  s().setDrawReference('outside_face')
  // Drag 10×10 outside-face. Result: centerlines 9.25×9.25; built-up 10×10.
  const r = s().addRectangleRoom(0, 0, 10*FT, 10*FT, { type: 'BEDROOM' })
  ok('C.1 rect_room created', r?.roomId && !r?.error)
  const builtUp = computeBuiltUpAreaSft(s(), 'F1').areaSft
  ok('C.2 built-up ≈ 100 ft² (user dragged 10×10 outside-face = 10×10 built-up)',
     Math.abs(builtUp - 100) < 0.1, `builtUp=${builtUp}`)
  const carpet = computeCarpetAreaSft(s(), 'F1').areaSft
  // clear = built-up - 2*thickness = 10 - 2*0.75 = 8.5; carpet = 72.25 ft²
  ok('C.3 carpet ≈ 72.25 ft² (built-up minus 2 wall thicknesses each axis)',
     Math.abs(carpet - 72.25) < 0.1, `carpet=${carpet}`)
}

// ── Section D — rect_room centerline (zero drift) ─────────────────────

header('Section D — rect_room centerline (legacy, zero drift)')
{
  reset()
  s().setDrawReference('centerline')
  const r = s().addRectangleRoom(0, 0, 10*FT, 10*FT, { type: 'BEDROOM' })
  ok('D.1 rect_room created', r?.roomId && !r?.error)
  // Nodes should land exactly at the drag corners.
  const nodes = Object.values(s().nodes).map(n => ({ x: n.x, y: n.y }))
  const corners = new Set(nodes.map(n => `${n.x},${n.y}`))
  ok('D.2 SW corner at (0,0)',          corners.has('0,0'))
  ok('D.3 SE corner at (120,0)',        corners.has('120,0'))
  ok('D.4 NE corner at (120,120)',      corners.has('120,120'))
  ok('D.5 NW corner at (0,120)',        corners.has('0,120'))
  ok('D.6 exactly 4 nodes (no offset/dupes)', nodes.length === 4,
     `got ${nodes.length}`)
}

// ── Section E — Closed-chain inside_face via faceToCenterline ─────────

header('Section E — Closed-chain inside_face (kernel conversion)')
{
  // Direct kernel test — 4 face corners closed into a centerline rectangle.
  const facePts = [
    { x: 0,      y: 0      },
    { x: 12*FT,  y: 0      },
    { x: 12*FT,  y: 8*FT   },
    { x: 0,      y: 8*FT   },
  ]
  const result = convertFacePointsToCenterline(
    facePts, ['face','face','face','face'],
    { drawReference: 'inside_face', closed: true }
  )
  ok('E.1 4 centerline corners produced',
     result.points.length === 4 && !result.collapsed)
  // Expected: -4.5..148.5 wide (12'×12 + 9"), -4.5..100.5 tall (8'×12 + 9").
  ok('E.2 corner 0 at (-4.5, -4.5)',
     Math.abs(result.points[0].x + HALF_IN) < 1e-9 &&
     Math.abs(result.points[0].y + HALF_IN) < 1e-9)
  ok('E.3 corner 2 at (148.5, 100.5)',
     Math.abs(result.points[2].x - (12*FT + HALF_IN)) < 1e-9 &&
     Math.abs(result.points[2].y - (8*FT  + HALF_IN)) < 1e-9)
}

// ── Section F — Open-chain inside_face ────────────────────────────────

header('Section F — Open-chain inside_face (endpoint perpendicular projection)')
{
  // 3 face points forming an L. Open polyline (not closed) — interior
  // vertex 1 uses corner kernel; endpoints 0 and 2 use perpendicular
  // projection along their adjacent edge.
  const facePts = [
    { x: 0,      y: 0      },
    { x: 10*FT,  y: 0      },
    { x: 10*FT,  y: 10*FT  },
  ]
  const result = convertFacePointsToCenterline(
    facePts, ['face','face','face'],
    { drawReference: 'inside_face', closed: false }
  )
  ok('F.1 3 centerline points produced, not collapsed',
     result.points.length === 3 && !result.collapsed)
  // The 3 face points form an open polyline. Implicit-closure signed area
  // for 3 points: shoelace at (0,0), (120,0), (120,120) = +ve → CCW →
  // interior on left → outward (inside_face direction) = right of motion.
  // Endpoint 0: perpendicular to edge (0,0)→(120,0). Direction +X, outward
  //   perp is -Y. Endpoint shift: (0, -4.5).
  // Endpoint 2: perpendicular to edge (120,0)→(120,120). Direction +Y,
  //   outward perp is +X. Endpoint shift: (124.5, 120).
  // Interior vertex 1 (corner): intersect offset lines.
  ok('F.2 endpoint 0 = (0, -4.5)',
     Math.abs(result.points[0].x - 0)         < 1e-9 &&
     Math.abs(result.points[0].y - (-HALF_IN)) < 1e-9,
     `got (${result.points[0].x}, ${result.points[0].y})`)
  ok('F.3 endpoint 2 = (124.5, 120)',
     Math.abs(result.points[2].x - (10*FT + HALF_IN)) < 1e-9 &&
     Math.abs(result.points[2].y - 10*FT)             < 1e-9,
     `got (${result.points[2].x}, ${result.points[2].y})`)
  ok('F.4 interior corner at (124.5, -4.5) — kernel intersection',
     Math.abs(result.points[1].x - (10*FT + HALF_IN)) < 1e-9 &&
     Math.abs(result.points[1].y - (-HALF_IN))         < 1e-9,
     `got (${result.points[1].x}, ${result.points[1].y})`)
}

// ── Section G — Mixed snapped/unsnapped chain ─────────────────────────

header('Section G — Mixed snapped/unsnapped chain (pinned vertex)')
{
  // Imagine the user is tracing 4 face corners but click 1 (the second
  // vertex) snapped to an existing centerline node — so that vertex is
  // PINNED and the kernel returns its original position unchanged.
  // The other three vertices are 'face' and get converted normally.
  const facePts = [
    { x: 0,         y: 0      },
    { x: 10*FT,     y: 0      },   // pinned — was a snap to existing node
    { x: 10*FT,     y: 10*FT  },
    { x: 0,         y: 10*FT  },
  ]
  const snapRefs = ['face', 'centerline', 'face', 'face']
  const result = convertFacePointsToCenterline(
    facePts, snapRefs, { drawReference: 'inside_face', closed: true }
  )
  ok('G.1 conversion succeeds with mixed snapRef', !result.collapsed)
  ok('G.2 pinned vertex 1 at original (10ft, 0) — no offset applied',
     Math.abs(result.points[1].x - 10*FT) < 1e-9 &&
     Math.abs(result.points[1].y - 0)     < 1e-9,
     `got (${result.points[1].x}, ${result.points[1].y})`)
  // Other vertices ARE converted (offset outward). Confirm vertex 0 moved.
  ok('G.3 free vertex 0 moved (face-converted)',
     result.points[0].x !== 0 || result.points[0].y !== 0)
  ok('G.4 free vertex 2 moved (face-converted)',
     result.points[2].x !== 10*FT || result.points[2].y !== 10*FT)
  ok('G.5 free vertex 3 moved (face-converted)',
     result.points[3].x !== 0     || result.points[3].y !== 10*FT)
}

// snapRef-classification sanity — registry-driven.
header('Section G.snap — registry-driven snapRef classification')
{
  ok('G.snap.1 NODE → centerline',           getSnapRef('NODE')          === 'centerline')
  ok('G.snap.2 WALL_ENDPOINT → centerline',  getSnapRef('WALL_ENDPOINT') === 'centerline')
  ok('G.snap.3 WALL_MIDPOINT → centerline',  getSnapRef('WALL_MIDPOINT') === 'centerline')
  ok('G.snap.4 WALL_NEAREST → centerline',   getSnapRef('WALL_NEAREST')  === 'centerline')
  ok('G.snap.5 WALL_JUNCTION → centerline',  getSnapRef('WALL_JUNCTION') === 'centerline')
  ok('G.snap.6 WALL_SEGMENT → centerline',   getSnapRef('WALL_SEGMENT')  === 'centerline')
  ok('G.snap.7 GRID → face',                 getSnapRef('GRID')          === 'face')
  ok('G.snap.8 null / no-snap → face',       getSnapRef(null)            === 'face')
  ok('G.snap.9 unknown kind → face',         getSnapRef('UNKNOWN_KIND')  === 'face')
}

// ── Section H — Ghost rect label matrix ───────────────────────────────

header('Section H — Ghost rect label (drawReference drives label, not dimensionMode)')
{
  // The ghost label change at Canvas.jsx is structural — it now reads
  // the dragged dimension verbatim. We confirm the LOGIC by asserting:
  //   - drawReference=inside_face + drag 10ft → centerline becomes 10.75ft
  //     (the LABEL the user sees while dragging is "10 ft" — drag verbatim)
  //   - drawReference=outside_face + drag 10ft → centerline becomes 9.25ft
  //     (label "10 ft")
  //   - drawReference=centerline + drag 10ft → centerline 10ft (label "10 ft")
  // Verified via the rect_room result: stored centerline corners reflect
  // the conversion, while the drag dimension stays nominal.
  //
  // (UI label rendering is in Canvas.jsx; the conversion correctness is
  // what determines whether label == drag is honest about the result.)
  for (const mode of ['inside_face', 'centerline', 'outside_face']) {
    reset()
    s().setDrawReference(mode)
    const r = s().addRectangleRoom(0, 0, 10*FT, 10*FT, { type: 'BEDROOM' })
    ok(`H.${mode} rect_room created`, r?.roomId && !r?.error)
    // Walls exist with thickness 9".
    const walls = Object.values(s().walls)
    ok(`H.${mode} 4 walls created`, walls.length === 4, `got ${walls.length}`)
    // Outer extent of stored centerlines:
    const nodes = Object.values(s().nodes)
    const minX = Math.min(...nodes.map(n => n.x))
    const maxX = Math.max(...nodes.map(n => n.x))
    let expectedWidth
    if      (mode === 'inside_face')  expectedWidth = 10*FT + 2*HALF_IN
    else if (mode === 'outside_face') expectedWidth = 10*FT - 2*HALF_IN
    else                              expectedWidth = 10*FT
    ok(`H.${mode} centerline width = ${expectedWidth}in (drag 10ft → mode-correct centerline)`,
       Math.abs((maxX - minX) - expectedWidth) < 1e-9,
       `got ${maxX - minX}`)
  }
}

// ── Section I — loadProject default injection ─────────────────────────

header('Section I — loadProject default injection (greenfield)')
{
  // A project save without drawReference field → injected 'inside_face'.
  s().loadProject({
    nodes: {}, walls: {}, rooms: {}, stamps: {},
    columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {},
    projectSettings: { /* explicitly present but no drawReference field */
      dimensionMode: 'centerline',
    },
    unit: 'inch',
  })
  ok('I.1 saved project without drawReference field → injected default',
     s().projectSettings.drawReference === 'inside_face',
     `got "${s().projectSettings.drawReference}"`)

  // A project save with explicit centerline → preserved.
  s().loadProject({
    nodes: {}, walls: {}, rooms: {}, stamps: {},
    columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {},
    projectSettings: { drawReference: 'centerline' },
    unit: 'inch',
  })
  ok('I.2 saved drawReference="centerline" preserved',
     s().projectSettings.drawReference === 'centerline')

  // A project save with explicit outside_face → preserved.
  s().loadProject({
    nodes: {}, walls: {}, rooms: {}, stamps: {},
    columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {},
    projectSettings: { drawReference: 'outside_face' },
    unit: 'inch',
  })
  ok('I.3 saved drawReference="outside_face" preserved',
     s().projectSettings.drawReference === 'outside_face')
}

// ── Section J — settings round-trip ───────────────────────────────────

header('Section J — setDrawReference round-trip + invalid-value rejection')
{
  reset()
  s().setDrawReference('outside_face')
  ok('J.1 outside_face set', s().projectSettings.drawReference === 'outside_face')
  s().setDrawReference('inside_face')
  ok('J.2 inside_face set', s().projectSettings.drawReference === 'inside_face')
  s().setDrawReference('centerline')
  ok('J.3 centerline set', s().projectSettings.drawReference === 'centerline')
  // Invalid values silently rejected.
  s().setDrawReference('garbage')
  ok('J.4 invalid value rejected (state unchanged)',
     s().projectSettings.drawReference === 'centerline')
  s().setDrawReference(null)
  ok('J.5 null rejected (state unchanged)',
     s().projectSettings.drawReference === 'centerline')
}

// ── Section K — Mid-workflow mode switch ──────────────────────────────

header('Section K — Mid-workflow mode switch (mixed-convention reality)')
{
  reset()
  // Stage 1: trace plot outer perimeter in outside_face mode (real plan
  // convention: external dimensions are outside-face).
  s().setDrawReference('outside_face')
  const r1 = s().addRectangleRoom(0, 0, 30*FT, 30*FT, { type: 'OTHER', name: 'Plot perimeter' })
  ok('K.1 plot perimeter rect created in outside_face mode',
     r1?.roomId && !r1?.error)
  // Outside-face perim was 30×30. Built-up should be 900 ft².
  const builtUpAfter1 = computeBuiltUpAreaSft(s(), 'F1').areaSft
  ok('K.2 built-up = 900 ft² after stage 1 (matches user-traced 30×30 plinth)',
     Math.abs(builtUpAfter1 - 900) < 0.5, `got ${builtUpAfter1}`)

  // Now delete that room and switch mode mid-workflow. Stage 2: trace
  // an interior 10×10 room in inside_face mode (room-label convention).
  for (const id of Object.keys(s().rooms)) s().deleteRoom?.(id)
  for (const id of Object.keys(s().walls)) s().deleteWall?.(id)
  s().setDrawReference('inside_face')
  const r2 = s().addRectangleRoom(5*FT, 5*FT, 15*FT, 15*FT, { type: 'BEDROOM' })
  ok('K.3 interior room created in inside_face mode',
     r2?.roomId && !r2?.error)
  const carpetAfter2 = computeCarpetAreaSft(s(), 'F1').areaSft
  ok('K.4 carpet = 100 ft² after stage 2 (user-traced 10×10 clear matches)',
     Math.abs(carpetAfter2 - 100) < 0.1, `got ${carpetAfter2}`)
  ok('K.5 verifyIntegrity holds after mid-workflow mode switch',
     verifyIntegrity(s()).valid)
}

// ── Section L — Acute-angle open chain ────────────────────────────────

header('Section L — Acute-angle open chain (very-acute corners + short terminal)')
{
  // Open chain with very acute first/last angles + extremely short
  // terminal segment. Tests that the kernel doesn't drift endpoints,
  // doesn't produce non-manifold joins, and doesn't self-cross.
  //
  // Path: long primary stroke north, then a very acute kink east-south,
  // then a SHORT terminal segment.
  const facePts = [
    { x: 0,           y: 0           },
    { x: 20*FT,       y: 0           },
    // Acute interior angle here — turn back nearly 180°.
    { x: 0.5*FT,      y: 0.5*FT      },
    // Short terminal — 1ft along the chain direction (back toward the
    // origin diagonally).
    { x: 0,           y: 1*FT        },
  ]
  const result = convertFacePointsToCenterline(
    facePts, facePts.map(() => 'face'),
    { drawReference: 'inside_face', closed: false }
  )
  ok('L.1 conversion produced 4 vertices',
     result.points.length === 4)
  // Whether the kernel reports collapse or not, vertices must be finite
  // numbers (no NaN/Infinity from acute-angle line intersections).
  let allFinite = true
  for (const p of result.points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) { allFinite = false; break }
  }
  ok('L.2 all vertex coords finite (no NaN/Infinity at acute corner)',
     allFinite)
  // Endpoints (0 and 3) project perpendicular along edges 0 and 2. The
  // kernel should not drift them tangentially.
  // Endpoint 0: perpendicular to edge 0→1 (direction +X). With
  //   implicit-closure CCW assumed, outward perp is -Y. Endpoint shift
  //   = (0, -4.5).
  ok('L.3 endpoint 0 perpendicular-projected (drift ≤ 1e-9 along edge dir)',
     Math.abs(result.points[0].x - facePts[0].x) < 1e-9,
     `endpoint 0 x drift = ${result.points[0].x - facePts[0].x}`)
  // Endpoint 3: perpendicular to edge 2→3 only. Final vertex should
  //   shift perpendicular to that edge, not tangentially along it.
  const e2dx = facePts[3].x - facePts[2].x
  const e2dy = facePts[3].y - facePts[2].y
  const e2len = Math.hypot(e2dx, e2dy)
  const tangentDrift = ((result.points[3].x - facePts[3].x) * e2dx +
                        (result.points[3].y - facePts[3].y) * e2dy) / e2len
  ok('L.4 endpoint 3 has no tangential drift along its edge (within 1e-9)',
     Math.abs(tangentDrift) < 1e-9,
     `tangentDrift=${tangentDrift}`)
  // The miter cap at the very acute interior corner should fire (and be
  // marked in the warnings list). Accept either capped result with no
  // tangential drift on endpoint 3 (above) OR collapsed result for the
  // truly degenerate cases.
  const hasMiterCap = result.warnings.some(w => w.code === 'MITER_CAPPED')
  const collapsed   = result.collapsed
  ok('L.5 acute corner: either miter-capped or marked collapsed (no silent failure)',
     hasMiterCap || collapsed,
     `miterCap=${hasMiterCap} collapsed=${collapsed}`)
}

// ── Section M — Zig-zag alternating reflex/convex chain ───────────────

header('Section M — Zig-zag alternating reflex/convex chain (135°→45°→135° stress)')
{
  // Chain that alternates between reflex and convex corners with mixed
  // segment lengths. Offset kernels fail here first via either
  // self-intersection or collapsed intersections.
  //
  // 6-point open chain along x-axis with alternating perpendicular kinks:
  const facePts = [
    { x: 0,        y: 0       },
    { x: 5*FT,     y: 0       },
    { x: 5*FT,     y: 2*FT    },   // reflex turn
    { x: 8*FT,     y: 2*FT    },
    { x: 8*FT,     y: 0       },   // convex turn back
    { x: 12*FT,    y: 0       },
  ]
  const result = convertFacePointsToCenterline(
    facePts, facePts.map(() => 'face'),
    { drawReference: 'inside_face', closed: false }
  )
  ok('M.1 zig-zag conversion produced 6 vertices',
     result.points.length === 6)
  let allFinite = true
  for (const p of result.points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) { allFinite = false; break }
  }
  ok('M.2 all vertex coords finite (no NaN at zig-zag corners)', allFinite)
  // Continuity check: consecutive output segments have positive dot
  // product with input segments (no flip). Already part of the kernel's
  // collapse detection; verify it didn't fire here for a non-degenerate
  // input.
  ok('M.3 zig-zag did not collapse (non-degenerate input)',
     !result.collapsed,
     `warnings=${JSON.stringify(result.warnings)}`)
  // Self-intersection probe: do any two non-adjacent output segments cross?
  function segsIntersect(p1, p2, p3, p4) {
    function ccw(a, b, c) {
      return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x)
    }
    return ccw(p1, p3, p4) !== ccw(p2, p3, p4) &&
           ccw(p1, p2, p3) !== ccw(p1, p2, p4)
  }
  let selfCross = false
  const segs = []
  for (let i = 0; i < result.points.length - 1; i++) {
    segs.push([result.points[i], result.points[i + 1]])
  }
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 2; j < segs.length; j++) {
      if (segsIntersect(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) {
        selfCross = true; break
      }
    }
    if (selfCross) break
  }
  ok('M.4 no self-intersection in output polyline', !selfCross)
}

// ── Section N — Closure-in-face-space ordering ────────────────────────

header('Section N — Closure detection runs on FACE buffer, not post-conversion')
{
  // The CRITICAL ordering: closure-to-origin is detected on the face
  // points the user clicked, NOT on the converted centerline points.
  // Near-thickness offsets would otherwise prevent closure detection.
  //
  // 4 face corners at (0,0), (10ft,0), (10ft,10ft), (0,10ft). The
  // user's 5th "click" returns near the origin. The face buffer has
  // these 5 points (4 + return-to-near-origin) where points[4] is
  // ~halfThickness away from points[0]. AFTER conversion outward, the
  // centerline corners are at ~halfThickness OUTSIDE the face corners,
  // so the centerline "return" point is even FURTHER from
  // centerline[0] than the face return is from face[0].
  //
  // isFaceChainClosed must detect closure on the FACE points before
  // conversion. Otherwise: the chain stays "open" silently, the user's
  // closing intent is dropped, and the convertFacePointsToCenterline
  // call would produce an open-polyline centerline (and miss the
  // closing edge entirely).

  const SNAP_IN = 4   // matches store SNAP_IN
  const facePts = [
    { x: 0,        y: 0      },
    { x: 10*FT,    y: 0      },
    { x: 10*FT,    y: 10*FT  },
    { x: 0,        y: 10*FT  },
    { x: 2,        y: 2      },   // last click — ~2.8" from face origin (within SNAP_IN)
  ]
  ok('N.1 face buffer last vs first: within SNAP_IN (face-space closure)',
     isFaceChainClosed(facePts.slice(0, 4).concat([facePts[4]]), SNAP_IN),
     `dist=${Math.hypot(facePts[4].x - facePts[0].x, facePts[4].y - facePts[0].y)}`)

  // Now show that POST-CONVERSION, the same points are FAR apart:
  // simulate by converting just the 4-corner buffer and computing the
  // would-be-closure distance in centerline space.
  const conv = convertFacePointsToCenterline(
    facePts.slice(0, 4),
    ['face', 'face', 'face', 'face'],
    { drawReference: 'inside_face', closed: true }
  )
  // centerline corner 0 is at (-4.5, -4.5). The face point (2, 2) would
  // map to centerline (2 + outwardX, 2 + outwardY) which is far from (-4.5,-4.5).
  const centerlineOrigin = conv.points[0]
  const distToCenterlineOrigin =
    Math.hypot(facePts[4].x - centerlineOrigin.x,
               facePts[4].y - centerlineOrigin.y)
  ok('N.2 same point in CENTERLINE space: FAR from closure (> 6")',
     distToCenterlineOrigin > 6,
     `dist=${distToCenterlineOrigin.toFixed(3)}"`)
  // The two distances differ enough that detecting closure post-conversion
  // would silently fail. The N.1 → N.2 pair proves the ordering must be
  // face-space-first.
  ok('N.3 ordering documented: face-space closure detected; conversion runs AFTER',
     /closure-in-face-space|FACE buffer|FACE SPACE|FACE points/i.test(
       fs.readFileSync(path.join(fileURLToPath(import.meta.url), '..', '..', 'src/draw/faceToCenterline.js'), 'utf-8')
     ),
     'header comment must reference the closure-in-face-space ordering rule')
}

// ── Final integrity check ─────────────────────────────────────────────

ok('final verifyIntegrity passes', verifyIntegrity(s()).valid)

// ── Summary ───────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(70))
console.log(`PASS: ${pass}  FAIL: ${fail}`)
console.log('═'.repeat(70))
if (fail > 0) {
  console.error(`✗ verify-draw-reference FAILED: ${fail} assertions`)
  process.exit(1)
} else {
  console.log(`✓ verify-draw-reference passed (${pass} assertions)`)
}
