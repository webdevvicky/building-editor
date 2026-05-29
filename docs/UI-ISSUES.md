# UI Issues Log

Tracks user-facing UI defects (separate from engine/BOQ correctness). Most
recent first.

---

## BE-DrawRegression-001 — Toolbar overlap (DEMO BLOCKER)

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
- **Repro (to confirm)**: open a project, activate Draw — observe toolbar layout.
- **Not yet root-caused** (logged as reported; needs an in-app repro pass).

## BE-DrawRegression-002 — Chain-draw stops after first segment in Inside-face mode (DEMO BLOCKER)

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
- **Not yet root-caused** (logged as reported; needs an in-app repro pass).

> Both are scheduled as demo blockers (fix before the in-canvas MD demo).
> Neither touches the BBS engine. P0 today is the BBS footing fix + site-practice
> allowance mode (see plan); these two are queued right behind.
