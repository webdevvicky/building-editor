// scripts/verify-snap.mjs
//
// Phase A — Task 3. Comprehensive verify script for the unified snap
// architecture in src/snap/. 7 sections (A–G) covering:
//   A. Defaults reproduce today's screenToWorld byte-identically (fuzz).
//   B. Per-target correctness (NODE, WALL_ENDPOINT, WALL_MIDPOINT,
//      WALL_NEAREST, WALL_SEGMENT, GRID).
//   C. Policy ordering + deterministic tie-break.
//   D. Settings (custom pitch, bypass, snap-disabled, per-target enable).
//   E. State setter round-trip (setSnapSettings deep-merge,
//      toggleSnapEnabled, buildDefaultTargetSettings).
//   F. Phase B forward-compat (prepare/abort, sourceId polymorphism,
//      no switch-dispatch, re-entrance).
//   G. Deterministic tie-breaking (shuffled-input fuzz).
//
// Run:
//   node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-snap.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SNAP_TARGETS,
  SNAP_TARGET_IDS,
  buildDefaultTargetSettings,
  TOOL_SNAP_POLICY,
  getToolPolicy,
  normalizePolicyEntry,
  findCandidates,
  findNearestCandidate,
  resolveSnap,
  resolveSnapPoint,
  screenToWorldRaw,
  runPrepareForAllTargets,
  getTargetDescriptor,
  _resetPrepareState,
  _getPrepareController,
} from '../src/snap/index.js'
import { snapIn, GRID_IN } from '../src/geometry.js'
import { useStore } from '../src/store.js'

// ────────────────────────────────────────────────────────────────────────
// Test harness
// ────────────────────────────────────────────────────────────────────────

let pass = 0, fail = 0
const sectionTotals = {}
let currentSection = '_'

function check(cond, msg) {
  if (cond) {
    pass++
    sectionTotals[currentSection] = (sectionTotals[currentSection] ?? { p: 0, f: 0 })
    sectionTotals[currentSection].p++
  } else {
    fail++
    sectionTotals[currentSection] = (sectionTotals[currentSection] ?? { p: 0, f: 0 })
    sectionTotals[currentSection].f++
    console.log(`  ✗ [${currentSection}] ${msg}`)
  }
}

function section(name) {
  currentSection = name
  console.log('\n' + '─'.repeat(70))
  console.log(name.toUpperCase())
  console.log('─'.repeat(70))
}

function sectionSummary(name) {
  const t = sectionTotals[name] ?? { p: 0, f: 0 }
  console.log(`  Section ${name}: ${t.p}/${t.p + t.f} passed${t.f ? ` (${t.f} failed)` : ''}`)
}

// Deterministic PRNG (LCG)
function makeRng(seed) {
  let s = seed >>> 0
  return function rand() {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

// ────────────────────────────────────────────────────────────────────────
// Test-fixture helpers
// ────────────────────────────────────────────────────────────────────────

function makeCleanState() {
  return {
    nodes: {},
    walls: {},
    rooms: {},
    currentFloorId: 'F1',
    projectSettings: {
      floors: [{ id: 'F1' }],
      snap: {
        enabled: true,
        pitchIn: 12,
        pitchPresets: [1, 3, 6, 12, 24],
        bypassKey: 'Alt',
        targets: buildDefaultTargetSettings(),
      },
    },
  }
}

function makeStateWithNodes(coords) {
  const state = makeCleanState()
  coords.forEach(([x, y], i) => {
    const id = `n${i}`
    state.nodes[id] = { id, x, y, floorIds: ['F1'] }
  })
  return state
}

function makeStateWithWall(ax, ay, bx, by) {
  const state = makeStateWithNodes([[ax, ay], [bx, by]])
  state.walls.w0 = { id: 'w0', n1: 'n0', n2: 'n1', floorId: 'F1' }
  return state
}

// Legacy screenToWorld — pre-snap-module implementation. Mirrors
// src/geometry.js::screenToWorld exactly (including Y-flip).
function legacyScreenToWorld(clientX, clientY, svgRect, pan, zoom) {
  const PX_PER_INCH = 5 / 3
  const sx = (clientX - svgRect.left - pan.x) / zoom
  const sy = (clientY - svgRect.top  - pan.y) / zoom
  return {
    x: snapIn( sx / PX_PER_INCH),
    y: snapIn(-sy / PX_PER_INCH),
  }
}

// Build the resolver ctx, mirroring how Canvas would.
function makeCtx(toolId, pan, zoom, svgRect, snapSettings, modifiers, registry) {
  return {
    toolId,
    pan,
    zoom,
    svgRect,
    settings:  snapSettings,
    modifiers: modifiers ?? { bypass: false },
    registry:  registry ?? undefined,
  }
}

// ════════════════════════════════════════════════════════════════════════
// Bootstrap purity grep — pure-module files must not import React/DOM.
// ════════════════════════════════════════════════════════════════════════
section('Bootstrap — module purity (4 files)')
{
  const __filename = fileURLToPath(import.meta.url)
  const repoRoot   = path.resolve(path.dirname(__filename), '..')
  const files = [
    'src/snap/targets.js',
    'src/snap/toolPolicy.js',
    'src/snap/candidates.js',
    'src/snap/resolver.js',
  ]
  for (const rel of files) {
    const abs = path.join(repoRoot, rel)
    const src = fs.readFileSync(abs, 'utf-8')
    // Strip block comments and line comments before searching, so the
    // contract docstrings don't trigger false positives.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map(line => line.replace(/\/\/.*$/, ''))
      .join('\n')
    const reactImport = /from\s+['"]react['"]/.test(stripped)
    const reactDomImport = /from\s+['"]react-dom['"]/.test(stripped)
    const windowRef = /\bwindow\./.test(stripped)
    const documentRef = /\bdocument\./.test(stripped)
    check(!reactImport,    `${rel}: no react import`)
    check(!reactDomImport, `${rel}: no react-dom import`)
    check(!windowRef,      `${rel}: no window. refs`)
    check(!documentRef,    `${rel}: no document. refs`)
  }
}
sectionSummary('Bootstrap — module purity (4 files)')

// ════════════════════════════════════════════════════════════════════════
// Section A — Defaults reproduce today's screenToWorld byte-identically.
// 100 random fuzz triples × tools.
// ════════════════════════════════════════════════════════════════════════
section('Section A — defaults reproduce today (byte-equality fuzz)')
{
  const rand = makeRng(12345)
  const triples = []
  for (let i = 0; i < 100; i++) {
    triples.push({
      clientX: rand() * 2000 - 500,
      clientY: rand() * 2000 - 500,
      pan:     { x: rand() * 400 - 200, y: rand() * 400 - 200 },
      zoom:    0.5 + rand() * 2.5,
    })
  }
  const svgRect = { left: 0, top: 0 }

  // Tools whose policy is GRID-or-falls-through-to-GRID on empty state.
  // These must match legacy screenToWorld byte-for-byte.
  //
  // MEP tools (plumbing/electrical/hvac/fire/elv) have policy
  // [WALL_NEAREST, GRID]: on empty canvas, WALL_NEAREST returns null
  // (no walls) → resolver falls through to GRID → byte-identical to
  // legacy. The GRID fallback was added post-implementation to preserve
  // current behavior.
  //
  // Phase W: WALL_JUNCTION added to draw / rect_room / column policies.
  // On clean canvas (no TJUNCTION nodes), WALL_JUNCTION returns null
  // and the fall-through to GRID is unchanged — byte-identical to
  // legacy preserved.
  const gridFallthroughTools = [
    'draw', 'rect_room', 'column',
    'sump', 'overhead_tank', 'septic_tank', 'stairs', 'lift',
    'plumbing', 'electrical', 'hvac', 'fire', 'elv',
  ]

  // Tools whose policy is []. Legacy uses screenToWorldRaw, so legacy
  // result === raw === resolver result.
  const rawTools = ['calibrate_underlay']

  // Phase W — Manual Join tool. Policy = [WALL_NEAREST]. On clean
  // canvas with no walls, WALL_NEAREST returns null → resolver
  // returns raw → matches screenToWorldRaw baseline (NOT screenToWorld).
  const wallNearestOnlyTools = ['join_walls']

  // Note: `split` policy is [WALL_SEGMENT]; in production never invoked on
  // an empty canvas (split is wall-click only). Skipped per brief.

  let byteMatches = 0
  let byteTotal   = 0

  for (const triple of triples) {
    const { clientX, clientY, pan, zoom } = triple
    const legacy = legacyScreenToWorld(clientX, clientY, svgRect, pan, zoom)
    const state  = makeCleanState()
    const settings = state.projectSettings.snap

    for (const toolId of gridFallthroughTools) {
      const r = resolveSnap(state,
        { clientX, clientY },
        makeCtx(toolId, pan, zoom, svgRect, settings))
      const match = Math.abs(legacy.x - r.worldXY.x) < 1e-9
                 && Math.abs(legacy.y - r.worldXY.y) < 1e-9
      check(match,
        `[${toolId}] byte-equal vs legacy at (${clientX.toFixed(2)},${clientY.toFixed(2)}) ` +
        `pan=(${pan.x.toFixed(2)},${pan.y.toFixed(2)}) z=${zoom.toFixed(3)} ` +
        `legacy=(${legacy.x},${legacy.y}) new=(${r.worldXY.x},${r.worldXY.y})`)
      byteTotal++
      if (match) byteMatches++
    }

    for (const toolId of rawTools) {
      const r = resolveSnap(state,
        { clientX, clientY },
        makeCtx(toolId, pan, zoom, svgRect, settings))
      const raw = screenToWorldRaw(clientX, clientY, svgRect, pan, zoom)
      const matchRaw = r.raw === true
                    && Math.abs(r.worldXY.x - raw.x) < 1e-9
                    && Math.abs(r.worldXY.y - raw.y) < 1e-9
      check(matchRaw,
        `[${toolId}] empty-policy returns raw worldXY`)
      byteTotal++
      if (matchRaw) byteMatches++
    }

    // Phase W — join_walls and other WALL_NEAREST-only tools on clean
    // canvas: WALL_NEAREST returns null → resolver returns raw.
    for (const toolId of wallNearestOnlyTools) {
      const r = resolveSnap(state,
        { clientX, clientY },
        makeCtx(toolId, pan, zoom, svgRect, settings))
      const raw = screenToWorldRaw(clientX, clientY, svgRect, pan, zoom)
      const matchRaw = r.raw === true
                    && Math.abs(r.worldXY.x - raw.x) < 1e-9
                    && Math.abs(r.worldXY.y - raw.y) < 1e-9
      check(matchRaw,
        `[${toolId}] WALL_NEAREST-only tool on empty canvas → raw worldXY`)
      byteTotal++
      if (matchRaw) byteMatches++
    }
  }
  const _totalTools = gridFallthroughTools.length + rawTools.length + wallNearestOnlyTools.length
  console.log(`  Section A: byte-equality ${byteMatches}/${byteTotal} ` +
              `(100 triples × ${_totalTools} tools)`)
}
sectionSummary('Section A — defaults reproduce today (byte-equality fuzz)')

// ════════════════════════════════════════════════════════════════════════
// Section B — Per-target correctness.
// ════════════════════════════════════════════════════════════════════════
section('Section B — per-target correctness')
{
  const svgRect = { left: 0, top: 0 }
  const pan = { x: 0, y: 0 }
  const PX_PER_INCH = 5 / 3

  // Helper to make a screen click that lands at a given world (x,y).
  // Invert the screenToWorldRaw transform: x = clientX/zoom/PX_PER_INCH
  //                                        y = -clientY/zoom/PX_PER_INCH
  function clickForWorld(wx, wy, zoom) {
    return {
      clientX:  wx * PX_PER_INCH * zoom,
      clientY: -wy * PX_PER_INCH * zoom,
    }
  }

  // ── B.1 NODE ──────────────────────────────────────────────────────────
  // Node placed off-grid (25, 37) so GRID candidate has a meaningfully
  // different distance and doesn't tie at distance=0 with NODE.
  {
    const state = makeStateWithNodes([[25, 37]])
    const settings = state.projectSettings.snap

    // Exact click → NODE wins, distance 0.
    {
      const c = clickForWorld(25, 37, 1)
      const r = resolveSnap(state, c, makeCtx('draw', pan, 1, svgRect, settings))
      check(r.targetKind === 'NODE',
        `NODE exact: targetKind=NODE got=${r.targetKind}`)
      check(Math.abs(r.worldXY.x - 25) < 1e-9 && Math.abs(r.worldXY.y - 37) < 1e-9,
        `NODE exact: world=(25,37) got=(${r.worldXY.x},${r.worldXY.y})`)
    }
    // 5in away → NODE outside 4in tolerance → falls through to GRID.
    {
      const c = clickForWorld(25 + 5, 37, 1)
      const r = resolveSnap(state, c, makeCtx('draw', pan, 1, svgRect, settings))
      check(r.targetKind === 'GRID',
        `NODE 5in away: falls through, got=${r.targetKind}`)
    }
    // 3in away → NODE wins (NODE dist=3, GRID dist > 3 since node is off-grid).
    {
      const c = clickForWorld(25 + 3, 37, 1)
      const r = resolveSnap(state, c, makeCtx('draw', pan, 1, svgRect, settings))
      check(r.targetKind === 'NODE',
        `NODE 3in away: wins, got=${r.targetKind}`)
      check(r.worldXY.x === 25 && r.worldXY.y === 37,
        `NODE 3in away: snapped to node coord`)
    }
  }

  // ── B.2 WALL_ENDPOINT ─────────────────────────────────────────────────
  // Endpoints placed off-grid to disambiguate from GRID candidate.
  {
    const state = makeStateWithWall(1, 1, 121, 1)
    const settings = state.projectSettings.snap

    {
      const c = clickForWorld(2, 1, 1)
      const r = resolveSnap(state, c, makeCtx('draw', pan, 1, svgRect, settings))
      check(r.targetKind === 'NODE' || r.targetKind === 'WALL_ENDPOINT',
        `WALL_ENDPOINT at (2,1): hits NODE or WALL_ENDPOINT, got=${r.targetKind}`)
      check(r.worldXY.x === 1 && r.worldXY.y === 1,
        `WALL_ENDPOINT at (2,1): snaps to (1,1)`)
    }
    {
      const c = clickForWorld(121, 3, 1)
      const r = resolveSnap(state, c, makeCtx('draw', pan, 1, svgRect, settings))
      check(r.targetKind === 'NODE' || r.targetKind === 'WALL_ENDPOINT',
        `WALL_ENDPOINT at (121,3): hits NODE or WALL_ENDPOINT, got=${r.targetKind}`)
      check(r.worldXY.x === 121 && r.worldXY.y === 1,
        `WALL_ENDPOINT at (121,3): snaps to (121,1)`)
    }
  }

  // ── B.3 WALL_MIDPOINT ─────────────────────────────────────────────────
  // Wall endpoints off-grid so midpoint (61, 1) is also off-grid; GRID
  // candidate disambiguates.
  {
    const state = makeStateWithWall(1, 1, 121, 1)
    const settings = state.projectSettings.snap

    // Default off → falls through.
    {
      const c = clickForWorld(61, 1, 1)
      const r = resolveSnap(state, c, makeCtx('draw', pan, 1, svgRect, settings))
      check(r.targetKind !== 'WALL_MIDPOINT',
        `WALL_MIDPOINT default-off: not midpoint, got=${r.targetKind}`)
    }
    // Enable midpoint → wins at exact midpoint.
    {
      const s2 = makeStateWithWall(1, 1, 121, 1)
      s2.projectSettings.snap.targets.WALL_MIDPOINT.enabled = true
      const c = clickForWorld(61, 1, 1)
      const r = resolveSnap(s2, c, makeCtx('draw', pan, 1, svgRect, s2.projectSettings.snap))
      check(r.targetKind === 'WALL_MIDPOINT',
        `WALL_MIDPOINT enabled: wins, got=${r.targetKind}`)
      check(r.worldXY.x === 61 && r.worldXY.y === 1,
        `WALL_MIDPOINT enabled: snaps to (61,1)`)
    }
  }

  // ── B.4 WALL_NEAREST ──────────────────────────────────────────────────
  {
    const state = makeStateWithWall(0, 0, 0, 200)
    const settings = state.projectSettings.snap

    // Click at (10,100) — 10in from wall → within 36in tolerance.
    {
      const c = clickForWorld(10, 100, 1)
      const r = resolveSnap(state, c, makeCtx('plumbing', pan, 1, svgRect, settings))
      check(r.targetKind === 'WALL_NEAREST',
        `WALL_NEAREST at (10,100): wins, got=${r.targetKind}`)
      check(Math.abs(r.worldXY.x - 0) < 1e-9 && Math.abs(r.worldXY.y - 100) < 1e-9,
        `WALL_NEAREST at (10,100): snaps to (0,100)`)
    }
    // Click at (40,100) — 40in from wall → outside 36in. Plumbing
    // policy is [WALL_NEAREST, GRID]; WALL_NEAREST returns null →
    // resolver falls through to GRID. (Pre-GRID-fallback the result
    // would have been raw; the policy now includes GRID to preserve
    // today's empty-canvas-MEP byte-equality.)
    {
      const c = clickForWorld(40, 100, 1)
      const r = resolveSnap(state, c, makeCtx('plumbing', pan, 1, svgRect, settings))
      check(r.targetKind === 'GRID',
        `WALL_NEAREST at (40,100): outside tolerance → GRID fallback, got=${r.targetKind}`)
    }
  }

  // ── B.5 WALL_SEGMENT ──────────────────────────────────────────────────
  {
    const state = makeStateWithWall(0, 0, 0, 200)
    const settings = state.projectSettings.snap

    // Click 5in away → within 12in tolerance.
    {
      const c = clickForWorld(5, 100, 1)
      const r = resolveSnap(state, c, makeCtx('split', pan, 1, svgRect, settings))
      check(r.targetKind === 'WALL_SEGMENT',
        `WALL_SEGMENT at (5,100): wins, got=${r.targetKind}`)
      check(Math.abs(r.worldXY.x - 0) < 1e-9 && Math.abs(r.worldXY.y - 100) < 1e-9,
        `WALL_SEGMENT at (5,100): snaps to (0,100)`)
    }
    // Click 15in away → outside 12in → raw.
    {
      const c = clickForWorld(15, 100, 1)
      const r = resolveSnap(state, c, makeCtx('split', pan, 1, svgRect, settings))
      check(r.raw === true,
        `WALL_SEGMENT at (15,100): outside tolerance → raw`)
    }
  }

  // ── B.6 GRID ──────────────────────────────────────────────────────────
  {
    const state = makeCleanState()
    const settings = state.projectSettings.snap

    {
      const c = clickForWorld(5.3, 5.3, 1)
      const r = resolveSnap(state, c, makeCtx('draw', pan, 1, svgRect, settings))
      check(r.targetKind === 'GRID',
        `GRID at (5.3,5.3): wins, got=${r.targetKind}`)
      check(r.worldXY.x === 0 && r.worldXY.y === 0,
        `GRID at (5.3,5.3): snaps to (0,0), got=(${r.worldXY.x},${r.worldXY.y})`)
    }
    {
      const c = clickForWorld(7.5, 7.5, 1)
      const r = resolveSnap(state, c, makeCtx('draw', pan, 1, svgRect, settings))
      check(r.worldXY.x === 12 && r.worldXY.y === 12,
        `GRID at (7.5,7.5): snaps to (12,12), got=(${r.worldXY.x},${r.worldXY.y})`)
    }
  }

  // ── B.7 Zoom invariance — tolerances are in world inches ──────────────
  {
    const state = makeStateWithNodes([[25, 37]])
    const settings = state.projectSettings.snap
    for (const zoom of [0.5, 1.0, 1.5, 2.5, 3.0]) {
      const c = clickForWorld(25 + 3, 37, zoom)
      const r = resolveSnap(state, c, makeCtx('draw', pan, zoom, svgRect, settings))
      check(r.targetKind === 'NODE',
        `NODE 3in away with zoom=${zoom}: tolerance invariant, got=${r.targetKind}`)
    }
  }
}
sectionSummary('Section B — per-target correctness')

// ════════════════════════════════════════════════════════════════════════
// Section C — Policy ordering + deterministic tie-break.
// ════════════════════════════════════════════════════════════════════════
section('Section C — policy ordering + tie-break')
{
  const svgRect = { left: 0, top: 0 }
  const pan = { x: 0, y: 0 }
  const PX_PER_INCH = 5 / 3
  function clickForWorld(wx, wy, zoom) {
    return { clientX: wx * PX_PER_INCH * zoom, clientY: -wy * PX_PER_INCH * zoom }
  }

  // C.1 — two near-coincident nodes; sortKey tie-break picks lower id.
  //       Nodes off-grid so GRID doesn't tie with NODE.
  {
    const state = makeCleanState()
    state.nodes.n0 = { id: 'n0', x: 25,     y: 37, floorIds: ['F1'] }
    state.nodes.n1 = { id: 'n1', x: 25.001, y: 37, floorIds: ['F1'] }
    const settings = state.projectSettings.snap

    let n0wins = 0
    for (let i = 0; i < 100; i++) {
      const c = clickForWorld(25, 37, 1)
      const r = resolveSnap(state, c, makeCtx('draw', pan, 1, svgRect, settings))
      if (r.sourceId === 'n0') n0wins++
    }
    check(n0wins === 100, `C.1 sortKey tie-break: n0 wins 100/100, got=${n0wins}`)
  }

  // C.2 — NODE and WALL_ENDPOINT coincident; tie-break via sortKey
  //       "node:..." < "wallEndpoint:..." (lex order n<w).
  {
    const state = makeCleanState()
    state.nodes.n0 = { id: 'n0', x: 25, y: 37, floorIds: ['F1'] }
    state.nodes.n1 = { id: 'n1', x: 200, y: 37, floorIds: ['F1'] }
    state.walls.w0 = { id: 'w0', n1: 'n0', n2: 'n1', floorId: 'F1' }
    const settings = state.projectSettings.snap

    const c = clickForWorld(25, 37, 1)
    const r = resolveSnap(state, c, makeCtx('draw', pan, 1, svgRect, settings))
    check(r.targetKind === 'NODE',
      `C.2 NODE vs WALL_ENDPOINT coincident: NODE wins (sortKey n<w), got=${r.targetKind}`)
  }

  // C.3 — disable NODE, WALL_ENDPOINT wins on the same coincident click.
  {
    const state = makeCleanState()
    state.nodes.n0 = { id: 'n0', x: 25, y: 37, floorIds: ['F1'] }
    state.nodes.n1 = { id: 'n1', x: 200, y: 37, floorIds: ['F1'] }
    state.walls.w0 = { id: 'w0', n1: 'n0', n2: 'n1', floorId: 'F1' }
    state.projectSettings.snap.targets.NODE.enabled = false
    const settings = state.projectSettings.snap

    const c = clickForWorld(25, 37, 1)
    const r = resolveSnap(state, c, makeCtx('draw', pan, 1, svgRect, settings))
    check(r.targetKind === 'WALL_ENDPOINT',
      `C.3 NODE disabled: next-in-policy WALL_ENDPOINT wins, got=${r.targetKind}`)
  }

  // C.4 — disabling NODE consults next policy entry, not skips entirely.
  {
    const state = makeCleanState()
    state.projectSettings.snap.targets.NODE.enabled = false
    const settings = state.projectSettings.snap
    const c = clickForWorld(5, 5, 1)
    const r = resolveSnap(state, c, makeCtx('draw', pan, 1, svgRect, settings))
    check(r.targetKind === 'GRID',
      `C.4 NODE disabled on empty state: walks to GRID, got=${r.targetKind}`)
  }
}
sectionSummary('Section C — policy ordering + tie-break')

// ════════════════════════════════════════════════════════════════════════
// Section D — Settings (custom pitch, bypass, snap-disabled).
// ════════════════════════════════════════════════════════════════════════
section('Section D — settings')
{
  const svgRect = { left: 0, top: 0 }
  const pan = { x: 0, y: 0 }
  const PX_PER_INCH = 5 / 3
  function clickForWorld(wx, wy, zoom) {
    return { clientX: wx * PX_PER_INCH * zoom, clientY: -wy * PX_PER_INCH * zoom }
  }

  // D.1 — pitchIn=3 → snap to nearest 3in cell.
  {
    const state = makeCleanState()
    state.projectSettings.snap.pitchIn = 3
    const c = clickForWorld(5, 5, 1)
    const r = resolveSnap(state, c, makeCtx('draw', pan, 1, svgRect, state.projectSettings.snap))
    check(r.worldXY.x === 6 && r.worldXY.y === 6,
      `D.1 pitchIn=3 at (5,5): snaps to (6,6), got=(${r.worldXY.x},${r.worldXY.y})`)
  }
  // D.2 — pitchIn=1 → near no-op.
  {
    const state = makeCleanState()
    state.projectSettings.snap.pitchIn = 1
    const c = clickForWorld(5.3, 5.7, 1)
    const r = resolveSnap(state, c, makeCtx('draw', pan, 1, svgRect, state.projectSettings.snap))
    check(r.worldXY.x === 5 && r.worldXY.y === 6,
      `D.2 pitchIn=1 at (5.3,5.7): snaps to (5,6), got=(${r.worldXY.x},${r.worldXY.y})`)
  }
  // D.3 — pitchIn=24 → snap to nearest 24in cell.
  {
    const state = makeCleanState()
    state.projectSettings.snap.pitchIn = 24
    const c1 = clickForWorld(10, 10, 1)
    const r1 = resolveSnap(state, c1, makeCtx('draw', pan, 1, svgRect, state.projectSettings.snap))
    check(r1.worldXY.x === 0 && r1.worldXY.y === 0,
      `D.3a pitchIn=24 at (10,10): snaps to (0,0), got=(${r1.worldXY.x},${r1.worldXY.y})`)
    const c2 = clickForWorld(15, 15, 1)
    const r2 = resolveSnap(state, c2, makeCtx('draw', pan, 1, svgRect, state.projectSettings.snap))
    check(r2.worldXY.x === 24 && r2.worldXY.y === 24,
      `D.3b pitchIn=24 at (15,15): snaps to (24,24), got=(${r2.worldXY.x},${r2.worldXY.y})`)
  }
  // D.4 — modifiers.bypass → raw worldXY.
  {
    const state = makeStateWithNodes([[24, 36]])
    const settings = state.projectSettings.snap
    const c = clickForWorld(24, 36, 1)
    const r = resolveSnap(state, c, makeCtx('draw', pan, 1, svgRect, settings, { bypass: true }))
    check(r.raw === true,
      `D.4 bypass: raw=true, got raw=${r.raw}`)
    const raw = screenToWorldRaw(c.clientX, c.clientY, svgRect, pan, 1)
    check(Math.abs(r.worldXY.x - raw.x) < 1e-9 && Math.abs(r.worldXY.y - raw.y) < 1e-9,
      `D.4 bypass: worldXY === screenToWorldRaw`)
  }
  // D.5 — settings.enabled=false → raw worldXY.
  {
    const state = makeStateWithNodes([[24, 36]])
    state.projectSettings.snap.enabled = false
    const settings = state.projectSettings.snap
    const c = clickForWorld(24, 36, 1)
    const r = resolveSnap(state, c, makeCtx('draw', pan, 1, svgRect, settings))
    check(r.raw === true,
      `D.5 enabled=false: raw=true`)
  }
  // D.6 — disable GRID target only → other targets still work.
  {
    const state = makeStateWithNodes([[24, 36]])
    state.projectSettings.snap.targets.GRID.enabled = false
    const settings = state.projectSettings.snap
    // Near a node — NODE still wins.
    const c1 = clickForWorld(24 + 2, 36, 1)
    const r1 = resolveSnap(state, c1, makeCtx('draw', pan, 1, svgRect, settings))
    check(r1.targetKind === 'NODE',
      `D.6a GRID disabled, near node: NODE wins, got=${r1.targetKind}`)
    // Far from any node — GRID skipped, no other matches → raw.
    const c2 = clickForWorld(500, 500, 1)
    const r2 = resolveSnap(state, c2, makeCtx('draw', pan, 1, svgRect, settings))
    check(r2.raw === true,
      `D.6b GRID disabled, far from nodes: raw=true (no match)`)
  }
}
sectionSummary('Section D — settings')

// ════════════════════════════════════════════════════════════════════════
// Section E — State setter round-trips.
// ════════════════════════════════════════════════════════════════════════
section('Section E — state setter round-trip')
{
  const s = useStore.getState

  // Initial load to known state.
  s().loadProject({
    nodes: {}, walls: {}, rooms: {}, stamps: {},
    columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {},
    projectSettings: undefined,
  })

  // E.1 — defaults present after loadProject.
  {
    const snap = s().projectSettings.snap
    check(snap != null, `E.1a snap settings present after loadProject`)
    check(snap.enabled === true, `E.1b snap.enabled default = true`)
    check(snap.pitchIn === 12, `E.1c snap.pitchIn default = 12`)
    check(Array.isArray(snap.pitchPresets), `E.1d snap.pitchPresets is array`)
    check(snap.targets != null, `E.1e snap.targets present`)
    for (const id of SNAP_TARGET_IDS) {
      check(snap.targets[id] != null, `E.1f snap.targets[${id}] present`)
    }
  }

  // E.2 — setSnapSettings({ pitchIn: 3 }) deep-merges, preserves targets.
  {
    const before = s().projectSettings.snap.targets
    s().setSnapSettings({ pitchIn: 3 })
    const after = s().projectSettings.snap
    check(after.pitchIn === 3, `E.2a pitchIn now 3`)
    check(after.enabled === true, `E.2b enabled untouched`)
    for (const id of SNAP_TARGET_IDS) {
      check(after.targets[id] != null,
        `E.2c targets[${id}] still present after pitchIn change`)
    }
    // Per-target tolerance must survive.
    check(after.targets.NODE.toleranceIn === before.NODE.toleranceIn,
      `E.2d NODE.toleranceIn preserved`)
  }

  // E.3 — setSnapSettings({ targets: { NODE: { enabled: false } } }) —
  //       nested merge per target id.
  {
    const beforeNode = { ...s().projectSettings.snap.targets.NODE }
    const beforeWE   = { ...s().projectSettings.snap.targets.WALL_ENDPOINT }
    s().setSnapSettings({ targets: { NODE: { enabled: false } } })
    const after = s().projectSettings.snap
    check(after.targets.NODE.enabled === false,
      `E.3a NODE.enabled now false`)
    check(after.targets.NODE.toleranceIn === beforeNode.toleranceIn,
      `E.3b NODE.toleranceIn preserved (nested merge), ` +
      `before=${beforeNode.toleranceIn} after=${after.targets.NODE.toleranceIn}`)
    // Sibling target completely untouched.
    check(after.targets.WALL_ENDPOINT.enabled === beforeWE.enabled,
      `E.3c sibling WALL_ENDPOINT.enabled untouched`)
    check(after.targets.WALL_ENDPOINT.toleranceIn === beforeWE.toleranceIn,
      `E.3d sibling WALL_ENDPOINT.toleranceIn untouched`)
  }

  // E.4 — toggleSnapEnabled flips snap.enabled.
  {
    const before = s().projectSettings.snap.enabled
    s().toggleSnapEnabled()
    const after = s().projectSettings.snap.enabled
    check(after === !before, `E.4a toggle flips enabled, before=${before} after=${after}`)
    s().toggleSnapEnabled()
    check(s().projectSettings.snap.enabled === before, `E.4b toggle back`)
  }

  // E.5 — buildDefaultTargetSettings returns object with every SNAP_TARGET_IDS member.
  {
    const def = buildDefaultTargetSettings()
    check(def != null && typeof def === 'object',
      `E.5a buildDefaultTargetSettings returns object`)
    for (const id of SNAP_TARGET_IDS) {
      check(def[id] != null, `E.5b def[${id}] populated`)
      // Each entry is a fresh copy (mutable).
      def[id].toleranceIn = 999
      const def2 = buildDefaultTargetSettings()
      check(def2[id].toleranceIn !== 999,
        `E.5c def[${id}] is a fresh copy each call`)
      // restore
      def[id].toleranceIn = undefined
    }
  }
}
sectionSummary('Section E — state setter round-trip')

// ════════════════════════════════════════════════════════════════════════
// Section F — Phase B forward-compat (8 sub-assertions: F1–F8).
// ════════════════════════════════════════════════════════════════════════
section('Section F — Phase B forward-compat (F1–F8)')
{
  const STUB_KIND = 'UNDERLAY_FEATURE_STUB'

  // We test the stub by injecting it under an EXISTING policy id so the
  // resolver consults it. We choose WALL_NEAREST (used by MEP tools): the
  // custom registry overrides the WALL_NEAREST descriptor with stub
  // semantics. The toolPolicy still references WALL_NEAREST by id; the
  // resolver's `targets[norm.id]` lookup pulls from the custom registry.
  //
  // For runPrepareForAllTargets re-entrance (F8), we use the actual
  // STUB_KIND id in a registry containing ONLY the stub — that path
  // doesn't touch toolPolicy.

  let _prepareCallCount = 0
  let _prepareSignals   = []
  let _cacheVisible     = null   // state ref that prepare last saw

  function makeStubTarget(kindId) {
    return {
      id:              kindId,
      label:           'Underlay edge (stub)',
      defaultSettings: { enabled: true, toleranceIn: 8 },
      async prepare(state, signal) {
        _prepareCallCount++
        _prepareSignals.push(signal)
        await Promise.resolve()
        if (signal.aborted) return
        _cacheVisible = state
      },
      query(state, world, settings) {
        if (!settings?.enabled) return null
        if (_cacheVisible !== state) return null
        return {
          point:      { x: world.x + 0.5, y: world.y },
          sourceId:   { kind: 'UNDERLAY_PIXEL', pxX: 12.34, pxY: 56.78 },
          distanceIn: 0.5,
          _sortKey:   `${kindId}:12.34,56.78`,
        }
      },
      displayLabel: () => 'Edge ↗',
      renderOverlay: (result) => ({ kind: 'STUB_NODE', payload: result }),
    }
  }

  // ── F1: Zero-files-touched — adding stub adds NO production-file edits.
  // We satisfy this by verifying the test registry is purely test-side
  // and the stub never touches src/. Stronger: re-grep src/ for the stub
  // string (should be absent).
  {
    const __filename = fileURLToPath(import.meta.url)
    const repoRoot   = path.resolve(path.dirname(__filename), '..')
    const srcRoot = path.join(repoRoot, 'src')
    let found = false
    function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.isFile() && (p.endsWith('.js') || p.endsWith('.jsx'))) {
          const src = fs.readFileSync(p, 'utf-8')
          if (src.includes(STUB_KIND)) found = true
        }
      }
    }
    walk(srcRoot)
    check(!found,
      `F1: STUB id '${STUB_KIND}' not present in src/ (zero-files-touched)`)
  }

  // ── F2: prepare invoked + resolver returns synchronously (not awaited).
  {
    _resetPrepareState()
    _prepareCallCount = 0
    _prepareSignals.length = 0
    _cacheVisible = null
    const stub = makeStubTarget(STUB_KIND)
    const state = makeCleanState()
    const pendings = runPrepareForAllTargets(state, { [STUB_KIND]: stub })
    check(_prepareCallCount === 1,
      `F2a runPrepareForAllTargets invokes prepare once (count=${_prepareCallCount})`)
    check(pendings.length === 1,
      `F2b returns 1 pending promise (count=${pendings.length})`)

    // Resolver must return synchronously (no await). Measure resolution
    // time against a generous bound. Use 'draw' (no prepare needed) — the
    // assertion is that resolveSnap is not awaiting anything.
    const start = Date.now()
    resolveSnap(state, { clientX: 0, clientY: 0 },
      makeCtx('draw', { x: 0, y: 0 }, 1, { left: 0, top: 0 }, state.projectSettings.snap))
    const elapsed = Date.now() - start
    check(elapsed < 50,
      `F2c resolveSnap returns synchronously (<50ms), got=${elapsed}ms`)
  }

  // ── F3: cache miss returns null → resolver falls through gracefully.
  //
  // Plumbing tool policy is [WALL_NEAREST, GRID]. The stub hijacks
  // WALL_NEAREST; when its cache is empty, query() returns null and the
  // resolver continues to GRID. The CONTRACT assertion is "cache miss
  // doesn't crash; the resolver moves to the next policy entry without
  // throwing." So we assert: targetKind !== STUB_KIND (the stub did NOT
  // win), and no exception was raised. Whether the next entry is GRID or
  // raw fall-through is a policy concern, not a contract concern.
  {
    _resetPrepareState()
    _prepareCallCount = 0
    _cacheVisible = null
    const stub = makeStubTarget('WALL_NEAREST')  // hijack WALL_NEAREST
    const state = makeStateWithWall(0, 0, 0, 200)
    const customRegistry = { ...SNAP_TARGETS, WALL_NEAREST: stub }
    const PX_PER_INCH = 5 / 3
    const c = { clientX: 5 * PX_PER_INCH, clientY: -100 * PX_PER_INCH }
    let threw = false
    let r = null
    try {
      r = resolveSnap(state, c, {
        toolId:    'plumbing',
        pan:       { x: 0, y: 0 },
        zoom:      1,
        svgRect:   { left: 0, top: 0 },
        settings:  state.projectSettings.snap,
        modifiers: { bypass: false },
        registry:  customRegistry,
      })
    } catch (e) {
      threw = true
    }
    check(!threw,
      `F3a cache miss did not throw`)
    check(r != null && r.targetKind !== STUB_KIND && r.targetKind !== 'WALL_NEAREST',
      `F3b cache miss: stub did NOT win, targetKind=${r?.targetKind}`)
  }

  // ── F4: polymorphic sourceId after prepare completes.
  {
    _resetPrepareState()
    _prepareCallCount = 0
    _prepareSignals.length = 0
    _cacheVisible = null
    const stub = makeStubTarget('WALL_NEAREST')
    const customRegistry = { ...SNAP_TARGETS, WALL_NEAREST: stub }
    const state = makeStateWithWall(0, 0, 0, 200)

    // Run prepare; await microtasks.
    const pendings = runPrepareForAllTargets(state, { WALL_NEAREST: stub })
    await Promise.all(pendings)
    // _cacheVisible should now === state.
    check(_cacheVisible === state, `F4a prepare populated cache`)

    const PX_PER_INCH = 5 / 3
    const c = { clientX: 5 * PX_PER_INCH, clientY: -100 * PX_PER_INCH }
    const r = resolveSnap(state, c, {
      toolId:    'plumbing',
      pan:       { x: 0, y: 0 },
      zoom:      1,
      svgRect:   { left: 0, top: 0 },
      settings:  state.projectSettings.snap,
      modifiers: { bypass: false },
      registry:  customRegistry,
    })
    check(r.targetKind === 'WALL_NEAREST',
      `F4b stub query won, targetKind=${r.targetKind}`)
    check(typeof r.sourceId === 'object' && r.sourceId !== null,
      `F4c sourceId is an object (polymorphic)`)
    check(r.sourceId?.kind === 'UNDERLAY_PIXEL',
      `F4d sourceId.kind === 'UNDERLAY_PIXEL', got=${r.sourceId?.kind}`)
    check(r.sourceId?.pxX === 12.34,
      `F4e sourceId.pxX === 12.34, got=${r.sourceId?.pxX}`)
  }

  // ── F5: displayLabel via getTargetDescriptor.
  {
    const stub = makeStubTarget(STUB_KIND)
    const desc = getTargetDescriptor(STUB_KIND, { [STUB_KIND]: stub })
    check(desc != null, `F5a getTargetDescriptor returns descriptor`)
    const lbl = desc.displayLabel(null, null)
    check(lbl === 'Edge ↗',
      `F5b displayLabel returns 'Edge ↗', got='${lbl}'`)
  }

  // ── F6: renderOverlay returns the sentinel object.
  {
    const stub = makeStubTarget(STUB_KIND)
    const desc = getTargetDescriptor(STUB_KIND, { [STUB_KIND]: stub })
    const fakeResult = { point: { x: 1, y: 2 }, sourceId: 'foo' }
    const helpers = {}
    const out = desc.renderOverlay(fakeResult, helpers)
    check(out && out.kind === 'STUB_NODE',
      `F6a renderOverlay returns { kind: 'STUB_NODE' }, got=${JSON.stringify(out)}`)
    check(out.payload === fakeResult,
      `F6b renderOverlay payload === input result`)
  }

  // ── F7: no `switch(kind)` dispatch in production code.
  {
    const __filename = fileURLToPath(import.meta.url)
    const repoRoot   = path.resolve(path.dirname(__filename), '..')
    const filesToScan = [
      'src/snap/targets.js',
      'src/snap/toolPolicy.js',
      'src/snap/candidates.js',
      'src/snap/resolver.js',
      'src/components/Canvas.jsx',
    ]
    // Forbidden patterns: switch dispatches on result.targetKind /
    // targetKind / result.kind / `kind`, including a case body referencing
    // any SNAP_TARGET id literal.
    const forbidden = [
      /switch\s*\(\s*([a-zA-Z_$][\w.$]*\.)?targetKind\b/,
      /switch\s*\(\s*([a-zA-Z_$][\w.$]*\.)?kind\b/,
    ]
    let allClean = true
    const offenders = []
    for (const rel of filesToScan) {
      const abs = path.join(repoRoot, rel)
      let src
      try { src = fs.readFileSync(abs, 'utf-8') }
      catch { continue }
      const stripped = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map(line => line.replace(/\/\/.*$/, ''))
        .join('\n')
      for (const re of forbidden) {
        if (re.test(stripped)) {
          allClean = false
          offenders.push(`${rel} :: ${re}`)
        }
      }
    }
    check(allClean,
      `F7 no switch(targetKind) / switch(kind) in production code` +
      (offenders.length ? `\n     offenders: ${offenders.join('; ')}` : ''))
  }

  // ── F8: prepare re-entrance — first signal aborted before second starts.
  {
    _resetPrepareState()
    _prepareCallCount = 0
    _prepareSignals.length = 0

    let firstResolve = null
    const slowStub = {
      id:              STUB_KIND,
      label:           'Slow stub',
      defaultSettings: { enabled: true, toleranceIn: 8 },
      prepare(state, signal) {
        _prepareCallCount++
        _prepareSignals.push(signal)
        return new Promise(resolve => { firstResolve = resolve })
      },
      query: () => null,
      displayLabel: () => 'slow',
    }
    const state1 = makeCleanState()
    const state2 = makeCleanState()   // distinct ref → forces re-prepare

    runPrepareForAllTargets(state1, { [STUB_KIND]: slowStub })
    check(_prepareCallCount === 1,
      `F8a first prepare invoked (count=${_prepareCallCount})`)
    check(_prepareSignals.length === 1 && _prepareSignals[0].aborted === false,
      `F8b first signal initially not aborted`)
    const firstController = _getPrepareController(STUB_KIND)
    check(firstController != null,
      `F8c first AbortController registered`)

    // Re-invoke with distinct state — must abort the first signal first.
    runPrepareForAllTargets(state2, { [STUB_KIND]: slowStub })
    check(_prepareCallCount === 2,
      `F8d second prepare invoked (count=${_prepareCallCount})`)
    check(_prepareSignals[0].aborted === true,
      `F8e first signal now aborted (aborted=${_prepareSignals[0].aborted})`)
    check(_prepareSignals[1].aborted === false,
      `F8f second signal not aborted`)
    const secondController = _getPrepareController(STUB_KIND)
    check(secondController !== firstController,
      `F8g live controller swapped to second`)

    // Cleanup
    if (firstResolve) firstResolve()
    _resetPrepareState()
  }
}
sectionSummary('Section F — Phase B forward-compat (F1–F8)')

// ════════════════════════════════════════════════════════════════════════
// Section G — Deterministic tie-breaking (100 shuffled-input runs).
// ════════════════════════════════════════════════════════════════════════
section('Section G — deterministic tie-breaking (shuffled inputs)')
{
  const svgRect = { left: 0, top: 0 }
  const pan = { x: 0, y: 0 }
  const PX_PER_INCH = 5 / 3
  function clickForWorld(wx, wy, zoom) {
    return { clientX: wx * PX_PER_INCH * zoom, clientY: -wy * PX_PER_INCH * zoom }
  }

  // G.1 — three near-coincident nodes (off-grid), click roughly equidistant.
  //       Permutation-invariant winner.
  {
    const nodeSpecs = [
      { id: 'n0', x: 25,     y: 37     },
      { id: 'n1', x: 25.001, y: 37.001 },
      { id: 'n2', x: 25.002, y: 36.999 },
    ]
    const rand = makeRng(0xdeadbeef)
    // Establish baseline winner with insertion order [0,1,2].
    let baselineWinner = null
    let identicalRuns = 0
    for (let run = 0; run < 100; run++) {
      // Shuffle nodeSpecs via Fisher–Yates with rng.
      const arr = nodeSpecs.slice()
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
      }
      // Build state with this insertion order.
      const state = makeCleanState()
      for (const n of arr) {
        state.nodes[n.id] = { id: n.id, x: n.x, y: n.y, floorIds: ['F1'] }
      }
      const c = clickForWorld(25.0005, 37, 1)
      const r = resolveSnap(state, c, makeCtx('draw', pan, 1, svgRect, state.projectSettings.snap))
      if (run === 0) baselineWinner = r.sourceId
      if (r.sourceId === baselineWinner) identicalRuns++
    }
    check(identicalRuns === 100,
      `G.1 insertion-order invariant: 100/100 identical winners, got=${identicalRuns}`)
  }

  // G.2 — coincident NODE + WALL_ENDPOINT, equal distance 0. NODE wins
  //       deterministically via sortKey "node:..." < "wallEndpoint:...".
  //       Use off-grid coords so GRID candidate has nonzero distance.
  {
    let nodeWins = 0
    for (let run = 0; run < 100; run++) {
      const state = makeCleanState()
      state.nodes.n0 = { id: 'n0', x: 11, y: 11, floorIds: ['F1'] }
      state.nodes.n1 = { id: 'n1', x: 200, y: 11, floorIds: ['F1'] }
      state.walls.w0 = { id: 'w0', n1: 'n0', n2: 'n1', floorId: 'F1' }
      const c = clickForWorld(11, 11, 1)
      const r = resolveSnap(state, c, makeCtx('draw', pan, 1, svgRect, state.projectSettings.snap))
      if (r.targetKind === 'NODE') nodeWins++
    }
    check(nodeWins === 100,
      `G.2 NODE vs WALL_ENDPOINT @ distance 0: NODE wins 100/100, got=${nodeWins}`)
  }

  // G.3 — resolver candidate-comparator stability: distance asc, sortKey lex.
  //       Off-grid nodes to disambiguate GRID candidate.
  {
    let distanceWins = 0
    for (let run = 0; run < 100; run++) {
      const state = makeCleanState()
      // Insert in REVERSE order to defeat naïve "first in wins".
      state.nodes.n1 = { id: 'n1', x: 21, y: 11, floorIds: ['F1'] }
      state.nodes.n0 = { id: 'n0', x: 11, y: 11, floorIds: ['F1'] }
      const c = clickForWorld(11, 11, 1)
      const r = resolveSnap(state, c, makeCtx('draw', pan, 1, svgRect, state.projectSettings.snap))
      if (r.sourceId === 'n0') distanceWins++
    }
    check(distanceWins === 100,
      `G.3 distance-asc primary key: closer node wins 100/100 (reverse-insert), got=${distanceWins}`)
  }
}
sectionSummary('Section G — deterministic tie-breaking (shuffled inputs)')

// ────────────────────────────────────────────────────────────────────────
// Final report
// ────────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(70))
console.log(`TOTAL: ${pass} passed, ${fail} failed (${pass + fail} assertions)`)
console.log('═'.repeat(70))

if (fail > 0) {
  console.error(`✗ verify-snap FAILED: ${fail} assertions`)
  process.exit(1)
} else {
  console.log(`✓ verify-snap passed (${pass} assertions)`)
  process.exit(0)
}
