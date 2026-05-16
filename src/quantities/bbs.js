// Phase 1.7 — Bar Bending Schedule aggregator.
//
// Pure function: takes the live store state and returns BBS breakdown for
// every column / beam-level / footing / slab that has a reinforcementSpecId
// (entity-level) or a matching projectSettings.bbsDefaults[elementType]
// (project-level fallback).
//
// Entities WITHOUT a spec are skipped here — getSteelQuantities() continues
// to estimate their steel via kg/m³. The boq/lines aggregator should label
// each steel row "BBS" vs "Est." based on which path computed it.

import {
  computeColumnBBS,
  computeBeamBBS,
  computeFootingBBS,
  computeSlabBBS,
} from '../specs/reinforcementSpecs'
import { BEAM_LEVEL_REGISTRY } from '../constants/structural'

// Resolve a spec id for one entity: entity override → project default → null.
function resolveSpec(entitySpecId, elementType, specMap, defaults) {
  const id = entitySpecId ?? defaults?.[elementType] ?? null
  if (!id) return null
  return specMap[id] ?? null
}

export function computeBBSQuantities(state) {
  const {
    columns,
    beams,
    slabs,
    foundations,
    projectSettings,
  } = state

  const specMap  = projectSettings?.reinforcementSpecs ?? {}
  const defaults = projectSettings?.bbsDefaults ?? {}
  const columnTypes = projectSettings?.columnTypes ?? []

  const byColumn    = []
  const byBeamLevel = Object.fromEntries(BEAM_LEVEL_REGISTRY.map(lvl => [lvl.id, null]))
  const byFooting   = []
  const bySlab      = []
  let totalKg = 0

  // ── Columns ────────────────────────────────────────────────────────────────
  for (const col of Object.values(columns ?? {})) {
    const spec = resolveSpec(col.reinforcementSpecId, 'COLUMN', specMap, defaults)
    if (!spec) continue
    const ct = columnTypes.find(t => t.id === col.columnTypeId)
    if (!ct) continue
    const heightFt = state.getColumnHeightFt(col)
    const { longitudinalKg, stirrupKg, totalKg: ckg } = computeColumnBBS(spec, heightFt, ct)
    byColumn.push({
      columnId: col.id,
      label: ct.label,
      specId: spec.id,
      longitudinalKg,
      stirrupKg,
      totalKg: ckg,
    })
    totalKg += ckg
  }

  // ── Beams (per level — beam entities don't all carry reinforcementSpecId yet
  // in Phase 1.7; we honour entity-level overrides where present and otherwise
  // fall back to project-default per level). For now we aggregate by level
  // using the total length from getBeamQuantities() and assume all beams in
  // that level share the same spec resolution (per-beam overrides can later
  // emit additional byBeamLevel splits — schema already supports it).
  const beamQtys = state.getBeamQuantities()
  for (const lvl of BEAM_LEVEL_REGISTRY) {
    const lq = beamQtys[lvl.id]
    if (!lq || !lq.totalLenFt) continue
    // Find a representative spec: first beam at this level with a specId,
    // else project default.
    let specId = null
    for (const b of Object.values(beams ?? {})) {
      if (b.level === lvl.id && b.reinforcementSpecId) { specId = b.reinforcementSpecId; break }
    }
    const spec = resolveSpec(specId, 'BEAM', specMap, defaults)
    if (!spec) continue
    const { topKg, bottomKg, stirrupKg, totalKg: bkg } =
      computeBeamBBS(spec, lq.totalLenFt, lq.widthIn, lq.depthIn)
    byBeamLevel[lvl.id] = {
      specId: spec.id,
      totalLengthFt: lq.totalLenFt,
      topKg,
      bottomKg,
      stirrupKg,
      totalKg: bkg,
    }
    totalKg += bkg
  }

  // ── Footings ───────────────────────────────────────────────────────────────
  // Two paths: inline auto-isolated (keyed by columnTypeId) and explicit
  // foundation entities. For inline, we use the column type's own
  // reinforcementSpecId (foundations may not exist yet) or the project default.
  const fdnQ = state.getFoundationQuantities()
  for (const [ctId, inline] of Object.entries(fdnQ.byColumnTypeInline ?? {})) {
    const ct = columnTypes.find(t => t.id === ctId)
    const specIdHint = ct?.reinforcementSpecId ?? null
    const spec = resolveSpec(specIdHint, 'FOOTING', specMap, defaults)
    if (!spec) continue
    const per = computeFootingBBS(spec, inline.lengthFt, inline.widthFt)
    const perKg = per.totalKg * inline.count
    byFooting.push({
      foundationId: null,
      columnTypeId: ctId,
      label: `${inline.label} footings (×${inline.count})`,
      specId: spec.id,
      xKg: per.xKg * inline.count,
      yKg: per.yKg * inline.count,
      totalKg: perKg,
    })
    totalKg += perKg
  }
  for (const f of Object.values(foundations ?? {})) {
    const spec = resolveSpec(f.reinforcementSpecId, 'FOOTING', specMap, defaults)
    if (!spec) continue
    const g = f.geometry || {}
    const lFt = g.lengthFt || 0, wFt = g.widthFt || 0
    if (!lFt || !wFt) continue
    const r = computeFootingBBS(spec, lFt, wFt)
    byFooting.push({
      foundationId: f.id,
      columnTypeId: null,
      label: f.label ?? `${f.type} foundation`,
      specId: spec.id,
      xKg: r.xKg,
      yKg: r.yKg,
      totalKg: r.totalKg,
    })
    totalKg += r.totalKg
  }

  // ── Slabs ──────────────────────────────────────────────────────────────────
  // Slab entities carry reinforcementSpecId (Stage 0 Fix 3). For each slab,
  // compute span/width from sqrt(area) (square approximation — Phase 2.0 will
  // refine via slab.geometry once polygon data is available).
  for (const slab of Object.values(slabs ?? {})) {
    const spec = resolveSpec(slab.reinforcementSpecId, 'SLAB', specMap, defaults)
    if (!spec) continue
    // Sum room areas in the slab
    let areaFt2 = 0
    for (const rid of (slab.roomIds ?? [])) {
      areaFt2 += state.getRoomArea?.(rid) ?? 0
    }
    if (areaFt2 <= 0) continue
    const sideFt = Math.sqrt(areaFt2)
    const r = computeSlabBBS(spec, areaFt2, sideFt, sideFt)
    bySlab.push({
      slabId: slab.id,
      type: slab.type,
      specId: spec.id,
      mainKg: r.mainKg,
      distKg: r.distKg,
      totalKg: r.totalKg,
    })
    totalKg += r.totalKg
  }

  return { byColumn, byBeamLevel, byFooting, bySlab, totalKg }
}
