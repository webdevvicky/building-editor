# Building Editor — Developer Notes

## Current Phase Status

Phase 1a–1c-4 + Phase 1.5 + Stage 0 + Phase 1.6 + Architectural Fixes 1–4 +
Phase 1.8 + Phase 1.9 + Phase 1.7 + Phase 2.0 complete on `main` (2026-05-16).

ERP integration (replace static MATERIAL_LIBRARY + add live rate catalog) is
the next major work item; foundation for it is in place via the canonical
`getBoqLines()` pipeline.

---

## MCP-First Rule (MANDATORY)
Query Context7 before writing any code that uses:
- React 19 hooks or new APIs
- Vite 8 configuration
- Zustand 5 store patterns
- jsPDF / jspdf-autotable
- SheetJS (xlsx)
Training data for these versions is outdated.

## Verification Commands
node scripts/verify-boq.mjs        # 77 single-floor checks (incl. per-instance BBS + node ownership)
node scripts/verify-multifloor.mjs # 37 multi-floor checks (incl. floor-aware topology + splitWall guard)
Both must pass green before any commit.

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
invalid room), `beam_no_support` (explicit beam endpoint not a column),
`staircase_disconnected` (fromFloorId === toFloorId when multi-floor),
`footing_no_column` (foundation with empty columnIds AND wallIds; RAFT/PILE
exempt). BOQPanel footer surfaces top 5 issues with severity color.
No hard-blocking — warnings only.

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
pccVolFt3, plumVolFt3, excavVolFt3, shutterAreaFt2 }`. Geometry rules:
- **ISOLATED / COMBINED:** `footprint = L×W`; `excav = (L+2m)×(W+2m)×(D+pcc)`;
  `shutter = 2(L+W)×D`.
- **RAFT:** `footprint = geometry.areaFt2` (no margin — raft IS the footprint);
  `shutter = 4√A × D`.
- **STRIP:** attaches to `wallIds[]`; `totalLenFt = Σ getWallLength(wid)`;
  `excav = totalLenFt × (W+2m) × (D+pcc)`; `shutter = 2 × totalLenFt × D`.
- **PILE:** `shaftFt3 = pilesCount · π·(d/2)² · L`; cap = `capL×capW×capD`;
  `excav = capFootprint × (capD+pcc)` (pile shafts displace ground — not
  counted in dig volume).

`marginFt = projectSettings.excavationSettings?.workingMarginFt ?? 0.5`.

**Panel (`src/components/FoundationPanel.jsx`).** Modal opened by
`activeTool='foundations'` (toolbar `▭ Foundations` button). Type-conditional
geometry inputs; column-attachment multi-select for COMBINED; wall-attachment
multi-select for STRIP. Foundation badge appears in `ColumnPanel` when a
column is attached.

**Integration.** `boq/lines.js` emits one `rcc` + one `pcc` line per foundation
entity from `computeFoundationQuantities().perFoundation` (the inline
`byColumnTypeInline` path is unchanged for columns with no foundation).
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

## Known issues / Phase 2 backlog

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

## Architectural reminders

- `getValidRoomIds()` is the filter for ALL finish-gated and floor area totals. Never iterate `Object.keys(rooms)` directly for BOQ.
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
- **Selector discipline.** Phase 1.7+ code uses `getColumnsOnFloor / getWallsOnFloor / getSlabsOnFloor / getStampsOnFloor / getRoomsOnFloor / getBeamsOnFloor / getStaircasesOnFloor / getEntitiesOnFloor` for floor scoping. No inline `.filter(e => e.floorId === ...)` in components or quantity functions.
- **Foundation BOQ pipeline.** `computeFoundationQuantities(state)` is the per-type geometry source. `getFoundationQuantities()` keeps the inline `byColumnTypeInline` path for legacy columns with no foundation attached. `boq/lines.js`, `excavation.js`, `shuttering.js` all read from `computeFoundationQuantities`.
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
- **Project manager snapshot caching.** `listProjects()` and `getCurrentProjectId()` MUST keep stable references between calls. `notify()` invalidates the in-module caches before fanning out. Required by `useSyncExternalStore` in `ProjectsPanel`.
- **PDF currency.** Default jsPDF helvetica lacks `U+20B9`. Use the ASCII `Rs. ` prefix in `src/export/pdf.js`. Excel uses formulas (`=C*D`) so the column header carries the currency note instead.
- **No new libraries without asking** — but `jspdf`, `jspdf-autotable`, and `xlsx` were explicitly approved for Phase 2.0.
