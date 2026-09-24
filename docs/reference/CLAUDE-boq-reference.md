---
title: BOQ Project Reference Documentation
description: |
  Short reference for the boq Building Editor. Corrected 2026-09-23: the previous version described files,
  store fields and scripts that do not exist. The authoritative, code-verified map is docs/CODEBASE_MAP.md.
---

# BOQ Project Reference Guide

> **Corrected 2026-09-23.** Earlier revisions of this file described a nested store (`store.mep`, `store.structural`),
> files such as `Panels.jsx`, `boq/emitter.js`, `quantities/steelQty.js`, `topology/wallTopology.js`,
> `export/csv.js`, `hooks/useWallSelection.js`, and an `npm run verify` git-hook gate — **none of these exist**.
> For architecture, data flows, the ERP contract, verification and Known Defects use
> [`../CODEBASE_MAP.md`](../CODEBASE_MAP.md). Rules and workflow: [`../../CLAUDE.md`](../../CLAUDE.md).

---

## 1. Project overview

- **Stack:** React 19 + Vite 8 + Zustand 5, plain JavaScript (no TypeScript).
- **Layering:** Geometry (store) → Topology (pure) → Quantities (pure `quantities/` + `mep/quantities/` **and**
  store getters) → `boq/` presentation → UI + Export.
- **State:** one flat Zustand store — `src/store.js` (2,526 lines) plus exactly two slice factories spread into it,
  `createStructuralSlice` (`structuralSlice.js`, 2,170 lines) and `createMepSlice` (`mepSlice.js`, 490 lines).
- **Export:** PDF (jsPDF + jspdf-autotable), Excel (SheetJS), BBS workbook. No CSV.
- **Persistence:** IndexedDB (`boq-app` v3) with BroadcastChannel cross-tab sync for local projects; ERP mode syncs
  via `src/projects/` (see map §4–§5). Revisions are in localStorage.
- **Verification:** 52 `scripts/verify-*.mjs` Node harnesses, run manually with the resolver hook. No npm script,
  no git hook.
- **Deployment:** Cloudflare Workers via `@cloudflare/vite-plugin` + `wrangler.jsonc` (name `building-editor`,
  compatibility_date 2026-06-16, SPA asset handling).

## 2. Directory structure

See [CODEBASE_MAP §2](../CODEBASE_MAP.md#2-directory-structure) (per-directory file and line counts).
Summary: `components/` (75 `.jsx`: 42 top-level + `boq/` 17 + `canvas/` 6 + `ui/` 10), `topology/` (19 files),
`mep/` (83), `bbs/` (11), `specs/` (11), `quantities/` (12), `boq/` (8 + 5 emitters), `projects/` (30),
`export/` (4), `hooks/` (2), `lib/` (4), `constants/` (5), plus `snap/ draw/ iso/ underlay/ ghosts/ revisions/
validation/ schema/ formulas/ design/`, dormant `operations/`, dead `compute/`, expired `store/legacyAccessors.js`.

## 3. Key files & modules

| File / dir | Role |
|---|---|
| `src/store.js` | flat store: nodes/walls/rooms/stamps, UI keys, 50-frame history, `loadProject`, quantity getters |
| `src/structuralSlice.js` | columns/beams/slabs/staircases/foundations, `DEFAULT_PROJECT_SETTINGS`, floors, structural quantity getters |
| `src/mepSlice.js` | plumbing, electrical, hvac, fire, elv, solar + risers |
| `src/components/Canvas.jsx` | SVG draw surface: drawing, placement, selection, pan/zoom |
| `src/App.jsx` | mounts every panel flat; panels self-gate on `activeTool` / `selected*Id` |
| `src/hooks/useKeyboardShortcuts.js` | global shortcut registry `KEYBOARD_SHORTCUTS` |
| `src/boq/` | `scope.js` → `lines.js` (+ `emitters/*`) → `presentationModel.js` |
| `src/topology/` | pure: rooms, faces, junctions, adjacency, beams, surfaces, floors, building area |
| `src/quantities/` | `_metaContract, bbs (legacy steel), ceilingFinish, doorHardware, excavation, foundations, grills, joinery, paint, plaster, shuttering, tiles` |
| `src/bbs/` + `src/specs/cuttingLength.js` | `computeRebarGroups` + 8 generators; IS-2502 catalog |
| `src/export/` | `pdf.js`, `excel.js`, `bbs.js`, `_buckets.js` |

## 4. State management

Wholly superseded — see [CODEBASE_MAP §3.1](../CODEBASE_MAP.md#31-store-storejs--2-slices). Key facts: collections
are `{[id]: entity}` maps at the root (MEP is 7 flat maps, not `mep.{…}`); tool key is `activeTool`; selection is
per-type `selected*Id`; pan/zoom are Canvas local state; projects/current project live in `projects/manager.js`;
revisions in `revisions/manager.js`; no immer — actions return `set(s => ({...spread}))`.

## 5. Verification scripts

See [CODEBASE_MAP §7](../CODEBASE_MAP.md#7-verification-harnesses). Run with
`node --experimental-loader ./scripts/resolver-hook.mjs scripts/<name>.mjs`. 51/52 pass; `verify-legacy-shim` fails.

## 6. Architecture patterns

- **Quantity aggregator:** `compute<X>Quantities(state)` over (floor/room-)scoped state from `boq/scope.js`;
  e.g. `quantities/plaster.js computePlasterQuantities`. Steel for the BOQ is `quantities/bbs.js computeBBSQuantities`
  (legacy, KD-29); BBS schedule steel is `bbs/index.js computeRebarGroups`.
- **Topology query:** pure functions of state, memoized by reference (`topology/cache.createMemo`), e.g.
  `getRoomGeometry`, `getOrderedWallJunctions`, `resolveBeamEndpoint`.
- **Store mutation:** `addWall(n1, n2)` takes **node ids** (from `getOrCreateNode`), runs floor-scoped
  dedup/overlap checks, calls `_save()`, applies default thickness/height/material (store.js:478-522).
- **Component read:** `useStore(s => s.key)` single-key selectors; `useStore.getState()` in handlers.

## 7. Export pipeline

`export/pdf.js` and `export/excel.js` render `computeBoqPresentationModel` output (sheet buckets from
`export/_buckets.js`); `export/bbs.js` builds the BBS workbook from `computeRebarGroups`.

## 8. Key concepts

- **Floor scoping:** floors are `projectSettings.floors[]` (default `'F1'`); BOQ scoping goes through
  `boq/scope.js scopeStateToFloor/Room/RoomType`.
- **IFC ids:** every entity has `id` (UUID) and `ifcGlobalId` (22-char IFC GUID) from `lib/ids.js`; `ifcGlobalId`
  is the ERP `sourceEditorId`.
- **Drawing modes:** `projectSettings.drawReference` (`inside_face` default / centerline / outside_face); conversion
  in `src/draw/faceToCenterline.js`.
- "Phases" are historical build stages recorded in `CLAUDE-phase-history.md`, not runtime concepts.

## 9. Common tasks

See [CODEBASE_MAP §12 Navigation guide](../CODEBASE_MAP.md#12-navigation-guide) (add a tool, entity type,
BOQ emitter, sync op, MEP catalog).

## 10. Dependencies & versions

| Dependency | Version | Purpose |
|---|---|---|
| `react` / `react-dom` | ^19.2.5 | UI |
| `zustand` | ^5.0.13 | State |
| `vite` | ^8.0.10 | Build |
| `jspdf` / `jspdf-autotable` | ^4.2.1 / ^5.0.7 | PDF |
| `xlsx` | ^0.18.5 | Excel |
| `lucide-react` | ^1.16.0 | Icons |
| `pdfjs-dist` | ^4.10.38 | PDF underlay import |
| `@cloudflare/vite-plugin` | ^1.40.2 | Workers integration |

## 11. Deployment

`npm run deploy` (= `vite build` + `wrangler deploy`); `npm run preview` for `wrangler dev`. Config in
`wrangler.jsonc` (no `main` entry — static SPA assets).

## 12. Quick navigation

See [CLAUDE.md Quick Navigation](../../CLAUDE.md#quick-navigation).

## 13. Important notes

- Quantities are recomputed on demand; topology/structural getters memoize by reference. BOQPanel recomputes
  `getBoqLines` every render (no memo).
- Styles: design tokens in `src/design/tokens.css` plus component `.css` files; inline style objects are also used
  widely (Canvas overlays, banners, badges).
- No unit-test framework; add a `scripts/verify-*.mjs` for new behaviour. Nothing runs them automatically.

## 14. Reference links

- Code map: `docs/CODEBASE_MAP.md`
- Rules/workflow: `CLAUDE.md`
- BBS workbook validation: `docs/bbs/BBS-VALIDATION-KARTHICK.md` (the `*MORNING-REPORT*.md` files are historical build logs)
