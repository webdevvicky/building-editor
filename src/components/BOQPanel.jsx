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
  const walls             = useStore(s => s.walls)
  const rooms             = useStore(s => s.rooms)
  const unit              = useStore(s => s.unit)
  const getAllWallsLength  = useStore(s => s.getAllWallsLength)
  const getTotalWallArea  = useStore(s => s.getTotalWallArea)
  const getTotalFloorArea = useStore(s => s.getTotalFloorArea)

  const BRICK_FACE = 0.2 * 0.1
  const WASTAGE    = 1.05

  const wallCount      = Object.values(walls).filter(w => !w.isVirtual).length
  const totalLenFt     = Math.round(getAllWallsLength() * 100) / 100
  const totalWallArea  = getTotalWallArea()
  const totalFloorArea = getTotalFloorArea()
  const bricks         = Math.ceil(totalWallArea / BRICK_FACE * WASTAGE)
  const plasterArea    = Math.round(totalWallArea * 2 * 100) / 100
  const paintArea      = plasterArea

  function fmtLen(ft)  {
    if (unit === 'm') return `${Math.round(ft * 0.3048 * 100) / 100} m`
    return `${ft} ft`
  }
  function fmtArea(sqFt) {
    if (unit === 'm') return `${Math.round(sqFt * 0.0929 * 100) / 100} m²`
    return `${sqFt} ft²`
  }

  return (
    <div style={{
      position: 'absolute', bottom: 16, right: 16,
      background: '#fff', border: '1px solid #ccc', borderRadius: 8,
      padding: '12px 16px', zIndex: 10, minWidth: 190, fontSize: 13,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 10, color: '#333' }}>BOQ Summary</div>
      <Row label="Walls"        value={wallCount} />
      <Row label="Total length" value={fmtLen(totalLenFt)} />
      <Row label="Wall area"    value={fmtArea(totalWallArea)} />
      <div style={{ borderTop: '1px solid #eee', margin: '8px 0' }} />
      <Row label="Floor area"   value={fmtArea(totalFloorArea)} />
      <div style={{ borderTop: '1px solid #eee', margin: '8px 0' }} />
      <Row label="Bricks"       value={bricks} />
      <Row label="Plaster area" value={fmtArea(plasterArea)} />
      <Row label="Paint area"   value={fmtArea(paintArea)} />
    </div>
  )
}
