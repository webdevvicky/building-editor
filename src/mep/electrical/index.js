// Electrical discipline barrel — single import surface for the network +
// routing + sizing + suggestions + placement helpers.

export { buildElectricalSystemGraph, getCircuitClassForPoint } from './network.js'
export { buildElectricalRoutes } from './routing.js'
export { sizeElectricalBranches } from './sizing.js'
export {
  groupPointsIntoCircuits,
  getCircuitPolicy,
  circuitSummary,
} from './circuitGrouping.js'
export { suggestElectricalPointsForRoom } from './suggestions.js'
export { snapPointToWall } from './pointPlacement.js'
export { placeDefaultDb } from './dbPlacement.js'
export { describeRequiredSubmainRisers } from './submains.js'
