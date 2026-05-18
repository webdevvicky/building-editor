// Per-discipline BOQ emitter — plumbing.
//
// This file is the canonical bridge between the plumbing quantities pipeline
// (src/mep/quantities/plumbing.js) and the BOQ line stream consumed by
// getBoqLines (../lines.js).
//
// Hard rules:
//   - Every rateKey traces back to a catalog (cpvc, upvc, fixtureTypes).
//     No magic strings.
//   - No store mutations.
//   - Floor scope is applied by getBoqLines BEFORE this emitter runs — the
//     `state` we receive is already the scoped wrapper (or the live state
//     when no scope is active). We read state.getPlumbingQuantities() so
//     scoped collections flow transparently.
//   - When no plumbing data exists, push() is never called.
//
// Line-id convention (all start `plumbing_`):
//   plumbing_supply_<system>_<diam>mm   e.g. plumbing_supply_cold_15mm
//   plumbing_drainage_<system>_<diam>mm e.g. plumbing_drainage_soil_110mm
//   plumbing_<system>_<fitting>         e.g. plumbing_cold_supply_elbow
//   plumbing_fixture_<type>             e.g. plumbing_fixture_wc
//   plumbing_riser_<kind>_<diam>mm      e.g. plumbing_riser_soil_stack_110mm
//
// Meta payload: { discipline, system?, fitting?, diameter?, fixtureType?,
//                 riserKind?, catalogVersion?, ifcType? }

import {
  getCpvcDiameter,
  getUpvcDiameter,
  getFixtureType,
} from '../../mep/catalogs/index.js'
import { computePlumbingQuantities } from '../../mep/quantities/plumbing.js'

// Quantity resolution path:
//   1. If scoped state (scope.js wrapper) supplies getPlumbingQuantities,
//      use it — that respects floor scope.
//   2. Otherwise call computePlumbingQuantities(state) directly with the
//      live store. Pure function, auto-scopes via method dispatch.

const EMPTY_Q = Object.freeze({ perSystem: {}, fixtureCounts: {}, risers: [], totals: {} })

function resolveQuantities(state) {
  if (typeof state.getPlumbingQuantities === 'function') {
    try {
      const q = state.getPlumbingQuantities()
      if (q && (q.perSystem || q.fixtureCounts || q.risers)) return q
    } catch { /* fall through */ }
  }
  try {
    const q = computePlumbingQuantities(state)
    if (q && (q.perSystem || q.fixtureCounts || q.risers)) return q
  } catch { /* fall through */ }
  return EMPTY_Q
}

// Drainage systems → BOQ category 'plumbing_drainage'; everything else
// (cold/hot supply, recirc) → 'plumbing_supply'.
const DRAINAGE_SYSTEMS = new Set(['SOIL_DRAIN', 'WASTE_DRAIN', 'RAINWATER', 'VENT'])
function categoryForSystem(system) {
  return DRAINAGE_SYSTEMS.has(system) ? 'plumbing_drainage' : 'plumbing_supply'
}

// Catalog material per system: drainage = UPVC, supply = CPVC. Used to pull
// rateKey + label + catalogVersion from the canonical catalog.
function lookupDiameterCatalog(system, diameterMm) {
  return DRAINAGE_SYSTEMS.has(system)
    ? getUpvcDiameter(diameterMm)
    : getCpvcDiameter(diameterMm)
}

function pipeLabel(system, diameterMm) {
  const material = DRAINAGE_SYSTEMS.has(system) ? 'UPVC' : 'CPVC'
  const role = systemRoleLabel(system)
  return `${material} pipe ${diameterMm}mm (${role})`
}

function systemRoleLabel(system) {
  switch (system) {
    case 'COLD_SUPPLY':   return 'cold'
    case 'HOT_SUPPLY':    return 'hot'
    case 'HOT_RECIRC':    return 'recirc'
    case 'SOIL_DRAIN':    return 'soil'
    case 'WASTE_DRAIN':   return 'waste'
    case 'RAINWATER':     return 'rainwater'
    case 'VENT':          return 'vent'
    default: return system.toLowerCase().replace(/_/g, '-')
  }
}

function titleCase(s) {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ').toLowerCase()
}

export function emitPlumbingLines(state, push, ctx = {}) {
  void ctx
  const q = resolveQuantities(state)
  if (!q || !q.perSystem) return

  // ── 1. Pipe lengths grouped by (system, diameter) ───────────────────────
  for (const [system, sub] of Object.entries(q.perSystem)) {
    const byDiameter = sub?.byDiameter ?? {}
    const category = categoryForSystem(system)
    const role = systemRoleLabel(system)
    const segCategory = category === 'plumbing_drainage' ? 'drainage' : 'supply'

    for (const [diamStr, lengthFt] of Object.entries(byDiameter)) {
      const lengthNum = Number(lengthFt)
      if (!Number.isFinite(lengthNum) || lengthNum <= 0) continue
      const diamMm = parseInt(diamStr, 10)
      const cat = lookupDiameterCatalog(system, diamMm)
      const rateKey = cat?.ratePerMRateKey
        ?? (category === 'plumbing_drainage'
            ? `plumbing_upvc_${diamMm}mm`
            : `plumbing_cpvc_${diamMm}mm`)
      push({
        id:        `plumbing_${segCategory}_${role}_${diamMm}mm`,
        category,
        label:     pipeLabel(system, diamMm),
        qty:       Math.round(lengthNum * 100) / 100,
        unit:      'ft',
        rateKey,
        formulaId: `plumbing_${segCategory}_${role}_${diamMm}mm`,
        meta: {
          discipline:     'PLUMBING',
          system,
          diameter:       `${diamMm}mm`,
          catalogVersion: cat?.version ?? null,
          classification: cat?.classificationCode ?? null,
        },
      })
    }

    // ── 2. Fittings per system (elbow, tee, reducer, coupling, …) ────────
    const fittings = sub?.fittings ?? {}
    for (const [fitting, countRaw] of Object.entries(fittings)) {
      const count = Number(countRaw)
      if (!Number.isFinite(count) || count <= 0) continue
      push({
        id:        `plumbing_${system.toLowerCase()}_${fitting}`,
        category,
        label:     `${titleCase(fitting)} (${role})`,
        qty:       Math.round(count),
        unit:      'nos',
        rateKey:   `plumbing_${system.toLowerCase()}_${fitting}`,
        formulaId: `plumbing_${system.toLowerCase()}_${fitting}`,
        meta: {
          discipline: 'PLUMBING',
          system,
          fitting,
        },
      })
    }
  }

  // ── 3. Fixtures (WC, wash basin, kitchen sink, floor trap, …) ───────────
  const fixtureCounts = q.fixtureCounts ?? {}
  for (const [type, countRaw] of Object.entries(fixtureCounts)) {
    const count = Number(countRaw)
    if (!Number.isFinite(count) || count <= 0) continue
    const cat = getFixtureType(type)
    push({
      id:        `plumbing_fixture_${type.toLowerCase()}`,
      category:  'plumbing_fixtures',
      label:     cat?.label ?? type,
      qty:       Math.round(count),
      unit:      'nos',
      rateKey:   `plumbing_fixture_${type.toLowerCase()}`,
      formulaId: `plumbing_fixture_${type.toLowerCase()}`,
      meta: {
        discipline:     'PLUMBING',
        fixtureType:    type,
        ifcType:        cat?.ifcType ?? null,
        classification: cat?.classificationCode ?? null,
        catalogVersion: cat?.version ?? null,
      },
    })
  }

  // ── 4. Risers (vertical pipe runs across floors) ────────────────────────
  for (const r of (q.risers ?? [])) {
    const lengthFt = Number(r?.lengthFt)
    if (!Number.isFinite(lengthFt) || lengthFt <= 0) continue
    const kind = r.kind ?? 'UNKNOWN'
    const diam = r.diameterMm ?? null
    const isDrain = /SOIL|WASTE|RAIN|VENT/.test(kind)
    const category = isDrain ? 'plumbing_drainage' : 'plumbing_supply'
    push({
      id:        `plumbing_riser_${kind.toLowerCase()}_${diam ?? 'auto'}mm`,
      category,
      label:     `Riser — ${kind.replace(/_/g, ' ').toLowerCase()}${diam ? ` (${diam}mm)` : ''}`,
      qty:       Math.round(lengthFt * 100) / 100,
      unit:      'ft',
      rateKey:   `plumbing_riser_${kind.toLowerCase()}`,
      formulaId: `plumbing_riser_${kind.toLowerCase()}`,
      meta: {
        discipline: 'PLUMBING',
        riserKind:  kind,
        diameter:   diam != null ? `${diam}mm` : null,
      },
    })
  }
}
