// Hardware set registry — pre-configured item bundles per opening subtype.
//
// Sets are referenced from projectSettings.doorHardwareDefaults +
// windowHardwareDefaults (per-subtype defaults) and from
// opening.hardwareSetId (per-opening override).
//
// Each set entry: { itemId, qty }. Hardware aggregator expands set items
// into the perItem rollup. opening.hardwareOverrides (Hybrid + adjustments
// option from Gap 4) layer on top: { add: [{itemId,qty}], remove: [itemId] }.

import { CATALOG_VERSION as ITEM_VERSION } from './hardwareItems.js'

export const CATALOG_VERSION = '2026-05-26-HARDWARE-SETS-V1'
export const CATALOG_SOURCE  = 'Indian residential best practice'

function freeze(o) { return Object.freeze(o) }

// ── Door sets ────────────────────────────────────────────────────────────

export const HARDWARE_SET_REGISTRY = Object.freeze([
  freeze({
    id: 'MAIN_DOOR_STANDARD',
    label: 'Main door — standard',
    appliesTo: Object.freeze(['MAIN_DOOR']),
    items: Object.freeze([
      freeze({ itemId: 'HINGE_HD_4X4',  qty: 3 }),
      freeze({ itemId: 'LOCK_MORTISE',  qty: 1 }),
      freeze({ itemId: 'DOOR_CLOSER',   qty: 1 }),
      freeze({ itemId: 'DOOR_STOPPER',  qty: 1 }),
      freeze({ itemId: 'DOOR_HANDLE',   qty: 1 }),
    ]),
    itemCatalogVersion: ITEM_VERSION,
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'MAIN_DOOR_SECURITY',
    label: 'Main door — high security',
    appliesTo: Object.freeze(['MAIN_DOOR']),
    items: Object.freeze([
      freeze({ itemId: 'HINGE_HD_4X4',  qty: 4 }),
      freeze({ itemId: 'LOCK_MORTISE',  qty: 1 }),
      freeze({ itemId: 'LOCK_DEADBOLT', qty: 1 }),
      freeze({ itemId: 'DOOR_CLOSER',   qty: 1 }),
      freeze({ itemId: 'DOOR_STOPPER',  qty: 1 }),
      freeze({ itemId: 'DOOR_HANDLE',   qty: 1 }),
    ]),
    itemCatalogVersion: ITEM_VERSION,
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'INTERNAL_DOOR_STANDARD',
    label: 'Internal door — standard (bedroom / study / pooja)',
    appliesTo: Object.freeze(['INTERNAL_DOOR']),
    items: Object.freeze([
      freeze({ itemId: 'HINGE_STD_3X3', qty: 3 }),
      freeze({ itemId: 'LOCK_CYLINDR',  qty: 1 }),
      freeze({ itemId: 'DOOR_STOPPER',  qty: 1 }),
    ]),
    itemCatalogVersion: ITEM_VERSION,
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'TOILET_DOOR_STANDARD',
    label: 'Toilet door — standard',
    appliesTo: Object.freeze(['INTERNAL_DOOR']),
    items: Object.freeze([
      freeze({ itemId: 'HINGE_STD_3X3', qty: 2 }),
      freeze({ itemId: 'LATCH_BATH',    qty: 1 }),
      freeze({ itemId: 'TOWER_BOLT_4',  qty: 1 }),
    ]),
    itemCatalogVersion: ITEM_VERSION,
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'SLIDING_DOOR_STANDARD',
    label: 'Sliding door — standard',
    appliesTo: Object.freeze(['INTERNAL_DOOR']),
    items: Object.freeze([
      freeze({ itemId: 'SLIDING_TRACK', qty: 1 }),
      freeze({ itemId: 'DOOR_HANDLE',   qty: 2 }),
    ]),
    itemCatalogVersion: ITEM_VERSION,
    version: CATALOG_VERSION,
  }),
])

export function getHardwareSet(id) {
  return HARDWARE_SET_REGISTRY.find(s => s.id === id) ?? null
}

export function listHardwareSets() {
  return HARDWARE_SET_REGISTRY
}

export function listHardwareSetsByAppliesTo(subtype) {
  return HARDWARE_SET_REGISTRY.filter(s => s.appliesTo.includes(subtype))
}

// ── Window / ventilator sets ─────────────────────────────────────────────

export const WINDOW_HARDWARE_SET_REGISTRY = Object.freeze([
  freeze({
    id: 'WINDOW_CASEMENT_STANDARD',
    label: 'Casement window — standard',
    appliesTo: Object.freeze(['WINDOW']),
    items: Object.freeze([
      freeze({ itemId: 'WIN_FRICTION_STAY',    qty: 2 }),
      freeze({ itemId: 'WIN_HANDLE_CASEMENT',  qty: 1 }),
      freeze({ itemId: 'WIN_LOCK_MULTIPOINT',  qty: 1 }),
      freeze({ itemId: 'MOSQUITO_MESH',        qty: 1 }),   // qty=1 placeholder; aggregator overrides to area
    ]),
    itemCatalogVersion: ITEM_VERSION,
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'WINDOW_SLIDING_STANDARD',
    label: 'Sliding window — standard',
    appliesTo: Object.freeze(['WINDOW']),
    items: Object.freeze([
      freeze({ itemId: 'WIN_SLIDING_HANDLE',   qty: 2 }),
      freeze({ itemId: 'WIN_LOCK_MULTIPOINT',  qty: 1 }),
      freeze({ itemId: 'MOSQUITO_MESH',        qty: 1 }),
    ]),
    itemCatalogVersion: ITEM_VERSION,
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'VENTILATOR_STANDARD',
    label: 'Ventilator — standard louver',
    appliesTo: Object.freeze(['VENTILATOR']),
    items: Object.freeze([
      freeze({ itemId: 'WIN_FRICTION_STAY',    qty: 1 }),
    ]),
    itemCatalogVersion: ITEM_VERSION,
    version: CATALOG_VERSION,
  }),
])

export function getWindowHardwareSet(id) {
  return WINDOW_HARDWARE_SET_REGISTRY.find(s => s.id === id) ?? null
}

export function listWindowHardwareSets() {
  return WINDOW_HARDWARE_SET_REGISTRY
}

export function listWindowHardwareSetsByAppliesTo(subtype) {
  return WINDOW_HARDWARE_SET_REGISTRY.filter(s => s.appliesTo.includes(subtype))
}

// Combined lookup — door + window catalogs share the opening.hardwareSetId
// field; the lookup walks both registries.
export function getAnyHardwareSet(id) {
  return getHardwareSet(id) ?? getWindowHardwareSet(id)
}

// Catalog version manifest (mirrors mep/catalogs/index.js pattern).
export const CATALOG_VERSIONS = Object.freeze({
  HARDWARE_ITEMS:        ITEM_VERSION,
  HARDWARE_SETS:         CATALOG_VERSION,
  WINDOW_HARDWARE_SETS:  CATALOG_VERSION,
})

// Project-default ids by subtype — exported for setProjectMeta resets.
export const DEFAULT_DOOR_HARDWARE_DEFAULTS = Object.freeze({
  MAIN_DOOR:     'MAIN_DOOR_STANDARD',
  INTERNAL_DOOR: 'INTERNAL_DOOR_STANDARD',
})

export const DEFAULT_WINDOW_HARDWARE_DEFAULTS = Object.freeze({
  WINDOW:     'WINDOW_CASEMENT_STANDARD',
  VENTILATOR: 'VENTILATOR_STANDARD',
})
