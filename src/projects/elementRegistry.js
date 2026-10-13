// elementRegistry.js — SINGLE SOURCE OF TRUTH for BuildingElement kinds.
//
// Keyed by the ERP `BuildingElementKind`. Each entry knows everything BOTH
// directions need, so adding a new element type = ONE entry here, nothing else:
//   - collection   : editor store slice key
//   - erpKind      : ERP BuildingElementKind (== the key)
//   - erpOpType    : sync op string (all go through the generic ADD_ELEMENT —
//                    it carries `kind`, so coordinate mapping stays in one place)
//   - toErpPayload(editorEl, state) : editor → ERP (inch→mm), NO `kind` (the
//                    emitter adds it for ADD; UPDATE must omit it — not whitelisted)
//   - toEditorShape(erpEl, ctx)     : ERP → editor (mm→inch), collection fields —
//                    the exact inverse of toErpPayload over GET /state (the
//                    projection contract). `ctx.floorFor(erpFloorId)` maps an ERP
//                    floor to its editor floor id. Defaults for anything the
//                    projection does not hold come from the entity schema
//                    (projectionReconstruct normalizes every rebuilt element).
//
// What the ERP has no typed column for travels in `spec` (BuildingElement.spec,
// stored verbatim): a fixture's type, a riser's kind, a staircase's flights, a
// foundation's footing, a column's type. References inside it name other entities
// by ifcGlobalId — the identity the projection keeps — never by editor-local id.
//
// The /25.4 conversion lives ONLY in syncMappers (inToMm/mmToIn); registry
// entries compose it. No per-kind branching exists outside this file.

import { inToMm, mmToIn, edgeLengthMm } from './syncMappers.js'

const xy = (el) => ({ posXMm: inToMm(el.x), posYMm: inToMm(el.y) })
const point = (e) => ({ x: mmToIn(e.posXMm), y: mmToIn(e.posYMm) })
const ifcOf = (coll, id) => (id ? coll?.[id]?.ifcGlobalId ?? null : null)
const ifcsOf = (coll, ids) => (ids ?? []).map((id) => ifcOf(coll, id)).filter(Boolean)
const floorOf = (e, ctx) => ctx?.floorFor?.(e.floorId) ?? undefined

function beamPoint(state, ref) {
  if (!ref) return null
  if (ref.type === 'POINT') return { x: ref.x, y: ref.y }
  if (ref.type === 'COLUMN') { const c = state?.columns?.[ref.columnId]; return c ? { x: c.x, y: c.y } : null }
  return null
}

// A beam endpoint for the projection: the union with its reference named by ifcGlobalId.
function endpointToSpec(state, ref) {
  if (!ref) return null
  if (ref.type === 'COLUMN') return { type: 'COLUMN', columnIfcId: ifcOf(state?.columns, ref.columnId) }
  if (ref.type === 'BEAM') return { type: 'BEAM', beamIfcId: ifcOf(state?.beams, ref.beamId), t: ref.t }
  if (ref.type === 'WALL') return { type: 'WALL', wallIfcId: ifcOf(state?.walls, ref.wallId), t: ref.t }
  return { type: 'POINT', x: ref.x, y: ref.y }
}
// …and back: rebuilt entities are keyed by their ifcGlobalId, so the reference is that id.
function endpointFromSpec(spec, fallback) {
  if (spec?.type === 'COLUMN' && spec.columnIfcId) return { type: 'COLUMN', columnId: spec.columnIfcId }
  if (spec?.type === 'BEAM' && spec.beamIfcId) return { type: 'BEAM', beamId: spec.beamIfcId, t: spec.t }
  if (spec?.type === 'WALL' && spec.wallIfcId) return { type: 'WALL', wallId: spec.wallIfcId, t: spec.t }
  return fallback
}

// MEP disciplines all share one positional shape (kind ⇄ discipline). The point's
// room ifcGlobalId rides along (roomIfcId) so the ERP can attribute the placed point
// to a room for the geometry-first count resolver.
const mep = (collection, erpKind, discipline) => ({
  collection, erpKind, erpOpType: 'ADD_ELEMENT',
  toErpPayload: (el, state) => {
    const roomIfcId = el.roomId ? state?.rooms?.[el.roomId]?.ifcGlobalId ?? null : null
    return {
      ifcGlobalId: el.ifcGlobalId,
      ...xy(el),
      ...(roomIfcId ? { roomIfcId } : {}),
      // Stream 2: carry the canonical MEP point classification. In toErpPayload so it
      // rides BOTH the ADD and (SHAPE-only) UPDATE bodies AND the change signature
      // (syncEmitters.signature stringifies this) — so a point-type change re-syncs.
      // Only electrical points define pointType today; a benign no-op for other disciplines.
      ...(el.pointType ? { pointType: el.pointType } : {}),
      spec: {
        type: el.type ?? null,
        rotationDeg: el.rotationDeg ?? 0,
        wallIfcId: ifcOf(state?.walls, el.wallId),
        wallT: el.wallT ?? null,
      },
    }
  },
  toEditorShape: (e, ctx) => ({
    ...point(e), discipline,
    type: e.spec?.type ?? 'UNKNOWN',
    floorId: floorOf(e, ctx),
    roomId: e.roomSourceEditorId ?? null,
    wallId: e.spec?.wallIfcId ?? null,
    wallT: e.spec?.wallT ?? null,
    rotationDeg: e.spec?.rotationDeg ?? 0,
    ...(e.mepPointType ? { pointType: e.mepPointType } : {}),
  }),
})

export const ELEMENT_REGISTRY = Object.freeze({
  COLUMN: {
    collection: 'columns', erpKind: 'COLUMN', erpOpType: 'ADD_ELEMENT',
    toErpPayload: (el) => ({
      ifcGlobalId: el.ifcGlobalId, ...xy(el),
      spec: {
        columnTypeId: el.columnTypeId ?? null,
        topFloorId: el.topFloorId ?? null,
        position: el.position ?? null,
        classification: el.classification ?? null,
      },
    }),
    toEditorShape: (e, ctx) => {
      const baseFloorId = floorOf(e, ctx)
      return {
        ...point(e),
        columnTypeId: e.spec?.columnTypeId ?? null,
        baseFloorId,
        topFloorId: e.spec?.topFloorId ?? baseFloorId,
        position: e.spec?.position ?? null,
        classification: e.spec?.classification ?? null,
      }
    },
  },
  BEAM: {
    collection: 'beams', erpKind: 'BEAM', erpOpType: 'ADD_ELEMENT',
    toErpPayload: (el, state) => {
      const f = beamPoint(state, el.endpoints?.from)
      const t = beamPoint(state, el.endpoints?.to)
      const p = { ifcGlobalId: el.ifcGlobalId }
      if (f && t) {
        p.fromXMm = inToMm(f.x); p.fromYMm = inToMm(f.y)
        p.toXMm = inToMm(t.x); p.toYMm = inToMm(t.y)
        p.spanMm = edgeLengthMm(f, t)
      }
      if (el.level) p.structuralLevel = el.level
      p.spec = {
        source: el.source ?? 'EXPLICIT',
        from: endpointToSpec(state, el.endpoints?.from),
        to: endpointToSpec(state, el.endpoints?.to),
      }
      return p
    },
    toEditorShape: (e, ctx) => ({
      endpoints: {
        from: endpointFromSpec(e.spec?.from, { type: 'POINT', x: mmToIn(e.fromXMm), y: mmToIn(e.fromYMm) }),
        to: endpointFromSpec(e.spec?.to, { type: 'POINT', x: mmToIn(e.toXMm), y: mmToIn(e.toYMm) }),
      },
      level: String(e.structuralLevel ?? 'plinth').toLowerCase(),
      source: e.spec?.source ?? 'EXPLICIT',
      floorId: floorOf(e, ctx),
    }),
  },
  SLAB: {
    collection: 'slabs', erpKind: 'SLAB', erpOpType: 'ADD_ELEMENT',
    toErpPayload: (el, state) => ({
      ifcGlobalId: el.ifcGlobalId,
      thicknessMm: inToMm(el.thicknessIn),
      roomIds: (el.roomIds ?? []).map((rid) => state?.rooms?.[rid]?.ifcGlobalId).filter(Boolean),
      ...(el.type ? { slabType: el.type } : {}),
      ...(el.role ? { slabRole: el.role } : {}),
      spec: {
        grade: el.grade ?? null,
        sinkDepthIn: el.sinkDepthIn ?? 0,
        roleSource: el.roleSource ?? 'AUTO',
        classification: el.classification ?? null,
      },
    }),
    toEditorShape: (e, ctx) => ({
      type: e.slabType === 'SUNKEN' ? 'SUNKEN' : 'MAIN',
      roomIds: e.roomSourceEditorIds ?? [],
      thicknessIn: mmToIn(e.thicknessMm),
      sinkDepthIn: e.spec?.sinkDepthIn ?? 0,
      ...(e.spec?.grade ? { grade: e.spec.grade } : {}),
      role: e.slabRole ?? null,
      roleSource: e.spec?.roleSource ?? 'AUTO',
      classification: e.spec?.classification ?? null,
      floorId: floorOf(e, ctx),
    }),
  },
  STAIRCASE: {
    collection: 'staircases', erpKind: 'STAIRCASE', erpOpType: 'ADD_ELEMENT',
    toErpPayload: (el) => ({
      ifcGlobalId: el.ifcGlobalId, ...xy({ x: el.x ?? 0, y: el.y ?? 0 }),
      spec: {
        type: el.type ?? null, flightCount: el.flightCount ?? null, stepsPerFlight: el.stepsPerFlight ?? null,
        treadIn: el.treadIn ?? null, riserIn: el.riserIn ?? null, waistSlabIn: el.waistSlabIn ?? null,
        landingFtWidth: el.landingFtWidth ?? null, landingFtLength: el.landingFtLength ?? null,
        flightWidthFt: el.flightWidthFt ?? null, grade: el.grade ?? null,
        fromFloorId: el.fromFloorId ?? null, toFloorId: el.toFloorId ?? null, hasHandrail: el.hasHandrail ?? null,
      },
    }),
    toEditorShape: (e, ctx) => ({ ...withoutNulls(e.spec), floorId: floorOf(e, ctx) }),
  },
  FOUNDATION: {
    collection: 'foundations', erpKind: 'FOUNDATION', erpOpType: 'ADD_ELEMENT',
    toErpPayload: (el, state) => ({
      ifcGlobalId: el.ifcGlobalId, ...xy({ x: el.x ?? 0, y: el.y ?? 0 }),
      spec: {
        type: el.type ?? null,
        columnIfcIds: ifcsOf(state?.columns, el.columnIds),
        wallIfcIds: ifcsOf(state?.walls, el.wallIds),
        geometry: el.geometry ?? {},
        grade: el.grade ?? null, pccDepthFt: el.pccDepthFt ?? null, plumDepthFt: el.plumDepthFt ?? null,
        label: el.label ?? null, classification: el.classification ?? null,
      },
    }),
    toEditorShape: (e, ctx) => {
      const { columnIfcIds, wallIfcIds, ...rest } = e.spec ?? {}
      return { ...withoutNulls(rest), columnIds: columnIfcIds ?? [], wallIds: wallIfcIds ?? [], floorId: floorOf(e, ctx) }
    },
  },
  RISER: {
    collection: 'risers', erpKind: 'RISER', erpOpType: 'ADD_ELEMENT', // editor "lift shaft" ⇄ ERP RISER
    toErpPayload: (el) => ({
      ifcGlobalId: el.ifcGlobalId, ...xy({ x: el.x ?? 0, y: el.y ?? 0 }),
      spec: {
        kind: el.kind ?? null, discipline: el.discipline ?? null,
        fromFloorId: el.fromFloorId ?? null, toFloorId: el.toFloorId ?? null,
        diameterMm: el.diameterMm ?? null, routingZone: el.routingZone ?? null,
      },
    }),
    toEditorShape: (e) => ({ ...point(e), ...withoutNulls(e.spec) }),
  },
  MEP_PLUMBING: mep('plumbingFixtures', 'MEP_PLUMBING', 'PLUMBING'),
  MEP_ELECTRICAL: mep('electricalPoints', 'MEP_ELECTRICAL', 'ELECTRICAL'),
  MEP_HVAC: mep('hvacUnits', 'MEP_HVAC', 'HVAC'),
  MEP_FIRE: mep('fireDevices', 'MEP_FIRE', 'FIRE'),
  MEP_ELV: mep('elvDevices', 'MEP_ELV', 'ELV'),
  MEP_SOLAR: mep('solarEquipment', 'MEP_SOLAR', 'SOLAR'),
})

// A spec value the editor never set stays unset on rebuild, so the schema default applies.
function withoutNulls(obj) {
  return Object.fromEntries(Object.entries(obj ?? {}).filter(([, v]) => v !== null && v !== undefined))
}

export const ELEMENT_ENTRIES = Object.values(ELEMENT_REGISTRY)
export const ELEMENT_COLLECTIONS = ELEMENT_ENTRIES.map((e) => e.collection)
export const entryForErpKind = (kind) => ELEMENT_REGISTRY[kind] ?? null
export const entryForCollection = (collection) =>
  ELEMENT_ENTRIES.find((e) => e.collection === collection) ?? null
