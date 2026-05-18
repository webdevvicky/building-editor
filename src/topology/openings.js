// Topology — opening (door / window) selectors.
//
// Openings are stored on the wall (`wall.openings: Opening[]`). Topology
// surfaces these as relationship queries: which openings on which wall,
// which are doors vs windows, which carry sunshades, total opening area
// for sizing checks.

import { GRID_IN } from '../geometry.js'

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
