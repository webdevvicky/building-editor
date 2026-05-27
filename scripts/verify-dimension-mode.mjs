// scripts/verify-dimension-mode.mjs
//
// Verifies the dimension-mode kernel (Area 1 — Option C):
//   - getRoomPolygonInsetEdges → EffectiveRoomEdge[] (Correction 1)
//   - getRoomGeometry          → single entry point (Correction 9)
//   - miter cap = 3 × max(adjacentHalfThicknesses) (Correction 3)
//   - collapsed → zero-area edges, collapsed=true, warnings (Correction 4)
//   - 200-config fuzz across orthogonal rooms (Correction 10)
//
// This script does NOT exercise aggregators or UI — Step 1 is pure math.
// Steps 3-4 add aggregator + Canvas assertions on top.

import {
  getRoomGeometry,
  getRoomPolygonInsetEdges,
  resolveDimensionMode,
  getRoomPolygon,
  getRoomArea,
  getRoomPerimeterFt,
  getLongestPolygonEdgeFt,
  getEffectiveWallLengthFt,
} from '../src/topology/rooms.js'
import { verifyIntegrity } from '../src/schema/integrity.js'

let pass = 0, fail = 0
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`) }
  else      { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}
function approx(a, b, tol = 0.01) { return Math.abs(a - b) <= tol }

function header(title) {
  console.log('\n' + '─'.repeat(70))
  console.log(title.toUpperCase())
  console.log('─'.repeat(70))
}

// ── Tiny synthetic state builder ───────────────────────────────────────────
// Avoids store boot-up overhead; we're testing pure topology math.
function buildState({ nodes, walls, rooms, dimensionMode = null }) {
  const nodesMap = {}
  for (const [id, p] of Object.entries(nodes)) nodesMap[id] = { id, ...p }
  const wallsMap = {}
  for (const [id, w] of Object.entries(walls)) {
    wallsMap[id] = {
      id, n1: w.n1, n2: w.n2,
      thickness: w.thickness ?? 9,    // inches; default 9"
      height:    w.height    ?? 120,
      isVirtual: !!w.isVirtual,
      isPlot:    !!w.isPlot,
      openings:  w.openings ?? [],
    }
  }
  const roomsMap = {}
  for (const [id, r] of Object.entries(rooms)) {
    roomsMap[id] = { id, name: id, wallIds: r.wallIds, floorId: r.floorId ?? 'F1', finishes: r.finishes ?? {} }
  }
  const state = {
    nodes: nodesMap, walls: wallsMap, rooms: roomsMap,
    projectSettings: dimensionMode ? { dimensionMode } : {},
  }
  return state
}

// Build an axis-aligned rectangle room with given LxW in ft + uniform thickness.
function buildRectRoom({ wFt, hFt, thicknessIn = 9, dimensionMode = null, originX = 0, originY = 0 }) {
  const FT = 12
  const x0 = originX, y0 = originY
  const x1 = originX + wFt * FT, y1 = originY + hFt * FT
  return buildState({
    nodes: {
      n_sw: { x: x0, y: y0 }, n_se: { x: x1, y: y0 },
      n_ne: { x: x1, y: y1 }, n_nw: { x: x0, y: y1 },
    },
    walls: {
      w_s: { n1: 'n_sw', n2: 'n_se', thickness: thicknessIn },
      w_e: { n1: 'n_se', n2: 'n_ne', thickness: thicknessIn },
      w_n: { n1: 'n_ne', n2: 'n_nw', thickness: thicknessIn },
      w_w: { n1: 'n_nw', n2: 'n_sw', thickness: thicknessIn },
    },
    rooms: { r1: { wallIds: ['w_s', 'w_e', 'w_n', 'w_w'] } },
    dimensionMode,
  })
}

// ── 1. Math primitives — square room, uniform 9" walls ─────────────────────
header('1. Square room 10×10 ft @ 9" walls')
{
  const state = buildRectRoom({ wFt: 10, hFt: 10, thicknessIn: 9 })
  const edges = getRoomPolygonInsetEdges(state, 'r1')
  ok('inset edges returned', edges !== null && edges.length === 4)
  ok('not collapsed', edges._collapsed === false)
  ok('no warnings', (edges._warnings ?? []).length === 0)
  for (const e of edges) {
    ok(`edge ${e.sourceEdgeIndex} carries wallId`, !!e.wallId)
    ok(`edge ${e.sourceEdgeIndex} insetDistance = 4.5"`, approx(e.insetDistanceIn, 4.5))
    // Each edge of the 10×10 ft room loses 4.5" from each end = 9" total = 0.75 ft.
    // So 10 − 0.75 = 9.25 ft.
    ok(`edge ${e.sourceEdgeIndex} length = 9.25 ft`, approx(e.lengthFt, 9.25))
  }
  const geom = getRoomGeometry(state, 'r1', 'clear_internal')
  ok('geom.mode = clear_internal', geom.mode === 'clear_internal')
  // Expected area: 9.25² = 85.5625 ft²
  ok('geom.area = 85.5625 ft²', approx(geom.area, 85.5625, 0.02))
  ok('geom.perimeter = 37 ft', approx(geom.perimeter, 37, 0.04))
  ok('geom.longestWall = 9.25 ft', approx(geom.longestWall, 9.25, 0.01))
  ok('geom.polygon derived from edges (length matches)', geom.polygon.length === 4)

  // Sanity: centerline values unchanged.
  ok('centerline area = 100 ft²', approx(getRoomArea(state, 'r1'), 100))
  ok('centerline perimeter = 40 ft', approx(getRoomPerimeterFt(state, 'r1'), 40))
}

// ── 2. Mixed-thickness rectangle ───────────────────────────────────────────
header('2. Mixed-thickness rectangle (9" partition + 12" external)')
{
  // 10×10 ft room with two walls @ 9" (south, west) and two @ 12" (north, east).
  const FT = 12
  const state = buildState({
    nodes: {
      n_sw: { x: 0,        y: 0        },
      n_se: { x: 10 * FT,  y: 0        },
      n_ne: { x: 10 * FT,  y: 10 * FT  },
      n_nw: { x: 0,        y: 10 * FT  },
    },
    walls: {
      w_s: { n1: 'n_sw', n2: 'n_se', thickness:  9 },
      w_e: { n1: 'n_se', n2: 'n_ne', thickness: 12 },
      w_n: { n1: 'n_ne', n2: 'n_nw', thickness: 12 },
      w_w: { n1: 'n_nw', n2: 'n_sw', thickness:  9 },
    },
    rooms: { r1: { wallIds: ['w_s', 'w_e', 'w_n', 'w_w'] } },
  })
  const edges = getRoomPolygonInsetEdges(state, 'r1')
  ok('edges built', edges !== null && edges.length === 4)
  // South edge (w_s, 9"): ends meet west (9") on n_sw and east (12") on n_se.
  //   length = 10 − 9/2/12 − 12/2/12 = 10 − 0.375 − 0.5 = 9.125 ft
  // East edge (w_e, 12"): ends at south(9") and north(12"). length = 10 − 0.375 − 0.5 = 9.125 ft
  // North edge (w_n, 12"): ends at east(12") and west(9"). length = 10 − 0.5 − 0.375 = 9.125 ft
  // West edge (w_w, 9"): ends at north(12") and south(9"). length = 10 − 0.5 − 0.375 = 9.125 ft
  for (const e of edges) {
    ok(`mixed edge ${e.sourceEdgeIndex} length = 9.125 ft`, approx(e.lengthFt, 9.125, 0.01))
  }
  // Inset distances per edge match the wall's own half-thickness.
  const byWall = Object.fromEntries(edges.map(e => [e.wallId, e]))
  ok('w_s insetDistance = 4.5"', approx(byWall.w_s.insetDistanceIn, 4.5))
  ok('w_e insetDistance = 6.0"', approx(byWall.w_e.insetDistanceIn, 6.0))
  ok('w_n insetDistance = 6.0"', approx(byWall.w_n.insetDistanceIn, 6.0))
  ok('w_w insetDistance = 4.5"', approx(byWall.w_w.insetDistanceIn, 4.5))

  const geom = getRoomGeometry(state, 'r1', 'clear_internal')
  // Inset polygon: 9.125 × 9.125 rectangle, but mixed thicknesses shift the
  // inner rectangle. Actual area = (10 - 9/2/12 - 12/2/12) ×
  //                                 (10 - 9/2/12 - 12/2/12) ≈ 83.27 ft².
  ok('mixed area ≈ 83.27 ft²', approx(geom.area, 83.27, 0.05))
}

// ── 3. Acute corner — miter cap engages ────────────────────────────────────
header('3. Acute corner triangle — miter cap activates')
{
  // 30-60-90 triangle with thin walls. The 30° corner produces a long miter
  // that should be clamped to 3 × maxHalf.
  // Vertices: right triangle, legs 100" and 173.2" (1:√3 ratio).
  const state = buildState({
    nodes: {
      n_a: { x: 0,     y: 0   },
      n_b: { x: 173.2, y: 0   },   // 60° corner
      n_c: { x: 0,     y: 100 },   // 30° corner is at n_a; this is the right angle
    },
    walls: {
      w_ab: { n1: 'n_a', n2: 'n_b', thickness: 9 },
      w_bc: { n1: 'n_b', n2: 'n_c', thickness: 9 },
      w_ca: { n1: 'n_c', n2: 'n_a', thickness: 9 },
    },
    rooms: { r1: { wallIds: ['w_ab', 'w_bc', 'w_ca'] } },
  })
  const edges = getRoomPolygonInsetEdges(state, 'r1')
  ok('triangle edges built', edges !== null && edges.length === 3)
  // At least one corner should hit the miter cap given a 30° interior angle.
  // The vertex displacement from a 30° corner with halfIn=4.5 is 4.5 / sin(15°) ≈ 17.4",
  // which exceeds the cap 3 × 4.5 = 13.5". So MITER_CAPPED should fire at corner index 0
  // (the 30° vertex at n_a, between edges w_ca and w_ab).
  const warnings = edges._warnings ?? []
  const capped = warnings.filter(w => w.code === 'MITER_CAPPED')
  ok('miter cap fired at least once', capped.length >= 1)
  if (capped.length >= 1) {
    const c = capped[0]
    ok(`cap clamped to 13.5" (3 × 4.5")`, approx(c.cappedDistanceIn, 13.5, 0.01))
  }
}

// ── 4. Collapsed room — 6" wide w/ 9" walls ────────────────────────────────
header('4. Room too narrow → collapse (Correction 4)')
{
  // Room interior is 6" wide horizontally with 9" walls on east+west.
  // Each wall consumes 4.5" inward → 9" total → exceeds 6" → flipped/zero.
  const FT = 12
  const state = buildState({
    nodes: {
      n_sw: { x: 0,    y: 0        },
      n_se: { x: 6,    y: 0        },        // only 6 inches wide
      n_ne: { x: 6,    y: 10 * FT  },
      n_nw: { x: 0,    y: 10 * FT  },
    },
    walls: {
      w_s: { n1: 'n_sw', n2: 'n_se', thickness: 9 },
      w_e: { n1: 'n_se', n2: 'n_ne', thickness: 9 },
      w_n: { n1: 'n_ne', n2: 'n_nw', thickness: 9 },
      w_w: { n1: 'n_nw', n2: 'n_sw', thickness: 9 },
    },
    rooms: { r1: { wallIds: ['w_s', 'w_e', 'w_n', 'w_w'] } },
  })
  const edges = getRoomPolygonInsetEdges(state, 'r1')
  ok('edges still returned (not null) per Correction 4', edges !== null)
  ok('edges.length = 4 (not stripped)', edges.length === 4)
  ok('collapsed = true', edges._collapsed === true)
  const collapsedWarn = (edges._warnings ?? []).find(w => w.code === 'INSET_COLLAPSED')
  ok('INSET_COLLAPSED warning emitted', !!collapsedWarn)

  const geom = getRoomGeometry(state, 'r1', 'clear_internal')
  ok('geom.collapsed = true', geom.collapsed === true)
  ok('geom.area = 0 (collapsed → zero)', geom.area === 0)
}

// ── 5. resolveDimensionMode + default semantics ────────────────────────────
header('5. resolveDimensionMode defaults')
{
  ok('null state → centerline',       resolveDimensionMode(null) === 'centerline')
  ok('empty settings → centerline',   resolveDimensionMode({ projectSettings: {} }) === 'centerline')
  ok('explicit centerline',           resolveDimensionMode({ projectSettings: { dimensionMode: 'centerline' } }) === 'centerline')
  ok('explicit clear_internal',       resolveDimensionMode({ projectSettings: { dimensionMode: 'clear_internal' } }) === 'clear_internal')
}

// ── 6. getRoomGeometry — centerline parity (sanity round-trip) ─────────────
header('6. Centerline mode parity vs legacy helpers')
{
  const state = buildRectRoom({ wFt: 12, hFt: 8, thicknessIn: 9 })
  const geom = getRoomGeometry(state, 'r1', 'centerline')
  ok('centerline mode',          geom.mode === 'centerline')
  ok('centerline polygon == getRoomPolygon', geom.polygon.length === getRoomPolygon(state, 'r1').length)
  ok('centerline area = 96 ft²', approx(geom.area, getRoomArea(state, 'r1')))
  ok('centerline perimeter = 40 ft', approx(geom.perimeter, getRoomPerimeterFt(state, 'r1')))
  ok('centerline longestWall = 12 ft', approx(geom.longestWall, getLongestPolygonEdgeFt(state, 'r1')))
  // Same shape as clear_internal — insetEdges populated with insetDistanceIn=0.
  ok('centerline edges populated', geom.insetEdges.length === 4)
  for (const e of geom.insetEdges) {
    ok(`centerline edge ${e.sourceEdgeIndex} insetDistance=0`, e.insetDistanceIn === 0)
    ok(`centerline edge ${e.sourceEdgeIndex} has wallId`, !!e.wallId)
  }
}

// ── 7. EffectiveRoomEdge shape contract (Correction 1) ─────────────────────
header('7. EffectiveRoomEdge shape')
{
  const state = buildRectRoom({ wFt: 10, hFt: 10, thicknessIn: 9 })
  const edges = getRoomPolygonInsetEdges(state, 'r1')
  for (const e of edges) {
    ok(`edge has all canonical fields`,
       typeof e.wallId === 'string'
       && typeof e.a?.x === 'number' && typeof e.a?.y === 'number'
       && typeof e.b?.x === 'number' && typeof e.b?.y === 'number'
       && typeof e.lengthFt === 'number'
       && typeof e.insetDistanceIn === 'number'
       && typeof e.sourceEdgeIndex === 'number')
  }
  // Polygon must derive from edges (Correction 1)
  const geom = getRoomGeometry(state, 'r1', 'clear_internal')
  for (let i = 0; i < geom.polygon.length; i++) {
    ok(`polygon[${i}] == edges[${i}].a`,
       geom.polygon[i].x === edges[i].a.x && geom.polygon[i].y === edges[i].a.y)
  }
}

// ── 8. Fuzz: 200 random orthogonal rectangle rooms (Correction 10) ────────
header('8. Fuzz: 200 random rectangle rooms')
{
  let fuzzPass = 0, fuzzFail = 0
  // Deterministic PRNG (linear congruential) for reproducibility.
  let seed = 0xC0DE2026
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF; return seed / 0x7FFFFFFF }
  for (let i = 0; i < 200; i++) {
    const wFt = 6 + Math.floor(rnd() * 40)            // 6 .. 45 ft
    const hFt = 6 + Math.floor(rnd() * 40)
    const tIn = [4, 6, 9, 12][Math.floor(rnd() * 4)]  // 4/6/9/12 inch wall
    const state = buildRectRoom({ wFt, hFt, thicknessIn: tIn })
    let allOk = true
    let why = ''
    const edges = getRoomPolygonInsetEdges(state, 'r1')
    if (!edges || edges.length !== 4) { allOk = false; why = 'edges-shape' }
    else {
      // Each edge length should equal centerline minus 2 × halfIn (uniform thickness).
      const expectedLen = (wFt + hFt) // placeholder; do per-edge
      const insetFt = (tIn / 12)
      const expectedW = wFt - insetFt
      const expectedH = hFt - insetFt
      for (const e of edges) {
        const expected = (e.sourceEdgeIndex % 2 === 0) ? expectedW : expectedH
        if (!approx(e.lengthFt, expected, 0.02)) { allOk = false; why = `edge ${e.sourceEdgeIndex} expected ${expected} got ${e.lengthFt}` }
        if (e.lengthFt < 0) { allOk = false; why = 'negative length' }
        if (Number.isNaN(e.lengthFt)) { allOk = false; why = 'NaN length' }
        if (!e.wallId) { allOk = false; why = 'missing wallId' }
      }
      const geom = getRoomGeometry(state, 'r1', 'clear_internal')
      const expectedArea = expectedW * expectedH
      if (expectedW > 0 && expectedH > 0) {
        if (geom.collapsed) { allOk = false; why = 'unexpected collapse' }
        if (!approx(geom.area, expectedArea, 0.05)) { allOk = false; why = `area expected ${expectedArea} got ${geom.area}` }
      } else {
        if (!geom.collapsed) { allOk = false; why = 'expected collapse on too-narrow' }
      }
      // Winding check: signed area sign matches original.
      // (Implicit — _signedAreaIn2 should be positive for our CCW construction.)
    }
    if (allOk) fuzzPass++
    else { fuzzFail++; if (fuzzFail < 5) console.log(`    fuzz fail #${i}: w=${wFt} h=${hFt} t=${tIn} — ${why}`) }
  }
  ok(`fuzz 200 rectangles: ${fuzzPass}/200 passed`, fuzzFail === 0)
}

// ── 9. Fuzz: 200 L-shaped rooms (6 corners) ────────────────────────────────
header('9. Fuzz: 200 random L-shaped rooms')
{
  // L-shape: outer rectangle wFt × hFt, with a cutout in the NE corner of cutW × cutH.
  // Vertices (CCW): (0,0) (W,0) (W,H-cutH) (W-cutW,H-cutH) (W-cutW,H) (0,H)
  let fuzzPass = 0, fuzzFail = 0
  let seed = 0xBEEF1234
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF; return seed / 0x7FFFFFFF }
  const FT = 12
  for (let i = 0; i < 200; i++) {
    const wFt = 12 + Math.floor(rnd() * 20)        // 12..31
    const hFt = 12 + Math.floor(rnd() * 20)
    const cutW = 2 + Math.floor(rnd() * (wFt - 4))
    const cutH = 2 + Math.floor(rnd() * (hFt - 4))
    const tIn = [6, 9, 12][Math.floor(rnd() * 3)]
    const state = buildState({
      nodes: {
        n0: { x: 0,                  y: 0 },
        n1: { x: wFt * FT,           y: 0 },
        n2: { x: wFt * FT,           y: (hFt - cutH) * FT },
        n3: { x: (wFt - cutW) * FT,  y: (hFt - cutH) * FT },
        n4: { x: (wFt - cutW) * FT,  y: hFt * FT },
        n5: { x: 0,                  y: hFt * FT },
      },
      walls: {
        e0: { n1: 'n0', n2: 'n1', thickness: tIn },
        e1: { n1: 'n1', n2: 'n2', thickness: tIn },
        e2: { n1: 'n2', n2: 'n3', thickness: tIn },
        e3: { n1: 'n3', n2: 'n4', thickness: tIn },
        e4: { n1: 'n4', n2: 'n5', thickness: tIn },
        e5: { n1: 'n5', n2: 'n0', thickness: tIn },
      },
      rooms: { r1: { wallIds: ['e0', 'e1', 'e2', 'e3', 'e4', 'e5'] } },
    })
    let allOk = true
    let why = ''
    const edges = getRoomPolygonInsetEdges(state, 'r1')
    if (!edges || edges.length !== 6) { allOk = false; why = 'L-edges-shape' }
    else {
      for (const e of edges) {
        if (Number.isNaN(e.lengthFt) || !Number.isFinite(e.lengthFt)) { allOk = false; why = 'NaN length' }
        if (!e.wallId) { allOk = false; why = 'missing wallId' }
      }
      const geom = getRoomGeometry(state, 'r1', 'clear_internal')
      if (Number.isNaN(geom.area) || !Number.isFinite(geom.area)) { allOk = false; why = 'NaN area' }
      // Centerline L-area = wFt*hFt − cutW*cutH; clear-internal should be smaller.
      const centerArea = wFt * hFt - cutW * cutH
      if (!geom.collapsed && geom.area >= centerArea + 0.1) { allOk = false; why = `clear-area ${geom.area} >= center ${centerArea}` }
    }
    if (allOk) fuzzPass++
    else { fuzzFail++; if (fuzzFail < 5) console.log(`    L-fuzz fail #${i}: w=${wFt} h=${hFt} cutW=${cutW} cutH=${cutH} t=${tIn} — ${why}`) }
  }
  ok(`fuzz 200 L-shapes: ${fuzzPass}/200 passed`, fuzzFail === 0)
}

// ── 10. Memoization stability ─────────────────────────────────────────────
header('10. Memo returns stable reference')
{
  const state = buildRectRoom({ wFt: 10, hFt: 10, thicknessIn: 9 })
  const e1 = getRoomPolygonInsetEdges(state, 'r1')
  const e2 = getRoomPolygonInsetEdges(state, 'r1')
  ok('same input → same array reference', e1 === e2)
  // Mutating state.walls reference triggers recompute.
  const state2 = { ...state, walls: { ...state.walls } }
  const e3 = getRoomPolygonInsetEdges(state2, 'r1')
  ok('different walls ref → recomputed (new reference)', e3 !== e1)
}

// ── 11. New-project path: loadProject(_emptyProjectData) → clear_internal ──
header('11. loadProject + new-project default')
{
  const { useStore } = await import('../src/store.js')
  const { emptyProjectData } = await import('../src/projects/manager.js')
  useStore.getState().loadProject(emptyProjectData())
  const mode = useStore.getState().projectSettings?.dimensionMode
  ok('new project (data.projectSettings == null) → clear_internal', mode === 'clear_internal')

  // Legacy save (explicit projectSettings without dimensionMode) → centerline default.
  useStore.getState().loadProject({
    ...emptyProjectData(),
    projectSettings: { projectMeta: { projectTitle: 'Legacy' } },  // no dimensionMode
  })
  const legacyMode = useStore.getState().projectSettings?.dimensionMode
  ok('legacy save → centerline default', legacyMode === 'centerline')

  // Explicit clear_internal save → preserved.
  useStore.getState().loadProject({
    ...emptyProjectData(),
    projectSettings: { dimensionMode: 'clear_internal' },
  })
  const explicitMode = useStore.getState().projectSettings?.dimensionMode
  ok('explicit clear_internal save → preserved', explicitMode === 'clear_internal')

  // setDimensionMode action.
  useStore.getState().setDimensionMode('centerline')
  ok('setDimensionMode("centerline") writes', useStore.getState().projectSettings?.dimensionMode === 'centerline')
  useStore.getState().setDimensionMode('garbage')
  ok('setDimensionMode rejects garbage', useStore.getState().projectSettings?.dimensionMode === 'centerline')
}

// ── 12. Aggregator wiring (plaster / paint / tiles / ceilingFinish) ──────
header('12. Aggregator output under both modes')
{
  const { useStore } = await import('../src/store.js')
  const { computePlasterQuantities }       = await import('../src/quantities/plaster.js')
  const { computeTileQuantities }          = await import('../src/quantities/tiles.js')
  const { computePaintQuantities }         = await import('../src/quantities/paint.js')
  const { computeCeilingFinishQuantities } = await import('../src/quantities/ceilingFinish.js')

  const FT = 12
  function reset() {
    useStore.getState().loadProject({
      nodes: {}, walls: {}, rooms: {}, stamps: {},
      columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {},
      projectSettings: undefined, unit: 'inch',
    })
  }
  function buildRoom(name, type, w, h) {
    const s = useStore.getState()
    const sw = s.getOrCreateNode(0,      0)
    const se = s.getOrCreateNode(w * FT, 0)
    const ne = s.getOrCreateNode(w * FT, h * FT)
    const nw = s.getOrCreateNode(0,      h * FT)
    s.addWall(sw, se); s.addWall(se, ne); s.addWall(ne, nw); s.addWall(nw, sw)
    const walls = Object.values(useStore.getState().walls)
    const findW = (a, b) => walls.find(w => (w.n1 === a && w.n2 === b) || (w.n2 === a && w.n1 === b))?.id
    const ids = [findW(sw, se), findW(se, ne), findW(ne, nw), findW(nw, sw)].filter(Boolean)
    ids.forEach(id => useStore.getState().togglePendingWall(id))
    useStore.getState().saveRoom(name, type)
  }

  // ── Centerline baseline ──────────────────────────────────────────
  reset()
  useStore.getState().setDimensionMode('centerline')
  buildRoom('Living', 'LIVING', 10, 10)
  const sCenter = useStore.getState()
  const plCenter = computePlasterQuantities(sCenter)
  const tlCenter = computeTileQuantities(sCenter)
  const pnCenter = computePaintQuantities(sCenter)
  const cfCenter = computeCeilingFinishQuantities(sCenter)
  ok('centerline plaster: internal walls+col = 400', approx(plCenter.totals.internalWallsAndColumnsFt2, 400))
  ok('centerline plaster: ceiling = 100', approx(plCenter.totals.ceilingFt2, 100, 0.5))
  ok('centerline paint: ceilingSft = 100', approx(pnCenter.totals.ceilingSft, 100, 0.5))
  ok('centerline paint: interiorWalls = 400', approx(pnCenter.totals.interiorWallsSft, 400, 0.5))
  ok('centerline ceilingFinish areaSft (NONE default) = 0', cfCenter.totals.areaSft === 0)
  // Tile assertions: LIVING with default flooring=true → floor tiles populated.
  ok('centerline tiles: 1 room', tlCenter.perRoom.length === 1)
  ok('centerline tiles: floor = 100 × 1.05 = 105', approx(tlCenter.perRoom[0].floorTilesFt2, 105, 0.5))
  ok('centerline tiles: perimeter = 40 ft', approx(tlCenter.perRoom[0].perimeterFt, 40, 0.05))

  // ── clear_internal — same fixture, switch mode ───────────────────
  useStore.getState().setDimensionMode('clear_internal')
  const sClear = useStore.getState()
  const plClear = computePlasterQuantities(sClear)
  const tlClear = computeTileQuantities(sClear)
  const pnClear = computePaintQuantities(sClear)
  // Expected: each inner edge length 9.25 ft (10 − 9"/2/12 × 2). Inner wall area
  // per face = 9.25 × 10 = 92.5; total 4 walls = 370.
  // Ceiling: 9.25² = 85.5625.
  ok('clear plaster: internal walls+col ≈ 370', approx(plClear.totals.internalWallsAndColumnsFt2, 370, 0.5))
  ok('clear plaster: ceiling ≈ 85.56', approx(plClear.totals.ceilingFt2, 85.56, 0.05))
  ok('clear paint: ceiling ≈ 85.56', approx(pnClear.totals.ceilingSft, 85.56, 0.05))
  ok('clear paint: interior walls ≈ 370', approx(pnClear.totals.interiorWallsSft, 370, 0.5))
  ok('clear tiles: floor ≈ 85.56 × 1.05 ≈ 89.84', approx(tlClear.perRoom[0].floorTilesFt2, 89.84, 0.1))
  ok('clear tiles: perimeter ≈ 37', approx(tlClear.perRoom[0].perimeterFt, 37, 0.05))

  // External wall outer face is unchanged across modes (physical centerline).
  ok('external outer face identical centerline/clear',
     approx(plCenter.totals.externalWallsFt2, plClear.totals.externalWallsFt2, 0.5))
}

// ── 13. Centerline mode = byte-identical to legacy on aggregator output ──
header('13. Centerline mode parity sanity (no aggregator regression)')
{
  // The Step-3 wiring keeps centerline mode byte-identical to the legacy
  // state.getWallArea / state.getRoomArea / topology helpers. The full
  // assertion suite that proves this lives in verify-boq (250+ checks);
  // here we re-confirm one sample to catch regressions in this script.
  const { useStore } = await import('../src/store.js')
  const { computePlasterQuantities } = await import('../src/quantities/plaster.js')
  const FT = 12
  useStore.getState().loadProject({
    nodes: {}, walls: {}, rooms: {}, stamps: {},
    columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {},
    projectSettings: undefined, unit: 'inch',
  })
  useStore.getState().setDimensionMode('centerline')
  const s = useStore.getState()
  const sw = s.getOrCreateNode(0,       0)
  const se = s.getOrCreateNode(20 * FT, 0)
  const ne = s.getOrCreateNode(20 * FT, 15 * FT)
  const nw = s.getOrCreateNode(0,       15 * FT)
  s.addWall(sw, se); s.addWall(se, ne); s.addWall(ne, nw); s.addWall(nw, sw)
  const walls = Object.values(useStore.getState().walls)
  const findW = (a, b) => walls.find(w => (w.n1 === a && w.n2 === b) || (w.n2 === a && w.n1 === b))?.id
  const ids = [findW(sw, se), findW(se, ne), findW(ne, nw), findW(nw, sw)].filter(Boolean)
  ids.forEach(id => useStore.getState().togglePendingWall(id))
  useStore.getState().saveRoom('R', 'LIVING')
  const q = computePlasterQuantities(useStore.getState())
  // 20×15 room: perimeter 70 ft × 10 height = 700 inner wall area = 700 ft²
  // (LIVING preset has no ceiling plaster, so ceiling = 0 here.)
  ok('centerline 20×15 inner wall area = 700', approx(q.totals.internalWallsAndColumnsFt2, 700))
}

// ── 14. getEffectiveWallLengthFt — Canvas label source (Correction 2) ────
header('14. getEffectiveWallLengthFt')
{
  const state = buildRectRoom({ wFt: 10, hFt: 10, thicknessIn: 9 })
  // Synthesize the .getWallLength method the topology helper expects.
  state.getWallLength = (wallId) => {
    const w = state.walls[wallId]
    if (!w) return 0
    const a = state.nodes[w.n1], b = state.nodes[w.n2]
    if (!a || !b) return 0
    return Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 12 * 100) / 100
  }
  const wallId = Object.keys(state.walls)[0]
  ok('centerline → bare length 10 ft',
     approx(getEffectiveWallLengthFt(state, wallId, 'centerline'), 10))
  ok('clear_internal → inset length 9.25 ft',
     approx(getEffectiveWallLengthFt(state, wallId, 'clear_internal'), 9.25))

  // Unbound wall (synthetic walls map with one wall not in any room).
  const orphanState = {
    nodes: { a: { x: 0, y: 0 }, b: { x: 120, y: 0 } },
    walls: { w1: { id: 'w1', n1: 'a', n2: 'b', thickness: 9 } },
    rooms: {},
    projectSettings: {},
    getWallLength: (id) => {
      const w = { w1: { n1: 'a', n2: 'b' } }[id]
      return w ? 10 : 0
    },
  }
  ok('unbound wall in clear_internal → centerline fallback',
     approx(getEffectiveWallLengthFt(orphanState, 'w1', 'clear_internal'), 10))
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(70))
console.log(`PASS: ${pass}  FAIL: ${fail}`)
console.log('═'.repeat(70))
if (fail > 0) process.exit(1)
