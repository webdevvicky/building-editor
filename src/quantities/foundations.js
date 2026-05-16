// Phase 1.8 — per-foundation excavation + shuttering with proper geometry per type.
//
// Pure function: takes the store state and returns { perFoundation, totals }.
// Walks state.foundations directly (entity authority) and reads wall lengths
// via state.getWallLength (the canonical selector — never inlined here).
//
// Geometry rules per type (consume foundation.geometry):
//
//   ISOLATED / COMBINED:
//     footprint = lengthFt × widthFt
//     concrete  = footprint × depthFt
//     excav     = (lengthFt + 2·margin) × (widthFt + 2·margin) × (depthFt + pccDepthFt)
//     shutter   = 2·(lengthFt + widthFt) × depthFt
//
//   RAFT:
//     footprint = geometry.areaFt2                 (no margin — raft IS the footprint)
//     concrete  = footprint × depthFt
//     excav     = footprint × (depthFt + pccDepthFt)
//     shutter   = perimeter (≈ 4·√area) × depthFt
//
//   STRIP:
//     totalLenFt = Σ state.getWallLength(wid)
//     footprint  = totalLenFt × widthFt
//     concrete   = footprint × depthFt
//     excav      = totalLenFt × (widthFt + 2·margin) × (depthFt + pccDepthFt)
//     shutter    = 2 · totalLenFt × depthFt        (both sides — bottom on PCC, top open)
//
//   PILE:
//     pileShaftFt3   = pilesCount × π × (pileDiamIn/24)² × pileLengthFt
//     capFootprint   = capLengthFt × capWidthFt
//     capConcreteFt3 = capFootprint × capDepthFt
//     concrete       = pileShaftFt3 + capConcreteFt3
//     excav          = capFootprint × (capDepthFt + pccDepthFt)
//                      (piles displace ground — shaft excav not counted)
//     shutter        = 2·(capLengthFt + capWidthFt) × capDepthFt
//
// PCC volume   = footprint × pccDepthFt          (for PILE: capFootprint × pccDepthFt)
// Plum volume  = footprint × plumDepthFt         (when plumDepthFt > 0)
// marginFt     = projectSettings.excavationSettings?.workingMarginFt ?? 0.5

function r2(n) { return Math.round(n * 100) / 100 }

const DEFAULT_WORKING_MARGIN_FT = 0.5

function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0 }

export function computeFoundationQuantities(state) {
  const marginFt = state.projectSettings?.excavationSettings?.workingMarginFt ?? DEFAULT_WORKING_MARGIN_FT
  const foundations = state.foundations || {}

  const perFoundation = []
  const totals = {
    concreteVolFt3:  0,
    pccVolFt3:       0,
    plumVolFt3:      0,
    excavVolFt3:     0,
    shutterAreaFt2:  0,
  }

  for (const f of Object.values(foundations)) {
    const g = f.geometry || {}
    const pccDepthFt  = num(f.pccDepthFt)
    const plumDepthFt = num(f.plumDepthFt)

    let concreteVolFt3 = 0
    let pccVolFt3      = 0
    let plumVolFt3     = 0
    let excavVolFt3    = 0
    let shutterAreaFt2 = 0

    if (f.type === 'ISOLATED' || f.type === 'COMBINED') {
      const lFt = num(g.lengthFt)
      const wFt = num(g.widthFt)
      const dFt = num(g.depthFt)
      const footprint = lFt * wFt
      concreteVolFt3 = footprint * dFt
      pccVolFt3      = footprint * pccDepthFt
      plumVolFt3     = footprint * plumDepthFt
      excavVolFt3    = (lFt + 2 * marginFt) * (wFt + 2 * marginFt) * (dFt + pccDepthFt)
      shutterAreaFt2 = 2 * (lFt + wFt) * dFt
    } else if (f.type === 'RAFT') {
      const areaFt2 = num(g.areaFt2)
      const dFt     = num(g.depthFt)
      concreteVolFt3 = areaFt2 * dFt
      pccVolFt3      = areaFt2 * pccDepthFt
      plumVolFt3     = areaFt2 * plumDepthFt
      excavVolFt3    = areaFt2 * (dFt + pccDepthFt)
      const perimeterFt = 4 * Math.sqrt(Math.max(areaFt2, 0))
      shutterAreaFt2 = perimeterFt * dFt
    } else if (f.type === 'STRIP') {
      const wFt = num(g.widthFt)
      const dFt = num(g.depthFt)
      let totalLenFt = 0
      for (const wid of (f.wallIds || [])) {
        const len = typeof state.getWallLength === 'function' ? state.getWallLength(wid) : 0
        totalLenFt += num(len)
      }
      const footprint = totalLenFt * wFt
      concreteVolFt3 = footprint * dFt
      pccVolFt3      = footprint * pccDepthFt
      plumVolFt3     = footprint * plumDepthFt
      excavVolFt3    = totalLenFt * (wFt + 2 * marginFt) * (dFt + pccDepthFt)
      shutterAreaFt2 = 2 * totalLenFt * dFt
    } else if (f.type === 'PILE') {
      const pileDiamIn   = num(g.pileDiamIn)
      const pileLengthFt = num(g.pileLengthFt)
      const pilesCount   = num(g.pilesCount)
      const capLFt = num(g.capLengthFt)
      const capWFt = num(g.capWidthFt)
      const capDFt = num(g.capDepthFt)

      const pileRadiusFt = pileDiamIn / 24
      const pileShaftFt3 = pilesCount * Math.PI * pileRadiusFt * pileRadiusFt * pileLengthFt
      const capFootprint = capLFt * capWFt
      const capConcreteFt3 = capFootprint * capDFt

      concreteVolFt3 = pileShaftFt3 + capConcreteFt3
      pccVolFt3      = capFootprint * pccDepthFt
      plumVolFt3     = capFootprint * plumDepthFt
      excavVolFt3    = capFootprint * (capDFt + pccDepthFt)
      shutterAreaFt2 = 2 * (capLFt + capWFt) * capDFt
    }

    const entry = {
      id:              f.id,
      type:            f.type,
      label:           f.label ?? `${f.type} foundation`,
      columnCount:     (f.columnIds || []).length,
      wallCount:       (f.wallIds || []).length,
      concreteVolFt3:  r2(concreteVolFt3),
      pccVolFt3:       r2(pccVolFt3),
      plumVolFt3:      r2(plumVolFt3),
      excavVolFt3:     r2(excavVolFt3),
      shutterAreaFt2:  r2(shutterAreaFt2),
    }
    perFoundation.push(entry)

    totals.concreteVolFt3 += entry.concreteVolFt3
    totals.pccVolFt3      += entry.pccVolFt3
    totals.plumVolFt3     += entry.plumVolFt3
    totals.excavVolFt3    += entry.excavVolFt3
    totals.shutterAreaFt2 += entry.shutterAreaFt2
  }

  totals.concreteVolFt3  = r2(totals.concreteVolFt3)
  totals.pccVolFt3       = r2(totals.pccVolFt3)
  totals.plumVolFt3      = r2(totals.plumVolFt3)
  totals.excavVolFt3     = r2(totals.excavVolFt3)
  totals.shutterAreaFt2  = r2(totals.shutterAreaFt2)

  return { perFoundation, totals }
}
