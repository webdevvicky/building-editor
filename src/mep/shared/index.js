// Barrel re-export for the MEP shared module tree.
//
// Discipline-specific network builders import from this single surface:
//   import { ... } from '../shared/index.js'
//
// Adding a new shared helper = export it from its module here.

// Routing zones
export {
  ROUTING_ZONES,
  getZone,
  listZones,
  getDefaultZoneForSystem,
} from './routingZones.js'

// Sizing strategies
export {
  SIZING_STRATEGIES,
  selectStrategy,
  listStrategies,
} from './sizingStrategy.js'

// System graph (generic helpers — discipline buildSystemGraph lives in
// each discipline's network.js).
export {
  fnv1aHash,
  nodeIdFor,
  edgeIdFor,
  branchIdFor,
  validateGraph,
  sortNodesDeterministically,
  sortEdgesDeterministically,
} from './systemGraph.js'

// Geometry (MEP-shared, composes src/geometry.js + topology).
export {
  snapPointToNearestWall,
  walkWallPerimeter,
  simplifyPolyline,
  routeStableHash,
  polylineLengthFt,
  classifyZoneTransitions,
  pointInRoom,
  projectToWallCenterline,
} from './geometry.js'

// Fitting classification
export {
  countFittings,
  classifyCornerAngle,
} from './fittingCounter.js'

// Risers
export {
  RISER_KINDS,
  classifyRiserKind,
  getRisersOnFloor,
  getRiserLengthFt,
} from './risers.js'

// Suggestions
export {
  applyRoomDefaults,
} from './suggestions.js'

// Clash detection (Phase 1 stub)
export {
  PHASE_1_STUB,
  detectClashes,
} from './clashDetection.js'

// IFC mapping
export {
  mapEntityToIfcClass,
  mapRouteToIfcClass,
  mapRiserToIfcClass,
} from './ifcMapping.js'
