// BOQ section for Phase 1.6b excavation (bulk + per-pit + per-civil-stamp).

import { useEffect, useRef } from 'react'
import { useStore } from '../../store'
import { computeExcavationQuantities } from '../../quantities/excavation'

const COL = '1fr 68px 88px 70px'
const GAP = 3

function calcCost(qty, rateStr) {
  const r = parseFloat(rateStr)
  if (!rateStr || isNaN(r) || r <= 0) return null
  return qty * r
}

function fmtCost(n) {
  if (n === null) return '—'
  return '₹' + Math.round(n).toLocaleString('en-IN')
}

const rateInputStyle = {
  width: 48, fontSize: 10, padding: '2px 4px',
  border: '1px solid #ddd', borderRadius: 3, textAlign: 'right', outline: 'none',
}

function PricedSubRow({ label, qty, rateKey, rates, onRateChange }) {
  const cost = calcCost(qty, rates[rateKey])
  return (
    <div style={{ display: 'grid', gridTemplateColumns: COL, gap: GAP, marginBottom: 4, paddingLeft: 10, alignItems: 'center' }}>
      <span style={{ color: '#888', fontSize: 11 }}>{label}</span>
      <span style={{ fontWeight: 500, textAlign: 'right', fontSize: 11 }}>{qty} ft³</span>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        <input type="number" min="0" step="0.01" value={rates[rateKey] ?? ''}
          onChange={e => onRateChange(rateKey, e.target.value)}
          placeholder="₹/ft³" style={rateInputStyle}
        />
      </div>
      <span style={{ textAlign: 'right', fontSize: 11, color: cost !== null ? '#333' : '#ccc' }}>{fmtCost(cost)}</span>
    </div>
  )
}

export default function ExcavationSection({ rates, onRateChange, onLinesReady }) {
  const prevLinesJsonRef = useRef(null)

  // Subscribe to anything that affects excavation output.
  const stamps          = useStore(s => s.stamps)
  const columns         = useStore(s => s.columns)
  const foundations     = useStore(s => s.foundations)
  const rooms           = useStore(s => s.rooms)
  const walls           = useStore(s => s.walls)
  const projectSettings = useStore(s => s.projectSettings)
  void stamps; void columns; void foundations; void rooms; void walls; void projectSettings

  const state = useStore.getState()
  const q     = computeExcavationQuantities(state)

  useEffect(() => {
    const lines = []
    const add = (label, qty, rateKey) =>
      lines.push({ label, qty, unit: 'ft³', rateKey, cost: calcCost(qty, rates[rateKey]) })
    if (q.subtotals.bulk       > 0) add('Excavation — Bulk',                       q.subtotals.bulk,       'excav_bulk')
    if (q.subtotals.foundation > 0) add('Excavation — Foundation pits (extra)',    q.subtotals.foundation, 'excav_pit')
    if (q.subtotals.civil      > 0) add('Excavation — Civil stamps (sump/septic)', q.subtotals.civil,      'excav_civil')
    const json = JSON.stringify(lines)
    if (json !== prevLinesJsonRef.current) {
      prevLinesJsonRef.current = json
      onLinesReady(lines)
    }
  })

  if (q.totalVolFt3 === 0) return null

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Excavation
      </div>
      {q.subtotals.bulk > 0 && (
        <PricedSubRow label={`Bulk (${q.bulk.footprintFt2} ft² × ${q.bulk.depthFt} ft)`}
          qty={q.subtotals.bulk} rateKey="excav_bulk" rates={rates} onRateChange={onRateChange} />
      )}
      {q.subtotals.foundation > 0 && (
        <PricedSubRow label="Foundation pits (extra depth)"
          qty={q.subtotals.foundation} rateKey="excav_pit" rates={rates} onRateChange={onRateChange} />
      )}
      {q.subtotals.civil > 0 && (
        <PricedSubRow label="Civil pits (sump / septic)"
          qty={q.subtotals.civil} rateKey="excav_civil" rates={rates} onRateChange={onRateChange} />
      )}
      <div style={{ display: 'grid', gridTemplateColumns: COL, gap: GAP, marginBottom: 4, paddingLeft: 10, alignItems: 'center' }}>
        <span style={{ color: '#888', fontSize: 11, fontWeight: 600 }}>Total</span>
        <span style={{ fontWeight: 600, textAlign: 'right', fontSize: 11 }}>{q.totalVolFt3} ft³</span>
        <span /><span />
      </div>
      <div style={{ fontSize: 10, color: '#aaa', marginTop: 4, fontStyle: 'italic' }}>
        Working margin: {q.workingMarginFt} ft per side.
      </div>
    </div>
  )
}
