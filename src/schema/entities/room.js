// Room entity — polygon defined by ordered wallIds.
// Stored at state.model.rooms[id] (after Arch 1) or state.rooms[id] (today).
//
// Geometry is derived from wallIds (closed loop). Finishes drive BOQ
// inclusion flags. Per-room overrides feed plaster / paint / tile pipelines.

import { ROOM_TYPES } from '../../roomPresets.js'

export const roomSchema = Object.freeze({
  entityType:  'room',
  storeSlice:  'model.rooms',
  fields: Object.freeze({
    id:          Object.freeze({ type: 'uuid',    required: true,  generator: 'uid' }),
    ifcGlobalId: Object.freeze({ type: 'ifcGuid', required: true,  generator: 'uidIfc' }),
    name:        Object.freeze({ type: 'string',  required: true }),
    wallIds:     Object.freeze({ type: 'array',   required: true,  default: () => [],
                                 itemType: 'string', refTarget: 'wall' }),
    type:        Object.freeze({ type: 'string',  required: true,  oneOf: ROOM_TYPES }),
    customType:  Object.freeze({ type: 'string|null', required: true, default: null }),
    finishes:    Object.freeze({ type: 'object|null', required: true }),
    plasterSystemId: Object.freeze({ type: 'string|null', required: true, default: null }),
    paintSystemId:   Object.freeze({ type: 'string|null', required: true, default: null }),
    ceilingFinishId: Object.freeze({ type: 'string|null', required: true, default: null }),
    dadoHeightFt:    Object.freeze({ type: 'number|FULL|null', required: true, default: null }),
    includeSkirting: Object.freeze({ type: 'boolean|null',     required: true, default: null }),
    kitchenCounter:  Object.freeze({ type: 'object|null',      required: true, default: null }),
    balconyHandrail: Object.freeze({ type: 'object|null',      required: true, default: null }),
    floorId:         Object.freeze({ type: 'ref',              required: true, default: 'F1', refTarget: 'floor' }),
    classification:  Object.freeze({ type: 'string|null',      required: true, default: null }),
    meta:            Object.freeze({ type: 'object|null',      required: true, default: null }),
    // Phase W — DERIVED SNAPSHOT of the closed polygon's node sequence.
    // Authoritative source is runtime recomputation via
    // recomputeRoomNodeOrder; this field is a cache for IDB round-trip
    // performance and for consumers that need polygon-walk geometry.
    // Refreshed whenever the room's wall topology changes.
    nodeOrder:       Object.freeze({ type: 'array',            required: true, default: () => [],
                                      itemType: 'string', refTarget: 'node' }),
  }),
  invariants: Object.freeze([
    Object.freeze({
      id: 'room.has-walls',
      check: r => Array.isArray(r.wallIds) && r.wallIds.length >= 3,
      message: 'room must reference at least 3 walls',
    }),
    Object.freeze({
      id: 'room.name-nonempty',
      check: r => typeof r.name === 'string' && r.name.length > 0,
      message: 'room.name must be a non-empty string',
    }),
  ]),
  legacyAliases: Object.freeze({}),
})

export default roomSchema
