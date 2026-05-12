import { useState } from 'react'
import { useStore } from '../store'

// ── module-level helpers ──────────────────────────────────────────────────────

function calcCost(qty, rateStr, isPer1000 = false) {
  const r = parseFloat(rateStr)
  if (!rateStr || isNaN(r) || r <= 0) return null
  return isPer1000 ? (qty / 1000) * r : qty * r
}

function fmtCost(n) {
  if (n === null) return '—'
  return '₹' + Math.round(n).toLocaleString('en-IN')
}

function r2(n) { return Math.round(n * 100) / 100 }

function getPriceableLines(rates, quantities) {
  return [
    { label: 'Flooring',          qty: quantities.flooringArea,       unit: 'ft²', rateKey: 'flooring' },
    { label: 'Bricks',            qty: quantities.bricks,             unit: 'nos', rateKey: 'bricks', isPer1000: true },
    { label: 'Plaster (walls)',   qty: quantities.totalWallArea,      unit: 'ft²', rateKey: 'plasterWalls' },
    { label: 'Plaster (ceiling)', qty: quantities.ceilingPlasterArea, unit: 'ft²', rateKey: 'plasterCeiling' },
    { label: 'Paint (walls)',     qty: quantities.paintWallsArea,     unit: 'ft²', rateKey: 'paintWalls' },
    { label: 'Paint (ceiling)',   qty: quantities.paintCeilingArea,   unit: 'ft²', rateKey: 'paintCeiling' },
    { label: 'Waterproofing',     qty: quantities.waterproofingArea,  unit: 'ft²', rateKey: 'waterproofing' },
    { label: 'Roofing',           qty: quantities.roofingArea,        unit: 'ft²', rateKey: 'roofing' },
  ].map(line => ({
    ...line,
    cost: calcCost(line.qty, rates[line.rateKey], line.isPer1000 || false),
  }))
}

function getCivilLinesForStamp(stampType, stampQty, rates) {
  if (!stampQty) return []
  return [
    { label: `${stampType} – Excavation`,      qty: r2(stampQty.excavFt3),                          unit: 'ft³', rateKey: 'excavation' },
    { label: `${stampType} – Brickwork (9")`,  qty: r2(stampQty.brickFt3),                          unit: 'ft³', rateKey: 'brickwork' },
    { label: `${stampType} – RCC slabs`,       qty: r2(stampQty.rccBottomFt3 + stampQty.rccTopFt3), unit: 'ft³', rateKey: 'rcc' },
    { label: `${stampType} – Plaster (inner)`, qty: r2(stampQty.plasterFt2),                        unit: 'ft²', rateKey: 'plasterInner' },
    { label: `${stampType} – Waterproofing`,   qty: r2(stampQty.plasterFt2),                        unit: 'ft²', rateKey: 'waterproofingInner' },
  ].map(line => ({
    ...line,
    cost: calcCost(line.qty, rates[line.rateKey]),
  }))
}

// ── display components ────────────────────────────────────────────────────────

const COL = '1fr 68px 88px 70px'
const GAP = 3

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
      <span style={{ color: '#555' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  )
}

const rateInputStyle = {
  width: 52, fontSize: 11, padding: '2px 4px',
  border: '1px solid #ddd', borderRadius: 3,
  textAlign: 'right', outline: 'none',
}

function PricedRow({ label, qtyDisplay, unitLabel, rateKey, rates, onRateChange, cost }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: COL, gap: GAP, marginBottom: 6, alignItems: 'center' }}>
      <span style={{ color: '#555', fontSize: 12 }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'right', fontSize: 12 }}>{qtyDisplay}</span>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        <input
          type="number"
          min="0"
          step="0.01"
          value={rates[rateKey]}
          onChange={e => onRateChange(rateKey, e.target.value)}
          placeholder={unitLabel}
          style={rateInputStyle}
        />
      </div>
      <span style={{ textAlign: 'right', fontSize: 12, color: cost !== null ? '#333' : '#ccc' }}>
        {fmtCost(cost)}
      </span>
    </div>
  )
}

function PricedSubRow({ label, qtyDisplay, unitLabel, rateKey, rates, onRateChange, cost }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: COL, gap: GAP, marginBottom: 4, paddingLeft: 10, alignItems: 'center' }}>
      <span style={{ color: '#888', fontSize: 11 }}>{label}</span>
      <span style={{ fontWeight: 500, textAlign: 'right', fontSize: 11 }}>{qtyDisplay}</span>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        <input
          type="number"
          min="0"
          step="0.01"
          value={rates[rateKey]}
          onChange={e => onRateChange(rateKey, e.target.value)}
          placeholder={unitLabel}
          style={{ ...rateInputStyle, width: 48, fontSize: 10 }}
        />
      </div>
      <span style={{ textAlign: 'right', fontSize: 11, color: cost !== null ? '#333' : '#ccc' }}>
        {fmtCost(cost)}
      </span>
    </div>
  )
}

function StampGroup({ title, count, children }) {
  return (
    <>
      <div style={{ fontWeight: 600, color: '#555', fontSize: 12, marginBottom: 4 }}>
        {title} <span style={{ color: '#aaa', fontWeight: 400 }}>×{count}</span>
      </div>
      {children}
    </>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export default function BOQPanel() {
  const walls                       = useStore(s => s.walls)
  const rooms                       = useStore(s => s.rooms)
  const stamps                      = useStore(s => s.stamps)
  const unit                        = useStore(s => s.unit)
  const getAllWallsLength            = useStore(s => s.getAllWallsLength)
  const getTotalWallArea            = useStore(s => s.getTotalWallArea)
  const getTotalFloorArea           = useStore(s => s.getTotalFloorArea)
  const getTotalFlooringArea        = useStore(s => s.getTotalFlooringArea)
  const getTotalCeilingPlasterArea  = useStore(s => s.getTotalCeilingPlasterArea)
  const getTotalPaintWallsArea      = useStore(s => s.getTotalPaintWallsArea)
  const getTotalPaintCeilingArea    = useStore(s => s.getTotalPaintCeilingArea)
  const getTotalWaterproofingArea   = useStore(s => s.getTotalWaterproofingArea)
  const getTotalRoofingArea         = useStore(s => s.getTotalRoofingArea)
  const getTotalExcavationVolumeFt3 = useStore(s => s.getTotalExcavationVolumeFt3)
  const getStampsByType             = useStore(s => s.getStampsByType)
  const getSumpCivilQty             = useStore(s => s.getSumpCivilQty)
  const getSepticCivilQty           = useStore(s => s.getSepticCivilQty)
  const getTotalBricks              = useStore(s => s.getTotalBricks)

  const [rates, setRates] = useState({
    bricks: '',
    plasterWalls: '',
    plasterCeiling: '',
    paintWalls: '',
    paintCeiling: '',
    flooring: '',
    waterproofing: '',
    roofing: '',
    excavation: '',
    brickwork: '',
    rcc: '',
    plasterInner: '',
    waterproofingInner: '',
  })
  const setRate = (key, val) => setRates(prev => ({ ...prev, [key]: val }))

  const wallCount     = Object.values(walls).filter(w => !w.isVirtual).length
  const totalLenFt    = Math.round(getAllWallsLength() * 100) / 100
  const totalWallArea = getTotalWallArea()
  const totalFloorArea = getTotalFloorArea()
  const bricks        = getTotalBricks()

  const flooringArea       = getTotalFlooringArea()
  const ceilingPlasterArea = getTotalCeilingPlasterArea()
  const paintWallsArea     = getTotalPaintWallsArea()
  const paintCeilingArea   = getTotalPaintCeilingArea()
  const waterproofingArea  = getTotalWaterproofingArea()
  const roofingArea        = getTotalRoofingArea()
  const excavationFt3      = getTotalExcavationVolumeFt3()

  const sumps    = getStampsByType('sump')
  const ohts     = getStampsByType('overhead_tank')
  const septics  = getStampsByType('septic_tank')
  const hasCivil = sumps.length + ohts.length + septics.length > 0

  const sumpQty   = sumps.length   > 0 ? getSumpCivilQty()   : null
  const septicQty = septics.length > 0 ? getSepticCivilQty() : null

  function fmtLen(ft) {
    if (unit === 'm') return `${Math.round(ft * 0.3048 * 100) / 100} m`
    return `${ft} ft`
  }
  function fmtArea(sqFt) {
    if (unit === 'm') return `${Math.round(sqFt * 0.0929 * 100) / 100} m²`
    return `${sqFt} ft²`
  }
  function fmtVol(ft3) {
    if (unit === 'm') return `${Math.round(ft3 * 0.0283 * 100) / 100} m³`
    return `${ft3} ft³`
  }

  const quantities = {
    flooringArea, bricks, totalWallArea, ceilingPlasterArea,
    paintWallsArea, paintCeilingArea, waterproofingArea, roofingArea,
  }

  const mainLines   = getPriceableLines(rates, quantities)
  const sumpLines   = getCivilLinesForStamp('Sump', sumpQty, rates)
  const septicLines = getCivilLinesForStamp('Septic Tank', septicQty, rates)

  const allCosts  = [...mainLines, ...sumpLines, ...septicLines].map(l => l.cost)
  const totalCost = allCosts.some(c => c !== null)
    ? allCosts.reduce((sum, c) => sum + (c ?? 0), 0)
    : null

  function handleExportCSV() {
    const allLines = [...mainLines, ...sumpLines, ...septicLines]
    const rows = [['Item', 'Quantity', 'Unit', 'Rate (₹)', 'Cost (₹)']]
    for (const line of allLines) {
      const rateVal = parseFloat(rates[line.rateKey]) || ''
      const costVal = line.cost !== null ? Math.round(line.cost) : ''
      rows.push([line.label, line.qty, line.unit, rateVal, costVal])
    }
    const csv = rows
      .map(r => r.map(cell => (typeof cell === 'string' && cell.includes(',') ? `"${cell}"` : cell)).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `boq-export-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{
      position: 'absolute', bottom: 16, right: 16,
      background: '#fff', border: '1px solid #ccc', borderRadius: 8,
      padding: '12px 16px', zIndex: 10, minWidth: 380, fontSize: 13,
      maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: '#333' }}>BOQ Summary</div>
      <div style={{ fontSize: 11, fontStyle: 'italic', color: '#aaa', marginBottom: 10 }}>
        Preview pricing — for estimation only. Final rates from ERP product catalog.
      </div>

      {/* Informational structure */}
      <Row label="Walls"        value={wallCount} />
      <Row label="Total length" value={fmtLen(totalLenFt)} />
      <Row label="Wall area"    value={fmtArea(totalWallArea)} />
      <div style={{ borderTop: '1px solid #eee', margin: '8px 0' }} />
      <Row label="Floor area" value={fmtArea(totalFloorArea)} />
      <div style={{ borderTop: '1px solid #eee', margin: '8px 0' }} />

      {/* Column headers for priceable section */}
      <div style={{ display: 'grid', gridTemplateColumns: COL, gap: GAP, fontSize: 10, color: '#aaa', marginBottom: 6 }}>
        <span />
        <span style={{ textAlign: 'right' }}>Qty</span>
        <span style={{ textAlign: 'right', paddingRight: 4 }}>Rate</span>
        <span style={{ textAlign: 'right' }}>Cost</span>
      </div>

      {/* Priceable main lines */}
      {mainLines.map(line => {
        const qtyDisplay = line.unit === 'nos'
          ? line.qty.toLocaleString('en-IN')
          : fmtArea(line.qty)
        const unitLabel = line.isPer1000 ? '₹/1000' : `₹/${line.unit}`
        return (
          <PricedRow
            key={line.rateKey}
            label={line.label}
            qtyDisplay={qtyDisplay}
            unitLabel={unitLabel}
            rateKey={line.rateKey}
            rates={rates}
            onRateChange={setRate}
            cost={line.cost}
          />
        )
      })}

      {/* Civil works */}
      {hasCivil && <>
        <div style={{ borderTop: '1px solid #eee', margin: '8px 0' }} />
        <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase',
          letterSpacing: 0.5, marginBottom: 8 }}>Civil Works</div>

        {sumpQty && (
          <>
            <StampGroup title="Sump" count={sumps.length}>
              {sumpLines.map(line => {
                const qtyDisplay = line.unit === 'ft³' ? fmtVol(line.qty) : fmtArea(line.qty)
                return (
                  <PricedSubRow
                    key={line.label}
                    label={line.label.replace('Sump – ', '')}
                    qtyDisplay={qtyDisplay}
                    unitLabel={`₹/${line.unit}`}
                    rateKey={line.rateKey}
                    rates={rates}
                    onRateChange={setRate}
                    cost={line.cost}
                  />
                )
              })}
            </StampGroup>
            <div style={{ margin: '6px 0' }} />
          </>
        )}

        {septicQty && (
          <>
            <StampGroup title="Septic Tank" count={septics.length}>
              {septicLines.map(line => {
                const qtyDisplay = line.unit === 'ft³' ? fmtVol(line.qty) : fmtArea(line.qty)
                return (
                  <PricedSubRow
                    key={line.label}
                    label={line.label.replace('Septic Tank – ', '')}
                    qtyDisplay={qtyDisplay}
                    unitLabel={`₹/${line.unit}`}
                    rateKey={line.rateKey}
                    rates={rates}
                    onRateChange={setRate}
                    cost={line.cost}
                  />
                )
              })}
            </StampGroup>
            <div style={{ margin: '6px 0' }} />
          </>
        )}

        {ohts.length > 0 && (
          <Row label="OHT" value={`${ohts.length} unit${ohts.length > 1 ? 's' : ''}`} />
        )}

        {excavationFt3 > 0 && (
          <>
            <div style={{ borderTop: '1px solid #f0f0f0', margin: '6px 0' }} />
            <Row label="Total excavation" value={fmtVol(excavationFt3)} />
          </>
        )}
      </>}

      {/* Total cost — always rendered */}
      <div style={{ borderTop: '1px solid #eee', margin: '8px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13 }}>
        <span style={{ color: '#333' }}>Total cost estimate</span>
        <span style={{ color: totalCost !== null ? '#222' : '#aaa' }}>{fmtCost(totalCost)}</span>
      </div>

      {/* CSV export */}
      <button
        onClick={handleExportCSV}
        style={{
          marginTop: 10, width: '100%', padding: '6px 0',
          fontSize: 12, cursor: 'pointer',
          background: '#f5f5f5', border: '1px solid #ccc', borderRadius: 4,
          color: '#333',
        }}
      >
        Export BOQ (CSV)
      </button>
    </div>
  )
}
