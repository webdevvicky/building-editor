// Fire discipline barrel — single import surface for the network + routing
// + sizing + placement + suggestions helpers.

export { buildFireSystemGraph } from './network.js'
export { buildFireRoutes } from './routing.js'
export { sizeFireBranches } from './sizing.js'
export {
  placeFireAlarmPanel,
  placeSprinklerHeadsForRoom,
  placeManualCallPoint,
} from './placement.js'
export { suggestFireDevicesForRoom } from './suggestions.js'
