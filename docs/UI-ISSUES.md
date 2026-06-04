# UI Issues Log

Tracks user-facing UI defects (separate from engine/BOQ correctness). Most
recent first.

---

## BE-FaceLookup-001 — Room Tool can't create sub-span rooms / false "open" on full-length walls (✅ RESOLVED 2026-05-30)

- **Status**: RESOLVED · **Severity**: high (blocked defining rooms on real F1 plans)
- **Symptom**: tracing F1 in Inside-face mode, the manual Room Tool reported a
  visually-closed room as "open" (red corners) and the area read ~11% high
  (111.13 vs 100 sqft). Rooms bounded by a **sub-span** of a full-length
  (T-junctioned) wall could not be created.
- **Root cause (two layers)**: (1) the pre-Phase-W manual Room Tool computed
  closure from each wall's `n1`/`n2` endpoints only — a full-length boundary
  wall's endpoints lie OUTSIDE the room, so they read as "open corners" and the
  Save gate blocked creation. (2) latent: `findFaceContainingEdge`
  (`topology/faces.js`) keyed its `byEdgeSide` lookup off the FULL wall
  endpoints `n1→n2`, but the index is keyed per expanded SEGMENT, so
  `room_detect` returned `null` for any sub-span boundary on a junctioned wall.
- **Fix (Option A — converge on the face graph)**: retired the manual Room Tool
  + its endpoint-counting gate (deleted, greenfield). `room_detect` is now the
  single Room tool (bare **R**, label "Room"), instant-create, with smart-MEP
  folded into its click handler. `findFaceContainingEdge` now resolves the
  segment nearest the click via `getOrderedWallJunctions` and keys off that
  segment's node pair. Walls stay full entities — Phase W honored, no split.
- **Verify**: `verify-room-detection.mjs` Section H (sub-span detection, 104
  assertions); all 34 verify scripts green; `vite build` clean.
- **Validated end-to-end in canvas 2026-05-30 by user**: 10×10 closed-chain →
  room at 100 sqft; T-junction sub-span → room on the sub-region; room
  selection auto-works. Canvas behavior agrees with verify.

## BE-DrawHelpOverlay-001 — Draw help bar overlaps wall-length input (✅ RESOLVED 2026-05-30)

- **Status**: RESOLVED · **Severity**: cosmetic (input functional but covered)
- **Root cause**: the "Length" input panel and the chain-drawing help bar were
  both hard-coded to `bottom:80, left:50%, zIndex:20`; with `drawStartId` set
  (centerline mid-chain draw) both rendered at the identical position and the
  later-painted help bar covered the input.
- **Fix**: moved the Length input panel to `bottom:128` (`Canvas.jsx`) so it
  stacks above the help bar, which keeps its `bottom:80` anchor (it renders in
  both draw states). Pure positioning constant — same class as
  BE-DrawRegression-001 (layering without reflow).
- **Verify**: `vite build` clean; ESLint unchanged from baseline. Visual check
  by user.

## BE-DrawRegression-001 — Toolbar overlap (✅ RESOLVED 2026-05-29)

- **Status**: RESOLVED · **Severity**: high (blocked in-canvas demo to MD)
- **Root cause**: the "Drawing to:" mode badge was an absolute overlay at
  `top:12, left:12, zIndex:20` — inside the toolbar's band (`top:8/left:8`,
  z `--z-panel`=10), and the Structural & Civil flyout opens at
  z `--z-overlay`=50, so the flyout overlapped the badge.
- **Fix**: moved the badge to `top:56, left:16` (`Canvas.jsx` ~1227) — below the
  toolbar, in the same top-left offset selection panels use. The badge only
  shows during draw/rect_room (no selection panel open), so no new collision.
- **Verify**: `vite build` clean; visual reflow (manual demo check).

<details><summary>original report</summary>

- **Status**: open · **Severity**: high (blocks in-canvas demo to MD)
- **Reported**: 2026-05-29 (introduced "last night" — Phase D / face-aware draw
  landing, commit window around the Drawing-to segmented control + canvas mode
  badge).
- **Symptom**: toolbar elements overlap (controls render on top of each other /
  unclickable region). Reported during the draw workflow.
- **Likely area**: `src/components/Toolbar.jsx` + `src/components/toolbarConfig.js`
  (Phase D added the "Drawing to: [Inside/Center/Outside]" segmented control to
  the Draw cluster `groups[]`) and/or the canvas mode badge pill
  (`src/components/Canvas.jsx`, top-left pill during draw/rect_room). Check
  z-index tokens (`--z-selection-panel` 30 vs `--z-overlay` 50) and the badge's
  absolute positioning vs the toolbar.
- **Repro**: open a project, activate Draw — observe toolbar layout.
</details>

## BE-DrawRegression-002 — Chain-draw stops after first segment in Inside-face mode (✅ RESOLVED 2026-05-29)

- **Status**: RESOLVED · **Severity**: high (blocked in-canvas demo to MD)
- **Root cause**: `Canvas.jsx:858` used `SNAP_IN` in the face-mode closure
  check but only `snapIn` (the function) was imported from `../geometry` —
  `SNAP_IN` (`const = 4`) was never imported. On click 2+ in face mode
  (`drawChainBuffer.length >= 2`) the closure block threw a `ReferenceError`,
  aborting the handler before the buffer append, so no further segment
  committed. Centerline mode was unaffected (legacy path never reaches that
  line) — which is exactly why it "worked in Center but failed in Inside-face."
- **Fix**: added `SNAP_IN` to the `from '../geometry'` import in `Canvas.jsx`.
- **Verify**: `verify-draw-reference.mjs` Section O (static guard: every
  ALL-CAPS geometry identifier used in Canvas.jsx must be imported — proven to
  fail when the import is removed, pass when restored) + Section P (4-point open
  inside_face chain converts to 4 points / 3 edges, no false closure). All 34
  verify scripts green; `vite build` clean.

<details><summary>original report</summary>

- **Status**: open · **Severity**: high (blocks in-canvas demo to MD)
- **Reported**: 2026-05-29 (Phase D face-aware draw).
- **Symptom**: in `inside_face` draw reference mode, chain drawing stops after
  the first segment — subsequent clicks don't continue the chain.
- **Likely area**: `src/components/Canvas.jsx` Phase D **buffer-then-commit**
  chain logic — `drawChainBuffer` local state for face/outside modes accumulates
  clicks as `{point, snapRef}` and only commits on Enter/double-click/closure.
  The regression suggests the buffer isn't accumulating past click 1 in
  `inside_face` (vs `centerline` mode which uses the legacy per-click commit and
  reportedly still works). Check the `useEffect([drawReference])` reset (CLAUDE:
  "Toggle mid-trace = discard buffer") firing spuriously, and the face-mode
  click handler appending to `drawChainBuffer`.
- **Contrast**: `centerline` mode (legacy per-click commit path) reportedly
  unaffected — points to the face-mode buffer path specifically.
- **Repro (to confirm)**: set Drawing-to = Inside, draw a wall chain, click a
  second point — chain does not extend.
</details>

> Both demo blockers resolved 2026-05-29 (this run). Neither touches the BBS
> engine. Live in-canvas confirmation of the 3-click chain + badge position is
> the user's final demo check; the build + verify guards cover regression.
