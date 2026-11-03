// structuralFacts.js — what the ERP needs to quantify one structural element (XR-02,
// erp-saas D-271), as ONE pure function of the element and the project state:
//
//   structuralFacts(erpKind, el, state) → { section…, heightMm?, areaSqft?, thicknessMm?,
//                                           concreteGrade?, steelGrade, bars }
//
// - the section as REAL sizes (a column's type id is resolved here — the ERP cannot
//   read editor type ids): `sectionShape` RECT | CIRCLE, width/depth or diameter, mm;
// - the length the concrete runs over: a column's height, a slab's plan area, a
//   footing pad's depth (a beam's span travels with its endpoints in the registry);
// - the grades: the element's concrete grade (else the project's for that kind) and
//   the IS-2502 steel grade;
// - the bars, ONLY from the IS-2502 engine (`computeRebarGroups`), never the legacy
//   `computeBBSQuantities`; integer mm, every field the ERP stores.
//
// It never works out concrete m³ or steel kg: the ERP does, from these facts. The live
// element payload (`elementRegistry.toErpPayload`) spreads it; a canonical-document
// projection can write the same object. Pure: no store, no network.

import { inToMm, ftToMm } from './syncMappers.js'
import { computeRebarGroups } from '../bbs/index.js'
import { getIs2502Params } from '../specs/cuttingLength.js'
import { resolveColumnSectionForFloor } from '../specs/resolution.js'
import { getColumnHeightFt } from '../topology/columns.js'
import { getRoomGeometry } from '../topology/rooms.js'
import { safeR2, safeRound } from '../lib/numbers.js'

// ── Bars: one IS-2502 run per project state, grouped by the element they belong to ──
// The state object is immutable per store version, so a WeakMap keyed on it runs the
// engine once however many elements (and change signatures) read it.
const _barsByState = new WeakMap()
function barsOf(state, elementId) {
  let byElement = _barsByState.get(state)
  if (!byElement) {
    byElement = new Map()
    for (const g of computeRebarGroups(state).groups) {
      if (!(g.count > 0) || !(g.totalWeightKg > 0)) continue
      const bars = byElement.get(g.elementId) ?? []
      bars.push({
        markId: g.markId,
        role: g.role,
        diaMm: g.diaMm,
        shapeCode: g.shapeCode,
        cuttingLengthMm: Math.round(g.cuttingLengthMm),
        count: g.count,
        totalLengthM: safeRound(g.totalLengthM, 3),
        totalWeightKg: safeRound(g.totalWeightKg, 3),
        ...(g.meta?.bbsCategory ? { bbsCategory: g.meta.bbsCategory } : {}),
      })
      byElement.set(g.elementId, bars)
    }
    _barsByState.set(state, byElement)
  }
  return byElement.get(elementId) ?? []
}

// A column's section on its base floor, as real sizes.
function columnSection(state, el) {
  const ct = resolveColumnSectionForFloor(state, el, el.baseFloorId ?? el.floorId ?? null)
  if (!ct) return {}
  if (ct.shape === 'circle') return { sectionShape: 'CIRCLE', diameterMm: inToMm(ct.diamIn) }
  return { sectionShape: 'RECT', sectionWidthMm: inToMm(ct.widthIn), sectionDepthMm: inToMm(ct.depthIn) }
}

// A beam's section: the project's size for its class (plinth / lintel / roof / tie).
function beamSection(state, el) {
  const dims = state.projectSettings.beamDimensions?.[el.beamClass ?? el.level]
  return dims ? { sectionShape: 'RECT', sectionWidthMm: inToMm(dims.widthIn), sectionDepthMm: inToMm(dims.depthIn) } : {}
}

// A slab's plan area: the centreline areas of the rooms it covers (as the editor's concrete does).
function slabArea(state, el) {
  let area = 0
  for (const rid of (el.roomIds ?? [])) area += getRoomGeometry(state, rid, 'centerline')?.area ?? 0
  return { areaSqft: safeR2(area) }
}

// An isolated or combined footing is one pad (length × width × depth); a strap footing
// is two pads and a strap, which one typed section cannot hold, so it sends no section.
function footingPad(el) {
  const g = el.geometry ?? {}
  if (el.type !== 'ISOLATED' && el.type !== 'COMBINED') return {}
  if (!(g.lengthFt > 0 && g.widthFt > 0 && g.depthFt > 0)) return {}
  return { sectionShape: 'RECT', sectionWidthMm: ftToMm(g.widthFt), sectionDepthMm: ftToMm(g.lengthFt), thicknessMm: ftToMm(g.depthFt) }
}

// Per structural kind: its row in projectSettings.rccSpecs.concreteGrade and its sizes.
const STRUCTURAL_KINDS = Object.freeze({
  COLUMN: { rccKey: 'COLUMN', sizes: (state, el) => ({ ...columnSection(state, el), heightMm: ftToMm(getColumnHeightFt(state, el)) }) },
  BEAM: { rccKey: 'BEAM', sizes: beamSection },
  SLAB: { rccKey: 'SLAB', sizes: slabArea },
  FOUNDATION: { rccKey: 'FOOTING', sizes: (_state, el) => footingPad(el) },
  STAIRCASE: { rccKey: 'STAIRCASE', sizes: () => ({}) },
})

/** The structural facts of one element (see the file header). Throws for a non-structural kind. */
export function structuralFacts(erpKind, el, state) {
  const kind = STRUCTURAL_KINDS[erpKind]
  if (!kind) throw new Error(`structuralFacts: ${erpKind} is not a structural element kind`)
  const concreteGrade = el.grade ?? state.projectSettings.rccSpecs?.concreteGrade?.[kind.rccKey] ?? null
  return {
    ...kind.sizes(state, el),
    ...(concreteGrade ? { concreteGrade } : {}),
    steelGrade: getIs2502Params(state).defaultSteelGrade,
    bars: barsOf(state, el.id),
  }
}
