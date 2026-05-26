// Node entity — geometric vertex shared by walls.
// Stored at state.model.nodes[id] (after Arch 1) or state.nodes[id] (today).
//
// Identity: ifcGlobalId is stable; internal id may change on import.
// Spatial collision across floors creates DISTINCT nodes (Topology rule).

export const nodeSchema = Object.freeze({
  entityType:  'node',
  storeSlice:  'model.nodes',
  fields: Object.freeze({
    id:          Object.freeze({ type: 'uuid',    required: true,  generator: 'uid' }),
    ifcGlobalId: Object.freeze({ type: 'ifcGuid', required: true,  generator: 'uidIfc' }),
    x:           Object.freeze({ type: 'number',  required: true,  unit: 'inches' }),
    y:           Object.freeze({ type: 'number',  required: true,  unit: 'inches' }),
    floorIds:    Object.freeze({ type: 'array',   required: true,  default: () => ['F1'],
                                 itemType: 'string',
                                 invariant: 'non-empty' }),
  }),
  invariants: Object.freeze([
    Object.freeze({
      id: 'node.floorIds-nonempty',
      check: n => Array.isArray(n.floorIds) && n.floorIds.length > 0,
      message: 'node.floorIds must be a non-empty array',
    }),
  ]),
  legacyAliases: Object.freeze({}),
})

export default nodeSchema
