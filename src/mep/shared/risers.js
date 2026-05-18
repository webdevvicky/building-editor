// Riser type constants + helpers.
//
// A riser is a vertical MEP entity that spans one-or-more floor levels
// (plumbing stack, electrical sub-main, HVAC refrigerant pair, etc.).
// Risers live in state.risers (the main thread will add this slice); they
// carry { id, fromFloorId, toFloorId, kind, x, y, ... }.

import { sortedFloorList } from '../../topology/index.js'

export const RISER_KINDS = Object.freeze({
  PLUMBING_SUPPLY:    'PLUMBING_SUPPLY',
  SOIL_STACK:         'SOIL_STACK',
  RAINWATER_DOWN:     'RAINWATER_DOWN',
  HOT_WATER_RISER:    'HOT_WATER_RISER',
  ELECTRICAL_SUBMAIN: 'ELECTRICAL_SUBMAIN',
  HVAC_REFRIGERANT:   'HVAC_REFRIGERANT',
  HVAC_CONDENSATE:    'HVAC_CONDENSATE',
  FIRE_MAIN:          'FIRE_MAIN',
  ELV_TRUNKING:       'ELV_TRUNKING',
  SOLAR_DC_RISER:     'SOLAR_DC_RISER',
  SOLAR_AC_RISER:     'SOLAR_AC_RISER',
})

// Map (discipline, systemType) → RISER_KIND. Deterministic table — never branch
// on string fragments inline in discipline code.
const _DISC_SYS_TO_KIND = Object.freeze({
  'PLUMBING:WATER_SUPPLY':   RISER_KINDS.PLUMBING_SUPPLY,
  'PLUMBING:HOT_WATER':      RISER_KINDS.HOT_WATER_RISER,
  'PLUMBING:SOIL':           RISER_KINDS.SOIL_STACK,
  'PLUMBING:WASTE':          RISER_KINDS.SOIL_STACK,
  'PLUMBING:RAINWATER':      RISER_KINDS.RAINWATER_DOWN,
  'ELECTRICAL:SUBMAIN':      RISER_KINDS.ELECTRICAL_SUBMAIN,
  'HVAC:REFRIGERANT':        RISER_KINDS.HVAC_REFRIGERANT,
  'HVAC:CONDENSATE':         RISER_KINDS.HVAC_CONDENSATE,
  'FIRE:MAIN':               RISER_KINDS.FIRE_MAIN,
  'ELV:TRUNKING':            RISER_KINDS.ELV_TRUNKING,
  'SOLAR:DC':                RISER_KINDS.SOLAR_DC_RISER,
  'SOLAR:AC':                RISER_KINDS.SOLAR_AC_RISER,
})

export function classifyRiserKind(disciplineSystem) {
  // disciplineSystem can be passed as either an object { discipline, systemType }
  // or a colon-joined string.
  let key
  if (typeof disciplineSystem === 'string') {
    key = disciplineSystem
  } else if (disciplineSystem && typeof disciplineSystem === 'object') {
    const d = disciplineSystem.discipline ?? ''
    const s = disciplineSystem.systemType ?? ''
    key = `${d}:${s}`
  } else {
    return null
  }
  return _DISC_SYS_TO_KIND[key] ?? null
}

// Returns risers spanning the given floor. "Spans" means: in the sequence-
// sorted floor list, the floor's index sits inside the closed
// [fromFloorIdx, toFloorIdx] range.
export function getRisersOnFloor(state, floorId) {
  const risers = state.risers ?? {}
  const fid = floorId ?? state.currentFloorId ?? 'F1'
  const sortedFloors = sortedFloorList(state)
  const fIdx = sortedFloors.findIndex(f => f.id === fid)
  if (fIdx === -1) {
    // Floor not in sortedList: fall back to direct from/to comparison.
    return Object.values(risers)
      .filter(r => (r.fromFloorId === fid) || (r.toFloorId === fid))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  }
  const matching = []
  for (const r of Object.values(risers)) {
    if (!r) continue
    const fromIdx = sortedFloors.findIndex(f => f.id === r.fromFloorId)
    const toIdx   = sortedFloors.findIndex(f => f.id === r.toFloorId)
    if (fromIdx === -1 || toIdx === -1) continue
    const lo = Math.min(fromIdx, toIdx)
    const hi = Math.max(fromIdx, toIdx)
    if (fIdx >= lo && fIdx <= hi) matching.push(r)
  }
  return matching.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

// Length of a riser in feet — sum of floor heights between fromFloorId and
// toFloorId in the sequence-ordered floor stack. Mirrors the approach used
// by state.getColumnHeightFt(): plinth on the base floor + floor heights for
// every intermediate floor + slab on the top.
//
// Phase 0 implementation: floor-height sum only. Plinth + slab are added by
// the discipline-specific quantity engine if it needs them (e.g., plumbing
// stack reaches into the plinth; HVAC refrigerant stops at the slab soffit).
export function getRiserLengthFt(state, riserId) {
  const risers = state.risers ?? {}
  const riser = risers[riserId]
  if (!riser) return 0
  const sortedFloors = sortedFloorList(state)
  const fromIdx = sortedFloors.findIndex(f => f.id === riser.fromFloorId)
  const toIdx   = sortedFloors.findIndex(f => f.id === riser.toFloorId)
  if (fromIdx === -1 || toIdx === -1) return 0
  const lo = Math.min(fromIdx, toIdx)
  const hi = Math.max(fromIdx, toIdx)
  let totalFt = 0
  for (let i = lo; i <= hi; i++) {
    const f = sortedFloors[i]
    totalFt += (f.floorHeightFt ?? 0)
  }
  return totalFt
}
