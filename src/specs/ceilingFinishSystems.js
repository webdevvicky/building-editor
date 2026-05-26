// Ceiling finish system registry — false-ceiling materials (Gap 7).
//
// Per-room override slot: room.ceilingFinishId (null = project default).
// Project default: projectSettings.defaultCeilingFinishSystemId.
//
// Only rooms with finishes.ceilingPlaster === true accept a ceiling
// finish (false ceiling sits BELOW structural plaster; can't exist
// without the plaster line above it).
//
// perimeterBased (Addition 4): reserved on every entry for future
// cove / cornice / trim calc (perimeter × profile length). v1 ignores
// it.

export const CATALOG_VERSION = '2026-05-26-CEILING-V1'
export const CATALOG_SOURCE  = 'IS 2095 / IS 4252 / IS 8869 / market practice (Saint-Gobain, Armstrong, Aerolite)'

function freeze(o) { return Object.freeze(o) }

// All material qtyPerM2 values are per square metre of ceiling finished
// area. 1.05 multiplier is wastage allowance built in. Conversion to Sft
// happens at the aggregator: areaSqm = areaSft × 0.0929.

export const CEILING_FINISH_REGISTRY = Object.freeze([
  freeze({
    id: 'NONE',
    label: 'No false ceiling (plaster only)',
    perimeterBased: false,
    materials: Object.freeze([]),
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'GYPSUM_BOARD_12MM',
    label: 'Gypsum board false ceiling (12mm)',
    perimeterBased: false,
    materials: Object.freeze([
      freeze({ id: 'GYPSUM_BOARD',   label: 'Gypsum board 12mm × 4\'×8\'',          qtyPerM2: 1.05, unit: 'sqm' }),
      freeze({ id: 'GI_FRAMING',     label: 'GI furring + main runner system',      qtyPerM2: 1.0,  unit: 'sqm' }),
      freeze({ id: 'HEAT_INSULATOR', label: 'Heat insulator blanket',                qtyPerM2: 1.0,  unit: 'sqm' }),
      freeze({ id: 'SCREWS',         label: 'Drywall screws (1.25")',                qtyPerM2: 30,   unit: 'nos' }),
      freeze({ id: 'JOINT_TAPE',     label: 'Paper joint tape',                      qtyPerM2: 2.0,  unit: 'Rft' }),
    ]),
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'CEMENT_BOARD_3_5MM',
    label: 'Cement board ceiling 3.5mm (moisture-prone areas)',
    perimeterBased: false,
    materials: Object.freeze([
      freeze({ id: 'CEMENT_BOARD',   label: 'Fibre-cement board 3.5mm × 4\'×8\'',   qtyPerM2: 1.05, unit: 'sqm' }),
      freeze({ id: 'GI_FRAMING',     label: 'GI furring + main runner system',      qtyPerM2: 1.0,  unit: 'sqm' }),
      freeze({ id: 'SCREWS',         label: 'Cement board screws',                  qtyPerM2: 35,   unit: 'nos' }),
    ]),
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'PVC_PANEL',
    label: 'PVC panel ceiling (snap-lock)',
    perimeterBased: false,
    materials: Object.freeze([
      freeze({ id: 'PVC_PANEL',      label: 'PVC ceiling panel',                    qtyPerM2: 1.05, unit: 'sqm' }),
      freeze({ id: 'PVC_TRIM',       label: 'PVC L-trim (perimeter, reserved)',     qtyPerM2: 0.4,  unit: 'Rft' }),
      freeze({ id: 'GI_FRAMING',     label: 'Light GI framing',                     qtyPerM2: 1.0,  unit: 'sqm' }),
    ]),
    version: CATALOG_VERSION,
  }),
  freeze({
    id: 'GRID_T_BAR',
    label: 'Grid T-bar ceiling (commercial-grade)',
    perimeterBased: false,
    materials: Object.freeze([
      freeze({ id: 'MINERAL_TILE',   label: 'Mineral fibre tile 600×600',           qtyPerM2: 1.05, unit: 'sqm' }),
      freeze({ id: 'T_BAR_SYSTEM',   label: 'T-bar suspension grid',                qtyPerM2: 1.0,  unit: 'sqm' }),
    ]),
    version: CATALOG_VERSION,
  }),
])

export function getCeilingFinishSystem(id) {
  return CEILING_FINISH_REGISTRY.find(s => s.id === id) ?? null
}

export function listCeilingFinishSystems() {
  return CEILING_FINISH_REGISTRY
}

export const DEFAULT_CEILING_FINISH_SYSTEM_ID = 'NONE'
