// Per-discipline BOQ emitter — HVAC.
//
// Canonical bridge between the HVAC quantities pipeline
// (src/mep/quantities/hvac.js — owned by sibling engines subagent)
// and the BOQ line stream consumed by getBoqLines (../lines.js).
//
// Hard rules (mirror electrical.js / plumbing.js):
//   - Every rateKey traces back to a catalog (copper refrigerant pipe,
//     uPVC condensate pipe, hvacUnits). No magic strings.
//   - No store mutations.
//   - Floor scope is applied by getBoqLines BEFORE this emitter runs — the
//     `state` we receive is already the scoped wrapper (or the live state
//     when no scope is active). We read state.getHvacQuantities() so
//     scoped collections flow transparently.
//   - When no HVAC data exists, push() is never called.
//
// Quantity shape (from computeHvacQuantities — sibling engine):
//   {
//     perSystem: {
//       REFRIGERANT: {
//         byPipeOd:   { '3/8': lengthFt, '1/4': lengthFt, ... },
//         fittings:   { elbows: n, tees: n, reducers: n, ... },
//       },
//       CONDENSATE: {
//         byDiameter: { '25': lengthFt, '32': lengthFt, ... },
//         fittings:   { elbows: n, tees: n, reducers: n, ... },
//       },
//     },
//     unitCounts:  { AC_INDOOR_UNIT: n, AC_OUTDOOR_UNIT: n, EXHAUST_FAN_HVAC: n, ... },
//     risers:      [{ id, kind, lengthFt, diameterMm? }],   // HVAC_REFRIGERANT | HVAC_CONDENSATE
//     totals:      { refrigerantLengthFt, condensateLengthFt, unitCount }
//   }
//
// Line-id convention (all start `hvac_`):
//   hvac_refrigerant_<odSlug>             e.g. hvac_refrigerant_3_8in
//   hvac_condensate_<diameter>mm          e.g. hvac_condensate_25mm
//   hvac_refrigerant_<fitting>            e.g. hvac_refrigerant_elbow
//   hvac_condensate_<fitting>             e.g. hvac_condensate_elbow
//   hvac_unit_<type>                      e.g. hvac_unit_ac_indoor_unit
//   hvac_riser_<kind>_<diam?>mm           e.g. hvac_riser_hvac_refrigerant
//
// Meta payload: { discipline: 'HVAC', system?, fitting?, pipeOd?,
//                 diameter?, unitType?, riserKind?, catalogVersion?,
//                 ifcType?, classification? }

import {
  getHvacUnit,
  getCopperDiameter,
  getUpvcDiameter,
} from '../../mep/catalogs/index.js'

// Soft-import the engine. The sibling subagent builds
// src/mep/quantities/hvac.js — until it lands, we fall back to the
// scoped-state stub (returns EMPTY_DISCIPLINE_Q) or our own empty.
let computeHvacQuantities = null
try {
  const mod = await import('../../mep/quantities/hvac.js')
  computeHvacQuantities = mod?.computeHvacQuantities ?? null
} catch { /* engine module not present yet — emitter still operates via state.getHvacQuantities */ }

const EMPTY_Q = Object.freeze({
  perSystem: {},
  unitCounts: {},
  risers: [],
  totals: {},
})

// HVAC riser kinds — only these get emitted by the HVAC emitter; other
// risers (plumbing / electrical / etc.) are owned by their own emitters.
const HVAC_RISER_KINDS = new Set(['HVAC_REFRIGERANT', 'HVAC_CONDENSATE'])

// Slugify a pipe OD like '3/8' → '3_8' for use in stable rateKeys / ids.
function odSlug(odIn) {
  return String(odIn ?? '').replace(/\//g, '_').replace(/\s+/g, '')
}

function titleCase(s) {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ').toLowerCase()
}

function resolveQuantities(state) {
  // Path 1: scoped wrapper exposes the method — use it (honors floor scope).
  if (typeof state.getHvacQuantities === 'function') {
    try {
      const q = state.getHvacQuantities()
      if (q && (q.perSystem || q.unitCounts || q.risers)) return q
    } catch { /* fall through */ }
  }
  // Path 2: try the pure function from the engine module (may not exist yet).
  if (computeHvacQuantities) {
    try {
      const q = computeHvacQuantities(state)
      if (q && (q.perSystem || q.unitCounts || q.risers)) return q
    } catch { /* fall through */ }
  }
  return EMPTY_Q
}

export function emitHvacLines(state, push, ctx = {}) {
  void ctx
  const q = resolveQuantities(state)
  if (!q) return

  const perSystem = q.perSystem ?? {}

  // ── 1. Refrigerant pipe by OD (copper) + fittings ───────────────────────
  const refrigerant = perSystem.REFRIGERANT ?? perSystem.refrigerant ?? null
  if (refrigerant) {
    const byOd = refrigerant.byPipeOd ?? refrigerant.byDiameter ?? {}
    for (const [odKey, lenRaw] of Object.entries(byOd)) {
      const lenFt = Number(lenRaw)
      if (!Number.isFinite(lenFt) || lenFt <= 0) continue
      const cat = getCopperDiameter(odKey)
      const slug = odSlug(odKey)
      const rateKey = cat?.ratePerMRateKey ?? `hvac_copper_${slug}in`
      push({
        id:        `hvac_refrigerant_${slug}in`,
        category:  'hvac_refrigerant',
        label:     `Copper refrigerant ${odKey}" OD`,
        qty:       Math.round(lenFt * 100) / 100,
        unit:      'ft',
        rateKey,
        formulaId: `hvac_refrigerant_${slug}in`,
        meta: {
          discipline:     'HVAC',
          system:         'REFRIGERANT',
          pipeOd:         odKey,
          catalogVersion: cat?.version ?? null,
          classification: cat?.classificationCode ?? null,
          ifcMaterial:    cat?.ifcMaterial ?? null,
        },
      })
    }

    const fittings = refrigerant.fittings ?? {}
    for (const [fitting, countRaw] of Object.entries(fittings)) {
      const count = Number(countRaw)
      if (!Number.isFinite(count) || count <= 0) continue
      push({
        id:        `hvac_refrigerant_${fitting}`,
        category:  'hvac_refrigerant',
        label:     `${titleCase(fitting)} (refrigerant)`,
        qty:       Math.round(count),
        unit:      'nos',
        rateKey:   `hvac_refrigerant_${fitting}`,
        formulaId: `hvac_refrigerant_${fitting}`,
        meta: {
          discipline: 'HVAC',
          system:     'REFRIGERANT',
          fitting,
        },
      })
    }
  }

  // ── 2. Condensate pipe by diameter (UPVC) + fittings ────────────────────
  const condensate = perSystem.CONDENSATE ?? perSystem.condensate ?? null
  if (condensate) {
    const byDiameter = condensate.byDiameter ?? {}
    for (const [diamKey, lenRaw] of Object.entries(byDiameter)) {
      const lenFt = Number(lenRaw)
      if (!Number.isFinite(lenFt) || lenFt <= 0) continue
      const diamMm = parseInt(diamKey, 10)
      const cat    = Number.isFinite(diamMm) ? getUpvcDiameter(diamMm) : null
      const rateKey = cat?.ratePerMRateKey ?? `hvac_condensate_upvc_${diamMm}mm`
      push({
        id:        `hvac_condensate_${diamMm}mm`,
        category:  'hvac_condensate',
        label:     `UPVC condensate ${diamMm}mm`,
        qty:       Math.round(lenFt * 100) / 100,
        unit:      'ft',
        rateKey,
        formulaId: `hvac_condensate_${diamMm}mm`,
        meta: {
          discipline:     'HVAC',
          system:         'CONDENSATE',
          diameter:       `${diamMm}mm`,
          catalogVersion: cat?.version ?? null,
          classification: cat?.classificationCode ?? null,
          ifcMaterial:    cat?.ifcMaterial ?? null,
        },
      })
    }

    const fittings = condensate.fittings ?? {}
    for (const [fitting, countRaw] of Object.entries(fittings)) {
      const count = Number(countRaw)
      if (!Number.isFinite(count) || count <= 0) continue
      push({
        id:        `hvac_condensate_${fitting}`,
        category:  'hvac_condensate',
        label:     `${titleCase(fitting)} (condensate)`,
        qty:       Math.round(count),
        unit:      'nos',
        rateKey:   `hvac_condensate_${fitting}`,
        formulaId: `hvac_condensate_${fitting}`,
        meta: {
          discipline: 'HVAC',
          system:     'CONDENSATE',
          fitting,
        },
      })
    }
  }

  // ── 3. Unit counts (AC_INDOOR_UNIT / AC_OUTDOOR_UNIT / EXHAUST_FAN_HVAC / ...) ─
  const unitCounts = q.unitCounts ?? {}
  for (const [type, countRaw] of Object.entries(unitCounts)) {
    const count = Number(countRaw)
    if (!Number.isFinite(count) || count <= 0) continue
    const cat = getHvacUnit(type)
    push({
      id:        `hvac_unit_${type.toLowerCase()}`,
      category:  'hvac_units',
      label:     cat?.label ?? type,
      qty:       Math.round(count),
      unit:      'nos',
      rateKey:   `hvac_unit_${type.toLowerCase()}`,
      formulaId: `hvac_unit_${type.toLowerCase()}`,
      meta: {
        discipline:     'HVAC',
        unitType:       type,
        ifcType:        cat?.ifcType ?? null,
        classification: cat?.classificationCode ?? null,
        catalogVersion: cat?.version ?? null,
      },
    })
  }

  // ── 4. Risers — HVAC refrigerant + condensate risers across floors ──────
  for (const r of (q.risers ?? [])) {
    const lengthFt = Number(r?.lengthFt)
    if (!Number.isFinite(lengthFt) || lengthFt <= 0) continue
    const kind = r.kind ?? 'UNKNOWN'
    if (!HVAC_RISER_KINDS.has(kind)) continue
    const category = kind === 'HVAC_CONDENSATE' ? 'hvac_condensate' : 'hvac_refrigerant'
    const diam = r.diameterMm ?? null
    push({
      id:        `hvac_riser_${kind.toLowerCase()}${diam ? `_${diam}mm` : ''}`,
      category,
      label:     `Riser — ${kind.replace(/_/g, ' ').toLowerCase()}${diam ? ` (${diam}mm)` : ''}`,
      qty:       Math.round(lengthFt * 100) / 100,
      unit:      'ft',
      rateKey:   `hvac_riser_${kind.toLowerCase()}`,
      formulaId: `hvac_riser_${kind.toLowerCase()}`,
      meta: {
        discipline: 'HVAC',
        riserKind:  kind,
        diameter:   diam != null ? `${diam}mm` : null,
      },
    })
  }
}

// Late-bind the pure function in case the engine module appears later.
// Tests / future engines can call setComputeHvacQuantities(fn) to inject
// without restarting the process.
export function setComputeHvacQuantities(fn) {
  computeHvacQuantities = typeof fn === 'function' ? fn : null
}
