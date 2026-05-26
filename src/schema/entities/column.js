// Column entity schema.
//
// 2026-05-26 (Arch 9 Phase 1) — mirrors the runtime shape created by
// structuralSlice.js::addColumn. Stored in state.columns (Map<id, Column>).
// Multi-floor spanning via baseFloorId/topFloorId (Phase 1.5 Fix 2).
//
// Foundation attachment is owned by foundation.columnIds[] — there is no
// column.foundationId field. Legacy saves get scrubbed by loadProject.

export const columnSchema = Object.freeze({
  entityType: 'column',
  storeSlice: 'model.columns',
  fields: Object.freeze({
    id:                  Object.freeze({ type: 'uuid',        required: true,  generator: 'uid' }),
    ifcGlobalId:         Object.freeze({ type: 'ifcGuid',     required: true,  generator: 'uidIfc' }),
    x:                   Object.freeze({ type: 'number',      required: true,  unit: 'inches' }),
    y:                   Object.freeze({ type: 'number',      required: true,  unit: 'inches' }),
    columnTypeId:        Object.freeze({ type: 'string',      required: true }),
    attachedNodeId:      Object.freeze({ type: 'ref|null',    required: true,  default: null }),
    baseFloorId:         Object.freeze({ type: 'ref',         required: true,  default: 'F1' }),
    topFloorId:          Object.freeze({ type: 'ref',         required: true,  default: 'F1' }),
    classification:      Object.freeze({ type: 'string|null', required: true,  default: null }),
    reinforcementSpecId: Object.freeze({ type: 'string|null', required: true,  default: null }),
    meta:                Object.freeze({ type: 'object|null', required: true,  default: null }),
  }),
  invariants: Object.freeze([]),
  legacyAliases: Object.freeze({
    // Phase 1.5 Fix 2 — single floorId replaced by baseFloorId/topFloorId span.
    floorId:      'baseFloorId',
    // Phase 1.5 Fix 1 — foundation owns columns; column.foundationId removed.
    foundationId: null,
  }),
})

export default columnSchema
