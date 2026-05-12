# Building Editor — Developer Notes

## Current Phase Status

Phase 1a–1c-1 complete and on `main`. Phase 1c Part 2 not started.

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
- Storage unit is **inches** throughout. `GRID_IN = 12`. Display converts to feet or metres at render time.
- No new libraries without asking.
