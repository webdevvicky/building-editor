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
  SheetJS (`xlsx`), pdfjs-dist (underlay import), lucide-react. Static files only: `npm run build` → `dist/`, served
  by nginx at `https://editor.jrmconstruction.org` (CloudPanel Static HTML site on the company VPS; erp-saas D-212),
  deployed by the GitHub workflow "Deploy editor" (automatic on code pushes; see Deploy below). IndexedDB-first persistence; no backend of its own.
- **Structure:** `src/main.jsx` → `src/App.jsx` (every panel mounted flat, self-gating) → `components/Canvas.jsx`.
  One flat store `src/store.js` (2,526 lines) + two slice factories (`structuralSlice.js`, `mepSlice.js`).
  Pure domain in `topology/ snap/ quantities/ mep/ bbs/ specs/ boq/ iso/`; ERP sync + local persistence in
  `projects/`. 56 `scripts/verify-*.mjs` harnesses (no Jest/Vitest).
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

- **Company/project structural settings (ERP D-275, D-278):** `specs/effectiveBbsSettings.js` is the one editor resolver.
  Member/spec overrides win over the applied `projectSettings.bbsSettings` snapshot (ERP project → company).
  Presets omit inherited cover/lap/development fields; empty spec inputs clear overrides. Stock length also uses
  this resolver in BBS, the quantity adapter, the panel and exports. Development-length tables remain the existing
  IS-2502 catalog; explicit spec factors are honored by every generator through `cuttingParamsForSpec`.
- **Saved bar inputs:** canonical documents include applied values/source/version in `projectSettings.bbsSettings`.
  `bbsSettingsSession.loadBbsSettings` fetches the building-addressed editor-config after canonical reopen and before
  sync starts. Only a fresh drawing adopts automatically. Reopen keeps saved inputs; “Company bar settings changed —
  review” presents old/new values and an explicit apply action. Applying uses the existing project-settings action,
  so whole-state structural signatures re-send affected bars. A connected fetch failure blocks the workspace and
  exposes Retry, never silently using offline defaults. A reopened drawing with no saved ERP snapshot is status
  `review`: `writePipeline.beginWritePipeline` defers the canonical queue, sync engine and coordinator (their
  signatures call BBS), and Apply (`applyPendingBbsSettings`) starts them, re-projects every element and only then
  moves to `ready`; a failed start resets what it started. An integrity-failed reopen ends in status `aborted`, and
  `App.jsx` renders `EditorReadOnlyBanner` outside the settings gate so the real error and Reload stay visible.
  `scripts/verify-bbs-startup.mjs` covers both. Standalone mode explicitly labels built-in IS-code defaults.
  Wastage is captured with the snapshot; procurement wastage is applied by the ERP's same project/company reader.
  `verify-bbs-settings.mjs` covers the drawing action, calculations, snapshot/reopen, overrides, review/apply and failures.

- **Derived structural members (erp-saas D-280):** `topology/derivedMembers.js` is the one answer to which bands
  (plinth/lintel/roof, tie), inline footings, sunshades and lofts the drawing implies (`derivedMemberCandidates`) and
  to who each is (`reconcileDerivedMembers`). `state.derivedMembers` holds only identity and parent links (wall,
  opening, column, floor, label number, predecessors); sizes and bars are always derived. The store keeps it in step
  in the SAME commit as the parent change (`store/derivedMembersMiddleware.js` wraps every `set` and `setState`); it is
  in undo frames and the canonical snapshot. Ids are permanent: a sunshade is keyed by its opening (move/resize/split
  keep it), a footing by its column, a loft by its wall, a band by wall + level; a band cut by a split or merged by a
  join gets new ids naming its predecessors, a band rebuilt whole on the same line keeps its id. The BBS engine groups
  every member's bars under its id (one inline footing per column, no longer one bucket per column type). No double
  counting: a column a drawn foundation carries has no inline footing (`inlineFootingColumns`, shared with
  `getFoundationQuantities`), and `getDerivedWallBeams` skips a band an explicit beam of the same level covers end to
  end. They sync through `elementRegistry.DERIVED_MEMBER_ENTRY` (kind BEAM / FOUNDATION / SLAB via `erpKindOf`, sizes
  and bars from `structuralFacts.derivedMemberFacts`, `derivation` with the parents' ifcGlobalIds, the name on the
  ADD only); `liveSync` makes ADD/UPDATE wait for the parents. Read-only in the UI: `DerivedMembersSection` in the wall
  and column panels; the wall panel also sets the tie band and the loft (a loft without a thickness has no concrete).
  The lintel is the IS 4326 band along a wall (per wall, not per opening). `verify-derived-members.mjs` covers it.

These are the load-bearing rules. They are an adopted design basis; no owner decision is recorded for them unless a
rule says so. The full list (about 29 rule blocks), each with status and authority, is in
[`docs/DOMAIN-RULES.md`](docs/DOMAIN-RULES.md).

1. **Canonical storage = centerline geometry.** Draw modes (`projectSettings.drawReference`: `inside_face` default / `centerline` / `outside_face`) convert at the
   authoring boundary (`src/draw/faceToCenterline.js`); nothing downstream knows the mode.
2. **Walls are full entities, never auto-split.** T-junctions are `wall.junctions[]`; rooms use sub-spans via the
   topology graph. Only the explicit user Split tool (`splitWall`) cuts a wall.
3. **IS 2502 catalog and structural settings have separate owners.** Engineering tables for bends, hooks and
   development lengths live in `src/specs/cuttingLength.js`; inherited cover, lap and stock-length resolution lives
   in `effectiveBbsSettings.js`. ERP D-275/D-278 approve company defaults and the project/editor precedence.
   Remaining engineering choices (confinement and detailing) are documented in `docs/DOMAIN-RULES.md` §11.3.
   BOQ steel still uses the older `computeBBSQuantities` formula with its existing lap-unit defect, and D²/162 is
   repeated (KD-29/KD-30); both quantity and BBS paths now receive the same resolved settings.
4. **Beam endpoints are a 4-type union** `{type: COLUMN|BEAM|WALL|POINT, …}` — always resolve through
   `resolveBeamEndpoint()`.
5. **RebarGroup is computed from saved settings, never persisted.** `computeRebarGroups(state)` regenerates deterministically and feeds
   the BBS panel, the BBS export and the bars sent to the ERP (`projects/structuralFacts.js`, D-271). The legacy `computeBBSQuantities` is meant to be deprecated but is **still the live
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

- **Canonical Building Document** — `buildSnapshot(state)` (`src/projects/_snapshot.js`, payload `version` =
  `SCHEMA_VERSION` from `operations/_schemaVersion.js`, 8; XR-14 fixed 2026-10-13) wrapped by
  `canonicalDoc.buildSnapshotDoc` and PUT to `/api/v1/building-structure/buildings/:id/document` (R2 blob, checksum,
  CAS on `baseVersion`). **Reopen is verbatim** and lineage-aware (`canonicalReopen.js`): unsent local edits made on
  the server's current version load; unsent edits made on an older version are a clash (server copy loads, local
  kept aside under `SNAPSHOTS[<id>:clash:v<base>:<ts>]`, user told); else R2 → IDB → empty; checksum failure with no
  IDB rescue → HARD read-only latch.
- **Geometry projection** — ERP PostgreSQL rows written live through `/api/v1/geometry/**`, one op at a time.

The snapshot stores **raw editor entities only** — no `structural` / `bbs` sub-objects. **The bars DO leave the
editor through the projection (erp-saas D-271, XR-02 fixed 2026-11-03):** `projects/structuralFacts.js`
(`structuralFacts(erpKind, el, state)`, pure) gives every structural element its section as real sizes (a column TYPE
is resolved to mm here; the ERP cannot read type ids), its height / slab area / footing pad, its concrete and steel
grade and its bar list from `computeRebarGroups` only (never the legacy `computeBBSQuantities`). The ERP stores them
and works out concrete m³ and steel kg itself; it refuses a concrete or steel figure on the wire. Members with no
entity of their own (wall bands, inline footings, tie bands, sunshades, lofts) are sent as **derived members**
(erp-saas D-280, below). Wire units are integer **mm**
for coordinates, heights, thicknesses and lengths; feet only for floor height and ERP room length/width.

### The write pipeline (`src/projects/`)
- **`syncCoordinator`** is the only store subscriber in ERP mode: **(1) ACCEPT** — write the canonical doc to IDB
  `SNAPSHOTS[buildingId]`, mark dirty; **(2) ENQUEUE** — persist that exact document with its projection ops.
  The FIFO worker uploads the document, declares a server checkpoint, executes mutations with durable IDs and exact request receipts, then seals. Resync uses the same coordinator acceptance path.
- **`syncEngine`** diffs nodes / walls / rooms, floors, every opening and every `ELEMENT_REGISTRY` kind (structural +
  MEP + risers), each entity's change detection in ONE place in `_flush`; an element's change signature is its
  `toErpPayload` over the WHOLE state of the flush (`_elementSignatures`), so a column-type, reinforcement, cover or
  room change re-sends every element it reaches (KD-37 fixed). Stable identity = `sourceEditorId` =
  `ifcGlobalId` (floors: their `id`, e.g. `'F1'`). Server creates are idempotent by `sourceEditorId`.
  - **Walls:** a wall a room owns is `ADD_WALL` under that room; a wall no room owns is `ADD_WALL` on its floor (XR-11)
    and is re-sent under a room drawn on it later (the ERP then adds that room's faces). A height / thickness /
    material / node change is `UPDATE_WALL` (one op). `detectWallResegmentation` turns a wall replaced by a chain of
    new walls along it into ONE `SPLIT_WALL` (each piece names the rooms it really bounds — midpoint on the room
    ring), and the Join tool (survivor + partner) or an undo of a split into ONE `JOIN_WALLS`, so wall faces — their
    BOQ identity, finishes, progress — move instead of being deleted and re-added (XR-16, XR-08).
  - **Openings:** new on a wall, or retyped → `ADD_OPENING` (it names the wall it is on now, so an opening carried
    by a split/join moves); resized / moved along the wall / sill changed → `UPDATE_OPENING`; gone from every wall →
    `DELETE_OPENING` (XR-17). Each carries `count` 1 and its sill: a door 0, a window its `sillHeight` (opening
    panel) or nothing while unset (XR-07).
  - **Floors:** number, height, plinth; an edit is `UPDATE_FLOOR` → `PATCH /geometry/floors/:id` (XR-12). Length,
    width, name and label are ERP-owned and never sent. **The editor has no per-room height:** a room's height is its
    walls' height, so `BuildingRoom.height` is not sent.
  - **Elements** sign on `toErpPayload` read against their own state (prev for prev), so a slab / MEP room change
    emits `UPDATE_ELEMENT` (KD-37).
- **`liveSyncQueue`** = durable IDB FIFO outbox with a dependency gate; **`liveSync.fireLiveOp`** maps ops → HTTP,
  resolves editor ids → ERP UUIDs (floors through this connection's `floorIds`), converts in → mm; one rule
  (`_registerProduced`) registers what a response produced, live or replayed. 400/404/409/422 dead-letter; 401/403/408/429/5xx/network retry
  ×5 then `failed` (badge offers Retry / Resync all).
- **`canonicalReopen`** seeds the id map and row versions from `GET /geometry/buildings/:id/state` (never loads the
  canvas from it), then loads the copy the save rule picks (see Canonical Building Document above).

### Locked rules
- **Opening usage (ERP D-357):** syncMappers.openingUsage maps the authored MAIN_DOOR / INTERNAL_DOOR subtype to MAIN_ENTRANCE / INTERNAL, with UNCLASSIFIED for a door needing review and NOT_APPLICABLE for other forms. Both ADD and PATCH carry usage; it participates in the shape signature so a subtype-only change is an UPDATE. Load from ERP restores subtype/source from usage, including an explicit UNCLASSIFIED door that loadProject must not reclassify from size. verify-wall-opening-sync exports ERP_OPENING_FIXTURE through the real dispatcher; verify-erp-roundtrip covers usage recovery.
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
  *Adding an op that puts a parent id in a URL or required body field means adding its `OP_DEPENDENCY` row.* A row
  names single parents (`one(field, kind)`) and LISTS of parents (`many('roomIds', 'room')`, the walls of a join, the
  rooms of each split piece): every id in a list must resolve — a list never silently loses an unresolved id (XR-09).
  `produces` is a list (a split produces each piece).
  Backstops: `_requireId()` guards the parent ids of `ADD_WALL` (room or floor), `ADD_OPENING`, `SPLIT_WALL`,
  `JOIN_WALLS`, `UPDATE_FLOOR`, `ADD_WALL_SURFACE` and every room id in a `roomIds` list (throws a permanent `→ 400:`); UPDATE_*/DELETE_* with an unresolved id are skipped as no-op success; `UPDATE_NODE`
  with an unresolved id heals by POSTing a create. (`ADD_NODE`/`ADD_ELEMENT` interpolate only `buildingId`.)
  ⚠️ **Test fixtures must pass EDITOR ids** (`wallIfcId`/`roomIfcId`) and let `liveSync` resolve them.
- **No automatic reconstruction.** Reopen never derives the canvas from the projection. The only reconstruction
  path is the explicit, user-initiated **"Load from ERP"** (`ProjectionMismatchBanner` → `projectionGuard.loadFromErp`
  → `projectionReconstruct.js`), shown when the projection has more rooms/walls than the canvas. It rebuilds from
  exactly what `GET /geometry/buildings/:id/state` returns (the ERP's projection contract: walls name their nodes and
  every room they bound by editor id), every `ELEMENT_REGISTRY` kind through its `toEditorShape` (typed columns + the
  element `spec` the editor sends), and keeps editor-only settings, stamps and rates (XR-01, XR-10 fixed 2026-10-13,
  G17). Pinned by `verify-projection-reconstruct` and `verify-erp-roundtrip`.
- **An old snapshot must never clobber a newer one** (XR-05, XR-15 fixed 2026-10-13, G17). The upload queue's
  `baseVersion` is the server version the canvas descends from — set by reopen or by its own accepted PUT, never
  re-seeded from a server fetch. A 409 is never re-sent on the newer number: the server holding our own document
  (same checksum — a lost response) is adopted; any other clash keeps the copy aside and latches read-only.
- **One identity rule** (BLD-G01, G17): an editor id deleted and added back (undo) revives its ERP row — the ERP's
  `GeometryLiveService.findEditorRow`; never mint a new id to "work around" a refused re-add.
- **Room/wall shape PATCHes carry the row version** this session last saw (`liveSync` `_versionMap`, seeded from
  `/state`, refreshed from every response); a 409 latches read-only (CONC-27).
- **Who may edit at once is unresolved.** Owner decision D-011 (boq decision #3, 2026-06-22) says one editor per
  project with a project-level lock. erp-saas 48A Decision 4 (D-037, a proposal, not approved) and doc 48 decision
  D5 (§1.2) instead describe document/floor checkout for 1–2 concurrent editors. The tension is open question
  OQ-057 in `erp-saas:docs/open-questions.md` §18 (`docs/DOMAIN-RULES.md` §12 C-8). Neither lock is built:
  the editor acquires no lock or lease, and the only guard against a second writer is the canonical-document CAS
  (409 on a stale `baseVersion`; since G17 a clash is never re-sent). Building either lock depends on the answer to
  OQ-057.
- **The only launch path is the ERP's `#erpLaunch`.** The legacy manual connect path (`#connect`, `cloudConn.js`,
  `connectHandoff.js`, `ConnectErpDialog`, `ErpConnection`) called ERP routes that no longer exist and is deleted
  (XR-06, KD-15); `verify-erp-connection` fails if it returns. `buildPackage` / blob-import are deleted.
- **Electrical point types (Stream 2).** A placed electrical point carries a canonical `pointType`
  (`src/mep/catalogs/electricalPointTypes.js`) chosen from the floating palette; it rides `ADD_ELEMENT` /
  `UPDATE_ELEMENT` (in `toErpPayload`, part of the change signature) → ERP `BuildingElement.mepPointType`.
  ADD and UPDATE send ONE element body (`liveSync._elementBody`; room ids resolved), and the ERP create and patch DTOs
  accept the same shape (KD-5 / XR-03, KD-6 / XR-09 fixed 2026-11-03). Verified (mocked fetch) by
  `verify-electrical-point-type-sync.mjs` and `verify-structural-element-sync.mjs`, whose request bodies are validated
  against the real ERP DTOs by erp-saas `building-structure/dto/editor-element-payloads.spec.ts` (regenerate its
  fixture with `ERP_ELEMENT_FIXTURE=<path>` when the payload changes).
- **Read-only latch** (`editorWriteGuard`): HARD on integrity failure, a canonical-document clash or a row-version
  clash on a shape PATCH; releasable when
  offline. ⚠️ The UI does not consult it — editing continues locally (KD-23).
- **Quality gate for any geometry/sync change** (run with the resolver hook, all must stay green):
  `verify-canonical-sync` · `-canonical-reopen` · `-invariant-5-7` · `-floor-sync` · `-floor-delete` · `-live-sync` ·
  `-live-sync-ordering` · `-room-type-sync` · `-electrical-point-type-sync` · `-editor-write-guard` · `-readonly-gate` ·
  `-projection-reconstruct` · `-erp-roundtrip` (editor document → ERP → Load from ERP, delete/undo, every kind) ·
  `-wall-opening-sync` (store actions → ops: free wall, opening edit, split, join, undo-of-split, floor edit) ·
  `-structural-element-sync` (sizes, grades and IS-2502 bars on the wire; whole-state re-send; one ADD/UPDATE body) ·
  `-derived-members` (derived member identity across move / split / join / delete / reopen, no double counting) ·
  `-erp-connection`.

Architecture docs for the integration live in erp-saas: `erp-saas:packages/backend/src/modules/building-structure/docs/editor-erp-integration.md`
and `erp-saas:packages/backend/src/modules/building-structure/docs/editor-erp-phase0-decisions.md`. Cross-repo defects are canonical in
`erp-saas:docs/bugs.md` (XR-nn); KD rows in the map point to them.

---

## Verification (56 harnesses)

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

- Drawing synchronization uses durable snapshot batches with checkpoint and mutation UUIDs from the shared `uid()` helper. The queue uploads the exact canonical snapshot, declares its mutation manifest, sends lineage headers on geometry writes and seals only after server acknowledgements. Failed or dropped dependencies keep the checkpoint incomplete; retries retain the same IDs.

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
npm run preview   # serve the last build locally (vite preview)
```

**Deploy:** automatic on every push to `main` that changes the editor (`src/`, `public/`, `index.html`,
`vite.config.js`, `package*.json`, `scripts/`), or GitHub → Actions → "Deploy editor" → Run workflow
(`.github/workflows/deploy-editor.yml`; erp-saas D-212, D-213). It runs every verify harness (only
`verify-legacy-shim`, the KD-31 date reminder, never blocks), builds, and asks the server's `jrm-editor-receive` (the
only program the deploy key may run; erp-saas `deploy/editor/`) to store `dist/` as `releases/<sha>` and switch the
`current` link in one step; the 5 newest releases stay. Rollback: run it with `rollback_to` = an earlier full SHA. CloudPanel's Root Directory for the site is
`editor.jrmconstruction.org/current`. The editor holds no secrets, so living in `htdocs` is correct for it.

ERP-connected launch: the ERP mints `POST /api/v1/auth/editor-session` and opens the editor with
`#erpLaunch?buildingId&token&erpUrl&refreshToken&expiresAt` (stripped on boot). In DEV, `window.useStore` is exposed.

---

## Dependencies

| Package | Version | Why |
|---|---|---|
| `react` / `react-dom` | ^19.2.5 | UI |
| `zustand` | ^5.0.13 | State |
| `vite` (dev) | ^8.0.10 | Build |
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
- **ERP side:** `erp-saas:docs/OVERVIEW.md` (start here; editor sync §6.6, topic → owner table §7.2), `erp-saas:CLAUDE.md`

---

**Last updated:** 2026-09-24
**Project owner:** Vignesh
**Repo:** `/Users/vignesh/projects/jrm/boq`
