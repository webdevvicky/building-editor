# Building Editor — Developer Notes

## Codebase Overview

Vite + React 19 + Zustand 5 client-side editor for residential BOQ to Indian standards (IS 732, IS 15778, IS 13592, NBC 2016, IS 2065, ISHRAE, MNRE). Five concentric layers — Geometry/Store → Topology → Quantities + MEP + Validation → BOQ presentation → UI + Persistence + Export. ~319 source files across 40 directories under `src/` plus **35 verify scripts** that gate every commit. Greenfield project: IDB-canonical persistence, no migrations, no backend.

For the architectural map (diagrams, module guide, data flow, navigation "to do X, touch Y" recipes, and the invariant → enforcing-verify-script reverse index) see [docs/CODEBASE_MAP.md](docs/CODEBASE_MAP.md). The rule reference (every locked rule, every Phase's history, every gotcha worth memorizing) is this file — Phase sections below.

## Phase BOQ-WorkQty — Work quantities + element labels + room/export detail (2026-06-12)

Three landings on `main` (`62bd3f7` work-quantity lines + `14c710f` element
labels + room breakdown + `6369887` export sheets). Closes three gaps: (1)
several computed work quantities were never emitted as BOQ lines; (2) no
human-readable per-element spatial-tracking IDs existed; (3) the export had no
room-wise / per-wall / element-ID breakdown. **No new verify script** — all
changes are additive over existing data-layer contracts; the 35 existing scripts
stay green and `verify-boq` / `verify-room-breakdown` cover the new paths.

### What landed

| # | Item | Notes |
|---|---|---|
| 1 | Work-quantity BOQ lines (`boq/lines.js`) | Masonry brickwork by thickness (9″→Cft, 4.5″→Sft half-brick, other→Cft), beam length (Rft/level), main+sunken slab area (Sft), parapet length (Rft), staircase granite (Sft) + step count (Nos). All via `push()`; `meta.role:'WORK_QTY'`; masonry material sub-lines now `meta.role:'MATERIAL'`. New ids in `constants/boqCategories.js` (`masonryWork`/`beamLen` builders + `SLAB_MAIN_AREA`/`SLAB_SUNKEN_AREA`/`PARAPET_LEN`/`STAIR_GRANITE`/`STAIR_STEP_COUNT`). |
| 2 | `getMasonryByThickness()` | New masonry selector — LIVE store (`structuralSlice.js`, all-floors) + BOTH scope.js builders. Shape `{ [matKey]: { byThickness: { [thicknessIn]: { volFt3, faceAreaFt2 } } } }`. Floor/live scope count each wall once with beam deduction; ROOM scope applies the HALF_PARTITION ×0.5 factor (mirrors room-scope `getMaterialQuantities`, no beam deduction). Both skip virtual/plot. |
| 3 | Element labels (`boq/elementLabels.js`, NEW) | `assignLabelsToState(state)` pure planner + `getElementLabels(state)` selector. Labels: W/R/C/B/S, per-floor sequential, `W-001` single-floor → `W-F1-001` multi-floor. |
| 4 | `labelNo` schema slot | Added to wall/room/column/beam/slab schemas (`number\|null`, default null). |
| 5 | `assignElementLabels()` store action | Wired into every creation action (`addWall`, `splitWall`, `saveRoom`, `addColumn`, `addBeam`, `addBeamWithEndpoints`, `addSlab`, `autoInitSlabs`) + `loadProject` backfill. |
| 6 | Room breakdown per-wall detail (`boq/roomBreakdown.js`) | Each room row gains `carpetAreaFt2` (clear_internal), `wallCount`, `ceilingHeightFt`, `perWall[]` (label, faceType, length/height/thickness, gross/opening-deduct/net plaster, brickworkCft, openings). Derived from existing `computePlasterQuantities()._meta.perRoom` — no new geometry. `RoomBreakdownPanel` rows expandable; carpet + ceiling-height columns added. |
| 7 | Export (`export/excel.js` + `boq/presentationModel.js`) | Model gains additive `elementLabels` + `roomBreakdown`. Excel: MATERIAL lines indented under their WORK_QTY parent via `meta.role`; three new sheets — Room Breakdown, Per-Wall Detail, Element IDs. Reuses existing SheetJS API; totals unchanged. |

### Locked rules (Phase BOQ-WorkQty)

- **`labelNo` is the immutable element identity — assign-once, never
  reassigned.** Stored as an integer (per-type, per-floor sequence) like
  `ifcGlobalId`; assigned at creation + backfilled on load. The rendered
  string (single vs multi-floor prefix) is DERIVED at read time by
  `getElementLabels`, so adding a floor never renumbers an existing element
  (a single→multi transition only ADDS a floor qualifier — `W-001`→`W-F1-001`).
  `assignLabelsToState` is idempotent and skips any entity that already has a
  `labelNo`. Floor for a column's label = `baseFloorId`.
- **`meta.role ∈ WORK_QTY | MATERIAL`** on the lines it applies to. WORK_QTY =
  primary work-quantity line; MATERIAL = a material sub-line that the exporter
  indents under its preceding WORK_QTY parent. Lines without `role` render as
  normal primary rows. The NOS step-count WORK_QTY line is auto-excluded from
  contingency by the existing NOS rule.
- **`getMasonryByThickness` mirrors each builder's existing masonry
  attribution.** Live + floor scope: every non-virtual/non-plot wall once,
  with the same per-wall beam deduction as `getMasonryWithBeamDeduction`. Room
  scope: HALF_PARTITION ×0.5 for partition walls (adj≥2), no beam deduction —
  identical policy to room-scope `getMaterialQuantities`. The live-store sibling
  is required so the all-floors BOQ view (unscoped path) shows the lines;
  `lines.js` guards with `?.() ?? {}`.
- **Per-wall room detail derives from `plaster._meta.perRoom.wallContributions`
  — no new geometry walk.** `faceAreaFt2` there is already net (opening-deducted)
  and IS the per-wall net plaster area. `roomBreakdown.js` stays React/DOM-free.
- **Exporters still consume the presentation model only.** `elementLabels` +
  `roomBreakdown` are additive model fields; `excel.js` does no new quantity
  math — sheet rendering reads the model.

## Phase BeamConnect — Beam-to-beam / wall / point endpoints (2026-06-10)

Beams are no longer column-only. An explicit beam endpoint is now a 4-type
discriminated union, all geometry resolves through ONE canonical accessor, and
the beam tool can connect to columns, other beams, walls, or free points.
Shipped in two commits: **Phase 1 kernel (`9d7ea54`, no UI) + Phase 2 Canvas UI
(`98e02c6`)**. **35 verify scripts now gate every commit** (+1
`verify-beam-connections`, 37 assertions). Phase W honored — beams reference
COLUMNS/BEAMS/WALLS, never nodes; no node entanglement, no wall splitting.

### Endpoint union (`schema/entities/beam.js`)

```
{ type:'COLUMN', columnId }            — column position (or its attachedNodeId)
{ type:'BEAM',   beamId, t }           — point at t∈[0,1] along that primary beam
                                         (secondary frames into primary; recursive,
                                         cycle-guarded)
{ type:'WALL',   wallId, t }           — bearing point at t∈[0,1] along n1→n2
{ type:'POINT',  x, y, detachedFrom? } — absolute world coords (free / cantilever /
                                         detached-by-parent-delete; detachedFrom
                                         preserves provenance)
```

### What landed — Phase 1 kernel (`9d7ea54`)

| # | Item | Notes |
|---|---|---|
| 1 | `topology/beams.js::resolveBeamEndpoint` | THE single canonical accessor. Recursive for BEAM (lerp by `t`) + cycle-guarded, WALL lerp on `n1→n2`, returns `{x,y}|null` — null for dangling / cyclic / unknown (no silent NaN). COLUMN/POINT byte-identical to pre-phase. |
| 2 | `schema/integrity.js` | Dangling `beamId`/`wallId` broken-ref checks, beam-cycle detection, gated `FK_DESCRIPTORS` for `beamId→beams` / `wallId→walls`. |
| 3 | `structuralSlice.js::addBeamWithEndpoints(from, to, opts)` | Creates an explicit beam from arbitrary endpoint descriptors. |
| 4 | Detach-on-delete cascade | `deleteBeam` + `deleteColumn` (structuralSlice) and `deleteWall` (store.js) convert each referencing beam endpoint to a frozen `{type:'POINT', x, y, detachedFrom:{type, …id}}` at its last-resolved position + emit a `beam_endpoint_detached` validationEvent. Geometry survives; undo restores. |
| 5 | `bbs/generators/beamRebar.js` | Per-endpoint anchorage (see BBS rule below). |
| 6 | Validation | `beam_no_support` → v2; new `beam_circular_ref` (ERROR). |
| 7 | `verify-beam-connections.mjs` (NEW) | 29 assertions at Phase 1. |

### What landed — Phase 2 Canvas UI (`98e02c6`)

| # | Item | Notes |
|---|---|---|
| 1 | `src/snap/beamTarget.js` (NEW) | `resolveBeamTarget(state, worldXY, opts)` — resolves a click to a COLUMN/BEAM/WALL/POINT endpoint descriptor by priority + per-type radius, projecting onto beam/wall segments for the parametric `t`. Pure; `excludeBeamId` guards self-reference. + `describeBeamEndpoint(state, ep)` for panel labels. |
| 2 | `src/snap/toolPolicy.js::BEAM_TOOL_TARGETS` | The policy home for the beam tool's snap radii + priority order. |
| 3 | `Canvas.jsx` | Unified beam-endpoint pick in `handleSVGClick` (column clicks bubble; proximity resolves the target) → level picker → `addBeamWithEndpoints`. Render path resolves EVERY endpoint via `resolveBeamEndpoint` (BEAM/WALL/POINT now render; no direct coord access). Live hover: snap dot + target-segment highlight + `t` label + ghost line. Esc / tool-change / mouse-leave clear the in-progress pick. |
| 4 | `BeamPanel.jsx` | "Connections" section: From/To shown as `Column C1` · `Beam B2 (mid-span 42%)` · `Wall W3` · `Free point` · `Detached (was Beam B2)` + reconnect hint. |
| 5 | `IsoView.jsx` (fixed 2026-06-10) | 3D viewer's local `beamEndpointXY` (COLUMN/POINT-only → NaN for BEAM/WALL) replaced with `resolveBeamEndpoint`. Beam-to-beam / beam-to-wall now render in the iso view. |
| 6 | `verify-beam-connections.mjs` | Section G (targeting priority + descriptions) → 37 assertions. |

### Canvas snap priority (beam tool)

`BEAM_TOOL_TARGETS` resolves a beam-endpoint click in this order:

```
COLUMN  >  BEAM  >  WALL  >  free POINT
```

Column wins over a coincident beam/wall; a beam mid-span wins over a wall
behind it; a free point is the fallback when nothing is within its radius.
Per-type radii live in `toolPolicy.js` — never inline a radius in Canvas.

### Locked rules (Phase BeamConnect)

- **`resolveBeamEndpoint` is the SINGLE canonical accessor — no direct
  endpoint coordinate access ANYWHERE.** Every consumer (BBS, BOQ,
  shuttering, **2D canvas render**, **3D iso render**, validation) resolves
  through it. It returns `{x,y}|null`; the caller skips the beam on null.
  The 2026-06-10 IsoView fix closed the last violator (a stale local
  resolver that produced NaN geometry for BEAM/WALL endpoints).
- **Beams reference COLUMNS / BEAMS / WALLS, never nodes.** Topology
  face/adjacency graphs stay decoupled from beams (Phase W contract).
- **Parent delete DETACHES, never silently drops geometry.** Frozen POINT
  with `detachedFrom` provenance + `beam_endpoint_detached` event; undo
  restores; `beam_no_support` then flags the free end. `beam_circular_ref`
  (ERROR) guards BEAM cycles.
- **BBS per-endpoint anchorage** (`beamRebar.js`): `BEAM` endpoint =
  interior / pinned (`Ld/2`, no exterior 9d hook); `WALL` endpoint =
  bearing (wall-exterior anchorage rule); `COLUMN`/`POINT` = existing
  exterior-joint heuristic → byte-identical to pre-phase. Wall-derived
  beams (COLUMN/POINT endpoints only) are unchanged.

## Phase RoomConverge — Face-selection room tool + sub-span fix (2026-05-30)

The legacy manual wall-selection Room tool (`'room'` toolId, `RoomPanel.jsx`,
`togglePendingWall`) was **RETIRED** — deleted outright (greenfield rule:
removed, not deprecated, no compatibility shim). Its closure metric predated
Phase W: it counted only each selected wall's `n1`/`n2` endpoints, so a room
bounded by a **SUB-SPAN** of a full-length wall (whose endpoints lie OUTSIDE
the room) was falsely reported "open" and the Save gate blocked creation.
`saveRoom` itself was already sub-span-correct (`computeNodeOrderForWallIds`
→ `enumerateFloorFaces` performs an exact wallId-set match) — only the UI gate
was wrong. Room creation now converges on the **face graph** as the single
authoritative path.

**Validated end-to-end in canvas 2026-05-30 by user:** (1) 10×10 closed-chain
rectangle → room created at 100 sqft; (2) T-junction sub-span case → room
created on the sub-region; (3) room selection auto-works. Real canvas behavior
agrees with `verify-room-detection.mjs` Section H — the fix carries through to
the live UI, not just verify.

### What landed

- **`room_detect` is now the single Room tool.** Relabeled "Room", bound to
  bare `R` (the old `room` tool's binding); `Shift+A` retired. One
  click-to-detect-and-create flow: click a wall in a closed loop →
  smallest enclosing face on the cursor's side → `createRoomFromFace`.
- **Smart-MEP-on-create folded into the `room_detect` click handler.** The
  auto-MEP logic previously in `RoomPanel.handleSave` now runs atomically
  inside the room_detect creation (one undo frame): auto-applies the
  suggested fixtures when `autoMepDefaultsEnabled`, otherwise dispatches the
  `mep:room-created` window event so `MepDefaultsModal` can offer the
  checkbox lists.
- **`rect_room` (Shift+R) is unchanged** — the atomic rectangle-room create
  path keeps its existing behavior.

### Bug ledger

- **BE-DrawCorners-001** — the 2026-05-30 morning corner-divergence fix
  (`store.js` `getOrCreateNodeFaceJoin` + `findNearbyCornerNode`, a ~8in
  bounded CORNER-reuse join, wired into `_commitFaceChain` +
  `addRectangleRoom`; `verify-draw-reference` Sections O/P/Q). It fixes a
  REAL, DISTINCT bug class: independently-drawn `inside_face` / `outside_face`
  wall chains whose shared corner is perpendicular-projected in two
  directions diverge by ~`halfThickness·√2` > `SNAP_IN`, producing two
  distinct nodes and a genuine open loop. It is harmless to T-junctions
  (filters `kind === 'CORNER'`). **HONEST CORRECTION:** this fix is
  ORTHOGONAL to room-boundary detection and did NOT fix the reported
  manual-Room-Tool open-corner screenshot — that symptom was the
  pre-Phase-W endpoint-counting closure gate (now removed). Keep
  BE-DrawCorners-001; it guards its own scenario.
- **BE-FaceLookup-001 — FIXED (canvas-validated 2026-05-30)** — `findFaceContainingEdge` (`faces.js`)
  built its `byEdgeSide` lookup key from the FULL wall endpoints `n1→n2`,
  but `byEdgeSide` is keyed per expanded **SEGMENT** (consecutive
  `nodeOrder` entries). On a junctioned full-length wall, `n1→n2` is never
  graph-adjacent, so `room_detect` returned `null` for any room bounded by
  a SUB-SPAN — including the reported screenshot. Fixed by resolving the
  segment nearest the click via `getOrderedWallJunctions` and keying off
  that segment's node pair. Read-only lookup change; non-junctioned walls
  stay byte-identical. Guarded by a `verify-room-detection.mjs` sub-span
  section.

### Locked rules (Phase RoomConverge)

- **Canvas/UI verify discipline.** For any canvas/UI flow, the verify
  section MUST drive the actual user-facing entry point with realistic
  state (T-junctions, multiple walls, multiple rooms) — not just the
  internal kernel. This closes the "verify green / canvas broken" gap
  class.
- **Single source of truth over layered fallbacks.** When two mechanisms
  can solve the same problem, prefer one authoritative path over defensive
  duplication. Layered fallbacks accumulate as confusion-debt. This is why
  Option A — converge on the face graph — was chosen over Option C — keep
  both the manual and the face tools.
- **Phase W contract (make it impossible to miss).** ONE WALL = ONE
  FULL-LENGTH ENTITY. T-junctions are first-class (`wall.junctions[]`). NO
  auto-split, NO manual per-room split. Walls stay full entities for
  identity stability, `wallBeamSpecs` slots, beam-derivation, and
  INV-W1–W10. Any room "boundary" that needs a wall fragment uses a
  SUB-SPAN of the full wall between T-junctions via the expanded graph —
  never a split.

## Phase BBS — Bar Bending Schedule + IS 2502 catalog (2026-05-28)

New RebarGroup abstraction + per-element generators + IS 2502 cutting-
length engine + BBSSchedulePanel UI. Replaces the legacy `computeBBSQuantities`
aggregate-kg estimator with a proper bar-member schedule (mark / shape /
cutting length / weight) following IS 2502:1963 + SP 34 + Chennai
residential practice. Pure-function generators per element; ESTIMATE
fallback preserved. **34 verify scripts now gate every commit** (+1:
`verify-bbs`, 123 assertions across Bootstrap purity grep + Sections A
catalog + B cutting-length hand-calc + C/C.2 column + D/D.2 footing+dowel
+ E slab real-geometry + F wall-derived beam + G backward-compat).

### What landed

| # | Item | Notes |
|---|---|---|
| 1 | `src/specs/cuttingLength.js` (NEW) | IS 2502 catalog: bend deductions (1d/2d/3d/4d), 9d hooks, Fe500/M20/M25 Ld factors incl. seismic 1.3×Ld, crank 45°/0.42D/L4, `getIs2502Params(state)` deep-merge override. |
| 2 | `src/bbs/types.js` (NEW) | RebarGroup shape + `ELEMENT_TYPE` / `REBAR_ROLE` / `SHAPE_CODE` / `REBAR_SOURCE` enums + `makeRebarGroup(...)` factory. Computed, never persisted. |
| 3 | `src/bbs/index.js` (NEW) | `computeRebarGroups(state, opts)` entry point. Deterministic sort: floor seq → element type → element id → role → markId. |
| 4 | `src/bbs/generators/columnRebar.js` (NEW) | LONGITUDINAL + STIRRUP + opt-in STIRRUP_ZONE (IS 13920 confinement). Rect + circular shapes. |
| 5 | `src/bbs/generators/footingRebar.js` (NEW) | X_MESH + Y_MESH with own-dia Ld (fixes `max(xDia, yDia)` bug) + NEW dowel (L-shape 11, embed=Ld_compression, projection=lap). RAFT/STRIP/PILE deferred. |
| 6 | `src/bbs/generators/slabRebar.js` (NEW) | MAIN + DIST + CRANK (shape 03, 45°, 0.42D, L/4) + opt-in EXTRA_TOP. Real span/width from `getRoomGeometry(centerline)`, aspect-ratio one-way/two-way with `spec.twoWay` override. |
| 7 | `src/bbs/generators/beamRebar.js` (NEW) | TOP + BOTTOM + STIRRUP. Exterior-joint Ld + 9d hook; interior Ld/2. Wall-derived beams use `getRoomsForWall(...).length === 1` heuristic. |
| 8 | `src/specs/resolution.js` | added `WALL_INSTANCE` tier for wall-derived beams (reads `state.walls[sourceWallId].wallBeamSpecs[beamClass]`). |
| 9 | `src/schema/entities/wall.js` | added `wallBeamSpecs: object|null` (default null, no migration). |
| 10 | `src/structuralSlice.js` | `setWallBeamSpec(wallId, beamClass, specId)` action. |
| 11 | `src/store.js` | exposed `getRoomGeometry(roomId, mode)` as a store method (delegates to topology). |
| 12 | `src/quantities/bbs.js` | slab loop switched from `Math.sqrt(area)` for both span+width to real per-room `getRoomGeometry` (span = longest edge, width = area/span). |
| 13 | `src/components/BBSSchedulePanel.jsx` (NEW) | Indian 10-column site BBS format. Toolbar entry (Table2, Shift+B). Mounted in App.jsx. |
| 14 | `src/components/BBSSpecPanel.jsx` | new Procurement section with 12/9/6 m bar-length dropdown. Default flipped 6 → 12 (Indian TMT market reality). |
| 15 | `src/specs/catalogManifest.js` | registered cuttingLength.js as `is2502:` catalog. |
| 16 | `scripts/verify-bbs.mjs` (NEW) | 123 assertions. |

### Locked rules (Phase BBS)

- **IS 2502 catalog is the SINGLE SOURCE** for every bend deduction,
  hook allowance, lap, Ld, crank geometry, standard bar length.
  `getIs2502Params(state)` is the only read point. No magic numbers
  in `src/bbs/generators/*.js` — every constant comes from the
  catalog. Bootstrap purity grep enforces.
- **RebarGroup is a COMPUTED OBJECT, never persisted.**
  `computeRebarGroups(state, opts)` regenerates deterministically
  from state on every call. The legacy `computeBBSQuantities`
  aggregate-kg path is untouched; both coexist.
- **`wall.wallBeamSpecs` is the WALL_INSTANCE tier** for wall-derived
  beam reinforcement override. Default null = inherit CLASS default.
  Schema slot only — no migration on load. `resolveBeamReinforcementSpec`
  reads it before CLASS for wall-derived beams.
- **Slab span/width comes from `getRoomGeometry(roomId, 'centerline')`**
  — never `Math.sqrt(area)`. Span = longest edge across all rooms in
  the slab; width = area / span. Aspect-ratio one-way/two-way;
  `spec.twoWay` is an explicit override.
- **Footings emit dowels as a separate `REBAR_ROLE.DOWEL` group**,
  cross-referencing the column type. L-shape (IS 2502 code '11').
  Embed leg = Ld_compression; projection leg = lapLength.
- **Footing per-bar Ld uses the BAR'S OWN DIAMETER** — fixes the
  legacy `max(xDia, yDia)` bug. X mesh Ld is computed from
  xBars.diaMm; Y mesh from yBars.diaMm.
- **No legacy backward-compat tolerance.** Sections C + G of
  `verify-bbs` assert hand-computed IS-correct values exactly via
  `near(value, hand-computed, 0.1)`. Legacy `computeBBSQuantities`
  produces DIFFERENT numbers due to its own bugs (see BE-Legacy-001)
  — that delta is documented as a comment, not papered over with a
  tolerance.
- **IS 13920 confinement zones default OFF.**
  `params.confinementZoneEnabled = false` matches Chennai residential
  site practice (small contractors use uniform stirrup spacing).
  Engineers opt in per project via
  `projectSettings.is2502Params.confinementZoneEnabled = true`.
- **Standard bar length default 12 m.** Reflects Indian TMT-market
  reality. Flipped 6 → 12 on 2026-05-28. Per-project override via the
  BBSSpecPanel Procurement dropdown (12 / 9 / 6 m). No migration;
  existing projects with `bbsDefaults.standardBarLengthM` set keep
  their stored value.
- **RAFT / STRIP / PILE foundation BBS deferred.**
  `generateFootingRebarGroups` returns `[]` for these types by
  design. Tracked as BBS-FoundationTypes backlog.

### Module map — Phase BBS additions

```
src/specs/cuttingLength.js (NEW) — IS 2502 catalog (CATALOG_VERSION exported)
src/bbs/types.js (NEW) — RebarGroup shape + factory
src/bbs/index.js (NEW) — computeRebarGroups entry point
src/bbs/generators/columnRebar.js (NEW)
src/bbs/generators/footingRebar.js (NEW)
src/bbs/generators/slabRebar.js (NEW)
src/bbs/generators/beamRebar.js (NEW)
src/components/BBSSchedulePanel.jsx (NEW)
src/specs/resolution.js — WALL_INSTANCE tier for wall-derived beam resolver
src/schema/entities/wall.js — wallBeamSpecs slot (default null)
src/structuralSlice.js — setWallBeamSpec action
src/store.js — exposed getRoomGeometry as a store method
src/quantities/bbs.js — slab loop uses real getRoomGeometry, not √area
src/components/BBSSpecPanel.jsx — Procurement dropdown
src/specs/catalogManifest.js — is2502 catalog registered
scripts/verify-bbs.mjs (NEW) — 123 assertions
```

### Verify-script inventory addition

```
verify-bbs — 123 assertions across Bootstrap purity grep + Section A
  IS 2502 catalog (24) + B cutting-length hand-calc (8) + C column
  generator (14) + C.2 IS 13920 confinement (3) + D footing+dowel (12)
  + D.2 RAFT/STRIP/PILE deferred (1) + E slab 20×10 real geometry (9)
  + F wall-derived beam WALL_INSTANCE (4) + G backward-compat (5)
  = 123 assertions.
```

Total verify-script count is now **34** (was 32 + Phase BBS adds 1;
note Phase D + Phase BA were both counted at 32 in their respective
sections — Phase BBS is the +1 over the most-recent 33 baseline).

## Phase BBS-Categories — 6 missing categories + sub/super column + 3-level output (2026-05-29)

Extends Phase BBS with the six element categories real Indian residential BBS
covers but the four-generator engine lacked, plus the sub/super column split
and the three deliverable output levels. Validated against two reference
workbooks in the repo root (`BBS- Karthick M-City (1).xlsx`, `SELVAKUMAR
(1).xlsx`). **34 verify scripts now gate every commit** (+1 `verify-bbs-export`;
`verify-bbs` extended with Sections H–N → 168 assertions). Research +
citations in `docs/BBS-CATEGORIES-RESEARCH.md`; build report in
`docs/BBS-FULL-MORNING-REPORT.md`.

### What landed

| Category | Source / model fit |
|---|---|
| Tie / grade band beam | `wall.hasTieBeam` → BBS-only synthesized band beam (NOT in `BEAM_LEVEL_REGISTRY`). beamClass `tie`, `beamBehavior:BAND`. |
| Lintel / head band beam | existing wall-derived `lintel` beam → `beamBehavior:BAND`, IS 4326. |
| Sunshade / chajja | per window `opening.hasSunshade` + `sunshadeSettings`; top L-bar anchored into lintel + dist. `sunshadeRebar.js`. |
| Loft | `wall.loft = {enabled,widthFt,depthFt,heightFt}`; top+bottom mat + dist embedded into wall. `loftRebar.js`. |
| Staircase | staircase entity → waist + dist + landing (ESTIMATE-grade). `staircaseRebar.js`. |
| Strap footing | foundation `type:'STRAP'`; 2 pads + strap beam (top-primary). `strapFootingRebar.js`. |
| Sub/super column | per-segment split of ONE column entity; `column.position` + `meta.segmentType`. |

Output: L1 per-bar detail rows, L2 `byBbsCategory` abstract (category × Ø kg +
concrete m³ + kg/m³ ratio; new Abstract tab + `src/bbs/concrete.js`), L3
`src/export/bbs.js` Excel (TOTAL + per-category sheets) + PDF.

### Locked rules (Phase BBS-Categories)

- **Every new category is DEFAULT-INERT (opt-in).** Tie via `wall.hasTieBeam`
  (default null); sub/super via `is2502Params.subSuperColumnSplitEnabled`
  (default false); sunshade/loft/staircase/strap emit only when their
  `bbsDefaults.{SUNSHADE,LOFT,STAIRCASE,STRAP}` (or `bbsDefaults.BEAM.tie`)
  spec is set. Guarantees zero drift on `verify-boq` byte-equality + every
  existing project. Engineers opt in per project.
- **Tie beam is BBS-only — never added to `BEAM_LEVEL_REGISTRY`.** Adding it
  there would feed `getDerivedWallBeams` → masonry deduction + beam RCC BOQ +
  canvas and shift `verify-boq`. It is synthesized inside `computeRebarGroups`
  only (`wall.hasTieBeam` walk) with `beamDimensions.tie` (default 9×12).
- **`meta.bbsCategory` is the Level-2 taxonomy** (`BBS_CATEGORY` in
  `bbs/types.js`); the existing elementType-keyed `byCategory` rollup is
  UNCHANGED (backward-compat). `byBbsCategory` is purely additive. Generators
  stamp `meta.bbsCategory`; `makeRebarGroup` accepts a top-level `bbsCategory`
  arg that merges into meta.
- **`getBarMarkPrefix(bbsCategory)` is the single mark-prefix registry**
  (F/SF/SC/C/TB/PB/HB/RB/B/CH/LF/ST/S). Auto-generated marks use it; entity
  grid-labels (`C1`, `EF1`) legitimately override for columns + strap footings
  (reference convention).
- **`meta.beamBehavior ∈ FRAME|BAND`** on every beam group (FRAME=plinth/roof,
  BAND=tie/lintel). Band beams skip IS 13920 confinement (uniform links per
  IS 4326 / Chennai practice) regardless of `confinementZoneEnabled`.
- **Sub/super is PER-SEGMENT, one column entity.** ONE `column.id` → SUB + SUPER
  RebarGroups; `meta.segmentType ∈ AUTO_SUB|AUTO_SUPER|FORCED_SUB|FORCED_SUPER`.
  Split adds one lap at the grade transition → split kg > single-lap flat
  (physically correct). The backward-compat invariant lives on the default
  (non-split) path.
- **Default lap stays 56.6d (IS 456 code), not 50d (site).** 50d available via
  the `simplified` lapKey; Fe550D Ld/lap factors added (CATALOG_VERSION → V2).
- **Element anchorage factors are catalog constants** in `cuttingLength.js`
  (`sunshadeAnchorageIntoLintelFactor`, `loftEmbedFactor/MinMm`,
  `staircaseLandingAnchorageFactor`, `strapBeamAnchorageFactor`,
  `subColumnLapFactor`, `bandBeamCornerAnchorageFactor`,
  `gradeBeamLevelPlinthFraction`) — no magic numbers in generators.
- **Concrete-per-category** (`src/bbs/concrete.js`, for the kg/m³ ratio) is
  computed from stored geometry, NOT the legacy aggregators (avoids the STRAP
  edge case). Column/beam concrete is split into fine categories ∝ steel kg.
- **Export builders are PURE.** `buildBbsWorkbookModel(state, opts)` has no
  `Date`/file-I/O (Node-testable); `exportBbsExcel`/`exportBbsPdf` add
  serialization. All three levels reduce over `computeRebarGroups` — single
  source. `verify-bbs-export` asserts Level 2 = reduce(Level 1).
- **RAFT / STRIP / PILE foundation BBS still deferred** (STRAP now built).

### P0 follow-up (2026-05-29) — footing fix + SITE_PRACTICE allowance mode

- **BE-Footing-Ld-001 — FIXED.** Footing/strap-pad mesh bar = `padDim − 2×cover
  + 2 end hooks`, NOT `padDim + 2×Ld` (was over-counting ~88%/bar). The bar
  spans the pad; Ld is satisfied by that span. `footingRebar.js::_buildMeshGroups`
  + `strapFootingRebar.js::addPad`. verify-bbs Section D has a regression guard
  (`X_MESH < 1800mm`).
- **`projectSettings.bbsAllowanceMode ∈ 'IS_STRICT' | 'SITE_PRACTICE'`** (default
  IS_STRICT) is the convention switch. IS_STRICT = full IS 2502 (9d hooks, 56.6d
  lap, dia-based bend deductions, Ld anchorage). SITE_PRACTICE = flat ft
  allowances + 50d lap matching a contractor's hand BBS (reproduces the Karthick
  workbook to ±2% per bar). `setBbsAllowanceMode(mode)` action.
- **`allowanceMm({ kind, diaMm, params })` in `cuttingLength.js` is the SINGLE
  switch point** for every hook / bend / anchorage / lap. **Closed `kind` enum;
  mode is the only switch; generators NEVER inspect `params.allowanceMode`.**
  This is the expansion point for future regional presets (KARNATAKA_PWD,
  BANGALORE_STANDARD) — add a SITE-style params block + a mode value, never a
  scattered `if (mode)` in a generator. `getIs2502Params` deep-merges
  `SITE_PRACTICE_PARAMS` UNDER the user's `is2502Params` (user overrides win)
  and stamps `allowanceMode`. verify-bbs Section O asserts ±2% in SITE mode;
  IS_STRICT stays byte-identical (exterior 9d hook folded into the anchor so
  `hookEndCount` drops to 0).

### Next-phase requirement (signed off 2026-05-29)

- **BBS-UI-Enablement** — because every new category is engine-level
  default-inert (opt-in), the input UI (Reinforcement Library tab — separate
  phase) MUST make category enablement explicit and obvious (e.g. clear
  per-category toggles + "not enabled" empty-state hints in BBSSchedulePanel),
  otherwise users will assume the new categories "don't work". Owner sign-off
  recorded; track as a hard requirement of the Reinforcement Library phase.

## Phase D — Face-Aware Draw Reference (2026-05-28)

Wall authoring now matches Indian / RERA tracing convention. The
user's clicked points are interpreted per `drawReference` and converted
to centerline geometry at the authoring boundary — canonical storage
stays centerline. Drag a 10×10 ft room in `inside_face` mode and the
resulting carpet IS 10×10 (not 9.25×9.25). **32 verify scripts now gate
every commit** (+1: `verify-draw-reference`, 80 assertions across
Sections A–N including 3 edge cases).

### What landed

| # | Item | Notes |
|---|---|---|
| 1 | `projectSettings.drawReference` | `'inside_face' \| 'centerline' \| 'outside_face'`. Default **`'inside_face'`** (RERA-aligned default — room labels are clear-inside). loadProject injects the default on any project lacking the field; the setting governs FUTURE draws only — stored geometry is untouched. |
| 2 | `src/draw/faceToCenterline.js` (NEW) | `convertFacePointsToCenterline(points, perPointSnapRef, opts)` — single entry point. Dispatches to `_offsetClosedPolygon` (closed) or `_offsetOpenPolyline` (open). `isFaceChainClosed(points, toleranceIn)` runs on the FACE buffer per the closure-in-face-space rule. Pure. |
| 3 | Kernel extension — `_offsetVertex` | Extracted shared per-corner logic (intersect + parallel-fallback + miter cap) from `_offsetClosedPolygon`. Both closed + open kernels now call it for interior vertices. Single geometric source of truth. |
| 4 | Kernel extension — `_offsetOpenPolyline` | Open-polyline offset. Interior vertices use `_offsetVertex`; endpoints perpendicular-project along their adjacent edge. Winding inferred from implicit-closure signed area (N≥3) or left-of-direction (N=2). |
| 5 | Kernel extension — `opts.pinnedIndices` | `_offsetClosedPolygon` accepts a Set of pinned vertex indices. Pinned vertices skip the line-intersection step and emit the original point unchanged. Used by face-aware draw's snap-to-existing-centerline path. |
| 6 | Snap-target `snapRef` classification | Each `SNAP_TARGETS` descriptor declares `snapRef: 'centerline' \| 'face'`. NODE / WALL_ENDPOINT / WALL_MIDPOINT / WALL_NEAREST / WALL_JUNCTION / WALL_SEGMENT → `centerline`. GRID + raw / no-snap → `face`. `getSnapRef(targetKind)` is the registry-driven lookup. |
| 7 | `addRectangleRoom` opts | `opts.drawReference ?? projectSettings.drawReference ?? 'inside_face'`. Converts the 4 face corners → 4 centerline corners via the kernel before creating nodes. Collapsed conversion → refuse + `face_conversion_collapsed` validationEvent + toast.error, commits nothing. |
| 8 | Canvas chain draw — buffer-then-commit | New `drawChainBuffer` local state for face/outside modes: clicks accumulate as `{point, snapRef}`; closure-to-origin is detected on the FACE buffer BEFORE conversion. On Enter / double-click / face-space closure, `_runAtomically` wraps face → centerline conversion + all node/wall creation in one history frame. Centerline mode keeps the existing per-click commit (zero behavior change for that setting). |
| 9 | Canvas mode badge | Top-left pill during `draw` / `rect_room` tools. Color-coded: inside_face green, outside_face orange, centerline neutral. Mirrors the chain-draw hint banner's positioning. |
| 10 | Ghost rect label rewrite | The legacy `Canvas.jsx:1785-1788` dimensionMode-driven deduction was removed. Label now shows the dragged dimension VERBATIM — it IS the active draw reference. dimensionMode's role becomes purely display-of-existing-geometry. |
| 11 | Toolbar segmented control | Draw cluster restructured to `groups[]` with a new "Drawing to: [Inside / Center / Outside]" segmented control. Routes through `writePath('projectSettings.drawReference', value)` → `setDrawReference(mode)`. |
| 12 | `_walkEdgesWithWallIds` Phase-W fix | Now prefers `room.nodeOrder` over `walkPolygonNodeOrder + parent-wall endpoints`, with a fallback expanded-segment lookup walking each parent wall's ordered junction chain. Fixes carpet calculation for rooms with T-junctioned wall membership (Section F of verify-building-area: 5×5 room with both perimeter walls T-junctioned at partition boundaries → carpet correctly reports 18.06 ft²). |
| 13 | `verify-draw-reference.mjs` (NEW) | 80 assertions across Bootstrap + A round-trip kernel inversion + B/C/D rect_room mode matrix + E/F chain closed+open + G mixed snapped/unsnapped chain + G.snap registry classification + H ghost label matrix + I loadProject default + J settings round-trip + K mid-workflow mode switch + L acute-angle open chain + M zig-zag alternating reflex/convex + N closure-in-face-space ordering. |

### Locked rules (Phase D)

- **Canonical wall storage stays CENTERLINE.** Drawing tools convert
  user-clicked face geometry to centerline at the authoring boundary;
  nothing downstream (topology / BOQ / exports / Phase W / MEP) knows
  or cares about drawReference. Storage shape is unchanged.
- **Closure detection runs on the FACE buffer, BEFORE conversion**
  (load-bearing ordering). Near-thickness centerline offsets would
  otherwise prevent closure detection and silently drop the user's
  closing intent. Documented in `src/draw/faceToCenterline.js` header
  under the `CLOSURE-IN-FACE-SPACE` heading.
- **Snap-overrides-mode at the click vertex.** A face-mode click that
  resolves to an existing centerline target (NODE / WALL_ENDPOINT /
  etc. — anything `snapRef === 'centerline'`) is PINNED in the
  offset kernel. The new wall's centerline node joins the existing
  centerline node exactly. Topology join correctness beats geometric
  perfection at the joint — the small notch from adjacent face-mode
  edges is the honest representation of a mixed-reference chain.
- **Per-vertex snapRef from the registry.** `getSnapRef(targetKind)`
  in `src/snap/targets.js` is the single classification authority.
  Adding a new snap target = one `snapRef:` field on its descriptor.
- **Single offset kernel, three semantic uses.** Same
  `_offsetClosedPolygon` / `_offsetOpenPolyline` powers:
  (1) clear-internal inset (`direction: 'inward'`),
  (2) built-up offset (`direction: 'outward'`),
  (3) face → centerline draw conversion (`'outward'` for inside_face,
  `'inward'` for outside_face). DRY by construction — there is no
  parallel offset routine anywhere in the codebase.
- **Collapsed conversion → refuse + validationEvent + toast.error,
  commit nothing.** Never partial / clamp / silent fallback. Applies
  to `addRectangleRoom` and chain commit. Rule reason: a clamped
  result is a wrong result with no signal; the user must see that
  their geometry was rejected so they can re-author.
- **Buffer-then-commit chain is mode-conditional.** `drawReference !==
  'centerline'` buffers clicks; `'centerline'` mode preserves the
  existing per-click commit flow byte-identically. This is the
  zero-regression guarantee for users on the legacy setting.
- **Toggle mid-trace = discard buffer.** Switching `drawReference`
  while a chain is in flight discards the buffer and restarts state.
  Semantically the chain was "begun in mode X"; switching mid-stroke
  is ambiguous. Documented in the `useEffect([drawReference])` hook
  in Canvas.jsx.
- **dimensionMode and drawReference are orthogonal.** dimensionMode
  controls labels on EXISTING rendered geometry (wall length labels,
  panel readouts, finish quantities). drawReference controls what
  FUTURE clicks MEAN. The ghost rect label now follows drawReference
  (matches the drag, not dimensionMode).
- **Indian / RERA tracing convention is the default.**
  `'inside_face'` is the DEFAULT_PROJECT_SETTINGS value for both new
  and old projects (greenfield rule; setting governs future draws).
  Room labels in real plans are clear-inside dimensions; the default
  should match what a user dragging an architect's room labels
  expects.

### Verify-script inventory (32 total — +1 verify-draw-reference)

```
verify-draw-reference — Bootstrap purity grep + Section A round-trip
  kernel inversion (rectangle + L-shape at machine precision) +
  B/C/D rect_room across (inside_face / outside_face / centerline) +
  E closed-chain kernel + F open-chain endpoint perpendicular projection +
  G mixed snapped/unsnapped chain (pinned vertex preserves topology join) +
  G.snap registry-driven snapRef classification (9 target kinds) +
  H ghost rect label across drawReference matrix +
  I loadProject default injection (greenfield) +
  J settings round-trip + invalid-value rejection +
  K mid-workflow mode switch (outside_face 30×30 plot → 900 ft²
    built-up, flip → inside_face 10×10 room → 100 ft² carpet, integrity holds) +
  L acute-angle open chain (miter cap fires, endpoints perpendicular-
    project, no NaN, no silent failure) +
  M zig-zag alternating reflex/convex (no self-intersection, no
    collapse) +
  N closure-in-face-space ordering (proves face-space dist 2.83in
    closes but post-conversion dist 9.19in does not — 3.2× factor) =
  80 assertions.
```

### Module map — Phase D additions

```
src/draw/faceToCenterline.js (NEW) — convertFacePointsToCenterline +
  isFaceChainClosed. Pure. Closure-in-face-space rule documented.
src/topology/rooms.js  — _offsetVertex (extracted shared helper),
  _offsetOpenPolyline (NEW sibling kernel), _offsetClosedPolygon
  opts.pinnedIndices support, _walkEdgesWithWallIds Phase-W-aware
  rewrite (prefers room.nodeOrder + fallback expanded-segment lookup).
src/topology/index.js  — re-exports _offsetClosedPolygon,
  _offsetOpenPolyline, polygonSignedAreaIn2.
src/topology/segmentClassify.js — {mode: 'physical' | 'topological'}
  parameter, two memo cells. Default 'physical' preserves all callers.
src/snap/targets.js    — snapRef classification per SNAP_TARGETS
  descriptor + getSnapRef(targetKind) helper.
src/snap/index.js      — exports getSnapRef.
src/structuralSlice.js — DEFAULT_PROJECT_SETTINGS.drawReference =
  'inside_face'; setDrawReference(mode) with 3-value validation.
src/store.js           — loadProject injects drawReference default;
  addRectangleRoom honors opts.drawReference + refuses on collapse.
src/components/Canvas.jsx — drawChainBuffer local state;
  _commitFaceChain helper; canvas mode badge; face-mode polyline
  preview; ghost-rect label rewritten to show drag verbatim.
src/components/Toolbar.jsx — writePath routes
  projectSettings.drawReference → setDrawReference.
src/components/toolbarConfig.js — Draw cluster restructured to
  groups[] with new "Drawing to" segmented control.
scripts/verify-draw-reference.mjs (NEW) — 80 assertions.
```

## Phase BA — Building-Area Metrics: Carpet + Built-up (2026-05-28)

BOQ scope-of-work now reports carpet AND built-up correctly. The
former "Built-up" row was a mislabeled centerline-polygon sum (off
by ~half-thickness per axis). **31 verify scripts now gate every
commit** (+1: `verify-building-area`, 51 assertions across Sections
A–M including the F1-realistic L-shape with T-junction at corner +
dumbbell mixed-thickness + two-disconnected-blocks additive cases).

### What landed

| # | Item | Notes |
|---|---|---|
| 1 | `src/topology/buildingArea.js` (NEW) | `findExternalBoundaryLoops` + `computeBuiltUpAreaSft` + `computeCarpetAreaSft`. Pure. Per-floor memoization keyed on `(rooms, walls, nodes, projectSettings)` refs. |
| 2 | Angular-continuation loop walker | Same next-CCW rotational-system pattern as `faces.js::_enumerateUncached`. Sort each node's external-incident neighbors by `atan2(dy, dx)`; given incoming directed edge `(a→b)`, next edge at `b` is the entry IMMEDIATELY PRECEDING `(b→a)` in the CCW-sorted list. Works at any node degree — handles T-junctions on external walls, L-shape concave corners, courtyard / disconnected blocks. |
| 3 | Building-side orientation | For each external edge, the unique room referencing it (count = 1 from `classifySegment`) has a canonical CCW `nodeOrder`; whichever direction matches the consecutive pair in nodeOrder is the direction with the room (= building interior) on the left. Walks start only in that direction. Outer perimeters end up CCW (positive signed area = additive footprint), courtyard perimeters end up CW (negative signed area = subtractive hole), disconnected blocks both walk CCW (additive). Aggregation is signed-area sum — never largest-loop-as-outer. |
| 4 | Carpet area | `computeCarpetAreaSft(state, floorId?)` sums `getRoomGeometry(state, id, 'clear_internal').area` over `getValidRoomIds`. Always uses `clear_internal` regardless of `projectSettings.dimensionMode` — carpet is an absolute architectural metric, not a display choice. |
| 5 | Built-up area | `computeBuiltUpAreaSft(state, floorId?)` walks external loops and offsets each outward by per-edge halfThickness via `_offsetClosedPolygon` (`direction: 'outward'`). Naturally captures un-roomed enclosed space that's room-adjacent (the loop is defined by the building outline, not the room set). Incomplete external boundary → `complete: false` + warning, no silent wrong number. |
| 6 | Store delegates | `getTotalCarpetAreaSft(floorId?)`, `getTotalBuiltUpAreaSft(floorId?)`, `getBuiltUpAreaInfo(floorId?)` (full payload including `complete` + `warnings`). |
| 7 | BOQ scope-of-work | `_scopeOfWork.js` emits `totalCarpetAreaSft` + `totalBuiltUpAreaSft` (now the TRUE built-up) + `builtUpComplete`. BOQPanel removed the misleading "Floor area" header row; scope-of-work block shows "Carpet: X Sft" + "Built-up: Y Sft" with `(incomplete)` hint when boundary fails to close. |
| 8 | `verify-building-area.mjs` (NEW) | 51 assertions across Bootstrap + Sections A–M. |

### Locked rules (Phase BA)

- **Built-up loop walker uses ANGULAR CONTINUATION, never degree-2
  assumption.** Real F1 plans have L-shaped/stepped footprints AND
  Phase W T-junctions where partitions meet external walls — external
  boundary nodes routinely have degree 3+. "Pick the edge that isn't
  where we came from" is undefined with multiple choices; naive
  walking silently cuts corners or wanders into the interior. The
  next-CCW rotational rule (same pattern as `faces.js`) resolves at
  any degree.
- **Loop orientation comes from the room's CCW nodeOrder.** Each
  external edge's "building-on-left direction" is fixed by the
  consecutive pair in the unique referencing room's nodeOrder. Walks
  start only from building-on-left directed edges. This guarantees
  outer-perimeter walks are CCW (positive) and courtyard walks are
  CW (negative) — signed-area sum produces correct built-up for
  arbitrary topology (rectangle, L, U, courtyard, disconnected blocks).
- **Sign drives aggregation, not loop size.** Disconnected building
  blocks both walk CCW (additive); courtyard inner loops walk CW
  (subtractive). Never use a largest-loop-is-outer heuristic.
- **`getTotalFloorArea` is retained for excavation byte-equality.**
  `quantities/excavation.js:45` reads it as `buildingFootprintFt2`
  for bulk excavation. Switching to true built-up would shift the
  excavation numbers and break verify-boq byte-equality; tracked as
  `BE-Excavation-001` in the backlog.
- **`computeCarpetAreaSft` is dimensionMode-independent.** Always
  computes via `'clear_internal'` regardless of project display
  preference. Carpet is the strict inside-face floor area — an
  absolute metric, not a display choice.
- **The `_walkEdgesWithWallIds` Phase-W fix is load-bearing.** Carpet
  for any room with T-junctioned wall membership returned 0 before
  this fix (the function ignored `room.nodeOrder` and re-walked via
  parent-wall endpoints, which fail when junctions split the chain).
  See Section F of verify-building-area for the regression seatbelt.
- **Built-up captures un-roomed enclosed space when it's room-adjacent.**
  The loop traces the building OUTLINE, not the room set. Corridors
  and ducts that aren't Room entities but ARE bordered by external
  walls referenced by adjacent rooms appear naturally inside the
  outer loop. The only blindspot: a fully-isolated outer perimeter
  with zero rooms (the walker has no `EXTERNAL` edges to walk →
  built-up = 0). Documented as the third assertion in Section F.

### Verify-script inventory (Phase BA)

```
verify-building-area — Bootstrap purity grep + Section A carpet
  rectangle + B built-up rectangle + C L-shape (4 convex + 1 concave,
  net +4 convex satisfies Euler) + D courtyard (subtractive via signed
  area) + E mixed-thickness external walls + F untraced enclosed space
  (5×5 room inside 10×10 perimeter — carpet = 18.06 ft², built-up =
  33.06 ft², documents UNREFERENCED-edge invisibility) + G incomplete
  external boundary + H virtual external boundary (open verandah:
  halfThickness 0, built-up follows the virtual line) + I T-junction
  on external wall (Phase W expanded segments both contribute) +
  J multi-floor isolation + K F1-realistic L-shape with T-junction at
  corner (angular walker followed outer boundary) + L dumbbell mixed-
  thickness (corner-selection + loop-inversion stress) +
  M two disconnected blocks (signed-area additive) = 51 assertions.
```

## Bug A + B fixes (2026-05-28)

Two correctness bugs found during real F1 plan tracing. Both now
covered by verify-script regression seatbelts.

### Bug A — Virtual walls block face-closure for room detection

**Root cause**: `getFloorWallPerimeterGraph` excluded virtual walls
from the graph entirely (`if (w.isVirtual) continue` at the top of
the floor-walls loop). Face enumeration consumed the already-filtered
graph, so faces that run along a virtual wall could never close —
auto-detect failed silently. Manually-created rooms with a virtual
wall in `room.wallIds` worked fine because `walkPolygonNodeOrder`
doesn't filter virtual walls. Asymmetry between the auto-detect path
and the manual-save path.

**Fix**: Added `opts.mode: 'physical' | 'topological'` to
`getFloorWallPerimeterGraph`, default `'physical'` (preserves every
existing caller). Face enumeration opts into `'topological'` so
virtual walls participate. Separate memo cells per mode prevent
cross-poisoning. Plot walls remain face-ineligible. Quantity
aggregators (plaster / paint / tiles / etc.) already filter `isVirtual`
locally, so virtual-wall faces never leak into BOQ totals.

**Verify**: `verify-room-detection` Section F (virtual-wall room
detection, BOQ equals 3-physical-wall reference for area-driven lines,
no quantity leakage), `verify-mep` Bug A regression seatbelt (physical
default still excludes virtual walls).

### Bug B — `deleteWall` leaves stale orphaned rooms

**Root cause**: When `deleteWall` removed a wall, it stripped the
wallId from every `room.wallIds[]` and recomputed `room.nodeOrder`
via `recomputeRoomNodeOrder`, but if the loop could no longer close
the function returned `[]` and the room was left in `state.rooms`
with empty `nodeOrder` + partial `wallIds`. The room was
structurally invalid (excluded from BOQ totals) but visually present
on the canvas, and `saveRoom`'s overlap check skipped invalid rooms
— so a redraw-then-redetect would create a NEW room overlapping the
stale one. Duplicate room labels; mysterious "Invalid" room.

**Fix**: `deleteWall` now auto-purges orphaned rooms inside the same
`_save` snapshot. Each affected room is re-validated via
`isRoomStructurallyValid` post-strip; invalid rooms are removed
from `state.rooms` with a `room_orphaned_by_wall_delete`
`validationEvent` (severity warning, category topology,
`meta.deletedWallId`). Action returns
`{ ok, purgedRoomIds, purgedRoomNames }` so UI callers can upgrade
their wall-delete toast to persistent (`duration: null`) when rooms
were purged. `selectedRoomId` clears when its target was purged.
Single Undo restores wall + rooms atomically.

`recomputeRoomNodeOrder`'s empty-return contract is now documented:
`[]` means "closure broken"; `deleteWall` is the sole interpreter
that acts on it as a purge signal. Other consumers must not silently
store `[]` and leave the room visible.

**Verify**: `verify-wall-topology` Section I (deleteWall room cascade
— wall removed, room purged, validationEvent emitted, integrity
valid, undo restores both atomically) + Section J (shared-wall
multi-room delete — deleting a wall in only roomA purges ONLY
roomA; roomB survives; deleting the shared wall purges both).
`verify-room-detection` Section G (delete-then-redraw canary —
exactly one room after redraw + re-detect, BOQ byte-identical to
baseline).

### Backlog entries recorded

- **BE-Cleanup-001** — `deleteWall` doesn't strip `foundation.wallIds[]`
  on delete; foundation cleanup should mirror the room-cleanup pattern.
- **BE-Cleanup-002** — `deleteWall` orphans MEP fixtures with `wallId`
  refs; per-discipline cascade should mirror the room pattern.
- **BE-Excavation-001** — `excavation.js::buildingFootprintFt2` still
  sums centerline room areas (true built-up now available via
  `getTotalBuiltUpAreaSft` from Phase BA, but switching would break
  verify-boq byte-equality; deferred until rebaseline accommodated).

## Phase W — Wall Topology Integrity (2026-05-27)

T-junctions are now first-class. Walls preserve identity across
topological touches. Explicit Split is the only path to physical
fragmentation. **30 verify scripts now gate every commit** (+1:
`verify-wall-topology`, 127 assertions across Sections A-G plus
bootstrap purity grep). `verify-boq` now includes a Phase W canary
section that builds the stacked-rooms scenario and asserts 10 walls
(not 11), 9 nodes, 1 TJUNCTION, hand-computed 160 ft² flooring, and
correct per-segment classification (long PARTITION + short EXTERNAL).

### What landed

| # | Item | Notes |
|---|---|---|
| 1 | Node schema additions | `kind: 'CORNER' \| 'TJUNCTION'` + `onWallId: string \| null`. CORNER for ordinary graph vertices; TJUNCTION for nodes attached mid-span to a parent wall. |
| 2 | Wall schema additions | `junctions: string[]` (UNORDERED set of TJUNCTION node ids) + `splitOrigin: 'NONE' \| 'USER_SPLIT'` (provenance — only `splitWall` stamps USER_SPLIT). |
| 3 | Room schema addition | `nodeOrder: string[]` (derived snapshot of the closed polygon's node sequence; runtime recomputation via `recomputeRoomNodeOrder` is authoritative). |
| 4 | `src/topology/junctions.js` (NEW) | `getOrderedWallJunctions` (dynamic projection sort — no stored ordering), `probeWallForMidSpan`, `findCoalescingJunction`, `findNearestTjunction`. Pure. |
| 5 | `src/topology/canMerge.js` (NEW) | `canMergeWalls` conservative predicate — same floor, isVirtual/isPlot match, exactly-one shared endpoint of degree-2, collinear, same material/height/thickness/classification/beam flags, no opening near merge point. False positives forbidden. |
| 6 | `src/topology/segmentClassify.js` (NEW) | `classifySegment(state, floorId, edgeKey)` → 'EXTERNAL' \| 'PARTITION' based on which rooms' nodeOrder include the edge. Memoized per (rooms, walls, nodes) ref triple. |
| 7 | `src/topology/nodeOrderRefresh.js` (NEW) | `recomputeRoomNodeOrder` is authoritative; uses face enumeration (never room.wallIds ordering). `computeNodeOrderForWallIds` (used by saveRoom for in-flight rooms). |
| 8 | `src/topology/wallSplit.js` (NEW) | `planWallSplit` pure planner: partitions openings, junctions, MEP fixtures (5 disciplines), foundation refs by offset/wallT. Returns refusal reasons for opening-straddle, junction-near-split, split-too-close-to-endpoint. |
| 9 | `getFloorWallPerimeterGraph` EXPANDED | Walls with junctions produce multiple graph edges. Each edge has unique `edgeKey = ${wallId}::${segmentIndex}::${fromNodeId}::${toNodeId}`. Adjacency stores edgeKey (not wallId) so multiple segments per parent are addressable. `findWallContainingEdge` + `findExpandedEdge` look up parent wallId. |
| 10 | `faces.js` updates | Visited tracking + canonicalization use edgeKey discipline. `face.wallIds` dedupes by parent wallId so room.wallIds is semantic-membership only. |
| 11 | `getOrCreateNode` REWRITE | Four-branch priority: CORNER snap (Phase A 4in) → TJUNCTION snap (4in) → mid-span T-junction creation (no split) → fresh CORNER. **Auto-split is fully removed.** Mid-span clicks create T-junctions; the wall stays one entity. |
| 12 | `addRectangleRoom` compat | Uses `findExpandedEdge` so rect corners landing mid-span on existing walls work via T-junctions (the pair lookup falls back to the expanded graph). |
| 13 | `splitWall` REWRITE | Delegates to `planWallSplit`. Returns `{ newNodeId, w1Id, w2Id, splitOffsetIn }` on success; `{ error: <reason> }` on refusal. Full propagation: openings by offset, MEP fixtures by wallT, foundation wallIds, room wallIds, junctions by t. Stamps `splitOrigin: 'USER_SPLIT'` on both sub-walls; fresh ifcGlobalIds. |
| 14 | `joinWalls` (NEW action) | Inverse of explicit Split. Gates via `canMergeWalls`. Survivor = lex-smaller id, retains ifcGlobalId, absorbs partner's geometry/openings/junctions/MEP refs. Reverts `splitOrigin` to `'NONE'`. Returns `{ survivorId, removedId, wasSplit, sharedNodeId }`. |
| 15 | `deleteWall` junction handling | Each junction node attached to the deleted wall either converts to CORNER (if referenced by another wall) or becomes orphan and is pruned. Stale-ownership corruption (a junction in another wall's junctions[] too) refuses the delete with `validationEvent`. |
| 16 | `WALL_JUNCTION` snap target | Tier 0, default 4in tolerance. New `'tjunction'` candidate type in `src/snap/candidates.js` (NODE excludes TJUNCTION-kind). Tool policies updated: `draw`, `rect_room`, `column` all include WALL_JUNCTION at policy position after WALL_ENDPOINT. |
| 17 | `join_walls` tool registered | Policy `[WALL_NEAREST]`. Toolbar entry + Section A fuzz coverage. Section A bumped to 1500/1500 (100 triples × 15 tools — honest expansion). |
| 18 | `verifyIntegrity` INV-W1-W10 | INV-W1: wall.n1/n2 NOT in own wall.junctions[]. INV-W2: TJUNCTION ↔ wall.junctions two-way ref. INV-W3: TJUNCTION on centerline within SNAP_IN. INV-W7: room.wallIds dedup. INV-W8: nodeOrder valid + closed. INV-W9: splitOrigin only 'USER_SPLIT' from splitWall. INV-W10: junctions monotonic + ≥ SNAP_IN spacing. |
| 19 | `verify-wall-topology.mjs` (NEW) | 127 assertions across Bootstrap purity grep + Section A (T-junction primitives) + Section B (stacked-rooms canary: 10/9/1) + Section C (splitWall propagation: openings, MEP, junctions) + Section D (split refusal: straddle / junction-near-split / endpoint-too-close) + Section E (Manual Join: round-trip, refusals, opening re-rebase) + Section F (deleteWall junction handling + stale-ownership refusal) + Section G (multi-floor T-junction isolation) + Section H.3 (nodeOrder decoupled from wallIds array order). |
| 20 | FK_DESCRIPTORS additions | `walls → junctions[] → nodes`, `nodes.onWallId → walls`, `rooms.nodeOrder[] → nodes` (all optional). Template clone now correctly remaps all Phase W references. |

### Locked rules (Phase W)

- **A wall's identity (id, ifcGlobalId) is stable across T-junction
  attachment.** A T-junction adds a node to `wall.junctions[]` but
  never changes wall.n1, wall.n2, wall.openings, or wall.ifcGlobalId.
  Identity-affecting changes only happen via explicit `splitWall`
  (which destroys the original wall and creates two new ones with
  fresh ifcGlobalIds) or `joinWalls` (which retains the survivor's
  ifcGlobalId).
- **`wall.junctions` is UNORDERED.** Geometric order is computed
  dynamically by `getOrderedWallJunctions`. Storing sorted order is
  a cache-invalidation trap.
- **`wall.n1` / `wall.n2` are CORNER nodes by enforcement OR may be
  TJUNCTION nodes that happen to also be endpoints of OTHER walls.**
  INV-W1: a wall's n1/n2 must NOT appear in its OWN junctions[].
  (A T-junction node CAN be an endpoint of a different wall — that's
  exactly "wall A T-junctions onto wall B.")
- **TJUNCTION nodes have onWallId; CORNER nodes have null.** Two-way
  reference: `state.walls[N.onWallId].junctions[]` contains N.id.
  INV-W2 enforces.
- **Mid-span draw never splits.** `getOrCreateNode`'s mid-span branch
  creates a T-junction node attached to the wall. The wall stays one
  entity. Auto-split (the pre-Phase-W behavior) is fully removed.
- **Explicit Split is the ONLY path to physical wall fragmentation.**
  Invoked by the user via the Split tool. Stamps `splitOrigin:
  'USER_SPLIT'`. Propagates all dependent data (openings by offset,
  MEP fixtures by wallT, foundation wallIds, room wallIds, junctions
  by t) via centralized `planWallSplit`.
- **Split refuses cleanly.** Three refusal reasons:
  `opening-straddles-split`, `junction-near-split`,
  `split-too-close-to-endpoint`. Each returns `{ error: <reason> }`
  with diagnostic detail; state is unchanged.
- **`canMergeWalls` is the conservative gate for Manual Join.**
  Aggressively rejects on any property mismatch (material, height,
  thickness, classification, beam flags). False negatives acceptable
  (user can keep walls separate); false positives forbidden.
- **`room.wallIds` is deduplicated semantic membership.** A room
  references each parent wall it touches AT MOST ONCE in wallIds —
  even when the room walks the same parent across multiple segments.
  Polygon geometry comes from `room.nodeOrder`, not from wallIds
  order or count.
- **`room.nodeOrder` is a derived snapshot.** Authoritative source is
  runtime recomputation via `recomputeRoomNodeOrder` (face
  enumeration — NEVER reads wallIds order). Snapshot refreshed in:
  `saveRoom`, `createRoomFromFace`, `getOrCreateNode` (mid-span
  branch), `splitWall`, `deleteWall`, `joinWalls`. Mismatch logs
  validationEvent but doesn't reject — recomputation wins.
- **Expanded-graph edges are uniquely keyed.** `edgeKey = ${wallId}
  ::${segmentIndex}::${fromNodeId}::${toNodeId}`. Face traversal,
  visited tracking, canonicalization all use edgeKey. `wallId` alone
  is NEVER a unique key inside traversal internals after Phase W.
- **Per-segment adjacency classification.** Walls in the T-junction
  model can have segments with different external/partition status
  (e.g., parent wall in stacked-rooms has a 10ft partition segment
  + a 1ft external segment). `classifySegment` is the source of
  truth; BOQ aggregators that classify by adjacency must iterate
  segments (not parent walls).
- **No migration code.** Greenfield. `loadProject` accepts new-schema
  projects only. Projects predating this schema fail to load by
  design.

### Invariants (INV-W1 through INV-W10)

```
INV-W1: Wall.n1 ∉ Wall.junctions[] and Wall.n2 ∉ Wall.junctions[]
        (a wall cannot T-junction onto itself; n1/n2 may otherwise be
        any node kind — TJUNCTIONs can be endpoints of OTHER walls).
INV-W2: TJUNCTION node N has onWallId = W; W.junctions[] contains N.id
        (two-way reference).
INV-W3: A TJUNCTION node lies on the centerline of its onWallId
        within SNAP_IN perpendicular tolerance.
INV-W4: Wall openings have offsets ∈ [0, wallLengthIn]
        (enforced by existing opening invariants).
INV-W5: MEP fixtures have wallT ∈ [0, 1] AND state.walls[wallId]
        exists.
INV-W6: Foundation wallIds[] reference existing walls only.
INV-W7: room.wallIds is deduplicated (no duplicate wallId entries).
INV-W8: room.nodeOrder is either empty (malformed room) or has
        length ≥ 3 with distinct, valid node ids forming a closed
        polygon in the expanded graph.
INV-W9: wall.splitOrigin ∈ {'NONE', 'USER_SPLIT'}.
INV-W10: T-junctions on a wall are mutually ≥ SNAP_IN apart along the
         wall's parametric direction (no zero-length segments).
```

`verifyIntegrity` enforces all 10.

### Phase B-style deferral — what's NOT in Phase W (with architectural reason)

- **Polygon-with-holes / courtyard handling**: deferred to Phase Y.
  Architectural reason: T-junctions preserve wall identity across
  topological touches. Polygon-with-holes handles room boundaries
  with disconnected inner loops. They share zero implementation
  logic. Bundling them would conflate two orthogonal architectural
  changes and double review surface.
- **IFC export consumer of splitOrigin**: IFC export doesn't exist
  yet; building it is its own phase.
- **Future editing operations** (endpoint drag, node move,
  copy-paste, mirror, floor-duplicate): these features don't exist
  today. INV-W1 through INV-W10 are documented as the contract any
  future implementation must satisfy. `verifyIntegrity` enforces.
- **DXF-style debug overlay**: deferred — dev-mode visual diagnostic
  is useful but Stage 7 priority was the BOQ canary rewrite.
- **`_scheduleAutoDetect` for Phase R2 auto-suggest**: still Phase R2
  territory.

### Verify-script inventory (30 total)

```
Phase 1-6 + A + R1 (29): unchanged. verify-boq EXTENDED with Phase W
                          stacked-rooms canary (no fixture replacement;
                          the old disjoint-rectangles fixture stays for
                          continuity; a new Section 7 adds the canary).
Phase W (+1):
  verify-wall-topology — bootstrap purity grep (8) + Section A
    T-junction primitives (16) + Section B stacked-rooms canary (17) +
    Section C splitWall full propagation (24) + Section D split
    refusal (6) + Section E Manual Join (16) + Section F deleteWall
    junctions (13) + Section G multi-floor isolation (8) +
    Section H.3 nodeOrder strictness (6) = 127 assertions
```

### Phase W follow-up — Manual Join toolbar UI (2026-05-28)

Phase W shipped the `joinWalls` store action + `canMergeWalls`
predicate + 16 verify-wall-topology Section E assertions, but the
user-facing UI wiring was deferred. This follow-up closes the gap.
Pure UI wiring on top of the tested action — topology / store / snap
untouched.

| # | Item | Notes |
|---|---|---|
| 1 | Toolbar entry | Draw cluster gains "Join walls" (lucide `Link`, shortcut `J`) in `toolbarConfig.js`. Single registry entry; no Toolbar.jsx changes (config-driven). |
| 2 | Bare-J shortcut | `useKeyboardShortcuts.js` routes `j`/`J` (outside form inputs) to `setTool('join_walls')` + `closeDropdowns()`. Mirrors D/S/R pattern. |
| 3 | Canvas tool branch | `handleWallClick` adds a `join_walls` arm with one-click (1 eligible sibling → straight to dialog) + two-click (ambiguous → stage → click second wall) + same-wall-deselect flows. |
| 4 | `_attemptJoin` async helper | Re-reads state fresh via `useStore.getState()` AFTER `await dialog.confirm(...)` (state may have changed during the await). Computes `wasSplit` pre-join from both walls' `splitOrigin === 'USER_SPLIT'` for the dialog hint. Maps refusal `reason` → user-facing message via the `JOIN_WALLS_REASONS` table with `?? JOIN_WALLS_DEFAULT_MESSAGE` fallback. Clears `joinHover` BEFORE `selectWall(survivorId)` so the preview overlay doesn't render against the deleted wallId during the React re-render flush. |
| 5 | Hover preview | New `<g data-layer="join-walls-preview">` overlay group mirrors `face-detect-preview` styling (primary-tint dashed when eligible, warning-tint when not). Both walls rendered when `wallB != null`; just wallA otherwise. Label midpoint math branches on `wallB != null`. |
| 6 | Sibling discovery | `findEligibleJoinSiblings(state, wallId)` floor-scoped via `getActiveFloorWalls(state, currentFloorId)` — skips cross-floor predicate calls. Each candidate vetted via `canMergeWalls`. |
| 7 | Snap policy | `join_walls: ['WALL_NEAREST']` was already registered in `src/snap/toolPolicy.js` from Phase W (verify-snap Section A 1500/1500). Not re-added. |
| 8 | `JOIN_WALLS_REASONS` map | 20 entries mapping `canMergeWalls` refusal `reason` strings to user-facing toast messages. Unmapped reasons fall back to `'Cannot join these walls'` — future-proof against new refusal reasons. |
| 9 | Cursor states | `TOOL_CURSOR['join_walls'] = 'pointer'`; `wallHitCursor` array includes `'join_walls'`. |
| 10 | Cleanup | Tool-change `useEffect` clears `joinFirstWallId` + `joinHover` on `activeTool !== 'join_walls'`. `handleMouseLeave` clears `joinHover`. |

### Locked rules (Phase W follow-up)

- **Re-read store state after any async `await` boundary.** The store
  may have mutated during the await (autosave / undo from another
  window / a different async action completing). `_attemptJoin`
  enforces this at the dialog-confirm boundary; future UI flows
  with async awaits before a store mutation MUST do the same.
- **Clear hover-preview state BEFORE selecting the survivor.** When a
  mutation deletes an entity the preview was rendering against
  (e.g., the partner wall after join), set the hover state to null
  FIRST so the next render frame doesn't try to read the now-missing
  entity. Pattern: `setJoinHover(null); setJoinFirstWallId(null);
  selectWall(survivorId)`.
- **Refusal-reason → user-message maps must have a fallback.**
  Future changes to `canMergeWalls` (or any predicate that returns
  discrete `reason` strings) can add new reasons. The UI lookup site
  must use `?? DEFAULT_MESSAGE` so unmapped reasons still produce a
  sensible toast rather than `undefined`.
- **Sibling-discovery scans are floor-scoped.** Iterate
  `getActiveFloorWalls(state, currentFloorId)`, not the full
  `state.walls` map. Cross-floor predicate calls are wasted work
  (canMergeWalls rejects different floors anyway) and silently mask
  perf regressions on multi-storey projects.
- **Configuration-driven toolbar entries.** New tools go in
  `toolbarConfig.js`'s TOOL_CLUSTERS array — never inline in
  Toolbar.jsx. The dispatcher (`renderItem`) routes by `type` so
  adding a tool is one config entry + (optionally) one shortcut
  handler.

## Phase R1 — Auto Room Detection, interactive (2026-05-27)

Interactive face-detection tool that converts a closed wall loop into a
Room entity with one click. Phase R2 (auto-suggest after wall mutation)
is a separate planning round — explicitly NOT in R1. **29 verify
scripts now gate every commit** (+1: `verify-room-detection`, 59
assertions including the load-bearing BOQ canary).

### What landed

| # | Item | Notes |
|---|---|---|
| 1 | `src/topology/faces.js` (NEW) | Planar-graph face enumeration via next-CCW-edge traversal (rotational system; standard combinatorial-embedding algorithm). Pure, Node-testable, no React/DOM. Reuses `getFloorWallPerimeterGraph` from `src/topology/adjacency.js` as the input graph; filters out plot walls (interior rooms only). |
| 2 | Canonical face shape | Per adjustment 5. Every face has nodeOrder rotated so the lexicographically-smallest nodeId is at index 0, CCW winding (outer-face rejected by negative signed-area sign), wallIdsInOrder parallel to nodeOrder, wallIds (canonical) sorted ascending for Set comparison. Equivalent faces serialize identically; memo cell stable; Set comparisons reliable. |
| 3 | Degenerate rejection | Per adjustment 6. Reject any face with `Math.abs(signedAreaFt2) < 0.5` (sliver) or repeated nodeIds in nodeOrder (self-touching). Both checks run BEFORE adding the face to output. |
| 4 | Hover-preview cache | Per adjustment 8. Per-floor `Map<wallId:directedKey, face>` lives alongside the per-floor face table cell. Invalidated TOGETHER with the face table — when `state.walls`/`state.nodes` reference changes, both are cleared in the same call. `findFaceContainingEdge` runs at 60 Hz during room_detect hover; cache makes it O(1) per repeated hover. |
| 5 | `state.detectFaceFromWallClick(wallId, clickPoint)` | Pure pass-through to `findFaceContainingEdge`. Used by Canvas for hover preview + click handler. |
| 6 | `state.createRoomFromFace(face, opts)` | Atomic conversion. Routes through `pendingWallIds → saveRoom → _runAtomically`, so the existing overlap check, history snapshot, integrity, finishes presets, naming, and IFC GUID generation all stay consistent. Stamps provenance meta `createdFrom: 'face-detect'` + `detectedAt: ISO`. |
| 7 | Provenance meta on auto-detected rooms | Per adjustment 7. Schema slot only in R1 — no UI consumption yet. Useful for future debugging and stale-room workflows. |
| 8 | Canvas `room_detect` tool | Hover preview: nearest wall within 24in resolves the face on the cursor's side via raw-cursor cross product. Live polygon overlay (primary tint when uncovered, warning tint when already a room) + area label. Click on wall: creates room (or selects existing). Click out of range: no-op. Toolbar entry in Draw cluster after `room`. |
| 9 | `Shift+A` shortcut | `useKeyboardShortcuts.js`. Bare `A` is reserved future territory; Shift+A groups with the "auto" semantics of the tool. |
| 10 | TOOL_SNAP_POLICY entry | `room_detect: [{ id: 'WALL_SEGMENT', toleranceIn: 24 }]` — 2-foot hover-detection radius. Side-of-wall disambiguation uses the RAW cursor (not the snapped projection), so the resolver only supplies the wall identity. |
| 11 | `verify-room-detection.mjs` (NEW) | 59 assertions across bootstrap purity grep + Sections A–E. Section E is the BOQ canary: rect_room-created and createRoomFromFace-created states on the same wall topology produce **byte-identical BOQ output** (verified at 38/38 lines matching). |

### Locked rules (Phase R1)

- **`src/topology/faces.js` is PURE + Node-testable.** No React, no
  DOM, no Zustand dispatches. Mirrors the snap module's purity
  discipline; `verify-room-detection.mjs` bootstrap grep-checks the
  file.
- **All Room creation routes through `saveRoom`.** New code MUST
  NOT mutate `state.rooms` directly. `createRoomFromFace` sets
  `pendingWallIds` and calls `saveRoom` under `_runAtomically` so
  overlap checks, history, integrity, finishes presets, naming,
  IFC GUID all stay consistent with the rest of the codebase.
- **Phase A snap is a prerequisite.** Without Phase A's endpoint
  snap, freehand-drawn walls wouldn't share `node.id`s reliably
  and the wall graph would have disconnected components. Phase R1
  assumes Phase A defaults are active.
- **Topology never creates entities by itself.** Room entities
  are always user-authored — either explicit click in
  `room_detect` mode, or explicit acceptance of a Phase R2
  suggestion. No silent auto-creation under any flag.
- **Courtyard / nested-room handling: Option A (refuse).** When a
  detected face's polygon would overlap an existing Room, the
  `saveRoom` overlap rejection fires. The face is not created.
  See "Deferred" section for the polygon-with-holes follow-on.
- **Algorithm: planar face enumeration via next-CCW-edge
  traversal** (rotational system; standard combinatorial-embedding
  technique). Named in `src/topology/faces.js` header. No library,
  no training-data guess.
- **Canonical face equivalence is the load-bearing assumption** for
  `isFaceCoveredByRoom` Set comparison and for the memo invalidation
  contract. Equivalent faces (same wall set, regardless of which
  wall happens to be the entry point) MUST serialize to the same
  `wallIds` array — guaranteed by rotation + CCW canonicalization.
- **Hover-preview cache invalidates TOGETHER with the face-table
  memo.** Per-floor cell holds both `{ faces, byEdgeSide, hoverCache }`;
  when `state.walls`/`state.nodes` changes, the cell is replaced
  wholesale, including a fresh empty `hoverCache`. Documented in
  `faces.js` header.

### Phase R2 — deferred (separate planning round)

After R1 ships and is validated on a real F1 flat, R2 will add:
- `_scheduleAutoDetect()` helper invoked post-`_save()` to compute
  `findUncoveredFacesOnCurrentFloor` off the click hot path.
- Chain-draw suspend/resume window-event signaling so suggestions
  don't fire mid-stroke.
- Non-blocking toast UI ("New room detected: 12.5'×10' (125 ft²) —
  Create [↵]") via existing `toast.action` API.
- `verify-room-detection.mjs` Section F: auto-suggest contract +
  regression seatbelt.

### Verify-script inventory (29 total)

```
Phase 1-6 + A (28): unchanged
Phase R1 (+1):
  verify-room-detection — bootstrap purity grep (6) + Section A
    algorithm correctness (18) + Section B canonical normalization (5) +
    Section C idempotency + memo invalidation + hover cache (6) +
    Section D multi-floor isolation (7) + Section E BOQ canary +
    provenance + integrity (12) = 59 assertions
```

## Phase A — Snap Architecture (2026-05-27)

Unified snap resolver replacing the old hardcoded 1ft grid + scattered
inline snap logic. `src/snap/` owns every screen→world coord
conversion for tools that place geometry; `src/geometry.js` keeps the
pixel-accurate `screenToWorldRaw` primitive for tools that bypass
(calibrate, split, stamp drag). **28 verify scripts now gate every
commit** (+1 new: `verify-snap`, 1520 assertions across 7 sections +
bootstrap purity grep).

### Module map

```
src/snap/
  targets.js      — SNAP_TARGETS frozen registry (6 entries: NODE,
                    WALL_ENDPOINT, WALL_MIDPOINT, WALL_NEAREST,
                    WALL_SEGMENT, GRID). Each descriptor declares
                    { id, label, tier, defaultSettings, prepare?,
                    query, displayLabel, renderOverlay? }.
  toolPolicy.js   — TOOL_SNAP_POLICY frozen registry. Per-tool ordered
                    list of target ids (or {id, toleranceIn}
                    overrides). Tools absent from the registry resolve
                    to raw / free placement (no snap).
  candidates.js   — Spatial-index seam. findCandidates(state, type,
                    x, y, radiusIn) and findNearestCandidate(...).
                    Initial impl: O(N) linear scan. Future spatial
                    index (R-tree / grid hash) plugs in here without
                    touching targets.
  resolver.js     — resolveSnap(state, screenXY, ctx) → { worldXY,
                    targetKind, sourceId, raw, _debug? }. Single entry
                    point. DEV-only _debug telemetry.
  index.js        — barrel.
projectSettings.snap = {
  enabled, pitchIn (default 12),
  pitchPresets: [1, 3, 6, 12, 24],
  bypassKey: 'Alt' (default; 'Alt' | 'Shift' | 'Ctrl' | 'None'),
  targets: {  NODE / WALL_ENDPOINT / WALL_MIDPOINT / WALL_NEAREST /
              WALL_SEGMENT / GRID: { enabled, toleranceIn? }  },
}
```

### Locked rules (Phase A)

- **`src/snap/` modules are PURE + Node-testable.** No React, no JSX,
  no DOM, no Zustand dispatches. `renderOverlay` returns a render
  thunk that Canvas interprets — the resolver never executes it.
  `verify-snap.mjs` bootstrap section grep-checks all four files.
- **Single screen→world entry point.** Every drawing tool's click
  routes through `resolveSnap`. The old `screenToWorld` (snapped)
  helper has been removed from `geometry.js`. Tools that bypass snap
  use `screenToWorldRaw` directly: split (targets a specific wall),
  stamp drag (drag-offset capture), calibrate_underlay (raw image
  pixels).
- **Tier-based comparator** (load-bearing): the candidate comparator
  is `tier asc → distance asc → policyIndex asc → sortKey lex asc`.
  Tier 0 = real targets that compete on distance. Tier 1 = catch-all
  fallback (GRID only). A tier-0 candidate ALWAYS beats a tier-1
  candidate regardless of distance — this expresses "policy says try
  wall first, fall back to grid" without callers inspecting
  distances. All four keys are fully deterministic from policy +
  candidate identity, preserving cross-machine / cross-browser
  reproducibility. **Section G of `verify-snap.mjs` fuzz-tests
  determinism against shuffled candidate orderings — 100/100
  identical winners required.**
- **NODE vs WALL_ENDPOINT — DO NOT deduplicate.** NODE is any
  reusable graph node; WALL_ENDPOINT carries wall-owned endpoint
  semantics. Coincident today, distinct in intent. Future targets
  may attach behavior to "endpoint" that doesn't apply to free
  nodes. Documented in `src/snap/targets.js` header.
- **GRID emits candidate telemetry uniformly.** GRID's `query()`
  populates the standard `{ point, sourceId, distanceIn }` shape just
  like every other target. `_debug.candidates` includes GRID entries
  with real distances. No silent target.
- **Per-tool tolerance overrides live in TOOL_SNAP_POLICY** (not in
  projectSettings). Use `{ id: 'NODE', toleranceIn: 24 }` syntax
  in policy entries. Today's column tool uses this for its 24in
  node-attract radius. User-facing tolerance overrides are deferred
  to Phase C.
- **Defaults reproduce today byte-identically.** Section A of
  `verify-snap.mjs` fuzz-tests 100 random `(toolId, clientXY)`
  triples across 14 tools on a clean canvas; resolver output matches
  legacy `screenToWorld` byte-for-byte. **1400/1400 match
  required.** `verify-boq` byte-equality (250+ assertions on a
  deterministic fixture) is the downstream canary.
- **MEP placement falls through to GRID when no wall is within
  range.** Policy `[WALL_NEAREST, GRID]`. Today's MEP code
  pre-snapped via `screenToWorld` before walking walls; with no
  walls in range, the snapped output stuck. The GRID fallback
  preserves byte-identical behavior on empty / wall-free canvases.
- **Modifier bypass via `projectSettings.snap.bypassKey`** (default
  `'Alt'`). Hold the configured key → resolver short-circuits to
  raw / free placement. Canvas tracks `bypassDown` via the same
  keyboard `useEffect` that owns `shiftDown` / `spaceDown`.
- **F9 toggles snap** via window event `'snap:toggle'`. The
  useKeyboardShortcuts hook dispatches; Canvas listens and calls
  `toggleSnapEnabled()`. Mirrors the `boq:toggle` decoupled
  pattern.

### Phase B compatibility audit — contract notes locked

Phase B adds **UNDERLAY_FEATURE** (PDF dark-pixel / edge-detection
target). Phase A's registry is the seam — Phase B is a pure registry
addition + new `prepare` / `query` implementation + extending
`TOOL_SNAP_POLICY` arrays. Zero Phase A files touched.

Contract decisions for Phase B (documented here so the implementer
doesn't re-derive them):

- **UNDERLAY_FEATURE registers as `tier: 0`.** A detected wall edge
  in the underlay represents real architectural geometry the user is
  tracing — semantically equivalent to NODE / WALL_ENDPOINT, not to
  the GRID catch-all. Within tier 0, distance + policyIndex resolve
  ties: typical policy for `draw` becomes `[NODE, WALL_ENDPOINT,
  WALL_MIDPOINT, UNDERLAY_FEATURE, GRID]` so existing drawn entities
  beat PDF edges (via policyIndex), and PDF edges beat the grid
  fallback (via tier).
- **`query()` MUST be synchronous.** The resolver runs at cursor-move
  rate (60 fps). Async edge-detection work goes in optional
  `prepare(state, signal)`, which the resolver invokes but never
  awaits. `query` reads a cache populated by `prepare`. Cache miss →
  `query` returns `null` → resolver falls through gracefully (typical
  policy lands on GRID via tier-1 fallback).
- **`prepare()` re-entrance contract.** A new `prepare` invocation
  for a target aborts the prior controller before starting. Targets
  MUST honor `signal.aborted` and discard partial work. The resolver
  maintains a `Map<targetId, AbortController>` for this — see
  `src/snap/resolver.js::_prepareControllers`. Verified by Section F8.
- **`sourceId` is polymorphic from day one.** `string | { kind, …payload }
  | null`. UNDERLAY_FEATURE uses the object form, e.g.
  `{ kind: 'UNDERLAY_PIXEL', pxX, pxY, edgeStrength }`. Canvas
  branches on `targetKind`, never on `sourceId`'s shape.
- **`displayLabel` + `renderOverlay` are per-target.** Canvas
  dispatches via `getTargetDescriptor(targetKind).displayLabel(...)`
  and `.renderOverlay(...)` — no `switch(targetKind)` anywhere.
  Verified by Section F7 grep-check on `src/snap/` and `Canvas.jsx`.
- **`defaultSettings` shape is open per target.** Phase A's targets
  need `{ enabled, toleranceIn? }`. UNDERLAY_FEATURE will add
  `{ enabled, toleranceIn, sensitivity, sampleRadiusPx, polarity }`
  — Phase A schema is untouched. `loadProject` schema-fill in
  `src/store.js` walks every registry entry's `defaultSettings` and
  deep-merges, so adding a new target's defaults requires no store
  changes.
- **Multi-floor seam.** UNDERLAY_FEATURE's `prepare(state)` reads
  `getFloorUnderlay(state)` for the current floor only. Cache is
  keyed by `${floorId}:${storageKey}`. Phase A's resolver passes
  `state` through; no change needed.
- **Distance metric is uniform inches.** UNDERLAY_FEATURE's
  edge-detection metric = perpendicular pixel distance ×
  `inchesPerPixel`. Reduces to inches like every other target.
- **Section F regression seatbelt.** `verify-snap.mjs` Section F
  registers an in-test `UNDERLAY_FEATURE_STUB` and exercises the
  complete contract (F1 zero-files-touched, F2 prepare-not-awaited,
  F3 cache miss falls through, F4 polymorphic sourceId round-trip,
  F5 displayLabel flow-through, F6 renderOverlay flow-through, F7
  no `switch(kind)` grep, F8 prepare re-entrance + abort). Any
  future Phase A refactor that breaks the seam fails this section
  before Phase B reaches users.

### Verify-script inventory (28 total)

```
Phase 1-6 (27): unchanged
Phase A   (+1):
  verify-snap   ← bootstrap purity grep (16) + Section A byte-equality
                  fuzz (1400) + B (26) + C (4) + D (9) + E (39) +
                  F1-F8 contract seatbelt (23) + G determinism (3)
                  = 1520 assertions
```

## Phase 6 — Dimension Convention + Drawing Speed (2026-05-27)

9-step landing closing two long-standing gaps: (a) finishes were over-quoted
7-14% because every quantity engine measured from centerline (Option C —
dimension mode); (b) drawing a flat took 30-45 min — landed 4 new flows
to halve that. **27 verify scripts now gate every commit** (+3 new:
`verify-dimension-mode`, `verify-rect-room`, `verify-templates`).

### What landed

**Area 1 — Dimension Convention (Steps 1-4):**

| # | Item | Notes |
|---|---|---|
| 1 | Math kernel + verify-dimension-mode | `getRoomGeometry(state, roomId, mode)` is the **single geometry entry point** (Correction 9). `EffectiveRoomEdge[]` primitive carries `{wallId, a, b, lengthFt, insetDistanceIn, sourceEdgeIndex}` (Correction 1) — polygons derive from edges. Inset via per-edge half-thickness offset + adjacent-line intersection. Miter cap = `3 × max(adjacentHalfThicknesses)` (Correction 3). Collapsed rooms return zero-area edges with `collapsed:true` + warnings, **never null** (Correction 4). `scripts/verify-dimension-mode.mjs` ships 92 assertions including the **400-config fuzz suite** (Correction 10): 200 random rectangles + 200 random L-shapes covering winding bugs, intersection instability, self-intersections, precision drift. |
| 2 | `projectSettings.dimensionMode` setting | Default `'centerline'` (legacy-safe). `loadProject` detects `data.projectSettings == null` as a new-project signal → stamps `'clear_internal'`. `setDimensionMode(mode)` action validates the input set. ProjectSettingsPanel "Dimension Convention" section appears at the top. verify-persistence extended for IDB round-trip of the field. |
| 3 | Aggregator wiring | `plaster.js`, `tiles.js`, `paint.js`, `ceilingFinish.js` all route through `getRoomGeometry`. Inner-face wall area uses **Option A**: per-edge `lengthFt × wallHeightFt − openings` (Correction 1's wallId-keyed edges). External wall outer face unchanged — that's the physical centerline on the exterior. Centerline mode produces byte-identical output to today (verify-boq still 250+ green). |
| 4 | Canvas display | Wall labels query `getEffectiveWallLengthFt(state, wallId, mode)` (Correction 2 — no centerline−halfThickness approximation; the helper looks up the matching wallId edge for exact length). RoomPanel "Floor" row dual readout: `85.6 ft² (clear) · 100 ft² (centerline)` when modes diverge. Ghost line during draw stays centerline (second endpoint isn't a real node yet). **Ghost rectangle preview labels (rect_room tool) deduct `DEFAULT_WALL_THICK_IN` from each axis under clear_internal** so the preview matches the room that will be created. **OpeningDetailPanel / OpeningPanel / FoundationPanel show a dual `clear · centerline` wall-length readout** when modes diverge — clamp logic on opening offsets stays centerline-anchored because offset values are stored in centerline-relative inches; only the human-readable surface shows both. |

**Area 2 — Drawing Speed (Steps 5-9):**

| # | Item | Notes |
|---|---|---|
| 5 | Smart MEP defaults default-on | `projectSettings.autoMepDefaultsEnabled` (default **true**). RoomPanel.saveRoom branch: auto-applies suggest{Plumbing/Electrical/Hvac/Fire/Elv}ForRoom + shows undo toast; legacy `mep:room-created` event only fires when disabled. IS-732 catalog audit: BEDROOM +TV_POINT, KITCHEN +EXHAUST_FAN, LIVING LIGHT→4 +AC_INDOOR_POINT. verify-mep extended. |
| 6 | Wall chain drawing | `drawChainOriginId` local state in Canvas tracks first node of chain. **Enter key** ends chain via `canvas:end-chain` window event (Correction 5; keyboard hook stays decoupled, mirrors `boq:toggle` pattern). Double-click ends chain. Auto-close when next click snaps to chain origin. Green ring on origin node. Hint banner: "Click to continue · Click origin to close · Double-click or Enter to end · Esc to cancel". |
| 7 | Rectangle-room tool + verify-rect-room | `addRectangleRoom(x1,y1,x2,y2,opts)` action. **`_runAtomically(fn)`** wraps the whole batch (nodes + walls + room + auto-MEP) in **ONE history frame** (Correction 6) — re-entrant, gates nested `_save` via `_inBatch` flag. New `rect_room` tool, Shift+R shortcut, ghost rectangle preview with dim labels (via the Step-4 effective helper — single source). 26 assertions including atomic undo + re-entrancy. |
| 8 | Template infra + verify-templates | New `TEMPLATES` IDB store (DB_VERSION bumped 2→3). `src/projects/templates.js`: snapshot is **MODEL ONLY** (Correction 7 — buildSnapshot already excludes history/selection/hover/activeTool/memo/derived/transient/revisions/_inBatch). ID rewriter walks **`FK_DESCRIPTORS`** from `src/schema/integrity.js` — the **single FK authority** (Correction 8). Cross-check: verify-templates asserts `verifyIntegrity(clonedState).valid` post-rewrite, catching any new FK the verifier checks that the descriptor list lacks. 55 assertions. |
| 9 | Templates UI | ProjectsPanel "Templates" tab with Use/Rename/Delete. ProjectSettingsPanel footer "Save as template" button. `bootPersistence` lazy-imports `_setTemplateStorage` so templates share the manager's IDB adapter. Factory templates deferred per plan (v2). |

### 10 architectural corrections (locked from review)

These were locked **before** implementation began and survived every commit:

CORRECTION 1 — `getRoomPolygonInsetEdges` returns `EffectiveRoomEdge[]`
as the primary primitive. Polygon point arrays are DERIVED from these
edges. All consumers (plaster/tiles/paint/canvas labels) use edge
identity, not just points.

CORRECTION 2 — Canvas wall labels query `getRoomPolygonInsetEdges()` via
`getEffectiveWallLengthFt(state, wallId, mode)`. No
`centerlineLen − halfThicknessAtN1 − halfThicknessAtN2` approximation —
that breaks at non-orthogonal angles.

CORRECTION 3 — Miter cap = `3 × max(adjacentHalfThicknesses)` —
deterministic. Not average.

CORRECTION 4 — Collapsed polygon: return zero-area edges with
`_collapsed:true` + warnings. NEVER null. Aggregators stay deterministic.

CORRECTION 5 — Enter key ends wall chain (CAD muscle memory). Same
behavior as double-click or Esc.

CORRECTION 6 — Rectangle-room atomicity: nodes + walls + room + auto-MEP
+ naming all in ONE history frame. Single `_runAtomically` at the top.
Undo restores entire rect+room atomically.

CORRECTION 7 — Templates contain MODEL ONLY. Exclude: history/undo
stack, selections, hover state, active tool, memo caches, derived
aggregates, transient UI flags, revision journals, `_inBatch` flag.

CORRECTION 8 — Use `src/schema/integrity.js::FK_DESCRIPTORS` as the
single FK authority. Do NOT maintain a separate FK list in the template
rewriter. The verify-templates sync check enforces it.

CORRECTION 9 — All effective geometry goes through `getRoomGeometry`.
No scattered `mode === 'clear_internal'` checks. Single entry point
returns memoized `{polygon, insetEdges, area, perimeter, longestWall,
collapsed, warnings}`.

CORRECTION 10 — 200-config fuzz testing for inset polygons. Not optional
for a geometry kernel change. verify-dimension-mode covers 200
rectangles + 200 L-shapes.

### Verify-script inventory (27 total — Phase 6 adds 3)

```
Phase 1-5 (24): unchanged. All byte-identical under centerline default.
Phase 6 (3):
  verify-dimension-mode  ← 92 assertions including 400-config fuzz
  verify-rect-room       ← 26 assertions (atomicity + node-snap + re-entrancy)
  verify-templates       ← 55 assertions (model-only + FK rewrite + IDB)
```

### Locked rules added by Phase 6

- **Geometry consumers go through `getRoomGeometry` (Correction 9).** No
  raw `getRoomArea` / `getRoomPerimeterFt` / `getLongestPolygonEdgeFt`
  calls in finish aggregators. No `mode === 'clear_internal'` branches
  scattered across code. Centerline-only consumers (masonry, structural,
  MEP routing) keep using the bare topology helpers — they're the
  documented exemption.
- **Inset wall-area math = Option A.** Inner face area per room iterates
  `geom.insetEdges` (NOT room.wallIds), computes `edge.lengthFt ×
  wallHeightFt − openings`, rounds the result the same way
  `state.getWallArea` rounds (preserves centerline byte parity).
- **External wall outer face stays centerline.** It IS the physical
  plaster line on the exterior — there's no perpendicular interior wall
  to shrink it. Documented in plaster.js Pass-2.
- **`EffectiveRoomEdge` is the primary primitive (Correction 1).** Any
  new consumer that needs per-wall lengths queries
  `getRoomPolygonInsetEdges(state, roomId)` and matches by wallId. Don't
  reconstruct from polygon points.
- **Canvas labels use one geometry source (Correction 2).** Wall
  dimension labels + RoomPanel area + ghost rect labels all go through
  the same `getEffectiveWallLengthFt` / `getRoomGeometry` helpers.
- **`_runAtomically(fn)` for batch operations (Correction 6).** Any
  multi-action sequence (rect-room + auto-MEP, future bulk import, etc.)
  wraps in this so undo restores the whole batch as one frame. Re-entrant
  — nested calls share the outer batch. Nested `_save()` calls become
  no-ops via the `_inBatch` flag.
- **Templates are MODEL ONLY (Correction 7).** `buildSnapshot` in
  `src/projects/_snapshot.js` is the authoritative shape — never carries
  history/selection/hover/activeTool/pendingWallIds/_inBatch/etc.
  Templates store reuses this shape.
- **`FK_DESCRIPTORS` is the single FK authority (Correction 8).** The
  template rewriter walks this list to remap IDs. Any new cross-entity
  reference added to `verifyIntegrity` MUST be mirrored in
  `FK_DESCRIPTORS` or `FLOOR_REF_DESCRIPTORS`. verify-templates'
  `verifyIntegrity(clonedState).valid` assertion catches the drift.
- **New projects default to `'clear_internal'`; legacy saves stay
  `'centerline'`.** `loadProject` uses `data.projectSettings == null` as
  the new-project signal. Legacy projects with explicit projectSettings
  but no `dimensionMode` field fall back to `'centerline'` via
  `DEFAULT_PROJECT_SETTINGS.dimensionMode`. Switch is reversible via
  ProjectSettingsPanel.
- **Quantity engines still never consume rendered geometry.** This
  Phase-1 invariant survives: every aggregator under `src/quantities/`
  reads canonical state geometry only. The `getRoomGeometry` helper IS
  canonical state geometry — it's pure topology math.

### Module map — Phase 6 additions

```
src/topology/rooms.js  — EXTENDED with the dimension-mode kernel:
                         insetPolygonByPerWallHalfThickness (private),
                         getRoomPolygonInsetEdges (memoized),
                         getRoomGeometry (single entry — Correction 9),
                         getEffectiveWallLengthFt (canvas labels),
                         resolveDimensionMode
src/schema/integrity.js — EXTENDED with FK_DESCRIPTORS +
                          FLOOR_REF_DESCRIPTORS exports (Correction 8 —
                          single FK authority)
src/projects/templates.js (NEW) — saveCurrentAsTemplate / listTemplates /
                                  getTemplate / createSnapshotFromTemplate /
                                  renameTemplate / deleteTemplate +
                                  buildIdRemap + rewriteSnapshot
src/projects/storage/indexedDb.js — DB_VERSION bumped 2→3, TEMPLATES
                                    store added to DB_STORES
src/store.js — added _inBatch flag + _runAtomically(fn) wrapper +
               addRectangleRoom action + setDimensionMode action;
               loadProject detects new-project path and stamps
               'clear_internal'
src/components/Canvas.jsx — wall labels via getEffectiveWallLengthFt;
                            wall chain drawing (drawChainOriginId,
                            Enter via canvas:end-chain, double-click,
                            auto-close, green origin ring, hint banner);
                            rect_room tool (rectFirstCorner, ghost rect,
                            two-click atomic create with auto-MEP)
src/components/RoomDetailPanel.jsx — dual area readout
src/components/RoomPanel.jsx — autoMepDefaultsEnabled two-path branch
                               (auto-apply vs legacy modal)
src/components/ProjectSettingsPanel.jsx — Dimension Convention section,
                                          Smart MEP Defaults toggle,
                                          Save as template footer button
src/components/ProjectsPanel.jsx — Templates tab (list/Use/Rename/Delete)
src/components/toolbarConfig.js — rect_room tool entry (Shift+R)
src/hooks/useKeyboardShortcuts.js — Enter→canvas:end-chain, Shift+R→rect_room
src/mep/catalogs/is732Defaults.js — BEDROOM +TV_POINT,
                                    KITCHEN +EXHAUST_FAN,
                                    LIVING LIGHT 2→4, +AC_INDOOR_POINT
src/projects/manager.js — bootPersistence wires _setTemplateStorage
scripts/verify-dimension-mode.mjs (NEW) — 92 assertions
scripts/verify-rect-room.mjs       (NEW) — 26 assertions
scripts/verify-templates.mjs       (NEW) — 55 assertions
```

---

## Phase 5 — Tier 2 sweep + IDB autosave + Underlay (2026-05-27)

19-step landing that closes the Tier 2 UI audit, migrates project
autosave from localStorage to IDB, and ships the PDF/image underlay
workflow with two-click calibration. **24 verify scripts now gate
every commit** (+1 `verify-underlay`).

### What landed

**Phase A — Tier 2 UI gaps (6 commits):**

| # | Item | Notes |
|---|---|---|
| 20 | SlabPanel role picker | + `slab.roleSource: 'AUTO'\|'MANUAL'` provenance (ADD 1). No-op `setSlabRole` calls leave provenance untouched. New `resetSlabRoleToAuto` action. |
| 30 | RoomDetailPanel materials breakdown | Memoized on `[roomId, boqRevision, ratesRevision]` (ADD 7). Both counters added to store + bumped in `_save` and `setRate`. |
| 25 | Electrical circuit click-to-highlight | `state.selection.electricalCircuitId` (ADD 3 — namespaced). Canvas overlay highlights matching points + wires + dims the rest. |
| 24 | HVAC manual pairing picker | `pairingSource: 'AUTO'\|'MANUAL'\|null`. New `setHvacPairing(unitId, partnerId, source)` action handles bidirectional pairing + orphan cleanup. |
| 29 | Slab canvas rendering | Translucent solid fills only (ADD 6) — no SVG patterns. SUNKEN gets dashed border. `layerVisibility.slabs` defaults off. |
| 26 | MEP per-instance overrides | `src/mep/resolution.js` ships **first** (ADD 2) with `resolveFixtureFlowLpm / resolveWireGauge / resolveRefrigerantPipeOD`. Override fields added to 3 schemas. Panels consume the resolver only — never inline the fallback chain. |

Already shipped pre-Tier-2 (audit confirmed in code; updated list stale):
19, 21, 22, 23, 28, 31, 32.

**Phase B — IDB-canonical persistence:**

- `src/projects/manager.js` rewritten — IDB is the canonical source.
  Synchronous read cache (`listProjects` / `getCurrentProjectId` stable
  refs) backed by async IDB writes via `createPersistence(idbStorage)`.
  ProjectsPanel's `useSyncExternalStore` continues to work unchanged.
- One-shot **localStorage → IDB migration** runs on boot from
  `src/main.jsx::bootPersistence()`. Migration flag stored in IDB
  METADATA store (`localStorage-migrated`) so it runs exactly once.
  Legacy localStorage data is **not** deleted — release-cycle safety
  net.
- `src/projects/autosave.js` writes through manager → IDB. Chunked
  writes via `_splitDataIntoChunks` write only `model` / `projectSettings`
  / `settings` slices per autosave tick.
- **BroadcastChannel** `'boq-projects'` syncs across tabs — every write
  posts a typed event (`project-created` / `project-saved` /
  `project-renamed` / `project-deleted` / `current-changed`); the
  listener re-hydrates cache from IDB and notifies React subscribers.
  Browser-only — `_isBrowser()` guard prevents the channel from
  holding Node's event loop open during verify scripts.
- **Serializing write queue** — fire-and-forget IDB writes are chained
  through `_writeQueue`. Production code never awaits; verify scripts
  use exposed `flushPendingWrites()` to drain between assertions.
- `src/projects/storage/assets.js` (ADD 4) — generic binary asset
  primitive (`storeAsset / getAsset / deleteAsset / deleteProjectAssets`)
  keyed `${projectId}::${assetType}::${assetId}`. `deleteProject`
  cascades to drop owned asset blobs.
- `src/projects/storage/idbAdapter.js` — real browser IDB adapter via
  native `indexedDB`. `IDB_SCHEMA_VERSION = 1` lives in METADATA
  store (ADD 5). `IDB_MIGRATIONS` chain in place for future bumps.
  `DB_VERSION` bumped to 2 (assets + metadata stores added).
- `_snapshot.js` extracted from autosave.js so verify scripts can
  import `buildSnapshot` without dragging in Toast.jsx (Node ESM can't
  parse JSX).

**Phase C — PDF/image underlay (per-floor + multi-page picker):**

- `pdfjs-dist ^4.10.38` added to dependencies. Dynamic import keeps
  the ~600 KB bundle off the cold path.
- `src/underlay/pdfRender.js` — page-aware. `renderPdfPageToPng(bytes,
  { onMultiPage, pageNumber })`: single-page PDFs auto-route to page 1;
  multi-page PDFs invoke `onMultiPage({ numPages, thumbnails, choosePage })`
  with sub-images (240px max edge) so the caller can prompt for a page;
  `pageNumber` override forces a specific page. Image files use native
  FileReader. Both paths converge on `{ dataUrl, wPx, hPx, mimeType,
  pageNumber?, numPages? }`. Backwards-compat `renderPdfFirstPageToPng`
  retained for callers that only need page 1.
- `src/components/PDFPagePickerModal.jsx` — picker UI that listens for
  the `Toolbar.jsx`-fired event and shows thumbnails; Toolbar wires the
  `onMultiPage` callback to mount this modal and await `choosePage(n)`.
- `src/underlay/calibration.js` — `computeInchesPerPixel`,
  `buildCalibration`, `renderDimensionsInches`. Calibration stored in
  IMAGE PIXEL space per ADD 8 (not world coords — decouples from
  canvas viewport).
- **Per-floor underlay (Fix 3 — corrects an initial scope reduction).**
  Each floor owns its own underlay record at
  `projectSettings.floors[i].underlay`. Setters take a `(partial,
  floorId)` signature: `setUnderlay`, `setUnderlayCalibration`,
  `setUnderlayPlacement`, `setUnderlayOpacity`, `setUnderlayVisible`.
  Selector `getFloorUnderlay(floorId)` is the canonical read.
  Asset key: `${projectId}::underlay::${floorId}`. `loadProject`
  migrates legacy single `projectSettings.underlay` onto
  `floors[0].underlay`. The original Phase 5 ship was project-wide;
  per-floor was the corrective follow-on captured in the user-memory
  entry `feedback_underlay_scope_violation_lesson.md`.
- `src/components/UnderlayLayer.jsx` — SVG `<image>` inside Canvas's
  transform group, between group open and grid rect. Reads the active
  floor's underlay; blob lazy-loaded from IDB via module-level cache.
- `src/components/CalibrationModal.jsx` — **two-click capture** is the
  canonical flow (user clicks two reference points on the canvas with
  `calibrate_underlay` tool active; modal opens prompting for known
  distance). Full-width fallback preserved for users who know "this
  drawing is X ft wide" without an exact reference segment. Writes to
  the current floor's calibration.
- Visual markers on Canvas: clicked points render as primary-colour
  dots, with a dashed line between them once both are captured.
- LayersPanel Underlay group hidden when no underlay loaded on the
  current floor (ADD 9).
- Toolbar `View & Settings → Underlay` group: Import / Calibrate / Clear.

### 9 architectural additions (locked from review)

ADD 1 — `slab.roleSource: 'AUTO' | 'MANUAL'` provenance; manual setters
stamp MANUAL only when value changes.
ADD 2 — Centralized MEP override resolution in `src/mep/resolution.js`
ships **before** consumers; mirror `src/specs/resolution.js`.
ADD 3 — Selection-state namespace `state.selection.xxxId` for cross-
canvas highlighting (electrical circuit, future plumbing zone, HVAC
loop, riser trace).
ADD 4 — Generic binary-asset storage in `src/projects/storage/assets.js`
serves underlay + future DXF / IFC / photo / texture imports.
ADD 5 — IDB schema versioning + forward-migration chain.
ADD 6 — Slab canvas fills are translucent solid only — no SVG patterns
(performance risk at zoom + transparency).
ADD 7 — Room BOQ memoization keyed on `[roomId, boqRevision, ratesRevision]`.
ADD 8 — Underlay calibration stored in IMAGE PIXEL space (`p1Px`, `p2Px`,
`inchesPerPixel`); world coords derived at render time.
ADD 9 — LayersPanel Underlay group entirely hidden when no underlay
exists.

### Verify-script inventory (24 total — `verify-underlay` added)

`verify-persistence` extended with full manager.js coverage:
migration shim, sync cache + async IDB write serialization, chunked
storage round-trip, rename / delete / setCurrent flows, autosave
snapshot shape, re-boot doesn't duplicate migration.

### Locked rules added by Phase 5

- **Never scope down without approval.** If a step looks bigger than
  expected, surface the trade-off and ask BEFORE shipping a smaller
  version. "Scope deviation flagged" in the final report is NOT consent.
- **Selection-state writes go through `setSelection(partial)`** —
  shallow-merges into the namespace. Flat `selectedXId` fields stay
  where they are; new highlight features land in the namespace.
- **Binary assets never live in localStorage.** Every blob goes through
  `assets.js → IDB`. New asset types add a string to `ASSET_TYPES`.
- **Underlay never participates in BOQ or exports.** `excel.js` /
  `pdf.js` skip `projectSettings.underlay`. JSON export omits the
  storage pointer; on import the underlay is dropped (storage-bound,
  not portable).
- **`projectSettings.underlay.calibration.inchesPerPixel` is the
  single source of scale.** Never store `pxPerInch` (inverse) or
  derive scale from world coords.
- **`useSyncExternalStore` getSnapshot must return a stable reference
  when nothing changed.** Cached arrays/objects must not be
  re-allocated on every read — return a frozen singleton for the
  empty / null case. `src/revisions/manager.js::listRevisions(null)`
  uses a `const _EMPTY = Object.freeze([])` singleton; React's
  infinite-loop guard fires on a fresh `[]` every call. Same rule
  applies to any future external-store façade.
- **Async writes in `manager.js` serialize via the queue.** Direct
  `_persistence.put`/`saveCurrent` calls go through `_enqueueWrite`
  so a `createProject` immediately followed by `saveCurrent(sameId)`
  doesn't read an absent PROJECTS record. Tests drain via
  `await flushPendingWrites()`; production code never awaits.
- **`buildSnapshot` lives in `src/projects/_snapshot.js`** — extracted
  from `autosave.js` so Node verify scripts can pull the pure
  snapshot shape without dragging in Toast.jsx (Node's ESM loader
  can't parse JSX). Production `autosave.js` re-exports it.

### Module map — Phase 5 additions

```
src/projects/storage/
  indexedDb.js          — async storage facade (existing) + ASSETS + METADATA
                          stores added (DB_VERSION bumped 1→2)
  idbAdapter.js         — real browser IndexedDB adapter via native indexedDB
  assets.js             — generic binary asset primitive (ADD 4):
                          storeAsset / getAsset / deleteAsset /
                          deleteProjectAssets / listProjectAssets
                          + BroadcastChannel 'boq-assets' notifier
  getAssetStorage.js    — lazy adapter accessor (IDB in browser, memory
                          adapter in Node verify scripts)
src/projects/
  manager.js            — REWRITTEN. IDB-canonical with sync read cache;
                          serializing _writeQueue; BroadcastChannel
                          'boq-projects' multi-tab sync; bootPersistence()
                          + _bootForTest() seam; flushPendingWrites()
                          drain helper
  _snapshot.js          — pure buildSnapshot (no UI deps; safe for Node tests)
  autosave.js           — debounced autosave routed through manager → IDB
src/underlay/
  calibration.js        — computeInchesPerPixel + buildCalibration +
                          renderDimensionsInches (pure math; image-pixel
                          space per ADD 8)
  pdfRender.js          — dynamic pdfjs-dist import; page-aware (single-
                          page auto / multi-page picker via onMultiPage
                          callback with thumbnails); image FileReader
                          path; importUnderlayFile driver
src/mep/
  resolution.js         — central MEP override resolution (ADD 2) —
                          resolveFixtureFlowLpm / resolveWireGauge /
                          resolveRefrigerantPipeOD; mirrors specs/resolution.js
src/components/
  UnderlayLayer.jsx     — SVG <image> inside Canvas transform group; lazy
                          blob load from IDB via module-level cache
  CalibrationModal.jsx  — two-click mode (canonical) + full-width fallback
                          + visual canvas markers
scripts/
  verify-underlay.mjs   — 36 assertions: calibration math round-trip,
                          buildCalibration edge cases, store action
                          round-trips, asset round-trip via memory adapter
  verify-persistence.mjs — EXTENDED. Full manager.js flow, migration
                          shim, chunked autosave, idempotent re-boot
```

### Two-click calibration flow

```
1. User: View & Settings → Underlay → Calibrate scale
   → activeTool = 'calibrate_underlay'
2. User clicks p1 on canvas:
   Canvas.handleSVGClick → screenToWorldRaw → image-pixel coords
   → setSelection({ calibrationCapture: { p1Px, p2Px: null } })
3. Visual marker renders at p1 (primary dot, drawn in <g data-layer
   ="calibration-capture"> inside Canvas transform group)
4. Status banner shows "First point captured at (x, y) — click second"
5. User clicks p2:
   → setSelection({ calibrationCapture: { p1Px, p2Px } })
6. Both markers + dashed line render between p1 and p2
7. CalibrationModal opens with two-click mode preselected, distance
   readout in pixels, FeetInchesInput for known length
8. Apply: buildCalibration(p1Px, p2Px, knownFt) →
   setUnderlayCalibration → Canvas re-renders underlay at new scale
9. Modal closes, capture cleared, tool returns to 'select'
```

Image-pixel coords stored, not world coords. World transforms (pan /
zoom / placement nudges) never affect calibration once locked. World
→ image conversion at click: `pxX = (worldX - placement.xIn) / ipp`,
`pxY = ((placement.yIn + hIn) - worldY) / ipp` (Y-flip).

### End-to-end test (Playwright, 2026-05-27)

Verified the full workflow on dev server:

| # | Step | Result |
|---|---|---|
| 1 | Create project + draw walls + save | 4 walls + 4 nodes round-tripped |
| 2 | Reload page → loads from IDB | `localStorage` only holds UI prefs; project data in IDB `boq-app` v2 |
| 3 | Two tabs → BroadcastChannel sync | Rename in tab 2 reflected in tab 1 within 500ms |
| 4 | PDF import + two-click calibration | 1191×1684 PNG via pdfjs-dist; `inchesPerPixel = 0.42` (matches `14ft × 12in / 400px`) |
| 5 | BOQ categories | 38 lines across 10 categories; quantities match 10×10ft room expectations |

---

## Enterprise architecture upgrade — COMPLETE (2026-05-26)

A 4-phase architectural upgrade landed in 14 commits. Every BOQ Gap
1-8 schema slot has its data layer, contracts, infrastructure, AND
user-facing UI in place and machine-enforced.

**23 verify scripts gate every commit.** Zero exceptions. Phase 4
ships zero new verify scripts — the data-layer contracts from
Phases 1-3 catch every regression that matters; Phase 4 is pure UI
surface.

### Phase summary

| Phase | Architectures | What landed | Commits |
|---|---|---|---|
| **1 — Foundation** | Arch 8 + 6 + 9 | safeR2 + IFC GUIDs + entity schemas / integrity verifier | `558046d` `31c804e` `64544f4` |
| **2 — Core** | Arch 2 + 5 + 1 | Operation journal + IDB persistence + state slice boundaries | `58a1499` `9c91e26` `90971bd` |
| **3 — Compute + Validation** | Arch 3 + 4 | ComputationEngine DAG + validation formalization | `bc648d8` `762cba4` |
| **4 — Surface** | Arch 7 | Tier 1 UI gaps (ProjectSettings + Room + Opening + BOQPanel) | `f1440f1` `8e373dc` `2cbc80b` |

Per-phase detail sections (Phase 4 → Phase 3 → Phase 1+2) live
immediately below this summary.

### Verify-script inventory (23 total)

```
Phase 1 (12):
  verify-boq                  ← canonical BOQ pipeline
  verify-multifloor           ← multi-floor scoping
  verify-topology             ← spatial relationship layer
  verify-mep                  ← 5 MEP disciplines + clash + sizing
  verify-iso-projection       ← pure math (no integrity)
  verify-units                ← pure math (no integrity)
  verify-numbers              ← safeR2 / safeRound / safeNum / safeClamp + BONDING
  verify-lints                ← Rule 1: no local r2 / Rule 2: no raw crypto.randomUUID
  verify-ifc-ids              ← uid / uidIfc / newEntityIds + round-trip
  verify-id-exposure          ← C8 grep guard for export/persistence paths
  verify-schemas              ← entity schemas well-formed + normalizeEntity + validateEntity
  verify-integrity            ← referential integrity verifier

Phase 2 (8):
  verify-operations           ← dispatch + apply/inverse round-trip + transactions
  verify-op-purity            ← C2: no ID generation inside apply()
  verify-op-kinds             ← C1: every op declares user/system/transient
  verify-migrations           ← SCHEMA_VERSION + MIGRATIONS chain + runMigrations
  verify-persistence          ← IDB layer round-trip via in-memory adapter
  verify-catalog-provenance   ← manifest drift + filesystem-wide CATALOG_VERSION audit
  verify-state-boundaries     ← slice boundary invariants
  verify-legacy-shim          ← C5 kill-switch enforcement

Phase 3 (3):
  verify-compute-graph        ← DAG + class taxonomy + memoization correctness
  verify-compute-correctness  ← property tests for dep-list correctness
  verify-validation           ← scopes + dismissals + version tracking + ordering
```

### Locked rules (cross-cutting — load-bearing)

These rules survive every future change. New code MUST honor them;
verify scripts fail CI on violation.

1. **C2 (ID purity)** — operation `apply()` handlers MUST NOT generate
   IDs. Caller pre-generates via `uid()` / `uidIfc()` / `newEntityIds()`
   from `src/lib/ids.js`. Enforced by `verify-op-purity.mjs`.
2. **C1 (operation kinds)** — every registered op declares `kind ∈
   { user, system, transient }`. Routing differs per kind. Enforced
   by `verify-op-kinds.mjs`.
3. **C3 (no workers without proof)** — `runInWorker: true` throws at
   `defineComputation`. Web Workers only when `--profile` evidence
   shows repeated >50ms compute causing jank.
4. **C4 (no compression without telemetry)** — IDB chunks store plain
   JSON. LZ compression only if quota telemetry proves need.
5. **C5 (kill-switch dates)** — every legacy shim declares a `killBy`
   date. CI fails when the date passes with the shim still present.
6. **C6 (compute classes)** — every computation node declares
   `class ∈ { topology, quantity, routing, presentation, validation }`.
7. **C7 (validation scopes)** — every rule declares
   `scope ∈ { geometry, structural, mep, boq, export, constructability }`.
8. **C8 (ID exposure policy)** — internal `id` is runtime-only.
   Exports, revisions, dismissals, persistence, journals MUST use
   `ifcGlobalId`. Enforced by `verify-id-exposure.mjs`.
9. **Baseline integrity gate** — every state-building verify script's
   first assertion is `verifyIntegrity(state).valid`. Pure-math
   scripts (`verify-iso-projection`, `verify-units`) are exempt.
10. **Data-UI sync** — every projectSettings subtree has a UI section;
    every per-entity override slot has a panel section; every emitted
    BOQ category has a BOQPanel section.
11. **Presentation model is the single source for export totals** —
    `excel.js` and `pdf.js` consume `computeBoqPresentationModel(...)`
    and never recompute amounts/subtotals themselves.
12. **safeR2 instead of local r2** — no local `r2()` definitions
    outside `src/lib/numbers.js`. Enforced by `verify-lints.mjs` Rule 1.
13. **`crypto.randomUUID()` only in `src/lib/ids.js`** — every other
    file imports `uid()`. Enforced by `verify-lints.mjs` Rule 2.

### Module map — where the load-bearing pieces live

```
src/lib/
  numbers.js              — safeR2 / safeRound / safeNum / safeClamp
  ids.js                  — uid / uidIfc / newEntityIds / uuid↔ifc converters
src/schema/
  entities/               — 17 entity schema files + barrel
  types.js                — FIELD_TYPES registry
  normalize.js            — normalizeEntity / normalizeCollection / normalizeState
  validate.js             — validateEntity / validateState
  integrity.js            — verifyIntegrity / assertIntegrity
src/operations/
  _schemaVersion.js       — SCHEMA_VERSION (single source — re-exported by projects/)
  types.js                — OP_KIND / OP_AUTHOR / buildOp / withInverse
  registry.js             — OPERATIONS map (13 representative types)
  dispatch.js             — dispatch / transaction with kind routing
src/compute/
  registry.js             — defineComputation / runComputation / COMPUTE_CLASS
  profile.js              — recordCompute / printProfile (--profile flag)
src/validation/
  registry.js             — VALIDATION_SCOPE / sortRulesForRun / dismissal helpers
  engine.js               — runValidation(state, { scopes, suppressDismissed })
  rules/                  — 5 structural rules + 3 MEP rules
src/projects/
  schemaVersion.js        — MIGRATIONS chain + runMigrations
  storage/indexedDb.js    — createPersistence(storage) facade + makeMemoryAdapter
  manager.js              — legacy localStorage (still primary; IDB ready to wire)
src/specs/
  catalogManifest.js      — getAllCatalogVersions / diffCatalogManifests
src/store/
  legacyAccessors.js      — LEGACY_ACCESSORS registry + SHIM_KILL_BY = 2026-08-15
```

### Deferred (intentionally — re-evaluate when evidence demands)

- **Web Workers (C3)** — defer until `--profile` shows >50ms repeated jank
- **LZ compression (C4)** — defer until quota telemetry proves need
- **Multi-tab BroadcastChannel + real IDB adapter wiring** — facade ready;
  browser integration commit moves autosave from localStorage to IDB
- **Physical state-slice refactor (Arch 1)** — boundary contract in place;
  physical movement to `state.model.X` happens incrementally as
  component code is touched, gated by `SHIM_KILL_BY = 2026-08-15`
- **Operation migration of ~80 existing `_save()` callsites** — registry +
  dispatch infrastructure ready; setters migrate one at a time as
  features need journal / audit / collab capabilities
- **Opening hardware fine-grained overrides UI** — schema wired
  (`opening.hardwareOverrides { add, remove }`); add/remove rows UI
  stub in place; full picker UI is follow-on

### Future phases (not started)

- **Phase 5 — DXF import** (parse AutoCAD plans → walls/rooms)
- **Phase 5 — Solar discipline** (catalog + slots ready; sizing/routing/BOQ deferred)
- **Phase 5 — Rainwater + central hot-water riser** (plumbing graph slots exist)
- **Phase 6 — IFC export** (`ifcGlobalId` field already populated on every entity)
- **Phase 7 — Multi-user collaboration** (operation journal is the prerequisite)

---

## Enterprise architecture — Phase 4 (2026-05-26)

Tier 1 UI gaps closed. Every BOQ Gap 1-8 schema slot + every
projectSettings subtree + every per-entity override is now editable
in the panels. Data layer and UI layer match.

**3 sub-commits** (`f1440f1`, `8e373dc`, `2cbc80b`); all 23 verify
scripts stay green throughout (pure UI; no aggregator changes).

### Phase 4 — Tier 1 UI (Arch 7)

**Commit A — Foundation setters + ProjectSettingsPanel** (`f1440f1`)
- 3 missing setters added to `src/store.js` (mirror existing
  `setRoomPlasterSystem` pattern):
  - `setRoomPaintSystem(roomId, sysId)` — null = inherit project default
  - `setRoomCeilingFinishSystem(roomId, sysId)` — null = inherit
  - `setOpeningHardware(wallId, openingId, partial)` —
    partial: `{ hardwareSetId?, hardwareOverrides? }`
- 9 new sections in `ProjectSettingsPanel.jsx` (appended after the
  existing staircase defaults block):
  - **Project Metadata** (Gap 1) — 6 text fields + date picker
  - **Contingency** (Gap 2) — defaultPercent + per-category
    overrides table (9 common categories) + displayMode segmented
  - **Default Paint Systems** (Gap 6) — interior + exterior dropdowns
    filtered by appliesContext
  - **Default Ceiling Finish** (Gap 7) — dropdown of
    CEILING_FINISH_REGISTRY
  - **Door Hardware Defaults** (Gap 4) — per-subtype dropdowns
    filtered by HARDWARE_SET_REGISTRY.appliesTo
  - **Window Hardware Defaults** (Gap 5) — per-subtype dropdowns
    filtered by WINDOW_HARDWARE_SET_REGISTRY.appliesTo
  - **Project Costs** (Gap 8) — laborMode/Percent/Lumpsum +
    supervisionMode/Percent/Lumpsum + overheadPercent + profitPercent +
    gstPercent + gstAppliesToLabor toggle
  - **MEP Sizing Strategy** — per-discipline picker (PLUMBING /
    ELECTRICAL / HVAC / FIRE / ELV / SOLAR) with 4 strategies
    (CATALOG / HUNTER / LOAD_BASED / GRADIENT_DRAIN). Wires
    previously-orphaned `setMepSizingStrategy`.
  - **Auto-Sunken Slab Room Types** — multi-checkbox over
    ROOM_TYPES (folded from Arch 8 follow-up)

**Commit B — Per-entity overrides** (`8e373dc`)
- `src/components/RoomDetailPanel.jsx` — 4 new sections inserted
  between the existing "Tiles & skirting" section and the "Area"
  section:
  - **Paint system** (gated on `room.finishes.paint`) — dropdown
    + "Use project default" + source badge
  - **Ceiling finish** (gated on `room.finishes.ceilingPlaster`,
    else hint) — dropdown of `listCeilingFinishSystems()`
  - **Kitchen counter override** (`room.type === 'KITCHEN'`) —
    auto-mode hint OR manual length/depth inputs + Clear
  - **Balcony handrail** (`room.type === 'BALCONY'`) — tri-state
    (Default / Force on / Force off) + heightFt FtField
- `src/components/OpeningDetailPanel.jsx` — new Hardware section
  between Sunshade checkbox and Delete footer:
  - Resolves current items via `resolveOpeningHardware(state,
    opening)` — shows source badge + resolved-items preview box
  - Set picker dropdown filtered by `opening.subtype` (4 set lists)
  - Collapsible `<details>` "Advanced overrides" — schema is
    wired; full add/remove UI deferred to follow-on commit

**Commit C — BOQPanel surface** (`2cbc80b`)
- 4 new BOQ section components in `src/components/boq/`:
  - `SteelByDiaSection` — procurement rollup (Ø8/10/12/16/20/25/32mm)
  - `JoineryHardwareBoqSection` — hardware items summed across openings
  - `PaintMaterialsBoqSection` — gallons per (system × layer)
  - `CeilingFinishBoqSection` — false-ceiling materials per system
- 4 sections wired into `BOQPanel.jsx` after `GrillsBoqSection`
- 3 new header blocks on BOQPanel:
  - **Scope of work** (collapsible `<details>` below floor area) —
    floor count, built-up area, plot area, opening counts,
    room counts by type. Reads from
    `computeBoqPresentationModel(...).scopeOfWork`.
  - **Contingency displayMode toggle** (above column headers) —
    Clean | Detailed segmented control. Writes
    `projectSettings.contingency.displayMode` — affects Excel +
    PDF column layout via presentation model.
  - **Project Cost Summary** (above materials total, only when any
    component non-zero) — Labor / Supervision / Overhead / Profit /
    GST / GRAND TOTAL rows. Mirrors Excel Summary block + PDF
    cover layout exactly.
- Existing "Total cost" row renamed to "Materials total" (the
  grand total now lives in the Project Cost Summary block above it).

### Locked rule (Phase 4)

- **Data layer + UI layer must stay in sync.** Every projectSettings
  subtree shipped in Phase 2 has a corresponding section in
  ProjectSettingsPanel. Every per-entity override slot has a
  per-entity panel section. Every BOQ category emitted by lines.js
  has a BOQPanel section component. New schemas must ship their UI
  in the same commit (or the immediately-following one).

### Updated verify-script inventory (23 total — unchanged)

Phase 4 ships zero new verify scripts — it's pure UI surface on
top of the schema + aggregator infrastructure shipped in Phases 1-3.
All 23 existing scripts continue passing because Phase 4 changes
don't touch any data-layer contract.

---

## Enterprise architecture — Phase 3 (2026-05-26)

Compute + validation formalization. Builds on the Phase 1 foundation
(IDs, schemas, integrity) + Phase 2 core (operations, persistence,
state boundaries). Phase 4 (Tier 1 UI gaps) is the next milestone.

**23 verify scripts now gate every commit.** Phase 3 adds 3 new
scripts (compute-graph, compute-correctness, validation).

### Phase 3 — Compute + Validation (commits `bc648d8`, `762cba4`)

**Arch 3 — ComputationEngine DAG** (`bc648d8`)
- `src/compute/registry.js` — `defineComputation` registers a
  computation node with `id`, `version`, `class` (C6), `inputs`,
  `dependsOn`, `compute`, `estimatedCost`. Each node has a private
  cache cell that hits on reference-equality of `inputs(state)`.
- `runComputation(id, state)` walks the cache: miss → compute +
  store; hit → return cached. `_resetCache(id)` forces recompute.
  `validateDagAcyclic()` runs iterative DFS to detect cycles
  (cached until next `defineComputation` invalidates).
- **Locked rule (C6 — compute classes):** every node declares
  `class ∈ { topology, quantity, routing, presentation, validation }`.
  Used for profiling, batching, and future worker routing decisions.
  Throws at registration if missing or invalid.
- **Locked rule (C3 — no workers yet):** `runInWorker: true`
  throws. Web Worker routing is deferred until `--profile` evidence
  shows repeated >50ms computations causing canvas jank. Worker
  decision rule codified in registry.js header.
- `src/compute/profile.js` — `recordCompute(node, { hit, ms })`
  builds a per-node profile. Opt-in via `COMPUTE_PROFILE=1` env
  (Node) or `window.__COMPUTE_PROFILE = true` (browser). Zero-cost
  no-op when disabled. `printProfile()` dumps a sortable table at
  verify-script teardown with avg/max ms, hit rate, total time,
  and a ⚠ marker on nodes averaging >25ms.
- Existing `createMemo()` in `src/topology/cache.js` keeps working
  unchanged. Legacy memo cells migrate to `defineComputation`
  incrementally as aggregators are touched.

**Arch 4 — Validation formalization** (`762cba4`)
- `src/validation/registry.js` is the new metadata layer wrapping
  the existing engine. Adds:
  - `VALIDATION_SCOPE` enum (C7): `geometry | structural | mep |
    boq | export | constructability`
  - `sortRulesForRun(rules)` — deterministic `(scope, order, id)`
    ordering for byte-stable verify output
  - `filterRulesByScope(rules, scopes)` — selective runs
    (IFC export only runs `'export'` scope rules)
  - `buildIssueKey(ruleId, ruleVersion, issue)` — prefers
    `ifcGlobalId` per C8; falls back to `entityId` for
    project-level issues
  - `isIssueDismissed(state, ruleId, ruleVersion, issue)` —
    checks `projectSettings.validation.dismissals`; honors
    `expiresAt`
  - `buildDismissal({ reason, dismissedBy, expiresAt })` —
    frozen record stamped at dismissal time
  - `assertRuleWellFormed(rule)` — exposed for verify scripts
- `src/validation/engine.js::runValidation(state, opts)` extended
  signature `opts: { scopes?, suppressDismissed? }`:
  - `scopes` array filters rules (omit → all scopes)
  - `suppressDismissed` defaults true; false bypasses dismissals
  - Output adds `byScope`, `dismissalsApplied`, and each issue
    carries `ruleVersion` + `scope`
- All 8 existing rules updated with `version=1`, `order`, `scope`,
  `affectedBy`, `dismissable`. Structural rules use order
  100-140; MEP rules use 200-220. `slab_no_enclosure` (ERROR
  severity) declares `dismissable: false` — cannot be suppressed.
- **Locked rule:** every rule declares all 5 new fields plus the
  existing `severity / category / message / check`.
  `assertRuleWellFormed` enforces.
- **Locked rule (dismissal versioning):** dismissal keys include
  `ruleVersion`. Bumping a rule's version invalidates all old
  dismissals so v2's stricter check re-surfaces issues.
  Verified by test (v1 dismissal does not suppress v2 lookup).
- **Locked rule:** ERROR-severity rules are never dismissable.
  Engine gates on `rule.dismissable === true && severity !==
  ERROR` before checking dismissal map.
- Validation events (`state.validationEvents`, from store actions
  that reject ops) default to `scope: 'geometry'`. Surface only
  when scope filter allows geometry (or no filter).

### Verify-script inventory (23 total)

```
Phase 1 (12):  same as before — baseline integrity gate
Phase 2 (8):   same as before — ops + persistence + state boundaries
Phase 3 (3):
  verify-compute-graph        ← DAG validation + class taxonomy + memo correctness
  verify-compute-correctness  ← property tests for memo dep-list correctness
  verify-validation           ← scopes + dismissals + version tracking + ordering
```

### Working with the new infrastructure (Phase 3 additions)

**Adding a new computation node:**
1. Register via `defineComputation({ id, class, version, inputs,
   dependsOn?, compute, estimatedCost? })` at module scope.
2. Choose `class` from `COMPUTE_CLASS`:
   - `topology` — pure spatial relationships
   - `quantity` — material aggregations (plaster, BBS, etc.)
   - `routing` — MEP network/route builders
   - `presentation` — final composition (`getBoqLines`, model)
   - `validation` — rule outputs
3. Call via `runComputation('id', state)` from the consumer site.
4. `verify-compute-correctness` property tests catch dep-list bugs.

**Adding a new validation rule:**
1. Create `src/validation/rules/<name>.js` (or
   `src/mep/validation/rules/<name>.js` for MEP).
2. Export `{ id, version, order, severity, category, scope,
   affectedBy, dismissable, message, check(state) }`.
3. Use `VALIDATION_SCOPE.STRUCTURAL` etc. from registry.
4. Pick `order` in 100-step bands grouped by scope (structural
   100s, mep 200s, geometry 300s, export 400s, etc.).
5. Register in the appropriate barrel (`engine.js` for structural,
   `mep/validation/index.js` for MEP).
6. `verify-validation` `assertRuleWellFormed` catches missing fields.

**Selective validation runs:**
```js
runValidation(state, { scopes: ['export'] })       // IFC export pre-check
runValidation(state, { scopes: ['structural', 'mep'] }) // skip BOQ checks
runValidation(state, { suppressDismissed: false }) // QA audit mode
```

**Dismissing an issue (UI flow):**
```js
const issueKey = buildIssueKey(rule.id, rule.version, issue)
const dismissal = buildDismissal({
  reason:      'temporary — to be revisited',
  dismissedBy: currentUserId,
  expiresAt:   Date.now() + 30 * 24 * 60 * 60 * 1000,  // 30 days
})
setProjectSettings({
  validation: {
    dismissals: { ...state.projectSettings.validation?.dismissals, [issueKey]: dismissal }
  }
})
```

---

## Enterprise architecture — Phase 1 + Phase 2 (2026-05-26)

Foundational architecture upgrade across 6 commits. The goal: enterprise-
grade primitives that future features sit on top of without re-inventing
the same wheels (IDs, schemas, integrity, operations, persistence, slice
boundaries). Phase 3 (compute DAG + validation formalization) and Phase 4
(Tier 1 UI gaps) build on top of this.

**20 verify scripts gate every commit.** All must pass green; zero
exceptions. New verify scripts ship alongside each architecture so the
contracts are machine-enforced, not just documented.

### Phase 1 — Foundation (commits `558046d`, `31c804e`, `64544f4`)

**Arch 8 — Code quality** (`558046d`)
- `src/lib/numbers.js`: `safeR2` / `safeRound` / `safeNum` / `safeClamp`
  — `Number.isFinite` guard returns 0 for NaN/undefined/null. Replaced
  every local `r2()` definition across 26 files via `import { safeR2
  as r2 } from '../lib/numbers.js'` — callsites unchanged.
- **Locked rule:** new files must NOT define a local `r2()`. Enforced
  by `verify-lints.mjs` Rule 1 (grep guard).
- BONDING enum frozen + runtime contract assertion in `src/materials.js`.
  `BONDING_KEYS` exported as the canonical key list.
- LayersPanel master toggle per discipline (tri-state header).
- OHT volume readout in StampPanel + Staircase `hasHandrail` tri-state.

**Arch 6 — Stable IFC GUIDs** (`31c804e`)
- `src/lib/ids.js` is the **single home** for `crypto.randomUUID()`.
  Exports `uid()` / `uidIfc()` / `newEntityIds()` /
  `uuidToIfcGuid()` / `ifcGuidToUuid()` / `isValidUuid` /
  `isValidIfcGuid`.
- **Every persistent entity now carries TWO ids**:
  - internal `id` — 36-char UUID, runtime addressing only
  - `ifcGlobalId` — 22-char IFC base64 GUID (IFC 4 §8.7.3.4), STABLE
    for entity lifetime, used by exports / persistence / journals /
    revisions / dismissals
- **Locked rule (C8 — ID exposure policy):** internal `id` is a
  runtime-only implementation detail. Exports, revisions, persistence,
  journals, validation dismissals MUST use `ifcGlobalId`. Enforced by
  `verify-id-exposure.mjs` grep-guard on `src/export/` (extends to
  more paths post-Arch-5; STRICT mode kicks in 2026-08-15).
- **Locked rule:** no `crypto.randomUUID()` outside `src/lib/ids.js`.
  Enforced by `verify-lints.mjs` Rule 2.
- `splitWall` creates 3 entities with fresh ifcGlobalIds (midpoint
  node + 2 new walls). Splits are NEW entities — original wall's
  ifcGlobalId is destroyed.
- `addStamp` with `type === 'stairs'` creates a companion staircase
  that SHARES the stamp.id but has its OWN ifcGlobalId (distinct
  entity for IFC export).
- `loadProject` backfills `ifcGlobalId` on every entity lacking one.

**Arch 9 — Entity schemas + integrity verifier** (`64544f4`)
- `src/schema/entities/` — one schema file per entity type (17 total:
  node, wall, opening, room, stamp, column, beam, slab, staircase,
  foundation, 6 MEP disciplines, riser).
- Each schema declares `entityType`, `storeSlice`, `fields` (type +
  default + generator + min/max + oneOf), `invariants`, `legacyAliases`.
- `src/schema/types.js` — `FIELD_TYPES` registry (uuid, ifcGuid, ref,
  number, string, boolean variants, sentinel union `number|FULL|null`,
  array, object|null).
- `src/schema/normalize.js` — `normalizeEntity` / `normalizeCollection`
  / `normalizeState`. Injects defaults, drops legacy aliases, recurses
  sub-shapes (e.g. `wall.openings[]`).
- `src/schema/validate.js` — `validateEntity` / `validateState`. Type
  checks + oneOf + min/max + invariants. **Distinct from integrity** —
  validation checks SHAPE; integrity checks REFERENCES.
- `src/schema/integrity.js` — `verifyIntegrity(state) → { valid,
  issues, count }`. Walks every FK-style reference (wall.n1/n2 →
  nodes, room.wallIds → walls, beam.endpoints.columnId → columns, MEP
  wallId/roomId/floorId, riser fromFloorId/toFloorId, etc.). Issues
  sorted by `(entityType, entityId, field)` for byte-stable verify
  output. `assertIntegrity(state, label)` throws on failure.
- **Locked rule (MANDATORY baseline):** every state-building verify
  script asserts `verifyIntegrity(state).valid` as its first
  assertion. The pure-math scripts (`verify-iso-projection.mjs`,
  `verify-units.mjs`) are exempt — no state to check.
- **Locked rule:** new normalizations land as entries in entity
  schemas (default + legacyAliases), NOT as ad-hoc passes in
  loadProject. The 12+ existing ad-hoc passes will collapse into
  the schema system over time.

### Phase 2 — Core architecture (commits `58a1499`, `9c91e26`, `90971bd`)

**Arch 2 — Operation journal** (`58a1499`)
- `src/operations/` — dispatch-based mutation pipeline that SHIPS
  ALONGSIDE existing `_save()`. Setters migrate incrementally as
  features need journal / audit / collaboration capabilities.
- `src/operations/types.js` — `OP_KIND = { USER, SYSTEM, TRANSIENT }`,
  `OP_AUTHOR`, `buildOp({id, type, kind, payload, author})`,
  `withInverse(op, inverse)`, `isValidOpKind`.
- `src/operations/registry.js` — `OPERATIONS` map with 13
  representative ops covering all three kinds:
  - USER (full pipeline): `ADD_WALL`, `DELETE_WALL`,
    `SET_WALL_MATERIAL`, `SET_WALL_HEIGHT`, `ADD_OPENING`,
    `DELETE_OPENING`, `ADD_COLUMN`, `DELETE_COLUMN`
  - SYSTEM (journal-only, no undo): `BACKFILL_IFC_GLOBAL_ID`,
    `MIGRATE_SCHEMA_VERSION`, `REPAIR_BROKEN_REFERENCE`
  - TRANSIENT (no journal/undo/autosave): `SET_SELECTED_WALL_ID`,
    `SET_HOVERED_ENTITY`, `SET_LAYER_VISIBILITY`,
    `SET_CURRENT_FLOOR_ID`
- `src/operations/dispatch.js` — `dispatch(op, sideEffects)` routes
  by kind:
  - USER → apply + integrity-check + history + journal + autosave
  - SYSTEM → apply + integrity-check + journal + autosave (NO undo)
  - TRANSIENT → apply only (NO journal/undo/autosave)
- `transaction(label, fn, sideEffects)` groups USER ops into one
  composite. Nested transactions throw. **TRANSIENT ops inside
  transactions throw** (selection/hover can't roll back coherently
  with model changes).
- **Locked rule (C1 — operation kinds):** every registered op
  declares `kind`. Registry kind must match `op.kind` at dispatch
  (mismatch throws). Enforced by `verify-op-kinds.mjs`.
- **Locked rule (C2 — ID purity):** `apply()` handlers MUST NOT
  generate IDs via `crypto.randomUUID()` / `uid()` / `uidIfc()` /
  `newEntityIds()`. Caller pre-generates and threads through
  payload. This is mandatory for deterministic journal replay +
  future collaboration. Enforced by `verify-op-purity.mjs`
  (parses registry, tracks function depth, flags any forbidden call).
- **Integration with Arch 9:** every USER/SYSTEM op verifies
  `verifyIntegrity(nextState)` post-apply. Failure throws
  `OperationError` and the proposed state is discarded.
- `sideEffects` injection pattern keeps `dispatch.js` host-agnostic:
  `{ getState, setState, appendHistory, appendJournal,
  markAutosaveDirty }`. Store wires real impls; tests inject mocks.
- **Migration path:** ~80 existing `_save()` callsites continue
  using legacy snapshot path. Migrate one at a time. `verify-
  operations` + `verify-op-kinds` gate each migration.

**Arch 5 — IDB persistence + migrations + catalog provenance** (`9c91e26`)
- `src/operations/_schemaVersion.js` exports `SCHEMA_VERSION = 8` —
  the **single source** shared by the operation envelope AND the
  persistence migration chain. Re-exported by
  `src/projects/schemaVersion.js`.
- `src/projects/schemaVersion.js` — `MIGRATIONS` chain (ordered
  `{ from, to, label, migrate }` entries). `runMigrations(data) →
  { data, applied, warnings }`. Future-version saves preserved +
  warned (forward-compat best effort). Pure functions; safety-break
  against malformed chains.
- **Locked rule:** every schema change (new required field, removed
  field, renamed field) lands as a MIGRATIONS entry. Mechanical;
  `verify-migrations.mjs` provides per-version fixtures.
- `src/specs/catalogManifest.js` — `getAllCatalogVersions()` returns
  a frozen snapshot of every catalog version (paint, ceiling,
  hardware items + sets, 24 MEP catalogs, joinery / reinforcement /
  plaster systems). `diffCatalogManifests(saved, current)` detects
  nested + top-level drift; `flattenManifest()` produces a
  path→version map.
- **Locked rule:** every catalog file exporting `CATALOG_VERSION`
  must be registered in the manifest. `verify-catalog-
  provenance.mjs` walks the filesystem and asserts every
  CATALOG_VERSION export is reachable from the manifest. The
  verifier caught a real bug during Phase 2 (electricalConstants.js
  exported a version that wasn't in the MEP manifest).
- `src/projects/storage/indexedDb.js` — backend-agnostic facade
  over a `storage` adapter:
  ```
  storage = { get, put, delete, getAll, clear }
  ```
  - `makeMemoryAdapter()` — Map-backed mock for tests + Node verify scripts
  - Real IDB adapter (browser) wires identical interface (browser
    integration deferred — the facade is ready)
- `createPersistence(storage)` returns the full project API:
  - Mirrors existing localStorage `manager.js` (listProjects,
    openProject, saveCurrent, renameProject, deleteProject)
  - PLUS Arch 5 additions: `appendJournalEntry`,
    `readJournalSince`, `writeSnapshot`, `getLatestSnapshot`,
    `stampCatalogProvenance`, `getLastCatalogProvenance`
- `PROJECT_CHUNKS = ['model', 'projectSettings', 'settings']` —
  chunked serialization so future autosave can write only the
  changed slice(s).
- IDB stores: `projects`, `chunks`, `journal`, `snapshots`,
  `revisions`, `catalogs`.
- **Deferred per C4 — LZ compression.** Chunks stored as plain
  JSON (debuggable, simple). Add LZ only if quota telemetry
  proves need.
- **Deferred — multi-tab BroadcastChannel + real IDB adapter
  wiring.** Infrastructure shape is documented; the actual browser
  integration commit adds autosave migration from localStorage
  manager.js to IDB.
- **Crash recovery foundation:** snapshot + journal stores in
  place. Load-path reassembly (latest snapshot + replay forward
  journal entries) lands when autosave migrates.

**Arch 1 — State-slice boundary contract + kill-switch shim** (`90971bd`)
- **Why split this way:** the full physical refactor (moving every
  entity from `state.X` to `state.model.X`) touches ~50 component
  files via selector subscriptions. A big-bang refactor in one
  commit would risk breaking verify scripts that depend on
  `s().X` patterns. The contract-first approach delivers real
  architectural value (slice classification + boundary invariants
  + kill-switch enforcement) while letting the physical refactor
  land file-by-file safely.
- `src/store/legacyAccessors.js` — `LEGACY_ACCESSORS` frozen
  registry of 45 state fields, each classified into one of five
  target slices:
  - **model** (17): nodes, walls, rooms, stamps, columns, beams,
    slabs, staircases, foundations, 7 MEP collections, risers,
    projectSettings
  - **view** (25): activeTool, all selectedX, drawX,
    layerVisibility, currentFloorId, unit, showDimensions,
    ratesByKey, pendingWallIds, draftOpening, MEP selection ids
  - **history** (2): history, future
  - **validation** (1): validationEvents
  - **cache** (0): lands fresh in the new shape — no legacy paths
- `SHIM_KILL_BY = '2026-08-15'` — **single source** for the
  kill-switch date. Every accessor declares this same `killBy`.
- **Locked rule (boundary invariants):**
  - View-slice fields NEVER captured in history snapshots
    (transient state can't roll back coherently with model edits)
  - History-slice fields NEVER inside model snapshots (no
    recursion / unbounded growth)
  - Every store field MUST be classified somewhere (catches
    unknown additions)
  Enforced by `verify-state-boundaries.mjs`. Caught real MEP
  selection field omissions during Phase 2 build.
- **Locked rule (kill-switch):** post-2026-08-15,
  `LEGACY_ACCESSORS` MUST be empty. CI fails otherwise.
  `verify-legacy-shim.mjs` reports days-remaining banner
  pre-deadline.
- **Physical refactor path:** as Phase 4 (Arch 7 — Tier 1 UI)
  touches component code, each component migrates from
  `state.X` to `state.model.X`. Each migrated path gets removed
  from `LEGACY_ACCESSORS`. `verify-state-boundaries` continues
  passing — boundaries hold regardless of physical layout.

### Verify-script inventory (20 total)

```
Phase 1 (12):
  verify-boq                  ← canonical BOQ pipeline
  verify-multifloor           ← multi-floor scoping
  verify-topology             ← spatial relationship layer
  verify-mep                  ← 5 MEP disciplines + clash + sizing
  verify-iso-projection       ← pure math (no integrity)
  verify-units                ← pure math (no integrity)
  verify-numbers              ← safeR2 / safeRound / safeNum / safeClamp + BONDING contract
  verify-lints                ← Rule 1: no local r2; Rule 2: no raw crypto.randomUUID()
  verify-ifc-ids              ← uid/uidIfc/newEntityIds + round-trip
  verify-id-exposure          ← C8 grep guard for export/persistence paths
  verify-schemas              ← entity schemas well-formed + normalizeEntity / validateEntity
  verify-integrity            ← referential integrity verifier

Phase 2 (8):
  verify-operations           ← dispatch + apply/inverse round-trip + transactions
  verify-op-purity            ← C2: no ID generation inside apply()
  verify-op-kinds             ← C1: every op declares user/system/transient
  verify-migrations           ← SCHEMA_VERSION + MIGRATIONS chain + runMigrations
  verify-persistence          ← IDB layer round-trip via in-memory adapter
  verify-catalog-provenance   ← manifest drift + filesystem-wide CATALOG_VERSION audit
  verify-state-boundaries     ← slice boundary invariants
  verify-legacy-shim          ← C5 kill-switch enforcement
```

**Cross-cutting baseline rule:** every state-building verify script's
first assertion is `verifyIntegrity(state).valid`. If a script can't
construct a state passing integrity, the test fixture is broken before
any other assertion matters.

### Working with the new infrastructure

**Adding a new entity type:**
1. Add an entity schema in `src/schema/entities/<name>.js` declaring
   all fields + defaults + invariants + legacyAliases.
2. Register it in `src/schema/entities/index.js` (ENTITY_SCHEMAS barrel).
3. Add it to `src/schema/integrity.js` with FK checks for any `ref`
   fields.
4. Add it to `src/store/legacyAccessors.js` with a `slice` classification.
5. Entity creation sites use `newEntityIds()` to stamp both `id` +
   `ifcGlobalId`. NEVER call `crypto.randomUUID()` directly outside
   `src/lib/ids.js`.

**Adding a new schema field:**
1. Update the entity schema's `fields` map.
2. Add a MIGRATIONS entry in `src/projects/schemaVersion.js`
   bumping SCHEMA_VERSION + a `migrate(data)` function that adds
   the new field with a default.
3. Re-run `verify-schemas` + `verify-migrations` + `verify-integrity`.

**Adding a new catalog:**
1. Create the catalog file with `export const CATALOG_VERSION` +
   `export const CATALOG_SOURCE` + frozen registry + `getX(id)` +
   `listX()`.
2. Register the version in `src/specs/catalogManifest.js`
   (or `src/mep/catalogs/index.js` for MEP).
3. `verify-catalog-provenance.mjs` walks the filesystem and fails
   if a catalog isn't registered.

**Adding a new operation:**
1. Add the entry to `src/operations/registry.js` with `version`,
   `kind`, `apply(state, payload)` (pure, no IDs generated inside).
2. The `apply` returns `{ nextState, inverse }`. Inverse payload
   must be a valid op-type payload that undoes the apply.
3. Caller pre-generates entity IDs via `newEntityIds()` and threads
   them through the payload.
4. `verify-operations` round-trips apply → inverse → original-state.

**Adding a new validation rule (when Arch 4 lands in Phase 3):**
1. Add the rule to `src/validation/rules/<name>.js`.
2. Register in the rule barrel.
3. Declare `version`, `severity`, `scope` (geometry / structural /
   mep / boq / export / constructability per C7), `affectedBy`,
   `check(state)`.

---

## BOQ extension — Gaps 1–8 (2026-05-26)

Procurement-grade extension closing 8 gaps vs Indian residential BOM
templates: project header / cover, contingency, rebar by bar diameter,
door + window hardware, paint materials, ceiling finish, project costs
(labor / supervision / GST), Excel cover rewrite.

### Canonical presentation model (LOAD-BEARING)

**`src/boq/presentationModel.js::computeBoqPresentationModel(lines,
rates, state)`** is the single object both Excel and PDF exporters
consume. **Neither exporter does independent math** — no per-line cost
calc, no subtotaling, no contingency math, no project-cost rollup. Every
number on every sheet / page reads from the model. This locks
`Excel.grandTotal === PDF.grandTotal === model.grandTotal` and prevents
drift forever.

Model shape:
```
{
  projectMeta,           // GAP 1 header (title / owner / location / preparedBy / signatures)
  scopeOfWork,           // auto-stats from src/boq/_scopeOfWork.js
  buckets: [             // grouped per SHEET_BUCKETS registry
    { name, isMulti, systemColumnLabel,
      lines: [{ ...line, contingencyPct, qtyTotal, rate, amount, systemColumn }],
      subtotal },
  ],
  contingencySummary,    // per-category effective %, displayMode
  projectCosts,          // labor + supervision + GST block from src/boq/projectCosts.js
  materialSubtotal,
  grandTotal,
  presentationVersion: '2026-05-26-V1',
  generatedAt,
}
```

**Helper modules consumed internally:**
- `src/boq/_scopeOfWork.js::computeScopeOfWork(state)` — auto-stats
- `src/boq/_contingencyResolver.js::resolveContingencyPctForLine` —
  single-source % lookup
- `src/boq/projectCosts.js::computeProjectCosts` — labor / supervision /
  GST roll-up
- `src/export/_buckets.js::bucketLines + bucketIsMulti +
  bucketSystemLabel` — bucket grouping (existing — extended with 4 new
  buckets)

**Rule**: when adding a new BOQ feature that affects totals (new rate,
new contingency tier, new fee), wire it through the presentation model
— never directly into Excel or PDF. The grep guard is that neither
`excel.js` nor `pdf.js` should `import { totalBoqCost }` or recompute
amounts/subtotals from lines.

### GAP 2 — Contingency

**Schema** `projectSettings.contingency`:
```
{
  defaultPercent:     10,
  overrides:          { steel: 5, joinery: 5, joinery_hardware: 5,
                        plumbing_*: 5, electrical_*: 5 },
  excludedCategories: ['staircase'],
  displayMode:        'clean' | 'detailed',  // default 'clean'
}
```

**Rules** (`src/boq/_contingencyResolver.js`):
- Per-line lookup: `overrides[category] ?? defaultPercent ?? 0`.
- Excluded categories → 0.
- **NOS / set / lumpsum units → 0 always.** Fixed counts can't be
  contingencied (a hinge or door closer is whole or not at all).
- Per-line `line.contingencyPct = 0` is an explicit opt-out signal.

**Display mode** (`projectSettings.contingency.displayMode`):
- `'clean'` (default, contractor-friendly): single `Qty` column; the
  exporter renders `qtyTotal` (contingency baked in).
- `'detailed'` (procurement): three columns `Qty (Base) | +% | Qty (Total)`.

Setter: `setContingency(partial)` (deep-merges `overrides`).

### GAP 3 — Steel by bar diameter

**`src/specs/reinforcementSpecs.js`** — every `compute*BBS` now returns
`kgByDia: { [diaMm]: kg }` alongside the existing `kg.*` breakdowns.
Plus exports:
- `STANDARD_BAR_LENGTH_M = 6` (allowed `[6, 9, 12]`)
- `piecesForDia(totalKg, diaMm, length)` → ceil(totalKg / (length × weight))
- `weightPerPieceKg(diaMm, length)`

`projectSettings.bbsDefaults.standardBarLengthM` overrides the global
constant per project.

**`src/quantities/bbs.js`** rolls per-entity `kgByDia` into
`byDiameter: { [diaMm]: { totalKg, pieces, weightPerPieceKg,
standardBarLengthM, byCategory: { column, beam, footing, slab } } }`.

**BOQ emission** in `lines.js`: one line per non-zero diameter, label
`"Ø${dia}mm TMT Deformed Bar × ${len}m"`, `unit: NOS`,
`rateKey: BOQ_LINE_ID.steelByDia(dia)`. Independent rate column from
existing per-element steel lines (engineers may price Ø12mm vs Ø16mm
differently regardless of element).

**Bucket**: `'Steel — by Bar Diameter'` after `'Steel'` in `_buckets.js`.
Both views ship — per-spec rollup (existing) AND per-Ø rollup (new) so
users have BOQ visibility in both axes.

### GAPs 4 + 5 — Door + window hardware

**Catalogs** (versioned, IFC-ready):
- `src/specs/hardware/hardwareItems.js` — `HARDWARE_ITEM_REGISTRY`
  (hinges / locks / latches / bolts / closers / stoppers / handles /
  tracks / window stays / mosquito mesh). Every entry frozen, carries
  `ifcType` + `classificationCode` + `version`. `HW_CATEGORY` taxonomy.
- `src/specs/hardware/hardwareSets.js` — `HARDWARE_SET_REGISTRY`
  (Main door standard / Main door security / Internal door /
  Toilet door / Sliding door) AND `WINDOW_HARDWARE_SET_REGISTRY`
  (Casement / Sliding / Ventilator). One `getAnyHardwareSet(id)`
  walks both.

**Schema** (Hybrid + fine-grained adjustments, per user choice):
- `projectSettings.doorHardwareDefaults = { MAIN_DOOR: setId,
  INTERNAL_DOOR: setId }`
- `projectSettings.windowHardwareDefaults = { WINDOW: setId,
  VENTILATOR: setId }`
- `opening.hardwareSetId: string | null` — null = inherit per-subtype
  default
- `opening.hardwareOverrides: { add: [{itemId, qty}], remove: [itemId] }
  | null` — fine-grained: add a closer to one bedroom door / remove a
  cylindrical lock from one internal door

**Resolution** (`src/specs/hardware/resolution.js`):
`resolveOpeningHardware(state, opening)` → `{ setId, setLabel, source:
'EXPLICIT'|'PROJECT_DEFAULT'|'NONE', items: [{ itemId, qty,
source: 'SET'|'OVERRIDE_ADD' }], parent }`. Single-source fallback
chain — UI panels and the aggregator both call this.

**Aggregator** `src/quantities/doorHardware.js::computeDoorHardwareQuantities`.
**Mosquito mesh special-case**: items with `qtyMode: 'AREA'` (or
`category: HW_CATEGORY.MESH`) compute qty as `w × h / 144` Sft per
opening, not fixed nos.

**BOQ**: category `joinery_hardware`. The Joinery bucket is now
multi-category with System column (`Frame & Shutter` | `Hardware`).
One line per item; `rateKey: BOQ_LINE_ID.hardwareItem(itemId)` =
`hw_<lowercase>`.

**Setters**: `setDoorHardwareDefaults`, `setWindowHardwareDefaults`
(shallow merge).

### GAP 6 — Paint materials

**Catalog** `src/specs/paintSystems.js` — `PAINT_SYSTEM_REGISTRY`:
`STD_ACRYLIC_INTERIOR`, `PREMIUM_INTERIOR_LUXURY`, `EXTERIOR_WEATHERSHIELD`.

Every layer carries `coats`, `coverageSftPerGallon` (or `unitsPerSft`
for sandpaper), and **`efficiencyFactor: 1.0` (RESERVED — Addition 3)**.
v1 aggregator multiplies by it (no effect at 1.0). v2 will lower it
for rough plaster / texture paint. Don't remove the field or fork
schema when adding new systems.

**Schema**:
- `projectSettings.defaultInteriorPaintSystemId`
- `projectSettings.defaultExteriorPaintSystemId`
- `room.paintSystemId: string | null` — null = project default for interior
- External walls always use the project exterior system

**Aggregator** `src/quantities/paint.js::computePaintQuantities` —
per-room override + external area from `plasterQ.totals.externalWallsFt2`
(single source). Per-layer
`qty = ceil(totalSft × coats / (coverage × efficiencyFactor))`
(rounded up — paint is purchased per-can).

**BOQ**: category `paint_materials`, unit `gallons`/`nos` per layer
type. Bucket `'Paint Materials'`. Existing `finishes_paint_walls` /
`finishes_paint_ceiling` Sft lines kept unchanged — they're the labor
estimation surface.

Setter: `setDefaultPaintSystems({ interior?, exterior? })`.

### GAP 7 — Ceiling finish

**Catalog** `src/specs/ceilingFinishSystems.js` — `CEILING_FINISH_REGISTRY`:
`NONE` (default), `GYPSUM_BOARD_12MM`, `CEMENT_BOARD_3_5MM`, `PVC_PANEL`,
`GRID_T_BAR`.

Every entry has `materials: [{ id, label, qtyPerM2, unit }]` and
**`perimeterBased: false` (RESERVED — Addition 4)** for future cove /
cornice / trim calc.

**Schema**:
- `projectSettings.defaultCeilingFinishSystemId` (default `'NONE'`)
- `room.ceilingFinishId: string | null` — null = inherit project default
- Only rooms with `finishes.ceilingPlaster === true` accept a finish
  (false ceiling sits BELOW structural plaster). Setting
  `ceilingFinishId` without plaster surfaces a warning in `_meta.warnings`.

**Aggregator** `src/quantities/ceilingFinish.js`. Per-system materials
× room area (m² conversion via `SFT_TO_SQM = 0.0929`). NOS-unit
materials (screws) rounded up.

**BOQ**: category `ceiling_finish`, bucket `'Ceiling Finish'`.

Setter: `setDefaultCeilingFinishSystem(id)`.

### GAP 1 — Project metadata + GAP 9 — Cover rewrite

**Schema** `projectSettings.projectMeta`:
```
{ projectTitle, ownerName, location, preparedBy, checkedBy,
  approvedBy, preparedDate }
```
Setter: `setProjectMeta(partial)`.

**Cover rewrites**:
- Excel `Summary` sheet — project header → scope of work → category
  subtotals → contingency summary → project cost summary → signature
  block.
- PDF cover page — project header → scope of work → cost summary →
  signature block.

Both consume the presentation model. Per-bucket sheets/sections follow.

### GAP 8 — Project costs (labor + supervision + GST)

**Schema** `projectSettings.projectCosts` (`DEFAULT_PROJECT_COSTS` in
`src/boq/projectCosts.js`):
```
{
  laborMode:        'percent' | 'lumpsum',   // default 'percent'
  laborPercent:     15,
  laborLumpsum:     0,
  supervisionMode:  'percent' | 'lumpsum',
  supervisionPercent: 5,
  supervisionLumpsum: 0,
  overheadPercent:  0,
  profitPercent:    0,
  gstPercent:       18,
  gstAppliesToLabor: false,
}
```

**Decision**: NOT emitted as BOQ lines. `computeProjectCosts(materialSubtotal,
config)` rolls up labor / supervision / overhead / profit / GST and
returns `{ ...components, breakdown: [{label, amount, basisLabel}],
grandTotal }`. The presentation model exposes it as `model.projectCosts`;
exporters render it on the Excel Summary block + PDF cover.

Setter: `setProjectCosts(partial)`.

### New buckets in `src/export/_buckets.js`

Order (after existing entries):
- `'Steel — by Bar Diameter'` (single-category `steel_by_diameter`),
  placed right after `'Steel'`.
- `'Paint Materials'` (multi-category with `Layer` system column).
- `'Ceiling Finish'` (multi-category with `Material` system column).
- `'Joinery & Hardware'` (multi-category: Frame & Shutter | Hardware) —
  REPLACES the old single-category `Joinery` bucket.

### Verification

`scripts/verify-boq.mjs` ships 250+ assertions including:
- Phase A: presentation model versioned + deterministic + grandTotal
  parity (`model.grandTotal === projectCosts.grandTotal === sum of
  bucket subtotals + project costs`)
- Gap 1: setProjectMeta round-trip
- Gap 2: contingencyPct = 10 default, displayMode propagates, NOS
  lines never contingencied
- Gap 3: byDiameter populated, pieces at 6m derived correctly, BOQ
  lines emitted with Ø + length suffix
- Gap 4: door hardware items resolved from per-subtype set (3 hinges +
  1 lock + 1 closer + 1 stopper + 1 handle for main door)
- Gap 6: paint layer qty in gallons per system
- Gap 7: ceiling finish materials scaled by room area
- Gap 8: labor 15% + GST 18% + grand total = sum of components

All other verify scripts (multifloor / topology / mep / iso-projection
/ units — 393 assertions total) remain green.

### Rules locked

1. **Both exporters consume the presentation model only.** No
   `totalBoqCost` import, no per-line amount recompute, no subtotal
   resummation in `excel.js` / `pdf.js`. If you find yourself doing
   math in an exporter, move it to `presentationModel.js`.
2. **Contingency NOS exclusion is unconditional.** `nos` / `set` /
   `lumpsum` units never carry contingency, regardless of category or
   overrides. Reasoning: a hinge or door closer is whole or not at all
   — there's no fractional procurement.
3. **`projectCosts` is Summary-block only, never BOQ lines.** Don't
   emit `category: 'project_costs'` lines from `boq/lines.js`. The
   Summary block + PDF cover are the single render targets.
4. **`efficiencyFactor` + `perimeterBased` are RESERVED schema slots.**
   Don't remove them when adding new paint / ceiling systems. v1
   aggregators ignore them; v2 will activate them for texture paint /
   cornice calc respectively.
5. **Hardware mosquito-mesh special-case.** Items with
   `qtyMode: 'AREA'` (or `category: HW_CATEGORY.MESH`) compute qty as
   opening area, never fixed count. Set entries declare `qty: 1` as a
   placeholder; aggregator overrides to `w × h / 144` Sft.
6. **Per-room override pattern stays consistent.** `room.paintSystemId`
   / `room.ceilingFinishId` / `opening.hardwareSetId` mirror the
   existing pattern (`room.plasterSystemId` / `room.dadoHeightFt` /
   `wall.hasBalconyRailingEdge`): null = inherit project default,
   non-null = explicit override. Don't introduce per-room-type maps
   without re-asking the user.
7. **Greenfield rule honored.** No migration shims, no loadProject
   normalization for the new subtrees. Consumer-side `?? defaultX`
   fallbacks let legacy saves load cleanly.

### Open follow-ups (not blocking)

- UI panels: `ProjectSettingsPanel` field groups for `projectMeta` /
  `contingency` / `projectCosts` / hardware defaults; `OpeningDetailPanel`
  hardware picker (set dropdown + add/remove rows); `RoomDetailPanel`
  paint + ceiling system pickers.
- Engineer-eye review of new bucket order against procurement workflow.
- Per-line GST tiers (current GST flat 18% on materials; some line types
  have different slabs — deferred to v2).
- Window hardware fine-grained override UI parity with door (same
  schema; just needs the picker).

---

## 3D Iso Viewer — rotation (2026-05-26)

The iso viewer is no longer fixed at 30°/30°. The camera now rotates
freely while every other guarantee of the iso pipeline (pure modules,
painter's-algorithm sort, basis-stable across renders) holds.

**Locked rules:**

1. **`makeViewBasis(view)` is the single trig site.** Returns a frozen
   `{ right, up, forward }` triple. Every `worldToIso(x,y,z,basis)`
   call is a per-vertex dot product against a cached basis — NEVER
   re-evaluate `Math.cos/sin` inside the project loop. The basis is
   memoised in `IsoView` via `useMemo(() => makeViewBasis(view), [view])`.
2. **Default-view byte parity.** At `{ azimuthDeg: 45, elevationDeg: 30 }`
   the parameterised projection MUST reproduce the historical fixed
   formula `sx = (x - y)·cos30, sy = -(x + y)·sin30 - z` exactly.
   `scripts/verify-iso-projection.mjs` asserts this on 12 sample points
   within `1e-9`. Any change to `projection.js` re-runs that script.
3. **Azimuth is compass-style.** `0° = N`, `90° = E`, `180° = S`,
   `270° = W`. `45 = NE` (default), `135 = SE`, `225 = SW`, `315 = NW`.
   This is the convention `viewPresets.js` encodes — don't introduce
   a mathematical-CCW preset elsewhere.
4. **`src/iso/viewPresets.js` is the single source of preset angles.**
   `ISO_PRESETS` (4 corners) + `CARDINAL_PRESETS` (4 cardinals) +
   `TOP_PRESET` (plan view) + `DEFAULT_VIEW` +
   `ELEVATION_MIN_DEG`/`ELEVATION_MAX_DEG` (10°/70°). `IsoView` imports
   — never hardcodes degrees. Adding a new preset = one entry in this
   file.
4a. **Top view uses a separate projection path.** The engineering-iso
   formula degenerates at el=90° (the `right` basis collapses to zero
   because of `cos(el)`). `makeViewBasis` checks
   `elDeg >= TOP_VIEW_THRESHOLD_DEG` (89.5°) and returns a true
   orthographic plan basis: `right = (cos(az), sin(az), 0)`,
   `up = (-sin(az), cos(az), 0)`, `forward = (0, 0, -1)`. Z is ignored
   on screen; floors are distinguished only by the painter's-algorithm
   depth sort (low z first, high z last). `TOP_PRESET` uses
   `azimuthDeg: 0` so north points up — standard architectural plan
   orientation. The elevation slider stays clamped at [10°, 70°];
   `TOP_PRESET` is the only entry point to plan view.
5. **Sort comparator takes basis, not raw axes.**
   `makeBackToFrontComparator(basis)` ranks faces by
   `dot(centroid, viewForward)` descending. Stable tiebreak chain is
   MANDATORY: `depth → z asc → entityId → faceKind → originalIndex`.
   Without the tail keys, nearly-coplanar faces flicker during
   rotation. `extrude.js::buildFaceList` stamps `originalIndex` on
   every face BEFORE calling sort so the final fallback is
   always-distinct.
6. **React keys for faces are stable, not array indices.**
   `${elementType}:${entityId ?? '_'}:${faceKind}:${edgeIndex ?? '_'}:${originalIndex}`
   — the `originalIndex` tail disambiguates multi-solid entities
   (PILE foundations emit cap + N shaft solids sharing `entityId`)
   without re-introducing array-index instability across rotations.
   `prismToFaces` stamps `edgeIndex` on side faces so the key is
   meaningful per edge.
7. **View updates during drag/slider go through the rAF throttle.**
   `pendingViewRef` holds the latest desired view; `rafRef` ensures
   at most one `setView` per animation frame. Pattern:
   ```
   pendingViewRef.current = nextView
   if (rafRef.current != null) return
   rafRef.current = requestAnimationFrame(() => {
     const v = pendingViewRef.current
     pendingViewRef.current = null
     rafRef.current = null
     if (v) setView(v)
   })
   ```
   Apply this to ANY high-frequency view-driving input (orbit drag,
   elevation slider, future joystick). Preset clicks BYPASS the
   throttle — they cancel `rafRef` and call `setView` synchronously
   so the next bounds recompute sees the chosen preset.
8. **Re-fit only on preset / reset.** `refitOnNextBoundsRef` is set
   by `applyPreset` and consumed by a `useEffect` keyed on `bounds`
   that calls `fitToContent` once then clears the flag. Drag-driven
   view changes NEVER re-fit (would make orbiting unusable). The
   on-open auto-fit uses its own `fitDoneRef` and stays untouched.
9. **Pan vs Orbit is a single state toggle, not a modifier key.**
   `dragMode ∈ 'pan' | 'orbit'`. Pan = existing translate-the-view
   behaviour, Orbit = drag updates `view.azimuthDeg`
   (`+0.4°/px` horizontal) and `view.elevationDeg` (`-0.3°/px`
   vertical, clamped to `[10°, 70°]`). Cursor swaps via
   `data-drag-mode` attribute on `.iso-svg` (pan → `move`,
   orbit → `grab`, `:active` → `grabbing`). Do NOT add Shift+drag as
   an alternative entry — the explicit toggle is the contract.
10. **Bounds re-derive on basis change.** `bounds` `useMemo` depends
    on `[faces, basis]` because every face point gets re-projected
    when the camera rotates. Fit-to-content reads `bounds` from
    closure (no ref). Don't introduce `boundsRef.current = bounds`
    in render — it's a `react-hooks/refs` lint error.

**Verification.** `scripts/verify-iso-projection.mjs` — 34 assertions
covering default-view byte parity, `DEFAULT_BASIS` preconfig,
omitted-basis fallback, cardinal-preset distinctness, elevation
monotonicity, `viewForward` shape, and basis freezing. Must pass
alongside the other five verify scripts.

**What NOT to do:**
- Don't compute `Math.cos(view.azimuthDeg * Math.PI/180)` anywhere
  outside `makeViewBasis`. Pass the basis instead.
- Don't sort faces by `centroid[0] + centroid[1]` — that bakes in the
  default view. Always use the comparator factory.
- Don't use array index as a React key for faces. The stable composite
  key is mandatory at this face count.
- Don't auto-fit during drag. Engineers expect orbit to keep the
  current zoom/pan so they can inspect a corner from new angles.
- Don't add a third drag mode (e.g. "zoom drag"). Scroll-wheel zoom
  + the Pan/Orbit toggle is the entire contract.

**Known limitation — openings (doors / windows) are NOT rendered.**
`resolveWallSolid` extrudes each wall as one continuous prism; it
ignores `wall.openings[]` entirely. A wall with a 7×3 ft door looks
identical to a solid wall. When this gets prioritised, the agreed
approach is **decals, not cutouts**: add `resolveOpeningDecalSolid` to
`solids.js` emitting a thin polygon on the wall's outer face per
opening (doors dark grey, windows light blue), tag faces with
`faceKind: 'opening'`, surface as a new `openings` entry in
`layerVisibility` (default on). Cutouts (header / sill / jamb
sub-prisms) were considered and rejected — too much new co-planar
surface area for the painter's-algorithm sort, and they add no
information beyond what decals communicate for BOQ review.

---

## BOQ export sheet/section bucket registry (2026-05-25)

Single source of truth — `src/export/_buckets.js` — governs how BOQ
categories group into Excel sheets and PDF sections. Both
`src/export/excel.js` and `src/export/pdf.js` import from it so they
can NEVER drift apart again. (They previously had two independent
fixed category lists; both silently dropped joinery / tiles / grills
/ MEP from per-sheet/per-section output.)

**Registry shape.** `SHEET_BUCKETS` is an ordered frozen array of
`{ name, categories }` entries. `categories` is either:
- a STRING (single-category bucket — no System sub-column)
- an OBJECT `{ cat, system }` (multi-category bucket — exporters
  render a "System" column with the `system` label)

**19 buckets shipped, 36 categories covered.** Single-category:
Excavation, Plum Concrete, Structural, Concrete, Steel, Shuttering,
Masonry, Plaster, Finishes, Tiles, Joinery, Grills & Handrails,
Civil, Staircase. Multi-category MEP: Plumbing (Supply / Drainage /
Fixtures), Electrical (Lighting / Power / AC / Submain / Solar /
EV / Points / Fittings / DB), HVAC (Refrigerant / Condensate /
Units), Fire (Detection / Suppression / Equipment), ELV (CCTV /
Data / Security / AV).

**Helpers exported alongside the registry:**
- `bucketCategoryIds(bucket)` → flat array of raw category-id strings
- `bucketIsMulti(bucket)` → true when 2+ categories merged (exporters
  use to switch column layout)
- `bucketSystemLabel(bucket, categoryId)` → System column value for a
  line, '' if not a multi bucket
- `bucketLines(bucket, grouped)` → flat lines from
  `groupBoqLinesByCategory(...)` in bucket order (preserves e.g.
  plumbing_supply before plumbing_drainage)
- `ALL_BUCKETED_CATS` (Set) — every category id with a bucket
- `warnUnmappedCategories(grouped)` — dev-only `console.warn` when an
  emitted category isn't in `SHEET_BUCKETS`; called by both exports
  so a future MEP discipline (e.g. Solar, deferred) can't silently
  vanish from exports

**Column layout in exporters when bucket is multi:**
- Excel: prepends `System` column at position B. Amount formula
  refs shift one column right (`D*G` instead of `C*F`).
- PDF: prepends `System` column with `cellWidth: 70`. Subtotal-row
  `colSpan` bumps from 4 to 5 to cover the extra column.

**Adding a new BOQ category** (after emitting it in `boq/lines.js`
or a new MEP emitter): add it to the appropriate bucket in
`_buckets.js`. If it's a new discipline entirely, append a new
multi-category bucket at the end of the array (MEP convention).
Both Excel and PDF pick it up automatically. The dev warning fires
in any session where the category appears but the bucket entry is
missing.

**What NOT to do:** never iterate `Object.keys(grouped)` in an
exporter. The bucket registry exists to give users a stable,
procurement-friendly ordering. Random iteration breaks that.

---

## SelectionPanel primitive + click-priority fix (2026-05-25)

**New primitive: `<SelectionPanel>`** (`src/components/ui/SelectionPanel.jsx`).
Wraps `<Panel>` with locked `position: { top: 56, left: 16 }`, locked
`zIndex: var(--z-selection-panel)` (30), and a `max-height: calc(100vh
- 56px - 120px); overflow: hidden auto` body wrapper so tall selection
panels never run off-screen into the LayersPanel zone at the bottom.

Use `<SelectionPanel>` for every selection-driven side panel — the
ones gated on `selectedWallId`, `selectedOpening`, `selectedColumnId`,
`selectedBeamId`, `selectedRoomId`, `selectedStampId`, MEP device
selections, etc. NOT for modals (settings, BBS specs, foundations),
NOT for floating non-modal panels like LayersPanel.

**Why:** LayersPanel uses `var(--z-overlay)` (50) and was rendering
ABOVE selection panels (which had no explicit z-index → resolved to
`auto`/0). The Add-door button at the bottom of OpeningPanel got
covered. New `--z-selection-panel: 30` token sits between
`--z-panel` (10) and `--z-overlay` (50). Selection panels now win the
z-fight against LayersPanel, AND the max-height cap means they don't
visually extend into LayersPanel's footprint even on short viewports.

Panels migrated in one pass: OpeningPanel, OpeningDetailPanel,
RoomPanel, RoomDetailPanel, ColumnPanel, BeamPanel, StampPanel,
BulkWallPanel, PlumbingFixturePanel, ElectricalPointPanel, HvacPanel,
FirePanel, ElvPanel. Adding a new selection panel = use
`<SelectionPanel>` and don't pass `position` or `zIndex`.

---

## Opening-click priority (canvas hit-test fix)

Canvas opening hit-target sits inside the wall `<g>` group. The
opening uses `onMouseDown` for immediate selection feedback; the wall
uses `onClick`. `stopPropagation()` on **mousedown** does NOT prevent
the synthesized **click** event from bubbling to the wall — they're
two independent React event chains. Result: clicking an opening was
selecting it (mousedown), then `selectWall` was clearing it (click).

**Fix shipped in two layers:**
1. **Canvas opening hit-target** gets BOTH `onMouseDown` (existing,
   does the selection) AND `onClick={e => e.stopPropagation()}` (new,
   prevents the synthesized click from reaching the wall).
2. **`selectWall` defensive guard** in `store.js`: when called with
   the same wallId as the currently-selected opening's parent wall,
   `selectWall` is a no-op. Belt-and-suspenders protection against
   any future code path that calls `selectWall(parentWallId)` while
   an opening on that wall is active.

When adding a new hit-target inside a parent `<g>`, follow the same
pattern: both `onMouseDown` + `onClick` stopPropagation. Or move the
parent handler to `onMouseDown` too — pick one event for the whole
canvas hit-test layer.

---

## Feet-Inches Display Mode (2026-05-25)

Indian construction engineers think in feet-inches (`10'-6"`, `9"`) not
decimal feet. The data layer continues to store decimal feet (and
inches for sub-foot dimensions like wall thickness, beam section) —
feet-inches is display-only.

**Locked rules:**
1. **State always stores decimal feet** (or inches where it already
   does). No storage changes.
2. **Single formatter module: `src/lib/units.js`.** Owns every
   feet/inches glyph in the app. Exports `formatFeetInches`,
   `parseFeetInches`, `formatLength(ft, unit, opts?)`, `formatArea`,
   `formatVolume`, `formatCoord`, `formatInches`, `parseInches`,
   `normalizeUnitMode`, `formatQuantity(value, unitType, displayMode)`,
   `DEFAULT_PRECISION` per-entity precision map.
3. **Sub-foot rule** — `|x| < 1ft` → inches-only (`9"`, `4½"`, `0"`).
   Never `0'-9"`. 12" rollup at the precision boundary
   (`0.999 → 1'-0"`).
4. **Input behavior** — `<FeetInchesInput>` shows feet-inches when
   not focused, switches to raw decimal on focus (selects all),
   parses & commits on blur or Enter. Reverts on Escape or
   unparseable input. Storage receives decimal feet only.
   `<InchesInput>` sibling for values stored in inches.
5. **Unit preference** — three modes on `state.unit`:
   `'ft' | 'ft-in' | 'm'`. Toolbar segmented control in View &
   Settings cluster. `useUnits()` hook is the canonical access point;
   `normalizeUnitMode()` defends against bad saved state.
6. **Export parity** — PDF and Excel route quantity rendering through
   `formatQuantity()` with the user's active mode so on-screen and
   printed BOQs match. Excel uses dual-column layout: numeric
   "Quantity (decimal)" for SUM formulas + text "Quantity (display)"
   for human reading.
7. **Default precision per entity** —
   `DEFAULT_PRECISION = { wall:'1/2', opening:'1/2', height:'1',
   foundation:'1/2', staircase:'1/2', display:'1/2' }`.
8. **No locale formatting in the formatter.** ASCII apostrophe (`'`),
   straight double-quote (`"`), unicode fractions (`¼ ½ ¾`). No
   `Intl.NumberFormat`. Deterministic, PDF-stable, copy-paste-clean.

**Areas / volumes use Indian convention always:**
`'ft'` and `'ft-in'` modes both render `Sft` / `Cft`; `'m'` mode
renders `m²` / `m³`. Linear quantities (Rft, ft) switch glyph by mode.

**Verification:** `scripts/verify-units.mjs` — 66 round-trip + edge-
case assertions (format / parse / sub-foot / carry / negative /
unit-mode-switch / round-trip / null handling). Must pass alongside
the existing four verify scripts.

**Grep guards (must hold after every change):**
- `grep -rn "\.toFixed(2)} ft" src/` → 0 matches (positions /
  dimensions go through formatter)
- Position readouts in `*Panel.jsx` route through `useUnits().fmtCoord`
- Linear inputs in panels use `<FeetInchesInput>` or `<InchesInput>`
  primitive — never bare `<input type="number">` for length/depth

**Latent bug fixed during migration:** `BulkWallPanel` was writing
decimal-feet values directly into `wall.height`/`wall.thickness`
(which store inches), producing 10-inch walls when the user typed
"10". `FeetInchesInput`/`InchesInput` make the unit explicit at the
boundary, so this class of bug is now structurally prevented.

---

## Rev 2 — Joinery + Tiles + Grills + Room-Wise BOQ (2026-05-25)

New BOQ categories and centralized registries shipped on top of the
existing plaster/masonry/RCC/steel/MEP pipeline:

- **Joinery** (`src/quantities/joinery.js`) — every opening rolls into
  one of 4 subtypes: `MAIN_DOOR | INTERNAL_DOOR | WINDOW | VENTILATOR`.
  Frame perimeter Rft + shutter area Sft per subtype. Subtype lives on
  `opening.subtype`; `opening.subtypeSource ∈ EXPLICIT | HEURISTIC`
  drives the "Auto-detected" badge in `OpeningDetailPanel`. Main-door
  heuristic: first external-wall door per floor wins.
- **Tiles** (`src/quantities/tiles.js`) — per-room floor tiles
  (wastage 1.05), wall tiles via dado height map, skirting Rft for
  non-wet rooms (dado supersedes), kitchen counter Sft from
  `projectSettings.kitchenCounter`.
- **Grills** (`src/quantities/grills.js`) — window grills (Sft, gated
  by external-only filter), main-door safety grill count, staircase
  handrails (2 sides × per-flight hypotenuse + landing edges), balcony
  handrails (polygon edges where wall is external OR
  `wall.hasBalconyRailingEdge === true`).
- **Room-wise BOQ** — `getBoqLines(state, rates, { floorId, roomId,
  roomType })`. `scopeStateToRoom` / `scopeStateToRoomType` in
  `src/boq/scope.js` are PURE FILTERS (no `_roomShareFactor` injection
  on entities). Each aggregator owns its attribution policy.

### Architectural rules locked by Rev 2 (mandatory)

1. **Scope wrappers filter entities only.** Never inject synthetic
   fields on wall / room / opening shapes. Aggregators implement their
   own attribution policy:
   - `computeMasonryQuantities` — partition walls × 0.5 (HALF_PARTITION)
   - `computePlasterQuantities` — both inner faces (DUAL_FACE, correct
     under room iteration)
   - `computeTileQuantities` — INTERIOR_ONLY
   - `computeJoineryQuantities` / `computeGrillQuantities` — OWNING_ROOM
2. **Geometric room properties derive from `getRoomPolygon` edge loop.**
   `getRoomPerimeterFt` + `getLongestPolygonEdgeFt` live in
   `src/topology/rooms.js`. Never sum `room.wallIds` lengths for any
   perimeter / longest-edge / linear-feet math — splits drift those.
   (Sum of `wallArea` over `wallIds` for plaster surface area is
   different — area math is fine.)
3. **Joinery units locked.** Frame = `2*(w+h)/12` **Rft**.
   Shutter = `(w*h)/144` **Sft**. Ventilator emits area Sft (no shutter
   line).
4. **`wall.hasBalconyRailingEdge: boolean | null`** future-ready slot.
   `null` → balcony-handrail heuristic (external + no door > 4 ft).
   `true/false` → explicit override. No UI; programmatic via
   `setWallBalconyRailingEdge` or DXF import. `loadProject` injects
   `null` for absent saves.
5. **`scopeSupport: BOQ_SCOPE[]` per line.** Every BOQ line carries a
   subset of `['PROJECT','FLOOR','ROOM','ROOM_TYPE']`. Push helper in
   `boq/lines.js` auto-stamps from
   `DEFAULT_SCOPE_SUPPORT_BY_CATEGORY`; per-line override allowed
   (used for `grills_staircase_handrail` = `[PROJECT, FLOOR]`).
   `filterLinesByScope(lines, activeScope)` in `boq/lines.js` is the
   single filter — UI and exports use it; no hardcoded category lists.

### Central registries (Rev 2 additions)

- `src/constants/units.js` — `UNITS` (NOS, RFT, SFT, CFT, KG, BAG, M3,
  FT, FT2, FT3). All `unit:` fields in `boq/lines.js` use these.
- `src/constants/joinery.js` — `OPENING_SUBTYPE`,
  `OPENING_SUBTYPE_REGISTRY`, `SUBTYPE_SOURCE`,
  `VENTILATOR_MAX_*_IN`.
- `src/constants/boqCategories.js` — `BOQ_CATEGORIES`, `BOQ_LINE_IDS`
  (static), `BOQ_LINE_ID` (parametric builders), `BOQ_SCOPE`,
  `DEFAULT_SCOPE_SUPPORT_BY_CATEGORY`. **All emitters import from
  here — zero raw string IDs in `src/boq/`.**
- `src/quantities/_metaContract.js` — `buildMeta()` helper +
  `ATTRIBUTION_POLICY` enum + `isScopedState()` detector. Every
  aggregator's `_meta` carries `{ algorithm, calculationVersion,
  attributionPolicy, scoped, generatedAt, ...extras }`. New
  aggregators (joinery / tiles / grills) use it natively; existing
  ones (plaster) wrapped to match. Apply same pattern when touching
  BBS / foundations / excavation / shuttering.

### Schema additions (loadProject auto-normalizes)

- `projectSettings.tileDefaults: { dadoHeightsFt, skirtingHeightIn,
  skirtingApplyToTypes, floorTileAllowance, wallTileAllowance }`
- `projectSettings.kitchenCounter: { defaultDepthFt, defaultLengthMode }`
  (`'longest_wall' | 'half_perimeter' | 'manual'`)
- `projectSettings.grills: { windowGrillEnabled,
  windowGrillExternalOnly, mainDoorSafetyGrillEnabled,
  staircaseHandrailEnabled, staircaseHandrailHeightFt,
  balconyHandrailEnabled, balconyHandrailHeightFt }`
- `opening.subtype` (required, derived if absent on load)
  `opening.subtypeSource: 'EXPLICIT' | 'HEURISTIC'`,
  `opening.hasGrill: boolean | null`
- `wall.hasBalconyRailingEdge: boolean | null`
- `staircase.hasHandrail: boolean | null`
- `room.dadoHeightFt: number | null`
- `room.kitchenCounter: { lengthFt, depthFt } | null`
- `room.balconyHandrail: { enabled, heightFt } | null`

### Store setters (new)

- `setTileDefaults`, `setKitchenCounter`, `setGrills` — project-level
- `setOpeningSubtype`, `setOpeningGrill` — opening-level
- `setRoomDado`, `setRoomKitchenCounter`, `setRoomBalconyHandrail`
- `setStaircaseHandrail`
- `setWallBalconyRailingEdge` (programmatic only; no UI yet)

### Grep guards

- `grep -rn "_roomShareFactor" src/` — only in comment docstring; never
  injected on entities.
- `grep -n "id: '" src/boq/lines.js` — zero matches.
- `grep -n "unit: '" src/boq/lines.js` — zero matches.
- `grep -rln "scopeSupport" src/boq/` — at least `lines.js` + `scope.js`.

---

## Current Phase Status

Phase 1a–1c-4 + Phase 1.5 + Stage 0 + Phase 1.6 + Architectural Fixes 1–4 +
Phase 1.8 + Phase 1.9 + Phase 1.7 + Phase 2.0 + UI Phases 1–4 +
Collapsible BOQ sidebar + **Topology Layer (Steps 0–9)** + **MEP Phase 0
+ Plumbing + Electrical + HVAC + Fire + ELV + Clash Detection +
Load-Based Sizing** + **Phase 4 Enterprise Architecture (Phases 1–4)** +
**Phase 5 Tier-2 sweep + IDB autosave + PDF/image Underlay** +
**Phase 6 Dimension Convention (Option C) + Drawing Speed (chain draw +
rect-room atomic create + smart MEP defaults + project templates)** +
**Phase A Snap Architecture (unified resolver + per-tool policy +
priority tiers + Alt bypass + F9 toggle + per-project pitch)** +
**Phase R1 Auto Room Detection — interactive (planar face enumeration +
canonical normalization + hover-preview cache + Shift+A tool +
createRoomFromFace with provenance meta)** +
**Phase W Wall Topology Integrity (T-junction primitive + walls stable
across topological touches + explicit Split full propagation + Manual
Join tool + deleteWall junction handling + per-segment classification +
INV-W1-W10)** +
**Bug A + B fixes (virtual walls in face detection via topological-mode
graph + deleteWall room cascade with atomic purge + persistent
toast)** +
**Phase BA Building-Area Metrics (carpet via clear_internal kernel +
true built-up via angular-continuation external-loop walker +
signed-area aggregation for courtyards/disconnected blocks + scope-of-
work Carpet/Built-up rows)** +
**Phase D Face-Aware Draw Reference (inside_face default per RERA +
buffer-then-commit chain draw + closure-in-face-space ordering +
snap-overrides-mode pinned vertices + Drawing-to toolbar segmented
control + canvas mode badge)** +
**Phase RoomConverge Face-selection room tool + sub-span fix (legacy
manual wall-selection Room tool retired; room_detect relabeled "Room"
on bare R as the single click-to-create path with folded smart-MEP;
BE-FaceLookup-001 sub-span face-lookup fix; BE-DrawCorners-001 corner-
join guard)** +
**Phase BeamConnect Beam-to-beam / wall / point endpoints (4-type endpoint
union COLUMN/BEAM/WALL/POINT; resolveBeamEndpoint as the single canonical
accessor across 2D + 3D render, BBS, BOQ, validation; addBeamWithEndpoints
+ snap/beamTarget.js with column > beam > wall > point priority; detach-on-
delete with detachedFrom provenance; beam_no_support v2 + beam_circular_ref
ERROR; Phase 1 kernel `9d7ea54` + Phase 2 Canvas UI `98e02c6`; IsoView
beam-render fix 2026-06-10)**
complete on `main` (latest 2026-06-10). See **Phase BeamConnect** +
**Phase RoomConverge** + **Phase D** + **Phase BA** sections at the top of
this file for the most recent landings.

**Phase BeamConnect — Beam Endpoint Union (2026-06-10) — COMPLETE.** Verify
results at merge: `verify-beam-connections` 37/37 assertions across Sections
A–G (endpoint resolution, recursive BEAM lerp + cycle guard, WALL bearing
lerp, detach-on-delete provenance, integrity broken-refs, validation v2 +
circular-ref, targeting priority). All 35 verify scripts green;
`verify-boq` byte-identical (COLUMN/POINT path unchanged). The 3D iso viewer
beam-render bug (stale local resolver → NaN geometry for BEAM/WALL endpoints)
was fixed 2026-06-10 by routing IsoView through `resolveBeamEndpoint`.

**Phase W — Wall Topology Integrity (2026-05-27) — COMPLETE.** Verify
results at merge: `verify-wall-topology` 127/127 assertions across
9 sections (A through H.3). `verify-boq` Phase W canary green:
stacked-rooms scenario produces 10 walls (NOT 11 — old auto-split bug
eliminated), 9 nodes (8 CORNER + 1 TJUNCTION), 160 ft² flooring
(hand-computed match), parent wall expands into 2 segments correctly
classified PARTITION (long) + EXTERNAL (short). All 30 verify scripts
green including verify-snap Section A at 1500/1500 (with new
`join_walls` tool + `WALL_JUNCTION` snap target). The architectural
defect — auto-split silently destroying openings, IFC GUIDs, MEP refs
— is fully resolved. Walls now preserve identity across topological
touches; explicit Split is the only fragmentation path and propagates
all dependent data cleanly. INV-W1 through INV-W10 enforced by
`verifyIntegrity`.

**Phase R1 — Auto Room Detection, interactive (2026-05-27) —
COMPLETE.** Verify results at merge: `verify-room-detection`
59/59 assertions across Bootstrap purity grep + Section A (algorithm
correctness) + Section B (canonical normalization: lex-smallest first,
CCW, wallIds sorted) + Section C (idempotency + memo + hover cache
invalidation) + Section D (multi-floor isolation) + Section E (**BOQ
canary IDENTICAL**: rect_room-created and createRoomFromFace-created
states on the same wall topology produce byte-identical BOQ output
across 38 lines). All 29 verify scripts green including
`verify-boq`. Phase R2 (auto-suggest after wall mutation) is a
separate planning round.

**Phase A — Snap Architecture (2026-05-27) — COMPLETE.** Verify
results at merge: `verify-snap` 1520/1520 (Section A byte-equality
1400/1400 across 100 fuzz triples × 14 tools, Section F Phase B
forward-compat 23/23 across F1–F8 contract sub-assertions, Section G
deterministic tie-break 3/3 across 100 shuffled-input runs).
All 28 verify scripts green including the load-bearing `verify-boq`
canary — zero quantity drift from defaults reproducing today's
behavior. Two contract refinements landed during integration and are
documented in `src/snap/resolver.js` header + the locked-rules block
above: (a) priority `tier` field on target descriptors so GRID is a
tier-1 fallback rather than a tier-0 competitor, (b) MEP policies
extended with `'GRID'` fallback to preserve byte-identical
empty-canvas behavior.

Topology layer (commits step-0 → step-9) is the canonical read-only
spatial-relationship surface for downstream discipline engines
(structural BOQ, MEP, interiors, fabrication). See "Topology Layer"
section below.

MEP system (commits `76b193c → d46ee20`, 2026-05-18): six-discipline
enterprise architecture covering Plumbing, Electrical, HVAC, Fire, and
ELV — each with its own engines (system-graph → routing → sizing →
quantities), BOQ emitter, UI panel, canvas overlay, toolbar button, and
keyboard shortcut. Plus cross-discipline clash detection (Phase 2.5) and
pluggable sizing strategies (Phase 2.6: CATALOG, HUNTER, LOAD_BASED,
GRADIENT_DRAIN). Solar (Phase 2.3) and Rainwater + Hot Water (Phase 2.4)
are deferred — schema slots and scope.js stubs remain ready. See "MEP
System" section below.

UI rebuild (Phases 1–4, commits `3ee27a8 → bfed97a`, 2026-05-18) landed the
design-token system, 6 UI primitives, native-dialog removal, panel/toolbar/
BOQ refactor, keyboard shortcuts, canvas selection feedback, empty states,
and the 1024px desktop gate. See "UI Design System" section below.

Collapsible BOQ sidebar (commit `0394c88`, 2026-05-18): BOQ panel now
collapses to a 32px strip via Ctrl/Cmd+B or the toggle button on its left
edge. State persists in `localStorage['boq_panel_collapsed']`.

Toolbar dropdown redesign (commit `fbfcc4a`, 2026-05-18): flat 25-icon
toolbar replaced with 5 cluster dropdown buttons (Draw / Structural &
Civil / MEP / View & Settings / Project). Each cluster opens a flyout
listing labeled tools + keyboard shortcuts. Active tool highlighted at
two levels (cluster trigger + dropdown item). New `<Dropdown>`
primitive in `src/components/ui/Dropdown.jsx`. Single-source tool
registry in `src/components/toolbarConfig.js`. See "Toolbar conventions"
section below.

Door / window edit + delete (commit `f0b83d0`, 2026-05-18): doors and
windows are now first-class selectable entities. Click any opening on
the canvas → `OpeningDetailPanel` opens with W / H / offset / type
switcher / swing-or-sunshade / Delete button. New `selectedOpening`
store state + `selectOpening` / `updateOpening` actions. Existing
`OpeningPanel` per-opening list rows became clickable. Del/Backspace
shortcut deletes the selected opening. See "Architectural reminders"
below.

Plaster quantity split (commit `f5b4655`, 2026-05-19): visible "Plaster
(walls)" line replaced with two lines — "Plaster (internal walls +
columns)" (12 mm cement-sand) and "Plaster (external walls)" (15 mm
cement-sand). Internal counts partition walls on both inner faces
(per-room iteration) plus every column's perimeter × per-floor exposed
height. External counts each external wall's outer face. New
`ROOM_FACE_ACCUMULATION_V2` algorithm in
`src/quantities/plaster.js`. Closes the 25% gap vs Indian residential
reference BOQ. See "Plaster Quantities (v2)" section below.

ERP integration (replace static MATERIAL_LIBRARY + MEP catalogs + add live
rate catalog) is the next major work item; foundation for it is in place
via the canonical `getBoqLines()` pipeline and the versioned
`src/mep/catalogs/` registries.

---

## Greenfield Development (MANDATORY MINDSET)

**This is a greenfield project. No migrations needed for anything.**

Implications for every design decision:
- **No backward-compatibility shims** — break old save formats freely.
  loadProject normalizes missing fields with sensible defaults, never
  preserves "legacy" branches.
- **No `legacy_*` field names, no `version` bumps for schema additions,
  no parallel "old path / new path" code.** Pick the right structure
  and ship it.
- **No temporary patches** — every fix is the permanent enterprise-level
  solution. If a quick patch is tempting, stop and design the scalable
  version first. (Examples: per-instance BBS resolution lives in ONE
  module; node ownership uses `floorIds: string[]` from day one to
  support future vertical shafts without re-architecting.)
- **Schema changes are free.** Add a required field on an entity, drop
  a field that's been superseded — no migration scripts, no version
  gates. `loadProject` normalizes on read.
- **Design for the phases we know are coming.** DXF import (Phase 2.1),
  floor cloning, BIM export, AI auto-layout, ERP integration — every
  data model decision must support these without rework. Don't bake in
  shortcuts that block them.
- **MCP-first verification** still applies — check Context7 before
  using library APIs, since we're targeting current versions.

When tempted by a quick fix, ask: "Is this the structure I'd want if
this codebase had 50 engineers and 1000 customer projects on it?" If
no, redesign.

## MCP-First Rule (MANDATORY)
Query Context7 before writing any code that uses:
- React 19 hooks or new APIs
- Vite 8 configuration
- Zustand 5 store patterns
- jsPDF / jspdf-autotable
- SheetJS (xlsx)
Training data for these versions is outdated.

## Verification Commands

Run individually:
```
node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-boq.mjs              # single-floor BOQ checks
node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-multifloor.mjs       # multi-floor scope + topology guard
node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-topology.mjs         # topology-layer relationship checks
node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-mep.mjs              # MEP assertions across 5 disciplines + clash + sizing + Bug A physical/topological mode
node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-persistence.mjs      # IDB layer + manager.js + migration shim + chunked autosave
node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-underlay.mjs         # calibration math + state setter round-trip + asset blob storage
node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-dimension-mode.mjs   # Phase 6 — math kernel + 400-config fuzz; byte-equality seatbelt for kernel refactors
node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-rect-room.mjs        # Phase 6 — atomic rect-room create (centerline mode locked)
node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-templates.mjs        # Phase 6 — MODEL-ONLY snapshot + FK rewrite via integrity + IDB
node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-wall-topology.mjs    # Phase W + Bug B sections I/J (deleteWall room cascade + shared-wall multi-room)
node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-room-detection.mjs   # Phase R1 + Bug A Section F (virtual-wall faces) + Bug B Section G (delete-then-redraw)
node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-building-area.mjs    # Phase BA — carpet + true built-up across 13 sections incl. F1-realistic L+T-junction + dumbbell + disconnected blocks
node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-draw-reference.mjs   # Phase D — face-aware draw, 80 assertions incl. round-trip kernel, mixed snap/face chain, acute/zig-zag/closure-in-face-space
node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-beam-connections.mjs # Phase BeamConnect — 37 assertions: endpoint union resolution, recursive BEAM lerp + cycle guard, WALL bearing, detach-on-delete, integrity broken-refs, validation v2 + circular-ref, targeting priority (Section G)
```

Run all 35 in one go (POSIX shell):
```
for s in scripts/verify-*.mjs; do
  if node --experimental-loader ./scripts/resolver-hook.mjs "$s" > /tmp/v.log 2>&1; then
    echo "PASS: $s"
  else
    echo "FAIL: $s"; tail -25 /tmp/v.log
  fi
done
```

All 35 must pass green before any commit. Phase BA adds
`verify-building-area.mjs` (51 assertions across 13 sections); Phase D
adds `verify-draw-reference.mjs` (80 assertions across 14 sections
including 3 edge cases: acute-angle open chain, zig-zag alternating
reflex/convex, closure-in-face-space ordering proof); Phase BeamConnect
adds `verify-beam-connections.mjs` (37 assertions across Sections A–G). The
byte-equality
seatbelt for any change to the offset kernel is
`verify-dimension-mode` (95/95) + `verify-building-area` (51/51) —
both must stay green on every kernel refactor.

## Planned Features (do not implement yet)
- DXF import (Phase 2.1) — parse AutoCAD floor plans into walls/rooms
- Canvas ghost rendering per-floor (deferred — data wired, render not done)
- Slab BBS span (currently sqrt(area) approximation)
- Constraint/conflict detection engine (src/validation/ stub exists)

---

## Architectural Fixes (2026-05-16, commit `275472f`)

Foundational refactor applied before Phase 1.7/1.8/1.9/2.0 to keep ownership
relationships single-sourced and floor topology unambiguous.

**Fix 1 — Foundation ownership.** `column.foundationId` is removed.
`foundation.columnIds[]` and `foundation.wallIds[]` are the single source of
truth. Centralized selectors: `getFoundationForColumn(state, columnId)`,
`getFoundationForWall(state, wallId)`, `getFoundationsForWall`,
`getColumnsByFoundation(state, foundationId)`. `attachColumnToFoundation`,
`detachColumnFromFoundation`, `attachWallToFoundation`, and
`detachWallFromFoundation` mutate only the `foundations` map. The inline
auto-isolated path in `getFoundationQuantities()` filters via
`foundation.columnIds[]` union — columns absent from any foundation fall
back to inline column-type footing.

**Fix 2 — Column floor spanning.** `column.baseFloorId` + `column.topFloorId`
(default both = `currentFloorId`). New `state.getColumnHeightFt(col)` sums
floor heights from base through top + plinth on the base floor + slab
thickness on the top floor. `getColumnQuantities()` is now per-column so
multi-span columns contribute their full height. `loadProject` migration
renames legacy `column.floorId → baseFloorId` and mirrors `topFloorId`.
Action: `setColumnFloorSpan(id, baseFloorId, topFloorId)`.

**Fix 3 — Slab role / classification.** Every slab carries
`slab.classification` and `slab.role` (alias). Auto-populated on creation:
TOILET/BALCONY → `'SUNKEN'`, top floor → `'ROOF'`, intermediate → `'FLOOR'`.
`autoInitSlabs` + `addSlab(options.role?)` + `loadProject` migration all
populate it. Action: `setSlabRole(slabId, role)`. Helper `inferSlabRole(state,
floorId)` is the canonical derivation — never branch on slab type directly
for role logic.

**Fix 4 — Validation engine.** `src/validation/engine.js` + 5 rules in
`src/validation/rules/`. `runValidation(state) → { issues, byRule, byCategory,
counts }`. Issue shape `{ ruleId, severity, category, entityType, entityId,
message }`. Severities: `info | warning | error`. Rules: `floating_column`
(column with no nearby wall nodes), `slab_no_enclosure` (slab references
invalid room), `beam_no_support` **(v2 — supported = at least one endpoint
resolves to a COLUMN / BEAM / WALL; a free/unresolvable POINT end is
unsupported; no longer column-only)**, `beam_circular_ref` **(ERROR —
structural rule 6; a BEAM endpoint chain that cycles back on itself)**,
`staircase_disconnected` (fromFloorId === toFloorId when multi-floor),
`footing_no_column` (foundation with empty columnIds AND wallIds; RAFT/PILE
exempt). BOQPanel footer surfaces top 5 issues with severity color.
No hard-blocking — warnings only (except `beam_circular_ref` = ERROR).

**Selector discipline.** Required for all Phase 1.7+ code:
`getColumnsOnFloor`, `getWallsOnFloor`, `getSlabsOnFloor`, `getStampsOnFloor`,
`getRoomsOnFloor`, `getBeamsOnFloor`, `getStaircasesOnFloor`,
`getEntitiesOnFloor` (returns all keyed arrays). Never traverse
`foundations`/`columns`/`walls` inline. The selectors are the only sanctioned
way to scope entities by floor or follow a column→foundation relationship.

---

## Phase 1.8 — Foundation Types (2026-05-16, commit `1921652`)

Five foundation types with proper per-type geometry, integrated through the
canonical BOQ pipeline.

**Quantities (`src/quantities/foundations.js`).** Pure function
`computeFoundationQuantities(state) → { perFoundation, totals }` where each
entry has `{ id, type, label, columnCount, wallCount, concreteVolFt3,
pccVolFt3, plumVolFt3, excavVolFt3, shutterAreaFt2 }`. PILE entries also
carry `shaftVolFt3`, `capVolFt3`, and `pileGeometry: { pilesCount,
pileDiamIn, pileLengthFt, capLengthFt, capWidthFt, capDepthFt }` for
the split BOQ emission (see Integration note below). Geometry rules:
- **ISOLATED / COMBINED:** `footprint = L×W`; `excav = (L+2m)×(W+2m)×(D+pcc)`;
  `shutter = 2(L+W)×D`.
- **RAFT:** `footprint = geometry.areaFt2` (no margin — raft IS the footprint);
  `shutter = 4√A × D`.
- **STRIP:** attaches to `wallIds[]`; `totalLenFt = Σ getWallLength(wid)`;
  `excav = totalLenFt × (W+2m) × (D+pcc)`; `shutter = 2 × totalLenFt × D`.
- **PILE:** `shaftFt3 = pilesCount · π·(d/2)² · L`; cap = `capL×capW×capD`;
  `concreteVolFt3 = shaftFt3 + capFt3` (combined for steel/concrete-mix
  aggregators — they consume one number); BOQ emits TWO RCC lines per
  pile foundation (shaft + cap) labeled with geometry hints; `excav =
  capFootprint × (capD+pcc)` (pile shafts displace ground — not counted
  in dig volume).

`marginFt = projectSettings.excavationSettings?.workingMarginFt ?? 0.5`.

**Panel (`src/components/FoundationPanel.jsx`).** Modal opened by
`activeTool='foundations'` (toolbar `▭ Foundations` button). Type-conditional
geometry inputs; column-attachment multi-select for COMBINED; wall-attachment
multi-select for STRIP. Foundation badge appears in `ColumnPanel` when a
column is attached.

**Integration.** `boq/lines.js` emits foundation-entity RCC + PCC lines
from `computeFoundationQuantities().perFoundation`. PILE foundations emit
TWO RCC lines per entity (shaft + cap, with distinct rateKeys
`fdn_<id>_rcc_shaft` and `fdn_<id>_rcc_cap`) labeled with geometry
hints — they're separate procurement pours. All other types emit one
combined RCC line `fdn_<id>_rcc`. PCC line `fdn_<id>_pcc` is per
foundation regardless of type. `StructuralBOQSection.jsx` mirrors this
emission for the on-screen rendering and includes foundation entities
in its `hasRCC` gate so foundation-only projects (no columns/beams)
still render the Structural RCC section header. The inline
`byColumnTypeInline` path is unchanged for columns with no foundation.
`quantities/excavation.js` and `quantities/shuttering.js` consume the same
aggregator instead of the previous square-root approximations.

## Phase 1.9 — Multi-Floor UI (2026-05-16, commit `af1c34b`)

Multi-floor management UI built on Stage 0's `projectSettings.floors[]`
plumbing.

**FloorSwitcher (`src/components/FloorSwitcher.jsx`).** Horizontal pill tabs at
top of canvas, sorted by `floor.sequence`. Only renders when `floors.length >
1`. Active floor highlighted; clicking calls `setCurrentFloorId(id)`.

**FloorsManagerPanel (`src/components/FloorsManagerPanel.jsx`).** Modal opened
by `activeTool='floors'` (toolbar `▤ Floors` button). Per-floor editor for
`label`, `plinthHeightFt`, `floorHeightFt`. Per-floor slab-thickness override
stored on `floor.meta.slabThicknessIn` (consumer-side selectors still read the
project default — wire-through is a follow-up). Delete guard via
`getEntitiesOnFloor(floorId)` — disabled when any walls/rooms/stamps/columns/
beams/slabs/staircases live on the floor.

**ColumnPanel — span pickers.** When `floors.length > 1`, two dropdowns
appear (Base floor / Top floor) calling `setColumnFloorSpan`. Single-floor
projects render unchanged.

**BOQ scope (`src/boq/scope.js`, commit `6fa5fc1`).** `BOQPanel` header shows
"This floor | All floors" when multi-floor. `getBoqLines(state, rates, {
floorId })` enforces scope by passing through `scopeStateToFloor(state,
floorId)` — a state wrapper that filters every collection map and
**re-implements every aggregator** (`getMaterialQuantities`,
`getMasonryWithBeamDeduction`, `getColumnQuantities`,
`getFoundationQuantities`, `getBeamQuantities`, `getSlabQuantities`,
`getStaircaseQuantities`, `getSunshadeQuantities`, `getParapetQuantities`,
`getSteelQuantities`, `getConcreteByGrade`, `getSumpCivilQty`,
`getSepticCivilQty`, `getTotal*Area`, `classifyWallBeamFlags`,
`getDerivedWallBeams`, `getAllBeams`). Per-entity helpers like `getWallArea`
delegate to the live store (they're pure on their input id). Pure-function
quantities (`computeShuttering`, `computeExcavation`, `computePlaster`,
`computeFoundation`, `computeBBS`) auto-scope because they invoke
`state.getXxx()` via method dispatch.

**Why a wrapper, not just a line-level filter?** Store selectors are
closures bound to Zustand's live `get()`. Passing them a scoped state
object as an argument is ignored — they still read `get().walls`. The
initial naive `lines.filter(l => l.floorId === currentFloorId)` shipped
broken: every line was tagged `'F1'` because the underlying selectors
aggregated across every floor. The wrapper substitutes for `get()` by
exposing scoped collections + re-implemented selectors at method-dispatch
sites.

**Canvas ghost rendering (commit `6fa5fc1`).** Per-entity opacity styling.
Rooms / walls / stamps / room labels: ghost when `floorOf(e) !== currentFloorId`.
Columns: ghost when not in `getColumnsOnFloor(currentFloorId)` (span-aware).
Beams: explicit beams use `beam.floorId`; wall-derived beams inherit from
`walls[sourceWallId].floorId`. Ghost = `opacity: 0.15` + `pointerEvents:
'none'`. Single-floor projects auto-render at full opacity because
`floorsList.length <= 1` short-circuits `multiFloor`.

**Verification.** `scripts/verify-multifloor.mjs` builds a 2-floor project
(F1: 20×15 Living + 2 columns; F2: 10×12 Bedroom + 1 column) and asserts:
F1 flooring = 300 ft², F2 = 120 ft², All = 420 ft²; F1 masonry < All,
F2 masonry < All, F1+F2 ≈ All; per-line `floorId` tagging is correct;
`getColumnsOnFloor` / `getWallsOnFloor` / `getRoomsOnFloor` return correct
counts. All 15 multi-floor assertions pass; `verify-boq.mjs` (single-floor)
still 39/39 green.

## Phase 1.7.2 — Floor-aware node ownership (2026-05-16)

**Architectural principle (load-bearing).** *Topology is floor-scoped.
Spatial alignment across floors does not imply shared ownership. Vertical
relationships must be explicit, never inferred from shared node identity.*

Two F2 corners at the same XY as two F1 corners are **distinct node
entities** — not one shared geometric point. Vertical entities (columns
spanning floors, staircases that connect floors, future shafts) carry
their own multi-floor identifiers; nothing is inferred from spatial
collision.

**Node schema.** Every node carries `floorIds: string[]` — required,
non-empty, length 1 today, future-proof for vertical shafts / staircase
cores / DXF anchors that legitimately span floors.

**Node creators (3 sites, all in `store.js`).**
- `getOrCreateNode` fresh-node branch — stamps `floorIds: [currentFloorId]`.
- `getOrCreateNode` auto-split midpoint — inherits `floorIds: [wall.floorId]`
  from the wall being split.
- `splitWall` midpoint — inherits `floorIds: [wall.floorId]` from the
  wall, **not** `currentFloorId`. This matters for forced cross-floor
  splits invoked by importers / clone tools (`{ force: true }`).

**Snap scope.**
- `getOrCreateNode` pre-filters via `getNodeIdsByFloor(currentFloorId)` —
  `findNearbyNode` stays a pure geometry helper, never sees the floor.
- `addWall` duplicate-wall + collinear-overlap checks filter via
  `getWallIdsByFloor(currentFloorId)`. Identical wall geometry on two
  floors is the expected case for multi-storey buildings — they're not
  duplicates of each other.
- Plot polygon containment check stays floor-agnostic (site boundary is
  single, not per-floor).
- Single-floor projects (`floors.length <= 1`) take a fast path that
  returns the full nodes / walls maps — behavior byte-identical to
  pre-Phase-1.7.2.

**Floor-topology selectors (`structuralSlice.js`).**
- `getNodeIdsByFloor(floorId) → Set<nodeId>` — `node.floorIds.includes(floorId)`.
- `getWallIdsByFloor(floorId) → Set<wallId>` — `wall.floorId === floorId`.
- `getEntitiesOnFloor(floorId)` extended to include `nodes: Node[]`.

**`splitWall` defensive guard.** Cross-floor split attempts (called on a
wall whose `floorId !== currentFloorId`) are rejected: function returns
`null` and pushes an issue record to `state.validationEvents` with
`ruleId: 'cross_floor_split_attempt'`, severity `warning`, category
`topology`. The validation engine surfaces these alongside rule-emitted
issues. Programmatic callers (DXF importer / clone tools) pass
`{ force: true }` to bypass the guard — the midpoint node still inherits
`floorIds` from the wall's topology, not from `currentFloorId`.

**No `console.warn` / `console.log` anywhere in the action path.** Signal
flows through `runValidation()` → `state.validationEvents`. Store keeps
a 100-entry ring buffer.

**`loadProject` normalization.** Nodes lacking `floorIds` or carrying
empty `floorIds: []` get `['F1']` injected on load. Greenfield rule —
no migration, no inference from referencing walls. Saves from this
version onward carry `floorIds` verbatim.

**Canvas rendering.** Node circles consult `state.getNodeIdsByFloor`
to decide opacity + `pointerEvents`. Off-floor nodes render at 0.15
opacity with events disabled. Single-floor projects render all nodes
active.

## Phase 1.7.1 — Per-instance BBS + centralized resolution (2026-05-16)

Extends Phase 1.7 with per-instance reinforcement-spec assignment for columns,
explicit beams, slabs, and foundations. The fallback chain now has a single
home and the BOQ output groups by resolved spec.

**Resolution module (`src/specs/resolution.js`).** SINGLE source of truth for
the spec fallback chain. Every UI panel, every aggregator, every BOQ line
goes through one of:
- `resolveColumnReinforcementSpec(state, columnId)`
- `resolveBeamReinforcementSpec(state, beamOrId)`
- `resolveSlabReinforcementSpec(state, slabId)`
- `resolveFootingReinforcementSpec(state, { foundationId | columnTypeId })`

Output shape `{ spec, specId, specLabel, source }` where
`source ∈ INSTANCE | TYPE | CLASS | PROJECT_DEFAULT | ESTIMATE`. Resolvers
NEVER read `projectSettings.reinforcementSpecs` or `bbsDefaults` from
anywhere else. No panel reimplements the chain — panels show the resolved
badge by calling the resolver.

Fallback chains:
- **COLUMN:** instance → `columnType.reinforcementSpecId` → `bbsDefaults.COLUMN` → ESTIMATE
- **BEAM:** instance (explicit only) → `bbsDefaults.BEAM[beamClass]` → ESTIMATE  *(no global beam fallback)*
- **SLAB:** instance → `bbsDefaults.SLAB` → ESTIMATE
- **FOOTING — foundation entity:** `foundation.reinforcementSpecId` → `bbsDefaults.FOOTING` → ESTIMATE
- **FOOTING — inline (column-type-keyed):** `columnType.reinforcementSpecId` → `bbsDefaults.FOOTING` → ESTIMATE

**`bbsDefaults.BEAM` is per-class** (`{ plinth, lintel, roof }` — keyed by
`BEAM_LEVEL_REGISTRY` id). No flat `bbsDefaults.BEAM = specId` shape exists.

**Per-instance state slots.**
- `column.reinforcementSpecId` (pre-existing)
- `slab.reinforcementSpecId` (pre-existing)
- `beam.reinforcementSpecId` — slot existed, now wired via
  `setBeamReinforcementSpec(beamId, specId)` action. Explicit beams only;
  wall-derived beams have no entity to bind to and always resolve via
  CLASS → ESTIMATE.
- `foundation.reinforcementSpecId` — slot existed, now wired via
  `setFoundationReinforcementSpec(foundationId, specId)` action.

**"Apply to matching elements."** New action
`applyReinforcementSpecToMatching({ elementType, sourceEntityId, specId })`
propagates one entity's spec to all geometrically-matching peers and
returns the affected entity-id array. Match rules (geometry-only — never
floor-based, per stated design):
- COLUMN — same `columnTypeId`
- BEAM — same `beamClass` (explicit beams only)
- SLAB — same `role`/`classification` (FLOOR / ROOF / SUNKEN / STAIR_LANDING)
- FOUNDATION — same `type` (ISOLATED / COMBINED / RAFT / STRIP / PILE)

UI: every panel shows an "Apply to matching" button that uses
`window.confirm` with the affected count before propagating.

**BBS aggregator (`src/quantities/bbs.js`) — rewritten.** Per-instance
output + grouped-by-spec roll-up + exclusion sets for partial coverage:
```
{
  byColumn:  [{ columnId, resolvedSpecId, source, kg:{...} }],
  byBeam:    [{ beamId, beamClass, resolvedSpecId, source, kg:{...} }],
  byFooting: [{ foundationId|null, columnTypeId|null, count, resolvedSpecId, source, kg:{...} }],
  bySlab:    [{ slabId, resolvedSpecId, source, kg:{...} }],
  groupedBySpec: { column[], beam[], footing[], slab[] },  // { specId, source, totalKg, instanceCount, sourceEntityIds }
  bbsCoveredKg: { column, beam, footing, slab },
  excludeIds:   { columns, beams, slabs, foundations, columnTypeFootings },  // Sets
  totalKg,
}
```
Resolution is the ONLY decision point — `boq/lines.js` never branches on
spec presence, it just iterates `groupedBySpec`.

**Partial BBS coverage in `getSteelQuantities(opts)`.** The selector now
accepts `{ excludeColumnIds, excludeBeamIds, excludeSlabIds,
excludeFoundationIds, excludeColumnTypeFootingIds }` (Sets or Arrays).
Excluded entities contribute zero to the kg/m³ estimate pool. BOQ emits
both: N grouped-by-spec BBS lines + one estimate line per category
(skipped when its pool is empty). The previous "all-or-nothing"
suppression in `boq/lines.js` is gone. Same `rateKey` per category across
all spec/estimate lines so users still enter one rate per element type.

**BOQ output format.** Example after the rewrite (column category):
```
Steel – Columns — C-Test (instance override)          55.2 kg
Steel – Columns — C-ProjDefault (project default)     27.6 kg
Steel – Columns (Estimate, kg/m³)                     12.0 kg   ← only when un-BBS'd pool exists
```
Every BBS line carries `meta.{specId, specLabel, source, instanceCount,
sourceEntityIds}` for downstream PDF/Excel/ERP.

**Canvas beam selection (Phase 1.7+ UI).** Explicit beams are now
selectable on the canvas — a transparent 14px hit-target stroke triggers
`selectBeam(beamId)`. Wall-derived beams stay unselectable by design (no
entity to bind a spec to). `BeamPanel.jsx` mounts on `selectedBeamId` and
shows class/section readout + spec dropdown + resolution badge +
Apply-to-matching button. Selected explicit beams render at 5px stroke
instead of 3px.

## Phase 1.7 — Professional Steel BBS (2026-05-16, commit `1096667`)

Bar Bending Schedule replaces the kg/m³ steel estimate for any element that
carries a `reinforcementSpecId`.

**Specs (`src/specs/reinforcementSpecs.js`).** Constants:
- `STEEL_UNIT_WEIGHT_KG_PER_M` for 8/10/12/16/20/25/32 mm bars.
- `DEFAULT_COVER_MM_BY_ELEMENT` (FOOTING 40, COLUMN 25, BEAM 25, SLAB 20).
- `DEFAULT_HOOK_LENGTH_FT = 0.5`, `DEFAULT_LAP_LENGTH_MULTIPLIER = 50`.
- `REINFORCEMENT_SPEC_PRESETS` for COLUMN/BEAM/FOOTING/SLAB.

Compute helpers (pure): `computeColumnBBS(spec, columnHeightFt,
columnTypeDef)`, `computeBeamBBS(spec, lengthFt, widthIn, depthIn)`,
`computeFootingBBS(spec, lengthFt, widthFt)`, `computeSlabBBS(spec, areaFt2,
spanFt, widthFt)`. Each returns `{ longitudinalKg, stirrupKg, totalKg }` or
similar per-element shape.

**Aggregator (`src/quantities/bbs.js`).** `computeBBSQuantities(state) → {
byColumn[], byBeamLevel{}, byFooting[], bySlab[], totalKg }`. Resolution per
entity: `entity.reinforcementSpecId → projectSettings.bbsDefaults[elementType]
→ null` (null = skip; kg/m³ estimate covers the entity).

**Panel (`src/components/BBSSpecPanel.jsx`).** Modal opened by
`activeTool='bbs'` (toolbar `∥ BBS` button). Spec CRUD + preset import +
per-element-type project defaults via `setProjectSettings({ bbsDefaults: ...
})`.

**Element panels.** `ColumnPanel` and `SlabPanel` each show a spec dropdown
filtered to the element type, calling `setColumnReinforcementSpec` or
`setSlabReinforcementSpec` (null clears → estimate fallback).

**BOQ labels.** `boq/lines.js` emits each steel line as `Steel – Footings
(BBS)` when BBS data exists for that category, else `Steel – Footings
(Est.)`. Both labels share the same `rateKey` so rate input doesn't fork.
Estimate is suppressed for a category when BBS produces a non-zero kg total
(no double-counting). Per-beam overrides (`byBeam[]`) are not implemented —
beam BBS is per-level only.

## Phase 2.0 — Professional Deliverables (2026-05-16, commits `991f1d0`, `2f331fb`)

PDF + Excel exports, plus multi-project localStorage with debounced
autosave.

**PDF (`src/export/pdf.js`).** `exportBoqPdf(state, rates, { projectName,
preparedBy, unitSystem })` triggers download of `boq-${projectName}-${date}.pdf`.
Built on `jsPDF` + `jspdf-autotable`. Cover page → per-category tables →
summary page. Footer disclaimer "Preliminary estimate — for budgeting only"
+ page number via `didDrawPage` hook. Uses ASCII `Rs. ` prefix because the
default helvetica font lacks the `U+20B9` INR glyph.

**Excel (`src/export/excel.js`).** `exportBoqExcel(state, rates, { projectName
})` downloads `boq-${projectName}-${date}.xlsx`. Built on SheetJS (`xlsx`).
Sheets: Summary, one per non-empty category, Raw Data. Amount cells are
**live formulas** (`=C*D`, or `=(C/1000)*D` for `isPer1000` brick rows) so
users can adjust rates in-sheet.

**Project manager (`src/projects/manager.js`).** localStorage-backed under key
`boq_projects` with current-id under `boq_current_project_id`. API:
`listProjects` / `createProject(name, type)` / `openProject(id)` /
`saveCurrent(id, data)` / `renameProject` / `deleteProject` /
`getCurrentProjectId` / `setCurrentProjectId` / `subscribe(fn)`. Quota
overflow returns `false` from `saveCurrent`. **Critical:** `listProjects()`
and `getCurrentProjectId()` memoize at module scope; `notify()` invalidates
caches before fanning out — required because `ProjectsPanel` uses
`useSyncExternalStore` and React infinite-loops if `getSnapshot()` returns a
new reference each call.

**Autosave (`src/projects/autosave.js`).** `installAutosave(store,
getProjectId)` returns an uninstaller. Subscribes to the Zustand store and
debounces persistence writes by 30 s via `setTimeout`. Flushes on
`beforeunload`. Snapshot format `version: 7` with all entity maps +
`projectSettings`.

**ProjectsPanel (`src/components/ProjectsPanel.jsx`).** Modal opened by
`activeTool='projects'` OR forced open on mount when `getCurrentProjectId()`
is null (gate ensures fresh installs land on the picker). Recent-5 list +
Open/Rename/Delete + "+ New project" with type dropdown
(Residential/Commercial/Industrial).

**Toolbar.** New `📁 Projects` opens the picker; `💾 Save` persists to the
current project; legacy `⇩ JSON` / `⇪ JSON` retained for file portability.

**BOQPanel export buttons.** CSV (existing) + 📄 PDF + 📊 Excel side-by-side
under the cost total.

**New dependencies.** `jspdf ^3`, `jspdf-autotable ^5`, `xlsx ^0.18`.

---

## Stage 0 — foundational refactor (2026-05-15/16)

**UUID migration.** `uid()` returns `crypto.randomUUID()`. Removes ID-collision risk after `loadProject` (the old `nextId` counter was never reset).

**T1 — floor-aware data model.** `projectSettings.floors[]` array (single `'F1'` default that mirrors legacy `heights{}`). `currentFloorId` UI state. Every per-floor entity (walls, rooms, stamps, columns, beams, slabs, staircases, foundations) carries `floorId`, `classification: null` (Phase 1.7+ override slot), `meta: null` (forward-compat envelope). Staircases additionally have `fromFloorId` and `toFloorId`. Selectors continue iterating full maps — Phase 1.9 will add floor-scope filters.

**T2 — material system registries.** `src/specs/masonrySystems.js` groups `MATERIAL_LIBRARY` units by construction system (`CLAY_BRICK`, `AAC_BLOCK_THIN`, `CLC_BLOCK_THIN`, `CONCRETE_BLOCK`). `src/specs/plasterSystems.js` defines `CEMENT_SAND_INTERNAL/EXTERNAL/CEILING`, `GYPSUM`, `POP`. `projectSettings.defaultPlasterSystemId` + per-room `room.plasterSystemId` override. Resolution helper `resolveRoomPlasterSystem(room, projectSettings)`.

**T3 — foundation entity slot.** New `foundations:{}` state map; entity shape `{id, type ('ISOLATED'|'COMBINED'|'RAFT'|'STRIP'|'PILE'), columnIds[], wallIds[], geometry, grade, pccDepthFt, plumDepthFt, floorId, label, meta}`. `column.foundationId` nullable pointer. New selector `getFoundationQuantities() → {byFoundation, byColumnTypeInline}`. `getFootingQuantities()` retained as thin wrapper returning the inline subset. Behavior identical when `foundations:{}` is empty (default).

**T4 — canonical `getBoqLines` aggregator.** `src/boq/lines.js` exports `getBoqLines(state, rates) → BoqLine[]`. Stable schema `{id, category, label, qty, unit, rateKey, isPer1000?, cost, formulaId, sourceEntityIds, floorId, meta}`. Categories: `finishes | masonry | rcc | civil | shuttering | excavation | concreteMix | steel | plaster | plumConcrete | staircase`. BOQPanel cost-total + CSV export both consume this; Phase 2.0 PDF / Excel / ERP target this single source. Helpers `groupBoqLinesByCategory` and `totalBoqCost` also exported.

**T5 — COLUMN_SHAPES extensions.** `getColumnPerimeterFt` (used by shuttering), `getColumnBarLayoutZones` (Phase 1.7 BBS stub), `getColumnStirrupLengthFt(ct, coverIn?)` (Phase 1.7 BBS stub). Adding a new column shape still means one entry in `COLUMN_SHAPES`.

## Phase 1.6 — complete basic BOQ (2026-05-16)

**1.6a Shuttering** — `src/quantities/shuttering.js`, `src/components/boq/ShutteringSection.jsx`. Per-column-type, per-beam-level, per-footing, slab, staircase surface areas. Formulas: column = perimeter × height (4 sides); beam = length × (width + 2·depth)/12 (bottom + 2 sides); footing = perimeter × depth (4 sides); slab = bottom area + external perimeter × thickness; staircase ≈ totalRcc / waistSlab.

**1.6b Excavation** — `src/quantities/excavation.js`, `src/components/boq/ExcavationSection.jsx`. Three layers: `bulk` = building footprint × bulk depth (default plinth); `perFoundation` = (pitDepth − bulkDepth) × envelope-with-margin (only counts excess below bulk); `civilStamps` = sump/septic with working margin. `projectSettings.excavationSettings.workingMarginFt` (default 0.5 ft) + `bulkDepthFt` overrides.

**1.6c AAC/CLC system regrouping** — wall material picker in `OpeningPanel.jsx` uses `<optgroup>` from `MASONRY_SYSTEMS`.

**1.6d Dog-legged staircase** — `StaircasePanel.jsx` shows From/To floor pickers when `floors.length > 1`, plus derived metric readout (total steps, total rise, total run). Formula in `getStaircaseQuantities` verified correct (waist slab spans hypotenuse, `landingCount = flightCount` gives mid-landing + top for `flightCount=2`).

**1.6e Plum concrete** — `projectSettings.foundationDefaults.plumDepthFt` (default 0). Foundation selector emits `plumVolFt3` per inline footing using this default; foundation entities use their own `plumDepthFt`. `src/components/boq/PlumConcreteRow.jsx` sums total. Set via `setFoundationDefaults`.

**1.6f Gypsum/POP/cement-sand plaster** — `src/quantities/plaster.js` groups rooms by their resolved plaster system; per-system totals split into walls + ceiling, then materials (cement+sand for cement-sand, bag count for gypsum/POP). `src/components/boq/PlasterSection.jsx` renders one block per active system. RoomDetailPanel exposes per-room override; ProjectSettingsPanel exposes the project default.

## Verification

`scripts/verify-boq.mjs` runs the store outside React, builds a deterministic 2-room sample project, then asserts BOQ invariants (entity shapes, selector outputs, foundation backward-compat, `getBoqLines` line count, UUID format). Run via `node --import "..." scripts/verify-boq.mjs` (loader hook in `scripts/resolver-hook.mjs` patches extension-less ESM specifiers for plain-Node execution).

---

## Phase 1 — What was built

### Phase 1a: Room finish flags + presets
- `finishes` object on every room: `{ flooring, wallPlaster, ceilingPlaster, paint, waterproofing, roofing }` — all booleans
- `roomPresets.js` — `ROOM_PRESETS` map: each type has a default finishes preset + display label
- `getPresetFinishes(type)` — returns preset for a type; falls back to `ALL_FINISHES` (all true) for OTHER
- `setRoomFinishes(roomId, partialFinishes)` — merges partial update into room.finishes
- `setRoomType(roomId, type)` — resets finishes to type preset
- `loadProject()` migrates v1/v2 rooms (no finishes) by applying the type preset

### Phase 1b: Volumetric civil stamps + BOQ finish selectors
**Stamps:**
- `stamps` map in store: `{ id, type, x, y, w, h, depth?, name? }`
- Civil types: `sump` (72×60×72in), `overhead_tank` (60×60×48in), `septic_tank` (96×72×60in) — depth in inches
- Non-civil: `stairs` (48×96in), `lift` (60×60in) — no depth
- `addStamp(type, x, y)` — places stamp at cursor with type defaults
- `resizeStamp(stampId, wFt, hFt)` — wFt/hFt in feet, stored as inches
- `updateStamp(stampId, fields)` — generic partial update (used for depth/name edits)
- `deleteStamp(stampId)`, `selectStamp(stampId)`
- `loadProject()` migrates v1–v3 stamps: injects depth/name defaults for civil types if missing
- `StampPanel.jsx` — selected stamp panel: resize + depth input for civil types

**Finish-gated BOQ selectors (all use `getValidRoomIds()` filter):**
- `getTotalFlooringArea()` — rooms with `finishes.flooring`
- `getTotalCeilingPlasterArea()` — rooms with `finishes.ceilingPlaster`
- `getTotalWaterproofingArea()` — rooms with `finishes.waterproofing`
- `getTotalRoofingArea()` — rooms with `finishes.roofing`
- `getTotalExcavationVolumeFt3()` — sump + septic_tank stamps, `w×h×depth / 1728`
- `getStampsByType(type)` — returns array of stamps filtered by type

**Helper:**
- `sumRoomAreas(predicate)` — generic: sum `getRoomArea` over valid rooms where predicate is true. Used by all finish-gated selectors to avoid duplicating filter+reduce.

### Phase 1c-1: Civil material formulas + Paint walls/ceiling split
**Internal helper (module-level function, not a selector):**
- `getStampDimensionsFt(stamp)` — returns `{ wFt, hFt, dFt, perimeterFt, footprintFt2 }`. Used by both civil qty selectors to avoid duplicating inch→ft conversion.

**Civil quantity selectors (both return plain objects):**
- `getSumpCivilQty()` → `{ excavFt3, brickFt3, rccBottomFt3, rccTopFt3, plasterFt2 }` summed over all sump stamps
  - Brickwork: perimeter × depth × 0.75 ft (9" walls)
  - RCC bottom + top slabs: footprint × 0.5 ft each (6" slabs) — split intentionally for future rate/spec divergence
  - Plaster: perimeter × depth + footprint (4 inner walls + floor)
  - Waterproofing = plasterFt2 (approximation — see note below)
- `getSepticCivilQty()` → same shape
  - Adds 1 internal partition wall spanning `min(wFt, hFt)` (shorter footprint axis = standard 2-chamber design)
  - Brickwork: (perimeter + partition) × depth × 0.75
  - Plaster: (perimeter + partition) × depth + footprint
- OHT: count-only, no material formulas (Phase 1.5+)
- Known approximation: `w`/`h` treated as outer dimensions (inner clear dims are slightly smaller due to 9" walls). Acceptable for schematic BOQ.
- Known approximation: waterproofing assumed = all internal plastered faces. Real systems vary (floor only, upturn, external membrane, full tank). Revisit Phase 1.5+ when material spec inputs exist.

**Paint split:**
- `getTotalPaintWallsArea()` — sum of `getRoomWallArea(id)` for paint-flagged valid rooms
- `getTotalPaintCeilingArea()` — sum of `getRoomArea(id)` for paint-flagged valid rooms (floor area = ceiling)
- `getTotalPaintArea()` — kept as derived sum of above two (backward compat)
- Shared wall between two painted rooms is counted twice (both faces painted) — correct behaviour

**BOQPanel:**
- Paint section: two rows — `Paint (walls)` and `Paint (ceiling)`. Combined row removed.
- Excavation section renamed to **Civil Works** with per-type `StampGroup` sub-rows (6 lines each: excavation, brickwork, RCC bottom, RCC top, plaster, waterproofing). OHT shows as count. Total excavation row at bottom.

### Phase 1c-2: Rate inputs + BOQ CSV export + layout fix

**Rate inputs (ephemeral — React `useState` only, intentional):**
- Each priceable line gets a `<input type="number" step="0.01">` rate field. Line count is dynamic: 7 base finish lines + per-material masonry lines (varies with active material types) + structural RCC/steel/concrete lines + civil lines.
- Rates live in BOQPanel component state (`useState`) — reset on refresh, not persisted, not in store.
  This is intentional scaffolding; will be replaced by ERP product-catalog dropdown in a future phase.
- Bricks: rate is ₹/1000 bricks; cost = `(qty / 1000) × rate` (special case)
- All other lines: cost = `qty × rate`
- Total cost row always rendered (shows "—" when all rates empty)
- Disclaimer: "Preview pricing — for estimation only. Final rates from ERP product catalog."

**Helpers (module-level in BOQPanel.jsx — single source of truth):**
- `getPriceableLines(rates, quantities)` → array of line objects for main section
- `getCivilLinesForStamp(stampType, stampQty, rates)` → array of line objects for each civil stamp type
- Both helpers are consumed by the render loop, the total cost computation, AND the CSV export — no duplication.
- RCC bottom + top slabs merged at UI/rate layer (single `rcc` rate key) while data layer keeps them split for future spec divergence.

**CSV export:**
- "Export BOQ (CSV)" button → downloads `boq-export-YYYY-MM-DD.csv`
- Columns: Item | Quantity | Unit | Rate (₹) | Cost (₹)
- All 13 priceable lines exported including zero-qty rows (stable structure for procurement).
- Vanilla `Blob + <a>` download — no library.

**Layout fix:**
- BOQ panel grew to 380px minWidth and its `bottom: 16` anchor caused it to cover StampPanel,
  OpeningPanel, RoomPanel, BulkWallPanel (all were `top: 56, right: 16`).
- Fix: moved all four context panels from `right: 16` → `left: 16`.
- Layout is now: left = editing context (mutually exclusive), right = BOQ, canvas in middle.
- Canvas working area: ~694px at 1366px wide, ~1248px at 1920px wide.

**Context panels (left side, mutually exclusive):**
- `RoomPanel.jsx` — shown when `selectedRoomId` is set (select tool). Room name, type, finish flag toggles.
- `RoomDetailPanel.jsx` — shown when a room is selected; displays type selector, all six finish flags, rename/delete. (Acts as the detailed edit surface; RoomPanel may be simpler summary.)
- `OpeningPanel.jsx` — shown when `selectedWallId` is set. Wall thickness, material, openings list, beam flags, sunshade toggle.
- `StampPanel.jsx` — shown when `selectedStampId` is set. Resize (w/h in ft), depth for civil types, name field.
- `BulkWallPanel.jsx` — shown when `selectedWallIds` (plural) has items. Batch-edit height, thickness, material, and plot/virtual flags across all selected walls simultaneously.
- `ColumnPanel.jsx`, `StaircasePanel.jsx` — Phase 1.5; see below.

### Phase 1c-4: Formula transparency for BOQ

**New file `src/formulas.js`:**
- 17 exported pure functions: `explainWallArea`, `explainFlooring`, `explainPlasterWalls`, `explainPlasterCeiling`, `explainPaintWalls`, `explainPaintCeiling`, `explainWaterproofing`, `explainRoofing`, `explainUnits`, `explainCement`, `explainSand`, `explainAdhesive`, `explainCivilExcavation`, `explainCivilBrickwork`, `explainCivilRCC`, `explainCivilPlaster`, `explainCivilWaterproofing`
- Each takes `state = { walls, nodes, rooms, stamps, getWallArea, getValidRoomIds, getRoomArea, getRoomWallArea }` plus optional `matKey` or `stampType`
- Returns `{ title, steps: [{ label, value, bold? }], note? }` — consumed by FormulaPopover
- Internal helpers: `wallLengthFt`, `wallOpeningAreaFt2`, `matVolumes` (unrounded intermediates to match store), `roomAreaSteps`, `civilStamps`
- Intermediate computations are NOT rounded before `Math.ceil`/`Math.round` final step — avoids ±1 discrepancy vs store values
- Notes document hardcoded constants (mortar ratio, 5% wastage) and deferred behaviors (plaster walls ungated, waterproofing approximation)

**BOQPanel additions:**
- `getFormulaData(id, state)` dispatcher — module-level, maps popover IDs to formula functions
- `InfoIcon` component — ⓘ button with `data-info-btn=""` attribute (prevents close-on-mousedown race)
- `FormulaPopover` component — `position: fixed` (escapes scroll container), closes on outside click or Escape
- `infoId`/`openId`/`onInfoClick` props added to `Row`, `PricedRow`, `PricedSubRow`
- ⓘ icon placed in label cell (col 1) — avoids overflow in 68px qty column
- Civil popover IDs: `sump_{rateKey}` / `septic_{rateKey}` (not the shared rate key, which can't be unique per stamp type)
- matKey parsing for popover IDs: strip `mat_`, `lastIndexOf('_')` splits matKey from suffix (handles multi-underscore keys)
- Popover closes on BOQPanel scroll (`onScroll` handler on outer div)
- 5 new store subscriptions: `nodes`, `getWallArea`, `getValidRoomIds`, `getRoomArea`, `getRoomWallArea`

### Phase 1c-3: Per-wall material types with bonding-aware BOQ

**Data model:**
- `wall.materialKey` — string key into MATERIAL_LIBRARY, default `'IS_MODULAR_BRICK'`
- Set on `addWall` creation; propagated through `splitWall` (both segments inherit parent's key)
- `setWallMaterial(wallId, key)` — action to change a wall's material; validates key against MATERIAL_LIBRARY
- `loadProject` migration: `{ materialKey: 'IS_MODULAR_BRICK', ...wall }` (default-first, saved value wins)

**Material library (`src/materials.js`):**
- `BONDING` enum — keys: `CEMENT_SAND`, `THIN_BED`; values: `'CEMENT_SAND_MORTAR'`, `'THIN_BED_ADHESIVE'`. Always compare with keys: `mat.bondingType === BONDING.CEMENT_SAND`.
- 7 types: `IS_MODULAR_BRICK`, `RED_CLAY_BRICK`, `FLY_ASH_BRICK` (brick types, CEMENT_SAND);
  `AAC_BLOCK`, `CLC_BLOCK` (thin-bed blocks); `CONCRETE_SOLID_BLOCK`, `CONCRETE_HOLLOW_BLOCK` (CEMENT_SAND blocks)
- Brick types: `bricksPerFt3` field; block types: `blocksPerFt3` field
  — consuming code: `mat.bricksPerFt3 ?? mat.blocksPerFt3`
- CEMENT_SAND fields: `mortarVolPerFt3Wall`, `cementBagsPerFt3Mortar`, `sandFt3PerFt3Mortar`
- THIN_BED fields: `adhesiveKgPerFt2`, `adhesiveBagKg` (40 kg bags)
  — AAC: 0.28 kg/ft²; CLC: 0.23 kg/ft² (from manufacturer specs)
- Intentional scaffolding: static constant until ERP product catalog fetch replaces it.
  Consumers (getMaterialQuantities, OpeningPanel, BOQPanel) stay the same — only the import source changes.

**Store selector:**
- `getMaterialQuantities()` — aggregates walls by `materialKey`; returns `{ [matKey]: { volFt3, faceAreaFt2, unitCount, cementBags?, sandFt3?, adhesiveKg?, adhesiveBags? } }` (only keys with >0 volume present)
- 5% wastage applied to unitCount
- Replaces `getTotalBricks()` entirely

**OpeningPanel:**
- Material `<select>` dropdown below Thickness field, lists all MATERIAL_LIBRARY entries
- Triggers `setWallMaterial` on change; shows current `wall.materialKey` as selected option
- *(Phase 1.5 additions)* Three beam flag checkboxes (Plinth/Lintel/Roof) with null→true→false→null cycling and "auto (external/partition)" badge when null. `hasSunshade` checkbox on window-type openings.

**BOQPanel:**
- Masonry section (between Flooring and Plaster rows): one sub-group per active material type
  — CEMENT_SAND: Bricks/Blocks, Cement (bags), Sand (ft³)
  — THIN_BED: Blocks, Adhesive (bags)
- Rate keys: `mat_{matKey}_unit`, `mat_{matKey}_cement`, `mat_{matKey}_sand`, `mat_{matKey}_adhesive`
- Bricks rate: ₹/1000 (isPer1000=true); blocks rate: ₹/block
- `buildMaterialRateKeys()` — generates all material rate keys at init time
- `buildMaterialLines(matQty, rates)` — flat line list for cost totals + CSV
- CSV export: Flooring → material lines → Plaster/Paint/… → Civil

---

## UI Design System (Phases UI-1 through UI-4, 2026-05-18)

Aesthetic: **Linear / Notion / Stripe Dashboard.** Restrained, professional,
desktop-only (1024px+). No gradients, no glassmorphism, no spring physics.
All animations 100-150ms with `ease-out`. One sanctioned infinite animation
(canvas empty-state arrow bob, 2s) — do not add others.

### Design tokens (`src/design/tokens.css`)

ALL color / spacing / radius / shadow / typography / z-index / motion values
in the app go through CSS variables defined here. **Component code must
never use raw hex literals or px values for these concerns** — only
`var(--color-...)` / `var(--space-N)` / `var(--text-N)` / `var(--radius-N)`
/ `var(--shadow-...)` / `var(--z-...)` / `var(--motion-...)` references.

Variables (exhaustive — do not invent new ones):
- Color neutrals: `--color-bg / -bg-subtle / -bg-muted / -bg-hover /
  -surface / -surface-raised / -border / -border-strong / -border-focus /
  -text / -text-secondary / -text-muted / -text-disabled / -text-inverse`
- Color primary (indigo `#5e6ad2`): `--color-primary / -primary-hover /
  -primary-active / -primary-bg / -primary-text`
- Color semantic: `--color-success / -success-hover / -success-bg /
  -success-border` (same pattern for `warning`, `error`)
- Spacing (4px scale): `--space-1` (4), `-2` (8), `-3` (12), `-4` (16),
  `-5` (20), `-6` (24), `-8` (32), `-12` (48)
- Radius: `--radius-sm` (4), `-md` (8), `-lg` (12), `-full`
- Shadow: `--shadow-sm / -md / -lg / -focus`
- Typography: `--font-sans` (Inter via Google Fonts), `--font-mono`;
  `--text-xs` (11), `-sm` (12), `-base` (13), `-md` (14), `-lg` (16),
  `-xl` (20), `-2xl` (24); `--weight-regular / -medium / -semibold / -bold`
- Z-index: `--z-base` (1), `-panel` (10), `-overlay` (50), `-modal` (100),
  `-dialog` (200), `-toast` (300)
- Motion: `--motion-fast` (100ms), `--motion-normal` (150ms),
  `--ease-out`, `--ease-in-out`

`body` sets `font-variant-numeric: tabular-nums` globally — all numerical
columns line up by digit place without extra CSS. Opt out with the
`.proportional-nums` utility class on headings if needed.

`@media (prefers-reduced-motion: reduce)` is honored globally in
`ui.css` — all transitions collapse to 0.01ms.

### UI primitives (`src/components/ui/`)

Six primitives, all styled via `ui.css` class names (NOT inline styles):

- **`Button.jsx`** — `<Button variant="primary|secondary|danger|ghost"
  size="sm|md" disabled onClick title>`. Active scale(0.97) on press.
  Focus-visible ring via `--shadow-focus`. Hover backgrounds per variant.
- **`Panel.jsx`** — side-panel wrapper.
  `<Panel title onClose width position={{ top/left/right/bottom }} footer>`.
  Built-in fade-in + 4px translateY (150ms). Optional `×` close button
  driven by `onClose` presence.
- **`Modal.jsx`** — centered overlay.
  `<Modal open onClose title width footer>`. Backdrop click + ESC close,
  focus trap cycling Tab/Shift-Tab through focusable descendants, restores
  focus to previously-focused element on unmount. Body fade + 4px slide;
  backdrop opacity-only fade.
- **`Field.jsx`** — `<Field label hint error inline required>...input...</Field>`.
  Wraps native `<input>` / `<select>` / `<textarea>`. Field-input styling
  comes from `.ui-field input/select/textarea` selectors — wrap and forget.
- **`Dialog.jsx`** — imperative replacement for `window.alert/confirm/prompt`.
  - API: `await dialog.alert(message, opts)` / `dialog.confirm(message, opts)`
    / `dialog.prompt(message, opts)` (returns `void | boolean | string|null`).
  - `opts`: `{ title?, confirmLabel?, cancelLabel?, variant?: 'default'|'danger',
    defaultValue? }`.
  - Mounted once in `App.jsx` via `<DialogHost />`. Falls back to native if
    host absent (development safety).
- **`Toast.jsx`** — imperative top-right toast.
  - API: `toast.success / .info / .warning / .error / .action(message, opts)`.
  - `toast.action(msg, { label, onClick, duration? })` is the "Deleted X.
    [Undo]" affordance.
  - Mounted once via `<ToastHost />`. Default duration 3000ms; pass
    `duration: null/0` for sticky.
  - Pending queue: toasts emitted before host mounts surface on mount.

### Imperative-API rule

**No native `window.alert / .confirm / .prompt` calls allowed in component
code.** The three remaining matches in `Dialog.jsx` are the host-absent
fallback path — leave them alone. Any new dialog needs `dialog.alert / .confirm
/ .prompt`. Grep guard: `grep -rn "window\.\(alert\|confirm\|prompt\)" src/`
should match only `src/components/ui/Dialog.jsx`.

### Panel patterns (mandatory for new panels)

- **Side panel** (selection-driven, top-left): wrap in `<Panel>` with
  `position={{ top: 56, left: 16 }}`, `width` between 240 and 280, and
  `onClose` that clears whichever selection ID the panel reads.
- **Modal panel** (configuration, tool-driven): wrap in `<Modal open={...}
  onClose={...} title={...} width={...}>`. Width: 480 for simple modals,
  520-560 for dense ones. `open` predicate uses the existing
  `activeTool === 'xxx'` guard. NEVER hand-roll backdrop / close-button /
  focus-trap scaffolding — that's Modal's job.
- **Floating non-modal** (LayersPanel-style): `<Panel>` without `onClose`.

### BOQ collapsible sidebar

The BOQ panel can collapse to a 32px-wide vertical strip so the canvas
reclaims full viewport width. Implementation:

- **State**: `collapsed` (boolean) lives in `BOQPanel.jsx` local component
  state, seeded from `localStorage['boq_panel_collapsed']` (`'0'` | `'1'`).
  Every change is written back via a small `writeCollapsed` helper that
  swallows quota / sandbox errors with try/catch.
- **Toggle paths**:
  - Click the chevron button on the left edge of the BOQ panel — direct
    setState.
  - `Ctrl/Cmd+B` from `useKeyboardShortcuts.js` dispatches
    `window.dispatchEvent(new CustomEvent('boq:toggle'))`; BOQPanel
    listens once via `useEffect` and flips state on event.
  - This decoupling means the keyboard hook never imports the BOQ panel,
    and the BOQ panel doesn't need to know about the keyboard hook —
    the window event is the contract.
- **Chevron direction**: `ChevronLeft` when expanded, `ChevronRight` when
  collapsed (matches the explicit spec from the original task; do not
  flip without re-asking the user).
- **CSS**: `.boq-panel` carries the width transition; `.boq-panel--collapsed`
  is the modifier. `.boq-collapse-toggle` is absolutely positioned in the
  top-left of the expanded panel (22px ghost-style button) and flows
  inline in the collapsed strip. `.boq-collapsed-label` uses
  `writing-mode: vertical-rl` + `rotate(180deg)` for the bottom-up
  "BOQ SUMMARY" wordmark. `.boq-panel-header` carries `padding-left:28px`
  so the title doesn't sit under the absolute toggle button.
- **Width transition**: 150ms ease-out on `min-width`, `width`, `padding`.
  Canvas auto-reflows because BOQ is absolutely positioned over the
  canvas — Canvas.jsx is untouched.

### BOQ visual contract (`src/components/boq/boq.css`)

- Row grid is `1fr 76px 104px 90px` — item / qty / rate / cost. Every row
  primitive in `BoqRow.jsx` and every section's container must use this
  grid to keep columns aligned across the panel.
- Rate input is a composed `.boq-rate-input` div with a `₹` prefix span +
  bare input. For `isPer1000` rates, append `--per1000` modifier (CSS adds
  the `/1000` suffix). Never render a bare `<input>` for rates.
- Row striping comes from `.boq-group .boq-row:nth-of-type(even)` —
  scoped to a wrapping `.boq-group` so it doesn't bleed across sections.
  Each section component renders its rows inside a `<div class="boq-group">`.
- Section headers use `<div class="boq-section-header">` with a `.boq-section-title`
  span + flex-grow `.boq-section-rule` divider line.
- Total: `.boq-total-row` (muted bg, bordered, 16/20px scale, semibold/bold).
- Validation footer: `.boq-validation-footer` (or `--error` variant). Each
  issue is a `<button class="boq-validation-issue">` calling
  `selectWall/selectRoom/selectColumn/selectBeam/selectStamp` based on
  `issue.entityType` + `entityId`. Unselectable issues carry `data-no-target=""`.

### BOQ line click → canvas selection

`BoqRow` / `BoqSubRow` accept optional `onSelectEntity(line)` prop. When a
line carries non-empty `line.sourceEntityIds[]`, its label gets class
`.boq-row-label--clickable` (cursor pointer + hover color shift). Click
dispatches the matching `selectX` action via the first id. `BOQPanel`
defines the handler centrally and threads it to all section components.
**Sections remain purely presentational** — they accept and forward
`onSelectEntity`, never call selectors themselves.

For new BOQ lines to be clickable, the emitter in `src/boq/lines.js` must
populate `sourceEntityIds`. Currently populated by BBS grouped-by-spec
steel lines; other emitters set `[]` and stay non-clickable.

### Toolbar conventions (`Toolbar.jsx` + `Toolbar.css` + `toolbarConfig.js`)

**Pattern shipped 2026-05-18 (commit `fbfcc4a`):** Replaces the previous
flat 25-icon-only row. The toolbar is now 5 cluster dropdown buttons:
**Draw** | **Structural & Civil** | **MEP** | **View & Settings** | **Project**.

- Click a cluster trigger → flyout opens beneath, anchored to its left
  edge. Items are rendered as labeled rows with the keyboard shortcut
  shown on the right side of each row.
- Active-tool feedback at **TWO levels**: the cluster button that
  contains the active tool gets `variant="primary"` (indigo tint); the
  matching item inside the open flyout gets bold + `--color-primary-bg`
  background.
- Toolbar logic is driven by **`src/components/toolbarConfig.js`** — a
  frozen `TOOL_CLUSTERS` array that describes every cluster + its items.
  Adding a new tool = ONE entry there; `Toolbar.jsx` iterates the config
  and dispatches by item type (`tool` / `toggle` / `segmented` / `action`).
- The `<Dropdown>` primitive lives in `src/components/ui/Dropdown.jsx`.
  Composable shape: `<Dropdown>`, `<DropdownGroup title>`,
  `<DropdownItem icon label shortcut active disabled onSelect>`,
  `<DropdownToggle icon label checked onToggle>`,
  `<DropdownSegmented options value onChange>`, `<DropdownDivider />`.
  Reuses the `Button` primitive for the trigger, mirrors `Panel`'s
  `position: absolute` + `ui-fade-in` animation, borrows `Modal`'s
  Esc-close + outside-click-close logic.
- **Sub-headers inside dropdowns** where it adds clarity: `Structural &
  Civil` splits into "Structural" + "Civil"; `View & Settings` groups
  Tools / Toggles / Units. Mirror the LayersPanel group-header styling.
- **Toggle items** (Dimensions, Virtual Walls) use `<DropdownToggle>` —
  they do NOT close the flyout on click (lets users flip multiple
  toggles in one open).
- **Segmented items** (Units ft/m) use `<DropdownSegmented>` — clicking
  an option sets the value AND closes the flyout.
- **One-shot actions** (Save / Import / Export / Undo / Redo) live in
  the Project dropdown as `<DropdownItem>` with `actionId` + shortcut
  hint. Undo/Redo correctly disabled when `history`/`future` arrays
  are empty; shortcut hint stays visible (educational).
- Icons exclusively from `lucide-react` at `size={14}` `strokeWidth={2}`
  for items; cluster trigger uses 12px chevron. **No emoji anywhere.**
- Cluster trigger button uses `<Button>` `size="sm"` + `variant`
  (primary / ghost). Active-cluster detection via `collectToolIds(cluster)`
  helper in `toolbarConfig.js` — walks flat `items[]` or nested
  `groups[].items[]` and returns every `toolId` the cluster contains.
- **Cross-component close**: a window event `toolbar:close-dropdowns`
  is dispatched whenever:
  - A keyboard shortcut fires in `useKeyboardShortcuts.js` (after every
    `setTool` / undo / redo / save / Esc / Delete / bare-key D/S/R/P/E/H/F/L).
  - A `<DropdownItem>` is clicked (`onSelect` fires inside the item,
    which then dispatches the close event before bubbling).
  Each open `<Dropdown>` listens for the event and closes itself.
  Follows the same decoupled pattern as `boq:toggle`. Add new
  panel/toolbar events under `panel:` / `toolbar:` namespaces.
- **Adding a new tool**: edit `toolbarConfig.js` — one entry with
  `{ type: 'tool', toolId, icon, label, shortcut }`. No JSX changes
  required in `Toolbar.jsx`. The keyboard shortcut is then registered
  in `useKeyboardShortcuts.js` separately — that's the only other touch.
- **Adding a new cluster**: append a new cluster to `TOOL_CLUSTERS`
  with `id`, `label`, and either `items[]` or `groups[]`.

### Keyboard shortcuts (`src/hooks/useKeyboardShortcuts.js`)

Mounted once via `useKeyboardShortcuts()` call in `App()`. Behavior:

| Shortcut | Action |
|---|---|
| `Esc` | `setTool('select')` — closes any panel/modal, clears selections |
| `Del` / `Bksp` | `dialog.confirm` → delete current selection → `toast.action` undo |
| `Ctrl/Cmd+Z` | `undo()` |
| `Ctrl/Cmd+Y` or `Ctrl/Cmd+Shift+Z` | `redo()` |
| `Ctrl/Cmd+S` | replicates Toolbar Save handler (autosave + toast) |
| `Ctrl/Cmd+B` | dispatch `boq:toggle` window event — collapses/expands BOQ |
| `D` / `S` / `R` | `setTool('draw' | 'select' | 'room')` |

Bare-key shortcuts (Esc/Del/D/S/R) are suppressed when focus is in
`INPUT/TEXTAREA/SELECT/[contenteditable]`. Modifier shortcuts fire
everywhere. Use defensive optional chaining (`useStore.getState().fn?.()`)
when invoking store actions from this hook.

### Canvas selection feedback (`Canvas.jsx`)

Selected entities render with `var(--color-primary)` stroke and a
600ms one-shot pulse element keyed by the selected id (forces remount +
restart animation on selection change). Walls also get a 0.18-opacity
underglow line. The pulse keyframe (`canvas-pulse-once`) lives in
`Canvas.css`. **Never increase pulse duration beyond 600ms or make it
loop.**

Floor-switch fade: `.canvas-floor-layer[data-fading="true"]` dims the
layer's opacity to 0.4 for 120ms when `currentFloorId` changes. The fade
applies to floor-specific content only; grid background is unaffected.

### Empty states

- **Canvas** (`Canvas.jsx` + `Canvas.css`): `.canvas-empty-state` overlay
  renders when `walls + rooms + columns + stamps` are all empty. Includes
  a 2s bobbing `↖` arrow pointing toward the Draw tool — the SOLE
  infinite animation in the app, sanctioned for first-use affordance.
- **BOQ** (`BOQPanel.jsx` + `boq.css`): `.boq-empty-state` replaces the
  section list when no entities exist. Export buttons get `disabled` on
  empty. Header / floor toggle / export bar still render.

### Desktop gate (`DesktopGate.jsx` + `DesktopGate.css`)

Wraps the app in `App.jsx`. If `window.innerWidth < 1024`, renders a
centered card with the desktop requirement message and the current
viewport width. App contents are NOT rendered when narrow, so panels
can't break in responsive states. Resize listener re-evaluates the gate.

### Dependencies added in UI phases
- `lucide-react` ^1.16.0 — icon set for toolbar buttons. No new
  libraries beyond this.

### What NOT to do
- Don't add CSS-in-JS runtime systems (styled-components, emotion, etc.).
  All styling is class-based + tokens.
- Don't use inline `style={{ ... }}` for static colors/spacing/fonts. Inline
  style is OK only for dynamic values (computed widths, position offsets,
  conditional colors that swap between tokens).
- Don't introduce hex literals in JSX. Greppable check on a new file:
  `grep -n "#[0-9a-fA-F]\{3,6\}" <file>` should return nothing in style values.
- Don't use emoji in UI output — use `lucide-react` icons or Unicode
  typographic glyphs (e.g., `↖` for an arrow, `×` for close).
- Don't add gradient backgrounds, glassmorphism (backdrop-filter), shadow
  layers heavier than `--shadow-lg`, or any scale/bounce/spring animation.
- Don't replace `dialog.*` / `toast.*` with native browser dialogs.
- Don't hand-roll modal scaffolding — use the `Modal` primitive.

### Known UI carry-overs
- `removeFloor` and `removeSpec` write to `projectSettings`; the store's
  undo history doesn't currently snapshot that subtree, so the undo toast
  fires but the operation isn't actually restorable. Widening the undo
  scope is a future task — don't paper over by removing the toast.
- BOQ-line click-to-select only works for emitters that populate
  `sourceEntityIds`. Currently only BBS grouped-by-spec steel lines.
  When you add new line emitters in `boq/lines.js`, populate
  `sourceEntityIds: [...]` so the click affordance becomes available.

---

## Known issues / Phase 2 backlog

### Resolved by Phase R1 — Auto Room Detection (2026-05-27)

- **Room entities could only be created via Shift+R rectangle tool**
  or by manually clicking each enclosing wall in the legacy `room`
  tool then committing — high friction once you've drawn a flat
  freehand. Walls drawn with the regular wall-draw tool (or imported
  via future DXF) form closed loops at the graph level but spawned
  no Room entity. Resolved by the `room_detect` tool: click any
  wall in a closed loop → smallest enclosing face computed on the
  cursor's side via planar face enumeration → Room created via
  `createRoomFromFace` (atomic, routed through canonical
  `saveRoom`). BOQ output is byte-identical to equivalent
  rect_room-created rooms on the same wall topology (verified by
  Section E canary). Shift+A activates the tool. Provenance meta
  stamps `createdFrom: 'face-detect'` for future debugging /
  stale-room workflows.

### Deferred — Phase R+N Courtyard / nested-room support

When a detected face is fully contained inside another (e.g., a
courtyard inside an outer perimeter), Phase R1's overlap check
refuses to create the inner room — `doRoomsOverlap` flags
containment as overlap, mirroring Phase 1's existing semantics.
Real architectural courtyards in residential BOQ are rare enough
that they deserve dedicated schema treatment:
- Polygon-with-holes representation (outer + inner-loop arrays).
- Winding-aware area math (signed-area subtraction for net
  floor area).
- BOQ subtraction logic across every aggregator that consumes
  room area / room polygon (flooring, ceiling, plaster, tiles,
  paint, etc.).

Defer until a real residential project demands it. Track here
when surfaced.

### Resolved by Phase A — Snap Architecture (2026-05-27)

- **Calibrate scale modal opened immediately on tool activation** instead
  of waiting for two canvas clicks. Root cause: the modal's `open`
  predicate was `toolActive && (haveBothPoints || !capture)` — the
  `!capture` clause fired the modal the moment the tool was activated
  (capture is null until the first click), blocking the canvas before
  the user could click their two reference points. Fixed by gating
  the modal on `haveBothPoints || fallbackRequested` and extending the
  status pill to cover the pre-click state with a "Use full drawing
  width instead" affordance for the fallback path. Container is
  `pointer-events: none` so canvas clicks pass through; only the
  fallback button is interactive. (Earlier in this session.)

- **FeetInchesInput rejected valid feet-inches input in the calibration
  modal.** Repro: enter `15'-0"` → Apply → toast "Enter a positive
  length in feet." Root cause: `CalibrationModal.jsx` passed
  `onChange={setLengthFt}` to a component whose commit prop is
  `onCommit`. React silently swallowed the unknown prop, `setLengthFt`
  was never called, `lengthFt` stayed null, `Number(null) === 0`
  failed the positive-length guard. The parser itself was correct
  (handled `15'-0"`, `15' 0"`, `15'0"`, `15`, `15.5`, `15'-6"`,
  `15'-6 1/2"`, `180"` all correctly — proven via 25 existing
  `verify-units` parseFeetInches assertions). Fixed by prop rename
  `onChange → onCommit`. Added a dev-mode guard in
  `FeetInchesInput.jsx` that `console.error`-s if any future consumer
  passes `onChange` (gated on `import.meta.env.DEV`; tree-shaken in
  prod). Audit confirmed the 13 other consumers all used `onCommit`
  correctly. (Earlier in this session.)

- **`GRID_IN = 12` hardcoded as a magic number with no per-project
  override and no per-tool bypass** — blocked all sub-foot tracing of
  PDF underlays. Real architectural drawings carry walls and openings
  at arbitrary positions (9", 4½", 11'-7½", door offsets of 2'-7",
  etc.); every click rounded to the nearest 12" cell. The only escape
  hatches were `screenToWorldRaw` (used by Calibrate, Split, Stamp
  drag) and property-panel typing after the fact. Resolved by the
  unified snap resolver itself: `projectSettings.snap.pitchIn` is
  user-configurable (1/3/6/12/24in presets plus custom), Alt-bypass
  for pixel-accurate placement, F9 toggles snap globally, per-target
  enable for endpoint / midpoint / etc., and `TOOL_SNAP_POLICY`
  drives per-tool behavior through a single resolver call site. The
  14 inline `screenToWorld` / 5 inline MEP-wall-snap blocks / 1 inline
  split-segment-snap in Canvas.jsx all collapsed into
  `resolveSnap(state, screenXY, ctx)`. See Phase A section above.

### Open

- **Undo/redo can restore room-overlap state** that bypassed save-time prevention.
  Repro: Create Room 1 → Delete Room 1 → Create Room A in same space → Undo the delete.
  Room 1 + Room A now coexist. Mitigated: both are excluded from all BOQ totals by the
  pairwise overlap filter in `getValidRoomIds()`. Fix in Phase 2 with revision/lifecycle work.

- **Civil stamp outer-dim approximation** — brickwork/plaster computed on outer footprint, not inner clear dims. Negligible for schematic BOQ. Revisit Phase 2+ with material spec inputs.

- **Waterproofing on civil stamps** — approximated as full inner plastered surface. Real spec varies per system. Needs material spec input in Phase 2+.

- **OHT material formulas** — deferred to Phase 2+ (sits on roof slab, needs structural context).

- **Septic soak pit** — not modelled. Deferred.

- **NaN normalization** — `r2(undefined)` returns NaN silently. Consider adding a `safeR2(n)` guard for robustness. Deferred Phase 2.

- **BONDING enum drift** — `materials.js` BONDING keys are `CEMENT_SAND`/`THIN_BED`; values are strings. Consuming code must use keys, not values. CLAUDE.md previously documented this incorrectly. The truth: `BONDING.CEMENT_SAND === 'CEMENT_SAND_MORTAR'` (value), but check in code must be `mat.bondingType === BONDING.CEMENT_SAND`. Phase 2: add a lint rule or runtime assertion.

- **Canvas.jsx SVG render stack** — layer order (bottom to top): grid → room fills → stamps → walls → beams → ghost line → nodes → columns → UI overlays → room labels. Changing this order has visual consequences. Document in source.

- **Multi-floor structural** — Phase 1.9 added per-floor data plumbing; selectors honor `floorId`; canvas ghost rendering + BOQ scope are live (commit `6fa5fc1`). Still pending: per-floor slab thickness override stored on `floor.meta.slabThicknessIn` is not yet consumed by `getSlabQuantities()`. Wire-through is a small follow-up.

- **Combined/raft footings, L/T columns, two-way slab steel, BBS** — done in Phase 1.7/1.8.

- **BBS per-beam overrides** — `byBeamLevel` only; per-beam `byBeam[]` will need a separate aggregation in `computeBBSQuantities`.

- **Slab BBS span approximation** — uses `√area` for span/width. Fine for square rooms; loose for long thin slabs. Phase 2.x should expose `slab.geometry.spanFt` when a real one-way/two-way distinction needs precision.

- **BE-Polish-001 — WC/column/fixture visual disambiguation.** Fixtures and columns currently render as near-identical small light squares with blue strokes (column rect ~13×13 px light-blue fill + `#2471a3` stroke at `Canvas.jsx:1890-1900`; WC rect 16×16 px `--color-surface` fill + cold-supply blue stroke at `PlumbingOverlay.jsx:119-169`). Per-fixture glyphs already declared via `glyphId` in `src/mep/catalogs/fixtureTypes.js` and marked "Phase 2 — not implemented" in `src/components/canvas/PlumbingOverlay.jsx:5-6`. Implement glyphs + a distinct column treatment. Data layer is already clean — purely cosmetic. Low severity, real UX value.

- **BE-NotABug-001 — "Beam between two WCs".** Investigated 2026-05-28, impossible in code. Beam endpoints are COLUMN-only at both the click handler (`Canvas.jsx:615-624` inside `handleColumnClick`) and the store action (`addBeam` in `structuralSlice.js:898-924` hard-codes `endpoints.from/to.type: 'COLUMN'`). The observation was BE-Polish-001 causing misidentification: user drew a real beam between two columns (or a wall) and read them as fixtures because they look identical. Resolved when BE-Polish-001 ships. No code change needed.

- **BE-Cleanup-001 — `deleteWall` leaves dangling `foundation.wallIds[]` refs.** When a wall is deleted, `state.foundations[id].wallIds[]` is NOT stripped of the deleted wallId. A STRIP foundation that referenced the deleted wall keeps a stale reference. No verify script currently asserts the cascade because `verifyIntegrity` for foundations checks "ref → existing wall" — and the stale entry passes if the wallId is gone? Confirm via integrity rerun after deleteWall on a STRIP-anchored wall. Fix should mirror the room-cleanup pattern landed in Bug B (2026-05-28): inside `deleteWall`'s atomic set, walk `state.foundations` and strip the wallId; if a foundation's wallIds becomes empty AND its columnIds is also empty, delete the foundation entity entirely (foundations with neither are unreachable) and emit a `foundation_orphaned_by_wall_delete` validationEvent. Same persistent-toast hint pattern from Bug B applies — caller-side wall-delete toast upgrades when foundations are auto-removed.

- **BE-Cleanup-002 — `deleteWall` orphans MEP fixtures with `wallId` refs.** Plumbing fixtures, electrical points, HVAC indoor units, fire devices, and ELV devices that pin themselves to a specific wall via `wallId` are left dangling when that wall is deleted. `splitWall` already rebases MEP fixtures by `wallT` (see `structuralSlice.js:902-927`); `deleteWall` does no equivalent cascade. Mirror the room-cleanup pattern: strip `wallId` on each affected fixture (or delete the fixture entirely if its placement requires a wall — verify per-discipline), emit per-discipline validationEvents (`mep_<discipline>_orphaned_by_wall_delete`), and surface in the persistent-toast hint when fixtures were affected.

- **BE-Excavation-001 — Excavation `buildingFootprintFt2` still uses centerline polygon sum.** With true built-up area now available via `getTotalBuiltUpAreaSft` (Phase BA, 2026-05-28), the bulk-excavation footprint at `src/quantities/excavation.js:45` (`sum(getRoomArea)` over valid rooms) is architecturally less accurate than the new outer-face calculation. A real excavation site is dug to the building's plinth footprint, including the band under external walls. Switching to built-up would change `bulkExcavationVolFt3` numbers and break the verify-boq byte-equality canary, so the swap is deferred until the BOQ regression seatbelt accommodates a one-shot rebaseline. When taking this on: re-source `buildingFootprintFt2` from `state.getTotalBuiltUpAreaSft(floorId)`, update verify-boq's expected excavation numbers, and document the migration in CLAUDE.md.

- **BBS-5b** — BBSSchedulePanel Excel + PDF export deferred. Panel data
  reads `computeRebarGroups(state, { floorId })` and could be serialized
  via `excel.js` / `pdf.js` mirroring the existing BOQ pipeline. Marked
  `TODO BBS-5b` in `BBSSchedulePanel.jsx`.

- **BBS-FoundationTypes** — `generateFootingRebarGroups` returns `[]` for
  RAFT / STRIP / PILE foundation types. Each needs its own geometry +
  bar layout: RAFT = top + bottom mesh both ways; STRIP = continuous
  linear bars along the wall length + transverse ties; PILE = shaft cage
  (longitudinal + helical/spiral ties) + cap mesh. Each is a separate
  generator file under `src/bbs/generators/`.

- **BE-Legacy-001** — `FT_PER_MM` constant in
  `src/specs/reinforcementSpecs.js` is `FT_PER_M / 1000 = 0.0003048`,
  which is mathematically m/mm (not ft/mm). Used in
  `computeColumnBBS`'s `lapFt = lapLengthMultiplier × diaMm × FT_PER_MM`
  formula, this silently under-counts the column longitudinal lap by
  ~10× (lap is treated as ~5d instead of 50d). The new RebarGroup
  generators do NOT touch this path — they route through the catalog
  `lapLengthMm(...)`. Fixing the legacy lap would shift `verify-boq`
  steel_by_diameter and column-steel numbers everywhere; needs a
  one-shot rebaseline. Defer until the legacy aggregator is sunset OR
  until the next major BOQ rebaseline.

- **BBS-RealPlan-001** — `verify-bbs.mjs` Sections C–G use synthetic
  fixtures (one-column / one-room / fake-wall / 4-column array). No
  generator has been run against the F1 stacked-rooms canary (in
  verify-boq Phase W), the 2-floor multi-room fixture (verify-multifloor),
  or the F1-realistic L-shape + T-junction (verify-building-area
  Section K). Add a Section H to verify-bbs that builds each of those
  existing real-plan canaries and invokes `computeRebarGroups`, asserting
  group counts + kg totals + per-floor scope behavior. No new fixtures
  needed.

---

## Phase 1.5 — Structural BOQ system

### Entities (all in `structuralSlice.js`, spread into main store)
- `projectSettings` — heights, column/footing types, beam dims, slab/sunshade/parapet/staircase defaults
- `columns` — `{ id, x, y, attachedNodeId, columnTypeId }`. Attached columns mirror node position; standalone are draggable.
- `beams` — persisted EXPLICIT beams only. `getAllBeams()` merges with in-memory WALL_DERIVED beams from `getDerivedWallBeams()`.
- `slabs` — persisted slab regions. Auto-initialized on first room; TOILET/BALCONY rooms get SUNKEN slab.
- `staircases` — companion entity to stamps of type `'stairs'`; same id.

### Wall beam flags
- `hasPlinthBeam / hasLintelBeam / hasRoofBeam` — `null` = auto-derive from room adjacency; `true/false` = override.
- `classifyWallBeamFlags(wallId)` resolves null → boolean using `getWallAdjacencyCount()`.

### Key selectors
- `getMasonryWithBeamDeduction()` — same shape as `getMaterialQuantities()` but volumes reduced by beam cross-sections. BONDING check: `mat.bondingType === BONDING.CEMENT_SAND` (not `BONDING.CEMENT_SAND_MORTAR`).
- `getConcreteByGrade()` — returns `sandM3DRY`, `agg10mmM3DRY`, `agg20mmM3DRY` (DRY suffix; procurement volumes).
- `getColumnQuantities()` — keyed by column type id; fields: `{ count, columnHeightFt, sectionFt2, volFt3, label }`.
- `getFootingQuantities()` — keyed by column type id (not footing type id); fields: `{ count, concreteVolFt3, pccVolFt3, label, lengthFt, widthFt, depthFt }`. Footing dims come from inline fields on the column type.
- `getSteelQuantities()` — reads steel ratios from `projectSettings.rccSpecs.steelKgPerM3`; falls back to `STEEL_KG_PER_M3` constants.

### Formula files
- `src/formulas/columnFootingBeamFormulas.js` — column, footing, PCC, beam RCC explainers
- `src/formulas/slabStaircaseFormulas.js` — slab, sunshade, parapet, staircase explainers
- `src/formulas/steelConcreteFormulas.js` — steel by element, concrete grade explainers
- `src/formulas/masonryDeductionFormulas.js` — beam deduction breakdown per material
- `src/formulas/structuralFormulas.js` — barrel re-export of all above
- `src/formulas.js` re-exports all via `export * from './formulas/structuralFormulas'`

### New panels
- `StructuralBOQSection.jsx` — 4 BOQ sections: Structural RCC, Structural Steel, Concrete Materials, Staircase
- `ColumnPanel.jsx` — type dropdown, attach/detach, delete
- `StaircasePanel.jsx` — staircase structural fields
- `SlabPanel.jsx` — slab region management (modal, activeTool='slabs')
- `ProjectSettingsPanel.jsx` — all projectSettings (modal, activeTool='settings')
- `LayersPanel.jsx` — floating layer visibility toggles (bottom: 56, left: 16)

### Layer visibility
- `DEFAULT_LAYER_VISIBILITY` in `src/constants/layers.js`: walls, columns, beams, stamps, roomFills, roomLabels, nodes (all true).
- Store: `layerVisibility` state + `setLayerVisibility(partial)` action. Ephemeral (resets on reload).
- Canvas SVG render order (bottom to top): room fills → stamps → walls → beams → ghost → nodes → columns → UI overlays → room labels.

### Constants (`src/constants/structural.js`)
- `BEAM_LEVEL_REGISTRY` — single source of truth for all beam levels. Every consumer iterates this array; nothing hardcodes `['plinth','lintel','roof']` directly. Fields: `id`, `label`, `flagName`, `color`, `autoExternal`, `autoPartition`, `defaultWidthIn`, `defaultDepthIn`. Adding a new beam level = one entry here only.
- `PCC_BEDDING_THICKNESS_FT` — 50mm (2/12 ft) bedding under every footing. Only declared here; never re-declared locally.
- `STEEL_KG_PER_M3`, `CEMENT_BAGS_PER_M3`, `SAND_M3_PER_M3_DRY`, `AGGREGATE_M3_PER_M3_DRY`, `AGGREGATE_SPLIT`, `DRY_WET_FACTOR` — mix design constants (still present as fallback defaults).

### Column shape strategy (`src/lib/columnShapes.js`)
- `COLUMN_SHAPES` registry maps shape key (`rect`, `circle`) → `{ areaFt2, dimLabel, formulaLabel, svgDims }`.
- Exported helpers: `getColumnAreaFt2(ct)`, `getColumnDimLabel(ct)`, `getColumnFormulaLabel(ct)`, `getColumnSvgDims(ct, pxPerInch)`.
- **Never branch on `ct.shape` directly** — always call the helpers. Adding a new shape = one entry in the registry.

### Column types — updated data model
- Column types now carry **inline footing dims**: `footingLengthFt`, `footingWidthFt`, `footingDepthFt`.
- `footingTypeId` and the separate `DEFAULT_FOOTING_TYPES` / `projectSettings.footingTypes` table are **removed**.
- `getFootingQuantities()` is keyed by **column type id** (e.g., `C1`), not footing type id. Result shape: `{ [columnTypeId]: { count, concreteVolFt3, pccVolFt3, label, lengthFt, widthFt, depthFt } }`.
- `getColumnQuantities()` result no longer includes `footingTypeId`.
- `loadProject` migration (Layer 4): if saved column types still have `footingTypeId`, dims are resolved from the saved `footingTypes` array and inlined automatically.

### `projectSettings` — full shape
```
{
  heights:           { plinthHeightFt, floorHeightFt }       // legacy single-floor mirror
  floors:            [{ id, label, sequence, plinthHeightFt, floorHeightFt, meta }]
  defaultPlasterSystemId: 'CEMENT_SAND_INTERNAL'
  columnTypes:       [{ id, label, shape, widthIn?, depthIn?, diamIn?,
                        footingLengthFt, footingWidthFt, footingDepthFt,
                        reinforcementSpecId? }]
  beamDimensions:    { [levelId]: { widthIn, depthIn } }  ← keyed by BEAM_LEVEL_REGISTRY id
  slabSettings:      { mainThicknessIn, sunkenDepthIn, autoSunkenRoomTypes }
  sunshadeSettings:  { enabled, projectionFt, thicknessIn }
  parapetSettings:   { enabled, heightFt, thicknessIn, materialKey }
  staircaseDefaults: { type, treadIn, riserIn, waistSlabIn, landingFtWidth, landingFtLength, flightWidthFt }
  rccSpecs:          { concreteGrade: { FOOTING,COLUMN,BEAM,SLAB,STAIRCASE,PCC },
                       steelKgPerM3:  { FOOTING,COLUMN,BEAM,SLAB,STAIRCASE,CIVIL_STAMP } }
  foundationDefaults:{ plumDepthFt }                         // Phase 1.6e
  excavationSettings:{ workingMarginFt?, bulkDepthFt? }      // Phase 1.6b
  reinforcementSpecs:{ [specId]: { id, label, elementType, ... } }  // Phase 1.7
  bbsDefaults:       { COLUMN?, BEAM?, FOOTING?, SLAB? }     // Phase 1.7 — specId per element
}
```
- `footingTypes` key **does not exist** in the current model. `loadProject` strips it during migration.

### `projectSettings` actions
- `setColumnTypeEntry(id, fields)` — partial update on one column type
- `addColumnType(fields)` — creates new column type with uid, merges in fields
- `removeColumnType(id)` — removes column type by id
- `setRccSpecs({ steelKgPerM3: { ELEMENT: value } })` — partial update to steel ratios
- `setBeamDimension(levelId, { widthIn?, depthIn? })` — update one beam level's dims

### `getSteelQuantities()` — reads from `rccSpecs`
- Reads `projectSettings.rccSpecs.steelKgPerM3` per element; falls back to `STEEL_KG_PER_M3` constants for any missing key.
- BOQ numbers are identical at default ratios; only change when user edits ratios in ProjectSettingsPanel.

### Formula dispatcher (`BOQPanel.jsx`)
- `EXACT_HANDLERS` — plain object mapping exact id string → formula function. No if-else needed for new exact-match IDs.
- `PREFIX_HANDLERS` — array of `{ prefix, handle(id, state) }`. Parametric IDs (`col_`, `fot_`, `beam_`, `steel_`, `mat_`) extract their argument inside `handle`.
- `getFormulaData(id, state)` — checks exact table first, then iterates prefix table. Adding a new formula = one table entry.

### SlabPanel — active slab types
- Only `MAIN` and `SUNKEN` slab types are active. `BALCONY` and `TERRACE` were removed (no quantity calculation pipeline; would produce silent zero output).

### `loadProject` migrations (cumulative)
- **Wall**: inject `materialKey: 'IS_MODULAR_BRICK'` + `floorId/classification/meta` defaults.
- **Stamp (v1–v3→v4)**: inject `depth`/`name` defaults for civil stamp types; `floorId`/`meta`.
- **Column type (Layer 4)**: if `footingTypeId` present and no inline dims, resolve from saved `footingTypes` array and inline.
- **rccSpecs (Layer 5)**: if `rccSpecs` absent, inject `DEFAULT_PROJECT_SETTINGS.rccSpecs`.
- **Column (Fix 1+2)**: drop legacy `foundationId`; rename legacy `floorId → baseFloorId`; mirror `topFloorId` from base.
- **Slab (Fix 3)**: derive `classification` + `role` from saved `role`/`classification`/`type` (SUNKEN if type=='SUNKEN', else fallback 'ROOF').
- **Foundations / floors / plaster default**: inject DEFAULT keys when absent.

---

## Topology Layer (src/topology/)

Topology is the canonical, read-only spatial-relationship layer. Discipline
engines (structural BOQ, MEP, interiors, fabrication) consume it; they
**never recompute relationships**. This is the MEP/interiors/fabrication
foundation — every "which side of wall X faces room Y?" or "is this wet
wall external?" question goes through topology.

### Module structure

```
src/topology/
  cache.js         # createMemo() — reference-equality memo helper
  index.js         # barrel re-export (single canonical import path)
  rooms.js         # walkPolygonNodeOrder, buildPlotPolygon, getRoomPolygon,
                   # getRoomArea, getRoomWallArea, isRoomStructurallyValid,
                   # getOverlappingRoomName, hasRoomOverlap, getValidRoomIds,
                   # sumRoomAreas
  floor.js         # isColumnOnFloor, getNodes/Walls/Rooms/Stamps/Beams/
                   # Slabs/Foundations/Staircases/ColumnsOnFloor,
                   # getNodeIdsOnFloor, getWallIdsOnFloor,
                   # getActiveFloorNodes/Walls, getEntitiesOnFloor,
                   # sortedFloorList
  walls.js         # getWallAdjacencyCount, getWallToRoomsIndex,
                   # getRoomsForWall, isExternalWall, isPartitionWall,
                   # getExternalWallIds, classifyWallBeamFlags
  openings.js      # getOpeningsOnWall, getDoorOpenings, getWindowOpenings,
                   # getSunshadeOpenings, getOpeningArea,
                   # getTotalOpeningAreaForWall
  columns.js       # getNodeToColumnIndex, getColumnAtNode,
                   # getColumnPosition, getColumnHeightFt,
                   # getColumnAreaFt2, getColumnPerimeterFt
  beams.js         # resolveBeamEndpoint, getBeamLengthFt,
                   # getDerivedWallBeams, getAllBeams
  foundations.js   # getFoundationForColumn, getFoundationForWall,
                   # getFoundationsForWall, getColumnsByFoundation,
                   # getColumnIsAttachedToFoundation,
                   # getInlineFootingColumnTypeIds
  adjacency.js     # getRoomAdjacencyGraph (shared wall edges),
                   # getRoomConnectivityGraph (shared wall + door),
                   # getRoomsBorderingRoom, getRoomNeighbourThroughDoor,
                   # findSharedWalls
  surfaces.js      # getWallSurfaces (faceA/faceB → roomId|null with
                   # oriented normals), getRoomSurfaces, getExteriorFaces,
                   # getInteriorFaceArea
  wet.js           # WET_ROOM_TYPES, isWetRoomType, getWetRoomIds,
                   # getWetWallIds, getWetWalls, getWetExternalWalls
                   # (plumbing service entry), getWetPartitions (chase
                   # candidates), getWetRoomsForWall
```

### Topology invariants — mandatory

- **Pure spatial math lives in `src/geometry.js`** (point-in-polygon,
  segment math, snap, signed area, doRoomsOverlap). Topology USES geometry —
  it isn't geometry.
- **State-reading relationships live in `src/topology/`.** Each module owns
  ONE kind of relationship.
- **State contract:** every state-reading function accepts a `state`
  parameter (live Zustand state OR the floor-scoped wrapper from
  `boq/scope.js`). Topology functions read `state.rooms` / `state.walls` /
  `state.nodes` directly AND call other state methods via method dispatch
  (`state.getWallArea(id)`) — this is why `scopeStateToFloor` works
  transparently when the scoped wrapper substitutes its own collections.
- **No store mutations.** Ever. Topology is read-only by contract.
- **Memoization via `createMemo()` in `topology/cache.js`** — reference
  equality only, single-store assumption, one memo cell per cached
  selector at module scope. No deep equality, no LRU, no JSON
  serialization. When a memoized topology selector is called from both
  the live store and a scoped wrapper, the two call paths key on
  different `state.rooms` references and naturally distinguish.
- **No inline `Object.values(state.walls).filter(...)` outside
  `src/topology/` and `src/store.js`.** Use the topology selector that
  asks your question. If no selector exists for your question, ADD one
  to the appropriate module before using it.
- **`resolveBeamEndpoint(state, ref, opts?)` in `topology/beams.js` is the
  SINGLE CANONICAL ACCESSOR for beam-endpoint geometry (locked rule).** No
  direct endpoint coordinate access ANYWHERE — every consumer (BBS, BOQ,
  shuttering, canvas render, validation) resolves through it. It returns
  `{x,y} | null` (never `{x: undefined}`); `null` means dangling / cyclic /
  unknown-type and the caller skips the beam. Five inline copies were
  collapsed here in Step 5 — do not re-introduce inline resolution.
- **Beam endpoints are a 4-type discriminated union** (Phase BeamConnect):
  `{type:'COLUMN', columnId}` · `{type:'BEAM', beamId, t}` (secondary frames
  into a primary at `t∈[0,1]`) · `{type:'WALL', wallId, t}` (bearing on a wall)
  · `{type:'POINT', x, y, detachedFrom?}` (free / cantilever, or detached by a
  parent delete). `resolveBeamEndpoint` is recursive + cycle-guarded for BEAM.
  Beams reference COLUMNS/BEAMS/WALLS, never nodes. Topology face/adjacency
  graphs are decoupled from beams.
- **Parent delete DETACHES, never silently drops geometry.** `deleteColumn` /
  `deleteBeam` / `deleteWall` convert a referencing beam endpoint to a frozen
  `{type:'POINT', x, y, detachedFrom:{type, …id}}` at its last-resolved
  position + emit a `beam_endpoint_detached` validationEvent (undo restores;
  `beam_no_support` then flags the free end). `detachedFrom` preserves
  provenance for repair/audit. `beam_circular_ref` (ERROR) guards cycles.
- **`nodeToColId` lives in `topology/columns.js` as
  `getNodeToColumnIndex`.** Single-source, memoized on `state.columns`.
- **Wall adjacency is memoized once per `state.rooms`** —
  `getWallAdjacencyCount` returns the same object reference until rooms
  change. External/partition classification follows from this same
  invariant.
- **Wall-surface ownership** (`getWallSurfaces`) is the load-bearing
  API for any engine that distinguishes interior vs exterior face of a
  wall (interior paint, exterior cladding, MEP switch placement,
  electrical conduit, tile area). Never re-implement face↔room
  determination — call `getWallSurfaces` or `getRoomSurfaces`.
- **Room adjacency** (`getRoomAdjacencyGraph`) is the load-bearing API
  for MEP duct routing, drainage stacks, and corridor discovery. Edges
  are SYMMETRIC, cross-floor edges are non-existent by construction
  (walls are floor-owned). The connectivity variant
  (`getRoomConnectivityGraph`) filters to walls bearing at least one
  door.
- **Wet-wall set** lives in `topology/wet.js` with `WET_ROOM_TYPES` as
  the single source of truth (currently `TOILET`, `KITCHEN`,
  `UTILITY`). MEP engines import from here — never re-hardcode the
  wet-room list.

### What NOT to extract into topology

- `geometry.js` helpers (point-in-polygon, doRoomsOverlap, etc.) — already
  pure and reusable; topology calls them.
- Store mutators (`addWall`, `splitWall`, `attachColumnToFoundation`,
  etc.) — they may *consult* topology for read-only checks ("is this
  node on the current floor?") but they own state changes.
- `boq/scope.js`'s aggregator re-implementations — they exist because
  Zustand selectors are closures bound to live `get()`. The wrapper is
  the floor-scope boundary; topology delegations inside it are correct.
- `iso/projection.js` — pure math, unit-conversion only. Not a
  relationship question.
- Per-rule `check(state)` shape in `validation/engine.js` — stable
  contract. Rules consume topology imports rather than inlining.

### Adding a new topology API

1. Choose the module by question kind (room? wall? opening? adjacency?
   surface?). Resist the urge to create `utils.js` — toy projects
   accumulate kitchen-sink modules.
2. Signature follows the existing convention: `xxx(state, ...args)`.
3. If memoized, add one `createMemo()` cell at module scope, keyed on
   the minimum stable inputs (`state.rooms`, `state.walls`, etc.).
4. Re-export from `topology/index.js`.
5. Add an assertion to `scripts/verify-topology.mjs` if the API
   establishes a new invariant.

### Architectural reminders (existing)

---

## MEP System (src/mep/)

MEP is the discipline-engineering layer that sits on top of the topology
layer. Each discipline owns its own module under `src/mep/<discipline>/`
with a consistent internal layout, and shares cross-discipline utilities
in `src/mep/shared/`. **Phase 0 → 2.6 shipped on commits
`76b193c → d46ee20` (2026-05-18).**

### Module structure (current state)

```
src/mep/
  catalogs/           # 25 files, 24 versioned catalogs (IS 15778 CPVC,
                      # IS 13592 UPVC, IS 1239 GI, IS 732 wire, NBC 2016
                      # fire defaults, IS 962 architectural symbols)
    fixtureTypes.js / pointTypes.js / hvacUnits.js / fireDevices.js /
    elvDevices.js / solarEquipment.js          # entity-type registries
    pipeStandards/{cpvc, upvc, gi, copper, pvcConduit, pexInsulated}.js
    wireGauges.js / cableTypes.js
    {is732,plumbing,hvac,fire,elv}Defaults.js  # room defaults
    loads/{fixtureUnits, pointLoads, diversityFactors, electricalConstants}.js
    ifcClasses.js / classificationCodes.js
    index.js          # barrel + CATALOG_VERSIONS manifest
  shared/             # 11 files
    routingZones.js   # WALL/CEILING/FLOOR/SHAFT/EXTERNAL/UNDERGROUND
    sizingStrategy.js # CATALOG | HUNTER | LOAD_BASED | GRADIENT_DRAIN
    systemGraph.js    # deterministic IDs, sort, validate
    geometry.js       # snap-to-wall, walkWallPerimeter, simplifyPolyline,
                      # routeStableHash, fittingCounter
    risers.js         # cross-discipline riser helpers
    suggestions.js    # applyRoomDefaults engine
    clashDetection.js # full impl (Phase 2.5)
    ifcMapping.js
  plumbing/           # network, routing, sizing, suggestions,
                      # fixturePlacement, drainage, hotwater (local geyser)
  electrical/         # network, routing, circuitGrouping, sizing,
                      # dbPlacement, submains, suggestions, pointPlacement
  hvac/               # network, routing, sizing, placement, suggestions
  fire/               # network, routing, sizing, placement, suggestions
  elv/                # network, routing, sizing, placement, suggestions
  quantities/         # one aggregator per discipline:
    plumbing.js / electrical.js / hvac.js / fire.js / elv.js
  validation/
    engine.js
    rules/
      mep_no_floor_trap.js
      mep_db_load_exceeded.js
      mep_clash_detected.js
    index.js          # MEP_RULES barrel, spread into src/validation/engine.js
```

**Deferred (clean scaffolding remains):**
- `src/mep/solar/` and `src/mep/quantities/solar.js` — Phase 2.3 deferred. Solar equipment catalog (`solarEquipment.js`) + store map (`state.solarEquipment`) + scope.js stubs all in place.
- Plumbing rainwater + central hot-water riser — Phase 2.4 deferred. The 4-system plumbing graph already has slots for `RAINWATER` and `HOT_SUPPLY`; the latter currently runs in local-geyser mode only.

### The MEP pipeline (every discipline follows it)

```
User places fixture/point/unit
  → System graph (logical connectivity per discipline; src/mep/<d>/network.js)
  → Routing engine (spatial polylines along routing zones; routing.js)
  → Sizing engine (CATALOG | HUNTER | LOAD_BASED | GRADIENT_DRAIN; sizing.js)
  → Quantity engine (lengths by zone/diameter, fittings, equipment counts;
                     src/mep/quantities/<d>.js)
  → BOQ lines (src/boq/emitters/<d>.js → src/boq/lines.js)
  → Canvas overlay (src/components/canvas/<D>Overlay.jsx)
```

Each layer is pure and deterministic. Same inputs always produce the
same outputs (byte-stable hash via `routeStableHash` from
`src/mep/shared/geometry.js`).

### MEP invariants (non-negotiable)

- **No spatial-relationship math in `src/mep/`.** Every "which wall is in
  this room?", "where is this fixture?" question goes through
  `src/topology/`. New relationship APIs land in topology, not in MEP.
- **Catalogs are data, not code.** Every diameter, every default, every
  IS-standard load cap, every IFC class lives in `src/mep/catalogs/`.
  Magic numbers in engine code are a bug. Every catalog file exports
  `CATALOG_VERSION` + `CATALOG_SOURCE` (e.g. `'IS 15778:2007'`).
- **`scope.js` aggregator wrappers are load-bearing.** Each of 5 shipped
  disciplines exposes 3 wrappers (`getXNetwork`, `getXRoutes`,
  `getXQuantities`) on the floor-scoped state object. That's
  **15 wrappers live** (Solar deferred = 3 stubs remain). Forgetting one
  silently corrupts multi-floor BOQ. `verify-mep.mjs` per-floor + per-floor
  ≈ total assertions catch this.
- **Risers are cross-discipline + cross-floor.** A single `state.risers`
  map with `kind ∈ { PLUMBING_SUPPLY, SOIL_STACK, RAINWATER_DOWN,
  HOT_WATER_RISER, ELECTRICAL_SUBMAIN, HVAC_REFRIGERANT, HVAC_CONDENSATE,
  FIRE_MAIN, ELV_TRUNKING, SOLAR_DC_RISER, SOLAR_AC_RISER }`. Visible in
  scoped state on both `fromFloorId` and `toFloorId` (mirrors staircase
  rule in `boq/scope.js`). Quantities count their length ONCE at the
  project level — NOT per floor. Codified in
  `computeXQuantities(...).risers`.
- **Sizing strategy is per-discipline + per-project.**
  `projectSettings.mepSizing = { PLUMBING, ELECTRICAL, HVAC, FIRE, ELV,
  SOLAR }`, each value ∈ `{ CATALOG, HUNTER, LOAD_BASED, GRADIENT_DRAIN }`.
  Default `'CATALOG'`. Strategy is picked by `state.projectSettings
  .mepSizing?.[discipline] ?? 'CATALOG'` inside each discipline's
  `sizing.js`. Switching strategy on a project re-derives sizes on next
  selector call (no manual re-route).
- **Deterministic routing.** Every sort uses an explicit comparator with
  stable tiebreaks `(roomId, type, id)`. Every "nearest" lookup uses `<`
  not `<=`. Every Set iteration is converted to a sorted Array. Without
  this, route hashes drift and `verify-mep.mjs` route-stability
  assertions fail.
- **No store mutation in pure modules.** Engines and quantity aggregators
  are pure functions of state. Only `mepSlice.js` actions mutate.
- **BOQ emitters fall back gracefully.** Each `src/boq/emitters/<d>.js`
  resolves quantities via `state.getXQuantities()` (scope wrapper) THEN
  falls back to direct `computeXQuantities(state)` (live state). This
  unlocks both the floor-scoped path AND the call-from-the-live-store
  path without code duplication.
- **IFC-ready from day one.** Every MEP entity carries `discipline`,
  `type`, `ifcType` (from `catalogs/ifcClasses.js`),
  `classificationCode` (Uniclass via `catalogs/classificationCodes.js`),
  `systemId`, `systemType`. Phase 3 IFC exporter consumes these — no
  schema rework needed.

### Discipline sub-systems shipped

| Discipline | Sub-systems | Entity registry |
|---|---|---|
| Plumbing | COLD_SUPPLY, HOT_SUPPLY (local geyser), SOIL_DRAIN, (RAINWATER deferred) | `PLUMBING_FIXTURE_REGISTRY` (14 types) |
| Electrical | LIGHTING, POWER_5A, POWER_15A, AC, GEYSER, SUBMAIN, SOLAR_TIE, EV | `ELECTRICAL_POINT_REGISTRY` (15 types) |
| HVAC | SPLIT_AC, REFRIGERANT, CONDENSATE, VENTILATION (ducted = schema-only) | `HVAC_UNIT_REGISTRY` (6 types) |
| Fire | DETECTION (closed loop), SPRINKLER (tree), EQUIPMENT | `FIRE_DEVICE_REGISTRY` (8 types) |
| ELV | CCTV, DATA, SECURITY, AV | `ELV_DEVICE_REGISTRY` (8 types) |

### BOQ categories emitted (current)

```
plumbing_supply, plumbing_drainage, plumbing_fixtures,
electrical_lighting, electrical_power, electrical_hvac, electrical_submain,
electrical_solar, electrical_ev, electrical_points, electrical_fittings,
electrical_db,
hvac_refrigerant, hvac_condensate, hvac_units,
fire_detection, fire_suppression, fire_equipment,
elv_cctv, elv_data, elv_security, elv_av,
```

Deferred categories (Phase 2.3 / 2.4): `solar_pv`, `solar_wiring_dc`,
`solar_wiring_ac`, `solar_equipment`, `plumbing_rainwater`.

### MEP UI surface (current)

- 5 selection-driven side panels:
  `PlumbingFixturePanel`, `ElectricalPointPanel`, `HvacPanel`,
  `FirePanel`, `ElvPanel`.
- 6 canvas overlays:
  `PlumbingOverlay`, `ElectricalOverlay`, `HvacOverlay`, `FireOverlay`,
  `ElvOverlay`, `ClashOverlay`.
- 5 BOQ section components:
  `PlumbingBoqSection`, `ElectricalBoqSection`, `HvacBoqSection`,
  `FireBoqSection`, `ElvBoqSection`. All purely presentational —
  take `lines: BoqLine[]` props; never call `useStore`.
- `MepDefaultsModal`: listens for `mep:room-created` window event;
  offers checkbox lists of suggested fixtures/points/units/devices per
  discipline; applies via `applyRoomMepDefaults({ plumbing, electrical,
  hvac, fire, elv })`.
- Toolbar buttons (Structural & Civil cluster):
  Plumbing (`Droplet`, P), Electrical (`Zap`, E), HVAC (`Wind`, H),
  Fire (`Flame`, F), ELV (`Cable`, L).
- LayersPanel groups: Plumbing, Electrical, HVAC, Fire, ELV, Diagnostics
  (Clashes), plus per-discipline route toggles
  (`plumbingSupplyRoutes`, `electricalWiringRoutes`,
  `hvacRefrigerantRoutes`, etc.) — see `src/constants/layers.js`.

### Adding a new MEP discipline (or completing deferred Solar / Rainwater)

1. **Catalog**: add registry to `src/mep/catalogs/<name>.js` with
   `CATALOG_VERSION` + `Object.freeze` + `getX(id)` + `listX()`.
2. **Engines**: create `src/mep/<discipline>/` with `network.js`,
   `routing.js`, `sizing.js`, `suggestions.js`, `placement.js`,
   `index.js`. Pure functions, deterministic.
3. **Quantities**: `src/mep/quantities/<discipline>.js` —
   `computeXQuantities(state, opts) → { perSystem, ..., totals }`.
4. **Store**: if a new entity collection is needed, add a state map +
   CRUD actions in `src/mepSlice.js`, plus history snapshot coverage
   in `store.js::_save/undo/redo` and `loadProject` normalization.
5. **scope.js**: replace the 3 stubs (`getXNetwork`, `getXRoutes`,
   `getXQuantities`) at the end of `scopeStateToFloor` with real
   impls. Pass `scopedStateRef` so they consume floor-scoped state.
6. **BOQ emitter**: `src/boq/emitters/<discipline>.js`. Resolve
   quantities via `state.getXQuantities?.()` THEN fall back to
   `computeXQuantities(state)`. Wire into `src/boq/lines.js` at the
   end of `getBoqLines()`.
7. **BOQ section**: `src/components/boq/XBoqSection.jsx`. Purely
   presentational; takes `lines` prop. Wire into `BOQPanel.jsx`.
8. **UI**: `src/components/XPanel.jsx` + `src/components/canvas/XOverlay.jsx`.
   Use `<Panel>` + `<Modal>` primitives; lucide icons; design tokens.
9. **Toolbar + shortcut**: add a button to `Toolbar.jsx` + a bare-key
   shortcut to `useKeyboardShortcuts.js`. Mount panel in `App.jsx`.
10. **Layers**: add layer keys to `src/constants/layers.js`
    `DEFAULT_LAYER_VISIBILITY` and a group to `LayersPanel.jsx`.
11. **Validation rules**: optional; add to `src/mep/validation/rules/`,
    spread into `MEP_RULES` in `src/mep/validation/index.js`.
12. **Verify**: append assertions to `scripts/verify-mep.mjs` covering
    auto-suggest, system-graph correctness, routes generated, quantity
    aggregation by diameter/gauge, floor scope (per-floor + per-floor ≈
    total), BOQ emitter produces non-empty lines, and validation events
    surface correctly.

### What NOT to extract into MEP

- Pure topology questions ("are these two rooms adjacent?", "what's the
  centroid of this room?") — those live in `src/topology/`. MEP imports
  them.
- Pure geometry math (segment intersection, polygon containment) — that
  lives in `src/geometry.js`. Topology + MEP both call it.
- BOQ rendering primitives (`BoqRow`, `SectionHeader`, etc.) — those live
  in `src/components/boq/BoqRow.jsx`. MEP sections consume them.

## Plaster Quantities (v2 — ROOM_FACE_ACCUMULATION_V2)

Plaster math lives in **`src/quantities/plaster.js::computePlasterQuantities`**.
Two-pass topology model matches Indian residential BOQ practice.

### Two-pass model (canonical)

```
PASS 1 — Room iteration (Internal bucket):
  For each valid room (getValidRoomIds):
    For each wallId in room.wallIds:
      SKIP if wall.isVirtual || wall.isPlot
      accumulate state.getWallArea(wallId)   // single-face, openings-deducted
    Plus room.finishes.ceilingPlaster → state.getRoomArea(roomId)
  Plus per-column: getColumnPerimeterFt × per-floor exposed height
    (NOT structural state.getColumnHeightFt which includes plinth + slab).

PASS 2 — Wall iteration (External bucket):
  For each wall in state.walls:
    SKIP if isVirtual || isPlot
    SKIP if !isExternalWall(state, wallId)
    accumulate state.getWallArea(wallId)     // interpreted as OUTER face
```

### Face ownership matrix (no double-count by construction)

| Wall kind | Inner face(s) | Outer face | Bucket |
|---|---|---|---|
| **External** (adj=1) | counted ×1 in Pass 1 (one parent room) | counted ×1 in Pass 2 | inner→Internal; outer→External |
| **Partition** (adj=2) | counted ×2 in Pass 1 (each parent room) | none | both→Internal |
| **Plot** | — | — | EXCLUDED |
| **Virtual** | — | — | EXCLUDED |
| **Column** | perimeter × exposed-height | — | Internal (default system) |
| **Ceiling** (room flag) | floor area | — | Internal (room's system) |

Pass 2 (wall iteration) skips `!isExternalWall` so partitions never
enter the External bucket. Pass 1 (room iteration) only visits walls
in `room.wallIds`, which never contains an outer-face entry, so outer
faces never enter the Internal bucket.

### Opening subtraction contract

`getWallArea(wallId)` deducts opening area once per face. The
contract falls out naturally from the per-face iteration:

- **Partition opening:** deducted twice (each parent room's
  `getWallArea` call), both inside Internal bucket.
- **External opening:** deducted once inside Internal (room's inner
  face) + once inside External (outer face) = 2× total across the
  two BOQ lines.

The implementation **never accounts for openings explicitly** — it
just calls `getWallArea` once per face it intends to count.

### Wall height resolution

| Quantity | Height source |
|---|---|
| Wall plaster (inner + outer) | `wall.height` (existing, via `getWallArea`) — FFL to slab bottom |
| **Column plaster** | per-floor `floor.floorHeightFt` of `column.baseFloorId`, NOT the structural multi-span `state.getColumnHeightFt(col)` |
| Ceiling | `getRoomArea(roomId)` |

Multi-storey columns are plastered per floor — each floor's column
contribution uses that floor's exposed height. `boq/scope.js`
floor-scope filters `state.columns` per floor, so the per-floor sum
emerges naturally from the existing scope wrapper.

### BOQ output (visible finishes lines)

```
finishes_plaster_walls_internal  → "Plaster (internal walls + columns)"
                                    rateKey: plasterWallsInternal
                                    qty = plasterQ.totals.internalWallsAndColumnsFt2
finishes_plaster_walls_external  → "Plaster (external walls)"
                                    rateKey: plasterWallsExternal
                                    qty = plasterQ.totals.externalWallsFt2
finishes_plaster_ceiling         → "Plaster (ceiling)" (unchanged)
```

`plasterQ` is computed ONCE per `getBoqLines()` call near the top of
the finishes section, and reused for the per-system materials lines
in the plaster section (cement bags + sand m³ / gypsum kg / POP kg).
Single compute, two consumers.

### `_meta` payload (debug + popovers + audit)

Every return from `computePlasterQuantities` carries a `_meta` block:

```js
_meta: {
  algorithm:          'ROOM_FACE_ACCUMULATION_V2',
  calculationVersion: '<date-string>',
  floorId:            <scoped floor or null>,
  totalsByFace: {
    partitionInnerFaces, externalInnerFaces,
    externalOuterFaces,  columnFaces, ceilingFaces,
  },
  perRoom:         [{ roomId, plasterSystemId, wallContributions[{ wallId, wallType:'EXTERNAL'|'PARTITION', faceAreaFt2, openingDeductionFt2 }], wallSumFt2, ceilingFt2, isCeilingPlastered }],
  perColumn:       [{ columnId, columnTypeId, perimeterFt, exposedHeightFt, floorId, areaFt2, plasterSystemId }],
  perExternalWall: [{ wallId, lengthFt, heightFt, grossOuterAreaFt2, openings[], netOuterAreaFt2, plasterSystemId }],
  excluded:        { virtualWalls, plotWalls, invalidRooms },
  warnings:        [{ code, columnId?, message }],
}
```

Two version-tag fields by design — `algorithm` is a stable algorithm
identifier (changes only when the math model changes); `calculationVersion`
is a date-string that ticks every release. Comparing old PDFs vs
regenerated BOQs: `algorithm` explains WHY numbers differ;
`calculationVersion` explains WHEN they were regenerated.

**`_meta` is NEVER exported to PDF / Excel / CSV** — it's an internal
introspection aid consumed by formula popovers and DevTools.

### Mandatory invariant (locked in the function header)

> Quantity engines MUST NEVER consume rendered or visual geometry.
> Only topology APIs and canonical state geometry are allowed.
> No SVG-derived lengths, no overlay offsets, no visual wall thickness
> adjustments. Width × height × adjacency math from the store only.

This applies to every quantity aggregator under `src/quantities/`,
not just plaster.

### Adding / changing plaster rules

- New plaster system kind (e.g. dry-lining gypsum board): add to
  `src/specs/plasterSystems.js` with appropriate `appliesContext`
  ('internal' / 'external'). No changes to the aggregator needed if
  it's a cement-sand or gypsum/POP variant.
- Different default external system: update
  `DEFAULT_PROJECT_SETTINGS.defaultExternalPlasterSystemId` in
  `src/structuralSlice.js` + extend the Stage 0 T2 default-injection
  block in `store.js::loadProject` for old saves.
- Beam side faces (downstand) — deferred Phase 2.x. Add a project
  setting toggle + a third accumulation block in the room-iteration
  pass that consults `getAllBeams(state)`. Documented as a TODO in
  the function body.


- `getTotalWallArea()` iterates the walls map directly (not room.wallIds) to avoid double-counting shared walls. Do not change this.
- `getTotalPaintWallsArea()` iterates per room (not the walls map) because both faces of a shared wall between two painted rooms should be counted.
- `getMaterialQuantities()` iterates the walls map directly (same reason — each wall counted once for volume).
- Storage unit is **inches** throughout. `GRID_IN = 12`. Display converts to feet or metres at render time.
- `wall.materialKey` defaults to `'IS_MODULAR_BRICK'`. Always use `w.materialKey ?? 'IS_MODULAR_BRICK'` when reading it (migration guard for in-memory state that bypassed loadProject).
- `BONDING` enum keys are `CEMENT_SAND` and `THIN_BED`; the values are the longer strings. Check bondingType with `=== BONDING.CEMENT_SAND`, never with the value string directly.
- `getConcreteByGrade()` field names end in `DRY`: `sandM3DRY`, `agg10mmM3DRY`, `agg20mmM3DRY`. No bare `.sandM3` field exists.
- `getAllBeams()` is the single consumer for beam rendering + BOQ. Never call `getDerivedWallBeams()` or iterate `state.beams` directly for quantity work.
- `BEAM_LEVEL_REGISTRY` is the single source for beam levels. Never hardcode `['plinth','lintel','roof']` anywhere.
- Column shape logic lives in `src/lib/columnShapes.js`. Never branch on `ct.shape` outside that file.
- `getFootingQuantities()` is keyed by column type id, not footing type id. `footingTypeId` does not exist on column types in the current model.
- Canvas SVG layer order (bottom→top): room fills → stamps → walls → beams → ghost → nodes → columns → UI overlays → room labels. `layerVisibility` guards each section.
- **Fix 1 — foundation ownership.** `column.foundationId` does not exist. Read attachment via `getFoundationForColumn(state, columnId)` or `getColumnsByFoundation(state, foundationId)`. Mutate via `attachColumnToFoundation` / `detachColumnFromFoundation` (and the wall equivalents). Never traverse `state.foundations` inline to find a column's parent.
- **Fix 2 — column height.** Always use `state.getColumnHeightFt(col)`. Never recompute via `plinth + floor + slabThk` because multi-span columns will be wrong. The helper spans `[baseFloorId, topFloorId]` in the sequence-ordered floor stack.
- **Fix 3 — slab role.** A slab's structural role is `slab.role` / `slab.classification`. Derive via `inferSlabRole(state, floorId)` (`'ROOF' | 'FLOOR' | 'SUNKEN' | 'STAIR_LANDING'`). Never branch on `slab.type` for role logic — type is layout (MAIN/SUNKEN), role is structural.
- **Selector discipline.** Floor scoping flows through topology:
  `getColumnsOnFloor / getWallsOnFloor / getSlabsOnFloor / getStampsOnFloor /
  getRoomsOnFloor / getBeamsOnFloor / getStaircasesOnFloor /
  getFoundationsOnFloor / getEntitiesOnFloor` (and the Set variants
  `getNodeIdsOnFloor`, `getWallIdsOnFloor`) all live in
  `src/topology/floor.js`. Store + structuralSlice methods are one-line
  delegations. No inline `.filter(e => e.floorId === ...)` in components,
  quantity functions, or validation rules. See the dedicated **Topology
  Layer** section above for the full module map and invariants.
- **Topology layer is the canonical spatial-relationship surface.** Every
  question of the form "which X is related to Y?" goes through
  `src/topology/`. Beam endpoint resolution → `resolveBeamEndpoint` (one
  home, was 5× duplicated). Node↔column index → `getNodeToColumnIndex`.
  Wall adjacency → `getWallAdjacencyCount`. Wall-surface ownership →
  `getWallSurfaces`. Room adjacency for MEP routing →
  `getRoomAdjacencyGraph`. Wet-wall set → `getWetWalls`. New discipline
  engines (MEP, interiors, fabrication) consume these — never reimplement.
- **Foundation BOQ pipeline.** `computeFoundationQuantities(state)` is the per-type geometry source. `getFoundationQuantities()` keeps the inline `byColumnTypeInline` path for legacy columns with no foundation attached. `boq/lines.js`, `excavation.js`, `shuttering.js` all read from `computeFoundationQuantities`.
- **Room overlap is same-floor only.** `saveRoom`, `getOverlappingRoomName`, `getValidRoomIds` (pairwise loop), and the `loadProject` dev-warning all filter by `room.floorId === subject.floorId` before running the overlap check. Identical or overlapping footprints across floors are the expected case for multi-storey buildings — never conflicts.
- **PILE foundation emits TWO RCC BOQ lines.** Cast-in-situ pile shaft concrete and on-top pile-cap concrete are distinct procurement pours. `boq/lines.js` and `StructuralBOQSection.jsx` both branch on `f.type === 'PILE'` to emit `_rcc_shaft` + `_rcc_cap` (separate rateKeys); all other foundation types emit a single combined `_rcc` line. `computeFoundationQuantities` carries `shaftVolFt3` / `capVolFt3` / `pileGeometry` alongside the combined `concreteVolFt3` so steel/concrete-mix aggregators stay simple.
- **Foundation entities render in the Structural RCC section.** `StructuralBOQSection.jsx` consumes `computeFoundationQuantities().perFoundation` (not just `getFootingQuantities`'s inline-by-columnType subset), and includes `fdnEntities.length > 0` in its `hasRCC` gate. Foundation-only projects (PILE/RAFT/etc. with no columns) still render the section header.
- **BOQ row React key is composite `${rateKey}::${infoId}`.** Multiple BOQ rows legitimately share a rateKey (steel grouped-by-spec lines) OR an infoId (concrete grade rows sharing one formula popover). Either alone is non-unique; the composite guarantees uniqueness in both directions. Defined in the `row` helper at the top of `StructuralBOQSection.jsx`.
- **PCC depth display rounds via `NumField`'s `decimals` prop.** PCC bedding default is `PCC_BEDDING_THICKNESS_FT = 2/12 ft` (0.16666…). `FoundationPanel` passes `decimals={2}` to every PCC/plum-depth NumField; the helper formats with `toFixed(2)` as a STRING (not `Number(...)`) so trailing zeros survive ("0.10" stays "0.10", not "0.1"). Display only — stored value is untouched.
- **Topology is floor-scoped.** Spatial alignment across floors does not imply shared ownership. Vertical relationships must be explicit, never inferred from shared node identity. Two corners at the same XY on different floors are TWO distinct node entities — not one shared geometric point. Vertical-spanning entities (multi-storey columns via `baseFloorId/topFloorId`, staircases via `fromFloorId/toFloorId`) carry their own explicit floor identifiers; nothing is inferred from spatial collision.
- **Node ownership via `floorIds[]`.** Every node carries `floorIds: string[]` — required, non-empty, length 1 today, future-proof for vertical shafts and staircase cores. All three node creators in `store.js` (`getOrCreateNode` fresh + auto-split branches, `splitWall` midpoint) stamp `floorIds` at creation. Auto-split + `splitWall` midpoints INHERIT from the wall (`[wall.floorId]`), not from `currentFloorId` — this matters for programmatic `splitWall(..., { force: true })` calls across floors. Snap-during-draw uses `state.getNodeIdsByFloor(currentFloorId)`; cross-floor coordinate collisions create distinct nodes by design.
- **Floor-scoped wall checks.** `addWall` runs duplicate + collinear-overlap checks only against `state.getWallIdsByFloor(currentFloorId)`. Identical wall geometry on two floors is the expected case for multi-storey buildings. The plot polygon stays floor-agnostic (site boundary is single).
- **`splitWall` floor-defensive.** A `splitWall(wallId, x, y)` call where `wall.floorId !== currentFloorId` returns `null` and pushes a `cross_floor_split_attempt` warning into `state.validationEvents`. Programmatic callers (DXF / clone tools) bypass with `{ force: true }`. No `console.warn` anywhere — all signal flows through `runValidation()`.
- **Steel BBS resolution — centralized only.** All reinforcement-spec fallback chains run through `src/specs/resolution.js`. UI panels, `quantities/bbs.js`, and `boq/lines.js` never branch on `entity.reinforcementSpecId`, `columnType.reinforcementSpecId`, or `projectSettings.bbsDefaults` directly — they call `resolveColumnReinforcementSpec` / `resolveBeamReinforcementSpec` / `resolveSlabReinforcementSpec` / `resolveFootingReinforcementSpec`. Each returns `{ spec, specId, specLabel, source }` with `source ∈ INSTANCE | TYPE | CLASS | PROJECT_DEFAULT | ESTIMATE`. Adding a new fallback tier = edit `resolution.js` only.
- **Grouped-by-spec steel BOQ.** `boq/lines.js` emits one steel line per resolved spec group from `computeBBSQuantities().groupedBySpec[category]`, plus at most one `(Estimate, kg/m³)` line per category covering the un-BBS'd pool. Never one BBS line and one estimate line that double-count the same entities.
- **Partial BBS coverage via excludeIds.** `getSteelQuantities(opts)` accepts `{ excludeColumnIds, excludeBeamIds, excludeSlabIds, excludeFoundationIds, excludeColumnTypeFootingIds }` (Sets or Arrays). `computeBBSQuantities(state).excludeIds` is the source — `boq/lines.js` passes the entire object through. Excluded entities contribute zero to the kg/m³ estimate for their category so BBS and estimate cleanly coexist.
- **`bbsDefaults.BEAM` is per-class** (`{ plinth, lintel, roof }`). Never flat. No global beam fallback by design — unset class → ESTIMATE for that class.
- **Use `beamClass` in new APIs.** New resolvers, aggregator outputs, and UI surface `beamClass`. The existing `beam.level` storage stays; readers use `beam.beamClass ?? beam.level` for compatibility. `BEAM_LEVEL_REGISTRY` ids ARE the beam-class ids.
- **Wall-derived beams are unselectable.** Only explicit beams accept a per-instance spec — wall-derived ones resolve straight to CLASS → ESTIMATE. Canvas click handler ignores them; `BeamPanel` returns null on derived ids (which never appear in `state.beams`).
- **Floor scope in BOQ.** Never compute per-floor BOQ via `lines.filter(...)` after `getBoqLines()`. Store selectors are bound to live `get()` and ignore any scoped state passed as argument. Use `getBoqLines(state, rates, { floorId })` which routes through `scopeStateToFloor` in `src/boq/scope.js`. When adding a new aggregator that needs floor scoping, add its re-implementation to `scope.js` alongside the others; pure-function quantities in `src/quantities/` auto-scope and need no change.
- **BOQ rendering — canonical pipeline only.** `BOQPanel` computes `canonicalLines = getBoqLines(state, rates, { floorId })` once and slices via `groupBoqLinesByCategory`. Every BOQ section component (`StructuralBOQSection`, `ShutteringSection`, `ExcavationSection`, `PlasterSection`, `PlumConcreteRow`) is **purely presentational** — it accepts a pre-filtered `lines: BoqLine[]` prop and renders rows. Sections do NOT call `useStore`, do NOT call store selectors, do NOT re-derive quantities. Shared primitives (`BoqRow`, `BoqSubRow`, `BoqTotalRow`, `SectionHeader`, `SubSectionHeader`, `fmtLineQty`) live in `src/components/boq/BoqRow.jsx`. Masonry / civil / finishes groupings inside `BOQPanel` itself also consume `canonicalLines` slices (grouped via `line.meta.materialKey` for masonry, `id` prefix for civil). Header summary stats (wall count, total length, wall area, floor area, stamp counts) come from `scopedState = scopeStateToFloor(state, currentFloorId)` so they honor the floor toggle. Adding a new BOQ category = emit lines from `boq/lines.js` with the right `category` field; if rendering needs grouping, group on `line.meta.*`.
- **Project manager snapshot caching.** `listProjects()` and `getCurrentProjectId()` MUST keep stable references between calls. `notify()` invalidates the in-module caches before fanning out. Required by `useSyncExternalStore` in `ProjectsPanel`.
- **PDF currency.** Default jsPDF helvetica lacks `U+20B9`. Use the ASCII `Rs. ` prefix in `src/export/pdf.js`. Excel uses formulas (`=C*D`) so the column header carries the currency note instead.
- **No new libraries without asking** — but `jspdf`, `jspdf-autotable`, `xlsx` (Phase 2.0) and `lucide-react` (UI Phase 2) were explicitly approved.
- **Design tokens are the only source for color / spacing / typography / radius / shadow / z-index / motion.** Defined in `src/design/tokens.css`; consumed via `var(--color-...)` etc. No raw hex literals or px values for these concerns in component code. See "UI Design System" section for the exhaustive variable list. Greppable check on any new file: `grep -n "#[0-9a-fA-F]\{3,6\}" <file>` must return nothing in style values.
- **Use UI primitives — never hand-roll.** `<Button>` for any styled button, `<Panel>` for side panels, `<Modal>` for centered overlays (backdrop + ESC + focus trap are owned by the primitive — don't reimplement), `<Field>` for label + input pairs, `<Dropdown>` + `<DropdownGroup>` + `<DropdownItem>` + `<DropdownToggle>` + `<DropdownSegmented>` for cluster menus (used by the toolbar; available to any panel that needs a flyout list). All in `src/components/ui/`.
- **Toolbar is config-driven via `src/components/toolbarConfig.js`.** Adding a new tool = one entry in `TOOL_CLUSTERS`. `Toolbar.jsx` is purely a renderer that iterates the config and dispatches by item type (`tool` / `toggle` / `segmented` / `action`). Active-cluster detection runs through `collectToolIds(cluster)` from the same file. NEVER inline tool definitions in `Toolbar.jsx` — the registry is the single source of truth.
- **Cross-component close events: `toolbar:close-dropdowns`** is the toolbar's equivalent of `boq:toggle`. Dispatched on every keyboard shortcut that affects tool state (see `useKeyboardShortcuts.js`) AND on every `DropdownItem` click (the primitive dispatches it before bubbling). Each open `<Dropdown>` listens and closes itself. Use this same window-event pattern for any future cross-component toggle that shouldn't reach into the store. Namespace new events under `panel:` / `toolbar:` / `boq:` so they're greppable.
- **Plaster math lives ONLY in `src/quantities/plaster.js::computePlasterQuantities`** (algorithm tag `ROOM_FACE_ACCUMULATION_V2`). Two-pass model — room iteration → Internal bucket (partition walls counted on both inner faces, external walls on inner face, columns by perimeter × per-floor exposed height, ceiling per room); wall iteration → External bucket (each external wall's outer face). Plot + virtual walls excluded in both passes. `boq/lines.js` calls the aggregator ONCE and uses the result for both visible BOQ lines AND the per-system materials rows — never compute plaster numbers anywhere else. The legacy `state.getTotalWallArea()` is masonry-only (single-face by design); never use it for plaster. See "Plaster Quantities (v2)" section above.
- **Quantity engines must never consume rendered or visual geometry.** Only topology APIs and canonical state geometry (walls, nodes, rooms, columns, beams, openings as stored). No SVG-derived lengths, no overlay offsets, no visual wall thickness adjustments. This invariant is documented inside `computePlasterQuantities` and applies to every aggregator under `src/quantities/` — width × height × adjacency math from the store only.
- **Selected opening as first-class entity.** Doors and windows are clickable on the canvas — `state.selectedOpening = { wallId, openingId } | null`. `selectOpening(wallId, openingId)` action clears every other entity selection (mutually exclusive panel UX). `updateOpening(wallId, openingId, fields)` is the generic partial update with type-swap normalization (door→window clears orient + sets hasSunshade=false; window→door clears hasSunshade + sets orient=0) and clamps width/height/offset against wall length inside the action. `OpeningDetailPanel.jsx` self-mounts on `selectedOpening`; `removeOpening` auto-clears the selection when it deletes the selected opening; `deleteWall` auto-clears when the parent wall is removed. Canvas hit-targets only fire when `activeTool === 'select'` (so draw / room / etc. clicks fall through). Del/Backspace deletes opening before falling through to wall delete.
- **No `window.alert / .confirm / .prompt` in component code.** Use `dialog.alert / .confirm / .prompt` (imperative API from `src/components/ui/Dialog.jsx`). The fallback path inside `Dialog.jsx` itself is the only allowed usage. After a destructive action with the `dialog.confirm` gate, fire `toast.action(msg, { label: 'Undo', onClick: () => undo(), duration: 5000 })`.
- **Toolbar buttons use `lucide-react` icons exclusively.** No emoji anywhere in UI output. Active tool state via `variant="primary"` (token-driven), inactive via `variant="ghost"`. Never inline `background:` for active state.
- **BOQ rows use the `1fr 76px 104px 90px` grid.** Rate inputs are composed `.boq-rate-input` divs with a `₹` prefix span — never bare `<input>`. Row striping via `.boq-group .boq-row:nth-of-type(even)`. Sections wrap their rows in `<div class="boq-group">` to scope the striping.
- **BOQ line click → entity selection.** `BoqRow`/`BoqSubRow` accept optional `onSelectEntity` prop; `BOQPanel` threads a centralized handler that dispatches `selectWall/selectRoom/selectColumn/selectBeam/selectStamp` based on `line.sourceEntityIds[0]`. New BOQ emitters in `boq/lines.js` should populate `sourceEntityIds: [...]` to unlock click affordance — sections stay purely presentational.
- **Validation issues are navigable.** Each issue in the BOQ footer is a `<button>` calling the same `selectX` action by `issue.entityType` + `entityId`. Unselectable issues carry `data-no-target=""` to suppress the hover affordance.
- **Keyboard shortcuts via `src/hooks/useKeyboardShortcuts.js`.** Mounted once in `App()`. Bare-key shortcuts (Esc/Del/D/S/R) are auto-suppressed in form inputs; modifier shortcuts (Ctrl+Z/Y/S) fire everywhere. New shortcuts go in this hook only — don't sprinkle keydown handlers across components.
- **Canvas selection pulse is keyed by entity id.** `<element key={`pulse-${selectedId}`}>` forces React to remount the pulse element on selection change, restarting the CSS animation. Don't change the pulse duration (600ms) or make it loop.
- **Desktop-only.** Minimum viewport is 1024px enforced by `DesktopGate` wrapper in `App.jsx`. Below that, the entire app shell is replaced by a splash card. Don't add media queries to "support" smaller viewports — the gate is the design.
- **Animation budget: 100-150ms with `var(--ease-out)`.** The 2s bobbing arrow in the canvas empty state is the SOLE sanctioned infinite animation in the app — don't add others. `prefers-reduced-motion` collapses all transitions globally (the rule lives at the bottom of `ui.css`).
- **BOQ collapsible state is persisted in `localStorage['boq_panel_collapsed']`.** The keyboard hook (`useKeyboardShortcuts.js`) dispatches `window.dispatchEvent(new CustomEvent('boq:toggle'))` on `Ctrl/Cmd+B`; `BOQPanel.jsx` listens for that event and flips state. **Use this same window-event pattern for any future cross-component toggle that shouldn't reach into the store** — it keeps the keyboard hook decoupled from concrete component imports. Add new event names under the `boq:` / `panel:` namespace.
- **MEP system pipeline is the canonical path for every discipline.** User places fixture/point → `buildXSystemGraph` (logical connectivity) → `buildXRoutes` (spatial polylines along zones) → sizing strategy (`CATALOG | HUNTER | LOAD_BASED | GRADIENT_DRAIN`) → `computeXQuantities` → BOQ emitter (`src/boq/emitters/<discipline>.js`) → `src/boq/lines.js` → BOQ section component. NEVER recompute spatial relationships in MEP — always go through `src/topology/`. NEVER hardcode diameters / wattages / IS-732 caps — always read from `src/mep/catalogs/`.
- **Topology APIs added for MEP (lands in `src/topology/`, not MEP).** `getFloorWallPerimeterGraph(state, floorId)` is the LOAD-BEARING primitive — every discipline's routing BFS's over it. Plus `getRoomWallPerimeterGraph`, `getCeilingPaths`, `getRoomCentroid`, `getRoofPolygon`, `getShaftPolygons`, `getNearestWallToPoint`, `getExternalAccessibleWalls`, `getColumnFloorSpans`. Per-floor memo cells keyed on `state.walls` + `state.nodes` refs; invalidate on Zustand mutation.
- **scope.js MEP aggregator wrappers are load-bearing.** 5 disciplines × 3 layers = 15 active wrappers in `scopeStateToFloor` (Solar deferred = 3 stubs remain). Forgetting one silently corrupts multi-floor BOQ for that aggregator. `verify-mep.mjs` per-floor + per-floor ≈ total assertions catch this. When completing Solar or adding a 7th discipline: replace stubs (`getXNetwork`, `getXRoutes`, `getXQuantities`) with real impls calling the discipline modules, passing `scopedStateRef`.
- **MEP routing zones (`src/mep/shared/routingZones.js`).** Six zones: `WALL` (1.00×), `CEILING` (1.05×), `FLOOR` (1.00×), `SHAFT` (1.05×), `EXTERNAL` (1.10×), `UNDERGROUND` (1.00×). Quantity engines apply `zoneMultiplier` to polyline lengths. Each discipline's routing module exports a `classifyZone(edge, ctx)` callback. Fitting transitions (wall→ceiling) generate elbows via `fittingCounter`.
- **MEP risers are cross-discipline + cross-floor.** Single `state.risers` map with `kind ∈ { PLUMBING_SUPPLY, SOIL_STACK, RAINWATER_DOWN, HOT_WATER_RISER, ELECTRICAL_SUBMAIN, HVAC_REFRIGERANT, HVAC_CONDENSATE, FIRE_MAIN, ELV_TRUNKING, SOLAR_DC_RISER, SOLAR_AC_RISER }`. Visible in scoped state on BOTH `fromFloorId` and `toFloorId` (mirrors staircase rule). Quantities count their length ONCE at the project level — NOT per floor.
- **MEP sizing strategies are pluggable per discipline.** `projectSettings.mepSizing = { PLUMBING, ELECTRICAL, HVAC, FIRE, ELV, SOLAR }`, each value ∈ `{ CATALOG, HUNTER, LOAD_BASED, GRADIENT_DRAIN }`. Default `'CATALOG'`. Each discipline's `sizing.js` reads `state.projectSettings.mepSizing?.[discipline]` and dispatches to the right strategy in `src/mep/shared/sizingStrategy.js`. HUNTER walks fixture units → catalog `fixtureUnitsCarried`. LOAD_BASED applies IS-732 voltage-drop (3% limit at 230V, pf 0.85). GRADIENT_DRAIN tags edges with 1/80 (soil) or 1/40 (waste).
- **MEP BOQ emitters fall back gracefully.** Each `src/boq/emitters/<discipline>.js` resolves quantities via `state.getXQuantities?.()` (scope wrapper) THEN falls back to `computeXQuantities(state)` (live state). This means both the floor-scoped path AND the call-from-the-live-store path work without code duplication. Forgetting the live-state fallback = BOQ silently empty when called without `floorId`.
- **MEP BOQ section components are purely presentational.** `PlumbingBoqSection`, `ElectricalBoqSection`, `HvacBoqSection`, `FireBoqSection`, `ElvBoqSection` accept `lines: BoqLine[]` props. They NEVER call `useStore`, NEVER call store selectors, NEVER re-derive quantities. All grouping happens via `meta.system` / `meta.lineType` on the lines themselves. Adding a new MEP discipline's BOQ section = mirror an existing one.
- **MEP UI mounts in App.jsx, gated on selection state.** Five panels: `PlumbingFixturePanel`, `ElectricalPointPanel`, `HvacPanel`, `FirePanel`, `ElvPanel`. Each self-gates on its own `selectedXId`. No prop drilling. Mount once.
- **MepDefaultsModal listens for `mep:room-created` window event.** `RoomPanel.jsx::saveRoom` dispatches the event after creation. The modal lazy-imports `suggestXForRoom` from each discipline and renders checkbox lists. Apply button calls `applyRoomMepDefaults({ plumbing, electrical, hvac, fire, elv })`. New disciplines plug into this modal by adding their lazy-import + suggestion group.
- **MEP canvas overlays render in fixed order in `Canvas.jsx`.** Bottom to top inside the MEP block (after structural overlays, before nodes/columns): `PlumbingOverlay → ElectricalOverlay → HvacOverlay → FireOverlay → ElvOverlay → ClashOverlay`. ClashOverlay always rendered last so clash markers sit visually above all routes. Don't reorder without re-checking layer-visibility hit-test priority.
- **Clash detection is pure-function + frozen severity matrix.** `src/mep/shared/clashDetection.js::detectClashes(routes, options)` takes a combined route array and returns deterministic clash events. Severity from frozen `SEVERITY_MATRIX` (alphabetically-sorted keys). 6-inch snap-grid dedup. Wired through `src/mep/validation/rules/mep_clash_detected.js` into `runValidation`. The validation engine was patched to support per-issue severity (each clash carries its own severity) — `it.severity ?? rule.severity` fallback in `src/validation/engine.js`. Backward-compatible with rules that don't set per-issue severity.
- **MEP entities are IFC-ready from day one.** Every entity carries `discipline`, `type`, `ifcType` (from `catalogs/ifcClasses.js`), `classificationCode` (Uniclass via `catalogs/classificationCodes.js`), `systemId`, `systemType`. Don't store UI-only fields on entities — selection / hover / edit state stays in component-local React state. This unlocks future Phase 3 IFC export without schema rework.
- **MEP catalogs are versioned + frozen.** Every catalog file (`src/mep/catalogs/*.js`) exports `CATALOG_VERSION` (date-IS-spec format like `'2026-05-IS-15778'`) and `CATALOG_SOURCE` (`'IS 15778:2007'` etc.). Every registry array + entry is `Object.freeze`-d. Every catalog exports `getX(id)` lookup + `listX()` array accessor. `CATALOG_VERSIONS` manifest in `src/mep/catalogs/index.js` enumerates all 24 versions for audit traceability in PDF/Excel exports. Phase 2 ERP swap path = replace catalog files in-place with ERP-backed providers exposing the same API surface; engines unchanged.
