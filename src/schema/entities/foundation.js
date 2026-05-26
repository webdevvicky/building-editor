// Foundation entity schema.
//
// 2026-05-26 (Arch 9 Phase 1) — mirrors the runtime shape created by
// structuralSlice.js::addFoundation. Stored in state.foundations
// (Map<id, Foundation>). Per Phase 1.5 Fix 1, the foundation owns the
// attachment relationship via columnIds[] / wallIds[] — there is no
// column.foundationId field.
//
// Type-specific attachment expectations:
//   ISOLATED  — one column                 (columnIds.length >= 1)
//   COMBINED  — multiple columns           (columnIds.length >= 1)
//   STRIP     — under walls                (wallIds.length   >= 1)
//   RAFT      — building-wide, may be standalone
//   PILE      — pile shafts + cap, may be standalone

import { PCC_BEDDING_THICKNESS_FT } from '../../constants/structural'

const TYPES_REQUIRING_ATTACHMENT = Object.freeze(['ISOLATED', 'COMBINED', 'STRIP'])

export const foundationSchema = Object.freeze({
  entityType: 'foundation',
  storeSlice: 'model.foundations',
  fields: Object.freeze({
    id:                  Object.freeze({ type: 'uuid',        required: true,  generator: 'uid' }),
    ifcGlobalId:         Object.freeze({ type: 'ifcGuid',     required: true,  generator: 'uidIfc' }),
    type:                Object.freeze({ type: 'string',      required: true,  oneOf: Object.freeze(['ISOLATED', 'COMBINED', 'RAFT', 'STRIP', 'PILE']) }),
    columnIds:           Object.freeze({ type: 'array',       required: true,  default: () => [], itemType: 'string' }),
    wallIds:             Object.freeze({ type: 'array',       required: true,  default: () => [], itemType: 'string' }),
    geometry:            Object.freeze({ type: 'object|null', required: true,  default: () => ({}) }),
    grade:               Object.freeze({ type: 'string',      required: true,  default: 'M20' }),
    pccDepthFt:          Object.freeze({ type: 'number',      required: true,  default: PCC_BEDDING_THICKNESS_FT }),
    plumDepthFt:         Object.freeze({ type: 'number',      required: true,  default: 0 }),
    floorId:             Object.freeze({ type: 'ref',         required: true,  default: 'F1' }),
    label:               Object.freeze({ type: 'string|null', required: true,  default: null }),
    classification:      Object.freeze({ type: 'string|null', required: true,  default: null }),
    reinforcementSpecId: Object.freeze({ type: 'string|null', required: true,  default: null }),
    meta:                Object.freeze({ type: 'object|null', required: true,  default: null }),
  }),
  invariants: Object.freeze([
    Object.freeze({
      id: 'foundation.has-attachments',
      check: f => {
        if (!f || !TYPES_REQUIRING_ATTACHMENT.includes(f.type)) return true
        const cCount = Array.isArray(f.columnIds) ? f.columnIds.length : 0
        const wCount = Array.isArray(f.wallIds)   ? f.wallIds.length   : 0
        return (cCount + wCount) >= 1
      },
      message: 'ISOLATED / COMBINED / STRIP foundation must attach to at least one column or wall',
    }),
  ]),
  legacyAliases: Object.freeze({}),
})

export default foundationSchema
