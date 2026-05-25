// Canonical BOQ line aggregator (Stage 0 T4 + Rev 2).
//
// getBoqLines(state, rates, opts) → BoqLine[]
//
// opts: { floorId?, roomId?, roomType? }
//   - floorId   → routes state through scopeStateToFloor
//   - roomId    → routes state through scopeStateToRoom    (Rev 2)
//   - roomType  → routes state through scopeStateToRoomType (Rev 2)
//
// BoqLine schema (stable for Phase 2.0 PDF/Excel/ERP consumers):
//   {
//     id:               string,    // from BOQ_LINE_IDS or BOQ_LINE_ID.* builder
//     category:         string,    // from BOQ_CATEGORIES
//     label:            string,
//     qty:              number,
//     unit:             string,    // from UNITS — never a raw literal
//     rateKey:          string,
//     isPer1000?:       boolean,
//     cost:             number|null,
//     formulaId:        string,
//     sourceEntityIds:  string[],
//     floorId:          string,
//     scopeSupport:     string[],  // from BOQ_SCOPE — UI filters by this
//     meta:             object|null,
//   }
//
// Push helper auto-stamps scopeSupport from
// DEFAULT_SCOPE_SUPPORT_BY_CATEGORY[line.category] unless the line passes
// its own scopeSupport (per-line override allowed).

import { MATERIAL_LIBRARY, BONDING } from '../materials'
import { BEAM_LEVEL_REGISTRY } from '../constants/structural'
import { computeShutteringQuantities } from '../quantities/shuttering'
import { computeExcavationQuantities } from '../quantities/excavation'
import { computePlasterQuantities }    from '../quantities/plaster'
import { computeFoundationQuantities } from '../quantities/foundations'
import { computeBBSQuantities }        from '../quantities/bbs'
import { computeJoineryQuantities }    from '../quantities/joinery.js'
import { computeTileQuantities }       from '../quantities/tiles.js'
import { computeGrillQuantities }      from '../quantities/grills.js'
import { humanizeAssignmentSource as humanizeSource } from '../specs/resolution'
import { PLASTER_KIND }                from '../specs/plasterSystems'
import { OPENING_SUBTYPE }             from '../constants/joinery.js'
import {
  BOQ_LINE_IDS, BOQ_LINE_ID, BOQ_CATEGORIES, CIVIL_PREFIX,
  BOQ_SCOPE, ALL_SCOPES, PROJECT_AND_FLOOR_ONLY,
  getDefaultScopeSupport,
} from '../constants/boqCategories.js'
import { UNITS } from '../constants/units.js'
import { scopeStateToFloor, scopeStateToRoom, scopeStateToRoomType } from './scope'
import { emitPlumbingLines }           from './emitters/plumbing.js'
import { emitElectricalLines }         from './emitters/electrical.js'
import { emitHvacLines }               from './emitters/hvac.js'
import { emitFireLines }               from './emitters/fire.js'
import { emitElvLines }                from './emitters/elv.js'

const DEFAULT_FLOOR = 'F1'

function r2(n) { return Math.round(n * 100) / 100 }

function calcCost(qty, rateStr, isPer1000 = false) {
  const r = parseFloat(rateStr)
  if (!rateStr || isNaN(r) || r <= 0) return null
  return isPer1000 ? (qty / 1000) * r : qty * r
}

export function getBoqLines(state, rates, opts = {}) {
  // Apply scope chain. Precedence: roomId > roomType > floorId > project.
  const scopedFloorId = opts.floorId  ?? null
  const scopedRoomId  = opts.roomId   ?? null
  const scopedRoomType = opts.roomType ?? null
  if (scopedFloorId)  state = scopeStateToFloor(state, scopedFloorId)
  if (scopedRoomId)   state = scopeStateToRoom(state, scopedRoomId)
  if (scopedRoomType) state = scopeStateToRoomType(state, scopedRoomType)

  const lines = []
  const lineFloorId = scopedFloorId ?? DEFAULT_FLOOR

  // Helper to push with default fields, auto-cost, auto-scopeSupport.
  const push = (line) => {
    const cost = calcCost(line.qty, rates[line.rateKey], line.isPer1000)
    const scopeSupport = line.scopeSupport ?? getDefaultScopeSupport(line.category)
    lines.push({
      sourceEntityIds: [],
      floorId:         lineFloorId,
      meta:            null,
      ...line,
      scopeSupport,
      cost,
    })
  }

  // ── 1. Finishes (room-flag-gated areas) ───────────────────────────────
  const plasterQ = computePlasterQuantities(state)
  push({ id: BOQ_LINE_IDS.FINISHES_FLOORING,               category: BOQ_CATEGORIES.FINISHES, label: 'Flooring',                            qty: state.getTotalFlooringArea(),       unit: UNITS.FT2, rateKey: 'flooring',              formulaId: 'flooring' })
  push({ id: BOQ_LINE_IDS.FINISHES_PLASTER_WALLS_INTERNAL, category: BOQ_CATEGORIES.FINISHES, label: 'Plaster (internal walls + columns)',  qty: plasterQ.totals.internalWallsAndColumnsFt2, unit: UNITS.FT2, rateKey: 'plasterWallsInternal', formulaId: 'plasterWallsInternal' })
  push({ id: BOQ_LINE_IDS.FINISHES_PLASTER_WALLS_EXTERNAL, category: BOQ_CATEGORIES.FINISHES, label: 'Plaster (external walls)',            qty: plasterQ.totals.externalWallsFt2,           unit: UNITS.FT2, rateKey: 'plasterWallsExternal', formulaId: 'plasterWallsExternal' })
  push({ id: BOQ_LINE_IDS.FINISHES_PLASTER_CEILING,        category: BOQ_CATEGORIES.FINISHES, label: 'Plaster (ceiling)',                   qty: state.getTotalCeilingPlasterArea(), unit: UNITS.FT2, rateKey: 'plasterCeiling',        formulaId: 'plasterCeiling' })
  push({ id: BOQ_LINE_IDS.FINISHES_PAINT_WALLS,            category: BOQ_CATEGORIES.FINISHES, label: 'Paint (walls)',                       qty: state.getTotalPaintWallsArea(),     unit: UNITS.FT2, rateKey: 'paintWalls',            formulaId: 'paintWalls' })
  push({ id: BOQ_LINE_IDS.FINISHES_PAINT_CEILING,          category: BOQ_CATEGORIES.FINISHES, label: 'Paint (ceiling)',                     qty: state.getTotalPaintCeilingArea(),   unit: UNITS.FT2, rateKey: 'paintCeiling',          formulaId: 'paintCeiling' })
  push({ id: BOQ_LINE_IDS.FINISHES_WATERPROOFING,          category: BOQ_CATEGORIES.FINISHES, label: 'Waterproofing',                       qty: state.getTotalWaterproofingArea(),  unit: UNITS.FT2, rateKey: 'waterproofing',         formulaId: 'waterproofing' })
  push({ id: BOQ_LINE_IDS.FINISHES_ROOFING,                category: BOQ_CATEGORIES.FINISHES, label: 'Roofing',                             qty: state.getTotalRoofingArea(),        unit: UNITS.FT2, rateKey: 'roofing',               formulaId: 'roofing' })

  // ── 2. Masonry (per material with beam deduction) ─────────────────────
  const matQ = state.getMasonryWithBeamDeduction()
  for (const [matKey, qty] of Object.entries(matQ)) {
    const mat = MATERIAL_LIBRARY[matKey]
    if (!mat) continue
    const isBrick = mat.bricksPerFt3 !== undefined
    push({
      id:        BOQ_LINE_ID.matUnit(matKey),
      category:  BOQ_CATEGORIES.MASONRY,
      label:     `${mat.name} – ${isBrick ? 'Bricks' : 'Blocks'}`,
      qty:       qty.unitCount,
      unit:      UNITS.NOS,
      rateKey:   BOQ_LINE_ID.matUnit(matKey),
      isPer1000: isBrick,
      formulaId: BOQ_LINE_ID.matUnit(matKey),
      meta:      { materialKey: matKey },
    })
    if (mat.bondingType === BONDING.CEMENT_SAND) {
      push({ id: BOQ_LINE_ID.matCement(matKey), category: BOQ_CATEGORIES.MASONRY, label: `${mat.name} – Cement`, qty: qty.cementBags, unit: UNITS.BAG, rateKey: BOQ_LINE_ID.matCement(matKey), formulaId: BOQ_LINE_ID.matCement(matKey), meta: { materialKey: matKey } })
      push({ id: BOQ_LINE_ID.matSand(matKey),   category: BOQ_CATEGORIES.MASONRY, label: `${mat.name} – Sand`,   qty: qty.sandFt3,    unit: UNITS.FT3, rateKey: BOQ_LINE_ID.matSand(matKey),   formulaId: BOQ_LINE_ID.matSand(matKey),   meta: { materialKey: matKey } })
    } else {
      push({ id: BOQ_LINE_ID.matAdhesive(matKey), category: BOQ_CATEGORIES.MASONRY, label: `${mat.name} – Adhesive`, qty: qty.adhesiveBags, unit: UNITS.BAG, rateKey: BOQ_LINE_ID.matAdhesive(matKey), formulaId: BOQ_LINE_ID.matAdhesive(matKey), meta: { materialKey: matKey } })
    }
  }

  // ── 3. Civil (sump + septic) ──────────────────────────────────────────
  const stampsByType = (type) => Object.values(state.stamps).filter(s => s.type === type)
  function civilLines(stampType, qty, prefix) {
    if (!qty) return
    push({ id: BOQ_LINE_ID.civilExcav(prefix),    category: BOQ_CATEGORIES.CIVIL, label: `${stampType} – Excavation`,      qty: r2(qty.excavFt3),                          unit: UNITS.FT3, rateKey: 'excavation',         formulaId: BOQ_LINE_ID.civilExcav(prefix) })
    push({ id: BOQ_LINE_ID.civilBrick(prefix),    category: BOQ_CATEGORIES.CIVIL, label: `${stampType} – Brickwork (9")`,  qty: r2(qty.brickFt3),                          unit: UNITS.FT3, rateKey: 'brickwork',          formulaId: BOQ_LINE_ID.civilBrick(prefix) })
    push({ id: BOQ_LINE_ID.civilRcc(prefix),      category: BOQ_CATEGORIES.CIVIL, label: `${stampType} – RCC slabs`,       qty: r2(qty.rccBottomFt3 + qty.rccTopFt3),      unit: UNITS.FT3, rateKey: 'rcc',                formulaId: BOQ_LINE_ID.civilRcc(prefix) })
    push({ id: BOQ_LINE_ID.civilPlaster(prefix),  category: BOQ_CATEGORIES.CIVIL, label: `${stampType} – Plaster (inner)`, qty: r2(qty.plasterFt2),                        unit: UNITS.FT2, rateKey: 'plasterInner',       formulaId: BOQ_LINE_ID.civilPlaster(prefix) })
    push({ id: BOQ_LINE_ID.civilWp(prefix),       category: BOQ_CATEGORIES.CIVIL, label: `${stampType} – Waterproofing`,   qty: r2(qty.plasterFt2),                        unit: UNITS.FT2, rateKey: 'waterproofingInner', formulaId: BOQ_LINE_ID.civilWp(prefix) })
  }
  if (stampsByType('sump').length        > 0) civilLines('Sump',         state.getSumpCivilQty(),   CIVIL_PREFIX.SUMP)
  if (stampsByType('septic_tank').length > 0) civilLines('Septic Tank',  state.getSepticCivilQty(), CIVIL_PREFIX.SEPTIC)

  // ── 4. Structural — columns / footings / beams / slabs / sunshade / parapet ─
  const colQ   = state.getColumnQuantities()
  const fdnQ   = state.getFoundationQuantities()
  const beamQ  = state.getBeamQuantities()
  const slabQ  = state.getSlabQuantities()
  const stairQ = state.getStaircaseQuantities()
  const sunQ   = state.getSunshadeQuantities()
  const parQ   = state.getParapetQuantities()

  for (const [ctId, q] of Object.entries(colQ))
    push({ id: BOQ_LINE_ID.columnRcc(ctId), category: BOQ_CATEGORIES.RCC, label: `Column ${q.label} ×${q.count}`, qty: r2(q.volFt3), unit: UNITS.FT3, rateKey: BOQ_LINE_ID.columnRcc(ctId), formulaId: BOQ_LINE_ID.columnRcc(ctId), meta: { columnTypeId: ctId } })

  for (const [ctId, q] of Object.entries(fdnQ.byColumnTypeInline)) {
    push({ id: BOQ_LINE_ID.footingRcc(ctId), category: BOQ_CATEGORIES.RCC, label: `Footing ${q.label} ×${q.count}`, qty: r2(q.concreteVolFt3), unit: UNITS.FT3, rateKey: BOQ_LINE_ID.footingRcc(ctId), formulaId: BOQ_LINE_ID.footingRcc(ctId), meta: { columnTypeId: ctId } })
    push({ id: BOQ_LINE_ID.footingPcc(ctId), category: BOQ_CATEGORIES.RCC, label: `PCC under ${q.label}`,            qty: r2(q.pccVolFt3),      unit: UNITS.FT3, rateKey: BOQ_LINE_ID.footingPcc(ctId), formulaId: BOQ_LINE_ID.footingPcc(ctId), meta: { columnTypeId: ctId } })
  }
  // Phase 1.8 — foundation entities (PILE = 2 lines; others 1).
  const fdnDetail = computeFoundationQuantities(state).perFoundation
  for (const f of fdnDetail) {
    if (f.type === 'PILE') {
      const pg = f.pileGeometry || {}
      if ((f.shaftVolFt3 ?? 0) > 0) {
        push({
          id:        BOQ_LINE_ID.foundationRccShaft(f.id),
          category:  BOQ_CATEGORIES.RCC,
          label:     `${f.label} — Shaft (${pg.pilesCount}× Ø${pg.pileDiamIn}″ × ${pg.pileLengthFt}ft)`,
          qty:       r2(f.shaftVolFt3),
          unit:      UNITS.FT3,
          rateKey:   BOQ_LINE_ID.foundationRccShaft(f.id),
          formulaId: BOQ_LINE_ID.foundationRccShaft(f.id),
          meta:      { foundationId: f.id, type: f.type, part: 'shaft' },
        })
      }
      if ((f.capVolFt3 ?? 0) > 0) {
        push({
          id:        BOQ_LINE_ID.foundationRccCap(f.id),
          category:  BOQ_CATEGORIES.RCC,
          label:     `${f.label} — Cap (${pg.capLengthFt}×${pg.capWidthFt}×${pg.capDepthFt}ft)`,
          qty:       r2(f.capVolFt3),
          unit:      UNITS.FT3,
          rateKey:   BOQ_LINE_ID.foundationRccCap(f.id),
          formulaId: BOQ_LINE_ID.foundationRccCap(f.id),
          meta:      { foundationId: f.id, type: f.type, part: 'cap' },
        })
      }
    } else if (f.concreteVolFt3 > 0) {
      push({ id: BOQ_LINE_ID.foundationRcc(f.id), category: BOQ_CATEGORIES.RCC, label: `Foundation ${f.label}`, qty: r2(f.concreteVolFt3), unit: UNITS.FT3, rateKey: BOQ_LINE_ID.foundationRcc(f.id), formulaId: BOQ_LINE_ID.foundationRcc(f.id), meta: { foundationId: f.id, type: f.type } })
    }
    if (f.pccVolFt3 > 0)
      push({ id: BOQ_LINE_ID.foundationPcc(f.id), category: BOQ_CATEGORIES.RCC, label: `PCC under ${f.label}`, qty: r2(f.pccVolFt3), unit: UNITS.FT3, rateKey: BOQ_LINE_ID.foundationPcc(f.id), formulaId: BOQ_LINE_ID.foundationPcc(f.id), meta: { foundationId: f.id } })
  }

  for (const lvl of BEAM_LEVEL_REGISTRY) {
    const q = beamQ[lvl.id]
    if (!q) continue
    push({ id: BOQ_LINE_ID.beam(lvl.id), category: BOQ_CATEGORIES.RCC, label: `${lvl.label} beams`, qty: r2(q.volFt3), unit: UNITS.FT3, rateKey: BOQ_LINE_ID.beam(lvl.id), formulaId: BOQ_LINE_ID.beam(lvl.id), meta: { level: lvl.id } })
  }

  if (slabQ.mainVolFt3   > 0) push({ id: BOQ_LINE_IDS.SLAB_MAIN,    category: BOQ_CATEGORIES.RCC, label: 'Main slab (M20)', qty: r2(slabQ.mainVolFt3),   unit: UNITS.FT3, rateKey: BOQ_LINE_IDS.SLAB_MAIN,    formulaId: BOQ_LINE_IDS.SLAB_MAIN })
  if (slabQ.sunkenVolFt3 > 0) push({ id: BOQ_LINE_IDS.SLAB_SUNKEN,  category: BOQ_CATEGORIES.RCC, label: 'Sunken slab',     qty: r2(slabQ.sunkenVolFt3), unit: UNITS.FT3, rateKey: BOQ_LINE_IDS.SLAB_SUNKEN,  formulaId: BOQ_LINE_IDS.SLAB_SUNKEN })
  if (sunQ?.count        > 0) push({ id: BOQ_LINE_IDS.SUNSHADE_RCC, category: BOQ_CATEGORIES.RCC, label: `Sunshades ×${sunQ.count}`, qty: r2(sunQ.totalVolFt3), unit: UNITS.FT3, rateKey: BOQ_LINE_IDS.SUNSHADE_RCC, formulaId: BOQ_LINE_IDS.SUNSHADE_RCC })
  if (parQ?.totalLenFt   > 0) push({ id: BOQ_LINE_IDS.PARAPET_RCC,  category: BOQ_CATEGORIES.RCC, label: 'Parapet',         qty: r2(parQ.totalVolFt3),   unit: UNITS.FT3, rateKey: BOQ_LINE_IDS.PARAPET_RCC,  formulaId: BOQ_LINE_IDS.PARAPET_RCC })

  const totalStairRcc = stairQ.reduce((s, sc) => s + sc.totalRccFt3, 0)
  if (totalStairRcc > 0) push({ id: BOQ_LINE_IDS.STAIR_RCC, category: BOQ_CATEGORIES.STAIRCASE, label: 'Staircase RCC', qty: r2(totalStairRcc), unit: UNITS.FT3, rateKey: BOQ_LINE_IDS.STAIR_RCC, formulaId: BOQ_LINE_IDS.STAIR_RCC })

  // ── 5. Structural Steel ───────────────────────────────────────────────
  const bbs = computeBBSQuantities(state)
  const steelQ = state.getSteelQuantities({
    excludeColumnIds:            bbs.excludeIds.columns,
    excludeBeamIds:              bbs.excludeIds.beams,
    excludeSlabIds:              bbs.excludeIds.slabs,
    excludeFoundationIds:        bbs.excludeIds.foundations,
    excludeColumnTypeFootingIds: bbs.excludeIds.columnTypeFootings,
  })
  const STEEL_DEFS = [
    { key: 'footing',    label: 'Footings',   rk: BOQ_LINE_IDS.STEEL_FOOTING,   et: 'FOOTING',    bbsKey: 'footing' },
    { key: 'column',     label: 'Columns',    rk: BOQ_LINE_IDS.STEEL_COLUMN,    et: 'COLUMN',     bbsKey: 'column'  },
    { key: 'beam',       label: 'Beams',      rk: BOQ_LINE_IDS.STEEL_BEAM,      et: 'BEAM',       bbsKey: 'beam'    },
    { key: 'slab',       label: 'Slabs',      rk: BOQ_LINE_IDS.STEEL_SLAB,      et: 'SLAB',       bbsKey: 'slab'    },
    { key: 'staircase',  label: 'Staircases', rk: BOQ_LINE_IDS.STEEL_STAIRCASE, et: 'STAIRCASE',  bbsKey: null      },
    { key: 'civilStamp', label: 'Civil',      rk: BOQ_LINE_IDS.STEEL_CIVIL,     et: 'CIVIL_STAMP', bbsKey: null     },
  ]
  for (const { key, label, rk, et, bbsKey } of STEEL_DEFS) {
    if (bbsKey) {
      for (const grp of (bbs.groupedBySpec[bbsKey] ?? [])) {
        if (grp.totalKg <= 0) continue
        push({
          id:        BOQ_LINE_ID.steelSpec(rk, grp.specId),
          category:  BOQ_CATEGORIES.STEEL,
          label:     `Steel – ${label} — ${grp.specLabel} (${humanizeSource(grp.source)})`,
          qty:       r2(grp.totalKg),
          unit:      UNITS.KG,
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
          sourceEntityIds: grp.sourceEntityIds ?? [],
        })
      }
    }
    const estKg = steelQ?.[key] ?? 0
    if (estKg > 0) {
      push({
        id:        rk,
        category:  BOQ_CATEGORIES.STEEL,
        label:     `Steel – ${label} (Estimate, kg/m³)`,
        qty:       r2(estKg),
        unit:      UNITS.KG,
        rateKey:   rk,
        formulaId: `steel_${et}`,
        meta:      { bbs: false, source: 'ESTIMATE' },
      })
    }
  }

  // ── 6. Concrete mix (M20 + M7.5) ──────────────────────────────────────
  const conc = state.getConcreteByGrade()
  if (conc.M7_5?.volM3 > 0) {
    push({ id: BOQ_LINE_IDS.CONC_M7_5_CEMENT, category: BOQ_CATEGORIES.CONCRETE_MIX, label: 'M7.5 – Cement',       qty: r2(conc.M7_5.cementBags),   unit: UNITS.BAG, rateKey: BOQ_LINE_IDS.CONC_M7_5_CEMENT, formulaId: 'conc_M7_5' })
    push({ id: BOQ_LINE_IDS.CONC_M7_5_SAND,   category: BOQ_CATEGORIES.CONCRETE_MIX, label: 'M7.5 – Sand (dry)',   qty: r2(conc.M7_5.sandM3DRY),    unit: UNITS.M3,  rateKey: BOQ_LINE_IDS.CONC_M7_5_SAND,   formulaId: 'conc_M7_5' })
    push({ id: BOQ_LINE_IDS.CONC_M7_5_AGG20,  category: BOQ_CATEGORIES.CONCRETE_MIX, label: 'M7.5 – Agg 20mm',     qty: r2(conc.M7_5.agg20mmM3DRY), unit: UNITS.M3,  rateKey: BOQ_LINE_IDS.CONC_M7_5_AGG20,  formulaId: 'conc_M7_5' })
  }
  if (conc.M20?.volM3 > 0) {
    push({ id: BOQ_LINE_IDS.CONC_M20_CEMENT, category: BOQ_CATEGORIES.CONCRETE_MIX, label: 'M20 – Cement',         qty: r2(conc.M20.cementBags),   unit: UNITS.BAG, rateKey: BOQ_LINE_IDS.CONC_M20_CEMENT, formulaId: 'conc_M20' })
    push({ id: BOQ_LINE_IDS.CONC_M20_SAND,   category: BOQ_CATEGORIES.CONCRETE_MIX, label: 'M20 – Sand (dry)',     qty: r2(conc.M20.sandM3DRY),    unit: UNITS.M3,  rateKey: BOQ_LINE_IDS.CONC_M20_SAND,   formulaId: 'conc_M20' })
    push({ id: BOQ_LINE_IDS.CONC_M20_AGG10,  category: BOQ_CATEGORIES.CONCRETE_MIX, label: 'M20 – Agg 10mm (dry)', qty: r2(conc.M20.agg10mmM3DRY), unit: UNITS.M3,  rateKey: BOQ_LINE_IDS.CONC_M20_AGG10,  formulaId: 'conc_M20' })
    push({ id: BOQ_LINE_IDS.CONC_M20_AGG20,  category: BOQ_CATEGORIES.CONCRETE_MIX, label: 'M20 – Agg 20mm (dry)', qty: r2(conc.M20.agg20mmM3DRY), unit: UNITS.M3,  rateKey: BOQ_LINE_IDS.CONC_M20_AGG20,  formulaId: 'conc_M20' })
  }

  // ── 7. Plum concrete (Phase 1.6e) ─────────────────────────────────────
  const plumFt3 = r2(
    Object.values(fdnQ.byFoundation).reduce((s, q) => s + (q.plumVolFt3 || 0), 0) +
    Object.values(fdnQ.byColumnTypeInline).reduce((s, q) => s + (q.plumVolFt3 || 0), 0)
  )
  if (plumFt3 > 0) push({ id: BOQ_LINE_IDS.PLUM_CONCRETE, category: BOQ_CATEGORIES.PLUM_CONCRETE, label: 'Plum Concrete (under footings)', qty: plumFt3, unit: UNITS.FT3, rateKey: BOQ_LINE_IDS.PLUM_CONCRETE, formulaId: BOQ_LINE_IDS.PLUM_CONCRETE })

  // ── 8. Shuttering (Phase 1.6a) ────────────────────────────────────────
  const shutQ = computeShutteringQuantities(state)
  if (shutQ.totalAreaFt2 > 0) {
    if (shutQ.subtotals.columns   > 0) push({ id: BOQ_LINE_IDS.SHUTTER_COLUMNS,   category: BOQ_CATEGORIES.SHUTTERING, label: 'Shuttering — Columns',   qty: shutQ.subtotals.columns,   unit: UNITS.FT2, rateKey: BOQ_LINE_IDS.SHUTTER_COLUMNS,   formulaId: 'shuttering' })
    if (shutQ.subtotals.beams     > 0) push({ id: BOQ_LINE_IDS.SHUTTER_BEAMS,     category: BOQ_CATEGORIES.SHUTTERING, label: 'Shuttering — Beams',     qty: shutQ.subtotals.beams,     unit: UNITS.FT2, rateKey: BOQ_LINE_IDS.SHUTTER_BEAMS,     formulaId: 'shuttering' })
    if (shutQ.subtotals.footings  > 0) push({ id: BOQ_LINE_IDS.SHUTTER_FOOTINGS,  category: BOQ_CATEGORIES.SHUTTERING, label: 'Shuttering — Footings',  qty: shutQ.subtotals.footings,  unit: UNITS.FT2, rateKey: BOQ_LINE_IDS.SHUTTER_FOOTINGS,  formulaId: 'shuttering' })
    if (shutQ.subtotals.slab      > 0) push({ id: BOQ_LINE_IDS.SHUTTER_SLAB,      category: BOQ_CATEGORIES.SHUTTERING, label: 'Shuttering — Slab',      qty: shutQ.subtotals.slab,      unit: UNITS.FT2, rateKey: BOQ_LINE_IDS.SHUTTER_SLAB,      formulaId: 'shuttering' })
    if (shutQ.subtotals.staircase > 0) push({ id: BOQ_LINE_IDS.SHUTTER_STAIR,     category: BOQ_CATEGORIES.SHUTTERING, label: 'Shuttering — Staircase', qty: shutQ.subtotals.staircase, unit: UNITS.FT2, rateKey: BOQ_LINE_IDS.SHUTTER_STAIR,     formulaId: 'shuttering' })
  }

  // ── 9. Excavation (Phase 1.6b) ────────────────────────────────────────
  const excQ = computeExcavationQuantities(state)
  if (excQ.totalVolFt3 > 0) {
    if (excQ.subtotals.bulk       > 0) push({ id: BOQ_LINE_IDS.EXCAV_BULK,  category: BOQ_CATEGORIES.EXCAVATION, label: 'Excavation — Bulk',                       qty: excQ.subtotals.bulk,       unit: UNITS.FT3, rateKey: BOQ_LINE_IDS.EXCAV_BULK,  formulaId: 'excavation' })
    if (excQ.subtotals.foundation > 0) push({ id: BOQ_LINE_IDS.EXCAV_PIT,   category: BOQ_CATEGORIES.EXCAVATION, label: 'Excavation — Foundation pits (extra)',    qty: excQ.subtotals.foundation, unit: UNITS.FT3, rateKey: BOQ_LINE_IDS.EXCAV_PIT,   formulaId: 'excavation' })
    if (excQ.subtotals.civil      > 0) push({ id: BOQ_LINE_IDS.EXCAV_CIVIL, category: BOQ_CATEGORIES.EXCAVATION, label: 'Excavation — Civil stamps (sump/septic)', qty: excQ.subtotals.civil,      unit: UNITS.FT3, rateKey: BOQ_LINE_IDS.EXCAV_CIVIL, formulaId: 'excavation' })
  }

  // ── 10. Plaster materials by system (Phase 1.6f) ──────────────────────
  for (const sys of Object.values(plasterQ.bySystem)) {
    if (sys.kind === PLASTER_KIND.CEMENT_SAND) {
      push({ id: BOQ_LINE_ID.plasterCement(sys.systemId), category: BOQ_CATEGORIES.PLASTER, label: `Plaster ${sys.label} — Cement`, qty: sys.cementBags, unit: UNITS.BAG, rateKey: BOQ_LINE_ID.plasterCement(sys.systemId), formulaId: `plaster_${sys.systemId}`, meta: { plasterSystemId: sys.systemId } })
      push({ id: BOQ_LINE_ID.plasterSand(sys.systemId),   category: BOQ_CATEGORIES.PLASTER, label: `Plaster ${sys.label} — Sand`,   qty: sys.sandM3,     unit: UNITS.M3,  rateKey: BOQ_LINE_ID.plasterSand(sys.systemId),   formulaId: `plaster_${sys.systemId}`, meta: { plasterSystemId: sys.systemId } })
    } else {
      push({ id: BOQ_LINE_ID.plasterMaterial(sys.systemId), category: BOQ_CATEGORIES.PLASTER, label: `Plaster ${sys.label} — Material`, qty: sys.materialBags, unit: UNITS.BAG, rateKey: BOQ_LINE_ID.plasterMaterial(sys.systemId), formulaId: `plaster_${sys.systemId}`, meta: { plasterSystemId: sys.systemId } })
    }
  }

  // ── 11. Joinery (Rev 2) ───────────────────────────────────────────────
  const joineryQ = computeJoineryQuantities(state)
  const joineryDefs = [
    { sub: OPENING_SUBTYPE.MAIN_DOOR,     prefix: 'Main door',     hasShutter: true,
      ids: { count: BOQ_LINE_IDS.JOINERY_MAIN_DOOR_COUNT, frame: BOQ_LINE_IDS.JOINERY_MAIN_DOOR_FRAME, shutter: BOQ_LINE_IDS.JOINERY_MAIN_DOOR_SHUTTER } },
    { sub: OPENING_SUBTYPE.INTERNAL_DOOR, prefix: 'Internal door', hasShutter: true,
      ids: { count: BOQ_LINE_IDS.JOINERY_INTERNAL_DOOR_COUNT, frame: BOQ_LINE_IDS.JOINERY_INTERNAL_DOOR_FRAME, shutter: BOQ_LINE_IDS.JOINERY_INTERNAL_DOOR_SHUTTER } },
    { sub: OPENING_SUBTYPE.WINDOW,        prefix: 'Window',        hasShutter: true,
      ids: { count: BOQ_LINE_IDS.JOINERY_WINDOW_COUNT, frame: BOQ_LINE_IDS.JOINERY_WINDOW_FRAME, shutter: BOQ_LINE_IDS.JOINERY_WINDOW_SHUTTER } },
    { sub: OPENING_SUBTYPE.VENTILATOR,    prefix: 'Ventilator',    hasShutter: false,
      ids: { count: BOQ_LINE_IDS.JOINERY_VENTILATOR_COUNT, frame: BOQ_LINE_IDS.JOINERY_VENTILATOR_FRAME, area: BOQ_LINE_IDS.JOINERY_VENTILATOR_AREA } },
  ]
  for (const def of joineryDefs) {
    const bucket = joineryQ.bySubtype[def.sub]
    if (!bucket || bucket.count === 0) continue
    const ids = bucket.instances.map(i => i.openingId)
    push({ id: def.ids.count, category: BOQ_CATEGORIES.JOINERY, label: `${def.prefix} (count)`, qty: bucket.count, unit: UNITS.NOS, rateKey: def.ids.count, formulaId: def.ids.count, meta: { subtype: def.sub }, sourceEntityIds: ids })
    push({ id: def.ids.frame, category: BOQ_CATEGORIES.JOINERY, label: `${def.prefix} frame`,    qty: bucket.frameRft, unit: UNITS.RFT, rateKey: def.ids.frame, formulaId: def.ids.frame, meta: { subtype: def.sub }, sourceEntityIds: ids })
    if (def.hasShutter) {
      push({ id: def.ids.shutter, category: BOQ_CATEGORIES.JOINERY, label: `${def.prefix} shutter`, qty: bucket.shutterFt2, unit: UNITS.SFT, rateKey: def.ids.shutter, formulaId: def.ids.shutter, meta: { subtype: def.sub }, sourceEntityIds: ids })
    } else {
      // Ventilator emits area instead of shutter.
      push({ id: def.ids.area, category: BOQ_CATEGORIES.JOINERY, label: `${def.prefix} area`, qty: bucket.shutterFt2, unit: UNITS.SFT, rateKey: def.ids.area, formulaId: def.ids.area, meta: { subtype: def.sub }, sourceEntityIds: ids })
    }
  }

  // ── 12. Tiles (Rev 2) ─────────────────────────────────────────────────
  const tileQ = computeTileQuantities(state)
  if (tileQ.totals.floorTilesFt2 > 0) {
    push({
      id:        BOQ_LINE_IDS.TILES_FLOOR,
      category:  BOQ_CATEGORIES.TILES,
      label:     'Floor tiles',
      qty:       tileQ.totals.floorTilesFt2,
      unit:      UNITS.SFT,
      rateKey:   BOQ_LINE_IDS.TILES_FLOOR,
      formulaId: BOQ_LINE_IDS.TILES_FLOOR,
      meta:      { perRoom: tileQ.perRoom.map(r => ({ roomId: r.roomId, qty: r.floorTilesFt2 })) },
      sourceEntityIds: tileQ.perRoom.filter(r => r.floorTilesFt2 > 0).map(r => r.roomId),
    })
  }
  if (tileQ.totals.wallTilesFt2 > 0) {
    push({
      id:        BOQ_LINE_IDS.TILES_WALL_DADO,
      category:  BOQ_CATEGORIES.TILES,
      label:     'Wall tiles / dado',
      qty:       tileQ.totals.wallTilesFt2,
      unit:      UNITS.SFT,
      rateKey:   BOQ_LINE_IDS.TILES_WALL_DADO,
      formulaId: BOQ_LINE_IDS.TILES_WALL_DADO,
      meta:      { perRoom: tileQ.perRoom.map(r => ({ roomId: r.roomId, qty: r.wallTilesFt2 })) },
      sourceEntityIds: tileQ.perRoom.filter(r => r.wallTilesFt2 > 0).map(r => r.roomId),
    })
  }
  if (tileQ.totals.skirtingRft > 0) {
    push({
      id:        BOQ_LINE_IDS.TILES_SKIRTING,
      category:  BOQ_CATEGORIES.TILES,
      label:     'Floor skirting',
      qty:       tileQ.totals.skirtingRft,
      unit:      UNITS.RFT,
      rateKey:   BOQ_LINE_IDS.TILES_SKIRTING,
      formulaId: BOQ_LINE_IDS.TILES_SKIRTING,
      meta:      { perRoom: tileQ.perRoom.map(r => ({ roomId: r.roomId, qty: r.skirtingRft })) },
      sourceEntityIds: tileQ.perRoom.filter(r => r.skirtingRft > 0).map(r => r.roomId),
    })
  }
  if (tileQ.totals.kitchenCounterFt2 > 0) {
    push({
      id:        BOQ_LINE_IDS.TILES_KITCHEN_COUNTER,
      category:  BOQ_CATEGORIES.TILES,
      label:     'Kitchen granite counter',
      qty:       tileQ.totals.kitchenCounterFt2,
      unit:      UNITS.SFT,
      rateKey:   BOQ_LINE_IDS.TILES_KITCHEN_COUNTER,
      formulaId: BOQ_LINE_IDS.TILES_KITCHEN_COUNTER,
      meta:      { perRoom: tileQ.perRoom.filter(r => r.kitchenCounterFt2 > 0).map(r => ({ roomId: r.roomId, qty: r.kitchenCounterFt2 })) },
      sourceEntityIds: tileQ.perRoom.filter(r => r.kitchenCounterFt2 > 0).map(r => r.roomId),
    })
  }

  // ── 13. Grills + handrails (Rev 2) ────────────────────────────────────
  const grillQ = computeGrillQuantities(state)
  if (grillQ.windowGrillFt2 > 0) {
    push({
      id:        BOQ_LINE_IDS.GRILLS_WINDOW,
      category:  BOQ_CATEGORIES.GRILLS,
      label:     'Window grills (MS)',
      qty:       grillQ.windowGrillFt2,
      unit:      UNITS.SFT,
      rateKey:   BOQ_LINE_IDS.GRILLS_WINDOW,
      formulaId: BOQ_LINE_IDS.GRILLS_WINDOW,
      meta:      { perWindow: grillQ.perWindow },
      sourceEntityIds: grillQ.perWindow.map(w => w.openingId),
    })
  }
  if (grillQ.mainDoorGrillCount > 0) {
    push({
      id:        BOQ_LINE_IDS.GRILLS_MAIN_DOOR,
      category:  BOQ_CATEGORIES.GRILLS,
      label:     'Main door safety grill',
      qty:       grillQ.mainDoorGrillCount,
      unit:      UNITS.NOS,
      rateKey:   BOQ_LINE_IDS.GRILLS_MAIN_DOOR,
      formulaId: BOQ_LINE_IDS.GRILLS_MAIN_DOOR,
    })
  }
  if (grillQ.staircaseHandrailRft > 0) {
    push({
      id:        BOQ_LINE_IDS.GRILLS_STAIRCASE_HANDRAIL,
      category:  BOQ_CATEGORIES.GRILLS,
      label:     'Staircase handrail',
      qty:       grillQ.staircaseHandrailRft,
      unit:      UNITS.RFT,
      rateKey:   BOQ_LINE_IDS.GRILLS_STAIRCASE_HANDRAIL,
      formulaId: BOQ_LINE_IDS.GRILLS_STAIRCASE_HANDRAIL,
      meta:      { perStaircase: grillQ.perStaircase },
      sourceEntityIds: grillQ.perStaircase.map(s => s.staircaseId),
      // Per-line override: staircase handrail doesn't decompose per room.
      scopeSupport: PROJECT_AND_FLOOR_ONLY,
    })
  }
  if (grillQ.balconyHandrailRft > 0) {
    push({
      id:        BOQ_LINE_IDS.GRILLS_BALCONY_HANDRAIL,
      category:  BOQ_CATEGORIES.GRILLS,
      label:     'Balcony handrail',
      qty:       grillQ.balconyHandrailRft,
      unit:      UNITS.RFT,
      rateKey:   BOQ_LINE_IDS.GRILLS_BALCONY_HANDRAIL,
      formulaId: BOQ_LINE_IDS.GRILLS_BALCONY_HANDRAIL,
      meta:      { perBalcony: grillQ.perBalcony },
      sourceEntityIds: grillQ.perBalcony.map(b => b.roomId),
    })
  }

  // ── 14. MEP discipline emitters ───────────────────────────────────────
  emitPlumbingLines(state, push, { rates, scopedFloorId })
  emitElectricalLines(state, push, { rates, scopedFloorId })
  emitHvacLines(state, push, { rates, scopedFloorId })
  emitFireLines(state, push, { rates, scopedFloorId })
  emitElvLines(state, push, { rates, scopedFloorId })

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

// scopeSupport filter — returns only lines visible in the active scope.
// Used by BOQPanel and exports to hide project-level lines in room scope.
export function filterLinesByScope(lines, activeScope) {
  return lines.filter(l => (l.scopeSupport ?? [BOQ_SCOPE.PROJECT, BOQ_SCOPE.FLOOR]).includes(activeScope))
}
