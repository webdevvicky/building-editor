// HVAC unit auto-suggestions per room type.
//
// Reads ROOM_HVAC_DEFAULTS for the room's type, runs the dedicated
// HVAC placement helpers (indoor → high wall; outdoor → external wall
// near indoor), and returns Suggestion[] suitable for
// state.addHvacUnit / state.applyRoomMepDefaults({ hvac: [...] }).
//
// HVAC defaults frequently emit AC PAIRS — one indoor + one outdoor.
// The two units are placed by different heuristics (high-internal-wall
// vs nearest-external-wall) and must remain paired via pairedIndoorId /
// pairedOutdoorId at commit time. This module returns suggestion entries
// carrying a `pairKey` so the committing caller can link them.
//
// Pure: never mutates state.

import { ROOM_HVAC_DEFAULTS } from '../catalogs/hvacDefaults.js'
import { getHvacUnit } from '../catalogs/hvacUnits.js'
import { placeAcIndoorOnHighWall, placeAcOutdoorOnExternal } from './placement.js'
import { getRoomCentroid } from '../../topology/index.js'

const INDOOR_TYPES  = new Set(['AC_INDOOR_UNIT',  'DUCTED_AC_INDOOR'])
const OUTDOOR_TYPES = new Set(['AC_OUTDOOR_UNIT', 'DUCTED_AC_OUTDOOR'])

function _toAddUnitShape(s, extra = {}) {
  const cat = getHvacUnit(s.type)
  return {
    type: s.type,
    x: s.suggestedX,
    y: s.suggestedY,
    wallId: s.suggestedWallId ?? null,
    wallT:  s.suggestedWallT  ?? null,
    capacityTons: s.capacityTons ?? cat?.capacityTons ?? null,
    pairKey: s.pairKey ?? null,
    pairRole: s.pairRole ?? null,
    ...extra,
  }
}

export function suggestHvacUnitsForRoom(state, roomId) {
  if (!state || !roomId) return []
  const room = state.rooms?.[roomId]
  if (!room) return []
  const roomType = room.type ?? 'OTHER'
  const defaults = ROOM_HVAC_DEFAULTS[roomType]
  if (!defaults || defaults.length === 0) return []

  const entries = []
  const centroid = getRoomCentroid(state, roomId)

  // Walk the defaults in deterministic order. AC indoor + outdoor entries
  // for the same room get a shared `pairKey` derived from the room id +
  // entry index so a committing caller can wire pairedIndoorId/Outdoor.
  let pairSeq = 0

  // Index defaults by indoor/outdoor so we can zip indoor[i] with
  // outdoor[i] for pair-keying.
  const indoorDefs  = defaults.filter(d => INDOOR_TYPES.has(d.type))
  const outdoorDefs = defaults.filter(d => OUTDOOR_TYPES.has(d.type))
  const otherDefs   = defaults.filter(d => !INDOOR_TYPES.has(d.type) && !OUTDOOR_TYPES.has(d.type))

  // Emit indoor + outdoor as pairs. Number of pairs = min(indoor, outdoor).
  const pairCount = Math.min(indoorDefs.length, outdoorDefs.length)
  for (let i = 0; i < pairCount; i++) {
    const inDef  = indoorDefs[i]
    const outDef = outdoorDefs[i]
    const pairKey = `${roomId}_ac_${pairSeq++}`

    const indoorPlacement = placeAcIndoorOnHighWall(state, roomId)
    if (indoorPlacement) {
      entries.push({
        type: inDef.type,
        suggestedX: indoorPlacement.x,
        suggestedY: indoorPlacement.y,
        suggestedWallId: indoorPlacement.wallId,
        suggestedWallT:  indoorPlacement.wallT,
        capacityTons: inDef.capacityTons ?? null,
        pairKey,
        pairRole: 'INDOOR',
      })
    }

    const outdoorPlacement = placeAcOutdoorOnExternal(state, {
      x: indoorPlacement?.x ?? centroid?.x ?? 0,
      y: indoorPlacement?.y ?? centroid?.y ?? 0,
      floorId: room.floorId,
      roomId,
    })
    if (outdoorPlacement) {
      entries.push({
        type: outDef.type,
        suggestedX: outdoorPlacement.x,
        suggestedY: outdoorPlacement.y,
        suggestedWallId: outdoorPlacement.wallId,
        suggestedWallT:  outdoorPlacement.wallT,
        capacityTons: outDef.capacityTons ?? null,
        pairKey,
        pairRole: 'OUTDOOR',
      })
    }
  }

  // Any extra indoor without an outdoor → emit unpaired indoor at high wall.
  for (let i = pairCount; i < indoorDefs.length; i++) {
    const placement = placeAcIndoorOnHighWall(state, roomId)
    if (!placement) continue
    entries.push({
      type: indoorDefs[i].type,
      suggestedX: placement.x,
      suggestedY: placement.y,
      suggestedWallId: placement.wallId,
      suggestedWallT:  placement.wallT,
      capacityTons: indoorDefs[i].capacityTons ?? null,
      pairKey: null,
      pairRole: null,
    })
  }
  for (let i = pairCount; i < outdoorDefs.length; i++) {
    const placement = placeAcOutdoorOnExternal(state, {
      x: centroid?.x ?? 0, y: centroid?.y ?? 0, floorId: room.floorId, roomId,
    })
    if (!placement) continue
    entries.push({
      type: outdoorDefs[i].type,
      suggestedX: placement.x,
      suggestedY: placement.y,
      suggestedWallId: placement.wallId,
      suggestedWallT:  placement.wallT,
      capacityTons: outdoorDefs[i].capacityTons ?? null,
      pairKey: null,
      pairRole: null,
    })
  }

  // Other units (EXHAUST_FAN_HVAC, FRESH_AIR_INLET) — place at room
  // centroid; downstream UI can drag to a specific spot.
  for (const def of otherDefs) {
    const count = Math.max(1, def.n ?? 1)
    for (let k = 0; k < count; k++) {
      entries.push({
        type: def.type,
        suggestedX: centroid?.x ?? 0,
        suggestedY: centroid?.y ?? 0,
        suggestedWallId: null,
        suggestedWallT:  null,
        capacityTons: null,
        pairKey: null,
        pairRole: null,
      })
    }
  }

  // Deterministic output order: pair-grouped (sorted by pairKey ?? '~'),
  // then by type, then by (x, y).
  entries.sort((a, b) => {
    const pa = a.pairKey ?? '~', pb = b.pairKey ?? '~'
    if (pa !== pb) return pa < pb ? -1 : 1
    if (a.type !== b.type) return a.type < b.type ? -1 : 1
    return (a.suggestedX - b.suggestedX) || (a.suggestedY - b.suggestedY)
  })

  return entries.map(e => _toAddUnitShape(e))
}
