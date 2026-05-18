// Hot-water network resolution.
//
// Phase 1 — per-bathroom geyser. For a consumer fixture that has
// hasHotWaterInlet === true, the geyser is whichever GEYSER fixture sits
// in the same room. Centralised solar/storage tanks land in Phase 2.4.

const DEFAULT_FLOOR_ID = 'F1'

// Returns the geyser fixtureId serving the given consumer fixture, or null.
export function findGeyserForFixture(state, fixtureId) {
  const fx = state.plumbingFixtures?.[fixtureId]
  if (!fx) return null
  const floorId = fx.floorId ?? DEFAULT_FLOOR_ID
  const roomId = fx.roomId
  if (!roomId) return null

  const candidates = []
  for (const g of Object.values(state.plumbingFixtures ?? {})) {
    if (!g || g.type !== 'GEYSER') continue
    if ((g.floorId ?? DEFAULT_FLOOR_ID) !== floorId) continue
    if (g.roomId !== roomId) continue
    candidates.push(g)
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return candidates[0].id
}
