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
//   - toEditorShape(erpEl)          : ERP → editor (mm→inch), collection fields
//
// The /25.4 conversion lives ONLY in syncMappers (inToMm/mmToIn); registry
// entries compose it. No per-kind branching exists outside this file.

import { inToMm, mmToIn, edgeLengthMm } from './syncMappers.js'

const xy = (el) => ({ posXMm: inToMm(el.x), posYMm: inToMm(el.y) })
const point = (e) => ({ x: mmToIn(e.posXMm), y: mmToIn(e.posYMm) })

function beamPoint(state, ref) {
  if (!ref) return null
  if (ref.type === 'POINT') return { x: ref.x, y: ref.y }
  if (ref.type === 'COLUMN') { const c = state?.columns?.[ref.columnId]; return c ? { x: c.x, y: c.y } : null }
  return null
}

// MEP disciplines all share one positional shape (kind ⇄ discipline).
const mep = (collection, erpKind, discipline) => ({
  collection, erpKind, erpOpType: 'ADD_ELEMENT',
  toErpPayload: (el) => ({ ifcGlobalId: el.ifcGlobalId, ...xy(el) }),
  toEditorShape: (e) => ({
    ...point(e), discipline, type: e.elementType ?? 'UNKNOWN',
    wallId: null, wallT: null, roomId: null, rotationDeg: 0,
    systemId: null, systemType: null, ifcType: null, classificationCode: null, meta: null,
  }),
})

// Position-only structural shape (staircase / foundation / lift shaft·riser).
const positional = (collection, erpKind) => ({
  collection, erpKind, erpOpType: 'ADD_ELEMENT',
  toErpPayload: (el) => ({ ifcGlobalId: el.ifcGlobalId, ...xy({ x: el.x ?? 0, y: el.y ?? 0 }) }),
  toEditorShape: (e) => ({ ...point(e), meta: null }),
})

export const ELEMENT_REGISTRY = Object.freeze({
  COLUMN: {
    collection: 'columns', erpKind: 'COLUMN', erpOpType: 'ADD_ELEMENT',
    toErpPayload: (el) => ({ ifcGlobalId: el.ifcGlobalId, ...xy(el) }),
    toEditorShape: (e) => ({
      ...point(e), columnTypeId: null, attachedNodeId: null,
      baseFloorId: 'F1', topFloorId: 'F1', classification: null,
      reinforcementSpecId: null, segments: null, meta: null,
    }),
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
      return p
    },
    toEditorShape: (e) => ({
      endpoints: {
        from: { type: 'POINT', x: mmToIn(e.fromXMm), y: mmToIn(e.fromYMm) },
        to: { type: 'POINT', x: mmToIn(e.toXMm), y: mmToIn(e.toYMm) },
      },
      level: 'PLINTH', source: 'EXPLICIT', meta: null,
    }),
  },
  SLAB: {
    collection: 'slabs', erpKind: 'SLAB', erpOpType: 'ADD_ELEMENT',
    toErpPayload: (el, state) => ({
      ifcGlobalId: el.ifcGlobalId,
      thicknessMm: inToMm(el.thicknessIn),
      roomIds: (el.roomIds ?? []).map((rid) => state?.rooms?.[rid]?.ifcGlobalId).filter(Boolean),
    }),
    toEditorShape: (e) => ({
      type: 'MAIN', roomIds: e.roomSourceEditorIds ?? [],
      thicknessIn: mmToIn(e.thicknessMm), sinkDepthIn: 0, grade: 'M20',
      classification: null, role: 'MAIN', roleSource: 'AUTO', reinforcementSpecId: null, meta: null,
    }),
  },
  STAIRCASE: positional('staircases', 'STAIRCASE'),
  FOUNDATION: positional('foundations', 'FOUNDATION'),
  RISER: positional('risers', 'RISER'), // editor "lift shaft" ⇄ ERP RISER
  MEP_PLUMBING: mep('plumbingFixtures', 'MEP_PLUMBING', 'PLUMBING'),
  MEP_ELECTRICAL: mep('electricalPoints', 'MEP_ELECTRICAL', 'ELECTRICAL'),
  MEP_HVAC: mep('hvacUnits', 'MEP_HVAC', 'HVAC'),
  MEP_FIRE: mep('fireDevices', 'MEP_FIRE', 'FIRE'),
  MEP_ELV: mep('elvDevices', 'MEP_ELV', 'ELV'),
  MEP_SOLAR: mep('solarEquipment', 'MEP_SOLAR', 'SOLAR'),
})

export const ELEMENT_ENTRIES = Object.values(ELEMENT_REGISTRY)
export const ELEMENT_COLLECTIONS = ELEMENT_ENTRIES.map((e) => e.collection)
export const entryForErpKind = (kind) => ELEMENT_REGISTRY[kind] ?? null
export const entryForCollection = (collection) =>
  ELEMENT_ENTRIES.find((e) => e.collection === collection) ?? null
