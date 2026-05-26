// Beam entity schema.
//
// 2026-05-26 (Arch 9 Phase 1) — mirrors the runtime shape created by
// structuralSlice.js::addBeam. Stored in state.beams (Map<id, Beam>).
// Only EXPLICIT beams are persisted; WALL_DERIVED beams are computed
// on-the-fly by getDerivedWallBeams() and never enter the state map.
//
// `endpoints` is a discriminated union per endpoint:
//   { type: 'COLUMN', columnId: string }
//   { type: 'POINT',  x: number, y: number }

const isValidEndpoint = e =>
  e != null &&
  typeof e === 'object' &&
  (e.type === 'COLUMN' || e.type === 'POINT')

export const beamSchema = Object.freeze({
  entityType: 'beam',
  storeSlice: 'model.beams',
  fields: Object.freeze({
    id:                  Object.freeze({ type: 'uuid',        required: true,  generator: 'uid' }),
    ifcGlobalId:         Object.freeze({ type: 'ifcGuid',     required: true,  generator: 'uidIfc' }),
    endpoints:           Object.freeze({ type: 'object|null', required: true }),
    level:               Object.freeze({ type: 'string',      required: true,  oneOf: Object.freeze(['plinth', 'lintel', 'roof']) }),
    source:              Object.freeze({ type: 'string',      required: true,  default: 'EXPLICIT', oneOf: Object.freeze(['EXPLICIT', 'WALL_DERIVED']) }),
    floorId:             Object.freeze({ type: 'ref',         required: true,  default: 'F1' }),
    reinforcementSpecId: Object.freeze({ type: 'string|null', required: true,  default: null }),
    sourceWallId:        Object.freeze({ type: 'ref|null',                     default: null }),
    meta:                Object.freeze({ type: 'object|null', required: true,  default: null }),
  }),
  invariants: Object.freeze([
    Object.freeze({
      id: 'beam.endpoints-shape',
      check: b =>
        b != null &&
        b.endpoints != null &&
        isValidEndpoint(b.endpoints.from) &&
        isValidEndpoint(b.endpoints.to),
      message: 'beam.endpoints.{from,to} must each be { type: COLUMN | POINT }',
    }),
    Object.freeze({
      id: 'beam.column-endpoint',
      check: b => {
        if (b?.endpoints == null) return false
        for (const e of [b.endpoints.from, b.endpoints.to]) {
          if (e?.type === 'COLUMN' && (typeof e.columnId !== 'string' || e.columnId.length === 0)) {
            return false
          }
        }
        return true
      },
      message: 'COLUMN endpoint must carry a non-empty columnId',
    }),
    Object.freeze({
      id: 'beam.point-endpoint',
      check: b => {
        if (b?.endpoints == null) return false
        for (const e of [b.endpoints.from, b.endpoints.to]) {
          if (e?.type === 'POINT' && (!Number.isFinite(e.x) || !Number.isFinite(e.y))) {
            return false
          }
        }
        return true
      },
      message: 'POINT endpoint must carry finite numeric x and y',
    }),
  ]),
  legacyAliases: Object.freeze({}),
})

export default beamSchema
