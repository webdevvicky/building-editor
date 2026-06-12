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
    // Assign-once spatial-tracking label sequence (see src/boq/elementLabels.js).
    // Floor for labeling = baseFloorId.
    labelNo:             Object.freeze({ type: 'number|null', required: true,  default: null }),
    x:                   Object.freeze({ type: 'number',      required: true,  unit: 'inches' }),
    y:                   Object.freeze({ type: 'number',      required: true,  unit: 'inches' }),
    columnTypeId:        Object.freeze({ type: 'string',      required: true }),
    attachedNodeId:      Object.freeze({ type: 'ref|null',    required: true,  default: null }),
    baseFloorId:         Object.freeze({ type: 'ref',         required: true,  default: 'F1' }),
    topFloorId:          Object.freeze({ type: 'ref',         required: true,  default: 'F1' }),
    classification:      Object.freeze({ type: 'string|null', required: true,  default: null }),
    reinforcementSpecId: Object.freeze({ type: 'string|null', required: true,  default: null }),
    // BBS-categories phase — sub/super segment override. null = auto-derive
    // (footing-top→grade-beam = SUB, above = SUPER) when split enabled;
    // 'SUB'/'SUPER' forces the whole column into one abstract category.
    position:            Object.freeze({ type: 'string|null', required: true,  default: null, oneOf: Object.freeze([null, 'SUB', 'SUPER']) }),
    // Phase ColumnStack — sparse per-floor section/reinforcement overrides.
    // null = uniform column (default section/reinforcement on every floor in
    // [baseFloorId, topFloorId]). Key = floorId within the span; value =
    // { columnTypeId?, reinforcementSpecId?, meta? }. Resolution falls back
    // segment → instance → type → project-default → estimate.
    segments:            Object.freeze({ type: 'object|null', required: true,  default: null }),
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
