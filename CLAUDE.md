# Building Editor — Developer Notes

## Current Phase Status

Phase 1a–1c-4 + Phase 1.5 + Stage 0 + Phase 1.6 + Architectural Fixes 1–4 +
Phase 1.8 + Phase 1.9 + Phase 1.7 + Phase 2.0 + UI Phases 1–4 +
Collapsible BOQ sidebar + **Topology Layer (Steps 0–9)** + **MEP Phase 0
+ Plumbing + Electrical + HVAC + Fire + ELV + Clash Detection +
Load-Based Sizing** complete on `main` (2026-05-18).

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
node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-boq.mjs        # single-floor BOQ checks
node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-multifloor.mjs # multi-floor scope + topology guard
node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-topology.mjs   # 23 topology-layer relationship checks
node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-mep.mjs        # 242 MEP assertions across 5 disciplines + clash + sizing
All four must pass green before any commit.

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

### Toolbar conventions (`Toolbar.jsx` + `Toolbar.css`)

- 4 intent-clusters separated by `.toolbar-divider`:
  **Draw** | **Structural & Civil** | **View & Settings** | **Project**.
- Every button is `<Button variant size title>`. Active tool gets
  `variant="primary"`; inactive gets `variant="ghost"`. NEVER inline
  `background:` for active state.
- Icons exclusively from `lucide-react` at `size={14}` `strokeWidth={2}`.
  **No emoji anywhere in toolbar output.**
- Tooltips via `title` attribute. Include keyboard hint when applicable
  ("Draw walls (D)", "Save project (Ctrl+S)", "Undo (Ctrl+Z)").

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
- **`endpointPos` lives in `topology/beams.js` as `resolveBeamEndpoint`.**
  Five copies were collapsed in Step 5 — do not re-introduce inline
  endpoint resolution in new code (BOQ aggregators, validation rules,
  Canvas render, MEP engines).
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
- **Use UI primitives — never hand-roll.** `<Button>` for any styled button, `<Panel>` for side panels, `<Modal>` for centered overlays (backdrop + ESC + focus trap are owned by the primitive — don't reimplement), `<Field>` for label + input pairs. All in `src/components/ui/`.
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
