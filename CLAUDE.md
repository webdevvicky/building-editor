# Building Editor — Developer Notes

## Current Phase Status

Phase 1a–1c-4 complete and on `main`. Phase 1d not started.

---

## Phase 1 — What was built

### Phase 1a: Room finish flags + presets
- `finishes` object on every room: `{ flooring, wallPlaster, ceilingPlaster, paint, waterproofing, roofing }` — all booleans
- `roomPresets.js` — `ROOM_PRESETS` map: each type has a default finishes preset + display label
- `getPresetFinishes(type)` — returns preset for a type; falls back to `ALL_FINISHES` (all true) for OTHER
- `setRoomFinishes(roomId, partialFinishes)` — merges partial update into room.finishes
- `setRoomType(roomId, type)` — resets finishes to type preset
- `loadProject()` migrates v1/v2 rooms (no finishes) by applying the type preset

### Phase 1b: Volumetric civil stamps + BOQ finish selectors
**Stamps:**
- `stamps` map in store: `{ id, type, x, y, w, h, depth?, name? }`
- Civil types: `sump` (72×60×72in), `overhead_tank` (60×60×48in), `septic_tank` (96×72×60in) — depth in inches
- Non-civil: `stairs` (48×96in), `lift` (60×60in) — no depth
- `addStamp(type, x, y)` — places stamp at cursor with type defaults
- `resizeStamp(stampId, wFt, hFt)` — wFt/hFt in feet, stored as inches
- `updateStamp(stampId, fields)` — generic partial update (used for depth/name edits)
- `deleteStamp(stampId)`, `selectStamp(stampId)`
- `loadProject()` migrates v1–v3 stamps: injects depth/name defaults for civil types if missing
- `StampPanel.jsx` — selected stamp panel: resize + depth input for civil types

**Finish-gated BOQ selectors (all use `getValidRoomIds()` filter):**
- `getTotalFlooringArea()` — rooms with `finishes.flooring`
- `getTotalCeilingPlasterArea()` — rooms with `finishes.ceilingPlaster`
- `getTotalWaterproofingArea()` — rooms with `finishes.waterproofing`
- `getTotalRoofingArea()` — rooms with `finishes.roofing`
- `getTotalExcavationVolumeFt3()` — sump + septic_tank stamps, `w×h×depth / 1728`
- `getStampsByType(type)` — returns array of stamps filtered by type

**Helper:**
- `sumRoomAreas(predicate)` — generic: sum `getRoomArea` over valid rooms where predicate is true. Used by all finish-gated selectors to avoid duplicating filter+reduce.

### Phase 1c-1: Civil material formulas + Paint walls/ceiling split
**Internal helper (module-level function, not a selector):**
- `getStampDimensionsFt(stamp)` — returns `{ wFt, hFt, dFt, perimeterFt, footprintFt2 }`. Used by both civil qty selectors to avoid duplicating inch→ft conversion.

**Civil quantity selectors (both return plain objects):**
- `getSumpCivilQty()` → `{ excavFt3, brickFt3, rccBottomFt3, rccTopFt3, plasterFt2 }` summed over all sump stamps
  - Brickwork: perimeter × depth × 0.75 ft (9" walls)
  - RCC bottom + top slabs: footprint × 0.5 ft each (6" slabs) — split intentionally for future rate/spec divergence
  - Plaster: perimeter × depth + footprint (4 inner walls + floor)
  - Waterproofing = plasterFt2 (approximation — see note below)
- `getSepticCivilQty()` → same shape
  - Adds 1 internal partition wall spanning `min(wFt, hFt)` (shorter footprint axis = standard 2-chamber design)
  - Brickwork: (perimeter + partition) × depth × 0.75
  - Plaster: (perimeter + partition) × depth + footprint
- OHT: count-only, no material formulas (Phase 1.5+)
- Known approximation: `w`/`h` treated as outer dimensions (inner clear dims are slightly smaller due to 9" walls). Acceptable for schematic BOQ.
- Known approximation: waterproofing assumed = all internal plastered faces. Real systems vary (floor only, upturn, external membrane, full tank). Revisit Phase 1.5+ when material spec inputs exist.

**Paint split:**
- `getTotalPaintWallsArea()` — sum of `getRoomWallArea(id)` for paint-flagged valid rooms
- `getTotalPaintCeilingArea()` — sum of `getRoomArea(id)` for paint-flagged valid rooms (floor area = ceiling)
- `getTotalPaintArea()` — kept as derived sum of above two (backward compat)
- Shared wall between two painted rooms is counted twice (both faces painted) — correct behaviour

**BOQPanel:**
- Paint section: two rows — `Paint (walls)` and `Paint (ceiling)`. Combined row removed.
- Excavation section renamed to **Civil Works** with per-type `StampGroup` sub-rows (6 lines each: excavation, brickwork, RCC bottom, RCC top, plaster, waterproofing). OHT shows as count. Total excavation row at bottom.

### Phase 1c-2: Rate inputs + BOQ CSV export + layout fix

**Rate inputs (ephemeral — React `useState` only, intentional):**
- 13 priceable lines each get a `<input type="number" step="0.01">` rate field
- Rates live in BOQPanel component state (`useState`) — reset on refresh, not persisted, not in store.
  This is intentional scaffolding; will be replaced by ERP product-catalog dropdown in a future phase.
- Bricks: rate is ₹/1000 bricks; cost = `(qty / 1000) × rate` (special case)
- All other lines: cost = `qty × rate`
- Total cost row always rendered (shows "—" when all rates empty)
- Disclaimer: "Preview pricing — for estimation only. Final rates from ERP product catalog."

**Helpers (module-level in BOQPanel.jsx — single source of truth):**
- `getPriceableLines(rates, quantities)` → array of line objects for main section
- `getCivilLinesForStamp(stampType, stampQty, rates)` → array of line objects for each civil stamp type
- Both helpers are consumed by the render loop, the total cost computation, AND the CSV export — no duplication.
- RCC bottom + top slabs merged at UI/rate layer (single `rcc` rate key) while data layer keeps them split for future spec divergence.

**CSV export:**
- "Export BOQ (CSV)" button → downloads `boq-export-YYYY-MM-DD.csv`
- Columns: Item | Quantity | Unit | Rate (₹) | Cost (₹)
- All 13 priceable lines exported including zero-qty rows (stable structure for procurement).
- Vanilla `Blob + <a>` download — no library.

**Layout fix:**
- BOQ panel grew to 380px minWidth and its `bottom: 16` anchor caused it to cover StampPanel,
  OpeningPanel, RoomPanel, BulkWallPanel (all were `top: 56, right: 16`).
- Fix: moved all four context panels from `right: 16` → `left: 16`.
- Layout is now: left = editing context (mutually exclusive), right = BOQ, canvas in middle.
- Canvas working area: ~694px at 1366px wide, ~1248px at 1920px wide.

### Phase 1c-4: Formula transparency for BOQ

**New file `src/formulas.js`:**
- 17 exported pure functions: `explainWallArea`, `explainFlooring`, `explainPlasterWalls`, `explainPlasterCeiling`, `explainPaintWalls`, `explainPaintCeiling`, `explainWaterproofing`, `explainRoofing`, `explainUnits`, `explainCement`, `explainSand`, `explainAdhesive`, `explainCivilExcavation`, `explainCivilBrickwork`, `explainCivilRCC`, `explainCivilPlaster`, `explainCivilWaterproofing`
- Each takes `state = { walls, nodes, rooms, stamps, getWallArea, getValidRoomIds, getRoomArea, getRoomWallArea }` plus optional `matKey` or `stampType`
- Returns `{ title, steps: [{ label, value, bold? }], note? }` — consumed by FormulaPopover
- Internal helpers: `wallLengthFt`, `wallOpeningAreaFt2`, `matVolumes` (unrounded intermediates to match store), `roomAreaSteps`, `civilStamps`
- Intermediate computations are NOT rounded before `Math.ceil`/`Math.round` final step — avoids ±1 discrepancy vs store values
- Notes document hardcoded constants (mortar ratio, 5% wastage) and deferred behaviors (plaster walls ungated, waterproofing approximation)

**BOQPanel additions:**
- `getFormulaData(id, state)` dispatcher — module-level, maps popover IDs to formula functions
- `InfoIcon` component — ⓘ button with `data-info-btn=""` attribute (prevents close-on-mousedown race)
- `FormulaPopover` component — `position: fixed` (escapes scroll container), closes on outside click or Escape
- `infoId`/`openId`/`onInfoClick` props added to `Row`, `PricedRow`, `PricedSubRow`
- ⓘ icon placed in label cell (col 1) — avoids overflow in 68px qty column
- Civil popover IDs: `sump_{rateKey}` / `septic_{rateKey}` (not the shared rate key, which can't be unique per stamp type)
- matKey parsing for popover IDs: strip `mat_`, `lastIndexOf('_')` splits matKey from suffix (handles multi-underscore keys)
- Popover closes on BOQPanel scroll (`onScroll` handler on outer div)
- 5 new store subscriptions: `nodes`, `getWallArea`, `getValidRoomIds`, `getRoomArea`, `getRoomWallArea`

### Phase 1c-3: Per-wall material types with bonding-aware BOQ

**Data model:**
- `wall.materialKey` — string key into MATERIAL_LIBRARY, default `'IS_MODULAR_BRICK'`
- Set on `addWall` creation; propagated through `splitWall` (both segments inherit parent's key)
- `setWallMaterial(wallId, key)` — action to change a wall's material; validates key against MATERIAL_LIBRARY
- `loadProject` migration: `{ materialKey: 'IS_MODULAR_BRICK', ...wall }` (default-first, saved value wins)

**Material library (`src/materials.js`):**
- `BONDING` enum: `CEMENT_SAND_MORTAR`, `THIN_BED_ADHESIVE`
- 7 types: `IS_MODULAR_BRICK`, `RED_CLAY_BRICK`, `FLY_ASH_BRICK` (brick types, CEMENT_SAND);
  `AAC_BLOCK`, `CLC_BLOCK` (thin-bed blocks); `CONCRETE_SOLID_BLOCK`, `CONCRETE_HOLLOW_BLOCK` (CEMENT_SAND blocks)
- Brick types: `bricksPerFt3` field; block types: `blocksPerFt3` field
  — consuming code: `mat.bricksPerFt3 ?? mat.blocksPerFt3`
- CEMENT_SAND fields: `mortarVolPerFt3Wall`, `cementBagsPerFt3Mortar`, `sandFt3PerFt3Mortar`
- THIN_BED fields: `adhesiveKgPerFt2`, `adhesiveBagKg` (40 kg bags)
  — AAC: 0.28 kg/ft²; CLC: 0.23 kg/ft² (from manufacturer specs)
- Intentional scaffolding: static constant until ERP product catalog fetch replaces it.
  Consumers (getMaterialQuantities, OpeningPanel, BOQPanel) stay the same — only the import source changes.

**Store selector:**
- `getMaterialQuantities()` — aggregates walls by `materialKey`; returns `{ [matKey]: { volFt3, faceAreaFt2, unitCount, cementBags?, sandFt3?, adhesiveKg?, adhesiveBags? } }` (only keys with >0 volume present)
- 5% wastage applied to unitCount
- Replaces `getTotalBricks()` entirely

**OpeningPanel:**
- Material `<select>` dropdown below Thickness field, lists all MATERIAL_LIBRARY entries
- Triggers `setWallMaterial` on change; shows current `wall.materialKey` as selected option

**BOQPanel:**
- Masonry section (between Flooring and Plaster rows): one sub-group per active material type
  — CEMENT_SAND: Bricks/Blocks, Cement (bags), Sand (ft³)
  — THIN_BED: Blocks, Adhesive (bags)
- Rate keys: `mat_{matKey}_unit`, `mat_{matKey}_cement`, `mat_{matKey}_sand`, `mat_{matKey}_adhesive`
- Bricks rate: ₹/1000 (isPer1000=true); blocks rate: ₹/block
- `buildMaterialRateKeys()` — generates all material rate keys at init time
- `buildMaterialLines(matQty, rates)` — flat line list for cost totals + CSV
- CSV export: Flooring → material lines → Plaster/Paint/… → Civil

---

## Known issues / Phase 1.5 backlog

- **Undo/redo can restore room-overlap state** that bypassed save-time prevention.
  Repro: Create Room 1 → Delete Room 1 → Create Room A in same space → Undo the delete.
  Room 1 + Room A now coexist. Mitigated: both are excluded from all BOQ totals by the
  pairwise overlap filter in `getValidRoomIds()`. Fix in Phase 1.5 with revision/lifecycle work.

- **Civil stamp outer-dim approximation** — brickwork/plaster computed on outer footprint, not inner clear dims. Negligible for schematic BOQ. Revisit Phase 1.5+ with material spec inputs.

- **Waterproofing on civil stamps** — approximated as full inner plastered surface. Real spec varies per system. Needs material spec input in Phase 1.5+.

- **OHT material formulas** — deferred to Phase 1.5+ (sits on roof slab, needs structural context).

- **Septic soak pit** — not modelled. Deferred.

---

## Architectural reminders

- `getValidRoomIds()` is the filter for ALL finish-gated and floor area totals. Never iterate `Object.keys(rooms)` directly for BOQ.
- `getTotalWallArea()` iterates the walls map directly (not room.wallIds) to avoid double-counting shared walls. Do not change this.
- `getTotalPaintWallsArea()` iterates per room (not the walls map) because both faces of a shared wall between two painted rooms should be counted.
- `getMaterialQuantities()` iterates the walls map directly (same reason — each wall counted once for volume).
- Storage unit is **inches** throughout. `GRID_IN = 12`. Display converts to feet or metres at render time.
- `wall.materialKey` defaults to `'IS_MODULAR_BRICK'`. Always use `w.materialKey ?? 'IS_MODULAR_BRICK'` when reading it (migration guard for in-memory state that bypassed loadProject).
- No new libraries without asking.
