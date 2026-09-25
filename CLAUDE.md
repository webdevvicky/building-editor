# BOQ — Building Editor (`boq`)

**Rules, workflow and orientation.** Deep architecture, data flows, the editor↔ERP contract table and the
**Known Defects register (KD-n)** live in [`docs/CODEBASE_MAP.md`](docs/CODEBASE_MAP.md). Every domain and
engineering rule, with its status today and its authority, is in [`docs/DOMAIN-RULES.md`](docs/DOMAIN-RULES.md).

---

## Codebase Overview

A React SPA for drawing Indian residential buildings (walls, rooms, structure, MEP) that produces a live
editor-side BOQ and an IS-2502 bar-bending schedule. When launched from the JRM ERP it becomes the upstream
Building Editor: it writes a canonical Building Document and a live geometry projection to `erp-saas`.

- **Stack:** Vite 8 + React 19 + Zustand 5, plain JavaScript (JSDoc, no TypeScript); jsPDF + jspdf-autotable,
  SheetJS (`xlsx`), pdfjs-dist (underlay import), lucide-react; deployed to Cloudflare Workers
  (`@cloudflare/vite-plugin` + `wrangler`). IndexedDB-first persistence; no backend of its own.
- **Structure:** `src/main.jsx` → `src/App.jsx` (every panel mounted flat, self-gating) → `components/Canvas.jsx`.
  One flat store `src/store.js` (2,526 lines) + two slice factories (`structuralSlice.js`, `mepSlice.js`).
  Pure domain in `topology/ snap/ quantities/ mep/ bbs/ specs/ boq/ iso/`; ERP sync + local persistence in
  `projects/`. 52 `scripts/verify-*.mjs` harnesses (no Jest/Vitest).
- **Map:** [`docs/CODEBASE_MAP.md`](docs/CODEBASE_MAP.md) (last mapped 2026-09-23).

---

## Quick Navigation

| Task | Look here |
|---|---|
| State shape / actions | `src/store.js`, `src/structuralSlice.js`, `src/mepSlice.js` (map §3.1) |
| Add a tool | `components/toolbarConfig.js` + `hooks/useKeyboardShortcuts.js` + `snap/toolPolicy.js` + `Canvas.jsx` (map §12) |
| Canvas drawing / placement | `src/components/Canvas.jsx` (entity edits live in the per-entity `*Panel.jsx`) |
| Keyboard shortcuts | `src/hooks/useKeyboardShortcuts.js` (`KEYBOARD_SHORTCUTS` registry) |
| UI layout | `src/App.jsx` (flat mount list) — there is no `Panels.jsx` |
| Fix a BOQ number | `src/boq/lines.js` + its source: `src/quantities/*.js`, store getters (`store.js` 2297-2517, `structuralSlice.js` 1598-2170), or `boq/emitters/*` for MEP |
| Fix a BBS number | `src/specs/cuttingLength.js` + `src/bbs/generators/*` |
| Add an MEP discipline / catalog | map §12 (catalog → engine → `mep/quantities` → `boq/scope.js` → `boq/emitters` → `mepSlice` → panel → `elementRegistry`) |
| Export | `src/export/{pdf,excel,bbs}.js` (+ `_buckets.js`); there is no CSV exporter |
| ERP sync | `src/projects/` (map §3.3–§5) |
| Styling | `src/design/tokens.css` + component `.css`; inline style objects are also common |
| Domain rules (status + authority) | `docs/DOMAIN-RULES.md` |
| History | `docs-archive-2026-09:docs/archive/2026-09/CLAUDE-phase-history.md` (historical log — present-tense claims there may be stale) |

---

## Architecture in one screen

```
Geometry (flat zustand store)  →  Topology (pure)  →  Quantities  →  boq/ presentation  →  UI + Export
                                                     (pure quantities/ + mep/quantities/
                                                      AND store getters for masonry/structural/civil)
```

- **Single write path = store actions.** Components call actions (`addWall(n1, n2)`, `createRoomFromFace`,
  `updateOpening`, …); actions call `get()._save()` and return `set(s => ({ ...spread }))` (no immer).
  Multi-step gestures wrap in `_runAtomically(fn)` (one undo frame). `src/operations/` is **dormant** — not a write path.
- Collections are id-keyed maps at the root: `nodes, walls, rooms, stamps, columns, beams, slabs, staircases,
  foundations, plumbingFixtures, electricalPoints, hvacUnits, fireDevices, elvDevices, solarEquipment, risers`.
  Openings are `wall.openings[]`; floors are `projectSettings.floors[]`.
- Tool = `activeTool`; selection = per-type `selected*Id` + `selectedOpening` + namespaced `selection{}`.
- History: 50 frames of the 16 collections. **`projectSettings` (incl. floors) is not in undo history.**
- Reading in components: `useStore(s => s.walls)` (single-key selectors); in handlers: `useStore.getState()`.
- Sync is out-of-band: in ERP mode `syncCoordinator` subscribes to the store and diffs committed state.
  Actions are sync-agnostic — never call sync code from an action.

---

## Key Design Rules (engineering invariants)

These are the load-bearing rules. They are an adopted design basis; no owner decision is recorded for them unless a
rule says so. The full list (about 29 rule blocks), each with status and authority, is in
[`docs/DOMAIN-RULES.md`](docs/DOMAIN-RULES.md).

1. **Canonical storage = centerline geometry.** Draw modes (`projectSettings.drawReference`: `inside_face` default / `centerline` / `outside_face`) convert at the
   authoring boundary (`src/draw/faceToCenterline.js`); nothing downstream knows the mode.
2. **Walls are full entities, never auto-split.** T-junctions are `wall.junctions[]`; rooms use sub-spans via the
   topology graph. Only the explicit user Split tool (`splitWall`) cuts a wall.
3. **IS 2502 catalog is the single source for BBS.** Every bend deduction, hook, Ld, lap and bar length comes from
   `src/specs/cuttingLength.js`. ⚠️ **NOT currently enforced** — BOQ steel is priced from the legacy
   `computeBBSQuantities` path with a lap-unit bug, D²/162 is re-implemented 3×, and generators carry hard-coded
   fallbacks. See CODEBASE_MAP Known Defects **KD-29, KD-30, KD-40**. Origin: the build agent's Phase BBS rules
   (2026-05-28), not an owner or engineer sign-off. The BBS defaults themselves (lap, cover, confinement…) are
   **unsigned choices** — `docs/DOMAIN-RULES.md` §11.3 (open questions OQ-027…OQ-055 in
   `erp-saas:docs/open-questions.md` §17). The **bar-length default is disputed**, not merely unsigned: the
   per-project 6 / 9 / 12 m choice is owner decision D-114, and the ERP register records "the default stays 6 m" as
   part of D-114, but the code default is 12 m and the phase log says "flipped 6 → 12" with no owner quote.
   The sources are compared in `docs/DOMAIN-RULES.md` §11.4; the decision is open question OQ-029.
4. **Beam endpoints are a 4-type union** `{type: COLUMN|BEAM|WALL|POINT, …}` — always resolve through
   `resolveBeamEndpoint()`.
5. **RebarGroup is computed, never persisted.** `computeRebarGroups(state)` regenerates deterministically and feeds
   the BBS panel + BBS export. The legacy `computeBBSQuantities` is meant to be deprecated but is **still the live
   source of every BOQ steel line** (`boq/lines.js:37,248`) — KD-29. `verify-bbs` currently pins the legacy numbers.
6. **IFC readiness.** Every entity has `id` (UUID) **and** `ifcGlobalId` (22-char IFC GUID), minted only in
   `src/lib/ids.js`. Never remove or repurpose `ifcGlobalId` — it is also the ERP `sourceEditorId`.
7. **Revisions / design history are permanent.** ⚠️ **NOT currently enforced** — editor revisions are
   capped at 30 with silent pruning, localStorage-only, absent in ERP mode; ERP design versions are never cut.
   See **KD-16, KD-17**. Provenance: the owner's recorded rule is "keep every BOQ version" on the ERP side
   (D-084 in `erp-saas:docs/decisions.md`); its extension to editor design history is not
   owner-confirmed and conflicts with erp-saas 48A Decision 5 (D-037, a proposal: drafts prunable). Open question
   OQ-077 in `erp-saas:docs/open-questions.md`; `docs/DOMAIN-RULES.md` §12 C-3.
8. **Greenfield.** `loadProject` injects defaults; no migrations, no existing-data compat code. ⚠️ Known conflict:
   `store.js:2234-2239` keeps a legacy-save branch (`dimensionMode` stays `'centerline'` for loaded projects) —
   `docs/DOMAIN-RULES.md` §12 C-1.

---

## ERP Sync — Canonical Building Document + live projection

The editor is the **source of truth for geometry** of a connected building. Two lineages per building:

- **Canonical Building Document** — `buildSnapshot(state)` (`src/projects/_snapshot.js`, payload `version: 7`;
  the unused `operations/_schemaVersion.js` says 8 — KD-34) wrapped by `canonicalDoc.buildSnapshotDoc` and PUT to
  `/api/v1/building-structure/buildings/:id/document` (R2 blob, checksum, CAS on `baseVersion`).
  **Reopen is verbatim** (R2 → IDB → empty; checksum failure with no IDB rescue → HARD read-only latch).
- **Geometry projection** — ERP PostgreSQL rows written live through `/api/v1/geometry/**`, one op at a time.

The snapshot stores **raw editor entities only** — no `structural` / `bbs` sub-objects. Today BBS never leaves the
editor: the projection sends **no** structural sections, heights, concrete or bars (KD-7). ⚠️ At the same time the
ERP has a "BBS-direct" steel path that **expects** bars from the editor (erp-saas `structural-quantity.service.ts:46-50`),
so ERP steel/concrete is never computed (`erp-saas:docs/bugs.md` XR-02). Both facts are
true; which steel number is authoritative is open question OQ-027 in `erp-saas:docs/open-questions.md`
(`docs/DOMAIN-RULES.md` §12 C-4). Wire units are integer **mm**
for coordinates, heights, thicknesses and lengths; feet only for floor height and ERP room length/width.

### The write pipeline (`src/projects/`)
- **`syncCoordinator`** is the only store subscriber in ERP mode: **(1) ACCEPT** — write the canonical doc to IDB
  `SNAPSHOTS[buildingId]`, mark dirty, debounce (10 s) the upload via `canonicalSyncQueue`; **(2) EMIT** — only then
  `flushSyncEngine` diffs vs a shadow and enqueues ops. (Invariant #5, accept-before-emit.)
- **`syncEngine`** diffs nodes / walls / rooms, floors, and every `ELEMENT_REGISTRY` kind (structural + MEP + risers);
  openings are diffed by id set only (resizes don't sync — KD-8). Stable identity = `sourceEditorId` =
  `ifcGlobalId` (floors: their `id`, e.g. `'F1'`). Server creates are idempotent by `sourceEditorId`.
- **`liveSyncQueue`** = durable IDB FIFO outbox with a dependency gate; **`liveSync.fireLiveOp`** maps ops → HTTP,
  resolves editor ids → ERP UUIDs, converts in → mm. 400/404/409/422 dead-letter; 401/403/408/429/5xx/network retry
  ×5 then `failed` (badge offers Retry / Resync all).
- **`canonicalReopen`** seeds the id map from `GET /geometry/buildings/:id/state` (never loads the canvas from it),
  then loads R2 → IDB → empty.

### Locked rules
- The **editor owns topology**; the **ERP owns business state** (room name after creation, status, finishes, costs).
  Geometry mutations are editor-session-bound (`/geometry/*` behind `EditorSessionGuard`).
- **Default floor uses the CONSTANT `sourceEditorId` `'F1'`** (`DEFAULT_FLOOR_ID`) for every building, so floor
  identity is building-scoped on the ERP (`BuildingFloor @@unique([buildingId, sourceEditorId])`). Client safeguards
  (do not remove): `initLiveSync()` clears `_idMap` on every launch; `ADD_ROOM` resolves its floor **only** from this
  connection's `floorIds` and creates it under the current building if missing; `SAVE_ROOM_VERTICES` no-ops on an
  unresolved room id.
- **A child op WAITS for its parent's server id — it is never dispatched with `null`** (2026-09-22). `opDependency()`
  / `OP_DEPENDENCY` in `liveSync.js` is the ONE table of what each op `needs` / `produces` / `destroys`;
  `liveSyncQueue._drain` answers it against the dispatcher's id map: **dispatch** when resolved · **wait** (`blocked`,
  keeps position) when a queued op will produce the parent · **drop with a logged reason** when nothing can.
  *Adding an op that puts a parent id in a URL or required body field means adding its `OP_DEPENDENCY` row.*
  Backstops: `_requireId()` guards the parent ids of `ADD_WALL`, `ADD_OPENING`, `SPLIT_WALL`, `ADD_WALL_SURFACE`
  (throws a permanent `→ 400:`); UPDATE_*/DELETE_* with an unresolved id are skipped as no-op success; `UPDATE_NODE`
  with an unresolved id heals by POSTing a create. (`ADD_NODE`/`ADD_ELEMENT` interpolate only `buildingId`.)
  ⚠️ **Test fixtures must pass EDITOR ids** (`wallIfcId`/`roomIfcId`) and let `liveSync` resolve them.
- **No automatic reconstruction.** Reopen never derives the canvas from the projection. The only reconstruction
  path is the explicit, user-initiated **"Load from ERP"** (`ProjectionMismatchBanner` → `projectionGuard.loadFromErp`
  → `projectionReconstruct.js`), shown when the projection has more rooms/walls than the canvas. It is currently
  defective (wrong wall shape → duplicate walls; drops elements and resets settings) — **KD-3, KD-4, KD-36**.
- **An old snapshot must never clobber a newer one.** ⚠️ **NOT currently enforced** — on 409 the queue refetches the
  base and re-PUTs the same payload (last-writer-wins); only 3 consecutive conflicts latch read-only. **KD-1, KD-2.**
- **Who may edit at once is unresolved.** Owner decision D-011 (boq decision #3, 2026-06-22) says one editor per
  project with a project-level lock. erp-saas 48A Decision 4 (D-037, a proposal, not approved) and doc 48 decision
  D5 (§1.2) instead describe document/floor checkout for 1–2 concurrent editors. The tension is open question
  OQ-057 in `erp-saas:docs/open-questions.md` §18 (`docs/DOMAIN-RULES.md` §12 C-8). Neither lock is built:
  the editor acquires no lock or lease, and the only guard against a second writer is the canonical-document CAS
  (409 on a stale `baseVersion`), whose retry is itself last-writer-wins (KD-1). Building either lock depends on the
  answer to OQ-057.
- **Legacy connect path** (`#connect` deep link → `connectHandoff.js`, `cloudConn.js`, `ConnectErpDialog`,
  `ErpConnection`) still ships and is wired in `App.jsx`/`main.jsx`, but the ERP routes it calls no longer exist
  (KD-15). `buildPackage` / blob-import are deleted.
- **Electrical point types (Stream 2).** A placed electrical point carries a canonical `pointType`
  (`src/mep/catalogs/electricalPointTypes.js`) chosen from the floating palette; it rides `ADD_ELEMENT` /
  `UPDATE_ELEMENT` (in `toErpPayload`, part of the change signature) → ERP `BuildingElement.mepPointType`.
  ⚠️ Updates to any point that has a `roomId` are rejected 400 and dead-lettered (PATCH DTO lacks `roomIfcId`) —
  **KD-5**. Verified (mocked fetch only) by `verify-electrical-point-type-sync.mjs`.
- **Read-only latch** (`editorWriteGuard`): HARD on integrity failure or 3 stale-base conflicts; releasable when
  offline. ⚠️ The UI does not consult it — editing continues locally (KD-23).
- **Quality gate for any geometry/sync change** (run with the resolver hook, all must stay green):
  `verify-canonical-sync` · `-canonical-reopen` · `-invariant-5-7` · `-floor-sync` · `-floor-delete` · `-live-sync` ·
  `-live-sync-ordering` · `-room-type-sync` · `-electrical-point-type-sync` · `-editor-write-guard` · `-readonly-gate` ·
  `-projection-reconstruct` (its fixtures use a fictional wall shape — green does not prove Load-from-ERP works, KD-36).

Architecture docs for the integration live in erp-saas: `erp-saas:packages/backend/src/modules/building-structure/docs/editor-erp-integration.md`
and `erp-saas:packages/backend/src/modules/building-structure/docs/editor-erp-phase0-decisions.md`. Cross-repo defects are canonical in
`erp-saas:docs/bugs.md` (XR-nn); KD rows in the map point to them.

---

## Verification (52 harnesses)

No Jest/Vitest, **no npm `verify`/`test` script, and no git hook** — nothing runs these automatically. Run them
yourself before committing.

**Always use the resolver hook** — `src/` uses ~358 extension-less relative imports (Vite-only resolution), so
24 harnesses die with `ERR_MODULE_NOT_FOUND` under plain `node`:

```bash
# all
for f in scripts/verify-*.mjs; do node --experimental-loader ./scripts/resolver-hook.mjs "$f" >/dev/null 2>&1 || echo "FAIL $f"; done
# one
node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-boq.mjs
```

Current state (2026-09-23): **51/52 pass; `verify-legacy-shim` fails** because the `store/legacyAccessors.js`
kill date (2026-08-15) passed with 50 accessors still registered (KD-31). `validate-bbs-karthick.mjs` is a report,
not a gate.

Coverage gaps to know: nothing asserts MEP BOQ lines (KD-27 went unnoticed); `verify-bbs` pins the legacy steel bug
(KD-29); sync harnesses use mocked fetch and never run payloads through the real ERP DTOs (KD-5, KD-6).

**Add a new one:** `scripts/verify-<feature>.mjs` using `node:assert`, importing `src/` modules directly; keep pure
modules free of React/zustand so they load in Node. Full harness table: CODEBASE_MAP §7.

---

## Working rules

These rules govern how to work in this repo. They were stated in the phase log (now archived) and would otherwise
be lost.

- **MCP-first (mandatory).** Query Context7 before writing code that uses React 19 hooks or new APIs, Vite 8
  configuration, Zustand 5 store patterns, jsPDF / jspdf-autotable or SheetJS (`xlsx`). Training data for these
  versions is outdated. (Archive §MCP-First Rule.)
- **Never scope down without approval.** If a step is bigger than expected, surface the trade-off and ask *before*
  shipping a smaller version. "Scope deviation flagged" in a final report is not consent. (Archive §Phase 5.)
- **Verify discipline for canvas/UI flows.** The verify section must drive the real user-facing entry point with
  realistic state (T-junctions, several walls and rooms), not only the internal kernel — this closes the
  "verify green / canvas broken" gap. (Archive §Phase RoomConverge.)
- **Single source of truth over layered fallbacks.** When two mechanisms solve the same problem, keep one
  authoritative path; layered fallbacks accumulate as confusion-debt. (Archive §Phase RoomConverge.)
- **Greenfield mindset.** No backward-compatibility shims, no `legacy_*` fields, no parallel old/new paths, no
  temporary patches; design the permanent structure first. (Archive §Greenfield Development.)
- **No new libraries without asking.** (Archive gotcha list.)

"Archive §…" means `docs-archive-2026-09:docs/archive/2026-09/CLAUDE-phase-history.md`. Sections cited by code comments as
"CLAUDE.md §…" are in `docs-archive-2026-09:docs/archive/2026-09/CLAUDE-phase-history.md`; `docs/DOMAIN-RULES.md` §13 maps each of the
12 such comments to where it now resolves (five cite a "MEP plan" or "Attribution Policies" section that was never
in any repo doc).

---

## Development

```bash
npm install
npm run dev       # Vite dev server
npm run build     # → dist/
npm run lint      # eslint flat config
npm run preview   # build + wrangler dev
npm run deploy    # build + wrangler deploy
```

ERP-connected launch: the ERP mints `POST /api/v1/auth/editor-session` and opens the editor with
`#erpLaunch?buildingId&token&erpUrl&refreshToken&expiresAt` (stripped on boot). In DEV, `window.useStore` is exposed.

---

## Dependencies

| Package | Version | Why |
|---|---|---|
| `react` / `react-dom` | ^19.2.5 | UI |
| `zustand` | ^5.0.13 | State |
| `vite` (dev) | ^8.0.10 | Build |
| `@cloudflare/vite-plugin` (dev) | ^1.40.2 | Workers integration (`vite.config.js`; `wrangler.jsonc` name `building-editor`, SPA assets) |
| `jspdf` / `jspdf-autotable` | ^4.2.1 / ^5.0.7 | PDF export |
| `xlsx` | ^0.18.5 | Excel export (BOQ + BBS) |
| `pdfjs-dist` | ^4.10.38 | PDF underlay import |
| `lucide-react` | ^1.16.0 | Icons |

No TypeScript — JSDoc + ESLint (`eslint.config.js`).

---

## Common Issues

**Q: Where do I add a new entity type?**
A: Schema in `src/schema/entities/`, collection + actions in the right slice (with `_save()`), add it to the history
snapshot (`store.js:208-216`), `loadProject` normalisation and `projects/_snapshot.js`, FK rows in
`schema/integrity.js`, panel + Canvas rendering. For ERP sync also add a `projects/elementRegistry.js` entry and make
sure every `toErpPayload` field is accepted by **both** the ERP create **and** patch element DTOs. Checklist: map §12.

**Q: How do I modify a BOQ line calculation?**
A: Trace the line in `src/boq/lines.js` (or `boq/emitters/*` for MEP) back to its source — a `quantities/*.js`
aggregator, a store getter, or an `mep/quantities/*.js` engine — fix it there, and update the matching verify script.

**Q: A verify script is failing.**
A: First confirm you ran it with `--experimental-loader ./scripts/resolver-hook.mjs`. Then read the assertion, fix
the code (or the expectation if it is wrong), and re-run the loop above.

**Q: How do I add a new MEP discipline?**
A: Catalogs (`mep/catalogs/`, registered in `CATALOG_VERSIONS`) → discipline engine folder → `mep/quantities/<x>.js`
→ `boq/scope.js` getter → `boq/emitters/<x>.js` (read the engine's real output keys) → `mepSlice.js` collection →
panel + canvas overlay → `projects/elementRegistry.js` entry → `verify-mep` + `verify-catalog-provenance`.

**Q: Can I use TypeScript?**
A: No. JSDoc + ESLint.

---

## For More Detail

- **Code map, contract table, Known Defects, dead code:** `docs/CODEBASE_MAP.md`
- **Domain rules (status + authority, known conflicts):** `docs/DOMAIN-RULES.md`
- **UI defect log:** `docs/UI-ISSUES.md`
- **BBS engineering basis (current reference):** `docs/bbs/BBS-CATEGORIES-RESEARCH.md` — IS-clause research for the
  BBS categories; items it calls "locked" are unsigned choices (`docs/DOMAIN-RULES.md` §11.3; OQ-027…OQ-055)
- **BBS validation:** `docs/bbs/BBS-VALIDATION-KARTHICK.md` — an agent-run comparison against a contractor reference
  workbook; no human sign-off
- **BOQ-WEB corrections audit (2026-06-22):** `docs/audit/BOQ-WEB-CORRECTIONS-v1-AUDIT.md` — triage of a 46-item
  feedback list; its owner decisions #2–4 ("boq Decision 2/3/4") are D-010, D-011 and D-012 in
  `erp-saas:docs/decisions.md`
- **Historical (archived 2026-09-24, removed from the tree):** git tag `docs-archive-2026-09`, path
  `docs/archive/2026-09/` — `CLAUDE-phase-history.md` (phase log) and the two BBS build logs `BBS_MORNING_REPORT.md`
  and `BBS-FULL-MORNING-REPORT.md` (build logs, not requirements). Read one with
  `git show docs-archive-2026-09:docs/archive/2026-09/<name>`.
- **ERP side:** `erp-saas:CLAUDE.md`, `erp-saas:docs/README.md`

---

**Last updated:** 2026-09-24
**Project owner:** Vignesh
**Repo:** `/Users/vignesh/projects/jrm/boq`
