import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import {
  explainColumnRCC, explainFootingRCC, explainFootingPCC, explainBeamRCC,
  explainSlabMain, explainSlabSunken, explainSunshades, explainParapet,
  explainStaircaseRCC, explainSteelByElement, explainConcreteGrade,
} from '../formulas'
import { BEAM_LEVEL_REGISTRY } from '../constants/structural'
import { computeBBSQuantities } from '../quantities/bbs'
import { computeFoundationQuantities } from '../quantities/foundations'
import { humanizeAssignmentSource } from '../specs/resolution'

const COL = '1fr 68px 88px 70px'
const GAP = 3

function r2(n) { return Math.round(n * 100) / 100 }

function calcCost(qty, rateStr, isPer1000 = false) {
  const r = parseFloat(rateStr)
  if (!rateStr || isNaN(r) || r <= 0) return null
  return isPer1000 ? (qty / 1000) * r : qty * r
}

function fmtCost(n) {
  if (n === null) return '—'
  return '₹' + Math.round(n).toLocaleString('en-IN')
}

const rateInputStyle = {
  width: 52, fontSize: 11, padding: '2px 4px',
  border: '1px solid #ddd', borderRadius: 3, textAlign: 'right', outline: 'none',
}

function PricedSubRow({ label, qtyDisplay, unitLabel, rateKey, rates, onRateChange, cost, infoId, openId, onInfoClick }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: COL, gap: GAP, marginBottom: 4, paddingLeft: 10, alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ color: '#888', fontSize: 11 }}>{label}</span>
        {infoId && (
          <button data-info-btn="" onClick={e => onInfoClick(infoId, e)} title="Show formula"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12,
              color: openId === infoId ? '#555' : '#bbb', padding: '0 1px', lineHeight: 1, flexShrink: 0 }}>
            ⓘ
          </button>
        )}
      </div>
      <span style={{ fontWeight: 500, textAlign: 'right', fontSize: 11 }}>{qtyDisplay}</span>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        <input type="number" min="0" step="0.01" value={rates[rateKey] ?? ''} onChange={e => onRateChange(rateKey, e.target.value)}
          placeholder={unitLabel} style={{ ...rateInputStyle, width: 48, fontSize: 10 }} />
      </div>
      <span style={{ textAlign: 'right', fontSize: 11, color: cost !== null ? '#333' : '#ccc' }}>{fmtCost(cost)}</span>
    </div>
  )
}

function SectionHeader({ title }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 2 }}>
      {title}
    </div>
  )
}

// `bbsKey` matches `computeBBSQuantities().groupedBySpec[bbsKey]`. null = no BBS pipeline
// for this category (staircase + civil always run on kg/m³).
const STEEL_DEFS = [
  { key: 'footing',    label: 'Footings',   rk: 'steel_footing',   et: 'FOOTING',    bbsKey: 'footing' },
  { key: 'column',     label: 'Columns',    rk: 'steel_column',    et: 'COLUMN',     bbsKey: 'column'  },
  { key: 'beam',       label: 'Beams',      rk: 'steel_beam',      et: 'BEAM',       bbsKey: 'beam'    },
  { key: 'slab',       label: 'Slabs',      rk: 'steel_slab',      et: 'SLAB',       bbsKey: 'slab'    },
  { key: 'staircase',  label: 'Staircases', rk: 'steel_staircase', et: 'STAIRCASE',  bbsKey: null      },
  { key: 'civilStamp', label: 'Civil',      rk: 'steel_civil',     et: 'CIVIL_STAMP', bbsKey: null     },
]

export default function StructuralBOQSection({ rates, onRateChange, openId, onInfoClick, onLinesReady, formulaState }) {
  const prevLinesJsonRef = useRef(null)

  const getColumnQuantities    = useStore(s => s.getColumnQuantities)
  const getFootingQuantities   = useStore(s => s.getFootingQuantities)
  const getBeamQuantities      = useStore(s => s.getBeamQuantities)
  const getSlabQuantities      = useStore(s => s.getSlabQuantities)
  const getStaircaseQuantities = useStore(s => s.getStaircaseQuantities)
  const getSunshadeQuantities  = useStore(s => s.getSunshadeQuantities)
  const getParapetQuantities   = useStore(s => s.getParapetQuantities)
  const getSteelQuantities     = useStore(s => s.getSteelQuantities)
  const getConcreteByGrade     = useStore(s => s.getConcreteByGrade)
  // Subscribe to spec catalog + per-class defaults so BBS resolution re-renders
  // when the user edits a spec or changes a default. Without these, the
  // grouped-by-spec rows below would be stale.
  const reinforcementSpecs = useStore(s => s.projectSettings?.reinforcementSpecs)
  const bbsDefaults        = useStore(s => s.projectSettings?.bbsDefaults)
  // Also subscribe to entity maps that carry per-instance reinforcementSpecId.
  const subColumns     = useStore(s => s.columns)
  const subBeams       = useStore(s => s.beams)
  const subSlabs       = useStore(s => s.slabs)
  const subFoundations = useStore(s => s.foundations)
  void reinforcementSpecs; void bbsDefaults
  void subColumns; void subBeams; void subSlabs; void subFoundations

  const colQtys      = getColumnQuantities()
  const fotQtys      = getFootingQuantities()
  const beamQtys     = getBeamQuantities()
  const slabQ        = getSlabQuantities()
  const staircases   = getStaircaseQuantities()
  const sunshadeQ    = getSunshadeQuantities()
  const parapetQ     = getParapetQuantities()
  const conc         = getConcreteByGrade()

  // Phase 1.7+ — BBS pipeline. Per-instance resolution lives in
  // src/specs/resolution.js; this component never inspects spec ids directly.
  // Excluded ids are fed to getSteelQuantities so the residual kg/m³
  // estimate only covers entities NOT already represented by a BBS row.
  const bbs = computeBBSQuantities(useStore.getState())
  const steelQtys = getSteelQuantities({
    excludeColumnIds:            bbs.excludeIds.columns,
    excludeBeamIds:              bbs.excludeIds.beams,
    excludeSlabIds:              bbs.excludeIds.slabs,
    excludeFoundationIds:        bbs.excludeIds.foundations,
    excludeColumnTypeFootingIds: bbs.excludeIds.columnTypeFootings,
  })

  const totalStairRcc = staircases.reduce((s, sc) => s + sc.totalRccFt3, 0)

  // BBS-covered kg + residual estimate kg = visible category total.
  const steelCategoryTotal = (key) => (bbs.bbsCoveredKg[key] ?? 0) + (steelQtys[key] ?? 0)
  const totalSteelKg =
    steelCategoryTotal('footing') + steelCategoryTotal('column') +
    steelCategoryTotal('beam') + steelCategoryTotal('slab') +
    (steelQtys.staircase ?? 0) + (steelQtys.civilStamp ?? 0)

  // Foundation entities (PILE / RAFT / STRIP / COMBINED / ISOLATED entities)
  // — rendered separately from the inline auto-isolated `fotQtys` bucket.
  // Without this, projects with only foundation entities (e.g., a standalone
  // PILE foundation, no columns) had no Structural RCC section at all.
  const fdnEntities = computeFoundationQuantities(useStore.getState()).perFoundation
    .filter(f => (f.concreteVolFt3 ?? 0) > 0 || (f.pccVolFt3 ?? 0) > 0)

  const hasRCC = Object.keys(colQtys).length > 0 || Object.keys(fotQtys).length > 0 ||
    fdnEntities.length > 0 ||
    BEAM_LEVEL_REGISTRY.some(l => beamQtys[l.id]) || slabQ.mainVolFt3 > 0 ||
    (sunshadeQ?.count > 0) || (parapetQ?.totalLenFt > 0)
  const hasSteel = totalSteelKg > 0
  const hasConcrete = (conc.M7_5?.volM3 > 0) || (conc.M20?.volM3 > 0)
  const hasStaircase = staircases.length > 0

  useEffect(() => {
    const lines = []
    const add = (label, qty, unit, rateKey) =>
      lines.push({ label, qty, unit, rateKey, cost: calcCost(qty, rates[rateKey]) })

    for (const [typeId, q] of Object.entries(colQtys))
      add(`Column ${q.label} ×${q.count}`, r2(q.volFt3), 'ft³', `col_${typeId}_rcc`)

    for (const [typeId, q] of Object.entries(fotQtys)) {
      add(`Footing ${q.label} ×${q.count}`, r2(q.concreteVolFt3), 'ft³', `fot_${typeId}_rcc`)
      add(`PCC under ${q.label}`, r2(q.pccVolFt3), 'ft³', `fot_${typeId}_pcc`)
    }

    // Foundation entities — mirror boq/lines.js emission (PILE → shaft + cap;
    // others → one combined line). Same rateKeys, same labels.
    for (const f of fdnEntities) {
      if (f.type === 'PILE') {
        const pg = f.pileGeometry || {}
        if ((f.shaftVolFt3 ?? 0) > 0)
          add(`${f.label} — Shaft (${pg.pilesCount}× Ø${pg.pileDiamIn}″ × ${pg.pileLengthFt}ft)`,
              r2(f.shaftVolFt3), 'ft³', `fdn_${f.id}_rcc_shaft`)
        if ((f.capVolFt3 ?? 0) > 0)
          add(`${f.label} — Cap (${pg.capLengthFt}×${pg.capWidthFt}×${pg.capDepthFt}ft)`,
              r2(f.capVolFt3), 'ft³', `fdn_${f.id}_rcc_cap`)
      } else if ((f.concreteVolFt3 ?? 0) > 0) {
        add(`Foundation ${f.label}`, r2(f.concreteVolFt3), 'ft³', `fdn_${f.id}_rcc`)
      }
      if ((f.pccVolFt3 ?? 0) > 0)
        add(`PCC under ${f.label}`, r2(f.pccVolFt3), 'ft³', `fdn_${f.id}_pcc`)
    }

    for (const lvl of BEAM_LEVEL_REGISTRY)
      if (beamQtys[lvl.id]) add(`${lvl.label} beams`, r2(beamQtys[lvl.id].volFt3), 'ft³', `beam_${lvl.id}`)

    if (slabQ.mainVolFt3 > 0)    add('Main slab (M20)', r2(slabQ.mainVolFt3), 'ft³', 'slab_main')
    if (slabQ.sunkenVolFt3 > 0)  add('Sunken slab', r2(slabQ.sunkenVolFt3), 'ft³', 'slab_sunken')
    if (sunshadeQ?.count > 0)    add(`Sunshades ×${sunshadeQ.count}`, r2(sunshadeQ.totalVolFt3), 'ft³', 'sunshade_rcc')
    if (parapetQ?.totalLenFt > 0) add('Parapet', r2(parapetQ.totalVolFt3), 'ft³', 'parapet_rcc')

    // Phase 1.7+ — emit one row per resolved-spec group (BBS) + at most one
    // residual estimate row per category. Mirrors boq/lines.js so on-screen
    // and canonical line lists stay in lockstep.
    for (const { key, label, rk, bbsKey } of STEEL_DEFS) {
      if (bbsKey) {
        for (const grp of (bbs.groupedBySpec[bbsKey] ?? [])) {
          if (grp.totalKg <= 0) continue
          add(
            `Steel – ${label} — ${grp.specLabel} (${humanizeAssignmentSource(grp.source)})`,
            r2(grp.totalKg), 'kg', rk
          )
        }
      }
      const estKg = steelQtys?.[key] ?? 0
      if (estKg > 0) add(`Steel – ${label} (Estimate, kg/m³)`, r2(estKg), 'kg', rk)
    }

    if (conc.M7_5?.volM3 > 0) {
      const g = conc.M7_5
      add('M7.5 – Cement', r2(g.cementBags), 'bags', 'conc_M7_5_cement')
      add('M7.5 – Sand', r2(g.sandM3DRY), 'm³', 'conc_M7_5_sand')
      add('M7.5 – Agg 20mm', r2(g.agg20mmM3DRY), 'm³', 'conc_M7_5_agg20')
    }
    if (conc.M20?.volM3 > 0) {
      const g = conc.M20
      add('M20 – Cement', r2(g.cementBags), 'bags', 'conc_M20_cement')
      add('M20 – Sand', r2(g.sandM3DRY), 'm³', 'conc_M20_sand')
      add('M20 – Agg 10mm', r2(g.agg10mmM3DRY), 'm³', 'conc_M20_agg10')
      add('M20 – Agg 20mm', r2(g.agg20mmM3DRY), 'm³', 'conc_M20_agg20')
    }

    if (hasStaircase) add('Staircase RCC', r2(totalStairRcc), 'ft³', 'stair_rcc')

    const json = JSON.stringify(lines)
    if (json !== prevLinesJsonRef.current) {
      prevLinesJsonRef.current = json
      onLinesReady(lines)
    }
  })

  const sh = { rates, onRateChange, openId, onInfoClick }
  // React `key` uses infoId when provided — required because Phase 1.7+ steel
  // rows share the same rateKey across multiple grouped-by-spec rows in one
  // category, so rateKey alone is not unique.
  const row = (label, qty, unit, rk, infoId) => (
    <PricedSubRow key={infoId ?? rk} label={label} qtyDisplay={`${qty} ${unit}`} unitLabel={`₹/${unit}`}
      rateKey={rk} cost={calcCost(qty, rates[rk])} infoId={infoId ?? rk} {...sh} />
  )

  return (
    <>
      {hasRCC && (
        <div style={{ marginBottom: 12 }}>
          <SectionHeader title="Structural RCC" />
          {Object.entries(colQtys).map(([id, q]) => row(`Column ${q.label} ×${q.count}`, r2(q.volFt3), 'ft³', `col_${id}_rcc`))}
          {Object.entries(fotQtys).map(([id, q]) => (
            <div key={id}>
              {row(`Footing ${q.label} ×${q.count}`, r2(q.concreteVolFt3), 'ft³', `fot_${id}_rcc`)}
              {row(`PCC under ${q.label}`, r2(q.pccVolFt3), 'ft³', `fot_${id}_pcc`)}
            </div>
          ))}
          {fdnEntities.map(f => {
            if (f.type === 'PILE') {
              const pg = f.pileGeometry || {}
              return (
                <div key={f.id}>
                  {(f.shaftVolFt3 ?? 0) > 0 && row(
                    `${f.label} — Shaft (${pg.pilesCount}× Ø${pg.pileDiamIn}″ × ${pg.pileLengthFt}ft)`,
                    r2(f.shaftVolFt3), 'ft³', `fdn_${f.id}_rcc_shaft`)}
                  {(f.capVolFt3 ?? 0) > 0 && row(
                    `${f.label} — Cap (${pg.capLengthFt}×${pg.capWidthFt}×${pg.capDepthFt}ft)`,
                    r2(f.capVolFt3), 'ft³', `fdn_${f.id}_rcc_cap`)}
                  {(f.pccVolFt3 ?? 0) > 0 && row(
                    `PCC under ${f.label}`, r2(f.pccVolFt3), 'ft³', `fdn_${f.id}_pcc`)}
                </div>
              )
            }
            return (
              <div key={f.id}>
                {(f.concreteVolFt3 ?? 0) > 0 && row(
                  `Foundation ${f.label}`, r2(f.concreteVolFt3), 'ft³', `fdn_${f.id}_rcc`)}
                {(f.pccVolFt3 ?? 0) > 0 && row(
                  `PCC under ${f.label}`, r2(f.pccVolFt3), 'ft³', `fdn_${f.id}_pcc`)}
              </div>
            )
          })}
          {BEAM_LEVEL_REGISTRY.map(lvl => beamQtys[lvl.id]
            ? row(`${lvl.label} beams`, r2(beamQtys[lvl.id].volFt3), 'ft³', `beam_${lvl.id}`)
            : null
          )}
          {slabQ.mainVolFt3 > 0   && row('Main slab (M20)', r2(slabQ.mainVolFt3), 'ft³', 'slab_main')}
          {slabQ.sunkenVolFt3 > 0 && row('Sunken slab', r2(slabQ.sunkenVolFt3), 'ft³', 'slab_sunken')}
          {sunshadeQ?.count > 0   && row(`Sunshades ×${sunshadeQ.count}`, r2(sunshadeQ.totalVolFt3), 'ft³', 'sunshade_rcc')}
          {parapetQ?.totalLenFt > 0 && row('Parapet', r2(parapetQ.totalVolFt3), 'ft³', 'parapet_rcc')}
        </div>
      )}

      {hasSteel && (
        <div style={{ marginBottom: 12 }}>
          <SectionHeader title="Structural Steel" />
          {STEEL_DEFS.flatMap(({ key, label, rk, et, bbsKey }) => {
            const rows = []
            // One row per resolved-spec group. Same rateKey across all rows
            // in a category so the user only enters one rate per element type.
            if (bbsKey) {
              for (const grp of (bbs.groupedBySpec[bbsKey] ?? [])) {
                if (grp.totalKg <= 0) continue
                rows.push(row(
                  `${label} — ${grp.specLabel} (${humanizeAssignmentSource(grp.source)})`,
                  r2(grp.totalKg), 'kg', rk,
                  `steel_${et}_spec_${grp.specId}`,
                ))
              }
            }
            const estKg = steelQtys[key] ?? 0
            if (estKg > 0) {
              rows.push(row(
                `${label} (Estimate, kg/m³)`,
                r2(estKg), 'kg', rk,
                `steel_${et}`,
              ))
            }
            return rows
          })}
          <div style={{ display: 'grid', gridTemplateColumns: COL, gap: GAP, marginBottom: 4, paddingLeft: 10, alignItems: 'center' }}>
            <span style={{ color: '#888', fontSize: 11 }}>Total steel</span>
            <span style={{ fontWeight: 500, textAlign: 'right', fontSize: 11 }}>{r2(totalSteelKg)} kg</span>
            <span /><span />
          </div>
        </div>
      )}

      {hasConcrete && (
        <div style={{ marginBottom: 12 }}>
          <SectionHeader title="Concrete Materials" />
          {conc.M7_5?.volM3 > 0 && (<>
            {row('M7.5 – Cement',       r2(conc.M7_5.cementBags),   'bags', 'conc_M7_5_cement', 'conc_M7_5')}
            {row('M7.5 – Sand (dry)',    r2(conc.M7_5.sandM3DRY),    'm³',   'conc_M7_5_sand',   'conc_M7_5')}
            {row('M7.5 – Agg 20mm (dry)', r2(conc.M7_5.agg20mmM3DRY), 'm³', 'conc_M7_5_agg20', 'conc_M7_5')}
          </>)}
          {conc.M20?.volM3 > 0 && (<>
            {row('M20 – Cement',        r2(conc.M20.cementBags),    'bags', 'conc_M20_cement', 'conc_M20')}
            {row('M20 – Sand (dry)',     r2(conc.M20.sandM3DRY),     'm³',   'conc_M20_sand',   'conc_M20')}
            {row('M20 – Agg 10mm (dry)', r2(conc.M20.agg10mmM3DRY), 'm³',  'conc_M20_agg10',  'conc_M20')}
            {row('M20 – Agg 20mm (dry)', r2(conc.M20.agg20mmM3DRY), 'm³',  'conc_M20_agg20',  'conc_M20')}
          </>)}
        </div>
      )}

      {hasStaircase && (
        <div style={{ marginBottom: 12 }}>
          <SectionHeader title="Staircase" />
          {row('Staircase RCC', r2(totalStairRcc), 'ft³', 'stair_rcc')}
        </div>
      )}
    </>
  )
}
