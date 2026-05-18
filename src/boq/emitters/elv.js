// Per-discipline BOQ emitter — ELV (Extra-Low Voltage).
//
// Canonical bridge between the ELV quantities pipeline
// (src/mep/quantities/elv.js — owned by sibling engines subagent)
// and the BOQ line stream consumed by getBoqLines (../lines.js).
//
// Sub-systems (ELV is unique in that it splits into four distinct
// procurement buckets even though they share cable types):
//   - CCTV      → category 'elv_cctv'      (CCTV cameras + coax)
//   - DATA      → category 'elv_data'      (LAN points, Wi-Fi, racks, CAT6)
//   - SECURITY  → category 'elv_security'  (intrusion alarms, VDP, intercom)
//   - AV        → category 'elv_av'        (speakers, TV outlets, AV)
//
// Hard rules (mirror fire.js):
//   - Every rateKey traces back to a catalog (cableTypes, elvDevices).
//     No magic strings.
//   - No store mutations.
//   - Floor scope is applied by getBoqLines BEFORE this emitter runs.
//   - When no ELV data exists, push() is never called.
//
// Quantity shape (from computeElvQuantities — sibling engine):
//   {
//     perSubSystem: {
//       CCTV:     { byCableType: { CCTV_COAX_RG6: lengthFt, ... },
//                   fittings:    { junctions: n, ... } },
//       DATA:     { byCableType: { CAT6: lengthFt, ... },
//                   fittings:    { junctions: n, ... } },
//       SECURITY: { byCableType: { FIRE_RATED_2C: lengthFt, ... },
//                   fittings:    { junctions: n, ... } },
//       AV:       { byCableType: { SPEAKER_CABLE: lengthFt, ... },
//                   fittings:    { junctions: n, ... } },
//     },
//     deviceCounts: { CCTV_CAMERA: n, DATA_POINT: n, VIDEO_DOOR_PHONE: n,
//                     INTERCOM: n, TV_POINT_ELV: n, WIFI_AP: n,
//                     ALARM_SENSOR: n, ELV_RACK: n, ... },
//     risers:       [{ id, kind, lengthFt, diameterMm? }],   // ELV_TRUNKING
//     totals:       { cableLengthFt, deviceCount }
//   }
//
// Line-id convention (all start `elv_`):
//   elv_<subsys>_<cableTypeLower>            e.g. elv_data_cat6
//   elv_<subsys>_<fitting>                   e.g. elv_data_junction
//   elv_device_<type>                        e.g. elv_device_cctv_camera
//   elv_riser_<kind>_<diam?>mm               e.g. elv_riser_elv_trunking_50mm
//
// Meta payload: { discipline: 'ELV', subSystem?, fitting?, cableType?,
//                 deviceType?, riserKind?, catalogVersion?, ifcType?,
//                 classification?, lineType? }

import {
  getElvDevice,
  getCableType,
} from '../../mep/catalogs/index.js'

// Soft-import the engine. The sibling subagent builds
// src/mep/quantities/elv.js — until it lands, we fall back to the
// scoped-state stub (state.getElvQuantities) or empty.
let computeElvQuantities = null
try {
  const mod = await import('../../mep/quantities/elv.js')
  computeElvQuantities = mod?.computeElvQuantities ?? null
} catch { /* engine module not present yet — emitter still operates via state.getElvQuantities */ }

const EMPTY_Q = Object.freeze({
  perSubSystem: {},
  deviceCounts: {},
  risers:       [],
  totals:       {},
})

// ELV riser kinds — only these get emitted by the ELV emitter. Other
// risers (plumbing / electrical / fire / HVAC) are owned by their own
// emitters. ELV_TRUNKING is the canonical low-voltage cable tray.
const ELV_RISER_KINDS = new Set(['ELV_TRUNKING'])

// Sub-system → BOQ category mapping. Each sub-system gets its own
// category so procurement can split bids cleanly.
const SUBSYSTEM_CATEGORIES = Object.freeze({
  CCTV:     'elv_cctv',
  DATA:     'elv_data',
  SECURITY: 'elv_security',
  AV:       'elv_av',
})

// Device → sub-system routing. Used to attribute device lines to the
// correct sub-system category. Devices not in this map fall back to DATA
// (the most common ELV bucket).
const DEVICE_SUBSYSTEM = Object.freeze({
  CCTV_CAMERA:      'CCTV',
  DATA_POINT:       'DATA',
  WIFI_AP:          'DATA',
  ELV_RACK:         'DATA',
  VIDEO_DOOR_PHONE: 'SECURITY',
  INTERCOM:         'SECURITY',
  ALARM_SENSOR:     'SECURITY',
  TV_POINT_ELV:     'AV',
})

function titleCase(s) {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ').toLowerCase()
}

function resolveQuantities(state) {
  // Path 1: scoped wrapper exposes the method — use it (honors floor scope).
  if (typeof state.getElvQuantities === 'function') {
    try {
      const q = state.getElvQuantities()
      if (q && (q.perSubSystem || q.deviceCounts || q.risers)) return q
    } catch { /* fall through */ }
  }
  // Path 2: try the pure function from the engine module (may not exist yet).
  if (computeElvQuantities) {
    try {
      const q = computeElvQuantities(state)
      if (q && (q.perSubSystem || q.deviceCounts || q.risers)) return q
    } catch { /* fall through */ }
  }
  return EMPTY_Q
}

export function emitElvLines(state, push, ctx = {}) {
  void ctx
  const q = resolveQuantities(state)
  if (!q) return

  const perSubSystem = q.perSubSystem ?? {}

  // ── 1. Cable per sub-system, by cable type ──────────────────────────────
  for (const [subSys, category] of Object.entries(SUBSYSTEM_CATEGORIES)) {
    const block = perSubSystem[subSys] ?? perSubSystem[subSys.toLowerCase()] ?? null
    if (!block) continue

    const byCableType = block.byCableType ?? {}
    for (const [cableId, lenRaw] of Object.entries(byCableType)) {
      const lenFt = Number(lenRaw)
      if (!Number.isFinite(lenFt) || lenFt <= 0) continue
      const cat     = getCableType(cableId)
      const slug    = String(cableId).toLowerCase()
      const subSlug = subSys.toLowerCase()
      const rateKey = cat?.ratePerMRateKey ?? `elv_${subSlug}_${slug}`
      push({
        id:        `elv_${subSlug}_${slug}`,
        category,
        label:     `${cat?.label ?? cableId} (ELV ${subSys.toLowerCase()})`,
        qty:       Math.round(lenFt * 100) / 100,
        unit:      'ft',
        rateKey,
        formulaId: `elv_${subSlug}_${slug}`,
        meta: {
          discipline:     'ELV',
          subSystem:      subSys,
          cableType:      cableId,
          lineType:       'CABLE',
          catalogVersion: cat?.version ?? null,
          classification: cat?.classificationCode ?? null,
          ifcMaterial:    cat?.ifcMaterial ?? null,
        },
      })
    }

    const fittings = block.fittings ?? {}
    for (const [fitting, countRaw] of Object.entries(fittings)) {
      const count = Number(countRaw)
      if (!Number.isFinite(count) || count <= 0) continue
      const subSlug = subSys.toLowerCase()
      push({
        id:        `elv_${subSlug}_${fitting}`,
        category,
        label:     `${titleCase(fitting)} (ELV ${subSys.toLowerCase()})`,
        qty:       Math.round(count),
        unit:      'nos',
        rateKey:   `elv_${subSlug}_${fitting}`,
        formulaId: `elv_${subSlug}_${fitting}`,
        meta: {
          discipline: 'ELV',
          subSystem:  subSys,
          fitting,
          lineType:   'FITTING',
        },
      })
    }
  }

  // ── 2. Device counts (CCTV_CAMERA / DATA_POINT / WIFI_AP / ...) ─────────
  // Devices route to their owning sub-system category so users see them
  // grouped where they procure them.
  const deviceCounts = q.deviceCounts ?? {}
  for (const [type, countRaw] of Object.entries(deviceCounts)) {
    const count = Number(countRaw)
    if (!Number.isFinite(count) || count <= 0) continue
    const cat      = getElvDevice(type)
    const subSys   = DEVICE_SUBSYSTEM[type] ?? 'DATA'
    const category = SUBSYSTEM_CATEGORIES[subSys] ?? 'elv_data'
    push({
      id:        `elv_device_${type.toLowerCase()}`,
      category,
      label:     cat?.label ?? type,
      qty:       Math.round(count),
      unit:      'nos',
      rateKey:   `elv_device_${type.toLowerCase()}`,
      formulaId: `elv_device_${type.toLowerCase()}`,
      meta: {
        discipline:     'ELV',
        subSystem:      subSys,
        deviceType:     type,
        lineType:       'DEVICE',
        ifcType:        cat?.ifcType ?? null,
        classification: cat?.classificationCode ?? null,
        catalogVersion: cat?.version ?? null,
      },
    })
  }

  // ── 3. Risers — ELV_TRUNKING across floors (attributed to DATA) ─────────
  // The DATA bucket is the most common parent for shared ELV trunking;
  // when a project genuinely needs per-sub-system risers, the engine can
  // emit multiple riser entries — this emitter consults riser.subSystem
  // when present.
  for (const r of (q.risers ?? [])) {
    const lengthFt = Number(r?.lengthFt)
    if (!Number.isFinite(lengthFt) || lengthFt <= 0) continue
    const kind = r.kind ?? 'UNKNOWN'
    if (!ELV_RISER_KINDS.has(kind)) continue
    const diam = r.diameterMm ?? null
    const subSys   = r.subSystem ?? 'DATA'
    const category = SUBSYSTEM_CATEGORIES[subSys] ?? 'elv_data'
    push({
      id:        `elv_riser_${kind.toLowerCase()}${diam ? `_${diam}mm` : ''}`,
      category,
      label:     `Riser — ${kind.replace(/_/g, ' ').toLowerCase()}${diam ? ` (${diam}mm)` : ''}`,
      qty:       Math.round(lengthFt * 100) / 100,
      unit:      'ft',
      rateKey:   `elv_riser_${kind.toLowerCase()}`,
      formulaId: `elv_riser_${kind.toLowerCase()}`,
      meta: {
        discipline: 'ELV',
        subSystem:  subSys,
        riserKind:  kind,
        lineType:   'RISER',
        diameter:   diam != null ? `${diam}mm` : null,
      },
    })
  }
}

// Late-bind the pure function in case the engine module appears later.
export function setComputeElvQuantities(fn) {
  computeElvQuantities = typeof fn === 'function' ? fn : null
}
