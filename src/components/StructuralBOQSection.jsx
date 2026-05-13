import { useEffect } from 'react'
import { useStore } from '../store'
import {
  explainColumnRCC, explainFootingRCC, explainFootingPCC, explainBeamRCC,
  explainSlabMain, explainSlabSunken, explainSunshades, explainParapet,
  explainStaircaseRCC, explainSteelByElement, explainConcreteGrade,
} from '../formulas'

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

const STEEL_DEFS = [
  { key: 'footing',    label: 'Footings',   rk: 'steel_footing',   et: 'FOOTING' },
  { key: 'column',     label: 'Columns',    rk: 'steel_column',    et: 'COLUMN' },
  { key: 'beam',       label: 'Beams',      rk: 'steel_beam',      et: 'BEAM' },
  { key: 'slab',       label: 'Slabs',      rk: 'steel_slab',      et: 'SLAB' },
  { key: 'staircase',  label: 'Staircases', rk: 'steel_staircase', et: 'STAIRCASE' },
  { key: 'civilStamp', label: 'Civil',      rk: 'steel_civil',     et: 'CIVIL_STAMP' },
]

const BEAM_LEVELS = ['plinth', 'lintel', 'roof']

export default function StructuralBOQSection({ rates, onRateChange, openId, onInfoClick, onLinesReady, formulaState }) {
  const getColumnQuantities    = useStore(s => s.getColumnQuantities)
  const getFootingQuantities   = useStore(s => s.getFootingQuantities)
  const getBeamQuantities      = useStore(s => s.getBeamQuantities)
  const getSlabQuantities      = useStore(s => s.getSlabQuantities)
  const getStaircaseQuantities = useStore(s => s.getStaircaseQuantities)
  const getSunshadeQuantities  = useStore(s => s.getSunshadeQuantities)
  const getParapetQuantities   = useStore(s => s.getParapetQuantities)
  const getSteelQuantities     = useStore(s => s.getSteelQuantities)
  const getConcreteByGrade     = useStore(s => s.getConcreteByGrade)

  const colQtys      = getColumnQuantities()
  const fotQtys      = getFootingQuantities()
  const beamQtys     = getBeamQuantities()
  const slabQ        = getSlabQuantities()
  const staircases   = getStaircaseQuantities()
  const sunshadeQ    = getSunshadeQuantities()
  const parapetQ     = getParapetQuantities()
  const steelQtys    = getSteelQuantities()
  const conc         = getConcreteByGrade()

  const totalStairRcc = staircases.reduce((s, sc) => s + sc.totalRccFt3, 0)

  const hasRCC = Object.keys(colQtys).length > 0 || Object.keys(fotQtys).length > 0 ||
    BEAM_LEVELS.some(l => beamQtys[l]) || slabQ.mainVolFt3 > 0 ||
    (sunshadeQ?.count > 0) || (parapetQ?.totalLenFt > 0)
  const hasSteel = (steelQtys?.total ?? 0) > 0
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

    for (const l of BEAM_LEVELS)
      if (beamQtys[l]) add(`${l.charAt(0).toUpperCase() + l.slice(1)} beams`, r2(beamQtys[l].volFt3), 'ft³', `beam_${l}`)

    if (slabQ.mainVolFt3 > 0)    add('Main slab (M20)', r2(slabQ.mainVolFt3), 'ft³', 'slab_main')
    if (slabQ.sunkenVolFt3 > 0)  add('Sunken slab', r2(slabQ.sunkenVolFt3), 'ft³', 'slab_sunken')
    if (sunshadeQ?.count > 0)    add(`Sunshades ×${sunshadeQ.count}`, r2(sunshadeQ.totalVolFt3), 'ft³', 'sunshade_rcc')
    if (parapetQ?.totalLenFt > 0) add('Parapet', r2(parapetQ.totalVolFt3), 'ft³', 'parapet_rcc')

    for (const { key, label, rk } of STEEL_DEFS) {
      const kg = steelQtys?.[key] ?? 0
      if (kg > 0) add(`Steel – ${label}`, r2(kg), 'kg', rk)
    }

    if (conc.M7_5?.volM3 > 0) {
      const g = conc.M7_5
      add('M7.5 – Cement', r2(g.cementBags), 'bags', 'conc_M7_5_cement')
      add('M7.5 – Sand', r2(g.sandM3), 'm³', 'conc_M7_5_sand')
      add('M7.5 – Agg 20mm', r2(g.agg20mmM3DRY), 'm³', 'conc_M7_5_agg20')
    }
    if (conc.M20?.volM3 > 0) {
      const g = conc.M20
      add('M20 – Cement', r2(g.cementBags), 'bags', 'conc_M20_cement')
      add('M20 – Sand', r2(g.sandM3), 'm³', 'conc_M20_sand')
      add('M20 – Agg 10mm', r2(g.agg10mmM3DRY), 'm³', 'conc_M20_agg10')
      add('M20 – Agg 20mm', r2(g.agg20mmM3DRY), 'm³', 'conc_M20_agg20')
    }

    if (hasStaircase) add('Staircase RCC', r2(totalStairRcc), 'ft³', 'stair_rcc')

    onLinesReady(lines)
  })

  const sh = { rates, onRateChange, openId, onInfoClick }
  const row = (label, qty, unit, rk, infoId) => (
    <PricedSubRow key={rk} label={label} qtyDisplay={`${qty} ${unit}`} unitLabel={`₹/${unit}`}
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
          {BEAM_LEVELS.map(l => beamQtys[l]
            ? row(`${l.charAt(0).toUpperCase() + l.slice(1)} beams`, r2(beamQtys[l].volFt3), 'ft³', `beam_${l}`)
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
          {STEEL_DEFS.map(({ key, label, rk, et }) => {
            const kg = steelQtys[key] ?? 0
            return kg > 0 ? row(label, r2(kg), 'kg', rk, `steel_${et}`) : null
          })}
          <div style={{ display: 'grid', gridTemplateColumns: COL, gap: GAP, marginBottom: 4, paddingLeft: 10, alignItems: 'center' }}>
            <span style={{ color: '#888', fontSize: 11 }}>Total steel</span>
            <span style={{ fontWeight: 500, textAlign: 'right', fontSize: 11 }}>{r2(steelQtys.total)} kg</span>
            <span /><span />
          </div>
        </div>
      )}

      {hasConcrete && (
        <div style={{ marginBottom: 12 }}>
          <SectionHeader title="Concrete Materials" />
          {conc.M7_5?.volM3 > 0 && (<>
            {row('M7.5 – Cement',       r2(conc.M7_5.cementBags),   'bags', 'conc_M7_5_cement', 'conc_M7_5')}
            {row('M7.5 – Sand (dry)',    r2(conc.M7_5.sandM3),       'm³',   'conc_M7_5_sand',   'conc_M7_5')}
            {row('M7.5 – Agg 20mm (dry)', r2(conc.M7_5.agg20mmM3DRY), 'm³', 'conc_M7_5_agg20', 'conc_M7_5')}
          </>)}
          {conc.M20?.volM3 > 0 && (<>
            {row('M20 – Cement',        r2(conc.M20.cementBags),    'bags', 'conc_M20_cement', 'conc_M20')}
            {row('M20 – Sand (dry)',     r2(conc.M20.sandM3),        'm³',   'conc_M20_sand',   'conc_M20')}
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
