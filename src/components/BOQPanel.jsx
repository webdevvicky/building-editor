import { useStore } from '../store'

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
      <span style={{ color: '#555' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  )
}

export default function BOQPanel() {
  const walls                      = useStore(s => s.walls)
  const rooms                      = useStore(s => s.rooms)   // subscribed for reactivity — room additions/deletions/finish changes trigger re-render
  const stamps                     = useStore(s => s.stamps)  // subscribed for reactivity — stamp additions/deletions trigger re-render
  const unit                       = useStore(s => s.unit)
  const getAllWallsLength           = useStore(s => s.getAllWallsLength)
  const getTotalWallArea           = useStore(s => s.getTotalWallArea)
  const getTotalFloorArea          = useStore(s => s.getTotalFloorArea)
  const getTotalFlooringArea       = useStore(s => s.getTotalFlooringArea)
  const getTotalCeilingPlasterArea = useStore(s => s.getTotalCeilingPlasterArea)
  const getTotalPaintArea          = useStore(s => s.getTotalPaintArea)
  const getTotalWaterproofingArea  = useStore(s => s.getTotalWaterproofingArea)
  const getTotalRoofingArea        = useStore(s => s.getTotalRoofingArea)
  const getTotalExcavationVolumeFt3 = useStore(s => s.getTotalExcavationVolumeFt3)
  const getStampsByType            = useStore(s => s.getStampsByType)

  const BRICK_FACE = 0.2 * 0.1
  const WASTAGE    = 1.05

  const wallCount          = Object.values(walls).filter(w => !w.isVirtual).length
  const totalLenFt         = Math.round(getAllWallsLength() * 100) / 100
  const totalWallArea      = getTotalWallArea()
  const totalFloorArea     = getTotalFloorArea()
  const bricks             = Math.ceil(totalWallArea / BRICK_FACE * WASTAGE)

  const flooringArea       = getTotalFlooringArea()
  const ceilingPlasterArea = getTotalCeilingPlasterArea()
  const paintArea          = getTotalPaintArea()
  const waterproofingArea  = getTotalWaterproofingArea()
  const roofingArea        = getTotalRoofingArea()
  const excavationFt3      = getTotalExcavationVolumeFt3()

  const sumps   = getStampsByType('sump')
  const ohts    = getStampsByType('overhead_tank')
  const septics = getStampsByType('septic_tank')
  const hasCivil = sumps.length + ohts.length + septics.length > 0

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
      <Row label="Paint"             value={fmtArea(paintArea)} />
      {/* TODO Phase 1c: split Paint into walls/ceiling for labor rate asymmetry */}
      <Row label="Waterproofing"     value={fmtArea(waterproofingArea)} />
      {roofingArea > 0 && (
        <Row label="Roofing" value={fmtArea(roofingArea)} />
      )}

      {/* Civil stamp volumes */}
      {hasCivil && <>
        <div style={{ borderTop: '1px solid #eee', margin: '8px 0' }} />
        <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase',
          letterSpacing: 0.5, marginBottom: 6 }}>Excavation</div>
        {sumps.length > 0 && (
          <Row label={`Sumps (×${sumps.length})`}
            value={fmtVol(Math.round(sumps.reduce((t, s) => t + (s.w * s.h * (s.depth || 0)) / 1728, 0) * 100) / 100)} />
        )}
        {septics.length > 0 && (
          <Row label={`Septic (×${septics.length})`}
            value={fmtVol(Math.round(septics.reduce((t, s) => t + (s.w * s.h * (s.depth || 0)) / 1728, 0) * 100) / 100)} />
        )}
        {ohts.length > 0 && (
          <Row label={`OHT (×${ohts.length})`}
            value={`${ohts.length} unit${ohts.length > 1 ? 's' : ''}`} />
        )}
        {excavationFt3 > 0 && (
          <Row label="Total excavation" value={fmtVol(excavationFt3)} />
        )}
        {septics.length > 0 && (
          <div style={{ fontSize: 10, color: '#aaa', marginTop: 4, lineHeight: 1.4 }}>
            * Septic volume is gross; chambers/soak-pit details deferred to Phase 1c
          </div>
        )}
      </>}
    </div>
  )
}
