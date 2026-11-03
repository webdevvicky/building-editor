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
import { resolveBeamEndpoint, getDerivedWallBeams, tieBeamForWall } from '../topology/beams.js'
import { DERIVATION_KIND, inlineFootingColumns } from '../topology/derivedMembers.js'

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

// ── Derived members (D-280): a band, footing, sunshade or loft the BBS engine builds from
// its parent. Each is quantified like the drawn element of its ERP kind — a band as a
// BEAM (section × span), a footing as a FOUNDATION pad, a sunshade or loft as a SLAB
// (plan width × depth × thickness) — from its parent's sizes and its own bars.

const beamEnds = (state, beam) => {
  const f = resolveBeamEndpoint(state, beam.endpoints?.from)
  const t = resolveBeamEndpoint(state, beam.endpoints?.to)
  if (!f || !t) return {}
  return {
    fromXMm: inToMm(f.x), fromYMm: inToMm(f.y), toXMm: inToMm(t.x), toYMm: inToMm(t.y),
    spanMm: inToMm(Math.hypot(t.x - f.x, t.y - f.y)),
  }
}

function bandSizes(state, member) {
  const beam = member.derivationKind === DERIVATION_KIND.TIE_BEAM
    ? tieBeamForWall(state, member.hostWallId, member.id)
    : getDerivedWallBeams(state).find((b) => b.sourceWallId === member.hostWallId && b.level === member.level)
  if (!beam) return {}
  return { structuralLevel: member.level, ...beamSection(state, { level: member.level }), ...beamEnds(state, beam) }
}

function footingSizes(state, member) {
  const hit = inlineFootingColumns(state).find((x) => x.column.id === member.hostColumnId)
  if (!hit) return {}
  const { column, columnType: ct } = hit
  const at = column.attachedNodeId ? state.nodes?.[column.attachedNodeId] : column
  return {
    ...(at ? { posXMm: inToMm(at.x), posYMm: inToMm(at.y) } : {}),
    sectionShape: 'RECT', sectionWidthMm: ftToMm(ct.footingWidthFt), sectionDepthMm: ftToMm(ct.footingLengthFt),
    thicknessMm: ftToMm(ct.footingDepthFt),
  }
}

// A point a given distance along a wall from its n1 node (null: the wall's middle).
function alongWall(state, wall, offsetIn) {
  const a = state.nodes?.[wall.n1], b = state.nodes?.[wall.n2]
  if (!a || !b) return {}
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  if (len === 0) return {}
  const t = offsetIn == null ? 0.5 : offsetIn / len
  return { posXMm: inToMm(a.x + (b.x - a.x) * t), posYMm: inToMm(a.y + (b.y - a.y) * t) }
}

function sunshadeSizes(state, member) {
  const wall = state.walls?.[member.hostWallId]
  const opening = wall?.openings?.find((o) => o.id === member.hostOpeningId)
  const ss = state.projectSettings.sunshadeSettings ?? {}
  if (!opening || !(ss.projectionFt > 0) || !(ss.thicknessIn > 0)) return {}
  return {
    ...alongWall(state, wall, (opening.offset ?? 0) + opening.width / 2),
    sectionShape: 'RECT', sectionWidthMm: inToMm(opening.width), sectionDepthMm: ftToMm(ss.projectionFt),
    thicknessMm: inToMm(ss.thicknessIn),
  }
}

// A loft's slab is its width × depth; its thickness is the one the loft records — an
// unset thickness sends none, so the ERP quantifies its bars and no concrete.
function loftSizes(state, member) {
  const wall = state.walls?.[member.hostWallId]
  const loft = wall?.loft
  if (!loft) return {}
  return {
    ...alongWall(state, wall, null),
    sectionShape: 'RECT', sectionWidthMm: ftToMm(loft.widthFt), sectionDepthMm: ftToMm(loft.depthFt),
    ...(loft.thicknessIn > 0 ? { thicknessMm: inToMm(loft.thicknessIn) } : {}),
  }
}

const DERIVED_KINDS = Object.freeze({
  WALL_BEAM: { erpKind: 'BEAM', rccKey: 'BEAM', sizes: bandSizes },
  TIE_BEAM: { erpKind: 'BEAM', rccKey: 'BEAM', sizes: bandSizes },
  INLINE_FOOTING: { erpKind: 'FOUNDATION', rccKey: 'FOOTING', sizes: footingSizes },
  SUNSHADE: { erpKind: 'SLAB', rccKey: 'SLAB', sizes: sunshadeSizes },
  LOFT: { erpKind: 'SLAB', rccKey: 'SLAB', sizes: loftSizes },
})

/** The ERP element kind a derived member is quantified as. */
export function derivedMemberErpKind(member) {
  return DERIVED_KINDS[member.derivationKind].erpKind
}

/** The structural facts of one derived member: its sizes, grades and bars (never m³ or kg). */
export function derivedMemberFacts(member, state) {
  const kind = DERIVED_KINDS[member.derivationKind]
  const concreteGrade = state.projectSettings.rccSpecs?.concreteGrade?.[kind.rccKey] ?? null
  return {
    ...kind.sizes(state, member),
    ...(concreteGrade ? { concreteGrade } : {}),
    steelGrade: getIs2502Params(state).defaultSteelGrade,
    bars: barsOf(state, member.id),
  }
}
