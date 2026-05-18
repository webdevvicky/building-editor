// JSDoc typedefs for the MEP system graph.
//
// Discipline-specific network builders (plumbing, electrical, HVAC, fire,
// ELV, solar) all emit graphs that conform to these shapes. Verification
// scripts and downstream consumers (sizing, fitting count, IFC export)
// rely on this contract.

/**
 * @typedef {Object} SystemNode
 * @property {string} id                Deterministic id (see nodeIdFor).
 * @property {string|null} entityId     Source entity id (fixture, point,
 *                                       equipment, riser). null for pure
 *                                       routing junctions.
 * @property {'FIXTURE'|'POINT'|'EQUIPMENT'|'JUNCTION'|'DB'|'RISER_TOP'|'RISER_BOT'} kind
 * @property {string} discipline        'PLUMBING' | 'ELECTRICAL' | 'HVAC' |
 *                                       'FIRE' | 'ELV' | 'SOLAR'
 * @property {string} systemId          Sub-system id (e.g. 'WATER_SUPPLY',
 *                                       'SOIL_STACK', 'LIGHTING_CKT_1').
 * @property {string} branchId          Branch this node belongs to.
 * @property {number} x                 World inches.
 * @property {number} y                 World inches.
 * @property {string} floorId
 * @property {number} [loadW]           Electrical load (watts).
 * @property {number} [fixtureUnits]    Plumbing fixture units.
 */

/**
 * @typedef {Object} SystemEdge
 * @property {string} id
 * @property {string} fromNodeId
 * @property {string} toNodeId
 * @property {string} systemId
 * @property {string} branchId
 * @property {'BRANCH'|'TRUNK'|'RISER'|'SUBMAIN'|'MAIN'} kind
 * @property {string} zone              Routing zone id (see routingZones).
 * @property {number} lengthIn
 * @property {number} [diameterMm]      Pipe / duct diameter.
 * @property {number} [gaugeMm2]        Electrical cable cross-section.
 */

/**
 * @typedef {Object} Branch
 * @property {string} id
 * @property {string} systemId
 * @property {string[]} nodeIds         Member nodes, sorted deterministically.
 * @property {string[]} edgeIds
 * @property {string[]} leafEntityIds   Source entity ids of the branch leaves
 *                                       (used by branchIdFor hashing).
 */

/**
 * @typedef {Object} System
 * @property {string} id
 * @property {string} discipline
 * @property {string} systemType        e.g. 'WATER_SUPPLY', 'SOIL_STACK'.
 * @property {string[]} branchIds
 * @property {string[]} riserIds
 */

/**
 * @typedef {Object} PolylineRoute
 * @property {string} id
 * @property {string} systemId
 * @property {string} branchId
 * @property {string} edgeId
 * @property {{x:number,y:number}[]} polyline   World inches.
 * @property {string[]} zonesPerSegment         len = polyline.length - 1.
 * @property {string} floorId
 * @property {number} [diameterMm]
 * @property {number} [gaugeMm2]
 */

/**
 * @typedef {Object} ClashEvent
 * @property {string} id
 * @property {'HARD'|'SOFT'|'CLEARANCE'} severity
 * @property {string} routeAId
 * @property {string} routeBId
 * @property {{x:number,y:number}} at
 * @property {string} reason
 */

// JSDoc-only module. Re-exports nothing at runtime.
export {}
