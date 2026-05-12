import { useStore } from '../store'

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
      <span style={{ color: '#555' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  )
}

function SubRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, paddingLeft: 10 }}>
      <span style={{ color: '#888', fontSize: 12 }}>{label}</span>
      <span style={{ fontWeight: 500, fontSize: 12 }}>{value}</span>
    </div>
  )
}

function StampGroup({ title, count, rows }) {
  return (
    <>
      <div style={{ fontWeight: 600, color: '#555', fontSize: 12, marginBottom: 4 }}>
        {title} <span style={{ color: '#aaa', fontWeight: 400 }}>×{count}</span>
      </div>
      {rows.map(([label, value]) => (
        <SubRow key={label} label={label} value={value} />
      ))}
    </>
  )
}

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

  const BRICK_FACE = 0.2 * 0.1
  const WASTAGE    = 1.05

  const wallCount          = Object.values(walls).filter(w => !w.isVirtual).length
  const totalLenFt         = Math.round(getAllWallsLength() * 100) / 100
  const totalWallArea      = getTotalWallArea()
  const totalFloorArea     = getTotalFloorArea()
  const bricks             = Math.ceil(totalWallArea / BRICK_FACE * WASTAGE)

  const flooringArea       = getTotalFlooringArea()
  const ceilingPlasterArea = getTotalCeilingPlasterArea()
  const paintWallsArea     = getTotalPaintWallsArea()
  const paintCeilingArea   = getTotalPaintCeilingArea()
  const waterproofingArea  = getTotalWaterproofingArea()
  const roofingArea        = getTotalRoofingArea()
  const excavationFt3      = getTotalExcavationVolumeFt3()

  const sumps   = getStampsByType('sump')
  const ohts    = getStampsByType('overhead_tank')
  const septics = getStampsByType('septic_tank')
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
  function r2(n) { return Math.round(n * 100) / 100 }

  return (
    <div style={{
      position: 'absolute', bottom: 16, right: 16,
      background: '#fff', border: '1px solid #ccc', borderRadius: 8,
      padding: '12px 16px', zIndex: 10, minWidth: 210, fontSize: 13,
      maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 10, color: '#333' }}>BOQ Summary</div>

      {/* Structure */}
      <Row label="Walls"        value={wallCount} />
      <Row label="Total length" value={fmtLen(totalLenFt)} />
      <Row label="Wall area"    value={fmtArea(totalWallArea)} />
      <div style={{ borderTop: '1px solid #eee', margin: '8px 0' }} />

      {/* Area totals */}
      <Row label="Floor area" value={fmtArea(totalFloorArea)} />
      <Row label="Flooring"   value={fmtArea(flooringArea)} />
      <div style={{ borderTop: '1px solid #eee', margin: '8px 0' }} />

      {/* Material quantities */}
      <Row label="Bricks"            value={bricks} />
      <Row label="Plaster (walls)"   value={fmtArea(totalWallArea)} />
      <Row label="Plaster (ceiling)" value={fmtArea(ceilingPlasterArea)} />
      <Row label="Paint (walls)"     value={fmtArea(paintWallsArea)} />
      <Row label="Paint (ceiling)"   value={fmtArea(paintCeilingArea)} />
      <Row label="Waterproofing"     value={fmtArea(waterproofingArea)} />
      {roofingArea > 0 && (
        <Row label="Roofing" value={fmtArea(roofingArea)} />
      )}

      {/* Civil works */}
      {hasCivil && <>
        <div style={{ borderTop: '1px solid #eee', margin: '8px 0' }} />
        <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase',
          letterSpacing: 0.5, marginBottom: 8 }}>Civil Works</div>

        {sumpQty && (
          <>
            <StampGroup
              title="Sump"
              count={sumps.length}
              rows={[
                ['Excavation',          fmtVol(r2(sumpQty.excavFt3))],
                ['Brickwork (9")',       fmtVol(r2(sumpQty.brickFt3))],
                ['RCC bottom slab',     fmtVol(r2(sumpQty.rccBottomFt3))],
                ['RCC top slab',        fmtVol(r2(sumpQty.rccTopFt3))],
                ['Plaster (inner)',     fmtArea(r2(sumpQty.plasterFt2))],
                ['Waterproofing',       fmtArea(r2(sumpQty.plasterFt2))],
              ]}
            />
            <div style={{ margin: '6px 0' }} />
          </>
        )}

        {septicQty && (
          <>
            <StampGroup
              title="Septic Tank"
              count={septics.length}
              rows={[
                ['Excavation',          fmtVol(r2(septicQty.excavFt3))],
                ['Brickwork (9")',       fmtVol(r2(septicQty.brickFt3))],
                ['RCC bottom slab',     fmtVol(r2(septicQty.rccBottomFt3))],
                ['RCC top slab',        fmtVol(r2(septicQty.rccTopFt3))],
                ['Plaster (inner)',     fmtArea(r2(septicQty.plasterFt2))],
                ['Waterproofing',       fmtArea(r2(septicQty.plasterFt2))],
              ]}
            />
            <div style={{ margin: '6px 0' }} />
          </>
        )}

        {ohts.length > 0 && (
          <Row label={`OHT`} value={`${ohts.length} unit${ohts.length > 1 ? 's' : ''}`} />
        )}

        {excavationFt3 > 0 && (
          <>
            <div style={{ borderTop: '1px solid #f0f0f0', margin: '6px 0' }} />
            <Row label="Total excavation" value={fmtVol(excavationFt3)} />
          </>
        )}
      </>}
    </div>
  )
}
