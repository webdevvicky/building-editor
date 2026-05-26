// Door + window hardware quantity aggregator (Gap 4 + 5).
//
// Walks every opening, resolves its hardware set + adjustments via
// src/specs/hardware/resolution.js, expands items × qty, rolls up
// per-item totals across the project.
//
// Mosquito mesh (item.qtyMode === 'AREA') is special-cased: qty = sum
// of opening areas (Sft) rather than item count. Set entries with this
// item ignore their declared `qty` (always treated as 1 per opening).
//
// Output:
//   {
//     perOpening:  [{ wallId, openingId, subtype, setId, source, items[] }],
//     perItem:     [{ itemId, label, category, unit, totalQty, fromOpenings: [{wallId,openingId}] }],
//     bySubtype:   { MAIN_DOOR: {count, ...}, INTERNAL_DOOR: {...}, WINDOW: {...}, VENTILATOR: {...} },
//     totals:      { totalItemCount, openingCount },
//     _meta,
//   }

import { resolveOpeningHardware } from '../specs/hardware/resolution.js'
import { getHardwareItem, HW_CATEGORY } from '../specs/hardware/hardwareItems.js'
import { CATALOG_VERSIONS } from '../specs/hardware/hardwareSets.js'
import { OPENING_SUBTYPE } from '../constants/joinery.js'
import { buildMeta, ATTRIBUTION_POLICY, isScopedState } from './_metaContract.js'
import { safeR2 as r2 } from '../lib/numbers.js'

const ALGORITHM    = 'OPENING_HARDWARE_ROLLUP_V1'
const CALC_VERSION = '2026-05-26'

export function computeDoorHardwareQuantities(state) {
  if (!state) {
    return {
      perOpening: [], perItem: [], bySubtype: {},
      totals: { totalItemCount: 0, openingCount: 0 },
      _meta:  buildMeta({ algorithm: ALGORITHM, calculationVersion: CALC_VERSION,
                          attributionPolicy: ATTRIBUTION_POLICY.OWNING_ROOM, scoped: false }),
    }
  }

  const perOpening = []
  const perItemAgg = {}   // { [itemId]: { def, totalQty, fromOpenings: Set, unit, category } }
  const bySubtype = {
    [OPENING_SUBTYPE.MAIN_DOOR]:     { count: 0, itemCount: 0 },
    [OPENING_SUBTYPE.INTERNAL_DOOR]: { count: 0, itemCount: 0 },
    [OPENING_SUBTYPE.WINDOW]:        { count: 0, itemCount: 0 },
    [OPENING_SUBTYPE.VENTILATOR]:    { count: 0, itemCount: 0 },
  }

  let openingCount = 0

  for (const wall of Object.values(state.walls ?? {})) {
    if (wall.isVirtual || wall.isPlot) continue
    for (const op of (wall.openings ?? [])) {
      const subtype = op.subtype
      if (!subtype) continue
      const resolved = resolveOpeningHardware(state, op)
      openingCount += 1
      if (bySubtype[subtype]) bySubtype[subtype].count += 1
      if (!resolved.items.length) {
        perOpening.push({ wallId: wall.id, openingId: op.id, subtype, setId: resolved.setId,
                          source: resolved.source, items: [] })
        continue
      }

      // Opening area in Sft (used for mesh items).
      const openingAreaSft = ((op.width ?? 0) * (op.height ?? 0)) / 144

      const opItems = []
      for (const it of resolved.items) {
        const def = getHardwareItem(it.itemId)
        if (!def) continue
        let qty = it.qty
        if (def.qtyMode === 'AREA' || def.category === HW_CATEGORY.MESH) {
          qty = openingAreaSft   // one mesh sheet sized to opening
        }
        if (qty <= 0) continue

        if (!perItemAgg[def.id]) {
          perItemAgg[def.id] = {
            def, totalQty: 0, fromOpenings: new Set(),
            unit: def.unit, category: def.category,
          }
        }
        perItemAgg[def.id].totalQty += qty
        perItemAgg[def.id].fromOpenings.add(op.id)
        opItems.push({ itemId: def.id, label: def.label, category: def.category, qty, unit: def.unit, source: it.source })
        if (bySubtype[subtype]) bySubtype[subtype].itemCount += qty
      }

      perOpening.push({
        wallId:   wall.id,
        openingId: op.id,
        subtype,
        setId:    resolved.setId,
        setLabel: resolved.setLabel,
        source:   resolved.source,
        items:    opItems,
      })
    }
  }

  // Flatten perItem with rounding.
  const perItem = Object.values(perItemAgg).map(({ def, totalQty, fromOpenings }) => {
    const isArea = def.qtyMode === 'AREA' || def.category === HW_CATEGORY.MESH
    return {
      itemId:        def.id,
      label:         def.label,
      category:      def.category,
      unit:          def.unit,
      totalQty:      isArea ? r2(totalQty) : Math.ceil(totalQty),
      fromOpenings:  [...fromOpenings],
    }
  })
  // Stable sort: category then itemId.
  perItem.sort((a, b) => a.category.localeCompare(b.category) || a.itemId.localeCompare(b.itemId))

  return {
    perOpening,
    perItem,
    bySubtype,
    totals: {
      openingCount,
      totalItemCount: perItem.reduce((s, i) => s + (Number.isFinite(i.totalQty) ? i.totalQty : 0), 0),
    },
    _meta: buildMeta({
      algorithm:          ALGORITHM,
      calculationVersion: CALC_VERSION,
      attributionPolicy:  ATTRIBUTION_POLICY.OWNING_ROOM,
      scoped:             isScopedState(state),
      extras: {
        catalogVersions: CATALOG_VERSIONS,
      },
    }),
  }
}
