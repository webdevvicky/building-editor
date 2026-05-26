// Phase 1.7+ — Bar Bending Schedule aggregator (per-instance + grouped-by-spec).
//
// Every entity (column / explicit beam / slab / foundation / inline footing
// bucket) is resolved through src/specs/resolution.js — this file never reads
// reinforcementSpecs / bbsDefaults directly. The resolver returns
//   { spec, specId, specLabel, source }
// where `source` is INSTANCE | TYPE | CLASS | PROJECT_DEFAULT | ESTIMATE.
//
// Entities resolved to ESTIMATE source are skipped here — their kg/m³ steel
// is computed by getSteelQuantities() with their id passed in excludeIds=...
// so the kg/m³ pool only covers what BBS did NOT compute. See boq/lines.js.
//
// Gap 3 (2026-05-26): byDiameter rollup added — buckets total kg per
// bar diameter (8/10/12/16/20/25/32 mm) across every BBS'd entity, with
// piece count at projectSettings.bbsDefaults.standardBarLengthM (default 6m).
// Drives the "Steel — by Bar Diameter" procurement section.
//
// Output shape additions:
//   byDiameter: {
//     [diaMm]: {
//       totalKg, pieces, weightPerPieceKg, standardBarLengthM,
//       byCategory: { column, beam, footing, slab },
//     },
//   }
//
// All lengths are in feet (matches reinforcementSpecs.js); kg via STEEL_UNIT_WEIGHT_KG_PER_M.

import {
  computeColumnBBS,
  computeBeamBBS,
  computeFootingBBS,
  computeSlabBBS,
  piecesForDia,
  weightPerPieceKg,
  STANDARD_BAR_LENGTH_M,
} from '../specs/reinforcementSpecs'
import {
  resolveColumnReinforcementSpecForColumn,
  resolveBeamReinforcementSpec,
  resolveSlabReinforcementSpecForSlab,
  resolveFootingReinforcementSpec,
} from '../specs/resolution'
import { resolveBeamEndpoint } from '../topology/beams.js'

function r2(n) { return Math.round(n * 100) / 100 }

function groupByResolvedSpec(rows, extraFields = () => ({})) {
  const byKey = new Map()
  for (const r of rows) {
    if (!r || r.source === 'ESTIMATE') continue
    const key = r.resolvedSpecId
    if (!byKey.has(key)) {
      byKey.set(key, {
        specId: r.resolvedSpecId,
        specLabel: r.specLabel,
        source: r.source,
        totalKg: 0,
        instanceCount: 0,
        sourceEntityIds: [],
        ...extraFields(r),
      })
    }
    const acc = byKey.get(key)
    acc.totalKg += (r.kg?.total ?? 0)
    acc.instanceCount += (r.instanceCount ?? 1)
    if (r.entityId) acc.sourceEntityIds.push(r.entityId)
    else if (r.entityIds) acc.sourceEntityIds.push(...r.entityIds)
  }
  const out = [...byKey.values()].map(g => ({ ...g, totalKg: r2(g.totalKg) }))
  out.sort((a, b) => b.totalKg - a.totalKg)
  return out
}

// Roll a single entity's kgByDia map into the per-diameter accumulator.
// Multiplier is `count` for inline-footing buckets (one spec covers N footings).
function _accumulateByDia(accumulator, kgByDia, category, multiplier = 1) {
  if (!kgByDia) return
  for (const [diaStr, kg] of Object.entries(kgByDia)) {
    if (!kg) continue
    const dia = Number(diaStr)
    if (!Number.isFinite(dia)) continue
    const scaled = kg * multiplier
    if (!accumulator[dia]) accumulator[dia] = { totalKg: 0, byCategory: {} }
    accumulator[dia].totalKg += scaled
    accumulator[dia].byCategory[category] = (accumulator[dia].byCategory[category] ?? 0) + scaled
  }
}

export function computeBBSQuantities(state) {
  const { columns, beams, slabs, foundations, projectSettings } = state
  const columnTypes = projectSettings?.columnTypes ?? []
  const standardBarLengthM = projectSettings?.bbsDefaults?.standardBarLengthM ?? STANDARD_BAR_LENGTH_M

  const byColumn  = []
  const byBeam    = []
  const byFooting = []
  const bySlab    = []
  let totalKg = 0

  // Per-diameter accumulator built up as we walk entities.
  // Shape: { [diaMm]: { totalKg, byCategory: { column, beam, footing, slab } } }
  const diaAccum = {}

  const excludeColumns      = new Set()
  const excludeBeams        = new Set()
  const excludeSlabs        = new Set()
  const excludeFoundations  = new Set()
  const excludeColumnTypeFootings = new Set()

  // ── Columns ────────────────────────────────────────────────────────────────
  for (const col of Object.values(columns ?? {})) {
    const ct = columnTypes.find(t => t.id === col.columnTypeId)
    if (!ct) continue
    const resolved = resolveColumnReinforcementSpecForColumn(state, col, ct)
    if (!resolved.spec) continue
    const heightFt = state.getColumnHeightFt(col)
    const r = computeColumnBBS(resolved.spec, heightFt, ct)
    byColumn.push({
      columnId:       col.id,
      entityId:       col.id,
      columnTypeId:   col.columnTypeId,
      label:          ct.label,
      resolvedSpecId: resolved.specId,
      specLabel:      resolved.specLabel,
      source:         resolved.source,
      kg: { longitudinal: r2(r.longitudinalKg), stirrup: r2(r.stirrupKg), total: r2(r.totalKg) },
      kgByDia:        r.kgByDia,
    })
    excludeColumns.add(col.id)
    totalKg += r.totalKg
    _accumulateByDia(diaAccum, r.kgByDia, 'column', 1)
  }

  // ── Beams ──────────────────────────────────────────────────────────────────
  const beamDims = projectSettings?.beamDimensions ?? {}
  const allBeams = state.getAllBeams?.() ?? Object.values(beams ?? {})
  const beamLengthsById = (() => {
    const lengths = new Map()
    for (const b of allBeams) {
      const from = resolveBeamEndpoint(state, b.endpoints.from)
      const to   = resolveBeamEndpoint(state, b.endpoints.to)
      if (!from || !to) continue
      lengths.set(b.id, Math.hypot(to.x - from.x, to.y - from.y) / 12)
    }
    return lengths
  })()
  for (const beam of allBeams) {
    const resolved = resolveBeamReinforcementSpec(state, beam)
    if (!resolved.spec) continue
    const lenFt = beamLengthsById.get(beam.id) ?? 0
    const dims = beamDims[beam.level]
    if (!dims || lenFt <= 0) continue
    const r = computeBeamBBS(resolved.spec, lenFt, dims.widthIn, dims.depthIn)
    const beamClass = beam.beamClass ?? beam.level
    byBeam.push({
      beamId:         beam.id,
      entityId:       beam.id,
      beamClass,
      lengthFt:       r2(lenFt),
      resolvedSpecId: resolved.specId,
      specLabel:      resolved.specLabel,
      source:         resolved.source,
      kg: { top: r2(r.topKg), bottom: r2(r.bottomKg), stirrup: r2(r.stirrupKg), total: r2(r.totalKg) },
      kgByDia:        r.kgByDia,
    })
    excludeBeams.add(beam.id)
    totalKg += r.totalKg
    _accumulateByDia(diaAccum, r.kgByDia, 'beam', 1)
  }

  // ── Footings: inline auto-isolated buckets (keyed by columnTypeId) ─────────
  const fdnQ = state.getFoundationQuantities()
  for (const [ctId, inline] of Object.entries(fdnQ.byColumnTypeInline ?? {})) {
    const resolved = resolveFootingReinforcementSpec(state, { columnTypeId: ctId })
    if (!resolved.spec) continue
    const per = computeFootingBBS(resolved.spec, inline.lengthFt, inline.widthFt)
    const totalKgForBucket = per.totalKg * inline.count
    byFooting.push({
      foundationId:   null,
      columnTypeId:   ctId,
      entityId:       null,
      entityIds:      [],
      label:          `${inline.label} footings (×${inline.count})`,
      count:          inline.count,
      resolvedSpecId: resolved.specId,
      specLabel:      resolved.specLabel,
      source:         resolved.source,
      instanceCount:  inline.count,
      kg: { x: r2(per.xKg * inline.count), y: r2(per.yKg * inline.count), total: r2(totalKgForBucket) },
      kgByDia:        per.kgByDia,   // per single footing — count is applied in _accumulateByDia
    })
    excludeColumnTypeFootings.add(ctId)
    totalKg += totalKgForBucket
    _accumulateByDia(diaAccum, per.kgByDia, 'footing', inline.count)
  }
  // ── Footings: foundation entities ──────────────────────────────────────────
  for (const f of Object.values(foundations ?? {})) {
    const resolved = resolveFootingReinforcementSpec(state, { foundationId: f.id })
    if (!resolved.spec) continue
    const g = f.geometry || {}
    const lFt = g.lengthFt || 0, wFt = g.widthFt || 0
    if (!lFt || !wFt) continue
    const r = computeFootingBBS(resolved.spec, lFt, wFt)
    byFooting.push({
      foundationId:   f.id,
      columnTypeId:   null,
      entityId:       f.id,
      label:          f.label ?? `${f.type} foundation`,
      count:          1,
      resolvedSpecId: resolved.specId,
      specLabel:      resolved.specLabel,
      source:         resolved.source,
      instanceCount:  1,
      kg: { x: r2(r.xKg), y: r2(r.yKg), total: r2(r.totalKg) },
      kgByDia:        r.kgByDia,
    })
    excludeFoundations.add(f.id)
    totalKg += r.totalKg
    _accumulateByDia(diaAccum, r.kgByDia, 'footing', 1)
  }

  // ── Slabs ──────────────────────────────────────────────────────────────────
  const validSet = new Set(state.getValidRoomIds?.() ?? [])
  for (const slab of Object.values(slabs ?? {})) {
    const resolved = resolveSlabReinforcementSpecForSlab(state, slab)
    if (!resolved.spec) continue
    let areaFt2 = 0
    for (const rid of (slab.roomIds ?? [])) {
      if (validSet.size && !validSet.has(rid)) continue
      areaFt2 += state.getRoomArea?.(rid) ?? 0
    }
    if (areaFt2 <= 0) continue
    const sideFt = Math.sqrt(areaFt2)
    const r = computeSlabBBS(resolved.spec, areaFt2, sideFt, sideFt)
    bySlab.push({
      slabId:         slab.id,
      entityId:       slab.id,
      type:           slab.type,
      areaFt2:        r2(areaFt2),
      resolvedSpecId: resolved.specId,
      specLabel:      resolved.specLabel,
      source:         resolved.source,
      kg: { main: r2(r.mainKg), dist: r2(r.distKg), total: r2(r.totalKg) },
      kgByDia:        r.kgByDia,
    })
    excludeSlabs.add(slab.id)
    totalKg += r.totalKg
    _accumulateByDia(diaAccum, r.kgByDia, 'slab', 1)
  }

  // ── Grouped-by-resolved-spec ───────────────────────────────────────────────
  const groupedBySpec = {
    column:  groupByResolvedSpec(byColumn),
    beam:    groupByResolvedSpec(byBeam, (r) => ({ beamClass: r.beamClass })),
    footing: groupByResolvedSpec(
      byFooting.map(f => ({ ...f, instanceCount: f.count })),
    ),
    slab:    groupByResolvedSpec(bySlab),
  }

  const bbsCoveredKg = {
    column:  groupedBySpec.column.reduce((s, g) => s + g.totalKg, 0),
    beam:    groupedBySpec.beam.reduce((s, g) => s + g.totalKg, 0),
    footing: groupedBySpec.footing.reduce((s, g) => s + g.totalKg, 0),
    slab:    groupedBySpec.slab.reduce((s, g) => s + g.totalKg, 0),
  }

  // ── byDiameter rollup (Gap 3) ──────────────────────────────────────────────
  const byDiameter = {}
  // Sort diameter keys numerically for stable iteration.
  const diaKeys = Object.keys(diaAccum).map(Number).sort((a, b) => a - b)
  for (const dia of diaKeys) {
    const bucket = diaAccum[dia]
    const rounded = r2(bucket.totalKg)
    if (rounded <= 0) continue
    byDiameter[dia] = {
      diaMm:             dia,
      totalKg:           rounded,
      pieces:            piecesForDia(rounded, dia, standardBarLengthM),
      weightPerPieceKg:  r2(weightPerPieceKg(dia, standardBarLengthM)),
      standardBarLengthM,
      byCategory: {
        column:  r2(bucket.byCategory.column  ?? 0),
        beam:    r2(bucket.byCategory.beam    ?? 0),
        footing: r2(bucket.byCategory.footing ?? 0),
        slab:    r2(bucket.byCategory.slab    ?? 0),
      },
    }
  }

  return {
    byColumn,
    byBeam,
    byFooting,
    bySlab,
    groupedBySpec,
    bbsCoveredKg,
    byDiameter,
    standardBarLengthM,
    excludeIds: {
      columns:             excludeColumns,
      beams:               excludeBeams,
      slabs:               excludeSlabs,
      foundations:         excludeFoundations,
      columnTypeFootings:  excludeColumnTypeFootings,
    },
    totalKg: r2(totalKg),
  }
}
