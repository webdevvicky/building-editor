// Concrete volume per BBS abstract category (m³) — for the Level-2 abstract's
// "steel kg per concrete m³" ratio column (Karthick TOTAL sheet format).
//
// 2026-05-29 (BBS-categories phase). Pure function of stored geometry — does
// NOT call the legacy quantity aggregators (avoids STRAP-type edge cases and
// shape coupling). Best-effort: a category with no derivable concrete returns
// 0 (the abstract then shows '—' for its ratio).
//
// Column / beam concrete is computed at the coarse level then split into the
// fine abstract categories (sub/super, tie/plinth/lintel/roof) in proportion
// to each fine category's steel kg — so the ratio is internally consistent.

import { getColumnAreaFt2 } from '../lib/columnShapes.js'
import { getBeamLengthFt, getAllBeams } from '../topology/beams.js'
import { BBS_CATEGORY } from './types.js'

const FT3_TO_M3 = 0.0283168

export function concreteByBbsCategory(state, byBbsCategory = {}) {
  const m3 = {}
  const add = (cat, ft3) => { if (ft3 > 0) m3[cat] = (m3[cat] ?? 0) + ft3 * FT3_TO_M3 }

  // ── Columns (coarse → split by kg share across SUB/SUPER/COLUMN) ───────────
  let columnFt3 = 0
  const columnTypes = state.projectSettings?.columnTypes ?? []
  for (const col of Object.values(state.columns ?? {})) {
    const ct = columnTypes.find(t => t.id === col.columnTypeId)
    if (!ct) continue
    const areaFt2 = getColumnAreaFt2(ct)
    const hFt = state.getColumnHeightFt?.(col) ?? 0
    columnFt3 += areaFt2 * hFt
  }
  _splitByKg(m3, columnFt3 * FT3_TO_M3, byBbsCategory,
    [BBS_CATEGORY.SUB_COLUMN, BBS_CATEGORY.SUPER_COLUMN, BBS_CATEGORY.COLUMN])

  // ── Beams (per class) + tie bands from walls ───────────────────────────────
  const beamDims = state.projectSettings?.beamDimensions ?? {}
  const beamFt3 = {}  // class → ft³
  for (const beam of getAllBeams(state)) {
    const cls = beam.beamClass ?? beam.level
    const d = beamDims[cls]
    if (!d) continue
    const lenFt = getBeamLengthFt(state, beam)
    beamFt3[cls] = (beamFt3[cls] ?? 0) + lenFt * (d.widthIn / 12) * (d.depthIn / 12)
  }
  // Tie bands (wall.hasTieBeam) — not in getAllBeams.
  const tieD = beamDims.tie
  if (tieD) {
    for (const wall of Object.values(state.walls ?? {})) {
      if (wall.hasTieBeam !== true || wall.isVirtual || wall.isPlot) continue
      const n1 = state.nodes?.[wall.n1], n2 = state.nodes?.[wall.n2]
      if (!n1 || !n2) continue
      const lenFt = Math.hypot(n2.x - n1.x, n2.y - n1.y) / 12
      beamFt3.tie = (beamFt3.tie ?? 0) + lenFt * (tieD.widthIn / 12) * (tieD.depthIn / 12)
    }
  }
  add(BBS_CATEGORY.TIE_BEAM,    beamFt3.tie ?? 0)
  add(BBS_CATEGORY.PLINTH_BEAM, beamFt3.plinth ?? 0)
  add(BBS_CATEGORY.LINTEL_BEAM, beamFt3.lintel ?? 0)
  add(BBS_CATEGORY.ROOF_BEAM,   beamFt3.roof ?? 0)

  // ── Foundations (footing pads + strap) ─────────────────────────────────────
  for (const f of Object.values(state.foundations ?? {})) {
    const g = f.geometry || {}
    if (f.type === 'STRAP') {
      const padA = g.padA || {}, padB = g.padB || {}, strap = g.strap || {}
      const padDepth = (padA.depthFt ?? 1.5)
      const vol =
        (padA.lengthFt ?? 0) * (padA.widthFt ?? 0) * padDepth +
        (padB.lengthFt ?? 0) * (padB.widthFt ?? 0) * (padB.depthFt ?? padDepth) +
        (strap.lengthFt ?? 0) * ((strap.widthIn ?? 0) / 12) * ((strap.depthIn ?? 0) / 12)
      add(BBS_CATEGORY.STRAP_FOOTING, vol)
    } else if (f.type === 'ISOLATED' || f.type === 'COMBINED') {
      add(BBS_CATEGORY.FOOTING, (g.lengthFt ?? 0) * (g.widthFt ?? 0) * (g.depthFt ?? 0))
    }
  }
  // Inline footings (columns with no foundation) — approximate from column type.
  const fdnQ = state.getFoundationQuantities?.()
  if (fdnQ?.byColumnTypeInline) {
    for (const inline of Object.values(fdnQ.byColumnTypeInline)) {
      const cnt = inline.count ?? 0
      add(BBS_CATEGORY.FOOTING, cnt * (inline.lengthFt ?? 0) * (inline.widthFt ?? 0) * (inline.depthFt ?? 0))
    }
  }

  // ── Sunshade (per window opening) ──────────────────────────────────────────
  const ss = state.projectSettings?.sunshadeSettings ?? {}
  if (ss.projectionFt && ss.thicknessIn) {
    let v = 0
    for (const wall of Object.values(state.walls ?? {})) {
      for (const op of (wall.openings ?? [])) {
        if (op.type === 'window' && op.hasSunshade) v += ss.projectionFt * (op.width / 12) * (ss.thicknessIn / 12)
      }
    }
    add(BBS_CATEGORY.SUNSHADE, v)
  }

  // ── Loft (per wall) — default 4" slab thickness ────────────────────────────
  for (const wall of Object.values(state.walls ?? {})) {
    const lf = wall.loft
    if (lf?.enabled) add(BBS_CATEGORY.LOFT, (lf.widthFt ?? 0) * (lf.depthFt ?? 0) * (4 / 12))
  }

  // ── Slabs (per role) ───────────────────────────────────────────────────────
  for (const slab of Object.values(state.slabs ?? {})) {
    let area = 0
    for (const rid of (slab.roomIds ?? [])) {
      const geom = state.getRoomGeometry?.(rid, 'centerline')
      if (geom?.area > 0) area += geom.area
    }
    const thkFt = (slab.thicknessIn ?? state.projectSettings?.slabSettings?.mainThicknessIn ?? 5) / 12
    const cat = slab.role === 'FLOOR' ? BBS_CATEGORY.FLOOR_SLAB
      : slab.role === 'ROOF' ? BBS_CATEGORY.ROOF_SLAB : BBS_CATEGORY.SLAB
    add(cat, area * thkFt)
  }

  // ── Staircase (waist + landing) ────────────────────────────────────────────
  for (const st of Object.values(state.staircases ?? {})) {
    const going = (st.stepsPerFlight ?? 0) * (st.treadIn ?? 0) / 12
    const rise  = (st.stepsPerFlight ?? 0) * (st.riserIn ?? 0) / 12
    const incl  = Math.hypot(going, rise)
    const waistFt = (st.waistSlabIn ?? 6) / 12
    const flights = st.flightCount ?? 2
    const fw = st.flightWidthFt ?? 3.5
    const waistVol = incl * fw * waistFt * flights
    const landVol = (st.landingFtWidth ?? 0) * (st.landingFtLength ?? 0) * waistFt
    add(BBS_CATEGORY.STAIRCASE, waistVol + landVol)
  }

  return m3
}

// Split a coarse m³ total across fine categories in proportion to each one's
// steel kg (from byBbsCategory). If none have kg, no split (m³ stays unassigned).
function _splitByKg(m3, totalM3, byBbsCategory, cats) {
  if (totalM3 <= 0) return
  const kgs = cats.map(c => byBbsCategory[c]?.totalKg ?? 0)
  const sum = kgs.reduce((a, b) => a + b, 0)
  if (sum <= 0) return
  cats.forEach((c, i) => {
    if (kgs[i] > 0) m3[c] = (m3[c] ?? 0) + totalM3 * (kgs[i] / sum)
  })
}
