// Per-discipline BOQ emitter — Fire.
//
// Canonical bridge between the Fire quantities pipeline
// (src/mep/quantities/fire.js — owned by sibling engines subagent)
// and the BOQ line stream consumed by getBoqLines (../lines.js).
//
// Hard rules (mirror hvac.js / electrical.js / plumbing.js):
//   - Every rateKey traces back to a catalog (cableTypes, gi pipeStandards,
//     fireDevices). No magic strings.
//   - No store mutations.
//   - Floor scope is applied by getBoqLines BEFORE this emitter runs — the
//     `state` we receive is already the scoped wrapper (or the live state
//     when no scope is active). We read state.getFireQuantities() so
//     scoped collections flow transparently.
//   - When no fire data exists, push() is never called.
//
// Quantity shape (from computeFireQuantities — sibling engine):
//   {
//     perSystem: {
//       DETECTION: {
//         byCableType: { FIRE_RATED_2C: lengthFt, ... },
//         fittings:    { junctions: n, ... },
//       },
//       SUPPRESSION: {
//         byDiameter:  { '25': lengthFt, '40': lengthFt, ... }, // GI nominal mm
//         fittings:    { elbows: n, tees: n, ... },
//       },
//     },
//     deviceCounts: { SMOKE_DETECTOR: n, HEAT_DETECTOR: n, FIRE_ALARM_PANEL: n,
//                     SPRINKLER_HEAD: n, FIRE_EXTINGUISHER: n, ... },
//     risers:       [{ id, kind, lengthFt, diameterMm? }],   // FIRE_MAIN
//     totals:       { detectionLengthFt, suppressionLengthFt, deviceCount }
//   }
//
// Line-id convention (all start `fire_`):
//   fire_detection_<cableTypeLower>             e.g. fire_detection_fire_rated_2c
//   fire_suppression_<diameter>mm               e.g. fire_suppression_25mm
//   fire_detection_<fitting>                    e.g. fire_detection_junction
//   fire_suppression_<fitting>                  e.g. fire_suppression_elbow
//   fire_device_<type>                          e.g. fire_device_smoke_detector
//   fire_riser_<kind>_<diam?>mm                 e.g. fire_riser_fire_main_50mm
//
// Meta payload: { discipline: 'FIRE', system?, fitting?, cableType?,
//                 diameter?, deviceType?, riserKind?, catalogVersion?,
//                 ifcType?, classification? }

import {
  getFireDevice,
  getGiDiameter,
  getCableType,
} from '../../mep/catalogs/index.js'

// Soft-import the engine. The sibling subagent builds
// src/mep/quantities/fire.js — until it lands, we fall back to the
// scoped-state stub (returns EMPTY_DISCIPLINE_Q) or our own empty.
let computeFireQuantities = null
try {
  const mod = await import('../../mep/quantities/fire.js')
  computeFireQuantities = mod?.computeFireQuantities ?? null
} catch { /* engine module not present yet — emitter still operates via state.getFireQuantities */ }

const EMPTY_Q = Object.freeze({
  perSystem:    {},
  deviceCounts: {},
  risers:       [],
  totals:       {},
})

// Fire riser kinds — only these get emitted by the Fire emitter; other
// risers (plumbing / electrical / HVAC) are owned by their own emitters.
const FIRE_RISER_KINDS = new Set(['FIRE_MAIN'])

function titleCase(s) {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ').toLowerCase()
}

function resolveQuantities(state) {
  // Path 1: scoped wrapper exposes the method — use it (honors floor scope).
  if (typeof state.getFireQuantities === 'function') {
    try {
      const q = state.getFireQuantities()
      if (q && (q.perSystem || q.deviceCounts || q.risers)) return q
    } catch { /* fall through */ }
  }
  // Path 2: try the pure function from the engine module (may not exist yet).
  if (computeFireQuantities) {
    try {
      const q = computeFireQuantities(state)
      if (q && (q.perSystem || q.deviceCounts || q.risers)) return q
    } catch { /* fall through */ }
  }
  return EMPTY_Q
}

export function emitFireLines(state, push, ctx = {}) {
  void ctx
  const q = resolveQuantities(state)
  if (!q) return

  const perSystem = q.perSystem ?? {}

  // ── 1. Detection cable by cable type ────────────────────────────────────
  const detection = perSystem.DETECTION ?? perSystem.detection ?? null
  if (detection) {
    const byCableType = detection.byCableType ?? {}
    for (const [cableId, lenRaw] of Object.entries(byCableType)) {
      const lenFt = Number(lenRaw)
      if (!Number.isFinite(lenFt) || lenFt <= 0) continue
      const cat     = getCableType(cableId)
      const slug    = String(cableId).toLowerCase()
      const rateKey = cat?.ratePerMRateKey ?? `fire_detection_${slug}`
      push({
        id:        `fire_detection_${slug}`,
        category:  'fire_detection',
        label:     `${cat?.label ?? cableId} (fire detection)`,
        qty:       Math.round(lenFt * 100) / 100,
        unit:      'ft',
        rateKey,
        formulaId: `fire_detection_${slug}`,
        meta: {
          discipline:     'FIRE',
          system:         'DETECTION',
          cableType:      cableId,
          catalogVersion: cat?.version ?? null,
          classification: cat?.classificationCode ?? null,
          ifcMaterial:    cat?.ifcMaterial ?? null,
        },
      })
    }

    const fittings = detection.fittings ?? {}
    for (const [fitting, countRaw] of Object.entries(fittings)) {
      const count = Number(countRaw)
      if (!Number.isFinite(count) || count <= 0) continue
      push({
        id:        `fire_detection_${fitting}`,
        category:  'fire_detection',
        label:     `${titleCase(fitting)} (fire detection)`,
        qty:       Math.round(count),
        unit:      'nos',
        rateKey:   `fire_detection_${fitting}`,
        formulaId: `fire_detection_${fitting}`,
        meta: {
          discipline: 'FIRE',
          system:     'DETECTION',
          fitting,
        },
      })
    }
  }

  // ── 2. Suppression pipe by diameter (GI) + fittings ─────────────────────
  const suppression = perSystem.SUPPRESSION ?? perSystem.suppression ?? null
  if (suppression) {
    const byDiameter = suppression.byDiameter ?? {}
    for (const [diamKey, lenRaw] of Object.entries(byDiameter)) {
      const lenFt = Number(lenRaw)
      if (!Number.isFinite(lenFt) || lenFt <= 0) continue
      const diamMm  = parseInt(diamKey, 10)
      const cat     = Number.isFinite(diamMm) ? getGiDiameter(diamMm) : null
      const rateKey = cat?.ratePerMRateKey ?? `fire_suppression_gi_${diamMm}mm`
      push({
        id:        `fire_suppression_${diamMm}mm`,
        category:  'fire_suppression',
        label:     `GI sprinkler pipe ${diamMm}mm`,
        qty:       Math.round(lenFt * 100) / 100,
        unit:      'ft',
        rateKey,
        formulaId: `fire_suppression_${diamMm}mm`,
        meta: {
          discipline:     'FIRE',
          system:         'SUPPRESSION',
          diameter:       `${diamMm}mm`,
          catalogVersion: cat?.version ?? null,
          classification: cat?.classificationCode ?? null,
          ifcMaterial:    cat?.ifcMaterial ?? null,
        },
      })
    }

    const fittings = suppression.fittings ?? {}
    for (const [fitting, countRaw] of Object.entries(fittings)) {
      const count = Number(countRaw)
      if (!Number.isFinite(count) || count <= 0) continue
      push({
        id:        `fire_suppression_${fitting}`,
        category:  'fire_suppression',
        label:     `${titleCase(fitting)} (suppression)`,
        qty:       Math.round(count),
        unit:      'nos',
        rateKey:   `fire_suppression_${fitting}`,
        formulaId: `fire_suppression_${fitting}`,
        meta: {
          discipline: 'FIRE',
          system:     'SUPPRESSION',
          fitting,
        },
      })
    }
  }

  // ── 3. Device counts (SMOKE_DETECTOR / HEAT_DETECTOR / SPRINKLER_HEAD / ...) ─
  const deviceCounts = q.deviceCounts ?? {}
  for (const [type, countRaw] of Object.entries(deviceCounts)) {
    const count = Number(countRaw)
    if (!Number.isFinite(count) || count <= 0) continue
    const cat = getFireDevice(type)
    push({
      id:        `fire_device_${type.toLowerCase()}`,
      category:  'fire_equipment',
      label:     cat?.label ?? type,
      qty:       Math.round(count),
      unit:      'nos',
      rateKey:   `fire_device_${type.toLowerCase()}`,
      formulaId: `fire_device_${type.toLowerCase()}`,
      meta: {
        discipline:     'FIRE',
        deviceType:     type,
        ifcType:        cat?.ifcType ?? null,
        classification: cat?.classificationCode ?? null,
        catalogVersion: cat?.version ?? null,
      },
    })
  }

  // ── 4. Risers — FIRE_MAIN across floors (under fire_suppression) ────────
  for (const r of (q.risers ?? [])) {
    const lengthFt = Number(r?.lengthFt)
    if (!Number.isFinite(lengthFt) || lengthFt <= 0) continue
    const kind = r.kind ?? 'UNKNOWN'
    if (!FIRE_RISER_KINDS.has(kind)) continue
    const diam = r.diameterMm ?? null
    push({
      id:        `fire_riser_${kind.toLowerCase()}${diam ? `_${diam}mm` : ''}`,
      category:  'fire_suppression',
      label:     `Riser — ${kind.replace(/_/g, ' ').toLowerCase()}${diam ? ` (${diam}mm)` : ''}`,
      qty:       Math.round(lengthFt * 100) / 100,
      unit:      'ft',
      rateKey:   `fire_riser_${kind.toLowerCase()}`,
      formulaId: `fire_riser_${kind.toLowerCase()}`,
      meta: {
        discipline: 'FIRE',
        riserKind:  kind,
        diameter:   diam != null ? `${diam}mm` : null,
      },
    })
  }
}

// Late-bind the pure function in case the engine module appears later.
// Tests / future engines can call setComputeFireQuantities(fn) to inject
// without restarting the process.
export function setComputeFireQuantities(fn) {
  computeFireQuantities = typeof fn === 'function' ? fn : null
}
