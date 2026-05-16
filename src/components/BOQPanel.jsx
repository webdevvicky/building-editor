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
import ShutteringSection   from './boq/ShutteringSection'
import ExcavationSection   from './boq/ExcavationSection'
import PlumConcreteRow     from './boq/PlumConcreteRow'
import PlasterSection      from './boq/PlasterSection'
import { getBoqLines, totalBoqCost, groupBoqLinesByCategory } from '../boq/lines'
import { scopeStateToFloor } from '../boq/scope'
import { runValidation } from '../validation/engine'
import { exportBoqPdf } from '../export/pdf'
import { exportBoqExcel } from '../export/excel'
import {
  BoqRow, BoqSubRow, SectionHeader, SubSectionHeader, fmtLineQty,
} from './boq/BoqRow'

// ── module-level helpers ──────────────────────────────────────────────────────

function fmtCost(n) {
  if (n === null || n === undefined) return '—'
  return '₹' + Math.round(n).toLocaleString('en-IN')
}

function r2(n) { return Math.round(n * 100) / 100 }

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

// ── formula dispatcher ───────────────────────────────────────────────────────
// Registry maps exact id → handler, or prefix → handler with id extraction.
// Adding a new formula: one entry here, no branching logic needed.

const EXACT_HANDLERS = {
  wallArea:       s => explainWallArea(s),
  flooring:       s => explainFlooring(s),
  plasterWalls:   s => explainPlasterWalls(s),
  plasterCeiling: s => explainPlasterCeiling(s),
  paintWalls:     s => explainPaintWalls(s),
  paintCeiling:   s => explainPaintCeiling(s),
  waterproofing:  s => explainWaterproofing(s),
  roofing:        s => explainRoofing(s),
  slab_main:      s => explainSlabMain(s),
  slab_sunken:    s => explainSlabSunken(s),
  sunshade_rcc:   s => explainSunshades(s),
  parapet_rcc:    s => explainParapet(s),
  stair_rcc:      s => explainStaircaseRCC(s),
  conc_M7_5:      s => explainConcreteGrade(s, 'M7_5'),
  conc_M20:       s => explainConcreteGrade(s, 'M20'),
  // Civil — sump
  sump_excavation:         s => explainCivilExcavation(s, 'sump'),
  sump_brickwork:          s => explainCivilBrickwork(s, 'sump'),
  sump_rcc:                s => explainCivilRCC(s, 'sump'),
  sump_plasterInner:       s => explainCivilPlaster(s, 'sump'),
  sump_waterproofingInner: s => explainCivilWaterproofing(s, 'sump'),
  // Civil — septic
  septic_excavation:         s => explainCivilExcavation(s, 'septic_tank'),
  septic_brickwork:          s => explainCivilBrickwork(s, 'septic_tank'),
  septic_rcc:                s => explainCivilRCC(s, 'septic_tank'),
  septic_plasterInner:       s => explainCivilPlaster(s, 'septic_tank'),
  septic_waterproofingInner: s => explainCivilWaterproofing(s, 'septic_tank'),
}

const PREFIX_HANDLERS = [
  {
    prefix: 'col_',
    handle: (id, s) => {
      const typeId = id.slice(4).replace(/_rcc$/, '')
      return explainColumnRCC(s, typeId)
    },
  },
  {
    prefix: 'fot_',
    handle: (id, s) => {
      const body   = id.slice(4)
      const typeId = body.replace(/_rcc$/, '').replace(/_pcc$/, '')
      return body.endsWith('_pcc') ? explainFootingPCC(s, typeId) : explainFootingRCC(s, typeId)
    },
  },
  {
    prefix: 'beam_',
    handle: (id, s) => explainBeamRCC(s, id.slice(5)),
  },
  {
    prefix: 'steel_',
    handle: (id, s) => {
      // steel_<ELEMENT> for the estimate line; steel_<ELEMENT>_spec_<id> for BBS group lines.
      // Both resolve to the per-element kg/m³ explainer for now (BBS-line popovers
      // are forward-compat scaffolding).
      const body = id.slice(6)
      const element = body.split('_')[0].toUpperCase()
      return explainSteelByElement(s, element)
    },
  },
  {
    // id = 'mat_{MATERIAL_KEY}_{suffix}' — matKey may contain underscores
    prefix: 'mat_',
    handle: (id, s) => {
      const body           = id.slice(4)
      const lastUnderscore = body.lastIndexOf('_')
      const matKey = body.slice(0, lastUnderscore)
      const suffix = body.slice(lastUnderscore + 1)
      const MAT_SUFFIX_MAP = {
        unit: explainUnits, cement: explainCement, sand: explainSand, adhesive: explainAdhesive,
      }
      return MAT_SUFFIX_MAP[suffix]?.(s, matKey) ?? null
    },
  },
]

function getFormulaData(id, state) {
  if (EXACT_HANDLERS[id]) return EXACT_HANDLERS[id](state)
  for (const { prefix, handle } of PREFIX_HANDLERS) {
    if (id.startsWith(prefix)) return handle(id, state)
  }
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
  // Subscriptions — minimal. Most data flows through canonicalLines below.
  // We subscribe to entity maps so React re-renders when underlying state
  // changes; the actual data is read via useStore.getState() and then
  // routed through scopeStateToFloor when the floor toggle is active.
  const walls           = useStore(s => s.walls)
  const nodes           = useStore(s => s.nodes)
  const rooms           = useStore(s => s.rooms)
  const stamps          = useStore(s => s.stamps)
  const columns         = useStore(s => s.columns)
  const beams           = useStore(s => s.beams)
  const slabs           = useStore(s => s.slabs)
  const staircases      = useStore(s => s.staircases)
  const foundations     = useStore(s => s.foundations)
  const projectSettings = useStore(s => s.projectSettings)
  const unit            = useStore(s => s.unit)
  const currentFloorId  = useStore(s => s.currentFloorId)
  // Force re-render on subscription touches; data reads happen via getState().
  void walls; void nodes; void rooms; void stamps
  void columns; void beams; void slabs; void staircases; void foundations
  void projectSettings; void currentFloorId

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
    plum_concrete: '',
    // Column / footing / foundation rate keys are dynamic and read via rates[key]
    // — undefined values render as empty placeholders. No registration needed.
  }))
  const setRate = (key, val) => setRates(prev => ({ ...prev, [key]: val }))

  const [openPopoverId, setOpenPopoverId] = useState(null)
  const [popoverPos,    setPopoverPos]    = useState(null)
  const popoverRef = useRef(null)

  // Phase 1.9 — floor scope toggle: 'current' | 'all'. Only meaningful when multi-floor.
  const [floorScope, setFloorScope] = useState('current')
  const floors      = projectSettings?.floors ?? []
  const isMultiFloor = floors.length > 1
  const scopeActive  = isMultiFloor && floorScope === 'current'

  // ── Single source of truth ─────────────────────────────────────────────────
  // canonicalLines = getBoqLines(state, rates, { floorId }) — already
  // floor-scoped. Every visible row, the total cost, CSV / PDF / Excel
  // exports all consume this same array. No section re-derives quantities
  // from the store.
  const liveState   = useStore.getState()
  const scopedState = scopeActive ? scopeStateToFloor(liveState, currentFloorId) : liveState
  const canonicalLines = getBoqLines(liveState, rates,
    scopeActive ? { floorId: currentFloorId } : {})
  const linesByCat = groupBoqLinesByCategory(canonicalLines)
  const finishesLines     = linesByCat.finishes     ?? []
  const masonryLines      = linesByCat.masonry      ?? []
  const civilLines        = linesByCat.civil        ?? []
  const rccLines          = linesByCat.rcc          ?? []
  const steelLines        = linesByCat.steel        ?? []
  const concreteMixLines  = linesByCat.concreteMix  ?? []
  const staircaseLines    = linesByCat.staircase    ?? []
  const shutteringLines   = linesByCat.shuttering   ?? []
  const excavationLines   = linesByCat.excavation   ?? []
  const plasterLines      = linesByCat.plaster      ?? []
  const plumLines         = linesByCat.plumConcrete ?? []

  // ── Header summary stats — pulled from scopedState so they honor the toggle.
  const wallCount      = Object.values(scopedState.walls).filter(w => !w.isVirtual).length
  const totalLenFt     = r2(scopedState.getAllWallsLength())
  const totalWallArea  = scopedState.getTotalWallArea()
  const totalFloorArea = scopedState.getTotalFloorArea()

  // ── Civil aux: stamp counts (for "Sump ×N" / "Septic ×N" labels). Use
  // scopedState so the count honors the toggle.
  const sumps    = scopedState.getStampsByType('sump')
  const ohts     = scopedState.getStampsByType('overhead_tank')
  const septics  = scopedState.getStampsByType('septic_tank')
  const hasCivil = sumps.length + ohts.length + septics.length > 0
  // Civil category lines split by stamp type via id prefix.
  const sumpLines   = civilLines.filter(l => l.id.startsWith('sump_'))
  const septicLines = civilLines.filter(l => l.id.startsWith('septic_'))

  // ── Masonry grouping by materialKey (line.meta.materialKey).
  const masonryByMaterial = new Map()
  for (const line of masonryLines) {
    const k = line.meta?.materialKey
    if (!k) continue
    if (!masonryByMaterial.has(k)) masonryByMaterial.set(k, [])
    masonryByMaterial.get(k).push(line)
  }
  const hasMasonry = masonryByMaterial.size > 0
  // Strip "<Material name> – " prefix from row labels (material name is the sub-header).
  const stripMaterialPrefix = (l) => l.label.replace(/^.+?\s+[–—-]\s*/, '')

  // ── Finishes (top-level rows): flooring shown above masonry, others below.
  const flooringLine = finishesLines.find(l => l.id === 'finishes_flooring')
  const otherFinishLines = finishesLines.filter(l => l.id !== 'finishes_flooring')

  // ── Cost total + validation. Validation is GLOBAL (across all floors).
  const totalCost  = totalBoqCost(canonicalLines)
  const validation = runValidation(liveState)

  // ── Formula popover dispatcher. Uses unscoped state for now — formula
  // explainers are read-only computations that work on either.
  const formulaState = {
    walls:    liveState.walls,
    nodes:    liveState.nodes,
    rooms:    liveState.rooms,
    stamps:   liveState.stamps,
    projectSettings: liveState.projectSettings,
    columns:  liveState.columns,
    beams:    liveState.beams,
    slabs:    liveState.slabs,
    staircases: liveState.staircases,
    getWallArea:     liveState.getWallArea,
    getValidRoomIds: liveState.getValidRoomIds,
    getRoomArea:     liveState.getRoomArea,
    getRoomWallArea: liveState.getRoomWallArea,
    getMasonryWithBeamDeduction: liveState.getMasonryWithBeamDeduction,
    getColumnQuantities:    liveState.getColumnQuantities,
    getFootingQuantities:   liveState.getFootingQuantities,
    getBeamQuantities:      liveState.getBeamQuantities,
    getSlabQuantities:      liveState.getSlabQuantities,
    getStaircaseQuantities: liveState.getStaircaseQuantities,
    getSunshadeQuantities:  liveState.getSunshadeQuantities,
    getParapetQuantities:   liveState.getParapetQuantities,
    getSteelQuantities:     liveState.getSteelQuantities,
    getConcreteByGrade:     liveState.getConcreteByGrade,
    getAllBeams:            liveState.getAllBeams,
    classifyWallBeamFlags:  liveState.classifyWallBeamFlags,
  }
  const formulaData = openPopoverId ? getFormulaData(openPopoverId, formulaState) : null

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
      if (e.target.closest('[data-info-btn]')) return
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
    // CSV uses the canonical aggregator — same source as cost total +
    // every visible row.
    const rows = [['Category', 'Item', 'Quantity', 'Unit', 'Rate (₹)', 'Cost (₹)']]
    for (const line of canonicalLines) {
      const rateVal = parseFloat(rates[line.rateKey]) || ''
      const costVal = line.cost !== null ? Math.round(line.cost) : ''
      rows.push([line.category, line.label, line.qty, line.unit, rateVal, costVal])
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

  // Unit-aware area / length display for the summary section.
  function fmtLen(ft) {
    if (unit === 'm') return `${Math.round(ft * 0.3048 * 100) / 100} m`
    return `${ft} ft`
  }
  function fmtArea(sqFt) {
    if (unit === 'm') return `${Math.round(sqFt * 0.0929 * 100) / 100} m²`
    return `${sqFt} ft²`
  }

  // Civil-row label cleanup: strip "Sump – " / "Septic Tank – " prefix
  // (stamp type is the group header).
  const stripStampPrefix = (l) => l.label.replace(/^(?:Sump|Septic Tank)\s+[–—-]\s*/, '')

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontWeight: 700, color: '#333' }}>BOQ Summary</div>
        {isMultiFloor && (
          <div style={{ display: 'flex', gap: 2, fontSize: 10 }}>
            <button
              onClick={() => setFloorScope('current')}
              style={{
                padding: '2px 8px', border: '1px solid #ccc', borderRadius: 4,
                background: floorScope === 'current' ? '#333' : '#fff',
                color:      floorScope === 'current' ? '#fff' : '#555',
                cursor: 'pointer', fontWeight: 500,
              }}
            >This floor</button>
            <button
              onClick={() => setFloorScope('all')}
              style={{
                padding: '2px 8px', border: '1px solid #ccc', borderRadius: 4,
                background: floorScope === 'all' ? '#333' : '#fff',
                color:      floorScope === 'all' ? '#fff' : '#555',
                cursor: 'pointer', fontWeight: 500,
              }}
            >All floors</button>
          </div>
        )}
      </div>
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
      {flooringLine && (
        <BoqRow line={flooringLine}
          rates={rates} onRateChange={setRate}
          openId={openPopoverId} onInfoClick={handleInfoClick} unit={unit} />
      )}

      {/* Masonry — per material type */}
      {hasMasonry && (
        <>
          <div style={{ borderTop: '1px solid #eee', margin: '8px 0' }} />
          <SectionHeader title="Masonry" />
          {[...masonryByMaterial.entries()].map(([matKey, lines]) => {
            const mat = MATERIAL_LIBRARY[matKey]
            return (
              <div key={matKey} style={{ marginBottom: 10 }}>
                <SubSectionHeader title={mat?.name ?? matKey} />
                {lines.map(line => (
                  <BoqSubRow key={line.id} line={line}
                    labelOverride={stripMaterialPrefix(line)}
                    rates={rates} onRateChange={setRate}
                    openId={openPopoverId} onInfoClick={handleInfoClick} unit={unit} />
                ))}
              </div>
            )
          })}
          <div style={{ borderTop: '1px solid #eee', margin: '8px 0' }} />
        </>
      )}

      {/* Structural BOQ (RCC + Steel + Concrete Materials + Staircase) */}
      <StructuralBOQSection
        rccLines={rccLines}
        steelLines={steelLines}
        concreteMixLines={concreteMixLines}
        staircaseLines={staircaseLines}
        rates={rates} onRateChange={setRate}
        openId={openPopoverId} onInfoClick={handleInfoClick} unit={unit}
      />

      {/* Plum concrete */}
      <PlumConcreteRow lines={plumLines}
        rates={rates} onRateChange={setRate}
        openId={openPopoverId} onInfoClick={handleInfoClick} unit={unit} />

      {/* Shuttering */}
      <ShutteringSection lines={shutteringLines}
        rates={rates} onRateChange={setRate}
        openId={openPopoverId} onInfoClick={handleInfoClick} unit={unit} />

      {/* Excavation */}
      <ExcavationSection lines={excavationLines}
        rates={rates} onRateChange={setRate}
        openId={openPopoverId} onInfoClick={handleInfoClick} unit={unit} />

      {/* Plaster materials by system */}
      <PlasterSection lines={plasterLines}
        rates={rates} onRateChange={setRate}
        openId={openPopoverId} onInfoClick={handleInfoClick} unit={unit} />

      {/* Plaster, Paint, Waterproofing, Roofing — other finishes */}
      {otherFinishLines.map(line => (
        <BoqRow key={line.id} line={line}
          rates={rates} onRateChange={setRate}
          openId={openPopoverId} onInfoClick={handleInfoClick} unit={unit} />
      ))}

      {/* Civil works */}
      {hasCivil && (
        <>
          <div style={{ borderTop: '1px solid #eee', margin: '8px 0' }} />
          <SectionHeader title="Civil Works" />

          {sumpLines.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <SubSectionHeader title="Sump" suffix={`×${sumps.length}`} />
              {sumpLines.map(line => (
                <BoqSubRow key={line.id} line={line}
                  labelOverride={stripStampPrefix(line)}
                  rates={rates} onRateChange={setRate}
                  openId={openPopoverId} onInfoClick={handleInfoClick} unit={unit} />
              ))}
            </div>
          )}

          {septicLines.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <SubSectionHeader title="Septic Tank" suffix={`×${septics.length}`} />
              {septicLines.map(line => (
                <BoqSubRow key={line.id} line={line}
                  labelOverride={stripStampPrefix(line)}
                  rates={rates} onRateChange={setRate}
                  openId={openPopoverId} onInfoClick={handleInfoClick} unit={unit} />
              ))}
            </div>
          )}

          {ohts.length > 0 && (
            <Row label="OHT" value={`${ohts.length} unit${ohts.length > 1 ? 's' : ''}`} />
          )}
        </>
      )}

      {/* Total cost — always rendered */}
      <div style={{ borderTop: '1px solid #eee', margin: '8px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13 }}>
        <span style={{ color: '#333' }}>Total cost estimate</span>
        <span style={{ color: totalCost !== null ? '#222' : '#aaa' }}>{fmtCost(totalCost)}</span>
      </div>

      {/* Validation footer */}
      {validation.counts.total > 0 && (
        <div style={{
          marginTop: 10, padding: '6px 8px', borderRadius: 4,
          background: validation.counts.errors > 0 ? '#fff0f0' : '#fff8e6',
          border: `1px solid ${validation.counts.errors > 0 ? '#e74c3c' : '#e0b020'}`,
          fontSize: 11, color: '#555', lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4, color: validation.counts.errors > 0 ? '#c0392b' : '#a07000' }}>
            ⚠ {validation.counts.total} validation {validation.counts.total === 1 ? 'issue' : 'issues'}
            {validation.counts.errors > 0 ? ` (${validation.counts.errors} error${validation.counts.errors > 1 ? 's' : ''})` : ''}
          </div>
          {validation.issues.slice(0, 5).map((iss, i) => (
            <div key={i} style={{ fontSize: 10, color: '#666' }}>
              · [{iss.severity}] {iss.message}
            </div>
          ))}
          {validation.issues.length > 5 && (
            <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>… +{validation.issues.length - 5} more</div>
          )}
        </div>
      )}

      {/* Export buttons */}
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button
          onClick={handleExportCSV}
          style={{
            flex: 1, padding: '6px 0', fontSize: 11, cursor: 'pointer',
            background: '#f5f5f5', border: '1px solid #ccc', borderRadius: 4, color: '#333',
          }}
        >CSV</button>
        <button
          onClick={() => exportBoqPdf(liveState, rates, {
            projectName: 'Layout', preparedBy: '-', unitSystem: unit === 'm' ? 'metric' : 'ft (Indian)',
          })}
          style={{
            flex: 1, padding: '6px 0', fontSize: 11, cursor: 'pointer',
            background: '#fff8e6', border: '1px solid #e0b020', borderRadius: 4, color: '#7a5400',
            fontWeight: 600,
          }}
        >📄 PDF</button>
        <button
          onClick={() => exportBoqExcel(liveState, rates, { projectName: 'Layout' })}
          style={{
            flex: 1, padding: '6px 0', fontSize: 11, cursor: 'pointer',
            background: '#e8f5e9', border: '1px solid #81c784', borderRadius: 4, color: '#2e7d32',
            fontWeight: 600,
          }}
        >📊 Excel</button>
      </div>

      <FormulaPopover data={formulaData} pos={popoverPos} popoverRef={popoverRef} />
    </div>
  )
}
