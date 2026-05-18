// Topology — wet-wall set (MEP plumbing entry point).
//
// "Wet" room types need plumbing entry: TOILET (bathrooms), KITCHEN, UTILITY.
// The wet-wall set is the union of walls that bound at least one wet room.
// Subsets:
//   wet ∩ external → plumbing service-entry candidates (drainage stacks,
//                    municipal water inlet, external SVP)
//   wet ∩ partition → chase candidates (vertical risers buried in shaft)

import { isExternalWall, isPartitionWall, getRoomsForWall } from './walls.js'

// Canonical wet-room types — sourced from roomPresets registry. Keep this
// list as the SINGLE source of truth for "what is a wet room?"; MEP engines
// should import from here, never re-hardcode.
export const WET_ROOM_TYPES = Object.freeze(['TOILET', 'KITCHEN', 'UTILITY'])

export function isWetRoomType(type) {
  return WET_ROOM_TYPES.includes(type)
}

export function getWetRoomIds(state) {
  const out = []
  for (const room of Object.values(state.rooms)) {
    if (isWetRoomType(room.type)) out.push(room.id)
  }
  return out
}

// Set of wall ids that bound at least one wet room.
export function getWetWallIds(state) {
  const out = new Set()
  for (const room of Object.values(state.rooms)) {
    if (!isWetRoomType(room.type)) continue
    for (const wid of (room.wallIds ?? [])) out.add(wid)
  }
  return out
}

export function getWetWalls(state) {
  const ids = getWetWallIds(state)
  return [...ids].map(id => state.walls[id]).filter(Boolean)
}

// Wet ∩ external — service-entry candidates.
export function getWetExternalWalls(state) {
  const wet = getWetWallIds(state)
  return [...wet].filter(id => isExternalWall(state, id)).map(id => state.walls[id]).filter(Boolean)
}

// Wet ∩ partition — chase candidates.
export function getWetPartitions(state) {
  const wet = getWetWallIds(state)
  return [...wet].filter(id => isPartitionWall(state, id)).map(id => state.walls[id]).filter(Boolean)
}

// Returns the wet rooms each wet wall borders. Useful when the MEP engine
// is deciding which side of a partition gets the chase.
export function getWetRoomsForWall(state, wallId) {
  return getRoomsForWall(state, wallId).filter(r => isWetRoomType(r.type))
}
