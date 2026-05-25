// Topology — opening (door / window) selectors.
//
// Openings are stored on the wall (`wall.openings: Opening[]`). Topology
// surfaces these as relationship queries: which openings on which wall,
// which are doors vs windows, which carry sunshades, total opening area
// for sizing checks.

import { GRID_IN } from '../geometry.js'
import {
  OPENING_SUBTYPE, SUBTYPE_SOURCE,
  VENTILATOR_MAX_HEIGHT_IN, VENTILATOR_MAX_WIDTH_IN,
} from '../constants/joinery.js'
import { isExternalWall } from './walls.js'

function r2(n) { return Math.round(n * 100) / 100 }

// Returns the openings on wallId (empty array if no wall or no openings).
export function getOpeningsOnWall(state, wallId) {
  const wall = state.walls[wallId]
  if (!wall) return []
  return wall.openings ?? []
}

// All openings of a kind. If wallId is provided, scoped to that wall;
// otherwise iterates every wall in state.walls.
export function getDoorOpenings(state, wallId) {
  return _filterOpenings(state, wallId, o => o.type === 'door')
}

export function getWindowOpenings(state, wallId) {
  return _filterOpenings(state, wallId, o => o.type === 'window')
}

// Every window opening carrying a sunshade across the project.
// Used by sunshade BOQ; future façade design tools will need the same.
export function getSunshadeOpenings(state) {
  return _filterOpenings(state, undefined, o => o.type === 'window' && !!o.hasSunshade)
}

// Pure: opening area in ft² (width × height converted from inches).
export function getOpeningArea(opening) {
  if (!opening) return 0
  const w = (opening.width  ?? 0) / GRID_IN
  const h = (opening.height ?? 0) / GRID_IN
  return r2(w * h)
}

// Sum of all opening areas on a wall in ft² — gross deduction from a wall's
// gross area before computing net plaster / paint area.
export function getTotalOpeningAreaForWall(state, wallId) {
  return r2(getOpeningsOnWall(state, wallId).reduce((s, o) => s + getOpeningArea(o), 0))
}

// ── Subtype helpers (Rev 2) ─────────────────────────────────────────────
//
// Every opening carries a `subtype` field
//   MAIN_DOOR | INTERNAL_DOOR | WINDOW | VENTILATOR
// plus `subtypeSource` ('EXPLICIT' | 'HEURISTIC') so the UI can show
// an "Auto-detected" badge when the value came from the default
// derivation rather than the user.

// Pure heuristic — no state mutation, no store reads.
// - Doors: VENTILATOR is not a door subtype. External-wall doors that
//   haven't already been assigned MAIN_DOOR become INTERNAL_DOOR
//   unless they're the sole candidate flagged via the floor check.
// - Windows: small openings (≤18in tall, ≤36in wide) → VENTILATOR.
//
// `existingDoorSubtypes` is an array of already-derived subtypes on
// the same floor — used to ensure at most one MAIN_DOOR per floor
// is auto-picked. Pass [] when bulk-deriving from scratch and let the
// caller track state.
export function deriveOpeningSubtype(opening, { wallIsExternal = false, hasExistingMainDoor = false } = {}) {
  if (!opening) return null
  if (opening.type === 'window') {
    const w = opening.width  ?? 0
    const h = opening.height ?? 0
    if (h <= VENTILATOR_MAX_HEIGHT_IN && w <= VENTILATOR_MAX_WIDTH_IN) {
      return OPENING_SUBTYPE.VENTILATOR
    }
    return OPENING_SUBTYPE.WINDOW
  }
  if (opening.type === 'door') {
    if (wallIsExternal && !hasExistingMainDoor) return OPENING_SUBTYPE.MAIN_DOOR
    return OPENING_SUBTYPE.INTERNAL_DOOR
  }
  return null
}

// Convenience: pick the heuristic main-door candidate for a floor.
// Largest external-wall door on the floor wins (ties broken by id).
// Returns { wallId, openingId } | null.
export function getMainDoorCandidate(state, floorId) {
  let best = null
  let bestArea = -1
  for (const wall of Object.values(state.walls)) {
    if (floorId && wall.floorId && wall.floorId !== floorId) continue
    if (!isExternalWall(state, wall.id)) continue
    for (const op of (wall.openings ?? [])) {
      if (op.type !== 'door') continue
      const area = (op.width ?? 0) * (op.height ?? 0)
      if (area > bestArea
          || (area === bestArea && (!best || op.id < best.openingId))) {
        bestArea = area
        best = { wallId: wall.id, openingId: op.id }
      }
    }
  }
  return best
}

// Filter by subtype. If wallId provided, scoped to that wall.
export function getOpeningsBySubtype(state, subtype, wallId) {
  return _filterOpenings(state, wallId, o => o.subtype === subtype)
}

// Surface SUBTYPE_SOURCE / OPENING_SUBTYPE from this module so consumers
// (panels, aggregators) have a single import path.
export { OPENING_SUBTYPE, SUBTYPE_SOURCE } from '../constants/joinery.js'

function _filterOpenings(state, wallId, pred) {
  if (wallId !== undefined) {
    return getOpeningsOnWall(state, wallId).filter(pred).map(o => ({ ...o, wallId }))
  }
  const out = []
  for (const wall of Object.values(state.walls)) {
    for (const op of (wall.openings ?? [])) {
      if (pred(op)) out.push({ ...op, wallId: wall.id })
    }
  }
  return out
}
