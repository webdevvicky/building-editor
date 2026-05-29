# BBS Engine — Reference Validation (Karthick M-City + Selvakumar)

**2026-05-29. Read-only.** Runs OUR engine against fixtures reconstructed from
the two reference workbooks and reports what it produces today. **No engine
code was modified to make numbers match.** Rerun:
`node --experimental-loader ./scripts/resolver-hook.mjs scripts/validate-bbs-karthick.mjs`
(fixture-construction code is in that script).

## Headline verdict

The engine's **cutting-length math is sound** — for ordinary bars (column main,
beam top, stirrup) it lands within **±2–9%** of the professional reference, and
the residual is a *documented convention difference*, not an error: the
workbooks use **flat site allowances** (50d lap, 0.25/0.5/0.75 ft hooks/bends)
while our engine uses **strict IS 2502** (56.6d lap, dia-based `n·d` bend
deductions, 9d hooks, full development-length anchorage). Our numbers run a few
percent *heavier* on laps/anchorage — which is the IS-correct direction.

**Two things block a clean "matches professional reference" claim:**
1. **One real over-count bug** — footing mesh bars (PART 1, +88% per bar). The
   engine adds `2×Ld` to the pad dimension; a footing bar physically spans the
   pad (≈ pad − 2·cover + small hooks). Punch-list item **BE-Footing-Ld-001**.
2. **The Karthick `TOTAL` sheet is not a usable gold standard** — it is a hand
   roll-up that does **not** reconcile to its own detail sheets (footing detail
   sums to ~707 kg vs TOTAL 833.8), the **Grade/Plinth row is `#REF!`**, and the
   **Tie-Beam total cell is 0** while its diameter cells sum to 1038 kg. So a
   per-category ±5% comparison against TOTAL is not meaningful in either
   direction. Per-**bar** detail (where the workbook is internally exact) is the
   real validation surface.

**Is it ready to show an MD as "matches professional reference"? Not yet — but
close on the fundamentals.** The cutting-length engine is trustworthy; with the
footing fix + an optional "site-practice allowance" mode (50d lap, flat hooks)
it would track a site BBS within a few percent. Today, show it as "IS 2502-
strict; reconciles to reference per-bar within convention; punch list below."

---

## PART 1 — per-bar cutting length (the real signal)

Each row builds a single-element fixture matching a representative reference bar
and compares the engine's cutting length to the workbook's. Classes: (a) input
mismatch, (b) IS-interpretation difference, (c) engine bug, (d) reference wrong,
(e) scope/model difference.

| Bar | Workbook (ft) | Engine (ft) | Δ% | Class | Cause |
|---|---|---|---|---|---|
| Footing mesh F1 Ø10 | 4.106 | 7.714 | **+88%** | **c** | engine adds `2×Ld` (56.6d=3.71ft); a footing bar should span the pad (≈ pad−2cover + hooks). **Over-counts footing steel.** |
| Column main C2 Ø12 | 12.968 | 13.228 | +2% | b | engine lap 56.6d (2.23ft) vs workbook 50d (1.968ft) |
| Roof beam top B8 Ø16 | 33.054 | 34.525 | +4% | b | engine Ld anchorage per end (interior=Ld/2) vs workbook flat 0.75ft bends |
| Roof beam stirrup Ø8 (9×15) | 3.813 | 3.475 | −9% | b | engine `2(w+d)+2·9d−4·2d` (IS 2502) vs workbook `2(a+b)+2×0.26248` flat hook |
| Sunshade main Ø8 | 4.551 | 3.183 | −30% | e | different bar model: engine MAIN = cantilever along projection (+Ld into lintel); workbook MAIN runs the window width |

**Reading:** 3 of 5 bars within ±10% (column, beam, stirrup) — the core math is
right. The footing bar (+88%) is the one genuine bug. The sunshade (−30%) is a
modelling choice difference, not an error (the two BBSs define the "main" bar
along different axes; total chajja steel is comparable but bar-by-bar differs).

---

## PART 2 — per-category kg + concrete (indicative only)

Built a single-wall + 11-footing + 13-column fixture and ran the L2 abstract.
**This is NOT a clean per-category validation** — (i) it's one 300 ft wall, so
beams/lintel/sunshade/loft are one-instance not whole-building; (ii) one column
type (the reference has C1–C5 incl. Ø16 heavies); (iii) no roof slab (no rooms);
(iv) the TOTAL sheet itself is unreliable (above). Numbers show the engine
*produces sane category output*, with deltas dominated by inventory
completeness, not engine behaviour.

| Category | Engine kg | TOTAL kg | Δ% | Engine m³ | TOTAL m³ | Delta cause |
|---|---|---|---|---|---|---|
| FOOTING | 855 | 834 | +2% | 0.00¹ | 8.62 | coincidental — footing Ld over-count (PART 1) offset by fewer/smaller fixture pads |
| SUB_COLUMN | 249 | 864 | −71% | 1.92 | 2.29 | (a) one Ø12 type vs C1–C5 incl Ø16; short sub segment |
| SUPER_COLUMN | 485 | 717 | −32% | 3.74 | 5.15 | (a) inventory: single column type/section |
| TIE_BEAM | 516 | 1038 | −50% | 7.96 | 0² | (a) one wall vs full grade-beam grid; ² TOTAL cell broken |
| PLINTH_BEAM | 0 | `#REF!` | — | 0 | 5.33 | (d) reference `#REF!`; (a) not in fixture |
| LINTEL_BEAM | 288 | 374 | −23% | 3.19 | 3.53 | (a) one wall; concrete tracks well (−10%) |
| SUNSHADE | 5 | 57 | −91% | 0.05 | 0.60 | (a) one window vs ~12 + (e) bar-model diff |
| LOFT | 48 | 142 | −66% | 0.65 | 0.79 | (a) one loft vs ~7 |
| STAIRCASE | 0 | 0 | 0% | 0 | 0 | reference never scheduled the stair (matches our 0) |
| ROOF_BEAM | 772 | 2009 | −62% | 7.96 | 8.21 | (a) one wall; concrete tracks well (−3%) |
| ROOF_SLAB | 0 | 2532 | −100% | 0 | 23.11 | (a) no slab/rooms in fixture |

¹ Footing concrete shows 0 only because the fixture omitted `geometry.depthFt`
(a fixture gap, not an engine bug — `concrete.js` reads `depthFt`).
² Tie-Beam TOTAL cell shows 0 in the workbook (its dia cells sum to 1038 kg).

**Signal worth noting:** where geometry is comparable, **concrete tracks
closely** — ROOF_BEAM m³ −3%, LINTEL m³ −10%, SUB/SUPER column m³ within ~25%.
The concrete model is sound; the steel deltas are inventory + the footing bug.

---

## Selvakumar (`Roof Beam & slab`)

Single detail sheet (G+3 residence), no TOTAL. Diameters 8/12/16/**20** mm —
the engine's catalog handles all (incl. Fe550D + 20mm unit weight). Same flat-
allowance convention as Karthick, confirmed on its representative bars:

| Bar | Workbook (ft) | Expected engine behaviour |
|---|---|---|
| Roof beam bottom B1 Ø16 (a 23.08, cut 24.08 = a+0.5+0.5) | 24.08 | engine adds Ld anchorage per end (interior Ld/2) instead of flat 0.5ft → same +3–5% as Karthick beam |
| Roof beam top-extra Ø20 (a 6.5, cut 6.5 straight) | 6.50 | engine does **not** model "extra/curtailed" bars as a role — (e) scope gap: our beam emits full-length TOP/BOTTOM only |
| Slab bottom-through Ø8 (a 12.6, cut 12.767 = a+0.1667) | 12.767 | engine slab MAIN adds Ld both ends (heavier) + models cranks; (b)/(e) |

Selvakumar adds **two scope gaps to track**: (1) curtailed/extra bars (top-extra,
bottom-extra) are common in roof beams and our beam generator doesn't emit them;
(2) the workbook's slab "through + extra" double-mat layout differs from our
main/dist/crank model. Neither is wrong, but they're why a roof-beam/slab
per-bar set won't line up 1:1.

---

## Punch list (prioritised — for the NEXT phase, not fixed here)

1. **BE-Footing-Ld-001 (HIGH)** — footing mesh bar length = `padDim + 2×Ld`
   over-counts by ~88%/bar. Should be `padDim − 2×cover + standard end hook`
   (the bar spans the pad; Ld is *satisfied by* that span, not added to it).
   Same issue affects strap-footing pad mesh. `src/bbs/generators/footingRebar.js`
   `_buildMeshGroups` + `strapFootingRebar.js`.
2. **Site-practice allowance mode (MEDIUM)** — add a project toggle that swaps
   the IS 2502-strict allowances for the site convention (50d lap via the
   existing `simplified` lapKey; flat hook/bend allowances). Lets the BBS match
   a contractor's hand BBS within a few percent when desired. Decision 3 already
   exposes the lap key; this generalises it to hooks/anchorage.
3. **Beam curtailed/extra bars (MEDIUM)** — add EXTRA_TOP/EXTRA_BOT (curtailed)
   bar roles to `beamRebar.js`; both reference workbooks schedule them.
4. **Sunshade bar-axis convention (LOW)** — reconcile our cantilever-along-
   projection MAIN with the reference's width-run main; document or align.
5. **Slab double-mat layout (LOW)** — reference uses through+extra top/bottom
   mats per direction; our main/dist/crank model differs. Reconcile for roof slab.
6. **Fixture/concrete gap (LOW)** — ensure foundation `geometry.depthFt` flows
   into `concrete.js` footing volume (verify on a real project; fixture omitted it).

## How to reproduce
`scripts/validate-bbs-karthick.mjs` builds every fixture above from inline data
(footing pad sizes, column counts, bar specs read from the detail sheets) and
prints both tables. Edit the inventory arrays there to refine the per-category
fixture toward the full building. The reference workbooks stay in the repo root.
