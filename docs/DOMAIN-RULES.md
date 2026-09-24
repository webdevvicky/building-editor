# Domain Rules — BOQ / Building Editor (`boq`)

> **What this is.** The editor's domain and engineering rules, each with its **status today** and its **authority**.
> Until 2026-09-24 these rules lived as about 29 "Locked rules" and equivalent blocks scattered through the phase log,
> now archived at `boq:docs/archive/2026-09/CLAUDE-phase-history.md`. This file replaces that log as the place to
> read rules. The log stays as history.
>
> **Related.** Workflow rules (how to work in this repo) are in [`CLAUDE.md`](../CLAUDE.md). Architecture and the
> Known Defects register (KD-n) are in [`docs/CODEBASE_MAP.md`](CODEBASE_MAP.md). The BBS engineering basis is in
> [`docs/bbs/BBS-CATEGORIES-RESEARCH.md`](bbs/BBS-CATEGORIES-RESEARCH.md). Cross-repo defects are canonical in
> `erp-saas:docs/audit/2026-09-23-CODEBASE-AUDIT.md` (XR-nn). Owner decisions are in
> `erp-saas:docs/architecture/DECISION-REGISTER.md`; open questions are in `erp-saas:docs/planning/OPEN-DECISIONS.md`.

## How to read this file

**Authority.** Every rule below is an **adopted design basis; the decider is not recorded**, unless it says
otherwise. The phase log called these rules "locked", but no owner is named on any of them. Only two editor rules
carry a recorded owner sign-off (§11.1). BBS choices made by the build agent are kept apart in §11.3 and are
**not** owner or engineer signed.

**Status** (checked against `main` @ `eda690f`, 2026-09-24, unless the evidence cell says otherwise):

| Status | Meaning |
|---|---|
| **TRUE** | The code does this today (evidence given) |
| **TRUE (not re-checked)** | No contrary evidence; not re-verified in the 2026-09-23/24 passes |
| **STALE** | The rule's detail no longer matches the code |
| **VIOLATED** | The code does the opposite |
| **NOT ENFORCED** | The rule is stated but code breaks it in places (usually a KD row) |
| **DORMANT** | The rule governs code that does not run in production (`src/operations/`, `src/compute/`) |
| **NOT BUILT** | A requirement with no implementation yet |

**Citations.** "§X :N" means section X of `boq:docs/archive/2026-09/CLAUDE-phase-history.md`, at about line N.
Line numbers are from commit `eda690f`; the archive banner may shift them by a line or two.

---

## 1. Walls and wall topology

### 1.1 Phase W — wall topology integrity
Source: `boq:docs/archive/2026-09/CLAUDE-phase-history.md` §Phase W › Locked rules (:768) and › Invariants (:829).

| Rule | Status | Evidence |
|---|---|---|
| A wall's identity (`id`, `ifcGlobalId`) is stable across T-junction attachment. Only `splitWall` (two new walls, fresh ids) and `joinWalls` (survivor keeps its id) change identity | TRUE (not re-checked) | — |
| `wall.junctions` is unordered; order comes from `getOrderedWallJunctions` | TRUE (not re-checked) | — |
| Mid-span draw never splits; it creates a T-junction node. Auto-split is removed | TRUE | `CLAUDE.md` rule 2; map §9 |
| The explicit Split tool is the only way to fragment a wall. It stamps `splitOrigin: 'USER_SPLIT'` and propagates openings, MEP fixtures, foundation/room `wallIds` and junctions through `planWallSplit` | TRUE | `store.js:1019,1035,1173` |
| Split refuses cleanly (`opening-straddles-split`, `junction-near-split`, `split-too-close-to-endpoint`); state unchanged | TRUE (not re-checked) | — |
| `canMergeWalls` is conservative: false negatives are acceptable, false positives are forbidden | TRUE (not re-checked) | — |
| `room.wallIds` is deduplicated membership; polygon geometry comes from `room.nodeOrder` | TRUE (not re-checked) | — |
| `room.nodeOrder` is a derived snapshot; `recomputeRoomNodeOrder` wins on mismatch | TRUE (not re-checked) | — |
| Expanded-graph edges are keyed `${wallId}::${segmentIndex}::${from}::${to}`; `wallId` alone is never a traversal key | TRUE (not re-checked) | — |
| Adjacency is classified per segment (`classifySegment`); aggregators that classify by adjacency iterate segments | TRUE (not re-checked) | — |
| No migration code: projects predating the schema fail to load by design | **See conflict C-1** | `store.js:2234-2239` keeps a legacy-save branch |
| **INV-W1…INV-W10** (wall n1/n2 not in own junctions; TJUNCTION two-way ref; TJUNCTION on centerline within `SNAP_IN`; opening offsets in range; MEP `wallT ∈ [0,1]` on an existing wall; foundation `wallIds` exist; `room.wallIds` deduped; `nodeOrder` empty or a valid closed polygon; `splitOrigin ∈ {NONE, USER_SPLIT}`; junctions ≥ `SNAP_IN` apart) | **NOT ENFORCED at runtime** | Implemented in `schema/integrity.js:280-315` and asserted by verify scripts only; production `loadProject` never calls `verifyIntegrity` (map §3.5) |

### 1.2 Phase W follow-up — Manual Join
Source: `boq:docs/archive/2026-09/CLAUDE-phase-history.md` §Phase W follow-up › Locked rules (:911).

| Rule | Status |
|---|---|
| Re-read store state after any `await` before mutating the store | TRUE (not re-checked) |
| Clear hover-preview state before selecting a survivor entity | TRUE (not re-checked) |
| Refusal-reason → message maps use a `?? DEFAULT_MESSAGE` fallback | TRUE (not re-checked) |
| Sibling-discovery scans are floor-scoped (`getActiveFloorWalls`) | TRUE (not re-checked) |
| New tools are entries in `toolbarConfig.js` `TOOL_CLUSTERS`, never inline in `Toolbar.jsx` | TRUE (not re-checked) |

### 1.3 Phase RoomConverge — Phase W contract restated
Source: `boq:docs/archive/2026-09/CLAUDE-phase-history.md` §Phase RoomConverge › Locked rules (:200).

One wall is one full-length entity. T-junctions are first-class. No auto-split and no manual per-room split. A room
boundary that needs part of a wall uses a sub-span between T-junctions via the expanded graph. **TRUE** (`CLAUDE.md`
rule 2). The two workflow rules in the same block ("Canvas/UI verify discipline", "Single source of truth over
layered fallbacks") moved to `CLAUDE.md` § Working rules.

### 1.4 Phase D — face-aware draw reference
Source: `boq:docs/archive/2026-09/CLAUDE-phase-history.md` §Phase D › Locked rules (:466).

| Rule | Status | Evidence |
|---|---|---|
| Canonical wall storage is the **centerline**; draw modes convert at the authoring boundary and nothing downstream knows the mode | TRUE | `src/draw/faceToCenterline.js`; map §9 |
| Closure detection runs on the face buffer, before conversion | TRUE (not re-checked) | `faceToCenterline.js` header `CLOSURE-IN-FACE-SPACE` |
| Snap overrides mode at a click vertex that resolves to an existing centerline target | TRUE (not re-checked) | — |
| `getSnapRef(targetKind)` in `snap/targets.js` is the single snapRef classification authority | TRUE (not re-checked) | — |
| One offset kernel (`_offsetClosedPolygon` / `_offsetOpenPolyline`) serves clear-internal inset, built-up offset and face→centerline | TRUE (not re-checked) | — |
| A collapsed conversion is refused with a validation event and toast; nothing is committed; no clamping | TRUE (not re-checked) | — |
| Buffer-then-commit applies only when `drawReference !== 'centerline'`; switching mode mid-trace discards the buffer | TRUE (not re-checked) | — |
| `dimensionMode` (labels on existing geometry) and `drawReference` (meaning of future clicks) are orthogonal | TRUE (not re-checked) | — |
| Default `drawReference` is `'inside_face'` (Indian/RERA tracing) for new and old projects | TRUE | `structuralSlice.js:120` |

### 1.5 Phase 6 — dimension convention: 10 corrections and locked rules
Source: `boq:docs/archive/2026-09/CLAUDE-phase-history.md` §Phase 6 › 10 architectural corrections (:1224) and
› Locked rules added by Phase 6 (:1278).

| Rule | Status | Evidence |
|---|---|---|
| C1: `getRoomPolygonInsetEdges` returns `EffectiveRoomEdge[]`; polygon points derive from edges; consumers match by wall identity | TRUE (not re-checked) | — |
| C2: canvas wall labels use `getEffectiveWallLengthFt` / `getRoomGeometry`, never a half-thickness approximation | TRUE (not re-checked) | — |
| C3: miter cap = `3 × max(adjacent half-thicknesses)` | TRUE (not re-checked) | — |
| C4: a collapsed polygon returns zero-area edges flagged `_collapsed`, never `null` | TRUE (not re-checked) | — |
| C5: Enter ends a wall chain (as double-click / Esc) | TRUE (not re-checked) | — |
| C6: rectangle room (nodes, walls, room, auto-MEP, naming) is one history frame via `_runAtomically` | TRUE (not re-checked) | `CLAUDE.md` § Architecture |
| C7: templates hold the model only (no history, selection, hover, tool, caches, `_inBatch`); `buildSnapshot` is the shape | TRUE (not re-checked) | — |
| C8: `schema/integrity.js` `FK_DESCRIPTORS` (+ `FLOOR_REF_DESCRIPTORS`) is the single FK authority; every new cross-entity reference is added there | TRUE (not re-checked) | `verify-templates` asserts it |
| C9: all effective room geometry goes through `getRoomGeometry`; centerline-only consumers (masonry, structural, MEP routing) are the documented exemption | TRUE (not re-checked) | — |
| C10: 200-config fuzz testing for inset polygons | TRUE (not re-checked) | `verify-dimension-mode` |
| Inset wall-area math iterates `geom.insetEdges`; the external outer face stays centerline | TRUE (not re-checked) | — |
| New projects default `dimensionMode = 'clear_internal'`; **legacy saves stay `'centerline'`** | TRUE in code, **conflicts with greenfield** | `store.js:2234-2239`; see conflict C-1 |
| Quantity engines never consume rendered geometry | TRUE | §6.4 |

### 1.6 Rev 2 — joinery, tiles, grills, room-wise BOQ
Source: `boq:docs/archive/2026-09/CLAUDE-phase-history.md` §Rev 2 › Architectural rules locked by Rev 2 (:2976) and
› Grep guards (:3054).

| Rule | Status | Evidence |
|---|---|---|
| Scope wrappers filter entities only; aggregators own their attribution policy (masonry HALF_PARTITION ×0.5, plaster DUAL_FACE, tiles INTERIOR_ONLY, joinery/grills OWNING_ROOM) | TRUE (not re-checked) | — |
| Perimeter / longest edge / linear feet derive from the `getRoomPolygon` edge loop, never from summing `room.wallIds` lengths | TRUE (not re-checked) | `topology/rooms.js` |
| Joinery units: frame `2(w+h)/12` Rft; shutter `wh/144` Sft; ventilator area Sft | TRUE (not re-checked) | — |
| `wall.hasBalconyRailingEdge: boolean \| null` (null = heuristic) | TRUE (not re-checked) | — |
| Every BOQ line carries `scopeSupport ⊆ {PROJECT, FLOOR, ROOM, ROOM_TYPE}`; `filterLinesByScope` is the single filter | TRUE | `boq/lines.js:609`; `constants/boqCategories.js:63` |

---

## 2. Rooms and building area

### 2.1 Phase R1 — room detection
Source: `boq:docs/archive/2026-09/CLAUDE-phase-history.md` §Phase R1 › Locked rules (:964).

| Rule | Status | Evidence |
|---|---|---|
| `topology/faces.js` is pure and Node-testable | TRUE (not re-checked) | `verify-room-detection` grep |
| All room creation goes through `saveRoom` | TRUE | `store.js:630` (rect room), `:677` (`createRoomFromFace`) |
| Topology never creates entities by itself; rooms are always user-authored | TRUE (not re-checked) | — |
| Courtyards / nested rooms: refuse (overlap rejection) | TRUE (not re-checked) | — |
| Face enumeration = next-CCW-edge traversal; equivalent faces canonicalise to the same `wallIds` | TRUE (not re-checked) | — |
| The hover-preview cache invalidates with the face-table memo | TRUE (not re-checked) | — |
| Room overlap is checked **same-floor only** | TRUE (not re-checked) | §Gotchas (:5023) |

### 2.2 Phase BA — carpet and built-up area
Source: `boq:docs/archive/2026-09/CLAUDE-phase-history.md` §Phase BA › Locked rules (:595).

| Rule | Status | Evidence |
|---|---|---|
| The built-up loop walker uses angular (next-CCW) continuation, never a degree-2 assumption | TRUE (not re-checked) | — |
| Loop orientation comes from the room's CCW `nodeOrder`; sign drives aggregation (outer CCW adds, courtyard CW subtracts); never "largest loop is outer" | TRUE (not re-checked) | — |
| `getTotalFloorArea` is kept because `excavation.js` reads it | **STALE** | `excavation.js:44-48` now computes its own `buildingFootprintFt2`; `getTotalFloorArea` still exists (`store.js:2404`, `boq/scope.js:113`) |
| `computeCarpetAreaSft` is independent of `dimensionMode` (always clear-internal) | TRUE (not re-checked) | — |
| Built-up captures un-roomed enclosed space next to rooms; a perimeter with zero rooms gives built-up 0 | TRUE (not re-checked) | — |

---

## 3. Snap

### 3.1 Phase A — snap architecture
Source: `boq:docs/archive/2026-09/CLAUDE-phase-history.md` §Phase A › Locked rules (:1067).

| Rule | Status | Evidence |
|---|---|---|
| `src/snap/` is pure and Node-testable | TRUE (not re-checked) | `verify-snap` bootstrap grep |
| Every drawing click goes through `resolveSnap`; `screenToWorld` is removed; only split, stamp drag and underlay calibration use `screenToWorldRaw` | TRUE | `geometry.js:30` |
| Comparator `tier → distance → policyIndex → sortKey`; tier 0 always beats tier 1 (GRID); deterministic | TRUE (not re-checked) | `verify-snap` §G |
| NODE and WALL_ENDPOINT are not deduplicated | TRUE (not re-checked) | `snap/targets.js` header |
| Per-tool tolerance overrides live in `TOOL_SNAP_POLICY`, not project settings | TRUE (not re-checked) | — |
| MEP placement falls through to GRID when no wall is in range | TRUE (not re-checked) | — |
| Bypass key `projectSettings.snap.bypassKey` (default Alt); F9 toggles snap via `'snap:toggle'` | TRUE | `structuralSlice.js:313`; `Canvas.jsx:444` |

### 3.2 Phase B — UNDERLAY_FEATURE snap contract
Source: `boq:docs/archive/2026-09/CLAUDE-phase-history.md` §Phase A › Phase B compatibility audit — contract notes
locked (:1124). **Governs unbuilt code**: UNDERLAY_FEATURE is a contract for a future target; `verify-snap` §F
exercises it with a stub.

Rules: registers as tier 0; `query()` is synchronous and reads a cache filled by `prepare(state, signal)`, which is
never awaited; a new `prepare` aborts the previous one; `sourceId` is polymorphic (`string | {kind,…} | null`);
`displayLabel` / `renderOverlay` are per-target (no `switch(targetKind)`); `defaultSettings` is open per target and
deep-merged by `loadProject`; cache keyed `${floorId}:${storageKey}`; distance is inches.

---

## 4. Structure: beams, columns, foundations, slabs

### 4.1 Phase BeamConnect
Source: `boq:docs/archive/2026-09/CLAUDE-phase-history.md` §Phase BeamConnect › Locked rules (:120), and §Topology
Layer › Topology invariants (:4539).

| Rule | Status | Evidence |
|---|---|---|
| `resolveBeamEndpoint` is the single accessor for beam-endpoint geometry (BBS, BOQ, shuttering, 2D, 3D, validation); `null` means skip | TRUE | `topology/beams.js:32`, 13 importers, no direct `beam.start/end` access |
| Beam endpoints are a 4-type union `COLUMN / BEAM / WALL / POINT`; beams never reference nodes | TRUE | `schema/entities/beam.js`; `CLAUDE.md` rule 4 |
| Parent delete detaches (frozen POINT with `detachedFrom`), never drops geometry; `beam_circular_ref` (ERROR) guards cycles | TRUE (not re-checked) | — |
| BBS per-endpoint anchorage: BEAM = interior (Ld/2, no hook), WALL = bearing, COLUMN/POINT = exterior heuristic | TRUE | `beamRebar.js:19,55` — the default itself is an unsigned choice, §11.3 |

### 4.2 Structural gotchas
Source: `boq:docs/archive/2026-09/CLAUDE-phase-history.md`, the unheaded gotcha list after §Plaster Quantities
(:4990-5073).

| Rule | Status | Evidence |
|---|---|---|
| `getAllBeams()` is the single consumer for beam rendering and BOQ; never `getDerivedWallBeams()` or `state.beams` directly for quantities | TRUE (not re-checked) | — |
| `BEAM_LEVEL_REGISTRY` is the single source for beam levels; never hard-code `['plinth','lintel','roof']` | **VIOLATED** (KD-41) | `components/OpeningPanel.jsx:235`; `schema/entities/beam.js:36` (`oneOf`) |
| Tie beam is never in `BEAM_LEVEL_REGISTRY` | TRUE (the choice is unsigned, §11.3) | `constants/structural.js:67-95` |
| Column shape logic lives only in `lib/columnShapes.js` | TRUE (not re-checked) | — |
| Fix 1: `column.foundationId` does not exist; use `getFoundationForColumn` / `attachColumnToFoundation` | TRUE (not re-checked); dead scrub remains | map §11 (`structuralSlice.js:990`) |
| Fix 2: column height only via `state.getColumnHeightFt(col)` | TRUE (not re-checked) | — |
| Fix 3: slab role is `slab.role` / `classification` via `inferSlabRole`; never branch on `slab.type` for role | TRUE (not re-checked) | cited by `schema/entities/slab.js:7` |
| Foundation quantities come from `computeFoundationQuantities`; PILE emits two RCC lines (shaft + cap) | TRUE (not re-checked) | — |
| Topology is floor-scoped: vertical relationships are explicit (`baseFloorId/topFloorId`, `fromFloorId/toFloorId`), never inferred from coincident XY; nodes carry `floorIds[]` | TRUE (not re-checked) | — |
| `splitWall` on another floor returns `null` with a `cross_floor_split_attempt` event (unless `{force:true}`) | TRUE (not re-checked) | — |
| Reinforcement-spec fallback chains run only through `specs/resolution.js` (`source ∈ INSTANCE/TYPE/CLASS/PROJECT_DEFAULT/ESTIMATE`) | TRUE (not re-checked) | — |
| `bbsDefaults.BEAM` is per class; unset class → ESTIMATE | TRUE (not re-checked) | — |

---

## 5. Topology layer
Source: `boq:docs/archive/2026-09/CLAUDE-phase-history.md` §Topology Layer › Topology invariants — mandatory (:4539)
and › What NOT to extract (:4605).

| Rule | Status | Evidence |
|---|---|---|
| Pure spatial math lives in `geometry.js`; state-reading relationships live in `src/topology/`, one module per relationship kind | TRUE (not re-checked) | — |
| Topology functions take `state` (live or floor-scoped wrapper) and never mutate the store | TRUE (not re-checked) | — |
| Memoisation via `createMemo()` (reference equality only) | TRUE | map §3.9 |
| No inline `Object.values(state.walls).filter(...)` outside `src/topology/` and `store.js` | TRUE | grep 2026-09-24: 0 hits outside those paths |
| `getWallSurfaces` / `getRoomSurfaces` own face↔room determination; `getRoomAdjacencyGraph` is symmetric and never crosses floors | TRUE (not re-checked) | — |
| `WET_ROOM_TYPES` in `topology/wet.js` is the single wet-room list | TRUE | `topology/wet.js:15` |

---

## 6. Quantities and the editor BOQ

### 6.1 Phase BOQ-WorkQty
Source: `boq:docs/archive/2026-09/CLAUDE-phase-history.md` §Phase BOQ-WorkQty › Locked rules (:33).

| Rule | Status | Evidence |
|---|---|---|
| `labelNo` is assign-once element identity; the rendered label is derived at read time, so adding a floor never renumbers | TRUE | `boq/elementLabels.js:12`; `store.js:61,1930` |
| `meta.role ∈ WORK_QTY \| MATERIAL` | TRUE (not re-checked) | — |
| `getMasonryByThickness` mirrors each builder's masonry attribution | TRUE (not re-checked) | — |
| Per-wall room detail derives from `plaster._meta.perRoom.wallContributions` | TRUE (not re-checked) | `RoomDetailPanel` has its own per-wall math — KD-38 |
| Exporters consume the presentation model only | TRUE | §6.2 |

### 6.2 BOQ extension — presentation model and "Rules locked" 1–7
Source: `boq:docs/archive/2026-09/CLAUDE-phase-history.md` §BOQ extension › Canonical presentation model
(LOAD-BEARING) (:2333), › GAP 2 Contingency (:2378), › Rules locked (:2604); and cross-cutting rule 11 (:1679).

| Rule | Status | Evidence |
|---|---|---|
| `computeBoqPresentationModel` is the single object both exporters read; exporters do no independent math | TRUE | `export/excel.js:21`, `export/pdf.js:21,168` |
| Contingency never applies to `nos` / `set` / `lumpsum` units | TRUE | `boq/_contingencyResolver.js:20` |
| `projectCosts` renders in the Summary block only, never as BOQ lines | TRUE | no `project_costs` category in `boq/lines.js` |
| `efficiencyFactor` and `perimeterBased` are reserved schema slots | TRUE (not re-checked) | — |
| Mosquito mesh (`qtyMode: 'AREA'`) is priced by opening area | TRUE (not re-checked) | — |
| Per-room overrides: `null` = inherit project default; do not add per-room-type maps without asking | TRUE (not re-checked) | — |
| Rule 7 "greenfield honoured: consumer-side `?? defaultX` fallbacks let legacy saves load" | **See conflict C-1** | This is itself a legacy-save allowance |

### 6.3 Plaster v2
Source: `boq:docs/archive/2026-09/CLAUDE-phase-history.md` §Plaster Quantities (v2) (:4850) › Mandatory invariant
(:4964); gotcha (:5047).

| Rule | Status | Evidence |
|---|---|---|
| Plaster math lives only in `computePlasterQuantities` (`ROOM_FACE_ACCUMULATION_V2`): room pass → internal bucket, wall pass → external outer faces; plot and virtual walls excluded; `boq/lines.js` calls it once | TRUE | `quantities/plaster.js:4,322` |
| `getTotalWallArea()` is masonry-only (single face); never use it for plaster | TRUE (not re-checked) | — |

### 6.4 Quantity-engine invariant
Source: §Plaster v2 › Mandatory invariant (:4964); gotcha (:5048); Phase 6 (:1278).

Quantity engines must never consume rendered or visual geometry: only topology APIs and canonical stored geometry.
Applies to every aggregator under `src/quantities/`. **TRUE (not re-checked).**

### 6.5 Other quantity gotchas
Source: gotcha list (:4990-5073).

| Rule | Status |
|---|---|
| `getTotalWallArea()` and `getMaterialQuantities()` iterate the walls map (each wall once); `getTotalPaintWallsArea()` iterates rooms (both faces) | TRUE (not re-checked) |
| Storage unit is inches (`GRID_IN = 12`); display converts | TRUE (not re-checked) |
| Compare `bondingType` with `BONDING.CEMENT_SAND`, never the value string | TRUE (not re-checked) |
| `getConcreteByGrade()` fields end in `DRY` (`sandM3DRY`, …) | TRUE (not re-checked) |
| Per-floor BOQ only via `getBoqLines(state, rates, {floorId})` → `scopeStateToFloor`; never filter lines afterwards | TRUE (not re-checked) |
| BOQ section components are presentational (take `lines`, no `useStore`) | TRUE (not re-checked) |
| Steel BOQ: one line per resolved spec group plus at most one estimate line per category, no double count; partial coverage via `excludeIds` | TRUE (not re-checked); but the steel itself comes from the legacy path — KD-29 |

### 6.6 Feet-inches display
Source: `boq:docs/archive/2026-09/CLAUDE-phase-history.md` §Feet-Inches Display Mode › Locked rules (:2894).

| Rule | Status | Evidence |
|---|---|---|
| State stores decimal feet (or inches where it already does) | TRUE (not re-checked) | — |
| `lib/units.js` owns every feet/inches glyph; no `Intl.NumberFormat` | TRUE | grep `.toFixed(2)} ft` in `src/` = 0 |
| Sub-foot values render inches-only (`9"`, never `0'-9"`) | TRUE (not re-checked) | `verify-units` |
| PDF and Excel route quantities through `formatQuantity()` | TRUE (not re-checked) | — |
| Areas/volumes use Sft/Cft in `ft` and `ft-in` modes | TRUE (not re-checked) | — |
| Panel length inputs use `<FeetInchesInput>` / `<InchesInput>` | TRUE (not re-checked) | `RoomDetailPanel` ignores ft-in — KD-38 |

---

## 7. MEP
Source: `boq:docs/archive/2026-09/CLAUDE-phase-history.md` §MEP System › MEP invariants (non-negotiable) (:4708);
gotcha list (:5060-5073).

| Rule | Status | Evidence |
|---|---|---|
| No spatial-relationship math in `src/mep/`; relationships go through `src/topology/` | TRUE (not re-checked) | — |
| Catalogs are data: every diameter, default and IS load cap lives in `mep/catalogs/`, each exporting `CATALOG_VERSION` + `CATALOG_SOURCE`, frozen | TRUE (not re-checked) | `verify-catalog-provenance` |
| `scope.js` MEP wrappers (`getXNetwork/Routes/Quantities`) exist per shipped discipline; forgetting one corrupts multi-floor BOQ | TRUE (not re-checked) | Canvas overlays select non-existent `get<X>Routes` — KD-22 |
| Risers are one cross-discipline, cross-floor map; length counted once per project | TRUE (not re-checked) | — |
| Sizing strategy per discipline via `projectSettings.mepSizing` (default `CATALOG`) | TRUE (not re-checked) | — |
| Deterministic routing (explicit comparators, `<` not `<=`, sorted Set iteration) | TRUE (not re-checked) | — |
| BOQ emitters use the scope wrapper, then fall back to `computeXQuantities(state)` | TRUE (not re-checked) | Emitters read wrong engine keys — KD-27 |
| MEP entities are IFC-ready (`discipline`, `type`, `ifcType`, `classificationCode`, `systemId`, `systemType`) | TRUE (not re-checked) | — |
| MEP catalogs are the "ERP swap path": replace catalog files with ERP-backed providers exposing the same API | NOT BUILT | Owner decision "ERP is catalog source of truth" is recorded as D-012 (boq Decision 4) in `erp-saas:docs/architecture/DECISION-REGISTER.md`; editor catalogs are still frozen arrays |

---

## 8. Identity, persistence and state architecture

### 8.1 Phase 5 — 9 architectural additions and locked rules
Source: `boq:docs/archive/2026-09/CLAUDE-phase-history.md` §Phase 5 › 9 architectural additions (:1476) and › Locked
rules added by Phase 5 (:1503).

| Rule | Status | Evidence |
|---|---|---|
| ADD 1: `slab.roleSource: 'AUTO' \| 'MANUAL'` | TRUE (not re-checked) | — |
| ADD 2: MEP override resolution centralised in `mep/resolution.js` | TRUE (not re-checked) | — |
| ADD 3 / rule: cross-canvas highlights live in `state.selection.*`, written via `setSelection(partial)` | TRUE | `store.js:897` |
| ADD 4 / rule: binary assets go through `projects/storage/assets.js` → IDB, never localStorage; new types extend `ASSET_TYPES` | TRUE | `assets.js:59` |
| ADD 5: IDB schema versioning + forward-migration chain | **Partly DORMANT** | `IDB_MIGRATIONS` used by `idbAdapter.js:78`; `projects/schemaVersion.js` `runMigrations` has no importer in `src/` |
| ADD 6: slab fills are translucent solids, no SVG patterns | TRUE (not re-checked) | — |
| ADD 7: room BOQ memo keyed on `[roomId, boqRevision, ratesRevision]` | TRUE (not re-checked) | — |
| ADD 8 / rule: underlay calibration stored in image-pixel space; `inchesPerPixel` is the single scale | TRUE (not re-checked) | — |
| ADD 9: Underlay layer group hidden when no underlay exists | TRUE (not re-checked) | — |
| The underlay never enters BOQ or exports | TRUE | no `underlay` reference in `export/excel.js` / `export/pdf.js` |
| `useSyncExternalStore` snapshots return a stable reference (frozen `_EMPTY` singleton) | TRUE | `revisions/manager.js:101-105` |
| `manager.js` async writes serialise via `_enqueueWrite` | TRUE (not re-checked) | — |
| `buildSnapshot` lives in `projects/_snapshot.js` | TRUE | `CLAUDE.md` § ERP Sync |

The block's "Never scope down without approval" rule is a workflow rule and moved to `CLAUDE.md`.

### 8.2 Cross-cutting C1–C8 and rules 9–13
Source: `boq:docs/archive/2026-09/CLAUDE-phase-history.md` §Enterprise architecture upgrade › Locked rules
(cross-cutting — load-bearing) (:1679); inline "Locked rule" bullets in §Phase 3 (:1900-1953) and §Phase 1 + Phase 2
(:2040-2236).

The block's preamble says "verify scripts fail CI on violation". **STALE:** there is no CI and no git hook; nothing
runs the verify scripts automatically (`CLAUDE.md` § Verification).

| # | Rule | Status | Evidence |
|---|---|---|---|
| C1 | Every registered operation declares `kind ∈ {user, system, transient}` | **DORMANT** | `src/operations/` is not a write path (map §3.10; `CLAUDE.md` § Architecture) |
| C2 | Operation `apply()` handlers never generate ids | **DORMANT** | same |
| C3 | No Web Workers without profiling proof (`runInWorker: true` throws) | **DORMANT** | `src/compute/` has no production caller (`compute/registry.js:14,26`) |
| C4 | IDB chunks store plain JSON; no compression without telemetry | TRUE (not re-checked) | — |
| C5 | Every legacy shim declares a `killBy` date; the build fails after it | **VIOLATED** | Kill date 2026-08-15 passed with 50 accessors still registered; `verify-legacy-shim` fails and nothing gates on it (`store/legacyAccessors.js:41`; KD-31) |
| C6 | Every computation node declares a compute class | **DORMANT** | `src/compute/` |
| C7 | Every validation rule declares a scope; ERROR rules are never dismissable; dismissal keys include `ruleVersion` | TRUE (not re-checked) | `validation/registry.js` |
| C8 | Internal `id` is runtime-only; exports, revisions, persistence, journals and dismissals use `ifcGlobalId` | TRUE with a documented exception | Floors sync by their `id` (`'F1'`), not an IFC id (`CLAUDE.md` § ERP Sync). Enforced by `verify-id-exposure` on `src/export/` only |
| 9 | Every state-building verify script asserts `verifyIntegrity(state).valid` first (pure-math scripts exempt) | TRUE (not re-checked) | — |
| 10 | Data–UI sync: every `projectSettings` subtree, override slot and BOQ category has UI (also "Locked rule (Phase 4)", :1862) | **NOT ENFORCED** | Setters with no UI caller: `setGrills`, `setKitchenCounter`, `setWallLoft`, `setWallLoftSpec`, `setWallTieBeam`, `setOpeningSunshadeSpec`, `setStaircaseReinforcementSpec` (map §11) |
| 11 | The presentation model is the single source for export totals | TRUE | §6.2 |
| 12 | No local `r2()` outside `lib/numbers.js` | TRUE | `verify-lints` rule 1 (passes) |
| 13 | `crypto.randomUUID()` only in `lib/ids.js` | TRUE | only `lib/ids.js:22` calls it |

Other inline rules from the same phases:

| Rule | Status | Evidence |
|---|---|---|
| Every entity carries `id` (UUID) and `ifcGlobalId` (22-char IFC GUID), minted only in `lib/ids.js`; `loadProject` backfills | TRUE | `CLAUDE.md` rule 6; `verify-ifc-ids` |
| New normalisations land in entity schemas (`default`, `legacyAliases`), not ad-hoc `loadProject` passes | TRUE (not re-checked) | ad-hoc passes still exist in `loadProject` |
| Every schema change lands as a `MIGRATIONS` entry | **DORMANT, and conflicts with greenfield** | `runMigrations` has no importer; `CLAUDE.md` rule 8 says "no migrations" — see conflict C-2 |
| Every `CATALOG_VERSION` export is registered in the catalog manifest | TRUE | `verify-catalog-provenance` |
| Boundary invariants: view-slice fields never in history; history never in model snapshots; every store field classified | TRUE (not re-checked) | `verify-state-boundaries` |
| Kill-switch: `LEGACY_ACCESSORS` must be empty after 2026-08-15 | **VIOLATED** | same as C5 |

---

## 9. 3D iso viewer
Source: `boq:docs/archive/2026-09/CLAUDE-phase-history.md` §3D Iso Viewer — rotation › Locked rules (:2655).

| Rule | Status | Evidence |
|---|---|---|
| `makeViewBasis(view)` is the single trig site of the projection | TRUE | `iso/projection.js:48,59-70` (the `Math.cos/sin` in `iso/solids.js:70` builds circle geometry, not the projection) |
| Default view `{az 45, el 30}` reproduces the historical fixed formula within 1e-9 | TRUE (not re-checked) | `verify-iso-projection` |
| Azimuth is compass-style (0 = N, 90 = E) | TRUE (not re-checked) | — |
| `iso/viewPresets.js` is the single source of preset angles; top view uses a separate orthographic basis at el ≥ 89.5° | TRUE | `iso/viewPresets.js` |
| Sort tiebreak chain `depth → z → entityId → faceKind → originalIndex`; React keys are stable composite keys | TRUE (not re-checked) | — |

---

## 10. UI conventions (not domain rules)

The UI design-system rules are not repeated here. Read them in
`boq:docs/archive/2026-09/CLAUDE-phase-history.md` §UI Design System (Imperative-API rule :3994, Panel patterns
:4002, What NOT to do :4191) and the gotcha list (:5040-5060). One spot-check: no `window.alert/confirm/prompt`
outside `components/ui/Dialog.jsx` — **TRUE** (grep 2026-09-24).

---

## 11. BBS (bar bending schedule)

### 11.1 Owner-signed

These are the only two BBS/editor rules with a recorded owner sign-off.

| Rule | Owner record | Status |
|---|---|---|
| **Bar length is an explicit per-project user choice** (Procurement dropdown 12 / 9 / 6 m in the BBS Specs panel) | D-114. Owner quoted as "Make it an explicit user choice in ProjectSettingsPanel" (`boq:docs/archive/2026-09/BBS_MORNING_REPORT.md`, "6 m → 12 m bar-length diff") | **TRUE** — `components/BBSSpecPanel.jsx:430-440`. The **default value** is not owner-signed: see §11.3 row 1 |
| **BBS-UI-Enablement**: because new BBS categories are default-inert, the input UI must make category enablement explicit (per-category toggles, "not enabled" hints in the BBS schedule panel) | D-115. "Owner sign-off recorded" — `boq:docs/archive/2026-09/CLAUDE-phase-history.md` §Phase BBS-Categories › Next-phase requirement (signed off 2026-05-29) (:429) | **NOT BUILT.** No component sets `wall.hasTieBeam` or `subSuperColumnSplitEnabled`; `setWallTieBeam`, `setWallLoft`, `setWallLoftSpec` have no caller (map §11); `BBSSchedulePanel.jsx` has no enablement hints |

### 11.2 Engineering implementation rules (decider not recorded)
Source: `boq:docs/archive/2026-09/CLAUDE-phase-history.md` §Phase BBS › Locked rules (:253), §Phase BBS-Categories
› Locked rules (:361) and › P0 follow-up (:406).

These are software-structure rules. They say how the engine is built, not what the steel quantity should be.

| Rule | Status | Evidence |
|---|---|---|
| The IS 2502 catalog (`specs/cuttingLength.js`, read via `getIs2502Params`) is the single source for every bend, hook, lap, Ld, crank and bar length; no magic numbers in generators | **NOT ENFORCED** | BOQ steel is priced from the legacy `computeBBSQuantities` path (KD-29); D²/162 is re-implemented 3× (map §9); generators carry hard-coded fallbacks (KD-40) |
| RebarGroup is computed, never persisted (`computeRebarGroups` regenerates deterministically) | TRUE | map §9 |
| "The legacy `computeBBSQuantities` path is untouched; both coexist" | **Misleading** | The legacy path is the live source of every BOQ steel line (`boq/lines.js:37,248`); the BBS panel uses `computeRebarGroups`. Two steel numbers exist (KD-29) |
| "No legacy backward-compat tolerance": verify-bbs asserts hand-computed IS values exactly | Half true | New path asserted exactly (`verify-bbs.mjs:244`), but the legacy buggy numbers are also pinned (`verify-bbs.mjs:269-271,539-541`) |
| `wall.wallBeamSpecs` is the WALL_INSTANCE tier for wall-derived beams | TRUE (not re-checked) | — |
| Slab span/width from `getRoomGeometry(roomId, 'centerline')`, never `√area` | TRUE (not re-checked) | the span/width derivation is an approximation, §11.3 |
| Footings emit dowels as a separate `REBAR_ROLE.DOWEL` group (L-shape) | TRUE (not re-checked) | — |
| Footing per-bar Ld uses the bar's own diameter | TRUE (not re-checked) | — |
| Footing / strap-pad mesh bar = `padDim − 2×cover + 2 end hooks` (BE-Footing-Ld-001 fix) | TRUE (not re-checked) | verify-bbs §D |
| `allowanceMm({kind, diaMm, params})` is the single switch point for hooks/bends/anchorage/lap; generators never inspect `allowanceMode` | TRUE (not re-checked) | — |
| `meta.bbsCategory` is the Level-2 taxonomy; `getBarMarkPrefix` is the single mark-prefix registry (grid labels may override for columns and strap footings) | TRUE (not re-checked) | — |
| `meta.beamBehavior ∈ FRAME \| BAND`; band beams (tie/lintel) skip confinement | TRUE (not re-checked) | — |
| Sub/super split is per segment on one column entity (`meta.segmentType`) | TRUE (not re-checked) | — |
| Export builders are pure; all three output levels reduce over `computeRebarGroups` | TRUE (not re-checked) | `verify-bbs-export` |
| Explicit beams INTERIOR; slabs `useSeparateTopBars` | TRUE | `beamRebar.js:19,55`; `slabRebar.js:15,115` |

### 11.3 BBS engineering choices — NOT owner/engineer signed

> **These are choices the build agent made while building BBS (2026-05-28/29).** The phase log called several of them
> "Locked rules", and the morning reports asked the owner to sign them off. **No sign-off exists.** No qualified
> engineer has reviewed them. They are **not** locked and **not** owner invariants. Each is an open question in
> `erp-saas:docs/planning/OPEN-DECISIONS.md` §17; the OQ column gives its ID. OQ-034, OQ-037, OQ-041, OQ-044, OQ-045
> and OQ-052 are further BBS choices listed only there. The full classification, with IS 456
> clauses, is in the consolidation evidence (A21 §2.3, working file outside the repo). Do not change a default below
> without an owner or engineer decision, and do not cite it as settled.

| # | OQ | Choice | Where | Concern |
|---|---|---|---|---|
| 1 | OQ-029 | Standard bar length default **12 m** | `cuttingLength.js:71`; `reinforcementSpecs.js:36`; `BBSSpecPanel.jsx:440` | **Conflicting records.** The 2026-05-28 morning report says "default stays 6 m per your choice"; the phase log says "flipped 6 → 12" with no owner quote; `cuttingLength.js:20-24,60-62` comments still say 6 m |
| 2 | OQ-030 | Default lap **56.6d** (IS 456 tension lap) rather than 50d site practice | `cuttingLength.js:111,125` | Which convention the company quotes is a product decision; legacy presets still carry `lapLengthMultiplier: 50` |
| 3 | OQ-031 | Column bar lap uses the tension lap | `columnRebar.js:119` | IS 456 allows the shorter compression lap; heavier than required |
| 4 | OQ-032 | `bbsAllowanceMode` default IS_STRICT; SITE_PRACTICE values taken from one contractor workbook | `structuralSlice.js:254`; `cuttingLength.js:208-225` | One workbook becomes "site practice" for every tenant |
| 5 | OQ-033 | Hook = 9d, labelled site shorthand, used in IS_STRICT mode | `cuttingLength.js:52-56` | The "IS_STRICT" label is misleading |
| 6 | OQ-035 | Seismic lap 1.3×Ld cited to IS 13920 | `cuttingLength.js:104-108` | Citation unverified |
| 7 | OQ-036 | **IS 13920 confinement zones default OFF** | `cuttingLength.js:136,151` | Code compliance vs site practice; inconsistent with the 135° seismic hook default |
| 8 | OQ-028 | **Cover defaults below IS 456**: column 25 mm, beam 25, footing 40, slab 20 | `reinforcementSpecs.js:68,79,99`; `footingRebar.js:175` | IS 456 26.4.2 requires column ≥ 40 mm and footing ≥ 50 mm; the repo's own research says column 40, footing 50–60 (`bbs/BBS-CATEGORIES-RESEARCH.md`) |
| 9 | OQ-038 | Explicit beams default INTERIOR (Ld/2, no hook), described as "conservative" | `beamRebar.js:53-56` | It under-estimates steel |
| 10 | OQ-039 | Two-way slab: main both ways, no distribution, no corner torsion steel | `slabRebar.js` | IS 456 Annex D-1.8 torsion steel omitted |
| 11 | OQ-040 | Slab main bars get full Ld at both ends | `slabRebar.js:110` | Heavier than IS minimums |
| 12 | OQ-042 | Bar-count rule differs: stirrups `ceil(L/s)`, mats `floor(L/s)+1` | `columnRebar.js:224`; `beamRebar.js:299`; `slabRebar.js:56` | Needs one rule |
| 13 | OQ-043 | Pieces by weight, no cutting-stock optimisation, **no wastage** | `bbs/index.js:280` | The workbook uses 2.5% wastage on loft |
| 14 | OQ-046 | Default grade Fe500D + M20 | `cuttingLength.js:130-131` | Tenant/project default |
| 15 | OQ-047 | New categories are **default-inert** (opt-in) | §Phase BBS-Categories (:361) | Only the UI consequence was signed (§11.1), and that UI is not built |
| 16 | OQ-048 | **Tie beam is BBS-only** (not in `BEAM_LEVEL_REGISTRY`), so its concrete and masonry deduction are absent from the BOQ | same | Chosen to keep `verify-boq` byte-identical — a test-stability reason, not a domain one |
| 17 | OQ-049 | Loft TOP + BOTTOM mats "per the locked decision" | `bbs/BBS-CATEGORIES-RESEARCH.md` §4 | The same doc lists it as an assumption to confirm with an engineer; no decider exists |
| 18 | OQ-050 | Loft thickness 4 in hard-coded; sunshade 1.5 ft / 3 in fallbacks; loft embed ≥ 230 mm | `bbs/concrete.js:101`; `sunshadeRebar.js:42-43` | KD-40 |
| 19 | OQ-051 | Strap pad bottom-only mesh; strap not ductile; sub-column = full plinth height | `strapFootingRebar.js` | Research doc: "to confirm with an engineer" |
| 20 | OQ-053 | Column/beam concrete split into categories ∝ steel kg | `bbs/concrete.js` | The proportional split is arbitrary |
| 21 | OQ-054 | RAFT / STRIP / PILE footings return `[]` (zero steel, no warning) | `bbs/generators/footingRebar.js:43` | Scope; silent zero |
| 22 | OQ-055 | Beam curtailed/extra bars, sunshade bar axis, slab double-mat layout not modelled | `bbs/BBS-VALIDATION-KARTHICK.md` punch list 3–5 | Scope |
| 23 | OQ-027 | **Which steel number is authoritative**: editor BOQ (legacy path, KD-29), BBS panel (`computeRebarGroups`), or the ERP "BBS-direct" path (receives nothing — KD-7) | — | Top open item; see conflict C-4 |

The ±15% column tolerance proposed in the 2026-05-28 morning report was reversed by the "no legacy tolerance" rule;
it is not a live choice.

---

## 12. Known conflicts

| # | Conflict | Evidence | Resolution path |
|---|---|---|---|
| C-1 | **Greenfield vs legacy-save code.** `CLAUDE.md` rule 8 and the greenfield rule (`boq:docs/archive/2026-09/CLAUDE-phase-history.md` §Greenfield Development (MANDATORY MINDSET) :3219: "never preserves legacy branches") vs a live legacy-save branch: loaded projects without `dimensionMode` stay `'centerline'`, new projects get `'clear_internal'` (`src/store.js:2234-2239`). BOQ-extension rule 7 (:2629) also treats `?? defaultX` fallbacks for legacy saves as "greenfield honoured". Phase W says pre-schema projects "fail to load by design" | code + phase log | Owner/architecture question. Not in the KD register today. No code change made |
| C-2 | "Every schema change lands as a `MIGRATIONS` entry" (§Phase 1 + Phase 2 :2159) vs greenfield "no migrations" (`CLAUDE.md` rule 8) | `projects/schemaVersion.js` `runMigrations` has no importer | Greenfield wins in practice; the migration rule governs dormant code |
| C-3 | "Revisions / design history are permanent" (`CLAUDE.md` rule 7) vs erp-saas 48A Decision 5 (D-037, a proposal: drafts prunable, 90-day draft retention) | `erp-saas:docs/architecture/48A_PHASE0_DECISION_RECORD_AND_PLAN.md`; KD-16, KD-17 | The recorded owner rule (D-084) is about ERP BOQ versions; extending it to editor design history is not owner-confirmed. Open question OQ-077 in `erp-saas:docs/planning/OPEN-DECISIONS.md` |
| C-4 | **"BBS never leaves the editor"** (`CLAUDE.md` § ERP Sync) vs the ERP BBS-direct steel path, which expects editor bars (`erp-saas` `structural-quantity.service.ts:46-50`). The projection sends no sections, concrete or bars | KD-7 = `erp-saas:docs/audit/2026-09-23-CODEBASE-AUDIT.md` XR-02 | Contradictory design, not just a bug. Open question OQ-027 (§11.3 row 23) |
| C-5 | Bar-length default 12 m vs the owner's recorded "default stays 6 m" (D-114) | §11.3 row 1 | Open question OQ-029 |
| C-6 | "IS 2502 catalog single source" and "legacy untouched, both coexist" vs the legacy path pricing all BOQ steel | KD-29 | Defect; rule kept unweakened |
| C-7 | `BEAM_LEVEL_REGISTRY` single source vs hard-coded level lists | `OpeningPanel.jsx:235`; `schema/entities/beam.js:36` | Defect: KD-41 (`docs/CODEBASE_MAP.md` §10) |

---

## 13. Code comments that cite "CLAUDE.md §…"

Sections cited by code comments as "CLAUDE.md §…" are in `boq:docs/archive/2026-09/CLAUDE-phase-history.md`, or
here. Code comments are not edited (documentation-only change).

| Comment | Cites | Resolves to |
|---|---|---|
| `src/schema/entities/slab.js:7` | "CLAUDE.md Fix 3" | this file §4.2; archive §Architectural Fixes (:3332) and gotchas (:5004) |
| `src/materials.js:8` | "Known issues" | archive §Known issues / Phase 2 backlog (:4218) |
| `src/components/StampPanel.jsx:176` | "Known Issues" | archive §Known issues / Phase 2 backlog (:4218) |
| `src/snap/resolver.js:99` | "Phase A — Snap Architecture" | this file §3.1; archive §Phase A (:1026) |
| `src/hooks/useKeyboardShortcuts.js:9` | BOQ-collapse window-event pattern | archive gotcha list (:5059) |
| `src/components/PDFPagePickerModal.jsx:10` | "pattern documented in CLAUDE.md" | archive §UI Design System (:3918) (Modal / panel patterns) |
| `src/boq/roomBreakdown.js:19` | "feature notes" | archive §Phase BOQ-WorkQty (:11); this file §6.1 |
| `src/boq/scope.js:722` | "Attribution Policies" | **No such section ever existed** in CLAUDE.md or docs (git history search). Nearest: this file §1.6 (Rev 2 attribution policies) |
| `src/mepSlice.js:3` | "MEP plan §6.1" | **Not in any repo doc.** The MEP plan was never committed. Nearest: this file §7 |
| `src/components/Canvas.jsx:1897,1901` | "MEP plan §16.2" | Same — not in any repo doc; overlay order is in the archive gotcha list ("MEP canvas overlays render in fixed order") |
| `src/mep/hvac/routing.js:23` | "MEP plan §13.4" | Same — not in any repo doc |
