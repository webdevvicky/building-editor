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

**P0 status (2026-05-29): both blockers resolved.**
1. **BE-Footing-Ld-001 — ✅ FIXED.** Footing mesh bar now spans the pad
   (`pad − 2×cover + 2 hooks`), not `pad + 2×Ld`. Per-bar +88% → +2% (IS) / 0%
   (site).
2. **SITE_PRACTICE allowance mode — ✅ SHIPPED.** A single project switch
   (`bbsAllowanceMode`, default `IS_STRICT`) flips IS 2502-strict conventions to
   the flat site conventions a contractor's hand BBS uses (50d lap, flat ft
   hooks/bends, no bend deductions) via a centralized `allowanceMm()` resolver
   (closed `kind` enum, mode-only switch). In SITE_PRACTICE the engine
   reproduces the workbook bars to **±2%**; IS_STRICT stays IS-correct and
   byte-identical (verify-bbs 176/176, all 34 scripts green).

The Karthick `TOTAL` sheet is still **not a usable per-category gold standard**
— a hand roll-up that doesn't reconcile to its own detail sheets (footing
detail ~707 kg vs TOTAL 833.8), the **Grade/Plinth row is `#REF!`**, the
**Tie-Beam total cell is 0**. Per-**bar** detail is the validation surface.

**Ready to show an MD?** Yes — as **"defaults to IS-correct, matches site
convention on demand."** IS_STRICT for engineering rigour; SITE_PRACTICE to
reproduce the contractor's BBS within ±2% per bar.

---

## PART 1 — per-bar cutting length, BOTH modes (the MD-facing proof)

Each bar is built as a single-element fixture and run in both modes vs the
workbook. Class: (b) IS-interpretation, (e) scope/model difference.

| Bar | Workbook (ft) | IS_STRICT | ISΔ% | SITE_PRACTICE | SITEΔ% | Note |
|---|---|---|---|---|---|---|
| Footing mesh F1 Ø10 | 4.106 | 4.197 | +2% | **4.106** | **0.0%** | ✓ site exact (BE-Footing-Ld-001 fixed) |
| Column main C2 Ø12 | 12.968 | 13.228 | +2% | **12.969** | **0.0%** | ✓ site exact (50d lap) |
| Roof beam top B8 Ø16 | 33.054 | 34.525 | +4% | **33.054** | **0.0%** | ✓ site exact (flat 0.75ft bends) |
| Roof beam stirrup Ø8 9×15 | 3.813 | 3.475 | −9% | **3.738** | **−2.0%** | ✓ site within ±2% (flat hook) |
| Sunshade main Ø8 | 4.551 | 3.183 | −30% | 3.236 | −28.9% | (e) bar-axis model diff — P2, not forced |

**Reading:** in SITE_PRACTICE, 4 of 5 bars land **0.0% to −2.0%** — the engine
reproduces the hand BBS on demand. IS_STRICT runs a few % heavier (the
IS-correct direction). Sunshade stays a documented model difference in both
modes (P2 backlog — bar-axis convention, not an error). verify-bbs Section O
asserts the ±2% site-mode result on every commit; this table is produced by
`scripts/validate-bbs-karthick.mjs` (both modes side by side).

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

1. **BE-Footing-Ld-001 (HIGH) — ✅ FIXED 2026-05-29.** Footing mesh bar was
   `padDim + 2×Ld` (~+88%/bar); now `padDim − 2×cover + 2×9d end hooks` (the bar
   spans the pad; Ld is *satisfied by* that span). Applied to both
   `footingRebar.js::_buildMeshGroups` and `strapFootingRebar.js::addPad`.
   Per-bar now +2% vs workbook (within ±5%). verify-bbs Section D updated with a
   regression guard (`X_MESH < 1800mm`, NOT pad + 2×Ld).
2. **Site-practice allowance mode — ✅ SHIPPED 2026-05-29.** `bbsAllowanceMode`
   project setting (IS_STRICT default | SITE_PRACTICE) + centralized
   `allowanceMm({kind,diaMm,params})` resolver (closed kind enum, mode-only
   switch — generators never inspect mode). SITE_PRACTICE = 50d lap, flat ft
   hooks/bends, no bend deductions. Reproduces the workbook to ±2% per bar
   (PART 1). BBSSpecPanel toggle. verify-bbs Section O guards it.
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
