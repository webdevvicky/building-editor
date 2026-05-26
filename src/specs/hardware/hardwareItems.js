// Door + window hardware item registry — single source for every hardware
// item (hinges / locks / latches / closers / handles / tracks / window
// stays / mosquito mesh).
//
// Hardware SETS (hardwareSets.js + windowHardwareSets.js) reference items
// from this registry by itemId. Items declared once; sets compose them
// with counts.

export const CATALOG_VERSION = '2026-05-26-IS-1341-DOOR-WINDOW-FITTINGS'
export const CATALOG_SOURCE  = 'IS 1341 / IS 7196 / NBC 2016 / Hettich-Hafele residential catalogues'

function freeze(o) { return Object.freeze(o) }

// Hardware categories — UI groups items by these in the picker.
export const HW_CATEGORY = Object.freeze({
  HINGE:       'HINGE',
  LOCK:        'LOCK',
  LATCH:       'LATCH',
  BOLT:        'BOLT',
  CLOSER:      'CLOSER',
  STOPPER:     'STOPPER',
  HANDLE:      'HANDLE',
  TRACK:       'TRACK',
  WIN_STAY:    'WIN_STAY',
  WIN_HANDLE:  'WIN_HANDLE',
  WIN_LOCK:    'WIN_LOCK',
  RESTRICTOR:  'RESTRICTOR',
  MESH:        'MESH',           // mosquito mesh — special: qty = openingAreaFt2
  ACCESSORY:   'ACCESSORY',
})

// Items with category === MESH are special-cased in the aggregator:
// qty = sum(opening.w × opening.h / 144) Sft instead of fixed count.

export const HARDWARE_ITEM_REGISTRY = Object.freeze([
  // ── Door hinges ────────────────────────────────────────────────────────
  freeze({
    id: 'HINGE_HD_4X4',
    label: 'Heavy duty hinge 4"×4" (SS 304)',
    category: HW_CATEGORY.HINGE,
    unit: 'nos',
    appliesParent: 'door',
    sizeIn: 4, material: 'SS_304',
    ifcType:             'IfcDoorStyle',
    classificationCode:  'Pr_30_59_98_31',
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'HINGE_STD_3X3',
    label: 'Standard hinge 3"×3" (SS)',
    category: HW_CATEGORY.HINGE,
    unit: 'nos',
    appliesParent: 'door',
    sizeIn: 3, material: 'SS_304',
    ifcType: 'IfcDoorStyle',
    classificationCode: 'Pr_30_59_98_31',
    version: CATALOG_VERSION,
  }),

  // ── Locks ──────────────────────────────────────────────────────────────
  freeze({
    id: 'LOCK_MORTISE',
    label: 'Mortise lockset (heavy-duty cylinder)',
    category: HW_CATEGORY.LOCK,
    unit: 'nos',
    appliesParent: 'door',
    material: 'BRASS',
    ifcType: 'IfcDoorStyle',
    classificationCode: 'Pr_30_59_98_45',
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'LOCK_CYLINDR',
    label: 'Cylindrical lockset (tubular)',
    category: HW_CATEGORY.LOCK,
    unit: 'nos',
    appliesParent: 'door',
    material: 'STAINLESS',
    ifcType: 'IfcDoorStyle',
    classificationCode: 'Pr_30_59_98_45',
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'LOCK_DEADBOLT',
    label: 'Deadbolt lock (additional security)',
    category: HW_CATEGORY.LOCK,
    unit: 'nos',
    appliesParent: 'door',
    ifcType: 'IfcDoorStyle',
    classificationCode: 'Pr_30_59_98_45',
    version: CATALOG_VERSION,
  }),

  // ── Latches / bolts ────────────────────────────────────────────────────
  freeze({
    id: 'LATCH_BATH',
    label: 'Bathroom latch (privacy turn)',
    category: HW_CATEGORY.LATCH,
    unit: 'nos',
    appliesParent: 'door',
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'TOWER_BOLT_6',
    label: 'Tower bolt 6" (SS)',
    category: HW_CATEGORY.BOLT,
    unit: 'nos',
    appliesParent: 'door',
    sizeIn: 6,
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'TOWER_BOLT_4',
    label: 'Tower bolt 4" (SS)',
    category: HW_CATEGORY.BOLT,
    unit: 'nos',
    appliesParent: 'door',
    sizeIn: 4,
    version: CATALOG_VERSION,
  }),

  // ── Door accessories ───────────────────────────────────────────────────
  freeze({
    id: 'DOOR_CLOSER',
    label: 'Overhead door closer (hydraulic)',
    category: HW_CATEGORY.CLOSER,
    unit: 'nos',
    appliesParent: 'door',
    ifcType: 'IfcDoorStyle',
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'DOOR_STOPPER',
    label: 'Floor door stopper (SS)',
    category: HW_CATEGORY.STOPPER,
    unit: 'nos',
    appliesParent: 'door',
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'DOOR_HANDLE',
    label: 'Door handle (D-type, SS)',
    category: HW_CATEGORY.HANDLE,
    unit: 'nos',
    appliesParent: 'door',
    version: CATALOG_VERSION,
  }),

  // ── Sliding track ──────────────────────────────────────────────────────
  freeze({
    id: 'SLIDING_TRACK',
    label: 'Sliding door track set (top-hung)',
    category: HW_CATEGORY.TRACK,
    unit: 'set',
    appliesParent: 'door',
    ifcType: 'IfcDoorStyle',
    version: CATALOG_VERSION,
  }),

  // ── Window hardware ────────────────────────────────────────────────────
  freeze({
    id: 'WIN_FRICTION_STAY',
    label: 'Friction stay (4-bar, casement window)',
    category: HW_CATEGORY.WIN_STAY,
    unit: 'nos',
    appliesParent: 'window',
    ifcType: 'IfcWindowStyle',
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'WIN_HANDLE_CASEMENT',
    label: 'Casement handle (espag/cremone)',
    category: HW_CATEGORY.WIN_HANDLE,
    unit: 'nos',
    appliesParent: 'window',
    ifcType: 'IfcWindowStyle',
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'WIN_LOCK_MULTIPOINT',
    label: 'Multi-point window lock',
    category: HW_CATEGORY.WIN_LOCK,
    unit: 'nos',
    appliesParent: 'window',
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'WIN_RESTRICTOR',
    label: 'Window opening restrictor (child safety)',
    category: HW_CATEGORY.RESTRICTOR,
    unit: 'nos',
    appliesParent: 'window',
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'WIN_SLIDING_HANDLE',
    label: 'Sliding window pull handle',
    category: HW_CATEGORY.HANDLE,
    unit: 'nos',
    appliesParent: 'window',
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'MOSQUITO_MESH',
    label: 'Mosquito mesh (fibreglass / SS, per opening area)',
    category: HW_CATEGORY.MESH,
    unit: 'Sft',
    appliesParent: 'window',
    qtyMode: 'AREA',   // aggregator special-cases: qty = w*h/144 Sft per opening
    ifcType: 'IfcWindowStyle',
    version: CATALOG_VERSION,
  }),
])

export function getHardwareItem(id) {
  return HARDWARE_ITEM_REGISTRY.find(i => i.id === id) ?? null
}

export function listHardwareItems() {
  return HARDWARE_ITEM_REGISTRY
}

export function listHardwareItemsByCategory(cat) {
  return HARDWARE_ITEM_REGISTRY.filter(i => i.category === cat)
}

export function listHardwareItemsByParent(parentType) {
  return HARDWARE_ITEM_REGISTRY.filter(i => i.appliesParent === parentType)
}
