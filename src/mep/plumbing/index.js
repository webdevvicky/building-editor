// Plumbing discipline barrel — single import surface for the network +
// routing + sizing + suggestions + placement helpers.

export { buildPlumbingSystemGraph } from './network.js'
export { buildPlumbingRoutes, listWetRoomsOnFloor } from './routing.js'
export { sizePlumbingBranches } from './sizing.js'
export { suggestPlumbingFixturesForRoom } from './suggestions.js'
export { snapFixtureToWall } from './fixturePlacement.js'
export {
  findNearestSoilStack,
  inferSoilStackLocation,
  getDrainGradient,
  getWetRoomsBorderingWall,
  getWetRoomsOnFloor,
} from './drainage.js'
export { findGeyserForFixture } from './hotwater.js'
