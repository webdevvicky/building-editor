// BOQ section for Phase 1.6f plaster materials by system.
// Cement-sand systems show cement bags + sand m³.
// Gypsum / POP systems show material kg + bags.

import { useEffect, useRef } from 'react'
import { useStore } from '../../store'
import { computePlasterQuantities } from '../../quantities/plaster'
import { PLASTER_KIND } from '../../specs/plasterSystems'

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

function PricedSubRow({ label, qty, unit, rateKey, rates, onRateChange }) {
  const cost = calcCost(qty, rates[rateKey])
  return (
    <div style={{ display: 'grid', gridTemplateColumns: COL, gap: GAP, marginBottom: 4, paddingLeft: 10, alignItems: 'center' }}>
      <span style={{ color: '#888', fontSize: 11 }}>{label}</span>
      <span style={{ fontWeight: 500, textAlign: 'right', fontSize: 11 }}>{qty} {unit}</span>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        <input type="number" min="0" step="0.01" value={rates[rateKey] ?? ''}
          onChange={e => onRateChange(rateKey, e.target.value)}
          placeholder={`₹/${unit}`} style={rateInputStyle}
        />
      </div>
      <span style={{ textAlign: 'right', fontSize: 11, color: cost !== null ? '#333' : '#ccc' }}>{fmtCost(cost)}</span>
    </div>
  )
}

export default function PlasterSection({ rates, onRateChange, onLinesReady }) {
  const prevLinesJsonRef = useRef(null)

  // Subscribe so changes to rooms / projectSettings / walls repaint.
  const rooms           = useStore(s => s.rooms)
  const walls           = useStore(s => s.walls)
  const projectSettings = useStore(s => s.projectSettings)
  void rooms; void walls; void projectSettings

  const state = useStore.getState()
  const q     = computePlasterQuantities(state)
  const systems = Object.values(q.bySystem)

  useEffect(() => {
    const lines = []
    const add = (label, qty, unit, rateKey) =>
      lines.push({ label, qty, unit, rateKey, cost: calcCost(qty, rates[rateKey]) })
    for (const sys of systems) {
      if (sys.kind === PLASTER_KIND.CEMENT_SAND) {
        add(`Plaster ${sys.label} — Cement`, sys.cementBags, 'bags', `plaster_${sys.systemId}_cement`)
        add(`Plaster ${sys.label} — Sand`,   sys.sandM3,     'm³',   `plaster_${sys.systemId}_sand`)
      } else {
        add(`Plaster ${sys.label} — Material`, sys.materialBags, 'bags', `plaster_${sys.systemId}_material`)
      }
    }
    const json = JSON.stringify(lines)
    if (json !== prevLinesJsonRef.current) {
      prevLinesJsonRef.current = json
      onLinesReady(lines)
    }
  })

  if (systems.length === 0) return null
  // The useEffect above always runs (no conditional hooks); early return is after.

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Plaster Materials
      </div>
      {systems.map(sys => (
        <div key={sys.systemId} style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 600, color: '#555', fontSize: 12, marginBottom: 4 }}>
            {sys.label} — {sys.totalAreaFt2} ft²
            <span style={{ color: '#aaa', fontWeight: 400, fontSize: 11, marginLeft: 6 }}>
              ({sys.wallsAreaFt2} walls + {sys.ceilingAreaFt2} ceiling)
            </span>
          </div>
          {sys.kind === PLASTER_KIND.CEMENT_SAND ? (
            <>
              <PricedSubRow label="Cement" qty={sys.cementBags} unit="bags"
                rateKey={`plaster_${sys.systemId}_cement`} rates={rates} onRateChange={onRateChange} />
              <PricedSubRow label="Sand"   qty={sys.sandM3}     unit="m³"
                rateKey={`plaster_${sys.systemId}_sand`}   rates={rates} onRateChange={onRateChange} />
            </>
          ) : (
            <PricedSubRow label="Material" qty={sys.materialBags} unit="bags"
              rateKey={`plaster_${sys.systemId}_material`} rates={rates} onRateChange={onRateChange} />
          )}
        </div>
      ))}
    </div>
  )
}
