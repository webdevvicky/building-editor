// Plaster material quantities by system (Phase 1.6f).
//
// Per-room resolution: each room's plaster system is room.plasterSystemId or
// projectSettings.defaultPlasterSystemId. For each system in use we sum:
//   wallsAreaFt2   = sum of getRoomWallArea(roomId) for rooms on that system
//   ceilingAreaFt2 = sum of getRoomArea(roomId)    for rooms whose finishes.ceilingPlaster is true
//                    AND on that system
//
// Materials (per system kind):
//   CEMENT_SAND: cement bags (× cementBagsPerM2) + sand m³ (× sandM3PerM2)
//   GYPSUM/POP : material kg  (× materialKgPerM2) + bags (kg / materialBagKg, ceil)
//
// Note: ceiling plaster honors room.finishes.ceilingPlaster (existing flag).
// Wall plaster is global by project convention (every wall plastered), so all
// rooms contribute their wall area regardless of finish flags.

import {
  PLASTER_SYSTEMS, PLASTER_KIND, DEFAULT_PLASTER_SYSTEM_ID, FT2_TO_M2,
} from '../specs/plasterSystems'

function r2(n) { return Math.round(n * 100) / 100 }

function resolveSystemId(room, projectSettings) {
  return room?.plasterSystemId
    ?? projectSettings?.defaultPlasterSystemId
    ?? DEFAULT_PLASTER_SYSTEM_ID
}

export function computePlasterQuantities(state) {
  const { rooms, projectSettings } = state
  const validIds = state.getValidRoomIds()

  // Accumulate area per system.
  const accBySystem = {}   // { [systemId]: { wallsAreaFt2, ceilingAreaFt2, rooms: [{name, wallFt2, ceilingFt2}] } }
  for (const id of validIds) {
    const room = rooms[id]
    if (!room) continue
    const sysId = resolveSystemId(room, projectSettings)
    if (!PLASTER_SYSTEMS[sysId]) continue
    const wallFt2    = state.getRoomWallArea(id)
    const ceilingFt2 = room.finishes?.ceilingPlaster ? state.getRoomArea(id) : 0
    if (wallFt2 === 0 && ceilingFt2 === 0) continue
    if (!accBySystem[sysId]) accBySystem[sysId] = { wallsAreaFt2: 0, ceilingAreaFt2: 0, rooms: [] }
    accBySystem[sysId].wallsAreaFt2   += wallFt2
    accBySystem[sysId].ceilingAreaFt2 += ceilingFt2
    accBySystem[sysId].rooms.push({ id, name: room.name, wallFt2: r2(wallFt2), ceilingFt2: r2(ceilingFt2) })
  }

  // Resolve per-system materials.
  const bySystem = {}
  for (const [sysId, acc] of Object.entries(accBySystem)) {
    const sys = PLASTER_SYSTEMS[sysId]
    const totalAreaFt2 = acc.wallsAreaFt2 + acc.ceilingAreaFt2
    const totalAreaM2  = totalAreaFt2 * FT2_TO_M2

    const entry = {
      systemId:        sysId,
      label:           sys.label,
      kind:            sys.kind,
      thicknessMm:     sys.thicknessMm,
      wallsAreaFt2:    r2(acc.wallsAreaFt2),
      ceilingAreaFt2:  r2(acc.ceilingAreaFt2),
      totalAreaFt2:    r2(totalAreaFt2),
      totalAreaM2:     r2(totalAreaM2),
      rooms:           acc.rooms,
    }

    if (sys.kind === PLASTER_KIND.CEMENT_SAND) {
      entry.cementBags = Math.ceil(totalAreaM2 * sys.cementBagsPerM2)
      entry.sandM3     = r2(totalAreaM2 * sys.sandM3PerM2)
    } else {
      // GYPSUM / POP
      const materialKg = totalAreaM2 * sys.materialKgPerM2
      entry.materialKg   = r2(materialKg)
      entry.materialBags = Math.ceil(materialKg / sys.materialBagKg)
    }

    bySystem[sysId] = entry
  }

  const totalAreaFt2 = r2(Object.values(bySystem).reduce((s, q) => s + q.totalAreaFt2, 0))

  return { bySystem, totalAreaFt2 }
}
