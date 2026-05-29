// Footing rebar group generator — IS 2502 / SP 34 compliant.
//
// 2026-05-28. Pure function. No React, no DOM, no Zustand. Emits
// RebarGroup[] (X mesh + Y mesh + dowels) for a single footing descriptor.
//
// Behaviour gates:
//   • FOUNDATION_ENTITY of type RAFT/STRIP/PILE → return [] (deferred to
//     dedicated generators — RAFT mesh, STRIP linear, PILE shaft+cap).
//   • FOUNDATION_ENTITY of type ISOLATED/COMBINED → X + Y mesh + dowels
//     (one dowel group per unique column type served).
//   • INLINE_BUCKET → X + Y mesh + dowels (one dowel group, count =
//     columnSpec.longitudinalBarCount × inline.count).
//
// X/Y mesh math fix vs the legacy computeFootingBBS:
//   the legacy code used max(xDia, yDia) for development length on BOTH
//   directions. The correct IS 456 reading is that each bar's anchorage
//   length depends on its OWN diameter. Each direction here uses
//   developmentLengthMm({ diaMm: spec.<dir>Bars.diaMm, ... }).
//
// Dowel geometry (IS 2502 shape '11', L-bar):
//   Leg A = Ld_compression (embed straight down into footing)
//   Leg B = lap length (project up above footing top to lap with column
//                       longitudinal bars on the cast lift above)
//   One 90° bend at the elbow, no end hooks.

import {
  resolveFootingReinforcementSpec,
  resolveColumnReinforcementSpecForColumn,
} from '../../specs/resolution.js'
import {
  computeStraightBarCuttingLengthMm,
  computeLBarCuttingLengthMm,
  developmentLengthCompressionMm,
  lapLengthMm,
  ftToMm,
} from '../../specs/cuttingLength.js'
import { ELEMENT_TYPE, REBAR_ROLE, SHAPE_CODE, makeRebarGroup } from '../types.js'
import { buildStrapFootingGroups } from './strapFootingRebar.js'

// RAFT / STRIP / PILE remain deferred (dedicated generators). STRAP is now
// built (BBS-categories phase) via strapFootingRebar.js.
const DEFERRED_FOUNDATION_TYPES = new Set(['RAFT', 'STRIP', 'PILE'])

// ── Public entry ────────────────────────────────────────────────────────────
export function generateFootingRebarGroups(ctx, descriptor) {
  if (!ctx || !descriptor) return []
  const { state, params } = ctx
  if (!state || !params) return []

  if (descriptor.kind === 'FOUNDATION_ENTITY') {
    const foundation = descriptor.foundation
    if (!foundation) return []
    if (foundation.type === 'STRAP') return buildStrapFootingGroups(state, params, foundation)
    if (DEFERRED_FOUNDATION_TYPES.has(foundation.type)) return []
    return _buildForFoundationEntity(state, params, foundation)
  }

  if (descriptor.kind === 'INLINE_BUCKET') {
    return _buildForInlineBucket(
      state,
      params,
      descriptor.columnTypeId,
      descriptor.inline,
      descriptor.floorId,
    )
  }

  return []
}

// ── FOUNDATION_ENTITY (ISOLATED / COMBINED) ─────────────────────────────────
function _buildForFoundationEntity(state, params, foundation) {
  const resolved = resolveFootingReinforcementSpec(state, { foundationId: foundation.id })
  if (!resolved.spec) return []

  const geom = foundation.geometry || {}
  const lengthFt = geom.lengthFt || 0
  const widthFt  = geom.widthFt  || 0
  if (lengthFt <= 0 || widthFt <= 0) return []

  const footingLabel = _sanitizeLabel(foundation.label) ?? `F-${String(foundation.id).slice(0, 4)}`
  const groups = []

  // X + Y mesh (one footing).
  groups.push(..._buildMeshGroups({
    spec:          resolved.spec,
    specId:        resolved.specId,
    specSource:    resolved.source,
    params,
    lengthFt,
    widthFt,
    footingLabel,
    elementId:     foundation.id,
    floorId:       foundation.floorId,
    footingCount:  1,
  }))

  // Dowels — one group per unique column type referenced by the foundation.
  groups.push(..._buildDowelGroupsForFoundation({
    state,
    params,
    foundation,
    resolved,
    footingLabel,
  }))

  return groups
}

// ── INLINE_BUCKET (auto-isolated, keyed by columnTypeId) ────────────────────
function _buildForInlineBucket(state, params, columnTypeId, inline, floorId) {
  if (!columnTypeId || !inline) return []
  const { lengthFt = 0, widthFt = 0, count = 0 } = inline
  if (lengthFt <= 0 || widthFt <= 0 || count <= 0) return []

  const resolved = resolveFootingReinforcementSpec(state, { columnTypeId })
  if (!resolved.spec) return []

  const footingLabel = _sanitizeLabel(inline.label) ?? `F-${columnTypeId}`
  const elementId = `INLINE:${columnTypeId}`
  const groups = []

  // X + Y mesh — counts multiplied by inline.count (bucket aggregates N footings).
  groups.push(..._buildMeshGroups({
    spec:          resolved.spec,
    specId:        resolved.specId,
    specSource:    resolved.source,
    params,
    lengthFt,
    widthFt,
    footingLabel,
    elementId,
    floorId,
    footingCount:  count,
  }))

  // Dowels — pick a representative column of this type to resolve column spec.
  const repColumn = _findRepresentativeColumnForType(state, columnTypeId)
  if (repColumn) {
    const columnTypes = state.projectSettings?.columnTypes ?? []
    const ct = columnTypes.find(t => t.id === columnTypeId)
    const colResolved = resolveColumnReinforcementSpecForColumn(state, repColumn, ct)
    if (colResolved.spec) {
      const cSpec = colResolved.spec
      const totalDowels = (cSpec.longitudinalBarCount ?? 0) * count
      if (totalDowels > 0) {
        groups.push(_buildDowelGroup({
          params,
          markId:        `${footingLabel}-D`,
          elementId,
          floorId,
          columnSpec:    cSpec,
          columnSpecId:  colResolved.specId,
          columnSource:  colResolved.source,
          count:         totalDowels,
          columnTypeId,
          parentMark:    footingLabel,
        }))
      }
    }
  }

  return groups
}

// ── Mesh group builder (X + Y) ──────────────────────────────────────────────
function _buildMeshGroups({
  spec, specId, specSource, params,
  lengthFt, widthFt, footingLabel,
  elementId, floorId, footingCount,
}) {
  const widthMm  = ftToMm(widthFt)
  const lengthMm = ftToMm(lengthFt)
  const coverMm  = spec.coverMm ?? 40

  // BE-Footing-Ld-001 fix (2026-05-29): a footing mesh bar SPANS the pad — its
  // length is the pad dimension minus cover each side, plus a standard end hook
  // (bent up). Development length is SATISFIED BY that span, it is NOT added to
  // it. Pre-fix the engine added 2×Ld and over-counted footing steel ~88%/bar.
  // End hooks come from the cutting-length engine (hookEndCount: 2 → 2×9d in
  // IS_STRICT; flat 0.25ft in SITE_PRACTICE via the params hook allowance).
  const xClearMm = Math.max(0, widthMm  - 2 * coverMm)   // X bars span the WIDTH
  const yClearMm = Math.max(0, lengthMm - 2 * coverMm)   // Y bars span the LENGTH
  const hookXMm = params.hookAllowance9d * spec.xBars.diaMm
  const hookYMm = params.hookAllowance9d * spec.yBars.diaMm
  const xCuttingMm = computeStraightBarCuttingLengthMm({
    lengthMm: xClearMm, diaMm: spec.xBars.diaMm, hookEndCount: 2, params,
  })
  const yCuttingMm = computeStraightBarCuttingLengthMm({
    lengthMm: yClearMm, diaMm: spec.yBars.diaMm, hookEndCount: 2, params,
  })

  const xGroup = makeRebarGroup({
    markId:           `${footingLabel}-X`,
    elementType:      ELEMENT_TYPE.FOOTING,
    elementId,
    floorId,
    role:             REBAR_ROLE.X_MESH,
    diaMm:            spec.xBars.diaMm,
    shapeCode:        SHAPE_CODE.STRAIGHT,
    bendAnglesDeg:    [],
    nominalDimensions: { A: Math.round(xClearMm), B: Math.round(hookXMm) },
    cuttingLengthMm:  xCuttingMm,
    count:            spec.xBars.count * footingCount,
    specId,
    specSource,
    steelGrade:       params.defaultSteelGrade,
    meta: {
      description:  'Footing X-direction bottom mesh (spans pad − 2×cover + end hooks)',
      clearSpanMm:  Math.round(xClearMm),
      endHookMm:    Math.round(hookXMm),
      parentMark:   footingLabel,
      footingCount,
    },
  })

  const yGroup = makeRebarGroup({
    markId:           `${footingLabel}-Y`,
    elementType:      ELEMENT_TYPE.FOOTING,
    elementId,
    floorId,
    role:             REBAR_ROLE.Y_MESH,
    diaMm:            spec.yBars.diaMm,
    shapeCode:        SHAPE_CODE.STRAIGHT,
    bendAnglesDeg:    [],
    nominalDimensions: { A: Math.round(yClearMm), B: Math.round(hookYMm) },
    cuttingLengthMm:  yCuttingMm,
    count:            spec.yBars.count * footingCount,
    specId,
    specSource,
    steelGrade:       params.defaultSteelGrade,
    meta: {
      description:  'Footing Y-direction bottom mesh (spans pad − 2×cover + end hooks)',
      clearSpanMm:  Math.round(yClearMm),
      endHookMm:    Math.round(hookYMm),
      parentMark:   footingLabel,
      footingCount,
    },
  })

  return [xGroup, yGroup]
}

// ── Dowel groups for a foundation entity ────────────────────────────────────
// One dowel group per unique column type referenced by foundation.columnIds.
// When the foundation carries multiple column types, the dowel markId
// suffix is `-D-<typeMark>` so each group is distinct.
function _buildDowelGroupsForFoundation({
  state, params, foundation, resolved: _footingResolved, footingLabel,
}) {
  const columnIds = Array.isArray(foundation.columnIds) ? foundation.columnIds : []
  if (columnIds.length === 0) return []

  const columnTypes = state.projectSettings?.columnTypes ?? []

  // Group served columns by columnTypeId.
  const byType = new Map() // ctId → { ct, columns: Column[] }
  for (const colId of columnIds) {
    const col = state.columns?.[colId]
    if (!col) continue
    const ctId = col.columnTypeId
    if (!ctId) continue
    if (!byType.has(ctId)) {
      const ct = columnTypes.find(t => t.id === ctId) ?? null
      byType.set(ctId, { ct, columns: [] })
    }
    byType.get(ctId).columns.push(col)
  }

  if (byType.size === 0) return []

  const mixed = byType.size > 1
  const groups = []

  // Stable ordering for determinism — sort by columnTypeId lex asc.
  const sortedEntries = [...byType.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

  for (const [ctId, { ct, columns }] of sortedEntries) {
    // Representative column = first one (they share columnTypeId; spec
    // resolution will return the same chain unless one carries an
    // instance override, in which case the per-instance variation
    // belongs in a follow-up pass — out of scope here).
    const repColumn = columns[0]
    const colResolved = resolveColumnReinforcementSpecForColumn(state, repColumn, ct)
    if (!colResolved.spec) continue

    const cSpec = colResolved.spec
    const longCount = cSpec.longitudinalBarCount ?? 0
    if (longCount <= 0) continue

    const totalDowels = longCount * columns.length

    const suffix = mixed ? `-D-${_sanitizeLabel(ctId) ?? ctId}` : '-D'
    const markId = `${footingLabel}${suffix}`

    groups.push(_buildDowelGroup({
      params,
      markId,
      elementId:     foundation.id,
      floorId:       foundation.floorId,
      columnSpec:    cSpec,
      columnSpecId:  colResolved.specId,
      columnSource:  colResolved.source,
      count:         totalDowels,
      columnTypeId:  ctId,
      parentMark:    footingLabel,
    }))
  }

  return groups
}

// ── Single dowel group builder ──────────────────────────────────────────────
function _buildDowelGroup({
  params, markId, elementId, floorId,
  columnSpec, columnSpecId, columnSource,
  count, columnTypeId, parentMark,
}) {
  const diaMm = columnSpec.longitudinalBarDiaMm

  // Leg A — embed straight down into footing (Ld_compression).
  const legEmbedMm = developmentLengthCompressionMm({
    diaMm,
    gradeKey: params.defaultGradeKey,
    params,
  })

  // Leg B — projection above footing top for column lap.
  const legProjectMm = lapLengthMm({
    diaMm,
    lapKey: params.defaultLapKey,
    params,
  })

  const cuttingMm = computeLBarCuttingLengthMm({
    legAmm: legEmbedMm,
    legBmm: legProjectMm,
    diaMm,
    params,
  })

  return makeRebarGroup({
    markId,
    elementType:      ELEMENT_TYPE.FOOTING,
    elementId,
    floorId,
    role:             REBAR_ROLE.DOWEL,
    diaMm,
    shapeCode:        SHAPE_CODE.L_BAR,
    bendAnglesDeg:    [90],
    nominalDimensions: { A: Math.round(legEmbedMm), B: Math.round(legProjectMm) },
    cuttingLengthMm:  cuttingMm,
    count,
    specId:           columnSpecId,
    specSource:       columnSource,
    steelGrade:       params.defaultSteelGrade,
    meta: {
      description:         'Dowels: embed into footing + lap above for column connection',
      embedLengthMm:       Math.round(legEmbedMm),
      projectionLengthMm:  Math.round(legProjectMm),
      columnTypeId,
      parentMark,
    },
  })
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function _sanitizeLabel(label) {
  if (typeof label !== 'string') return null
  const cleaned = label.replace(/\s+/g, '')
  return cleaned.length > 0 ? cleaned : null
}

function _findRepresentativeColumnForType(state, columnTypeId) {
  const columns = state.columns
  if (!columns) return null
  // Stable: sort ids lex asc, pick first matching column.
  const ids = Object.keys(columns).sort()
  for (const id of ids) {
    const col = columns[id]
    if (col?.columnTypeId === columnTypeId) return col
  }
  return null
}
