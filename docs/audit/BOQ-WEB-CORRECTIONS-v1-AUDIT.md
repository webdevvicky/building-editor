# BOQ WEB Corrections v1 — Honest Audit & Triage

## Context

A junior, non-developer teammate produced a 46-item "corrections" list (`BOQ  WEB corrections v1.pdf`) by clicking around the BOQ editor. She had little knowledge of the project and **no knowledge that the editor is the upstream "Building Editor" that feeds the ERP-SaaS platform** via a stable `ifcGlobalId` contract and live cloud sync. The owner asked for an honest, deep, no-shortcuts audit: triage each finding (real bug / misunderstood-feature / worthy enhancement), and go deeper than she could — architecture, scalability, and integration issues — treating this as **greenfield with unlimited resources, targeting an enterprise-grade, dynamic, data-driven, multi-tenant platform.**

This file is a findings report, not yet a build order. The final implementation sequencing is a decision for the owner (see "Decisions").

---

## ⚠️ Read this first: the integration contract governs everything

The editor is NOT standalone. It already:
- Builds a versioned `BuildingModelPackage` (`src/boq/buildPackage.js`) keyed entirely on `ifcGlobalId` (internal UUIDs stripped).
- Cloud-syncs to the ERP (`src/projects/cloudSync.js` push/pull, `connectHandoff.js` conflict dialog, `autosave.js` debounced auto-sync).
- Relies on `ifcGlobalId` being **stable across edits** (wall split/join preserve lineage via a `provenance` block). The ERP's `ImportService` reconciles execution rows (snags, progress, finishes, BOQ links) across splits/joins using that lineage.

**Consequence:** several of the teammate's suggestions, if implemented naively, would corrupt or orphan ERP data. These are flagged 🔗 below. Any change touching walls, openings, ids, materials, room types, or beams MUST be checked against `docs/EDITOR-ERP-INTEGRATION.md` (which does not exist yet — creating it is a recommended deliverable).

Naive changes that WOULD break the contract (do NOT do without integration design):
- Regenerating `ifcGlobalId` on split/merge → orphans all snags/progress on those walls.
- Renaming editor `materialKey` / room-type values to match ERP enums → breaks historical saved projects + cross-tenant exports.
- Exporting wall-derived (plinth/lintel/roof) beams → double-counts in ERP.
- "Clean up" by deleting a survivor wall after an accidental split→join → orphans execution rows.
- Renumbering floors (matched by `sequence`, not id) → clobbers spatial data on re-import.

---

## Triage of all 46 findings

Legend — **BUG** (real defect), **EXISTS** (already implemented; UX/discoverability or misunderstanding), **ENH** (legitimate enhancement / missing feature), **STRAT** (enhancement that should be solved structurally, not one-off), 🔗 (integration-sensitive).

| # | Item | Verdict | Evidence / Notes |
|---|------|---------|------------------|
| 1 | Drag incomplete wall to adjacent to close gap | ENH | Join tool exists (`topology/canMerge.js`, `joinWalls` in store) but no drag-to-snap-merge. UX gap. 🔗 (must reuse `joinWalls` provenance path) |
| 2 | Excel: plaster cement=bags/sand=m³; paint gal→litre | BUG (paint) / EXISTS (plaster) | Plaster already emits bags + m³ (`boq/lines.js:345-346`). Paint hardcoded `'gal'` in `quantities/paint.js:92`; emitter already supports `'L'` (`lines.js:523`). Easy, real fix. |
| 3 | Slab access not available | ENH/needs-clarif | Slab entity exists; no standalone slab quantity module, and UI access seems missing. Confirm what "access" means. |
| 4 | Walls transparent to place windows; remove layer | EXISTS + ENH | Layer toggle hides walls entirely (`LayersPanel`, `setLayerVisibility`). No per-layer opacity / "ghost" mode. Add wall ghosting + opacity. |
| 5 | Drag GF columns to all upper floors | ENH | Column has `baseFloorId`/`topFloorId` but defaults single-floor; no copy-to-floors UX. 🔗 |
| 6 | Floor-2 trace visible on Floor-1; show/hide | EXISTS + ENH | Underlay visibility toggle exists; an adjacent-floor "ghost trace" toggle is the real ask. Verify vs underlay. |
| 7 | Drag option for MEP | ENH | Update actions exist (`mepSlice` `updateX`); no canvas drag handler wired. 🔗 (position changes export) |
| 8 | Saved column dims not shared across projects | STRAT 🔗 | Per-project `projectSettings.columnTypes`. Global presets = catalog-service question; aligns with ERP catalog. |
| 9 | Room number not centered | **BUG** | Label uses avg of wall midpoints (`Canvas.jsx:2321-2330`); true `getRoomCentroid` exists unused (`topology/rooms.js:210`). Easy fix. |
| 10 | Kitchen countertop slab should be included | ENH | Countertop only partially quantified (granite area in `tiles.js`); no slab/structural inclusion. Ties to #22/#35. |
| 11 | Automation, bio-septic, digital door lock, door handle | ENH (catalog) | New catalog items (smart-home + hardware + septic). |
| 12 | Kitchen door: Arch | ENH (catalog) | New door subtype. 🔗 (opening subtype) |
| 13 | Can't delete door/window individually | EXISTS | `removeOpening` + `OpeningDetailPanel` + Delete key all exist. Likely discoverability/UX. Verify repro. |
| 14 | Wall not following centre on 3rd floor | BUG (suspected) | `drawReference` is project-wide; inconsistent thickness → centerline offset drift. Needs repro. 🔗 |
| 15 | GF column not passing through floors | ENH/BUG | Same root as #5; expectation mismatch on multi-floor extent. |
| 16 | Delete floor only via settings | EXISTS | `removeFloor` in `FloorsManagerPanel` + settings. Discoverability. Note: orphaned entities persist (real cleanup gap). |
| 17 | Joining walls not working | BUG/UX | `canMerge` is very conservative; failures are silent/unclear. Surface reasons + relax where safe. 🔗 |
| 18 | Beam connects column centre-to-centre | EXISTS (by design) | `resolveBeamEndpoint` returns column center (locked rule). Possibly wants edge offset display. 🔗 |
| 19 | BEAMS section should have lintel/plinth/roof | EXISTS | `BEAM_LEVEL_REGISTRY` already has plinth/lintel/roof (`constants/structural.js:67`). UI exposure gap. |
| 20 | Stair types; sump/OHT shapes | ENH + **BUG** | Stairs only 3 types. **Sump/OHT emit ZERO concrete/steel** — `getSumpCivilQty`/`getSepticCivilQty` are optional-chained but never implemented (`structuralSlice.js:1951`). Real bug. |
| 21 | Toilet plumbing essentials + sanitary + finishing | ENH (large) | Plumbing pipes/fittings exist; sanitary finishing (membrane type, traps, cove) not modeled. |
| 22 | Kitchen countertop shapes | ENH/STRAT | Not parametric. Best solved via generic block primitive (#35). |
| 23 | Switch-board types | ENH (catalog) | Missing. |
| 24 | Electrical switch types | ENH (catalog) | Missing (switches modeled only as LIGHT points). |
| 25 | Socket types | ENH (catalog) | Partial (5A/15A only). |
| 26 | Distribution-box types (main/sub/final) | ENH (catalog) | Partial (DB/SUB_DB). |
| 27 | DB door designs | ENH (catalog) | Missing. |
| 28 | Light fixture catalog (40+ types) | ENH (large) | Lights are cosmetic generic `LIGHT` point; no luminaire catalog. |
| 29 | Lighting installation BOQ items | **BUG/gap** | Wire+conduit+MCB emitted; junction boxes counted but **never emitted** (`mep/quantities/electrical.js:89-101`); ceiling rose/glands/connectors absent. |
| 30 | Can't select/delete smoke detector behind room | **BUG** | Room fill `pointerEvents:'auto'` intercepts clicks though MEP renders on top (`Canvas.jsx:1441` vs `1894`). Z-order/hit-test bug. |
| 31 | Room numbers not centered (clumsy) | **BUG** | Same root as #9. |
| 32 | Auto-focus exit while typing project title | BUG (suspected) | Title input has `stopPropagation` but no focus guard (`ProjectSettingsPanel.jsx:795`). Needs repro. |
| 33 | Wall aligning not proper; drag floor trace + lock | BUG + ENH | Alignment issues + underlay drag/lock request. 🔗 |
| 34 | Double-door leaves wall between openings | ENH | No double-door/mullion-less type; adjacent openings leave a segment. 🔗 (opening model) |
| 35 | Island kitchen as adjustable LxBxH block w/ walls | **STRAT** | The deep ask: a **generic parametric block primitive** (also covers sump/OHT/planter/countertop). Architectural keystone. 🔗 |
| 36 | + many residential room types | STRAT 🔗 | Hardcoded `ROOM_TYPES` (`roomPresets.js:19`). Data-driven catalog needed; ERP `RoomType` enum-mapping risk. |
| 37 | + utility/service spaces | STRAT 🔗 | Same. |
| 38 | + circulation spaces | STRAT 🔗 | Same. |
| 39 | + outdoor spaces | STRAT 🔗 | Same. |
| 40 | + commercial/office spaces | STRAT 🔗 | Same + implies non-residential support (bigger scope). |
| 41 | Add ventilator (door/window exists) | EXISTS + ENH | Ventilator exists as WINDOW subtype (`joinery.js:17`); wants standalone type. 🔗 |
| 42 | Column types 9×15, 12×18, 12×24 | ENH (easy) | Add presets to `DEFAULT_COLUMN_TYPES` (`structuralSlice.js:95`). |
| 43 | Sunshade dimension entry | ENH | Global-only today (`structuralSlice.js:153`); wants per-opening projection/thickness. |
| 44 | Ventilator in wall properties like door/window | ENH | Same as #41 (UX placement). |
| 45 | SS railing for staircase | **BUG/gap** | `hasHandrail` flag exists but never quantified (`structuralSlice.js:1790`). No railing BOQ. |
| 46 | "Tiles for diff…" (incomplete) | needs-clarif | Sentence truncated in source. Ask author. |

**Tally:** ~7 real BUGs (9/31, 30, 20-sump/OHT, 29-junction box, 45-railing, +suspected 14/32), ~5 EXISTS-but-UX, ~3 STRAT keystones (35 parametric blocks, 36-40 dynamic room catalog, 8 global catalog), the rest legitimate catalog/feature ENHs.

---

## ADDENDUM — updated PDF `BOQ  WEB.pdf` (2026-06-26): new items 47–59

The updated file keeps items 1–46 unchanged (only #36 gained "Motor room, Suit room, Bag"; #46's truncated "Tiles for diff" is now the full tile-by-area request below). It adds 13 new items. **Headline: most are already-possible usage questions, not defects** — answerable without code.

| # | Item | Verdict | Evidence / How |
|---|------|---------|----------------|
| 46 | Tiles per area (anti-skid bath, heavy-duty parking, outdoor setback) | ENH | Tiles are **global today**; dado heights are per-room-type (`tileDefaults.dadoHeightsFt`) but **no tile material/type**. Add `tileTypeId` per room + emit per-type BOQ lines (`quantities/tiles.js`). |
| 47 | Sand fill + basement/plinth fill in BOQ | **ENH/gap** | **Genuinely missing** — `excavation.js`/`foundations.js` compute dig + PCC but **no fill line** at all. Real cost item absent. Add `quantities/fill.js` + `FILL` category. |
| 48 | Gate types (swing/sliding/SS/MS/automatic…) | ENH (new entity) | **No gate/compound/boundary entity exists.** Needs a new entity (like `stamp`) + hardware catalog. Pure addition. |
| 49 | Window types (sliding/casement/bay/jali…) | ENH/STRAT 🔗 | Opening `subtype` list is hardcoded/frozen (`joinery.js`); **no material/style field** (deferred to "Phase 3/4" by an explicit code comment). Same catalog layer as #36-40. |
| 50 | Door types (flush/panel/French/teak/uPVC…) | ENH/STRAT 🔗 | Same as #49 — subtype hardcoded, no material field. |
| 51 | OTS (open-to-sky) area | ENH | **Partial today**: use `GARDEN`/`SHAFT` room type (`roofing:false`) so no roofing cost — **but a slab is still auto-created above it**. Needs a `noSlab`/`openToSky` room flag honored in `autoInitSlabs`. |
| 52 | Show real room names (Kitchen…) not "Room 1/2/3" | **EXISTS** | **Already works** — rooms have a `name` field; rename via RoomDetailPanel pencil (`store.js renameRoom`). Auto-default is "Room N". Optional ENH: auto-label from `room.type` via `ROOM_TYPE_LABELS` (one line at `Canvas.jsx:2347`). |
| 53 | "Slab exists, don't know how/why" | **EXISTS (explain)** | **Intentional** — `autoInitSlabs` auto-creates one MAIN slab + SUNKEN slabs for TOILET/BALCONY on first room. View/delete in the **Slabs panel** (delete allowed when 0 rooms). Not a bug; discoverability. |
| 54 | "Certain wall has no brown border, why" | **EXISTS (explain)** | Brown in 2D = **plot wall** (`isPlot`, `#a0522d`). Brown in 3D = **beams** (plinth/lintel/roof), not walls. A wall without a brown edge in 3D = no beam on that edge. Misread, not a defect. |
| 55 | Balcony SS railing + toughened glass — how to note | EXISTS + ENH | Balcony **handrail length is computed** (`grills.js`), material chosen in the BOQ line. **Toughened glass infill is NOT modeled** — add a balcony railing material/glass option. |
| 56 | How to add elevator opening | **EXISTS (explain)** | Lift exists as a **stamp** (`stamp.type:'lift'`) + `SHAFT` room type. Add a normal door opening on the shaft wall for the entry. (A dedicated `LIFT_DOOR` subtype would be a nicety.) |
| 57 | How to add sliding door | **EXISTS (explain)** | `SLIDING_DOOR_STANDARD` hardware set exists; assign via opening `hardwareSetId` (or project default). No separate "sliding" subtype, but it's supported today. |
| 58 | Double-height ceiling | ENH | **Not modeled** — floor height is global per floor; no per-room height override and the slab above is still created. Needs `roomHeightOverrideFt` + skip-slab logic. |
| 59 | Loft & shelf | **EXISTS (loft) / ENH (shelf)** | **Loft is fully modeled** — `wall.loft {enabled,w,d,h}` via `setWallLoft`, with BBS rebar + concrete. Standalone shelf/mezzanine/niche entities are not. |

**v2 takeaway:** of the 13 new items, **6 are already doable today** (52, 53, 54, 56, 57, 59-loft) and just need a short how-to / discoverability fix; **1 is a genuine missing cost line** (47 sand/basement fill); the rest are catalog/entity additions that fold into the existing keystones (door/window/gate types → catalog layer Phase 3; OTS/double-height/glass-railing → small schema flags or the parametric-block work Phase 4).

---

## Deeper findings she could not have seen (audit results)

### Integration / data-contract (CRITICAL — governance)
- **I-1** No written integration contract doc. The `ifcGlobalId` stability + provenance rules live only in code. → Create `docs/EDITOR-ERP-INTEGRATION.md` and a pre-export validation gate (warn on missing `ifcGlobalId`, zero-length walls, zero-area rooms).
- **I-2** Catalog/enum drift: editor `materialKey` (7 hardcoded) vs ERP `WallMaterial` (12 enum); editor room types vs ERP `RoomType`. Unknown values silently map to `OTHER` on import (`import.service.ts` `mapWallMaterial`/`mapRoomType`). Adding room types (#36-40) and materials WILL widen this drift unless solved as a shared catalog.
- **I-3** No editor→BOQ-product/WorkCategory linkage; ERP cannot auto-generate BOQ from structure safely (re-import would duplicate). Any "auto-BOQ on import" must be idempotent + preview-gated.

### Architecture / scalability (HIGH)
- **A-1** Monolithic store (`store.js` ~2500 lines) + monolithic `Canvas.jsx` (~2350 lines), broad selectors → full re-render on any mutation; **zero `useMemo`/`useCallback`**.
- **A-2** Room polygon recomputed every render via O(n²)-ish DFS (`topology/rooms.js:27-55`); no caching. Large buildings will stall.
- **A-3** No spatial index; floor scoping and hit-testing are O(all-entities).
- **A-4** Persistence has an **empty migration chain** (`schemaVersion.js:38`); adding fields silently breaks old saved projects. No IDB `onupgradeneeded` migrations.
- **A-5** No TypeScript + schemas defined but **not enforced at write time** (`mepSlice` etc. spread partials unchecked) → silent data corruption across 200+ fields.
- **A-6** Undo = 50-frame full-state snapshots; no operation log/audit trail (needed for multi-user SaaS).
- **A-7** No auth / users / tenants in the editor itself (cloud sync is single global ERP connection). True multi-tenant SaaS needs an auth + tenant model + per-project ownership/RBAC, and conflict-free multi-editor (CRDT) if concurrent editing is a goal.

### Domain completeness / correctness (MIX)
- **D-1 (BUG)** Plumbing `HOT_RECIRC` referenced in emitter but absent from `SYSTEM_IDS` (`mep/quantities/plumbing.js:18`) → recirculation pipe never quantified.
- **D-2 (BUG)** Sump/OHT concrete+steel always 0 (#20).
- **D-3 (BUG)** Lighting junction boxes computed but not emitted (#29).
- **D-4 (BUG)** Staircase railing not quantified (#45).
- **D-5 (STRAT)** Every catalog is `Object.freeze`d build-time data. "Add any type at runtime" (the spirit of #11, #23-28, #36-40) is impossible without a catalog data layer.
- **D-6 (STRAT)** No generic parametric element (#35) — each special element (stair/sump/OHT/countertop) is bespoke. A single `ParametricBlock` primitive (LxBxH + material + optional walls/roof + one quantity calculator) would absorb many requests at once.
- **D-7** No multi-currency / unit-system / rate-source tracking — fine for India-only, gap for enterprise.

### Testing (MEDIUM)
- **T-1** 42 assertion scripts, no component/interaction/visual tests, no coverage gates. Adopt Vitest + Testing-Library before large refactors so the BOQ-correctness scripts become regression guards.

---

## Suggested phasing (for discussion — not yet approved)

**Phase 0 — Governance & safety (do before anything touches walls/openings/ids/catalogs)**
- Write `docs/EDITOR-ERP-INTEGRATION.md`; add pre-export validation gate; add a guardrail verify script.

**Phase 1 — Real bugs, low risk, high trust (quick wins)**
- #9/#31 room label centroid; #2 paint litres; #30 MEP z-order/hit-test; D-1 HOT_RECIRC; #29 junction-box emission; #45 railing qty; #20 sump/OHT concrete/steel; investigate #14, #32.

**Phase 2 — UX corrections of existing-but-hidden features**
- #13, #16 discoverability; #19 expose beam levels in UI; #4 wall ghost/opacity; #6 floor-trace toggle; #17 surface join failure reasons; #41/#44 ventilator placement.

**Phase 3 — Catalog data layer (STRAT keystone) — unblocks the bulk of the list**
- Make catalogs data-driven (room types #36-40, column presets #8/#42, switches/sockets/DB/lights #23-28, door subtypes #12/#34, hardware/automation #11), with ERP-catalog alignment to avoid `OTHER`-drift (I-2). Includes light-fixture catalog (#28) + lighting BOM completion.

**Phase 4 — Generic parametric block primitive (STRAT keystone)**
- #35 island kitchen / #22 countertop shapes / sump-OHT shapes #20 / planters — one model, one calculator.

**Phase 5 — Enterprise platform hardening**
- Performance (A-1..A-3), schema migrations (A-4), TypeScript + write-time validation (A-5), audit log (A-6), auth/multi-tenant/RBAC + multi-editor (A-7), testing framework (T-1), multi-currency (D-7).

**Phase 6 — Deeper plumbing/electrical/structural domain depth**
- #21 sanitary finishing, plumbing specialty items, electrical circuit/load transparency, stair detailing.

---

## Decisions (owner, 2026-06-22)
1. **Engagement now = REPORT ONLY.** No code changes. This file is the deliverable; phases below are for later approval.
2. **Residential + commercial both in scope.** Catalog + room-type model must cover commercial/office spaces (#40). This widens the ERP `RoomType`/catalog alignment surface (see I-2) — commercial room types must be added to the ERP enums/lookups *first* (ERP is source of truth, below), or imports fall back to `OTHER`.
3. **Single editor per project.** No concurrent multi-editor / CRDT needed → A-7 simplifies to auth + tenant + per-project ownership + a project-level lock; current last-write-wins sync is acceptable with locking. (An operation log/audit trail is still worthwhile but not for collaboration.)
4. **ERP is the source of truth for catalogs.** The editor fetches catalogs (room types, materials, fixtures, column presets, etc.) from the ERP and caches locally, with bundled defaults as offline fallback. This is the durable fix for editor↔ERP enum drift (I-2) and directly answers #8 (global column dims) and #36-40 (room types). Implication: catalog work starts on the **ERP side** (define/extend enums or move them to tenant-configurable lookup tables), then the editor consumes them — NOT by expanding the editor's frozen arrays.

### How these decisions reshape the phasing
- **Phase 3 (catalog layer) is now ERP-led:** add a tenant-scoped catalog API on the ERP + commercial room/space types in ERP enums/lookups, then build the editor's fetch+cache+offline-fallback layer. The editor's `Object.freeze` arrays become defaults only.
- **Phase 5 trims:** drop CRDT/multi-editor; keep auth + multi-tenant + project lock + (optional) audit log.
- **Phases 1, 2, 4 unchanged.** Note the data-driven catalog (3) should land before bulk catalog enhancements (#11, #12, #23-28, #34) so they're added as ERP data, not editor code.

## Verification approach (per phase, once building)
- Run `npm run verify` (42 scripts) after each change; extend the relevant `verify-*.mjs`.
- For bug fixes, add a failing assertion first, then fix.
- For anything 🔗, round-trip through `buildPackage()` and confirm `ifcGlobalId` stability + provenance before/after.
- Manually drive the app (`npm run dev`) for interaction bugs (#30, #14, #32).
