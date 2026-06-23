# BOQ — Bill of Quantities Editor

**Read this file for essential context. For phase history & deep dives, see `docs/`.**

---

## What This Is

A Vite + React 19 + Zustand 5 SPA for architectural + MEP design documentation in Indian residential construction. Greenfield — no backend, no migrations, IDB-first persistence.

- **Entry:** `src/main.jsx` → `src/App.jsx` → Canvas + Panels
- **State:** Zustand store in `src/store.js` (2700+ lines, 10+ slices)
- **Quality:** 42 gate-every-commit verify scripts (not Jest/Vitest)
- **Export:** PDF (jsPDF), Excel (SheetJS), CSV
- **Deploy:** Cloudflare Workers (`wrangler deploy`)

---

## Quick Navigation

| Task | Look Here |
|------|-----------|
| **Understand state shape** | `src/store.js` — all entities live in Zustand |
| **Add a structural entity** | `src/structuralSlice.js` + component that reads/writes store |
| **Fix a BOQ calculation** | `src/quantities/*.js` (pure functions) + `scripts/verify-boq.mjs` |
| **Add MEP system** | `src/mep/[discipline]/` + update `src/mepSlice.js` |
| **Modify canvas behavior** | `src/components/Canvas.jsx` (click handlers, drawing) |
| **Change UI layout** | `src/components/Panels.jsx` + individual component files |
| **Add export format** | `src/export/*.js` (PDF/Excel/CSV builders) |
| **Write verification** | `scripts/verify-*.mjs` (Node.js with `assert` module) |
| **Adjust styling** | `src/design/tokens.css` (design variables) + component `.css` files |
| **See project history** | `docs/CLAUDE-phase-history.md` (35+ phases, locked rules, gotchas) |

---

## Architecture (5 Layers)

```
Geometry (walls, columns, beams, etc. stored in Zustand)
    ↓
Topology (wall junctions, rooms, spatial relationships — pure functions)
    ↓
Quantities (masonry, steel, plaster, MEP sizing — pure calculators)
    ↓
BOQ Presentation (line emission, scoping, formatting)
    ↓
UI + Export (React components, PDF/Excel/CSV output)
```

**Key insight:** All data flows DOWN; mutations only at the top (store). Topology & quantities are pure — input state, no side effects.

---

## State Management (Zustand)

```javascript
const useStore = create((set, get) => ({
  // Structural
  columns: [...],
  beams: [...],
  slabs: [...],
  walls: [...],
  foundations: [...],
  
  // MEP
  mep: {
    plumbing: {...},
    electrical: {...},
    hvac: {...},
    fire: {...},
    elv: {...}
  },
  
  // UI
  selectedTool: 'wall',
  selectedEntity: null,
  viewMode: '2d',
  // ... 50+ more fields
  
  // Actions
  addWall: (endpoints, thickness) => {...},
  deleteEntity: (id) => {...},
  // ... 100+ mutations
}))
```

**Reading:** `const walls = useStore(state => state.walls);` (in components)

**Writing:** `useStore.setState(draft => { draft.walls.push(...); });` (in actions)

---

## Core Files & Responsibilities

| File | Role | Size |
|------|------|------|
| `src/store.js` | Central Zustand store | 2700 lines |
| `src/structuralSlice.js` | Columns, beams, slabs, foundations state + actions | 87 KB |
| `src/mepSlice.js` | MEP entities (5 disciplines) state | ? |
| `src/components/Canvas.jsx` | Drawing surface, keyboard, pointer, drag | Main UI |
| `src/components/Panels.jsx` | Side/bottom panels (props, BOQ, MEP, etc.) | Main UI |
| `src/boq/` | BOQ pipeline: emitter → scope → presentation | 10 files |
| `src/topology/` | Wall topology, room detection, spatial logic (pure) | 5+ files |
| `src/quantities/` | Material aggregators (masonry, steel, plaster, etc.) | 8+ files |
| `src/mep/` | MEP systems (plumbing, electrical, HVAC, fire, ELV) | 50+ files |
| `src/export/` | PDF, Excel, CSV builders | 3 files |
| `src/schema/` | Entity schemas, integrity validation | 10+ files |

---

## Common Patterns

### **Pattern 1: Pure Quantity Aggregator**

```javascript
// src/quantities/steelQty.js
export function calculateSteelQty(beams, columns, scope = {}) {
  const result = { mainRebarWeight: 0, stirrupWeight: 0 };
  
  for (const beam of beams) {
    if (!isInScope(beam, scope)) continue;
    result.mainRebarWeight += beam.span * beam.grade * REBAR_DENSITY;
  }
  
  return result;  // No mutations
}
```

**Usage:** `const steelQty = calculateSteelQty(store.beams, store.columns, {floorId: 'F1'});`

### **Pattern 2: Store Mutation (Zustand Set)**

```javascript
// In store.js or a slice
addWall: (endpoints, thickness, material) => set((state) => {
  const id = generateWallId();
  return {
    walls: [
      ...state.walls,
      { id, endpoints, thickness, material, createdAt: Date.now() }
    ]
  };
})
```

### **Pattern 3: React Hook with Store Selector**

```javascript
// src/hooks/useWallSelection.js
export function useWallSelection() {
  const selectedEntity = useStore(state => state.selectedEntity);
  const setSelectedEntity = useStore(state => state.setSelectedEntity);
  
  const selectWall = useCallback((wallId) => {
    setSelectedEntity({ type: 'wall', id: wallId });
  }, []);
  
  return { selectedEntity, selectWall };
}
```

---

## Verification (42 Scripts)

No Jest/Vitest. Instead, **42 Node.js scripts** verify by assertion at commit time.

**Run all:**
```bash
npm run verify
```

**Run specific:**
```bash
node scripts/verify-boq.mjs
node scripts/verify-topology.mjs
node scripts/verify-mep.mjs
```

**Add a new one:**
```javascript
// scripts/verify-my-feature.mjs
import assert from 'assert';

const testCase = {...};
const result = myFunction(testCase);

assert.deepStrictEqual(result.foo, expectedValue);
console.log('✓ verify-my-feature passed');
```

On failure, git hook blocks the commit. Fix the code, re-run.

---

## Key Design Rules

1. **Canonical storage = centerline geometry.** Drawing tools (inside_face/center/outside_face) convert at authoring boundary; nothing downstream knows the mode.

2. **Walls are full entities, never split.** T-junctions are stored as `wall.junctions[]`. Rooms use sub-spans of full walls via the topology graph.

3. **IS 2502 catalog is single source for BBS.** Every bend deduction, hook, Ld, lap, bar length comes from `src/specs/cuttingLength.js`. No magic numbers elsewhere.

4. **Beam endpoints are a 4-type union.** `{type: COLUMN|BEAM|WALL|POINT, ...}`. Always resolve through `resolveBeamEndpoint()` — never direct coordinate access.

5. **RebarGroup is computed, never persisted.** `computeRebarGroups(state)` regenerates deterministically. The legacy `computeBBSQuantities` coexists but is deprecated.

6. **IFC readiness.** Every entity has `ifcGlobalId` (22-char base64). Don't remove or repurpose; future work includes IFC export.

---

## ERP Sync — Package Export & Cloud Safety (2026-06-23)

This editor is the **source of truth** for a connected JRM ERP. `buildPackage(state)`
(`src/boq/buildPackage.js`) produces the `BuildingModelPackage` the ERP imports;
`src/projects/` carries the cloud sync.

### `buildPackage` — `schemaVersion` (currently **3**)
- **1** — spatial shell: floors → rooms (`vertices[]`/`posXMm`), per-room walls
  (dims + `faceType` + openings), columns/beams/slabs arrays, MEP `elements[]`.
- **2** — each COLUMN/BEAM/SLAB element carries a typed **`structural`** sub-object
  (resolved section/height/span/`concreteM3` + steel grade) + a **`bbs`** sub-object
  (per-element IS-2502 rows from `computeRebarGroups`). The ERP stores these verbatim
  and **never recalculates BBS**.
- **3** — each floor carries the authoritative **wall node graph**: `nodes[]`
  (`{ifcGlobalId, xMm, yMm, zMm:null, kind: CORNER|TJUNCTION, onWallIfcId}`) + `walls[]`
  (`{ifcGlobalId, n1IfcId, n2IfcId}`), and `openings[]` gain `positionMm`. The graph
  is the editor's own `state.nodes`/`wall.n1|n2` exported verbatim (shared-node model →
  BIM/IFC-grade). `zMm` is null today; future 3-D elevation needs no schema change.
- Units at the boundary: coords → **mm integer**, lengths/heights → **feet**,
  thickness → **inches**. IDs: `ifcGlobalId` only (internal UUIDs stripped). Bump the
  version + extend `scripts/verify-build-package.mjs` when adding geometry.

### Cloud sync — DATA SAFETY (locked)
- **Autosave writes LOCAL IDB only** (`src/projects/autosave.js`) — it must NEVER push
  to the cloud. Cloud sync is **explicit**: the user clicks "Sync Now"
  (`SyncStatusBadge` → `cloudSync.syncToCloud`). An empty-canvas manual sync over a
  real remote requires a confirm (empty-model guard).
- **Connect handoff** (`src/projects/connectHandoff.js`) pulls/adopts on connect and
  **never auto-pushes**; on a no-snapshot it starts blank, on a pull failure it tries
  DB recovery then surfaces an error — it never overwrites the remote. The ERP's
  destructive-change guard can return `{quarantined:true}` (held, not synced).
- Why: an earlier autosave auto-push wiped a connected building's ERP model. These
  rules exist to make that impossible.

---

## Development

**Install:**
```bash
npm install
```

**Dev server:**
```bash
npm run dev
```
Runs on `http://localhost:5173` (or similar).

**Build:**
```bash
npm run build
```
Output: `dist/`

**Deploy to Cloudflare Workers:**
```bash
wrangler deploy
```

**Lint:**
```bash
npm run lint
```

---

## Dependencies

| Package | Version | Why |
|---------|---------|-----|
| `react` | 19.2.5 | UI framework |
| `zustand` | 5.0.13 | State management |
| `vite` | 8.0.10 | Build tool |
| `jspdf` | 4.2.1 | PDF generation |
| `xlsx` | 0.18.5 | Excel export |
| `lucide-react` | 1.16.0 | Icons |

**No TypeScript.** JSDoc type hints instead. Check `eslint.config.js` for linting rules.

---

## For More Detail

- **Phase history & locked rules:** `docs/CLAUDE-phase-history.md` (35+ phases)
- **Architecture deep dive:** `docs/CLAUDE-boq-reference.md` (modules, patterns, tasks)
- **Business requirements:** `BBS_MORNING_REPORT.md`
- **Code map (diagrams, module guide, navigation):** `docs/CODEBASE_MAP.md` (if it exists)

---

## Common Issues

**Q: Where do I add a new entity type (beam, column, etc.)?**  
A: Define schema in `src/schema/entities/`, add to store slice, wire into UI component.

**Q: How do I modify a BOQ line calculation?**  
A: Find the aggregator in `src/quantities/*.js`, fix the formula, update the corresponding `scripts/verify-*.mjs` test.

**Q: The verify script is failing. What do I do?**  
A: Read the assertion error, fix the code or the test (if the test expectation is wrong), re-run `npm run verify`.

**Q: How do I add a new MEP discipline?**  
A: Create folder under `src/mep/[discipline]/`, define entity schema, add to `src/mepSlice.js`, wire components.

**Q: Can I use TypeScript?**  
A: No. JSDoc + ESLint is the pattern. See `eslint.config.js`.

---

**Last updated:** 2026-06-18  
**Project owner:** Vignesh  
**Repo:** `/Users/vignesh/projects/jrm/boq`
