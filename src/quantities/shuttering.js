// Shuttering quantity computation (Phase 1.6a).
//
// Indian residential RCC formwork conventions used here:
//   Column:   4 side faces, full height (top + bottom cast continuously into beam/footing).
//             Surface area = perimeter × columnHeightFt.
//   Beam:     Bottom face + 2 side faces. Top is open (slab cast atop).
//             Surface area = length × (width + 2 × depth) / 12.
//   Footing:  4 side faces only. Bottom sits on PCC (no shuttering); top open.
//             Surface area = perimeter × depth.
//   Slab:     Full bottom face (slab cast on supported shuttering).
//             Slab edge shuttering = building perimeter × slab thickness — approximated as
//             sum of EXTERNAL wall lengths (adjacency count 1) for Stage 0.
//
// Staircase shuttering (waist slab underside + landing bottoms) is computed as
// totalRccFt3 / waistSlabFt — a reasonable contractor estimate. Phase 1.7 can
// refine with explicit step shuttering tally.

import { getColumnPerimeterFt } from '../lib/columnShapes'
import { computeFoundationQuantities } from './foundations'
import { safeR2 as r2 } from '../lib/numbers.js'

export function computeShutteringQuantities(state) {
  const { projectSettings } = state
  const { columnTypes, heights, slabSettings, beamDimensions } = projectSettings
  const columnHeightFt = heights.plinthHeightFt + heights.floorHeightFt + slabSettings.mainThicknessIn / 12

  // ── Columns ─────────────────────────────────────────────────────────────
  const colQ = state.getColumnQuantities()
  const columns = []
  for (const [ctId, q] of Object.entries(colQ)) {
    const ct = columnTypes.find(t => t.id === ctId)
    if (!ct) continue
    const perimeterFt = getColumnPerimeterFt(ct)
    const areaPerColumn = perimeterFt * columnHeightFt
    columns.push({
      columnTypeId: ctId,
      label:        ct.label,
      count:        q.count,
      perimeterFt:  r2(perimeterFt),
      heightFt:     r2(columnHeightFt),
      areaFt2:      r2(areaPerColumn * q.count),
    })
  }
  const columnTotal = columns.reduce((s, c) => s + c.areaFt2, 0)

  // ── Beams ───────────────────────────────────────────────────────────────
  const beamQ = state.getBeamQuantities()
  const beams = []
  for (const [level, q] of Object.entries(beamQ)) {
    if (!q) continue
    const dims = beamDimensions[level]
    if (!dims) continue
    const factor = (dims.widthIn + 2 * dims.depthIn) / 12   // bottom + 2 sides per ft length
    const areaFt2 = q.totalLenFt * factor
    beams.push({
      level,
      lengthFt:    r2(q.totalLenFt),
      crossSection: `${dims.widthIn}″ × ${dims.depthIn}″`,
      areaFt2:     r2(areaFt2),
    })
  }
  const beamTotal = beams.reduce((s, b) => s + b.areaFt2, 0)

  // ── Footings ────────────────────────────────────────────────────────────
  const fdnQ = state.getFoundationQuantities()
  const footings = []
  // Inline auto-isolated footings (one entry per column type)
  for (const [ctId, q] of Object.entries(fdnQ.byColumnTypeInline)) {
    const perimeterFt = 2 * (q.lengthFt + q.widthFt)
    const areaPerFooting = perimeterFt * q.depthFt
    footings.push({
      key:         `inline_${ctId}`,
      label:       q.label,
      count:       q.count,
      perimeterFt: r2(perimeterFt),
      depthFt:     q.depthFt,
      areaFt2:     r2(areaPerFooting * q.count),
    })
  }
  // Foundation entities (combined/raft/strip/pile via Phase 1.8 — proper geometry per type)
  const fdnEntities = computeFoundationQuantities(state).perFoundation
  for (const f of fdnEntities) {
    if (!f.shutterAreaFt2) continue
    footings.push({
      key:         `fdn_${f.id}`,
      label:       f.label,
      count:       1,
      perimeterFt: 0,                // perimeter is type-dependent; full area is what matters
      depthFt:     0,
      areaFt2:     f.shutterAreaFt2,
    })
  }
  const footingTotal = footings.reduce((s, f) => s + f.areaFt2, 0)

  // ── Slab ────────────────────────────────────────────────────────────────
  const slabQ = state.getSlabQuantities()
  const slabBottomAreaFt2 = slabQ.mainAreaFt2 + slabQ.sunkenAreaFt2

  // Slab edge formwork — approximated by sum of external wall lengths × slab thickness.
  // External wall = adjacency count of 1. Selectors only see this via getWallAdjacencyCount.
  const adjCount = state.getWallAdjacencyCount()
  const { walls, nodes } = state
  let externalPerimeterFt = 0
  for (const wall of Object.values(walls)) {
    if (wall.isVirtual || wall.isPlot) continue
    if ((adjCount[wall.id] ?? 0) !== 1) continue
    const n1 = nodes[wall.n1], n2 = nodes[wall.n2]
    if (!n1 || !n2) continue
    externalPerimeterFt += Math.hypot(n2.x - n1.x, n2.y - n1.y) / 12
  }
  const slabThicknessFt = slabSettings.mainThicknessIn / 12
  const slabEdgeAreaFt2 = externalPerimeterFt * slabThicknessFt

  const slab = {
    bottomAreaFt2:      r2(slabBottomAreaFt2),
    edgePerimeterFt:    r2(externalPerimeterFt),
    edgeThicknessFt:    r2(slabThicknessFt),
    edgeAreaFt2:        r2(slabEdgeAreaFt2),
    totalAreaFt2:       r2(slabBottomAreaFt2 + slabEdgeAreaFt2),
  }
  const slabTotal = slab.totalAreaFt2

  // ── Staircase ───────────────────────────────────────────────────────────
  // Contractor approximation: total shuttering ≈ waist slab underside + landing bottoms.
  // Both already summed in totalRccFt3 / waistSlabIn. Area ≈ totalRccFt3 / (waistSlabIn/12).
  const staircases = state.getStaircaseQuantities()
  let staircaseTotal = 0
  const staircaseDetails = staircases.map(sc => {
    const waistFt = (state.staircases?.[sc.id]?.waistSlabIn ?? 6) / 12
    const areaFt2 = waistFt > 0 ? r2(sc.totalRccFt3 / waistFt) : 0
    staircaseTotal += areaFt2
    return { id: sc.id, areaFt2 }
  })

  const grandTotal = r2(columnTotal + beamTotal + footingTotal + slabTotal + staircaseTotal)

  return {
    columns,
    beams,
    footings,
    slab,
    staircases: staircaseDetails,
    subtotals: {
      columns:    r2(columnTotal),
      beams:      r2(beamTotal),
      footings:   r2(footingTotal),
      slab:       r2(slabTotal),
      staircase:  r2(staircaseTotal),
    },
    totalAreaFt2: grandTotal,
  }
}
