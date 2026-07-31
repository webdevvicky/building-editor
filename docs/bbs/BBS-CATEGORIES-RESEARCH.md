# BBS Categories — Research (Chennai / Tamil Nadu residential, G+0–G+3)

Research basis for the six new BBS element categories + sub/super column split.
Scope: Fe500D/Fe550D + M20, IS 456 / IS 13920 / IS 2502 / IS 4326 / SP 34.
Cross-checked against the two reference workbooks in the repo root
(`BBS- Karthick M-City (1).xlsx`, `SELVAKUMAR (1).xlsx`). Every numeric rule
is cited or marked **[ASSUMPTION]**.

## Cross-cutting conventions (validated against both workbooks)

- **Cutting length** `CL = a + b + c + lap` (clear length + end-hook legs +
  lap). Stirrups add a constant hook-allowance term. Matches our
  `cuttingLength.js` engine (1d/2d/3d/4d bends, 9d hooks).
- **Lap = 50d** (workbook site shorthand: 1.968 ft = 600 mm for Ø12,
  2.624 ft = 800 mm for Ø16). **Code-correct Fe500/M20 tension lap ≈ 56.6d.**
  Engine keeps 56.6d (`Fe500_M20_nonseismic`) as the default and exposes 50d
  via the `simplified` lapKey + the new Fe550 keys.
  ([thecivilstudies](https://thecivilstudies.com/lap-length-calculation-is-456-guide/),
  [infralens](https://infralens.in/term/lap-length))
- **Unit weights** = d²/162 (8→0.395, 10→0.617, 12→0.889, 16→1.58, 20→2.469,
  25→3.855). 12 m standard bar confirmed (per-bar 12mm = 10.667 kg).
- **IS 13920 confinement is ABSENT in both workbooks** for bands/slabs/sunshade/
  loft — uniform stirrup spacing throughout. Engine default
  `confinementZoneEnabled=false` matches Chennai practice. Bands (tie/lintel)
  are IS 4326 seismic bands → `beamBehavior='BAND'`, uniform links, no
  confinement. ([IS 4326 bands](https://assignmentpoint.com/location-types-design-and-applications-of-horizontal-bands-in-masonry-buildings/))
- **Cover**: footing/below-grade 50–60 mm, column above grade 40 mm, grade/
  plinth/strap/tie/lintel beams 30 mm, sunshade/loft slabs 20 mm.
- **Shape codes used**: straight `00` (distributors, mains w/ end hooks),
  L-bar `11` (dowels, sunshade/loft anchor leg, corners), cranked `03`
  (slab), closed stirrup `75`/`33`. ([IS 2502 — iscodehub](https://www.iscodehub.com/is/is-2502))

## Whole-building validation targets (Karthick TOTAL/ABSTRACT sheet)

| Member | 8 | 10 | 12 | 16 | Total kg | Conc m³ | kg/m³ |
|---|---|---|---|---|---|---|---|
| Footing | 150 | 414.8 | 117.3 | 151.7 | **833.8** | 8.62 | 96.8 |
| Column — Substructure | 241.7 | 0 | 394.7 | 227.5 | **863.9** | 2.29 | 376.7 |
| Tie / Grade Beam | 308.1 | 0 | 597.4 | 132.7 | **1038.2** | 5.33 | — |
| Column — Superstructure | 194.3 | 0 | 352.0 | 170.6 | **716.99** | 5.15 | 139.2 |
| Lintel / Head Beam | 289.1 | 74.1 | 10.7 | 0 | **373.9** | 3.53 | 105.9 |
| Sunshade | 56.9 | 0 | 0 | 0 | **56.88** | 0.60 | 94.7 |
| Loft | 142.2 | 0 | 0 | 0 | **142.2** | 0.79 | 180.1 |
| Roof Beam | 493.0 | 0 | 757.4 | 758.4 | 2008.7 | 8.22 | 244.5 |
| Roof Slab | 2279.9 | 251.8 | 0 | 0 | 2531.8 | 23.11 | 109.5 |

These per-category kg-by-diameter figures are the Level-2 validation anchors.

---

## 1. TIE / GRADE BEAM (RCC band at grade, between columns)

- **Geometry**: 9"×12" to 9"×15" (230×300–380mm), spans full column grid line.
  Distinct from the lighter plinth beam (9"×4"). ([bricknbolt](https://www.bricknbolt.com/blogs-and-articles/construction-guide/plinth-beam-vs-tie-beam))
- **Steel**: 2T+2B Ø12 (extras Ø16); Ø8 stirrups @8" (200mm); cover 30mm.
  Bars continuous through nodes, L-lapped at corners (IS 4326). CL = span + 2×0.5ft hooks.
- **IS basis**: IS 456 flexure + IS 4326 band continuity; IS 13920 waived in practice.
- **Model**: wall-derived band beam, new beamClass `tie`, `beamBehavior='BAND'`.
- **Workbook**: Grade Beam block (Plinth Beam sheet) → TOTAL "Tie Beam"
  308.1/0/597.4/132.7 kg.

## 2. LINTEL / HEAD BEAM (RCC band over openings)

- **Geometry**: 9"×6" (4.5"×6" over half-brick); runs whole wall length as a
  continuous IS 4326 lintel band, not just clear opening. Bearing 150–230mm.
- **Steel**: 2T+2B Ø8 (Ø10/12 on long spans); Ø8 stirrups @6" (150mm); cover 30mm.
  CL = span + 0.5ft. Corner overlap per IS 4326.
- **IS basis**: IS 4326 (primary), IS 456, IS 2502.
- **Model**: wall-derived band beam, existing beamClass `lintel`, `beamBehavior='BAND'`.
- **Workbook**: Lintel block → TOTAL "Lintel" 289.1/74.1/10.7/0 = 373.9 kg
  (61×Ø8 + 10×Ø10 + 1×Ø12 bars).

## 3. SUNSHADE / CHAJJA (cantilever above windows)

- **Geometry**: projection 1.5–2 ft (450–600mm), thickness 75mm, cover 20mm.
- **Steel**: TOP steel only (cantilever tension on top) — Ø8 @6" (150mm) main +
  Ø8 distributor; NO stirrups (it's a slab). ([paramvisions chajja BBS](https://www.paramvisions.com/2022/01/bar-bending-schedule-bbs-of-chajja.html))
- **Anchorage INTO lintel** (defining detail): main bar bends 90° and embeds
  ~2" (site) → code Ld=45d (~360mm for Ø8). Engine: `sunshadeAnchorageIntoLintelFactor` ×Ld
  with a free-edge down-turn. Shape L-bar `11`.
- **Model**: derived from `opening.hasSunshade` + `sunshadeSettings`
  (projectionFt, thicknessIn). Width = window width.
- **Workbook**: Sunshade block → TOTAL 56.88 kg (all Ø8, net 126.1 m, 12 bars).

## 4. LOFT (RCC storage shelf cast into wall)

- **Geometry**: depth/projection ~3–4.5 ft, thickness ~4" (100mm), cover 20mm.
- **Steel**: light single/double Ø8 mat — Ø8 main @8" (200mm) + Ø8 distributor;
  no stirrups. Engine emits TOP+BOTTOM+DIST (Ø8) per the locked decision.
- **Anchorage INTO wall**: ~2" embed (site) → Ld option. Engine:
  `loftEmbedMinMm=230` + `loftEmbedFactor`×Ld. Shape L-bar `11`.
- **Model**: new `wall.loft = { enabled, widthFt, depthFt, heightFt }` attribute
  + `wall.loftSpecId`.
- **Workbook**: Loft block → TOTAL 142.2 kg (all Ø8, net 334.1 m, 30 bars,
  2.5% wastage). Highest kg/m³ ratio (180) — small concrete, lots of bar.

## 5. STRAP / ECCENTRIC FOOTING (two pads + strap beam)

- **Geometry**: two isolated pads (boundary + interior balancing) joined by a
  strap beam (230–300mm × 450–600mm), spanning pad-center to pad-center. Used
  at plot boundaries with eccentric columns.
  ([Structville](https://structville.com/2021/04/design-of-strap-footing-cantilever-footing.html))
- **Steel**: pad bottom mesh Ø10–12 both ways; strap beam is HOGGING-dominated
  so **TOP is primary** (Ø12–16 ×3–4) + BOTTOM (Ø16 ×3–4) + SIDE/MID (Ø12 ×2,
  when D>450mm per IS 456 25.5.1.3) + Ø8 closed stirrups. Pad cover 60, strap 30.
- **Anchorage**: strap top/bottom anchored OVER both pads (+0.5 ft each end).
  Engine: `strapBeamAnchorageFactor`×Ld.
- **Model**: new foundation `type:'STRAP'` with geometry { padA, padB, strap },
  columnIds=[exterior, interior]. RAFT/STRIP/PILE remain deferred.
- **Workbook**: EF1–EF6 (eccentric footing) + CF1 on "Footing & Column" sheet —
  pad mesh Ø10, strap top Ø12/16, bottom Ø16, mid Ø12×2, stirrups Ø8 (two link
  geometries), CL = a + 1.0 ft (0.5 ft anchorage each end).

## 6. SUB vs SUPER STRUCTURE COLUMN (per-segment, ONE column entity)

- **Divider**: top of grade/plinth beam. SUB = footing-top → grade-beam top
  (dowel transition, basement/plinth fill); SUPER = above grade beam, per floor.
  ([99acres plinth beam](https://www.99acres.com/articles/plinth-beam.html))
- **Steel**: longitudinal bars continuous but lap zones differ. Footing dowel =
  L-bar (embed = Ld_compression, projection = lap). Sub→super lap = 50d at grade.
  SUPER lap in central half + lo-confinement only when enabled (IS 13920). SUB
  uniform stirrups, no confinement.
- **Model**: ONE `column.id` → multiple RebarGroups; `column.position:'SUB'|'SUPER'|null`
  override; auto-derive SUB segment = footing-top→grade-beam region.
  `meta.segmentType ∈ AUTO_SUB|AUTO_SUPER|FORCED_SUB|FORCED_SUPER`.
- **Workbook**: GF column sheet literally tags "Substructure"; lap 1.968ft(Ø12)/
  2.624ft(Ø16) = 50d; dowel b-leg 1.5ft into footing. Sub 863.9 / Super 716.99 kg.

## 7. STAIRCASE (dog-legged waist slab) — ESTIMATE-grade, buildable

**Verdict: build it, ESTIMATE-grade.** Geometry is deterministic from the
entity; bar rules well-corroborated. Caveat: the flight↔landing kink detail
varies (one cranked bar vs two overlapping bars) but total weight is
insensitive (±15%). **Reference workbook scheduled staircase = 0 kg (never
detailed) → NO workbook validation; the ~70 kg worked example is the only seatbelt.**

- **Geometry**: tread 250–300mm, riser 150–170mm, waist 150mm, flight width
  0.8–1.0m, cover 20mm. Dog-legged = 2 flights + 1 mid landing.
  Per flight: `goingFt = stepsPerFlight×treadIn/12`, `riseFt = stepsPerFlight×
  riserIn/12`, `inclinedWaistFt = hypot(going, rise)` ← KEY span.
- **Steel**: waist MAIN Ø10–12 @125–150 (bottom, along going) + DIST Ø8
  @150–200 (min 0.12%); landing main+dist; optional EXTRA_TOP at kink (default
  OFF). No stirrups (slab).
- **IS basis**: IS 456 Cl 33 (stairs; eff. span = going + min(½landing,1m);
  Cl 33.2 landing 50/50 split), SP 34 detailing, IS 2502 shapes.
- **Anchorage**: main anchored Ld (**Fe500/M20 = 56.6d, NOT the commonly-
  misquoted 47d which is Fe415**) into each landing. Waist main modeled as
  cranked multi-bend (shape `21`/`03`), reuses crank machinery (0.42D, L/4, 45°).
- **Model**: `staircaseRebar.js` from staircase entity; `reinforcementSpecId`
  slot added. Count once at project level (spans floors), per riser rule.
- **Worked sanity band**: dog-legged going 9ft/rise 5ft, Ø10@150 + Ø8@150,
  flight 3.5ft → **~65–75 kg total**. Engine output outside ~50–90 kg = bug.

Sources: [IS 456 Cl 33 staircase](https://www.civilengineeringweb.com/2023/10/effective-span-of-staircase.html),
[NPTEL stairs](https://priodeep.weebly.com/uploads/6/5/4/9/65495087/staircases.pdf),
[staircase BBS crank](https://thecivilengineerings.com/bar-bending-schedule-of-staircase-staircase-reinforcement-detail-bbs-calculation-formula-doglegged-stair/),
[Ld Fe500/M20=57d](https://www.iscodehub.com/is/is-456/development-length),
[SP 34:1987](https://law.resource.org/pub/in/bis/S03/is.sp.34.1987.pdf),
[reentrant corner detail](https://www.eng-tips.com/threads/concrete-reentrant-corner-reinforcement.137279/).

---

### Key assumptions to confirm with an engineer
1. Loft top+bottom mat (workbook lists single flat mat; engine emits both faces Ø8).
2. Strap pad top mesh OFF (bottom-only) for residential; strap IS 13920 OFF (gravity, below grade).
3. SUB confinement OFF; SUPER lo-zones gated on `confinementZoneEnabled`.
4. Sunshade/loft anchorage default = Ld (code) with 2" site embed as the
   `simplified` option.
5. Default lap stays 56.6d (code); 50d available via `simplified`/Fe550 keys.
