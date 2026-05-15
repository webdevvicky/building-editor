import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { MATERIAL_LIBRARY, BONDING } from '../materials'
import { BEAM_LEVEL_REGISTRY } from '../constants/structural'
import {
  explainWallArea, explainFlooring,
  explainPlasterWalls, explainPlasterCeiling,
  explainPaintWalls, explainPaintCeiling,
  explainWaterproofing, explainRoofing,
  explainUnits, explainCement, explainSand, explainAdhesive,
  explainCivilExcavation, explainCivilBrickwork, explainCivilRCC,
  explainCivilPlaster, explainCivilWaterproofing,
  explainColumnRCC, explainFootingRCC, explainFootingPCC, explainBeamRCC,
  explainSlabMain, explainSlabSunken, explainSunshades, explainParapet,
  explainStaircaseRCC, explainSteelByElement, explainConcreteGrade,
} from '../formulas'
import StructuralBOQSection from './StructuralBOQSection'

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
    { label: 'Plaster (walls)',   qty: quantities.totalWallArea,      unit: 'ft²', rateKey: 'plasterWalls' },
    { label: 'Plaster (ceiling)', qty: quantities.ceilingPlasterArea, unit: 'ft²', rateKey: 'plasterCeiling' },
    { label: 'Paint (walls)',     qty: quantities.paintWallsArea,     unit: 'ft²', rateKey: 'paintWalls' },
    { label: 'Paint (ceiling)',   qty: quantities.paintCeilingArea,   unit: 'ft²', rateKey: 'paintCeiling' },
    { label: 'Waterproofing',     qty: quantities.waterproofingArea,  unit: 'ft²', rateKey: 'waterproofing' },
    { label: 'Roofing',           qty: quantities.roofingArea,        unit: 'ft²', rateKey: 'roofing' },
  ].map(line => ({
    ...line,
    cost: calcCost(line.qty, rates[line.rateKey], false),
  }))
}

// Returns initial rate keys for all materials (empty string = no rate entered)
function buildMaterialRateKeys() {
  const keys = {}
  for (const [matKey, mat] of Object.entries(MATERIAL_LIBRARY)) {
    keys[`mat_${matKey}_unit`] = ''
    if (mat.bondingType === BONDING.CEMENT_SAND) {
      keys[`mat_${matKey}_cement`] = ''
      keys[`mat_${matKey}_sand`]   = ''
    } else {
      keys[`mat_${matKey}_adhesive`] = ''
    }
  }
  return keys
}

// Flat list of priced lines for all active materials — used for cost totals and CSV.
function buildMaterialLines(matQty, rates) {
  const lines = []
  for (const [matKey, qty] of Object.entries(matQty)) {
    const mat = MATERIAL_LIBRARY[matKey]
    if (!mat || !qty) continue
    const isBrick    = mat.bricksPerFt3 !== undefined
    const unitKey    = `mat_${matKey}_unit`
    lines.push({ label: `${mat.name} – ${isBrick ? 'Bricks' : 'Blocks'}`, qty: qty.unitCount, unit: 'nos', rateKey: unitKey, isPer1000: isBrick, cost: calcCost(qty.unitCount, rates[unitKey] ?? '', isBrick) })
    if (mat.bondingType === BONDING.CEMENT_SAND) {
      const cKey = `mat_${matKey}_cement`
      const sKey = `mat_${matKey}_sand`
      lines.push({ label: `${mat.name} – Cement`, qty: qty.cementBags, unit: 'bags', rateKey: cKey, cost: calcCost(qty.cementBags, rates[cKey] ?? '') })
      lines.push({ label: `${mat.name} – Sand`,   qty: qty.sandFt3,    unit: 'ft³',  rateKey: sKey, cost: calcCost(qty.sandFt3, rates[sKey] ?? '') })
    } else {
      const aKey = `mat_${matKey}_adhesive`
      lines.push({ label: `${mat.name} – Adhesive`, qty: qty.adhesiveBags, unit: 'bags', rateKey: aKey, cost: calcCost(qty.adhesiveBags, rates[aKey] ?? '') })
    }
  }
  return lines
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

// ── formula dispatcher ───────────────────────────────────────────────────────

function getFormulaData(id, state) {
  if (id === 'wallArea')        return explainWallArea(state)
  if (id === 'flooring')        return explainFlooring(state)
  if (id === 'plasterWalls')    return explainPlasterWalls(state)
  if (id === 'plasterCeiling')  return explainPlasterCeiling(state)
  if (id === 'paintWalls')      return explainPaintWalls(state)
  if (id === 'paintCeiling')    return explainPaintCeiling(state)
  if (id === 'waterproofing')   return explainWaterproofing(state)
  if (id === 'roofing')         return explainRoofing(state)
  if (id === 'sump_excavation')         return explainCivilExcavation(state, 'sump')
  if (id === 'sump_brickwork')          return explainCivilBrickwork(state, 'sump')
  if (id === 'sump_rcc')                return explainCivilRCC(state, 'sump')
  if (id === 'sump_plasterInner')       return explainCivilPlaster(state, 'sump')
  if (id === 'sump_waterproofingInner') return explainCivilWaterproofing(state, 'sump')
  if (id === 'septic_excavation')         return explainCivilExcavation(state, 'septic_tank')
  if (id === 'septic_brickwork')          return explainCivilBrickwork(state, 'septic_tank')
  if (id === 'septic_rcc')                return explainCivilRCC(state, 'septic_tank')
  if (id === 'septic_plasterInner')       return explainCivilPlaster(state, 'septic_tank')
  if (id === 'septic_waterproofingInner') return explainCivilWaterproofing(state, 'septic_tank')
  if (id.startsWith('mat_')) {
    // id = 'mat_{MATERIAL_KEY}_{suffix}' — matKey may contain underscores
    const withoutPrefix   = id.slice(4)
    const lastUnderscore  = withoutPrefix.lastIndexOf('_')
    const matKey = withoutPrefix.slice(0, lastUnderscore)
    const suffix = withoutPrefix.slice(lastUnderscore + 1)
    if (suffix === 'unit')     return explainUnits(state, matKey)
    if (suffix === 'cement')   return explainCement(state, matKey)
    if (suffix === 'sand')     return explainSand(state, matKey)
    if (suffix === 'adhesive') return explainAdhesive(state, matKey)
  }
  // Structural formulas
  if (id.startsWith('col_')) {
    const typeId = id.replace('col_', '').replace('_rcc', '')
    return explainColumnRCC(state, typeId)
  }
  if (id.startsWith('fot_')) {
    const withoutPrefix = id.replace('fot_', '')
    const typeId = withoutPrefix.replace(/_rcc$/, '').replace(/_pcc$/, '')
    const isPcc  = withoutPrefix.endsWith('_pcc')
    return isPcc ? explainFootingPCC(state, typeId) : explainFootingRCC(state, typeId)
  }
  if (id.startsWith('beam_'))    return explainBeamRCC(state, id.replace('beam_', ''))
  if (id === 'slab_main')        return explainSlabMain(state)
  if (id === 'slab_sunken')      return explainSlabSunken(state)
  if (id === 'sunshade_rcc')     return explainSunshades(state)
  if (id === 'parapet_rcc')      return explainParapet(state)
  if (id === 'stair_rcc')        return explainStaircaseRCC(state)
  if (id.startsWith('steel_'))   return explainSteelByElement(state, id.replace('steel_', '').toUpperCase())
  if (id === 'conc_M7_5')        return explainConcreteGrade(state, 'M7_5')
  if (id === 'conc_M20')         return explainConcreteGrade(state, 'M20')
  return null
}

// ── display components ────────────────────────────────────────────────────────

const COL = '1fr 68px 88px 70px'
const GAP = 3

function Row({ label, value, infoId, openId, onInfoClick }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ color: '#555' }}>{label}</span>
        {infoId && <InfoIcon id={infoId} openId={openId} onInfoClick={onInfoClick} />}
      </div>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  )
}

const rateInputStyle = {
  width: 52, fontSize: 11, padding: '2px 4px',
  border: '1px solid #ddd', borderRadius: 3,
  textAlign: 'right', outline: 'none',
}

function PricedRow({ label, qtyDisplay, unitLabel, rateKey, rates, onRateChange, cost, infoId, openId, onInfoClick }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: COL, gap: GAP, marginBottom: 6, alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ color: '#555', fontSize: 12 }}>{label}</span>
        {infoId && <InfoIcon id={infoId} openId={openId} onInfoClick={onInfoClick} />}
      </div>
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

function PricedSubRow({ label, qtyDisplay, unitLabel, rateKey, rates, onRateChange, cost, infoId, openId, onInfoClick }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: COL, gap: GAP, marginBottom: 4, paddingLeft: 10, alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ color: '#888', fontSize: 11 }}>{label}</span>
        {infoId && <InfoIcon id={infoId} openId={openId} onInfoClick={onInfoClick} />}
      </div>
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

function InfoIcon({ id, openId, onInfoClick }) {
  return (
    <button
      data-info-btn=""
      onClick={e => onInfoClick(id, e)}
      title="Show formula"
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 12, color: openId === id ? '#555' : '#bbb',
        padding: '0 1px', lineHeight: 1, flexShrink: 0,
      }}
    >ⓘ</button>
  )
}

function FormulaPopover({ data, pos, popoverRef }) {
  if (!data || !pos) return null
  return (
    <div ref={popoverRef} style={{
      position: 'fixed',
      top: pos.top,
      left: Math.max(8, pos.left),
      width: 240,
      background: '#fff',
      border: '1px solid #ddd',
      borderRadius: 6,
      padding: '10px 12px',
      zIndex: 200,
      boxShadow: '0 2px 14px rgba(0,0,0,0.16)',
      fontSize: 11,
      lineHeight: 1.5,
    }}>
      <div style={{ fontWeight: 700, color: '#333', marginBottom: 6, fontSize: 12 }}>{data.title}</div>
      <div style={{ borderTop: '1px solid #f0f0f0', marginBottom: 6 }} />
      {data.steps.map((step, i) => (
        <div key={i} style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 8,
          marginBottom: 3,
          fontWeight: step.bold ? 700 : 400,
          ...(step.bold ? { borderTop: '1px solid #f0f0f0', paddingTop: 4, marginTop: 4 } : {}),
        }}>
          <span style={{ color: step.bold ? '#333' : '#666', flex: 1 }}>{step.label}</span>
          <span style={{ color: step.bold ? '#111' : '#444', whiteSpace: 'nowrap' }}>{step.value}</span>
        </div>
      ))}
      {data.note && (
        <div style={{
          marginTop: 8, borderTop: '1px solid #f0f0f0', paddingTop: 6,
          color: '#aaa', fontStyle: 'italic', fontSize: 10, lineHeight: 1.4,
        }}>
          {data.note}
        </div>
      )}
    </div>
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
  const getMaterialQuantities       = useStore(s => s.getMaterialQuantities)
  // Extra subscriptions for formula state (stable function refs, no re-render cost)
  const nodes           = useStore(s => s.nodes)
  const getWallArea     = useStore(s => s.getWallArea)
  const getValidRoomIds = useStore(s => s.getValidRoomIds)
  const getRoomArea     = useStore(s => s.getRoomArea)
  const getRoomWallArea = useStore(s => s.getRoomWallArea)
  // Structural subscriptions
  const getMasonryWithBeamDeduction = useStore(s => s.getMasonryWithBeamDeduction)
  const projectSettings             = useStore(s => s.projectSettings)
  const columns                     = useStore(s => s.columns)
  const beams                       = useStore(s => s.beams)
  const slabs                       = useStore(s => s.slabs)
  const staircases                  = useStore(s => s.staircases)
  const getAllBeams                  = useStore(s => s.getAllBeams)
  const getColumnQuantities         = useStore(s => s.getColumnQuantities)
  const getFootingQuantities        = useStore(s => s.getFootingQuantities)
  const getBeamQuantities           = useStore(s => s.getBeamQuantities)
  const getSlabQuantities           = useStore(s => s.getSlabQuantities)
  const getStaircaseQuantities      = useStore(s => s.getStaircaseQuantities)
  const getSunshadeQuantities       = useStore(s => s.getSunshadeQuantities)
  const getParapetQuantities        = useStore(s => s.getParapetQuantities)
  const getSteelQuantities          = useStore(s => s.getSteelQuantities)
  const getConcreteByGrade          = useStore(s => s.getConcreteByGrade)
  const classifyWallBeamFlags       = useStore(s => s.classifyWallBeamFlags)

  const [rates, setRates] = useState(() => ({
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
    ...buildMaterialRateKeys(),
    // Structural rate keys
    ...Object.fromEntries(BEAM_LEVEL_REGISTRY.map(lvl => [`beam_${lvl.id}`, ''])),
    slab_main: '', slab_sunken: '',
    sunshade_rcc: '', parapet_rcc: '',
    steel_footing: '', steel_column: '', steel_beam: '',
    steel_slab: '', steel_staircase: '', steel_civil: '',
    conc_M7_5_cement: '', conc_M7_5_sand: '', conc_M7_5_agg20: '',
    conc_M20_cement: '', conc_M20_sand: '', conc_M20_agg10: '', conc_M20_agg20: '',
    stair_rcc: '',
    // Column and footing rates are added dynamically:
    // col_{typeId}_rcc, fot_{typeId}_rcc, fot_{typeId}_pcc
    // These are added via setRate on first render of StructuralBOQSection
  }))
  const setRate = (key, val) => setRates(prev => ({ ...prev, [key]: val }))

  const [openPopoverId, setOpenPopoverId] = useState(null)
  const [popoverPos,    setPopoverPos]    = useState(null)
  const popoverRef = useRef(null)

  // Structural lines sent up from StructuralBOQSection
  const [structuralLines, setStructuralLines] = useState([])

  const wallCount     = Object.values(walls).filter(w => !w.isVirtual).length
  const totalLenFt    = Math.round(getAllWallsLength() * 100) / 100
  const totalWallArea = getTotalWallArea()
  const totalFloorArea = getTotalFloorArea()
  const matQty        = getMasonryWithBeamDeduction()

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
    flooringArea, totalWallArea, ceilingPlasterArea,
    paintWallsArea, paintCeilingArea, waterproofingArea, roofingArea,
  }

  const mainLines     = getPriceableLines(rates, quantities)
  const materialLines = buildMaterialLines(matQty, rates)
  const sumpLines     = getCivilLinesForStamp('Sump', sumpQty, rates)
  const septicLines   = getCivilLinesForStamp('Septic Tank', septicQty, rates)
  const hasMasonry    = Object.keys(matQty).length > 0

  const formulaState = {
    walls, nodes, rooms, stamps, getWallArea, getValidRoomIds, getRoomArea, getRoomWallArea,
    projectSettings, columns, beams, slabs, staircases,
    getMasonryWithBeamDeduction,
    getColumnQuantities, getFootingQuantities, getBeamQuantities, getSlabQuantities,
    getStaircaseQuantities, getSunshadeQuantities, getParapetQuantities,
    getSteelQuantities, getConcreteByGrade, getAllBeams,
    classifyWallBeamFlags,
  }
  const formulaData  = openPopoverId ? getFormulaData(openPopoverId, formulaState) : null

  const allCosts  = [...mainLines, ...materialLines, ...sumpLines, ...septicLines, ...structuralLines].map(l => l.cost)
  const totalCost = allCosts.some(c => c !== null)
    ? allCosts.reduce((sum, c) => sum + (c ?? 0), 0)
    : null

  function handleInfoClick(id, e) {
    e.stopPropagation()
    if (openPopoverId === id) { setOpenPopoverId(null); return }
    const rect = e.currentTarget.getBoundingClientRect()
    setPopoverPos({ top: rect.top, left: rect.left - 248 })
    setOpenPopoverId(id)
  }

  useEffect(() => {
    if (!openPopoverId) return
    function onDown(e) {
      if (e.target.closest('[data-info-btn]')) return // let click handler manage ⓘ buttons
      if (popoverRef.current && !popoverRef.current.contains(e.target))
        setOpenPopoverId(null)
    }
    function onKey(e) { if (e.key === 'Escape') setOpenPopoverId(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown',   onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown',   onKey)
    }
  }, [openPopoverId])

  function handleExportCSV() {
    const allLines = [...mainLines.slice(0, 1), ...materialLines, ...mainLines.slice(1), ...sumpLines, ...septicLines, ...structuralLines]
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
    <div
      onScroll={() => openPopoverId && setOpenPopoverId(null)}
      style={{
        position: 'absolute', bottom: 16, right: 16,
        background: '#fff', border: '1px solid #ccc', borderRadius: 8,
        padding: '12px 16px', zIndex: 10, minWidth: 380, fontSize: 13,
        maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6, color: '#333' }}>BOQ Summary</div>
      <div style={{ fontSize: 11, fontStyle: 'italic', color: '#aaa', marginBottom: 10 }}>
        Preview pricing — for estimation only. Final rates from ERP product catalog.
      </div>

      {/* Informational structure */}
      <Row label="Walls"        value={wallCount} />
      <Row label="Total length" value={fmtLen(totalLenFt)} />
      <Row label="Wall area"    value={fmtArea(totalWallArea)}
        infoId="wallArea" openId={openPopoverId} onInfoClick={handleInfoClick} />
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

      {/* Flooring */}
      {mainLines.slice(0, 1).map(line => (
        <PricedRow key={line.rateKey} label={line.label}
          qtyDisplay={fmtArea(line.qty)} unitLabel="₹/ft²"
          rateKey={line.rateKey} rates={rates} onRateChange={setRate} cost={line.cost}
          infoId={line.rateKey} openId={openPopoverId} onInfoClick={handleInfoClick}
        />
      ))}

      {/* Masonry — per material type, shown when at least one wall exists */}
      {hasMasonry && <>
        <div style={{ borderTop: '1px solid #eee', margin: '8px 0' }} />
        <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Masonry</div>
        {Object.entries(matQty).map(([matKey, qty]) => {
          const mat     = MATERIAL_LIBRARY[matKey]
          const isBrick = mat.bricksPerFt3 !== undefined
          const unitKey = `mat_${matKey}_unit`
          const cKey    = `mat_${matKey}_cement`
          const sKey    = `mat_${matKey}_sand`
          const aKey    = `mat_${matKey}_adhesive`
          return (
            <div key={matKey} style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 600, color: '#555', fontSize: 12, marginBottom: 4 }}>{mat.name}</div>
              <PricedSubRow label={isBrick ? 'Bricks' : 'Blocks'}
                qtyDisplay={qty.unitCount.toLocaleString('en-IN')} unitLabel={isBrick ? '₹/1000' : '₹/block'}
                rateKey={unitKey} rates={rates} onRateChange={setRate}
                cost={calcCost(qty.unitCount, rates[unitKey] ?? '', isBrick)}
                infoId={unitKey} openId={openPopoverId} onInfoClick={handleInfoClick}
              />
              {mat.bondingType === BONDING.CEMENT_SAND ? <>
                <PricedSubRow label="Cement"
                  qtyDisplay={`${qty.cementBags} bags`} unitLabel="₹/bag"
                  rateKey={cKey} rates={rates} onRateChange={setRate}
                  cost={calcCost(qty.cementBags, rates[cKey] ?? '')}
                  infoId={cKey} openId={openPopoverId} onInfoClick={handleInfoClick}
                />
                <PricedSubRow label="Sand"
                  qtyDisplay={fmtVol(qty.sandFt3)} unitLabel="₹/ft³"
                  rateKey={sKey} rates={rates} onRateChange={setRate}
                  cost={calcCost(qty.sandFt3, rates[sKey] ?? '')}
                  infoId={sKey} openId={openPopoverId} onInfoClick={handleInfoClick}
                />
              </> :
                <PricedSubRow label="Adhesive"
                  qtyDisplay={`${qty.adhesiveBags} bags`} unitLabel="₹/bag"
                  rateKey={aKey} rates={rates} onRateChange={setRate}
                  cost={calcCost(qty.adhesiveBags, rates[aKey] ?? '')}
                  infoId={aKey} openId={openPopoverId} onInfoClick={handleInfoClick}
                />
              }
            </div>
          )
        })}
        <div style={{ borderTop: '1px solid #eee', margin: '8px 0' }} />
      </>}

      {/* Structural BOQ */}
      <StructuralBOQSection
        rates={rates}
        onRateChange={setRate}
        openId={openPopoverId}
        onInfoClick={handleInfoClick}
        onLinesReady={setStructuralLines}
        formulaState={formulaState}
      />

      {/* Plaster, Paint, Waterproofing, Roofing */}
      {mainLines.slice(1).map(line => (
        <PricedRow key={line.rateKey} label={line.label}
          qtyDisplay={fmtArea(line.qty)} unitLabel="₹/ft²"
          rateKey={line.rateKey} rates={rates} onRateChange={setRate} cost={line.cost}
          infoId={line.rateKey} openId={openPopoverId} onInfoClick={handleInfoClick}
        />
      ))}

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
                    infoId={`sump_${line.rateKey}`}
                    openId={openPopoverId}
                    onInfoClick={handleInfoClick}
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
                    infoId={`septic_${line.rateKey}`}
                    openId={openPopoverId}
                    onInfoClick={handleInfoClick}
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

      <FormulaPopover data={formulaData} pos={popoverPos} popoverRef={popoverRef} />
    </div>
  )
}
