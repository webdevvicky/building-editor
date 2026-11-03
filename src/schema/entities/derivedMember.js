// Derived structural member — the permanent identity of a member the BBS engine
// builds from another entity (a wall's band beam, a column's inline footing, a
// window's sunshade, a wall's loft or tie band; erp-saas D-280). Stored at
// state.derivedMembers[id], maintained only by topology/derivedMembers.js
// (`reconcileDerivedMembers`) — never edited by a user action. Its size and bars are
// worked out from its parents every time; only who it is and what it hangs from are
// stored.

const DERIVATION_KINDS = Object.freeze(['WALL_BEAM', 'TIE_BEAM', 'INLINE_FOOTING', 'SUNSHADE', 'LOFT'])

export const derivedMemberSchema = Object.freeze({
  entityType: 'derivedMember',
  storeSlice: 'model.derivedMembers',
  fields: Object.freeze({
    id:                Object.freeze({ type: 'uuid',        required: true, generator: 'uid' }),
    ifcGlobalId:       Object.freeze({ type: 'ifcGuid',     required: true, generator: 'uidIfc' }),
    derivationKind:    Object.freeze({ type: 'string',      required: true, oneOf: DERIVATION_KINDS }),
    // Band level: plinth / lintel / roof (WALL_BEAM), tie (TIE_BEAM); null otherwise.
    level:             Object.freeze({ type: 'string|null', required: true, default: null }),
    hostWallId:        Object.freeze({ type: 'string|null', required: true, default: null }),
    hostOpeningId:     Object.freeze({ type: 'string|null', required: true, default: null }),
    hostColumnId:      Object.freeze({ type: 'string|null', required: true, default: null }),
    floorId:           Object.freeze({ type: 'string|null', required: true, default: null }),
    // Permanent per-floor number within its kind's prefix (LB-003).
    labelNo:           Object.freeze({ type: 'number',      required: true, default: 0 }),
    // The members this one was cut from or combined out of (their ifcGlobalIds).
    predecessorIfcIds: Object.freeze({ type: 'array',       required: true, default: () => [], itemType: 'string' }),
  }),
  invariants: Object.freeze([
    Object.freeze({
      id: 'derivedMember.has-host',
      check: (m) => Boolean(m.hostWallId || m.hostColumnId),
      message: 'a derived member hangs from a wall or a column',
    }),
  ]),
  legacyAliases: Object.freeze({}),
})

export default derivedMemberSchema
