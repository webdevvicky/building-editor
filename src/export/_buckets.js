// Shared category → sheet/section bucket registry for BOQ exports.
//
// Both PDF and Excel exports route every category through this registry
// to decide which sheet/section it belongs to. The registry exists so the
// two exports never drift apart and so adding a new BOQ category requires
// updating exactly one place (not three: Excel sheet list, Excel order,
// PDF section list — the situation that caused joinery/tiles/grills/MEP
// to silently disappear from both exports).
//
// Bucket shape:
//   { name, categories }
//   - `name`: display label (sheet name in Excel, section header in PDF)
//   - `categories`: an array. Each entry is either
//        - a STRING (single-category bucket — no "System" sub-column)
//        - an OBJECT { cat, system } (multi-category bucket — exports
//          render a "System" column populated from this label)
//
// Order in the array determines build order. Single-category buckets
// stay in their original arrangement (excavation → plum concrete → RCC
// → concrete mix → steel → shuttering → masonry → plaster → finishes →
// tiles → joinery → grills → civil → staircase), MEP grouped at the
// end so procurement reads structural / civil / interiors before MEP.

export const SHEET_BUCKETS = Object.freeze([
  // ── Civil / structural / finishes (single-category buckets) ──────────
  Object.freeze({ name: 'Excavation',         categories: ['excavation'] }),
  Object.freeze({ name: 'Plum Concrete',      categories: ['plumConcrete'] }),
  Object.freeze({ name: 'Structural',         categories: ['rcc'] }),
  Object.freeze({ name: 'Concrete',           categories: ['concreteMix'] }),
  Object.freeze({ name: 'Steel',              categories: ['steel'] }),
  Object.freeze({ name: 'Shuttering',         categories: ['shuttering'] }),
  Object.freeze({ name: 'Masonry',            categories: ['masonry'] }),
  Object.freeze({ name: 'Plaster',            categories: ['plaster'] }),
  Object.freeze({ name: 'Finishes',           categories: ['finishes'] }),
  Object.freeze({ name: 'Tiles',              categories: ['tiles'] }),
  Object.freeze({ name: 'Joinery',            categories: ['joinery'] }),
  Object.freeze({ name: 'Grills & Handrails', categories: ['grills'] }),
  Object.freeze({ name: 'Civil',              categories: ['civil'] }),
  Object.freeze({ name: 'Staircase',          categories: ['staircase'] }),

  // ── MEP (grouped, multi-category, exports render "System" column) ────
  Object.freeze({ name: 'Plumbing', categories: Object.freeze([
    Object.freeze({ cat: 'plumbing_supply',    system: 'Supply'    }),
    Object.freeze({ cat: 'plumbing_drainage',  system: 'Drainage'  }),
    Object.freeze({ cat: 'plumbing_fixtures',  system: 'Fixtures'  }),
  ]) }),
  Object.freeze({ name: 'Electrical', categories: Object.freeze([
    Object.freeze({ cat: 'electrical_lighting', system: 'Lighting' }),
    Object.freeze({ cat: 'electrical_power',    system: 'Power'    }),
    Object.freeze({ cat: 'electrical_hvac',     system: 'AC'       }),
    Object.freeze({ cat: 'electrical_submain',  system: 'Submain'  }),
    Object.freeze({ cat: 'electrical_solar',    system: 'Solar'    }),
    Object.freeze({ cat: 'electrical_ev',       system: 'EV'       }),
    Object.freeze({ cat: 'electrical_points',   system: 'Points'   }),
    Object.freeze({ cat: 'electrical_fittings', system: 'Fittings' }),
    Object.freeze({ cat: 'electrical_db',       system: 'DB'       }),
  ]) }),
  Object.freeze({ name: 'HVAC', categories: Object.freeze([
    Object.freeze({ cat: 'hvac_refrigerant', system: 'Refrigerant' }),
    Object.freeze({ cat: 'hvac_condensate',  system: 'Condensate'  }),
    Object.freeze({ cat: 'hvac_units',       system: 'Units'       }),
  ]) }),
  Object.freeze({ name: 'Fire', categories: Object.freeze([
    Object.freeze({ cat: 'fire_detection',   system: 'Detection'   }),
    Object.freeze({ cat: 'fire_suppression', system: 'Suppression' }),
    Object.freeze({ cat: 'fire_equipment',   system: 'Equipment'   }),
  ]) }),
  Object.freeze({ name: 'ELV', categories: Object.freeze([
    Object.freeze({ cat: 'elv_cctv',     system: 'CCTV'     }),
    Object.freeze({ cat: 'elv_data',     system: 'Data'     }),
    Object.freeze({ cat: 'elv_security', system: 'Security' }),
    Object.freeze({ cat: 'elv_av',       system: 'AV'       }),
  ]) }),
])

// Flatten bucket.categories to the raw category-id strings used in line.category.
export function bucketCategoryIds(bucket) {
  return bucket.categories.map(c => typeof c === 'string' ? c : c.cat)
}

// True when this bucket merges 2+ categories — exporters render a "System" column.
export function bucketIsMulti(bucket) {
  return bucket.categories.length > 1
}

// Map category-id → human system label for a multi-category bucket.
// Returns '' for entries that don't carry a `system` (single-category buckets).
export function bucketSystemLabel(bucket, categoryId) {
  const entry = bucket.categories.find(c => typeof c === 'object' && c.cat === categoryId)
  return entry?.system ?? ''
}

// Collect lines for a bucket from a `grouped` map (output of
// groupBoqLinesByCategory). Preserves bucket-order so e.g. plumbing_supply
// lines come before plumbing_drainage in the merged sheet.
export function bucketLines(bucket, grouped) {
  return bucketCategoryIds(bucket).flatMap(cat => grouped[cat] ?? [])
}

// Every category id that some bucket covers — used for the dev-mode
// "unmapped category" warning so a new MEP discipline doesn't silently
// vanish from exports.
export const ALL_BUCKETED_CATS = Object.freeze(new Set(
  SHEET_BUCKETS.flatMap(bucketCategoryIds)
))

// Dev-only warning. Call after grouping to detect any line categories
// that no bucket covers — they'll still appear in Raw Data but won't
// have a per-sheet table / per-section page.
export function warnUnmappedCategories(grouped) {
  if (typeof console === 'undefined') return
  const unknown = Object.keys(grouped).filter(c => !ALL_BUCKETED_CATS.has(c) && (grouped[c]?.length ?? 0) > 0)
  if (unknown.length === 0) return
  // eslint-disable-next-line no-console
  console.warn('[boq-export] Unmapped BOQ categories — add a bucket to src/export/_buckets.js:', unknown)
}
