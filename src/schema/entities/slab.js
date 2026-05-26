// Slab entity schema.
//
// 2026-05-26 (Arch 9 Phase 1) — mirrors the runtime shape created by
// structuralSlice.js::addSlab. Stored in state.slabs (Map<id, Slab>).
//
// `type` is layout (MAIN | SUNKEN); `role`/`classification` is structural
// (ROOF | FLOOR | SUNKEN | STAIR_LANDING). Per CLAUDE.md Fix 3 — never
// branch on type for role logic, always read role.

export const slabSchema = Object.freeze({
  entityType: 'slab',
  storeSlice: 'model.slabs',
  fields: Object.freeze({
    id:                  Object.freeze({ type: 'uuid',        required: true,  generator: 'uid' }),
    ifcGlobalId:         Object.freeze({ type: 'ifcGuid',     required: true,  generator: 'uidIfc' }),
    type:                Object.freeze({ type: 'string',      required: true,  oneOf: Object.freeze(['MAIN', 'SUNKEN']) }),
    roomIds:             Object.freeze({ type: 'array',       required: true,  default: () => [], itemType: 'string' }),
    thicknessIn:         Object.freeze({ type: 'number',      required: true,  default: 5 }),
    sinkDepthIn:         Object.freeze({ type: 'number',      required: true,  default: 0 }),
    grade:               Object.freeze({ type: 'string',      required: true,  default: 'M20' }),
    floorId:             Object.freeze({ type: 'ref',         required: true,  default: 'F1' }),
    classification:      Object.freeze({ type: 'string|null', required: true,  default: null }),
    role:                Object.freeze({ type: 'string|null', required: true,  default: null }),
    reinforcementSpecId: Object.freeze({ type: 'string|null', required: true,  default: null }),
    meta:                Object.freeze({ type: 'object|null', required: true,  default: null }),
  }),
  invariants: Object.freeze([
    Object.freeze({
      id: 'slab.has-rooms',
      check: s => Array.isArray(s?.roomIds) && s.roomIds.length >= 1,
      message: 'slab.roomIds must contain at least one room id',
    }),
    Object.freeze({
      id: 'slab.thickness-positive',
      check: s => Number.isFinite(s?.thicknessIn) && s.thicknessIn > 0,
      message: 'slab.thicknessIn must be a positive number',
    }),
    Object.freeze({
      id: 'slab.sunken-has-depth',
      check: s => s?.type !== 'SUNKEN' || (Number.isFinite(s.sinkDepthIn) && s.sinkDepthIn > 0),
      message: 'SUNKEN slab must declare a positive sinkDepthIn',
    }),
  ]),
  legacyAliases: Object.freeze({}),
})

export default slabSchema
