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
} from './walls.js'

// Openings
export {
  getOpeningsOnWall, getDoorOpenings, getWindowOpenings, getSunshadeOpenings,
  getOpeningArea, getTotalOpeningAreaForWall,
} from './openings.js'

// Columns
export {
  getNodeToColumnIndex, getColumnAtNode, getColumnPosition,
  getColumnAreaFt2, getColumnPerimeterFt, getColumnHeightFt,
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
} from './adjacency.js'

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
