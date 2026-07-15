// ghostCatalog.js — Ghost = a DERIVED, view-only overlay of
// (RoomType standard − placed geometry).
//
// FROZEN INVARIANT: a Ghost is NOT an entity. It has no id, lives in NO store
// collection, is NEVER serialized to the snapshot or synced to the ERP, and is
// NEVER a BOQ quantity. It is recomputed every render from the room-type standard
// (reference data) minus the actual placed objects, and it vanishes the moment a
// ghost is Accepted (which creates ONE real object) or a placed object is deleted.
//
// These are PURE functions — they never mutate the store. The standard comes from
// the ERP RoomType taxonomy the editor consumes (defaults are reference data only).

// Plumbing fixture keys that roll up into the room's plumbing standard.
const PLUMBING_KEYS = ['wc', 'washbasin', 'shower', 'sink', 'tapPoints', 'drain', 'kitchenPlatform']

/** The room-type STANDARD (per-discipline expected counts) from the cached taxonomy. */
export function roomTypeStandard(roomTypeCode, erpRoomTypes) {
  const rt = (erpRoomTypes ?? []).find((t) => t.code === roomTypeCode)
  if (!rt) return { electrical: 0, plumbing: 0, doors: 0 }
  const fx = rt.defaultFixtureSpec ?? {}
  const plumbing = PLUMBING_KEYS.reduce((sum, k) => sum + (Number(fx[k]) || 0), 0)
  return {
    electrical: Number(rt.defaultElectricalPointCount) || 0,
    plumbing,
    doors: Number(fx.doors) || 0,
  }
}

/** The actual PLACED counts per discipline in a room (pure read of the store state). */
export function placedCounts(state, roomId) {
  const inRoom = (coll) =>
    Object.values(state[coll] ?? {}).filter((e) => e.roomId === roomId).length
  const room = state.rooms?.[roomId]
  let doors = 0
  for (const wid of room?.wallIds ?? []) {
    const w = state.walls?.[wid]
    for (const o of w?.openings ?? []) {
      if (String(o.type ?? '').toLowerCase() === 'door') doors++
    }
  }
  return {
    electrical: inRoom('electricalPoints'),
    plumbing: inRoom('plumbingFixtures'),
    doors,
  }
}

// The disciplines shown in the overlay. `acceptable` = a ghost can be materialized
// into a real object directly (MEP points place at the room centroid); doors need a
// wall, so they are comparison-only here (placed via the opening tools).
const GHOST_DISCIPLINES = [
  { key: 'electrical', label: 'Electrical Points', acceptable: true },
  { key: 'plumbing', label: 'Plumbing Fixtures', acceptable: true },
  { key: 'doors', label: 'Doors', acceptable: false },
]

/**
 * The derived ghost rows for a room: standard vs placed, the ghost shortfall
 * (standard beyond placed) and the additional (placed beyond standard). Pure.
 */
export function computeRoomGhosts(state, roomId, erpRoomTypes) {
  const room = state.rooms?.[roomId]
  if (!room) return []
  const std = roomTypeStandard(room.roomTypeCode, erpRoomTypes)
  const placed = placedCounts(state, roomId)
  return GHOST_DISCIPLINES.map((d) => {
    const s = std[d.key] ?? 0
    const p = placed[d.key] ?? 0
    return {
      key: d.key,
      label: d.label,
      standard: s,
      placed: p,
      ghost: Math.max(0, s - p),
      additional: Math.max(0, p - s),
      acceptable: d.acceptable,
    }
  })
}
