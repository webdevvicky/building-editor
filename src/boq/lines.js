// Canonical BOQ line aggregator (Stage 0 T4).
//
// getBoqLines(state, rates) → BoqLine[]
//
// BoqLine schema (stable for Phase 2.0 PDF/Excel/ERP consumers):
//   {
//     id:               string,    // stable; matches rateKey by default
//     category:         string,    // finishes | masonry | rcc | civil | shuttering |
//                                  //   excavation | concreteMix | steel | plaster |
//                                  //   plumConcrete | staircase
//     label:            string,    // human-readable
//     qty:              number,
//     unit:             string,    // 'ft²' | 'ft³' | 'kg' | 'bags' | 'nos' | 'm³'
//     rateKey:          string,    // matches BOQPanel rate input key for cost
//     isPer1000?:       boolean,   // true → cost = (qty/1000) × rate (bricks)
//     cost:             number|null,
//     formulaId:        string,    // dispatcher key for FormulaPopover
//     sourceEntityIds:  string[],  // back-link to canvas entities (future highlight UX)
//     floorId:          string,    // 'F1' default until multi-floor (Phase 1.9)
//     meta:             object|null,
//   }
//
// Every consumer (BOQPanel cost-total, CSV export, future PDF/Excel/ERP)
// should use this aggregator as the source of truth.

import { MATERIAL_LIBRARY, BONDING } from '../materials'
import { BEAM_LEVEL_REGISTRY } from '../constants/structural'
import { computeShutteringQuantities } from '../quantities/shuttering'
import { computeExcavationQuantities } from '../quantities/excavation'
import { computePlasterQuantities }    from '../quantities/plaster'
import { computeFoundationQuantities } from '../quantities/foundations'
import { computeBBSQuantities }        from '../quantities/bbs'
import { humanizeAssignmentSource as humanizeSource } from '../specs/resolution'
import { PLASTER_KIND }                from '../specs/plasterSystems'
import { scopeStateToFloor }           from './scope'
import { emitPlumbingLines }           from './emitters/plumbing.js'
import { emitElectricalLines }         from './emitters/electrical.js'
import { emitHvacLines }               from './emitters/hvac.js'

const DEFAULT_FLOOR = 'F1'

function r2(n) { return Math.round(n * 100) / 100 }

function calcCost(qty, rateStr, isPer1000 = false) {
  const r = parseFloat(rateStr)
  if (!rateStr || isNaN(r) || r <= 0) return null
  return isPer1000 ? (qty / 1000) * r : qty * r
}

// opts: { floorId?: string }  — when floorId is set, state is replaced with
// a floor-scoped view (see ../boq/scope.js). All quantity selectors run on
// the scoped collections so per-line numbers reflect only that floor.
export function getBoqLines(state, rates, opts = {}) {
  const scopedFloorId = opts.floorId ?? null
  if (scopedFloorId) state = scopeStateToFloor(state, scopedFloorId)

  const lines = []
  const lineFloorId = scopedFloorId ?? DEFAULT_FLOOR

  // Helper to push with default fields + auto-cost.
  const push = (line) => {
    const cost = calcCost(line.qty, rates[line.rateKey], line.isPer1000)
    lines.push({
      sourceEntityIds: [],
      floorId:         lineFloorId,
      meta:            null,
      ...line,
      cost,
    })
  }

  // ── 1. Finishes (room-flag-gated areas) ───────────────────────────────
  push({ id: 'finishes_flooring',        category: 'finishes', label: 'Flooring',          qty: state.getTotalFlooringArea(),       unit: 'ft²', rateKey: 'flooring',       formulaId: 'flooring' })
  push({ id: 'finishes_plaster_walls',   category: 'finishes', label: 'Plaster (walls)',   qty: state.getTotalWallArea(),           unit: 'ft²', rateKey: 'plasterWalls',   formulaId: 'plasterWalls' })
  push({ id: 'finishes_plaster_ceiling', category: 'finishes', label: 'Plaster (ceiling)', qty: state.getTotalCeilingPlasterArea(), unit: 'ft²', rateKey: 'plasterCeiling', formulaId: 'plasterCeiling' })
  push({ id: 'finishes_paint_walls',     category: 'finishes', label: 'Paint (walls)',     qty: state.getTotalPaintWallsArea(),     unit: 'ft²', rateKey: 'paintWalls',     formulaId: 'paintWalls' })
  push({ id: 'finishes_paint_ceiling',   category: 'finishes', label: 'Paint (ceiling)',   qty: state.getTotalPaintCeilingArea(),   unit: 'ft²', rateKey: 'paintCeiling',   formulaId: 'paintCeiling' })
  push({ id: 'finishes_waterproofing',   category: 'finishes', label: 'Waterproofing',     qty: state.getTotalWaterproofingArea(),  unit: 'ft²', rateKey: 'waterproofing',  formulaId: 'waterproofing' })
  push({ id: 'finishes_roofing',         category: 'finishes', label: 'Roofing',           qty: state.getTotalRoofingArea(),        unit: 'ft²', rateKey: 'roofing',        formulaId: 'roofing' })

  // ── 2. Masonry (per material with beam deduction) ─────────────────────
  const matQ = state.getMasonryWithBeamDeduction()
  for (const [matKey, qty] of Object.entries(matQ)) {
    const mat = MATERIAL_LIBRARY[matKey]
    if (!mat) continue
    const isBrick = mat.bricksPerFt3 !== undefined
    push({
      id:        `mat_${matKey}_unit`,
      category:  'masonry',
      label:     `${mat.name} – ${isBrick ? 'Bricks' : 'Blocks'}`,
      qty:       qty.unitCount,
      unit:      'nos',
      rateKey:   `mat_${matKey}_unit`,
      isPer1000: isBrick,
      formulaId: `mat_${matKey}_unit`,
      meta:      { materialKey: matKey },
    })
    if (mat.bondingType === BONDING.CEMENT_SAND) {
      push({ id: `mat_${matKey}_cement`, category: 'masonry', label: `${mat.name} – Cement`, qty: qty.cementBags, unit: 'bags', rateKey: `mat_${matKey}_cement`, formulaId: `mat_${matKey}_cement`, meta: { materialKey: matKey } })
      push({ id: `mat_${matKey}_sand`,   category: 'masonry', label: `${mat.name} – Sand`,   qty: qty.sandFt3,    unit: 'ft³',  rateKey: `mat_${matKey}_sand`,   formulaId: `mat_${matKey}_sand`,   meta: { materialKey: matKey } })
    } else {
      push({ id: `mat_${matKey}_adhesive`, category: 'masonry', label: `${mat.name} – Adhesive`, qty: qty.adhesiveBags, unit: 'bags', rateKey: `mat_${matKey}_adhesive`, formulaId: `mat_${matKey}_adhesive`, meta: { materialKey: matKey } })
    }
  }

  // ── 3. Civil (sump + septic) ──────────────────────────────────────────
  const stampsByType = (type) => Object.values(state.stamps).filter(s => s.type === type)
  function civilLines(stampType, qty, prefix) {
    if (!qty) return
    push({ id: `${prefix}_excavation`,         category: 'civil', label: `${stampType} – Excavation`,      qty: r2(qty.excavFt3),                          unit: 'ft³', rateKey: 'excavation',         formulaId: `${prefix}_excavation` })
    push({ id: `${prefix}_brickwork`,          category: 'civil', label: `${stampType} – Brickwork (9")`,  qty: r2(qty.brickFt3),                          unit: 'ft³', rateKey: 'brickwork',          formulaId: `${prefix}_brickwork` })
    push({ id: `${prefix}_rcc`,                category: 'civil', label: `${stampType} – RCC slabs`,       qty: r2(qty.rccBottomFt3 + qty.rccTopFt3),      unit: 'ft³', rateKey: 'rcc',                formulaId: `${prefix}_rcc` })
    push({ id: `${prefix}_plasterInner`,       category: 'civil', label: `${stampType} – Plaster (inner)`, qty: r2(qty.plasterFt2),                        unit: 'ft²', rateKey: 'plasterInner',       formulaId: `${prefix}_plasterInner` })
    push({ id: `${prefix}_waterproofingInner`, category: 'civil', label: `${stampType} – Waterproofing`,   qty: r2(qty.plasterFt2),                        unit: 'ft²', rateKey: 'waterproofingInner', formulaId: `${prefix}_waterproofingInner` })
  }
  if (stampsByType('sump').length        > 0) civilLines('Sump',         state.getSumpCivilQty(),   'sump')
  if (stampsByType('septic_tank').length > 0) civilLines('Septic Tank',  state.getSepticCivilQty(), 'septic')

  // ── 4. Structural — columns / footings / beams / slabs / sunshade / parapet ─
  const colQ  = state.getColumnQuantities()
  const fdnQ  = state.getFoundationQuantities()
  const beamQ = state.getBeamQuantities()
  const slabQ = state.getSlabQuantities()
  const stairQ = state.getStaircaseQuantities()
  const sunQ  = state.getSunshadeQuantities()
  const parQ  = state.getParapetQuantities()

  for (const [ctId, q] of Object.entries(colQ))
    push({ id: `col_${ctId}_rcc`, category: 'rcc', label: `Column ${q.label} ×${q.count}`, qty: r2(q.volFt3), unit: 'ft³', rateKey: `col_${ctId}_rcc`, formulaId: `col_${ctId}_rcc`, meta: { columnTypeId: ctId } })

  for (const [ctId, q] of Object.entries(fdnQ.byColumnTypeInline)) {
    push({ id: `fot_${ctId}_rcc`, category: 'rcc', label: `Footing ${q.label} ×${q.count}`, qty: r2(q.concreteVolFt3), unit: 'ft³', rateKey: `fot_${ctId}_rcc`, formulaId: `fot_${ctId}_rcc`, meta: { columnTypeId: ctId } })
    push({ id: `fot_${ctId}_pcc`, category: 'rcc', label: `PCC under ${q.label}`,            qty: r2(q.pccVolFt3),      unit: 'ft³', rateKey: `fot_${ctId}_pcc`, formulaId: `fot_${ctId}_pcc`, meta: { columnTypeId: ctId } })
  }
  // Phase 1.8 — use computeFoundationQuantities for richer per-type geometry.
  // PILE foundations emit two RCC lines (shaft + cap) instead of one combined
  // line — they are distinct concrete pours with separate procurement.
  const fdnDetail = computeFoundationQuantities(state).perFoundation
  for (const f of fdnDetail) {
    if (f.type === 'PILE') {
      const pg = f.pileGeometry || {}
      if ((f.shaftVolFt3 ?? 0) > 0) {
        push({
          id:        `fdn_${f.id}_rcc_shaft`,
          category:  'rcc',
          label:     `${f.label} — Shaft (${pg.pilesCount}× Ø${pg.pileDiamIn}″ × ${pg.pileLengthFt}ft)`,
          qty:       r2(f.shaftVolFt3),
          unit:      'ft³',
          rateKey:   `fdn_${f.id}_rcc_shaft`,
          formulaId: `fdn_${f.id}_rcc_shaft`,
          meta:      { foundationId: f.id, type: f.type, part: 'shaft' },
        })
      }
      if ((f.capVolFt3 ?? 0) > 0) {
        push({
          id:        `fdn_${f.id}_rcc_cap`,
          category:  'rcc',
          label:     `${f.label} — Cap (${pg.capLengthFt}×${pg.capWidthFt}×${pg.capDepthFt}ft)`,
          qty:       r2(f.capVolFt3),
          unit:      'ft³',
          rateKey:   `fdn_${f.id}_rcc_cap`,
          formulaId: `fdn_${f.id}_rcc_cap`,
          meta:      { foundationId: f.id, type: f.type, part: 'cap' },
        })
      }
    } else if (f.concreteVolFt3 > 0) {
      push({ id: `fdn_${f.id}_rcc`, category: 'rcc', label: `Foundation ${f.label}`, qty: r2(f.concreteVolFt3), unit: 'ft³', rateKey: `fdn_${f.id}_rcc`, formulaId: `fdn_${f.id}_rcc`, meta: { foundationId: f.id, type: f.type } })
    }
    if (f.pccVolFt3 > 0)
      push({ id: `fdn_${f.id}_pcc`, category: 'rcc', label: `PCC under ${f.label}`, qty: r2(f.pccVolFt3), unit: 'ft³', rateKey: `fdn_${f.id}_pcc`, formulaId: `fdn_${f.id}_pcc`, meta: { foundationId: f.id } })
  }

  for (const lvl of BEAM_LEVEL_REGISTRY) {
    const q = beamQ[lvl.id]
    if (!q) continue
    push({ id: `beam_${lvl.id}`, category: 'rcc', label: `${lvl.label} beams`, qty: r2(q.volFt3), unit: 'ft³', rateKey: `beam_${lvl.id}`, formulaId: `beam_${lvl.id}`, meta: { level: lvl.id } })
  }

  if (slabQ.mainVolFt3   > 0) push({ id: 'slab_main',    category: 'rcc', label: 'Main slab (M20)', qty: r2(slabQ.mainVolFt3),   unit: 'ft³', rateKey: 'slab_main',    formulaId: 'slab_main' })
  if (slabQ.sunkenVolFt3 > 0) push({ id: 'slab_sunken',  category: 'rcc', label: 'Sunken slab',     qty: r2(slabQ.sunkenVolFt3), unit: 'ft³', rateKey: 'slab_sunken',  formulaId: 'slab_sunken' })
  if (sunQ?.count        > 0) push({ id: 'sunshade_rcc', category: 'rcc', label: `Sunshades ×${sunQ.count}`, qty: r2(sunQ.totalVolFt3), unit: 'ft³', rateKey: 'sunshade_rcc', formulaId: 'sunshade_rcc' })
  if (parQ?.totalLenFt   > 0) push({ id: 'parapet_rcc',  category: 'rcc', label: 'Parapet',         qty: r2(parQ.totalVolFt3),   unit: 'ft³', rateKey: 'parapet_rcc',  formulaId: 'parapet_rcc' })

  const totalStairRcc = stairQ.reduce((s, sc) => s + sc.totalRccFt3, 0)
  if (totalStairRcc > 0) push({ id: 'stair_rcc', category: 'staircase', label: 'Staircase RCC', qty: r2(totalStairRcc), unit: 'ft³', rateKey: 'stair_rcc', formulaId: 'stair_rcc' })

  // ── 5. Structural Steel ───────────────────────────────────────────────
  // Phase 1.7+ partial-coverage emit:
  //   - BBS pipeline (quantities/bbs.js) resolves a spec per entity via the
  //     central resolver. Each resolved spec emits ONE BOQ line per group.
  //   - Entities resolving to ESTIMATE are excluded from BBS and fall to the
  //     kg/m³ estimate (one line per category).
  //   - BBS and Estimate lines coexist in the same category — never the old
  //     "all-or-nothing" suppression. Same rateKey across all lines in a
  //     category so users still enter one rate per element type.
  const bbs = computeBBSQuantities(state)
  const steelQ = state.getSteelQuantities({
    excludeColumnIds:            bbs.excludeIds.columns,
    excludeBeamIds:              bbs.excludeIds.beams,
    excludeSlabIds:              bbs.excludeIds.slabs,
    excludeFoundationIds:        bbs.excludeIds.foundations,
    excludeColumnTypeFootingIds: bbs.excludeIds.columnTypeFootings,
  })
  const STEEL_DEFS = [
    { key: 'footing',    label: 'Footings',   rk: 'steel_footing',    et: 'FOOTING',    bbsKey: 'footing' },
    { key: 'column',     label: 'Columns',    rk: 'steel_column',     et: 'COLUMN',     bbsKey: 'column'  },
    { key: 'beam',       label: 'Beams',      rk: 'steel_beam',       et: 'BEAM',       bbsKey: 'beam'    },
    { key: 'slab',       label: 'Slabs',      rk: 'steel_slab',       et: 'SLAB',       bbsKey: 'slab'    },
    { key: 'staircase',  label: 'Staircases', rk: 'steel_staircase',  et: 'STAIRCASE',  bbsKey: null      },
    { key: 'civilStamp', label: 'Civil',      rk: 'steel_civil',      et: 'CIVIL_STAMP', bbsKey: null     },
  ]
  for (const { key, label, rk, et, bbsKey } of STEEL_DEFS) {
    // Grouped-by-spec BBS lines (one per resolved spec in this category).
    if (bbsKey) {
      for (const grp of (bbs.groupedBySpec[bbsKey] ?? [])) {
        if (grp.totalKg <= 0) continue
        push({
          id:        `${rk}_spec_${grp.specId}`,
          category:  'steel',
          label:     `Steel – ${label} — ${grp.specLabel} (${humanizeSource(grp.source)})`,
          qty:       r2(grp.totalKg),
          unit:      'kg',
          rateKey:   rk,
          formulaId: `steel_${et}_spec_${grp.specId}`,
          meta: {
            bbs:             true,
            specId:          grp.specId,
            specLabel:       grp.specLabel,
            source:          grp.source,
            instanceCount:   grp.instanceCount,
            sourceEntityIds: grp.sourceEntityIds,
          },
        })
      }
    }
    // Remaining kg/m³ estimate line — only when the un-BBS'd pool has volume.
    const estKg = steelQ?.[key] ?? 0
    if (estKg > 0) {
      push({
        id:        rk,
        category:  'steel',
        label:     `Steel – ${label} (Estimate, kg/m³)`,
        qty:       r2(estKg),
        unit:      'kg',
        rateKey:   rk,
        formulaId: `steel_${et}`,
        meta:      { bbs: false, source: 'ESTIMATE' },
      })
    }
  }

  // ── 6. Concrete mix (M20 + M7.5) ──────────────────────────────────────
  const conc = state.getConcreteByGrade()
  if (conc.M7_5?.volM3 > 0) {
    push({ id: 'conc_M7_5_cement', category: 'concreteMix', label: 'M7.5 – Cement',       qty: r2(conc.M7_5.cementBags),   unit: 'bags', rateKey: 'conc_M7_5_cement', formulaId: 'conc_M7_5' })
    push({ id: 'conc_M7_5_sand',   category: 'concreteMix', label: 'M7.5 – Sand (dry)',   qty: r2(conc.M7_5.sandM3DRY),    unit: 'm³',   rateKey: 'conc_M7_5_sand',   formulaId: 'conc_M7_5' })
    push({ id: 'conc_M7_5_agg20',  category: 'concreteMix', label: 'M7.5 – Agg 20mm',     qty: r2(conc.M7_5.agg20mmM3DRY), unit: 'm³',   rateKey: 'conc_M7_5_agg20',  formulaId: 'conc_M7_5' })
  }
  if (conc.M20?.volM3 > 0) {
    push({ id: 'conc_M20_cement', category: 'concreteMix', label: 'M20 – Cement',        qty: r2(conc.M20.cementBags),   unit: 'bags', rateKey: 'conc_M20_cement', formulaId: 'conc_M20' })
    push({ id: 'conc_M20_sand',   category: 'concreteMix', label: 'M20 – Sand (dry)',    qty: r2(conc.M20.sandM3DRY),    unit: 'm³',   rateKey: 'conc_M20_sand',   formulaId: 'conc_M20' })
    push({ id: 'conc_M20_agg10',  category: 'concreteMix', label: 'M20 – Agg 10mm (dry)', qty: r2(conc.M20.agg10mmM3DRY), unit: 'm³',   rateKey: 'conc_M20_agg10',  formulaId: 'conc_M20' })
    push({ id: 'conc_M20_agg20',  category: 'concreteMix', label: 'M20 – Agg 20mm (dry)', qty: r2(conc.M20.agg20mmM3DRY), unit: 'm³',   rateKey: 'conc_M20_agg20',  formulaId: 'conc_M20' })
  }

  // ── 7. Plum concrete (Phase 1.6e) ─────────────────────────────────────
  const plumFt3 = r2(
    Object.values(fdnQ.byFoundation).reduce((s, q) => s + (q.plumVolFt3 || 0), 0) +
    Object.values(fdnQ.byColumnTypeInline).reduce((s, q) => s + (q.plumVolFt3 || 0), 0)
  )
  if (plumFt3 > 0) push({ id: 'plum_concrete', category: 'plumConcrete', label: 'Plum Concrete (under footings)', qty: plumFt3, unit: 'ft³', rateKey: 'plum_concrete', formulaId: 'plum_concrete' })

  // ── 8. Shuttering (Phase 1.6a) ────────────────────────────────────────
  const shutQ = computeShutteringQuantities(state)
  if (shutQ.totalAreaFt2 > 0) {
    if (shutQ.subtotals.columns   > 0) push({ id: 'shutter_columns',   category: 'shuttering', label: 'Shuttering — Columns',   qty: shutQ.subtotals.columns,   unit: 'ft²', rateKey: 'shutter_columns',   formulaId: 'shuttering' })
    if (shutQ.subtotals.beams     > 0) push({ id: 'shutter_beams',     category: 'shuttering', label: 'Shuttering — Beams',     qty: shutQ.subtotals.beams,     unit: 'ft²', rateKey: 'shutter_beams',     formulaId: 'shuttering' })
    if (shutQ.subtotals.footings  > 0) push({ id: 'shutter_footings',  category: 'shuttering', label: 'Shuttering — Footings',  qty: shutQ.subtotals.footings,  unit: 'ft²', rateKey: 'shutter_footings',  formulaId: 'shuttering' })
    if (shutQ.subtotals.slab      > 0) push({ id: 'shutter_slab',      category: 'shuttering', label: 'Shuttering — Slab',      qty: shutQ.subtotals.slab,      unit: 'ft²', rateKey: 'shutter_slab',      formulaId: 'shuttering' })
    if (shutQ.subtotals.staircase > 0) push({ id: 'shutter_stair',     category: 'shuttering', label: 'Shuttering — Staircase', qty: shutQ.subtotals.staircase, unit: 'ft²', rateKey: 'shutter_stair',     formulaId: 'shuttering' })
  }

  // ── 9. Excavation (Phase 1.6b) ────────────────────────────────────────
  const excQ = computeExcavationQuantities(state)
  if (excQ.totalVolFt3 > 0) {
    if (excQ.subtotals.bulk       > 0) push({ id: 'excav_bulk',  category: 'excavation', label: 'Excavation — Bulk',                       qty: excQ.subtotals.bulk,       unit: 'ft³', rateKey: 'excav_bulk',  formulaId: 'excavation' })
    if (excQ.subtotals.foundation > 0) push({ id: 'excav_pit',   category: 'excavation', label: 'Excavation — Foundation pits (extra)',    qty: excQ.subtotals.foundation, unit: 'ft³', rateKey: 'excav_pit',   formulaId: 'excavation' })
    if (excQ.subtotals.civil      > 0) push({ id: 'excav_civil', category: 'excavation', label: 'Excavation — Civil stamps (sump/septic)', qty: excQ.subtotals.civil,      unit: 'ft³', rateKey: 'excav_civil', formulaId: 'excavation' })
  }

  // ── 10. Plaster materials by system (Phase 1.6f) ──────────────────────
  const plasterQ = computePlasterQuantities(state)
  for (const sys of Object.values(plasterQ.bySystem)) {
    if (sys.kind === PLASTER_KIND.CEMENT_SAND) {
      push({ id: `plaster_${sys.systemId}_cement`, category: 'plaster', label: `Plaster ${sys.label} — Cement`, qty: sys.cementBags, unit: 'bags', rateKey: `plaster_${sys.systemId}_cement`, formulaId: `plaster_${sys.systemId}`, meta: { plasterSystemId: sys.systemId } })
      push({ id: `plaster_${sys.systemId}_sand`,   category: 'plaster', label: `Plaster ${sys.label} — Sand`,   qty: sys.sandM3,     unit: 'm³',   rateKey: `plaster_${sys.systemId}_sand`,   formulaId: `plaster_${sys.systemId}`, meta: { plasterSystemId: sys.systemId } })
    } else {
      push({ id: `plaster_${sys.systemId}_material`, category: 'plaster', label: `Plaster ${sys.label} — Material`, qty: sys.materialBags, unit: 'bags', rateKey: `plaster_${sys.systemId}_material`, formulaId: `plaster_${sys.systemId}`, meta: { plasterSystemId: sys.systemId } })
    }
  }

  // ── 11. Plumbing (Phase 1.1 — per-discipline emitter) ─────────────────
  // Floor scope is already applied (state may be the scoped wrapper).
  // The emitter no-ops when no plumbing fixtures / network exist.
  emitPlumbingLines(state, push, { rates, scopedFloorId })

  // ── 12. Electrical (Phase 1.2 — per-discipline emitter) ───────────────
  // Same floor-scope contract as plumbing. No-ops until the electrical
  // engine (computeElectricalQuantities) or scoped wrapper returns data.
  emitElectricalLines(state, push, { rates, scopedFloorId })

  // ── 13. HVAC (Phase 1.3 — per-discipline emitter) ─────────────────────
  // Same floor-scope contract. No-ops until the HVAC engine
  // (computeHvacQuantities) or scoped wrapper returns data.
  emitHvacLines(state, push, { rates, scopedFloorId })

  return lines
}

// Convenience: BOQ summary grouped by category for renderers.
export function groupBoqLinesByCategory(lines) {
  const out = {}
  for (const l of lines) {
    if (!out[l.category]) out[l.category] = []
    out[l.category].push(l)
  }
  return out
}

// Total cost across all lines (null = no rates entered anywhere).
export function totalBoqCost(lines) {
  const some = lines.some(l => l.cost !== null)
  if (!some) return null
  return lines.reduce((s, l) => s + (l.cost ?? 0), 0)
}
