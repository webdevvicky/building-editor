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
    // Phase W — node kind discriminator. CORNER = ordinary graph vertex
    // where walls meet at their endpoints. TJUNCTION = node attached
    // mid-span to a parent wall (does NOT terminate that wall).
    kind:        Object.freeze({ type: 'string',          required: true,  default: 'CORNER',
                                 oneOf: ['CORNER', 'TJUNCTION'] }),
    // Phase W — non-null iff kind === 'TJUNCTION'. References the
    // parent wall this junction is attached to.
    onWallId:    Object.freeze({ type: 'ref|null',        required: true,  default: null,
                                 refTarget: 'wall' }),
  }),
  invariants: Object.freeze([
    Object.freeze({
      id: 'node.floorIds-nonempty',
      check: n => Array.isArray(n.floorIds) && n.floorIds.length > 0,
      message: 'node.floorIds must be a non-empty array',
    }),
    // Phase W — INV-W1: a CORNER node has no onWallId. A TJUNCTION node has one.
    Object.freeze({
      id: 'node.kind-onWallId-consistency',
      check: n => {
        const kind = n.kind ?? 'CORNER'
        if (kind === 'CORNER')    return n.onWallId == null
        if (kind === 'TJUNCTION') return typeof n.onWallId === 'string' && n.onWallId.length > 0
        return false
      },
      message: 'node.onWallId must be null for CORNER, non-null string for TJUNCTION',
    }),
  ]),
  legacyAliases: Object.freeze({}),
})

export default nodeSchema
