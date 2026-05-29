# BBS Full Build — Morning Report (2026-05-29)

**Outcome: all 7 additions + all 3 output levels shipped clean. 0 categories
deferred. All 34 verify scripts green.**

Two commits on `main`:
- `cceafbb` — 6 categories + sub/super column split + substrate
- `7ea9a2e` — 3-level output (detail rows + abstract + Excel/PDF export)

Research lives in `docs/BBS-CATEGORIES-RESEARCH.md` (7 categories, cited,
cross-checked against both reference workbooks in the repo root).

---

## Verify results

| Script | Result |
|---|---|
| `verify-bbs` (Sections A–N) | **168 / 168** |
| `verify-bbs-export` (new) | **12 / 12** |
| All 34 verify scripts | **green** (`verify-persistence` "sorted updated-DESC" is a pre-existing timestamp-flaky test — passes 3/3 on re-run; untouched by this work) |

New verify-bbs sections, each enabling one category on a fixture and
hand-checking groups / shape / dia / category / mark-prefix:
H tie band · I lintel/head band · J sunshade · K loft · L staircase
(40–160 kg sane band) · M strap footing · N sub/super split (auto + forced,
kg-preservation, segmentType). `verify-bbs-export` proves **Level 2 = reduce
of Level 1** and the abstract == `byBbsCategory` rollup.

Backward-compat: existing Sections A–G unchanged and green; `verify-boq`,
`verify-multifloor`, `verify-building-area`, `verify-mep`, `verify-schemas`,
`verify-integrity` all green — every new category is **default-inert**.

---

## Per-category build status

| # | Category | Status | Source / model fit |
|---|---|---|---|
| 1 | Tie / grade band beam | ✅ done | `wall.hasTieBeam` → BBS-only synthesized band beam (NOT in BEAM_LEVEL_REGISTRY → legacy BOQ/masonry untouched). beamClass `tie`, `beamBehavior:BAND`. |
| 2 | Lintel / head band beam | ✅ done | existing wall-derived `lintel` beam now `beamBehavior:BAND`, category LINTEL_BEAM, IS 4326 (no confinement). |
| 3 | Sunshade / chajja | ✅ done | per window `opening.hasSunshade` + `sunshadeSettings`. Top L-bar anchored into lintel + dist. `sunshadeRebar.js`. |
| 4 | Loft | ✅ done | new `wall.loft = {enabled,widthFt,depthFt,heightFt}`. Top+bottom mat + dist, embedded into wall. `loftRebar.js`. |
| 5 | Staircase | ✅ done (ESTIMATE-grade) | from staircase entity; waist + dist + landing. `staircaseRebar.js`. |
| 6 | Strap footing | ✅ done | new foundation `type:'STRAP'`; 2 pads + strap beam (top-primary). `strapFootingRebar.js` (RAFT/STRIP/PILE still deferred). |
| 7 | Sub/super column | ✅ done | per-segment split of ONE column entity; `column.position` + `meta.segmentType AUTO/FORCED`. |

Output levels: **L1** per-bar detail rows (panel + export with a/b/c shape
dims + per-Ø length buckets), **L2** category × Ø abstract with kg + concrete
m³ + kg/m³ ratio (new Abstract tab + `concreteByBbsCategory`), **L3** Excel
(TOTAL sheet + one detail sheet per category) + PDF (cover + abstract +
per-category pages), wired into the panel.

---

## Autonomous architectural decisions — please sign off

1. **All new categories are default-INERT (opt-in).** Tie via `wall.hasTieBeam`
   (default null), sub/super via `is2502Params.subSuperColumnSplitEnabled`
   (default false), sunshade/loft/staircase/strap emit only when their
   `bbsDefaults.*` spec is set. **Why:** guarantees zero drift on `verify-boq`
   byte-equality and every existing project. Engineers opt in per project.
2. **Tie beam is a BBS-only synthesized band, not a registry beam level.**
   Adding `tie` to `BEAM_LEVEL_REGISTRY` would feed `getDerivedWallBeams` →
   masonry deduction + beam RCC BOQ + canvas → shift `verify-boq` numbers.
   Synthesizing it only inside `computeRebarGroups` keeps the legacy pipeline
   byte-identical.
3. **Default lap stays 56.6d (IS 456 code), not 50d (site shorthand).**
   Reference workbooks use 50d; it's available via the `simplified`/Fe550 keys.
   Fe550D Ld/lap factors added to the catalog (CATALOG_VERSION → V2).
4. **Sub/super split adds one lap at the grade transition** (sub bar laps the
   dowel + super bar laps the sub) → split kg is modestly ABOVE the single-lap
   flat path. This is physically correct; the backward-compat invariant lives
   on the default (non-split) path.
5. **Bar marks: entity grid-labels override the registry prefix** for columns
   (`C1`) and strap footings (`EF1`) — the reference convention. The
   `getBarMarkPrefix` registry (SC/TB/HB/CH/LF/ST/SF) governs auto-generated
   marks (sub-column, bands, sunshade, loft, staircase).
6. **Loft emits TOP + BOTTOM mats** (per the locked decision) even though the
   reference workbook lists a single flat Ø8 mat — structurally safer.
7. **Concrete-per-category** (for the kg/m³ ratio) is computed from stored
   geometry in `src/bbs/concrete.js`, NOT the legacy aggregators (avoids the
   STRAP-type edge case). Column/beam concrete is split into fine categories
   in proportion to steel kg.

---

## Assumptions made (references silent / ambiguous)

- Sunshade/loft anchorage default = Ld (code); 2" site embed available via
  `simplified`. Loft slab thickness defaulted to 4" (no loft thickness field).
- Strap pad bottom-mesh only (no top mesh); strap beam not IS 13920 ductile
  (gravity, below grade).
- SUB-column segment = footing-top → grade-beam level, derived as
  `gradeBeamLevelPlinthFraction × base-floor plinthHeightFt` (default fraction 1.0).
- Staircase: waist main modeled as a straight inclined length + landing
  anchorage (shape `21`); the reentrant-corner one-bar-vs-two-bar detail is
  total-weight-insensitive (±15%), so ESTIMATE-grade is honest.

---

## Things that came back uglier than expected

- **`replace_all` indentation trap:** the TOP/BOTTOM `makeRebarGroup` calls in
  `beamRebar.js` are 4-space indented but the stirrup calls are 8-space — my
  first stamp of `bbsCategory`/`beamBehavior` only hit the 4-space ones, so
  band stirrups silently fell back to category `BEAM`. Caught immediately by
  verify Sections H/I (group count = 2 not 3). Fixed with the 8-space variant.
- **Legacy aggregators don't know `STRAP`** — `getFoundationQuantities` /
  `computeFoundationQuantities` predate it. Sidestepped by computing strap
  concrete directly from geometry in `concrete.js`; the BBS path uses
  `buildStrapFootingGroups` exclusively.
- **Column mark vs registry tension** — resolved by letting entity grid-labels
  win (decision 5).

---

## Not completed / follow-ups (NOT blockers)

- **BBS-RealPlan-001** — Sections H–N use synthetic fixtures. No end-to-end run
  against the actual reference house traced in the app (would require tracing
  the Karthick plan). Validation is hand-computed IS values + the research
  doc's workbook aggregate cross-reference, not an in-app Playwright sweep.
  Recommended next: trace one reference floor in the running app and
  screenshot-validate the Abstract tab + export against the workbook TOTAL.
- **RAFT / STRIP / PILE** foundation BBS still deferred (unchanged; STRAP now built).
- **BE-Legacy-001** (legacy `FT_PER_MM` lap bug) untouched — the new generators
  route through the IS 2502 catalog and are unaffected.
- **CLAUDE.md** — a "Phase BBS-Categories" section should be appended
  documenting the locked rules above (decisions 1–7). Not yet written.
- Excel/PDF exporters are wired but only smoke-tested via the pure builder
  (`verify-bbs-export`); the actual `XLSX.writeFile`/`doc.save` download paths
  run only in-browser (consistent with how `excel.js`/`pdf.js` are tested).

---

## Files

New: `src/bbs/generators/{sunshade,loft,staircase,strapFooting}Rebar.js`,
`src/bbs/concrete.js`, `src/export/bbs.js`, `scripts/verify-bbs-export.mjs`,
`docs/BBS-CATEGORIES-RESEARCH.md`.
Extended: `src/bbs/{types,index}.js`, `src/bbs/generators/{column,beam,footing,slab}Rebar.js`,
`src/specs/{cuttingLength,resolution,reinforcementSpecs}.js`,
`src/structuralSlice.js`, `src/schema/entities/{wall,column,staircase,foundation,opening}.js`,
`src/components/BBSSchedulePanel.jsx`, `scripts/verify-bbs.mjs`.
