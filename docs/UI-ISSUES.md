# UI Issues Log

Tracks user-facing UI defects (separate from engine/BOQ correctness). Most
recent first.

---

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
