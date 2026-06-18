---
title: BOQ Project Reference Documentation
description: |
  **READ THIS ONLY WHEN NEEDED** — This is a detailed reference guide for the BOQ project.
  It documents architecture, patterns, key modules, and how to navigate the codebase.
  
  For quick context or understanding the problem, prefer git log, code comments, or asking 
  directly over reading this entire document.
---

# BOQ Project Reference Guide

> **⚠️ Reference Material Only** — This document is for deep dives and architecture understanding.
> If you need quick context, check the relevant code section or git history instead.

---

## 1. Project Overview

**BOQ** (Bill of Quantities) is a Vite + React 19 + Zustand 5 web application for architectural and MEP (Mechanical/Electrical/Plumbing) design documentation in residential construction in India.

- **Framework:** React 19 + Vite 8 + Zustand 5 (no TypeScript)
- **Architecture:** Layered design: Geometry → Topology → Quantities → BOQ → UI + Export
- **State:** Zustand store (2700+ lines in `src/store.js`) with 10+ slices (structural, MEP, wall topology, etc.)
- **Export:** PDF (jsPDF), Excel (SheetJS), CSV
- **Persistence:** IndexedDB with localStorage fallback; multi-tab sync via BroadcastChannel
- **Verification:** 42 gate-every-commit Node.js scripts (no Jest/Vitest)
- **Deployment:** Cloudflare Workers via Wrangler (compatibility_date: 2026-06-16)

---

## 2. Directory Structure

```
boq/
├── src/
│   ├── components/          # React components (54 .jsx files)
│   │   ├── Canvas.jsx       # Main drawing surface
│   │   ├── Toolbar.jsx      # Tool selector & mode controls
│   │   ├── Panels.jsx       # UI panels (properties, BOQ, MEP, etc.)
│   │   └── ...              # 51 more components
│   │
│   ├── store.js             # Zustand store (2700+ lines) — CENTRAL STATE HUB
│   ├── structuralSlice.js   # State for columns, beams, slabs, foundations
│   ├── mepSlice.js          # State for 5 MEP disciplines
│   │
│   ├── boq/                 # BOQ pipeline (line emission → scope → presentation)
│   │   ├── emitter.js
│   │   ├── scope.js
│   │   └── ...
│   │
│   ├── topology/            # Spatial relationships (walls, rooms, adjacency)
│   │   ├── wallTopology.js
│   │   ├── roomDetection.js
│   │   └── ...
│   │
│   ├── quantities/          # Material aggregators (masonry, plaster, steel, etc.)
│   │   ├── masonryQty.js
│   │   ├── steelQty.js
│   │   └── ...
│   │
│   ├── mep/                 # MEP systems (plumbing, electrical, HVAC, etc.)
│   │   ├── plumbing/
│   │   ├── electrical/
│   │   ├── hvac/
│   │   ├── fire/
│   │   └── elv/
│   │
│   ├── schema/              # Entity schemas & integrity checks
│   ├── lib/                 # Utilities (IDs, numbers, units, shapes)
│   ├── constants/           # BOQ categories, layers, defaults
│   ├── design/              # Design tokens (colors, spacing)
│   ├── validation/          # Rule engine for integrity checks
│   ├── export/              # PDF/Excel/CSV exporters
│   ├── operations/          # Mutation dispatch (audit/collab ready)
│   ├── compute/             # Computation DAG & memoization
│   ├── projects/            # Project manager (localStorage, IDB)
│   ├── revisions/           # Change tracking & audit log
│   ├── iso/                 # 3D isometric viewer
│   ├── draw/                # Face-aware drawing (inside/center/outside)
│   ├── snap/                # Unified snap resolver
│   ├── hooks/               # Custom React hooks
│   ├── App.jsx              # Root component
│   └── main.jsx             # Bootstrap entry
│
├── scripts/                 # Verification scripts (42 files)
│   ├── verify-boq.mjs       # BOQ pipeline assertions (250+)
│   ├── verify-topology.mjs
│   ├── verify-mep.mjs
│   └── ... (39 more)
│
├── docs/                    # Documentation
│   └── CLAUDE-boq-reference.md  # THIS FILE
│
├── public/                  # Static assets
├── dist/                    # Build output (Vite)
├── package.json
├── vite.config.js
├── wrangler.jsonc           # Cloudflare Workers config
├── eslint.config.js
├── CLAUDE.md                # (Old comprehensive doc — consider this one instead)
├── README.md
└── BBS_MORNING_REPORT.md    # Business requirements

```

---

## 3. Key Files & Modules

### **Core State (Read First)**

| File | Size | Role |
|------|------|------|
| `src/store.js` | 2700+ lines | Central Zustand store; all state lives here |
| `src/structuralSlice.js` | 87 KB | Columns, beams, slabs, foundations state |
| `src/mepSlice.js` | ? | MEP entity maps (plumbing, electrical, HVAC, fire, ELV) |

**How to navigate store:**
- Search for `const useStore = create((set, get) =>` to see the root store definition
- Each `slice.js` is a Zustand sub-object: `store.structural`, `store.mep`, etc.
- Mutations use `set()` from the store context

### **React Components (UI Layer)**

- **`src/components/Canvas.jsx`** — Drawing surface; owns keyboard, pointer, drag-drop
- **`src/components/Toolbar.jsx`** — Tool selector (wall, column, beam, MEP, etc.)
- **`src/components/Panels.jsx`** — Side/bottom panels (properties, BOQ table, MEP, etc.)
- **54 total component files** — Organized by feature (drawing, properties, export, etc.)

**Component patterns:**
- All use React 19 hooks (`useState`, `useCallback`, etc.)
- State comes from Zustand store selectors
- No class components, no context API (Zustand only)
- Styles via CSS with design-token variables (no CSS-in-JS)

### **BOQ Pipeline (Emission → Scope → Presentation)**

| Module | Purpose |
|--------|---------|
| `src/boq/emitter.js` | Emits BOQ line items from geometry (walls → masonry, etc.) |
| `src/boq/scope.js` | Filters & scopes BOQ lines per floor/location |
| `src/boq/presentation.js` | Formats BOQ for UI tables & export |

**Flow:**
```
Geometry (walls, columns, etc. in store)
  → Emitter (iterate entities, calculate QTY)
  → Scope filter (which floor? which location?)
  → Presentation (format for table/PDF/Excel)
```

### **Topology (Spatial Logic — Read-Only)**

| Module | Purpose |
|--------|---------|
| `src/topology/wallTopology.js` | Wall segments, endpoints, T-junctions |
| `src/topology/roomDetection.js` | Identifies rooms from wall loops |
| `src/topology/adjacency.js` | Wall adjacency relationships |
| `src/geometry.js` | Segment math, containment, projection |

**Key property:**
- All topology functions are **pure** (no store mutations)
- Input: current state snapshot; Output: derived relationships
- Used by quantity aggregators to decide which faces are interior/exterior

### **Quantities (Pure Calculators)**

| Module | Example Logic |
|--------|----------------|
| `src/quantities/masonryQty.js` | Wall face area × thickness → brick/block count |
| `src/quantities/steelQty.js` | Column/beam dimensions → rebar/stirrup weight |
| `src/quantities/plasterQty.js` | Wall face area → plaster volume |

**All are pure functions:**
```javascript
export function calculateMasonryQty(walls, floorScope) {
  // input: wall geometry + floor filter
  // output: {brickCount, mortarVolume, ...}
  // NO store mutation
}
```

### **MEP Systems (Plumbing, Electrical, HVAC, Fire, ELV)**

| Folder | Systems |
|--------|---------|
| `src/mep/plumbing/` | Water supply, drainage, rainwater |
| `src/mep/electrical/` | Power distribution, lighting, DB |
| `src/mep/hvac/` | Heating, cooling, ventilation |
| `src/mep/fire/` | Fire detection, sprinklers |
| `src/mep/elv/` | Extra-low voltage (weak current) |

Each discipline shares:
- Entity schema (equipment, routing, connections)
- System graph (network topology)
- Sizing pipeline (load → design → BOQ)
- Clash detection (spatial conflicts with structural/other MEP)

### **Export (PDF, Excel, CSV)**

| File | Output |
|------|--------|
| `src/export/pdf.js` | jsPDF integration; generates BOQ table + notes |
| `src/export/excel.js` | SheetJS; multi-sheet workbook (BOQ, MEP, summary) |
| `src/export/csv.js` | Plain text export |

**Usage pattern:**
```javascript
const data = emitBOQ(store.getState());  // Get BOQ lines
const pdf = generatePDF(data, options);  // Render PDF
downloadFile(pdf, 'boq.pdf');           // Save to disk
```

---

## 4. State Management (Zustand Store)

**Central source of truth:** `src/store.js` (2700+ lines)

### **Store Shape**

```javascript
const store = {
  // Structural entities
  columns: [...],           // {id, x, y, diameter, height, ...}
  beams: [...],             // {id, startCol, endCol, width, depth, ...}
  slabs: [...],             // {id, vertices, thickness, ...}
  walls: [...],             // {id, endpoints, thickness, material, ...}
  foundations: [...],       // {id, type, dimensions, ...}
  
  // MEP entities
  mep: {
    plumbing: {...},
    electrical: {...},
    hvac: {...},
    fire: {...},
    elv: {...}
  },
  
  // UI state
  selectedTool: 'wall',     // Current tool
  selectedEntity: 'col_1',  // Currently selected entity
  viewMode: '2d',           // 2d | isometric
  panX, panY, zoom: 1.0,    // Canvas transform
  
  // Persistence
  projects: [...],          // Saved projects
  currentProjectId: '...',
  isDirty: true,            // Unsaved changes
  
  // Revisions
  revisions: [...],         // Audit log
  
  // Actions (mutations)
  addWall: (endpoints, thickness) => {...},
  deleteEntity: (id) => {...},
  updateEntity: (id, delta) => {...},
  setSelectedTool: (tool) => {...},
  // ... 50+ more mutations
}
```

### **Store Slices**

Organized as nested objects for clarity:

```javascript
// In store.js
const useStore = create((set, get) => ({
  ...structuralSlice(set, get),    // Adds: columns, beams, slabs, etc.
  ...mepSlice(set, get),            // Adds: mep.plumbing, mep.electrical, etc.
  ...wallTopologySlice(set, get),   // Adds: wallTopology state
  // ... other slices
}))
```

### **Accessing State**

```javascript
// In components
const walls = useStore(state => state.walls);
const selectedEntity = useStore(state => state.selectedEntity);
const isWallSelected = useStore(state => state.selectedEntity?.type === 'wall');

// In utilities
const state = useStore.getState();  // Get full snapshot
const newWall = {id: 'w_1', ...};
useStore.setState(draft => { draft.walls.push(newWall); });
```

---

## 5. Verification Scripts (42 Gate-Every-Commit Tests)

No Jest/Vitest — instead, **42 Node.js scripts** verify correctness by construction.

### **High-Priority Scripts**

| Script | Assertions | Purpose |
|--------|-----------|---------|
| `verify-boq.mjs` | 250+ | BOQ emission, aggregation, scope filtering |
| `verify-topology.mjs` | 50+ | Wall topology, room detection, adjacency |
| `verify-mep.mjs` | 100+ | MEP systems, sizing, clash detection |
| `verify-integrity.mjs` | 80+ | Referential integrity, entity consistency |

### **How to Run**

```bash
node scripts/verify-boq.mjs          # Single script
npm run verify                        # Run all 42 scripts (in package.json)
```

**On failure:**
- Script logs assertion line + expected vs. actual
- Git hook blocks commit; fix the code, re-verify

### **Adding a New Verification**

```javascript
// scripts/verify-my-feature.mjs
import assert from 'assert';
import { loadTestData } from '../src/schema/testFixtures.js';

const testCase = loadTestData('two-room-layout');
const result = myFeatureFunction(testCase);

assert.deepStrictEqual(result.walls.length, 4, 'Expected 4 walls');
assert.ok(result.integrity.isValid, 'Integrity check failed');
console.log('✓ verify-my-feature passed');
```

---

## 6. Architecture Patterns

### **Pattern: Pure Quantity Aggregator**

```javascript
// src/quantities/steelQty.js
export function calculateSteelQty(beams, columns, scope = {}) {
  // Pure function: given geometry, return BOQ
  const result = {
    mainRebarWeight: 0,
    stirrupWeight: 0,
    bindingWireWeight: 0,
  };
  
  for (const beam of beams) {
    if (!isInScope(beam, scope)) continue;
    
    // Deterministic calculation
    result.mainRebarWeight += beam.span * beam.grade * REBAR_DENSITY;
    result.stirrupWeight += (beam.span / STIRRUP_SPACING) * STIRRUP_DIAMETER;
  }
  
  return result;
}
```

**Usage:**
```javascript
const steelQty = calculateSteelQty(store.beams, store.columns, {floorId: 'F1'});
```

### **Pattern: Topology Query (No Side Effects)**

```javascript
// src/topology/wallTopology.js
export function getAdjacentWalls(wallId, state) {
  const wall = state.walls.find(w => w.id === wallId);
  const adjacent = [];
  
  for (const other of state.walls) {
    if (shareEndpoint(wall, other)) {
      adjacent.push(other);
    }
  }
  
  return adjacent;  // Immutable; no store mutation
}
```

### **Pattern: Store Mutation (Zustand Set)**

```javascript
// In store.js
addWall: (endpoints, thickness, material) => set((state) => {
  const id = generateWallId();
  return {
    walls: [
      ...state.walls,
      {
        id,
        endpoints,
        thickness,
        material,
        createdAt: Date.now(),
      }
    ]
  };
}),
```

### **Pattern: React Hook with Store Selector**

```javascript
// src/hooks/useWallSelection.js
export function useWallSelection() {
  const selectedEntity = useStore(state => state.selectedEntity);
  const setSelectedEntity = useStore(state => state.setSelectedEntity);
  
  const selectWall = useCallback((wallId) => {
    setSelectedEntity({ type: 'wall', id: wallId });
  }, []);
  
  const deselectWall = useCallback(() => {
    setSelectedEntity(null);
  }, []);
  
  return { selectedEntity, selectWall, deselectWall };
}
```

---

## 7. Export Pipeline (PDF/Excel/CSV)

### **PDF Export (jsPDF + jspdf-autotable)**

```javascript
// src/export/pdf.js
export function generateBOQPDF(boqLines, projectInfo) {
  const doc = new jsPDF();
  
  // Header
  doc.text(`BOQ for ${projectInfo.name}`, 10, 10);
  
  // Table
  autoTable(doc, {
    head: [['Item', 'Unit', 'Qty', 'Rate', 'Amount']],
    body: boqLines.map(line => [
      line.description,
      line.unit,
      line.qty,
      line.rate,
      line.amount,
    ]),
  });
  
  return doc;
}
```

**Usage:**
```javascript
const pdf = generateBOQPDF(emitBOQ(store.getState()), projectInfo);
pdf.save('boq.pdf');
```

### **Excel Export (SheetJS/xlsx)**

```javascript
// src/export/excel.js
export function generateBOQExcel(boqLines, mepSystems, summary) {
  const ws1 = XLSX.utils.json_to_sheet(boqLines);
  const ws2 = XLSX.utils.json_to_sheet(mepSystems);
  const ws3 = XLSX.utils.json_to_sheet(summary);
  
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, 'BOQ');
  XLSX.utils.book_append_sheet(wb, ws2, 'MEP');
  XLSX.utils.book_append_sheet(wb, ws3, 'Summary');
  
  return wb;
}
```

---

## 8. Key Concepts

### **Phases (35+ Named Execution Stages)**

Each major operation is broken into phases (not explicitly in code, but in design docs):

- **Phase W:** Wall topology construction
- **Phase C:** Column placement & connectivity
- **Phase B:** Beam routing & endpoints
- **Phase S:** Slab definition
- **Phase T:** Topology validation (T-junctions, loops)
- **Phase Q:** Quantity aggregation per discipline
- **Phase BOQ:** BOQ line emission & scoping
- **Phase E:** Export (PDF/Excel/CSV)

### **Floor Scoping**

Projects can have multiple floors (G, 1, 2, etc.). Quantities are calculated per-floor:

```javascript
const floorFilter = {floorId: 'floor_1'};
const masonry = calculateMasonryQty(store.walls, floorFilter);
const steel = calculateSteelQty(store.beams, floorFilter);
```

### **IFC Metadata (BIM Interoperability)**

Every entity carries:
```javascript
{
  id: 'col_1',
  ifcGlobalId: 'a1B2c3D4e5F6g7H8i9J0k1L2m',  // 22-char base64
  type: 'Column',
  // ... other properties
}
```

This enables IFC export / BIM software integration (deferred for now).

### **Drawing Modes (Inside/Center/Outside)**

When drawing walls or MEP runs, offset kernels apply:

- **Inside mode:** Draw on interior face; geometry shifts outward
- **Center mode:** Draw on centerline (no offset)
- **Outside mode:** Draw on exterior face; geometry shifts inward

Logic in `src/draw/drawReference.js`.

---

## 9. Common Tasks

### **Task: Add a New Quantity Type**

1. **Create aggregator:** `src/quantities/newQtyType.js`
   ```javascript
   export function calculateNewQty(entities, scope) {
     const result = {};
     // Pure logic here
     return result;
   }
   ```

2. **Export from emitter:** `src/boq/emitter.js`
   ```javascript
   import { calculateNewQty } from '../quantities/newQtyType.js';
   
   export function emitBOQ(state) {
     return {
       ...prev,
       newQtyType: calculateNewQty(state.entities, scope),
     };
   }
   ```

3. **Write verification:** `scripts/verify-new-qty-type.mjs`
   ```javascript
   const result = calculateNewQty(testData);
   assert.strictEqual(result.someField, expectedValue);
   ```

4. **Add to UI:** `src/components/BOQTable.jsx` (display in table)

5. **Run verification:** `node scripts/verify-new-qty-type.mjs`

### **Task: Fix a BOQ Calculation Error**

1. **Identify the problem** in a verification script or test data
2. **Locate the aggregator** (e.g., `src/quantities/steelQty.js`)
3. **Trace the formula** → Fix the logic
4. **Update verification** with the correct expected value
5. **Run:** `npm run verify` — ensure all 42 scripts pass
6. **Commit:** Include the verification number in the commit message

### **Task: Add a New MEP Discipline**

1. **Create folder:** `src/mep/newDiscipline/`
2. **Define schema:** `src/mep/newDiscipline/schema.js`
3. **Add to Zustand slice:** `src/mepSlice.js`
4. **Implement sizing logic:** `src/mep/newDiscipline/sizing.js`
5. **Wire components:** `src/components/MEPPanel.jsx`
6. **Write verification:** `scripts/verify-mep-new-discipline.mjs`

### **Task: Modify Component Styling**

1. **Locate component CSS:** Next to the `.jsx` file or in `src/design/`
2. **Use design tokens:** Reference `src/design/tokens.css` (colors, spacing, typography)
3. **No CSS-in-JS:** All styles are `.css` files (benefits: fast, tree-shakeable)
4. **Test:** Run `npm run dev` and verify in browser

---

## 10. Dependencies & Versions

| Dependency | Version | Purpose |
|------------|---------|---------|
| `react` | ^19.2.5 | UI framework |
| `react-dom` | ^19.2.5 | DOM rendering |
| `zustand` | ^5.0.13 | State management |
| `vite` | ^8.0.10 | Build tool |
| `jspdf` | ^4.2.1 | PDF generation |
| `jspdf-autotable` | ^5.0.7 | PDF tables |
| `xlsx` | ^0.18.5 | Excel export |
| `lucide-react` | ^1.16.0 | Icons |
| `pdfjs-dist` | ^4.10.38 | PDF preview |
| `@cloudflare/vite-plugin` | ^1.40.2 | Workers integration |

**No TypeScript** — JSDoc type hints instead. Check `eslint.config.js` for linting rules.

---

## 11. Deployment (Cloudflare Workers)

**Config:** `wrangler.jsonc`
```json
{
  "name": "boq",
  "compatibility_date": "2026-06-16",
  "main": "src/main.jsx"
}
```

**Deploy:**
```bash
wrangler deploy
```

**Build:** Vite handles bundling; output goes to `dist/`.

---

## 12. Quick Navigation Guide

| Need | Look Here |
|------|-----------|
| **Understand the state shape** | `src/store.js` (first 100 lines) |
| **Add a structural entity (column, beam, slab)** | `src/structuralSlice.js` + `src/components/StructuralPanel.jsx` |
| **Fix a BOQ calculation** | `src/quantities/*.js` + corresponding `scripts/verify-*.mjs` |
| **Add MEP system (plumbing, electrical, etc.)** | `src/mep/[discipline]/` + `src/mepSlice.js` |
| **Modify drawing behavior** | `src/components/Canvas.jsx` + `src/draw/` |
| **Change UI layout** | `src/components/Panels.jsx` + component files |
| **Adjust export format (PDF/Excel)** | `src/export/*.js` |
| **Add a new verification test** | `scripts/verify-*.mjs` |
| **Style adjustments** | `src/design/tokens.css` + component `.css` files |
| **Debug a specific tool** | Find tool action in `src/components/Canvas.jsx`; trace to related slice |

---

## 13. Important Notes

### **No Pre-Computed Cache**

- All quantities are computed on-demand from current state
- Memoization is via Zustand selectors (prevent re-renders, not calculations)
- If adding expensive calculations, consider caching in a new slice

### **Immutability First**

- Zustand patches are shallow; use spread operators for nested structures
- Don't mutate returned arrays/objects from store selectors
- Pure functions (topology, quantities) never modify input

### **Testing Philosophy**

- **No Jest/Vitest unit tests** — all verification is via 42 Node.js scripts
- Scripts run at git hook time; zero regressions by construction
- When adding features, write corresponding `verify-*.mjs` script
- Data-driven: test with real project fixtures, not mocks

### **IFC Readiness**

- All entities have `ifcGlobalId`; schema supports export to IFC
- Don't remove or repurpose these fields
- Future work: IFC import/export for BIM interop

---

## 14. Reference Links (If Added)

- Project README: `README.md`
- Business requirements: `BBS_MORNING_REPORT.md`
- Old comprehensive docs: `CLAUDE.md` (325 KB — use only if needed)

---

**End of Reference. For day-to-day work, refer to specific code sections and git history rather than this document.**
