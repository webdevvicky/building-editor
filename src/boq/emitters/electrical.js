// Per-discipline BOQ emitter — electrical.
//
// Canonical bridge between the electrical quantities pipeline
// (src/mep/quantities/electrical.js — owned by sibling engines subagent)
// and the BOQ line stream consumed by getBoqLines (../lines.js).
//
// Hard rules (mirror the plumbing emitter):
//   - Every rateKey traces back to a catalog (wireGauges, pvcConduit,
//     pointTypes). No magic strings.
//   - No store mutations.
//   - Floor scope is applied by getBoqLines BEFORE this emitter runs — the
//     `state` we receive is already the scoped wrapper (or the live state
//     when no scope is active). We read state.getElectricalQuantities()
//     so scoped collections flow transparently.
//   - When no electrical data exists, push() is never called.
//
// Quantity shape (from computeElectricalQuantities — sibling engine):
//   {
//     perSystem: {
//       LIGHTING: {
//         byGauge:   { '1.5sqmm': lengthFt, ... },
//         byConduit: { 20: lengthFt, ... },
//         circuits:  [{ id, mcbAmps, totalLoadW, pointCount }],
//         pointCount?: number,
//       },
//       POWER_5A | POWER_15A | AC | GEYSER | SOLAR | EV | SUBMAIN: { ... }
//     },
//     pointCounts:  { LIGHT: n, FAN: n, SOCKET_5A: n, ... },
//     mcbCounts:    { '6A': n, '10A': n, '16A': n, '25A': n, '32A': n, '40A': n, '63A': n },
//     dbCount:      number,
//     dbSchedule:   { dbId: { circuits: [...], totalLoadW } } | [...],
//     risers:       [{ id, kind, lengthFt, diameterMm? }],
//     totals:       { wireLengthFt, conduitLengthFt, pointCount }
//   }
//
// Line-id convention (all start `electrical_`):
//   electrical_wire_<system>_<gauge>            e.g. electrical_wire_lighting_1.5sqmm
//   electrical_conduit_<system>_<diameter>mm    e.g. electrical_conduit_lighting_20mm
//   electrical_mcb_<amps>A                      e.g. electrical_mcb_16A
//   electrical_point_<type>                     e.g. electrical_point_light
//   electrical_db                               distribution board count
//   electrical_riser_<kind>_<diam?>mm           e.g. electrical_riser_electrical_submain
//
// Meta payload: { discipline: 'ELECTRICAL', system?, subsystem?, gauge?,
//                 diameter?, pointType?, mcbAmps?, riserKind?,
//                 catalogVersion?, ifcType?, classification? }

import {
  getPointType,
  getWireGauge,
  getPvcConduitDiameter,
} from '../../mep/catalogs/index.js'

// Soft-import the engine. The sibling subagent builds
// src/mep/quantities/electrical.js — until it lands, we fall back to the
// scoped-state stub (returns EMPTY_DISCIPLINE_Q) or our own empty.
// Top-level await import keeps this module ESM-pure; the catch handles the
// engine-not-yet-built case without throwing at module-load time.
let computeElectricalQuantities = null
try {
  const mod = await import('../../mep/quantities/electrical.js')
  computeElectricalQuantities = mod?.computeElectricalQuantities ?? null
} catch { /* engine module not present yet — emitter still operates via state.getElectricalQuantities */ }

const EMPTY_Q = Object.freeze({
  perSystem: {},
  pointCounts: {},
  mcbCounts: {},
  dbCount: 0,
  dbSchedule: null,
  risers: [],
  totals: {},
})

// System code → BOQ category mapping. GEYSER lives in the power category
// with meta.subsystem='GEYSER' so users see all power-circuit BOQ in one
// place but procurement can still filter by subsystem.
const SYSTEM_CATEGORY = Object.freeze({
  LIGHTING:  'electrical_lighting',
  POWER_5A:  'electrical_power',
  POWER_15A: 'electrical_power',
  AC:        'electrical_hvac',
  GEYSER:    'electrical_power',
  SUBMAIN:   'electrical_submain',
  SOLAR_TIE: 'electrical_solar',
  SOLAR:     'electrical_solar',
  EV:        'electrical_ev',
})

const SYSTEM_LABELS = Object.freeze({
  LIGHTING:  'lighting',
  POWER_5A:  '5A power',
  POWER_15A: '15A power',
  AC:        'AC',
  GEYSER:    'geyser',
  SUBMAIN:   'submain',
  SOLAR_TIE: 'solar',
  SOLAR:     'solar',
  EV:        'EV',
})

const DB_RISER_KINDS = new Set(['ELECTRICAL_SUBMAIN', 'SOLAR_DC_RISER', 'SOLAR_AC_RISER'])

function categoryForSystem(system) {
  return SYSTEM_CATEGORY[system] ?? 'electrical_power'
}
function systemLabel(system) {
  return SYSTEM_LABELS[system] ?? String(system ?? '').toLowerCase().replace(/_/g, ' ')
}
function systemSlug(system) {
  return String(system ?? 'unknown').toLowerCase()
}

function parseGaugeSqmm(gaugeKey) {
  // Accepts '1.5sqmm', '4sqmm', or raw number/string.
  if (typeof gaugeKey === 'number') return gaugeKey
  const s = String(gaugeKey ?? '')
  const m = s.match(/([\d.]+)\s*sqmm/i) || s.match(/^([\d.]+)$/)
  return m ? parseFloat(m[1]) : null
}

function resolveQuantities(state) {
  // Path 1: scoped wrapper exposes the method — use it (honors floor scope).
  if (typeof state.getElectricalQuantities === 'function') {
    try {
      const q = state.getElectricalQuantities()
      if (q && (q.perSystem || q.pointCounts || q.risers || q.dbSchedule)) return q
    } catch { /* fall through */ }
  }
  // Path 2: try the pure function from the engine module (may not exist yet).
  if (computeElectricalQuantities) {
    try {
      const q = computeElectricalQuantities(state)
      if (q && (q.perSystem || q.pointCounts || q.risers || q.dbSchedule)) return q
    } catch { /* fall through */ }
  }
  return EMPTY_Q
}

export function emitElectricalLines(state, push, ctx = {}) {
  void ctx
  const q = resolveQuantities(state)
  if (!q) return

  // ── 1 + 2. Per-system wire (by gauge) + conduit (by diameter) ───────────
  const perSystem = q.perSystem ?? {}
  for (const [system, sub] of Object.entries(perSystem)) {
    if (!sub) continue
    const category = categoryForSystem(system)
    const slug     = systemSlug(system)
    const sysLabel = systemLabel(system)
    const subsystem = system === 'GEYSER' ? 'GEYSER' : undefined

    // Wire by gauge → one line per (system, gauge).
    const byGauge = sub.byGauge ?? {}
    for (const [gaugeKey, lenRaw] of Object.entries(byGauge)) {
      const lenFt = Number(lenRaw)
      if (!Number.isFinite(lenFt) || lenFt <= 0) continue
      const sqmm = parseGaugeSqmm(gaugeKey)
      const cat  = sqmm != null ? getWireGauge(sqmm) : null
      const rateKey = cat?.ratePerMRateKey ?? `electrical_wire_${sqmm ?? gaugeKey}sqmm`
      push({
        id:        `electrical_wire_${slug}_${sqmm ?? gaugeKey}sqmm`,
        category,
        label:     `Wire ${sqmm ?? gaugeKey}sqmm (${sysLabel})`,
        qty:       Math.round(lenFt * 100) / 100,
        unit:      'ft',
        rateKey,
        formulaId: `electrical_wire_${slug}_${sqmm ?? gaugeKey}sqmm`,
        meta: {
          discipline:     'ELECTRICAL',
          system,
          subsystem,
          gauge:          `${sqmm ?? gaugeKey}sqmm`,
          catalogVersion: cat?.version ?? null,
          classification: cat?.classificationCode ?? null,
          ifcMaterial:    cat?.ifcMaterial ?? null,
        },
      })
    }

    // Conduit by diameter → one line per (system, diameter).
    const byConduit = sub.byConduit ?? {}
    for (const [diamKey, lenRaw] of Object.entries(byConduit)) {
      const lenFt = Number(lenRaw)
      if (!Number.isFinite(lenFt) || lenFt <= 0) continue
      const diamMm = parseInt(diamKey, 10)
      const cat    = Number.isFinite(diamMm) ? getPvcConduitDiameter(diamMm) : null
      const rateKey = cat?.ratePerMRateKey ?? `electrical_conduit_pvc_${diamMm}mm`
      push({
        id:        `electrical_conduit_${slug}_${diamMm}mm`,
        category,
        label:     `PVC conduit ${diamMm}mm (${sysLabel})`,
        qty:       Math.round(lenFt * 100) / 100,
        unit:      'ft',
        rateKey,
        formulaId: `electrical_conduit_${slug}_${diamMm}mm`,
        meta: {
          discipline:     'ELECTRICAL',
          system,
          subsystem,
          diameter:       `${diamMm}mm`,
          catalogVersion: cat?.version ?? null,
          classification: cat?.classificationCode ?? null,
        },
      })
    }
  }

  // ── 3. MCBs by amp rating (counts) ──────────────────────────────────────
  // mcbCounts shape: { '6A': n, '10A': n, ... } — keys may include or omit
  // the 'A' suffix. Normalize on read.
  const mcbCounts = q.mcbCounts ?? {}
  for (const [ampKey, countRaw] of Object.entries(mcbCounts)) {
    const count = Number(countRaw)
    if (!Number.isFinite(count) || count <= 0) continue
    const m = String(ampKey).match(/^(\d+)/)
    const amps = m ? parseInt(m[1], 10) : null
    if (amps == null) continue
    push({
      id:        `electrical_mcb_${amps}A`,
      category:  'electrical_fittings',
      label:     `MCB ${amps}A`,
      qty:       Math.round(count),
      unit:      'nos',
      rateKey:   `electrical_mcb_${amps}A`,
      formulaId: `electrical_mcb_${amps}A`,
      meta: {
        discipline: 'ELECTRICAL',
        mcbAmps:    amps,
      },
    })
  }

  // ── 4. Point counts (LIGHT / FAN / SOCKET_5A / SOCKET_15A / ...) ────────
  const pointCounts = q.pointCounts ?? {}
  for (const [type, countRaw] of Object.entries(pointCounts)) {
    const count = Number(countRaw)
    if (!Number.isFinite(count) || count <= 0) continue
    const cat = getPointType(type)
    push({
      id:        `electrical_point_${type.toLowerCase()}`,
      category:  'electrical_points',
      label:     cat?.label ?? type,
      qty:       Math.round(count),
      unit:      'nos',
      rateKey:   `electrical_point_${type.toLowerCase()}`,
      formulaId: `electrical_point_${type.toLowerCase()}`,
      meta: {
        discipline:     'ELECTRICAL',
        pointType:      type,
        ifcType:        cat?.ifcType ?? null,
        classification: cat?.classificationCode ?? null,
        catalogVersion: cat?.version ?? null,
      },
    })
  }

  // ── 5. Distribution Boards (count + schedule attached as meta) ──────────
  const dbCount = Number(q.dbCount ?? 0)
  if (Number.isFinite(dbCount) && dbCount > 0) {
    push({
      id:        'electrical_db',
      category:  'electrical_db',
      label:     'Distribution Board',
      qty:       Math.round(dbCount),
      unit:      'nos',
      rateKey:   'electrical_db',
      formulaId: 'electrical_db',
      meta: {
        discipline: 'ELECTRICAL',
        dbSchedule: q.dbSchedule ?? null,
      },
    })
  }

  // ── 6. Risers (vertical submain / solar runs across floors) ─────────────
  for (const r of (q.risers ?? [])) {
    const lengthFt = Number(r?.lengthFt)
    if (!Number.isFinite(lengthFt) || lengthFt <= 0) continue
    const kind = r.kind ?? 'UNKNOWN'
    // Only electrical-flavoured risers are emitted here. Plumbing/HVAC/etc.
    // are owned by their own emitters.
    if (!DB_RISER_KINDS.has(kind)) continue
    const category = kind === 'SOLAR_DC_RISER' || kind === 'SOLAR_AC_RISER'
      ? 'electrical_solar'
      : 'electrical_submain'
    const diam = r.diameterMm ?? null
    push({
      id:        `electrical_riser_${kind.toLowerCase()}${diam ? `_${diam}mm` : ''}`,
      category,
      label:     `Riser — ${kind.replace(/_/g, ' ').toLowerCase()}${diam ? ` (${diam}mm)` : ''}`,
      qty:       Math.round(lengthFt * 100) / 100,
      unit:      'ft',
      rateKey:   `electrical_riser_${kind.toLowerCase()}`,
      formulaId: `electrical_riser_${kind.toLowerCase()}`,
      meta: {
        discipline: 'ELECTRICAL',
        riserKind:  kind,
        diameter:   diam != null ? `${diam}mm` : null,
      },
    })
  }
}

// Late-bind the pure function in case the engine module appears later.
// Tests / future engines can call setComputeElectricalQuantities(fn) to
// inject without restarting the process.
export function setComputeElectricalQuantities(fn) {
  computeElectricalQuantities = typeof fn === 'function' ? fn : null
}
