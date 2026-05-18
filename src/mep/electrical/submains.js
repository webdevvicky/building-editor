// Sub-main descriptor — identifies the ELECTRICAL_SUBMAIN risers a
// multi-floor project should have between the main DB (ground floor) and
// each upper-floor DB.
//
// Phase 1 deliberately does NOT create riser entities — that's a store
// mutation, which belongs in a store action. This module returns a list
// of needed risers; the panel layer materializes them on user confirm.

import { sortedFloorList } from '../../topology/index.js'
import { RISER_KINDS } from '../shared/risers.js'

const DEFAULT_FLOOR_ID = 'F1'

function _findDb(state, floorId) {
  const candidates = Object.values(state.electricalPoints ?? {})
    .filter(p => p && p.type === 'DB' && (p.floorId ?? DEFAULT_FLOOR_ID) === floorId)
  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.id < b.id ? -1 : 1)
  return candidates[0]
}

// Returns array of { kind, fromFloorId, toFloorId, x, y, requiredFor: [floorIds] }.
// Empty when only one floor or no DBs exist.
export function describeRequiredSubmainRisers(state) {
  if (!state) return []
  const floors = sortedFloorList(state)
  if (floors.length <= 1) return []

  // Main DB = first DB walking up from the lowest sequence-ordered floor.
  let mainDb = null
  let mainFloorId = null
  for (const f of floors) {
    const db = _findDb(state, f.id)
    if (db) { mainDb = db; mainFloorId = f.id; break }
  }
  if (!mainDb) return []

  // Existing ELECTRICAL_SUBMAIN risers (so we don't re-suggest covered ones).
  const existing = new Set()
  for (const r of Object.values(state.risers ?? {})) {
    if (!r || r.kind !== RISER_KINDS.ELECTRICAL_SUBMAIN) continue
    existing.add(`${r.fromFloorId}->${r.toFloorId}`)
    existing.add(`${r.toFloorId}->${r.fromFloorId}`)
  }

  const out = []
  for (const f of floors) {
    if (f.id === mainFloorId) continue
    const floorDb = _findDb(state, f.id)
    if (!floorDb) continue
    const key = `${mainFloorId}->${f.id}`
    if (existing.has(key)) continue
    out.push({
      kind: RISER_KINDS.ELECTRICAL_SUBMAIN,
      fromFloorId: mainFloorId,
      toFloorId: f.id,
      x: mainDb.x, y: mainDb.y,
      requiredFor: [f.id],
    })
  }
  out.sort((a, b) => a.toFloorId < b.toFloorId ? -1 : a.toFloorId > b.toFloorId ? 1 : 0)
  return out
}
