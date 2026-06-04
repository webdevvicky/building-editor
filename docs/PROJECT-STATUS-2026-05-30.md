# Building Editor — Project Status (2026-05-30)

Repo-verified status snapshot. Every file/sheet/number below is checked against
the codebase in `main` as of this date. Hypotheses and external-reference
analysis are explicitly excluded — see the "Not in this document" note at the end.

---

## 1. Engine

Five-layer architecture — **Geometry/Topology → Quantities/MEP/Validation → BOQ
presentation → UI/Persistence/Export** — gated by **34 verify scripts** (all
green this session). `verifyIntegrity` (INV-W1–W10 referential integrity) is the
first assertion of every state-building verify script.

## 2. Draw + Room Tool — canvas-validated 2026-05-30

- Face-aware draw: `inside_face` / `centerline` / `outside_face` reference modes.
- Wall-length input **autofocuses** at chain start and **re-focuses per segment**
  (shipped today).
- **Single Room tool**: `room_detect`, bound to bare **R**, labeled "Room".
  Face-graph based; click a boundary wall on the room's interior side →
  smallest enclosing face → `createRoomFromFace` (smart-MEP folded in). Handles
  **sub-span rooms** on full-length T-junctioned walls.
- Validated live in canvas today: 10×10 closed-chain → 100 sqft; T-junction
  sub-span → room on the sub-region; auto-selection. Behavior agrees with
  `verify-room-detection.mjs` Section H (104 assertions).

## 3. BBS engine

- IS 2502 RebarGroup engine. All IS factors live in the catalog
  `src/specs/cuttingLength.js` (no magic numbers in generators); RebarGroup is a
  **computed object, never persisted**.
- Two convention modes: **IS_STRICT** (code-exact; byte-identical to the original
  path) and **SITE_PRACTICE** (flat ft allowances + 50d lap). SITE_PRACTICE
  reproduces a contractor's hand BBS to **±2% per bar** — validated against the
  Karthick M-City workbook; see `docs/BBS-VALIDATION-KARTHICK.md`.
- `BBS_CATEGORY` taxonomy (`src/bbs/types.js`) covers footing, strap footing,
  sub/super column, column, tie/plinth/lintel/roof/generic beam, sunshade, loft,
  staircase, slab variants (~16 entries incl. aliases). Per-category bar-mark
  prefixes via `getBarMarkPrefix`.
- Three output levels: L1 per-bar detail, L2 `byBbsCategory` abstract
  (`src/bbs/concrete.js` kg/m³), L3 Excel + PDF (`src/export/bbs.js`;
  `verify-bbs-export` green). **Export is wired in `BBSSchedulePanel.jsx`**
  (buttons call `exportBbsExcel`/`exportBbsPdf`) — the `// TODO BBS-5b` comment +
  the CLAUDE.md BBS-5b backlog line are stale.

## 4. BOQ engine

- Single canonical `computeBoqPresentationModel` is the only source for Excel +
  PDF totals — neither exporter does independent math. `verify-boq` byte-equality
  canary locks the pipeline against drift.
- Export is **bucket-driven** via `src/export/_buckets.js` (**~22 category
  buckets**: Excavation, Plum Concrete, Structural, Concrete, Steel, Steel — by
  Bar Diameter, Shuttering, Masonry, Plaster, Finishes, Paint Materials, Ceiling
  Finish, Tiles, Joinery & Hardware, Grills & Handrails, Civil, Staircase,
  Plumbing, Electrical, HVAC, Fire, ELV). The number of Excel sheets in any given
  export = Summary + non-empty buckets + Raw Data, so it varies per project.
- **Pricing**: the BOQ panel has **live, ephemeral (non-persistent) rate inputs**
  plus a **Project Cost Summary** (labor / supervision / overhead / profit / GST).
  There is **no persistent rate library / catalog** — that is the gap, not the
  ability to price.
- Masonry aggregates by `materialKey`, **not by wall thickness** — 9" structural
  and 4.5" partition of the same material land in one bucket (no thickness split).

## 5. Shipped today (2026-05-30) — all in `main` (496d4b7 → bc74622)

- **BE-FaceLookup-001** — `findFaceContainingEdge` keys its `byEdgeSide` lookup
  off the clicked SEGMENT (via `getOrderedWallJunctions`), not the full wall
  endpoints → sub-span room detection on junctioned walls.
- **Option A convergence** — retired the pre-Phase-W manual Room tool +
  endpoint-counting closure gate (deleted, greenfield); `room_detect` is the
  single Room tool with smart-MEP folded in.
- **BE-DrawCorners-001** — bounded ~8in CORNER-reuse join for independently-drawn
  face-mode wall chains (real, orthogonal bug).
- **BE-DrawHelpOverlay-001** — draw help bar no longer covers the Length input.
- **UX** — wall-length input autofocus (chain start + per segment).

## 6. Validated against external reference

BBS output validated to ±2%/bar (SITE_PRACTICE) against the **Karthick M-City**
Chennai residential workbook; documented in `docs/BBS-VALIDATION-KARTHICK.md`.

## 7. Locked architectural rules (CLAUDE.md — do not violate)

1. **Phase W**: one wall = one full-length entity; T-junctions first-class
   (`wall.junctions[]`); NO auto-split, NO manual split.
2. **RebarGroup is computed, never persisted.**
3. **No magic numbers in BBS generators** — all IS factors from
   `src/specs/cuttingLength.js`, per-project overridable.
4. **Single source of truth over layered fallbacks.**
5. **Verify must drive the actual UI entry-point** with realistic state
   (T-junctions, multiple walls), not just the math kernel.
6. **MCP-first** for framework patterns; cited web research for IS-code /
   Chennai-practice rules.
7. **Greenfield**: no migration code, no compatibility shims — delete, don't
   deprecate.

## 8. Reference workbooks in the repo (root)

- `BBS- Karthick M-City (1).xlsx` — BBS validation reference (±2% target).
- `SELVAKUMAR (1).xlsx` — structural reference workbook.

(No PDFs and no `Qty.xlsx` are committed to the repo.)

## 9. Open items / backlog (CLAUDE.md)

- **BBS-UI-Enablement (Reinforcement Library tab)** — the newer BBS categories
  (tie/lintel/sunshade/loft/staircase/strap/sub-super) are engine-complete but
  **default-inert**; no per-category enablement UI yet. Gap between "engine
  works" and "engine is usable per-project."
- **Persistent rate library / ERP catalog** — ephemeral rate inputs exist; no
  saved/reusable rate catalog.
- **RAFT / STRIP / PILE foundation BBS** — `generateFootingRebarGroups` returns
  `[]` for these.
- **BE-Legacy-001** — legacy `FT_PER_MM` under-counts the old column lap ~10×
  (legacy aggregator only; the RebarGroup path is correct).
- **BE-Excavation-001** — excavation footprint still sums centerline room area,
  not true built-up.
- **BE-Cleanup-001/002** — `deleteWall` doesn't cascade to `foundation.wallIds`
  or orphaned MEP fixtures.
- **BBS-RealPlan-001** — `verify-bbs` uses synthetic fixtures, not real-plan
  canaries.
- **dimensionMode display** — saved-room area panel can read centerline vs
  clear_internal.

## 10. Suggested next steps (in order)

1. **Reinforcement Library tab** — per-category BBS enablement UI (the deferred
   "foundation-first" item; unlocks the BBS engine for real per-project use).
2. **Persistent rate library** — turn ephemeral rate inputs into a saved catalog
   through the canonical `getBoqLines` pipeline.
3. **Clear backlog deltas** — BE-Excavation-001 (with a planned verify
   rebaseline), BE-Legacy-001 lap, RAFT/STRIP/PILE BBS, BE-Cleanup-001/002.
4. **BBS-RealPlan-001** — add real-plan canaries (stacked-rooms / L+T-junction)
   to `verify-bbs`.

---

**Not in this document (by design):** the afternoon BOQ-delta analysis against
`Qty.xlsx` (brick / plaster / paint / tile percentages) — those are hypotheses to
investigate with a controlled fixture, not repo-verified facts. The only
repo-confirmed part of that analysis is the masonry thickness-aggregation
(no 9"/4.5" split) noted in §4. `Qty.xlsx` is an external reference, not a repo
file.
