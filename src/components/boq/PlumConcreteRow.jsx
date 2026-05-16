// BOQ row for Phase 1.6e plum concrete.
// Sums plumVolFt3 across all foundations (entity + inline) and renders one priced row.
// Auto-hides when total is zero (default state — plum is opt-in).

import { useEffect, useRef } from 'react'
import { useStore } from '../../store'

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

export default function PlumConcreteRow({ rates, onRateChange, onLinesReady }) {
  const prevLinesJsonRef = useRef(null)

  // Subscribe so changes to foundation defaults / foundations / columns repaint.
  const projectSettings = useStore(s => s.projectSettings)
  const foundations     = useStore(s => s.foundations)
  const columns         = useStore(s => s.columns)
  void projectSettings; void foundations; void columns

  const fdnQ = useStore.getState().getFoundationQuantities()

  const totalPlumFt3 = r2(
    Object.values(fdnQ.byFoundation).reduce((s, q) => s + (q.plumVolFt3 || 0), 0) +
    Object.values(fdnQ.byColumnTypeInline).reduce((s, q) => s + (q.plumVolFt3 || 0), 0)
  )

  useEffect(() => {
    const lines = totalPlumFt3 > 0
      ? [{ label: 'Plum Concrete (under footings)', qty: totalPlumFt3, unit: 'ft³', rateKey: 'plum_concrete', cost: calcCost(totalPlumFt3, rates.plum_concrete) }]
      : []
    const json = JSON.stringify(lines)
    if (json !== prevLinesJsonRef.current) {
      prevLinesJsonRef.current = json
      onLinesReady(lines)
    }
  })

  if (totalPlumFt3 === 0) return null

  const cost = calcCost(totalPlumFt3, rates.plum_concrete)
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: COL, gap: GAP, alignItems: 'center', paddingLeft: 10 }}>
        <span style={{ color: '#555', fontSize: 12 }}>Plum Concrete (under footings)</span>
        <span style={{ fontWeight: 500, textAlign: 'right', fontSize: 11 }}>{totalPlumFt3} ft³</span>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <input type="number" min="0" step="0.01" value={rates.plum_concrete ?? ''}
            onChange={e => onRateChange('plum_concrete', e.target.value)}
            placeholder="₹/ft³" style={rateInputStyle}
          />
        </div>
        <span style={{ textAlign: 'right', fontSize: 11, color: cost !== null ? '#333' : '#ccc' }}>{fmtCost(cost)}</span>
      </div>
    </div>
  )
}
