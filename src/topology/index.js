// Topology layer — canonical, read-only spatial-relationship APIs.
//
// Discipline engines (structural BOQ, MEP, interiors, fabrication) consume
// this layer; they never recompute spatial relationships.
//
// - Pure geometry math lives in src/geometry.js (point-in-polygon, segment
//   intersection, snap, etc.). Topology USES geometry — it isn't geometry.
// - State-reading relationships live here. Each module owns one kind of
//   relationship (rooms, walls, openings, columns, beams, foundations,
//   floor scope, adjacency, surfaces, wet walls).
// - No store mutations. Ever.
// - Memoization via createMemo() in ./cache.js — reference equality only.

export { createMemo } from './cache.js'

// Rooms
export {
  walkPolygonNodeOrder, buildPlotPolygon,
  getRoomPolygon, getRoomArea, getRoomWallArea,
  isRoomStructurallyValid, hasRoomOverlap, getOverlappingRoomName,
  getValidRoomIds, sumRoomAreas,
  getRoomCentroid, getRoofPolygon, getShaftPolygons,
  getRoomPerimeterFt, getLongestPolygonEdgeFt,
  // Dimension-mode kernel — Area 1 (Option C). Single entry point per
  // Correction 9. EffectiveRoomEdge primitive per Correction 1.
  // getEffectiveWallLengthFt for canvas labels (Correction 2).
  getRoomGeometry, getRoomPolygonInsetEdges, resolveDimensionMode,
  getEffectiveWallLengthFt,
} from './rooms.js'

// Floor scope
export {
  sortedFloorList, isColumnOnFloor,
  getNodesOnFloor, getWallsOnFloor, getRoomsOnFloor, getStampsOnFloor,
  getBeamsOnFloor, getSlabsOnFloor, getFoundationsOnFloor, getStaircasesOnFloor,
  getColumnsOnFloor, getNodeIdsOnFloor, getWallIdsOnFloor,
  getActiveFloorNodes, getActiveFloorWalls, getEntitiesOnFloor,
} from './floor.js'

// Walls
export {
  getWallAdjacencyCount, getWallToRoomsIndex, getRoomsForWall,
  isExternalWall, isPartitionWall, getExternalWallIds,
  classifyWallBeamFlags,
  getNearestWallToPoint, getExternalAccessibleWalls,
} from './walls.js'

// Openings
export {
  getOpeningsOnWall, getDoorOpenings, getWindowOpenings, getSunshadeOpenings,
  getOpeningArea, getTotalOpeningAreaForWall,
  deriveOpeningSubtype, getMainDoorCandidate, getOpeningsBySubtype,
  OPENING_SUBTYPE, SUBTYPE_SOURCE,
} from './openings.js'

// Columns
export {
  getNodeToColumnIndex, getColumnAtNode, getColumnPosition,
  getColumnAreaFt2, getColumnPerimeterFt, getColumnHeightFt,
  getColumnFloorSpans,
} from './columns.js'

// Beams
export {
  resolveBeamEndpoint, getBeamLengthFt, getDerivedWallBeams, getAllBeams,
} from './beams.js'

// Foundations
export {
  getFoundationForColumn, getColumnIsAttachedToFoundation,
  getFoundationForWall, getFoundationsForWall, getColumnsByFoundation,
  getInlineFootingColumnTypeIds,
} from './foundations.js'

// Adjacency
export {
  findSharedWalls, getRoomAdjacencyGraph, getRoomsBorderingRoom,
  getRoomConnectivityGraph, getRoomNeighbourThroughDoor,
  getFloorWallPerimeterGraph, getRoomWallPerimeterGraph, getCeilingPaths,
  findWallContainingEdge, findExpandedEdge,
} from './adjacency.js'

// Phase W — T-junction primitives
export {
  getOrderedWallJunctions, probeWallForMidSpan,
  findNearestTjunction, junctionSpacingIn, findCoalescingJunction,
} from './junctions.js'

// Phase W — Manual Join predicate
export { canMergeWalls } from './canMerge.js'

// Phase W — wallSplit propagation planner
export { planWallSplit } from './wallSplit.js'

// Phase W — Per-segment classification (post-T-junction adjacency)
export {
  classifySegment, iterateSegmentsWithClassification,
  _resetSegmentClassifyCaches,
} from './segmentClassify.js'

// Phase W — Authoritative nodeOrder recomputation
export {
  recomputeRoomNodeOrder, refreshRoomNodeOrderInState,
  computeNodeOrderForWallIds,
} from './nodeOrderRefresh.js'

// Surfaces
export {
  getWallSurfaces, getRoomSurfaces, getExteriorFaces, getInteriorFaceArea,
} from './surfaces.js'

// Wet (MEP plumbing)
export {
  WET_ROOM_TYPES, isWetRoomType,
  getWetRoomIds, getWetWallIds, getWetWalls,
  getWetExternalWalls, getWetPartitions, getWetRoomsForWall,
} from './wet.js'

// Faces (Phase R1 — interactive room detection)
export {
  enumerateFloorFaces, findFaceContainingEdge, findFaceContainingPoint,
  isFaceCoveredByRoom, findUncoveredFaces, _resetFaceCaches,
} from './faces.js'
