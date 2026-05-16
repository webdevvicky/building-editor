// BOQ section for Phase 1.6a shuttering quantities.
// Renders columns, beams, footings, slab, staircase shuttering as priced rows.
// Owns its own rate keys: shutter_columns, shutter_beams, shutter_footings, shutter_slab, shutter_stair.

import { useEffect, useRef } from 'react'
import { useStore } from '../../store'
import { computeShutteringQuantities } from '../../quantities/shuttering'

const COL = '1fr 68px 88px 70px'
const GAP = 3

function r2(n) { return Math.round(n * 100) / 100 }

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
      <span style={{ fontWeight: 500, textAlign: 'right', fontSize: 11 }}>{qty} ft²</span>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        <input type="number" min="0" step="0.01" value={rates[rateKey] ?? ''}
          onChange={e => onRateChange(rateKey, e.target.value)}
          placeholder="₹/ft²" style={rateInputStyle}
        />
      </div>
      <span style={{ textAlign: 'right', fontSize: 11, color: cost !== null ? '#333' : '#ccc' }}>{fmtCost(cost)}</span>
    </div>
  )
}

export default function ShutteringSection({ rates, onRateChange, onLinesReady }) {
  const prevLinesJsonRef = useRef(null)

  // Subscribe to anything that affects shuttering output.
  const columns         = useStore(s => s.columns)
  const beams           = useStore(s => s.beams)
  const walls           = useStore(s => s.walls)
  const rooms           = useStore(s => s.rooms)
  const slabs           = useStore(s => s.slabs)
  const staircases      = useStore(s => s.staircases)
  const foundations     = useStore(s => s.foundations)
  const projectSettings = useStore(s => s.projectSettings)
  void columns; void beams; void walls; void rooms; void slabs; void staircases; void foundations; void projectSettings // re-render on change

  const state = useStore.getState()
  const q     = computeShutteringQuantities(state)

  if (q.totalAreaFt2 === 0) return null

  // Emit lines for parent cost-total + CSV export.
  useEffect(() => {
    const lines = []
    const add = (label, qty, rateKey) =>
      lines.push({ label, qty, unit: 'ft²', rateKey, cost: calcCost(qty, rates[rateKey]) })
    if (q.subtotals.columns   > 0) add('Shuttering — Columns',   q.subtotals.columns,   'shutter_columns')
    if (q.subtotals.beams     > 0) add('Shuttering — Beams',     q.subtotals.beams,     'shutter_beams')
    if (q.subtotals.footings  > 0) add('Shuttering — Footings',  q.subtotals.footings,  'shutter_footings')
    if (q.subtotals.slab      > 0) add('Shuttering — Slab',      q.subtotals.slab,      'shutter_slab')
    if (q.subtotals.staircase > 0) add('Shuttering — Staircase', q.subtotals.staircase, 'shutter_stair')
    const json = JSON.stringify(lines)
    if (json !== prevLinesJsonRef.current) {
      prevLinesJsonRef.current = json
      onLinesReady(lines)
    }
  })

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Shuttering
      </div>
      {q.subtotals.columns   > 0 && <PricedSubRow label="Columns"     qty={q.subtotals.columns}   rateKey="shutter_columns"   rates={rates} onRateChange={onRateChange} />}
      {q.subtotals.beams     > 0 && <PricedSubRow label="Beams"       qty={q.subtotals.beams}     rateKey="shutter_beams"     rates={rates} onRateChange={onRateChange} />}
      {q.subtotals.footings  > 0 && <PricedSubRow label="Footings"    qty={q.subtotals.footings}  rateKey="shutter_footings"  rates={rates} onRateChange={onRateChange} />}
      {q.subtotals.slab      > 0 && <PricedSubRow label="Slab"        qty={q.subtotals.slab}      rateKey="shutter_slab"      rates={rates} onRateChange={onRateChange} />}
      {q.subtotals.staircase > 0 && <PricedSubRow label="Staircase"   qty={q.subtotals.staircase} rateKey="shutter_stair"     rates={rates} onRateChange={onRateChange} />}
      <div style={{ display: 'grid', gridTemplateColumns: COL, gap: GAP, marginBottom: 4, paddingLeft: 10, alignItems: 'center' }}>
        <span style={{ color: '#888', fontSize: 11, fontWeight: 600 }}>Total</span>
        <span style={{ fontWeight: 600, textAlign: 'right', fontSize: 11 }}>{q.totalAreaFt2} ft²</span>
        <span /><span />
      </div>
    </div>
  )
}
