import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { MATERIAL_LIBRARY } from '../materials'
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
import PlumbingBoqSection  from './boq/PlumbingBoqSection'
import ElectricalBoqSection from './boq/ElectricalBoqSection'
import HvacBoqSection       from './boq/HvacBoqSection'
import { getBoqLines, totalBoqCost, groupBoqLinesByCategory } from '../boq/lines'
import { scopeStateToFloor } from '../boq/scope'
import { runValidation } from '../validation/engine'
import { exportBoqPdf } from '../export/pdf'
import { exportBoqExcel } from '../export/excel'
import { toast } from './ui/Toast'
import { Button } from './ui/Button'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  BoqRow, BoqSubRow, SectionHeader, SubSectionHeader, InfoIcon, fmtLineQty,
} from './boq/BoqRow'
import './boq/boq.css'

// localStorage key for collapse preference
const BOQ_COLLAPSE_KEY = 'boq_panel_collapsed'
const readCollapsed = () => {
  try { return localStorage.getItem(BOQ_COLLAPSE_KEY) === '1' }
  catch { return false }
}
const writeCollapsed = (v) => {
  try { localStorage.setItem(BOQ_COLLAPSE_KEY, v ? '1' : '0') }
  catch { /* quota or sandbox — ignore */ }
}

// ── module-level helpers ──────────────────────────────────────────────────────

function fmtCost(n) {
  if (n === null || n === undefined) return '—'
  return '₹' + Math.round(n).toLocaleString('en-IN')
}

function r2(n) { return Math.round(n * 100) / 100 }

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

// ── small presentational helpers ─────────────────────────────────────────────

function InfoRow({ label, value, infoId, openId, onInfoClick }) {
  return (
    <div className="boq-info-row">
      <div className="boq-info-label">
        <span>{label}</span>
        {infoId && <InfoIcon id={infoId} openId={openId} onInfoClick={onInfoClick} />}
      </div>
      <span className="boq-info-value">{value}</span>
    </div>
  )
}

function FormulaPopover({ data, pos, popoverRef }) {
  if (!data || !pos) return null
  return (
    <div ref={popoverRef} className="boq-popover" style={{
      top: pos.top, left: Math.max(8, pos.left),
    }}>
      <div className="boq-popover-title">{data.title}</div>
      <div className="boq-popover-divider" />
      {data.steps.map((step, i) => (
        <div key={i} className={`boq-popover-step${step.bold ? ' boq-popover-step--bold' : ''}`}>
          <span className="boq-popover-step-label">{step.label}</span>
          <span className="boq-popover-step-value">{step.value}</span>
        </div>
      ))}
      {data.note && <div className="boq-popover-note">{data.note}</div>}
    </div>
  )
}

// Validation issue → store action mapping. Click navigates to/selects the entity.
const SELECTABLE_ENTITY_TYPES = new Set(['wall', 'room', 'column', 'beam', 'stamp'])

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
  // Selection actions for clickable validation issues.
  const selectWall   = useStore(s => s.selectWall)
  const selectRoom   = useStore(s => s.selectRoom)
  const selectColumn = useStore(s => s.selectColumn)
  const selectBeam   = useStore(s => s.selectBeam)
  const selectStamp  = useStore(s => s.selectStamp)
  // Force re-render on subscription touches; data reads happen via getState().
  void walls; void nodes; void rooms; void stamps
  void columns; void beams; void slabs; void staircases; void foundations
  void projectSettings; void currentFloorId

  // Rates now live in the store (`ratesByKey`) so they survive autosave,
  // project switches, JSON import/export, and revision snapshots. Unknown
  // rateKeys naturally resolve to '' via the `?? ''` in BoqRow's `rates[key]`
  // lookup — no need to pre-seed every possible key here.
  const rates  = useStore(s => s.ratesByKey)
  const setRate = useStore(s => s.setRate)

  const [openPopoverId, setOpenPopoverId] = useState(null)
  const [popoverPos,    setPopoverPos]    = useState(null)
  const popoverRef = useRef(null)

  // Phase 1.9 — floor scope toggle: 'current' | 'all'. Only meaningful when multi-floor.
  const [floorScope, setFloorScope] = useState('current')

  // Collapsible-sidebar state (persisted in localStorage).
  // Ctrl+B dispatches a `boq:toggle` window event; we listen here so the
  // keyboard hook stays decoupled from this component.
  const [collapsed, setCollapsed] = useState(readCollapsed)
  useEffect(() => { writeCollapsed(collapsed) }, [collapsed])
  useEffect(() => {
    const onToggle = () => setCollapsed(v => !v)
    window.addEventListener('boq:toggle', onToggle)
    return () => window.removeEventListener('boq:toggle', onToggle)
  }, [])
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
  const plumbingSupplyLines   = linesByCat.plumbing_supply   ?? []
  const plumbingDrainageLines = linesByCat.plumbing_drainage ?? []
  const plumbingFixturesLines = linesByCat.plumbing_fixtures ?? []
  // Electrical categories — wire/conduit per system + points + fittings + DB.
  const electricalLighting = linesByCat.electrical_lighting ?? []
  const electricalPower    = linesByCat.electrical_power    ?? []
  const electricalHvac     = linesByCat.electrical_hvac     ?? []
  const electricalSubmain  = linesByCat.electrical_submain  ?? []
  const electricalSolar    = linesByCat.electrical_solar    ?? []
  const electricalEv       = linesByCat.electrical_ev       ?? []
  const electricalPoints   = linesByCat.electrical_points   ?? []
  const electricalFittings = linesByCat.electrical_fittings ?? []
  const electricalDb       = linesByCat.electrical_db       ?? []
  const electricalWiring   = [
    ...electricalLighting, ...electricalPower, ...electricalHvac,
    ...electricalSubmain, ...electricalSolar, ...electricalEv,
  ]
  // HVAC categories — refrigerant copper + condensate UPVC + unit counts.
  const hvacRefrigerant = linesByCat.hvac_refrigerant ?? []
  const hvacCondensate  = linesByCat.hvac_condensate  ?? []
  const hvacUnits       = linesByCat.hvac_units       ?? []

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
    setPopoverPos({ top: rect.top, left: rect.left - 268 })
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
    try {
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
      toast.success('BOQ exported as CSV.')
    } catch (err) {
      toast.error('Export failed.')
    }
  }

  function handleExportPDF() {
    try {
      exportBoqPdf(liveState, rates, {
        projectName: 'Layout', preparedBy: '-', unitSystem: unit === 'm' ? 'metric' : 'ft (Indian)',
      })
      toast.success('BOQ exported as PDF.')
    } catch (err) {
      toast.error('Export failed.')
    }
  }

  function handleExportExcel() {
    try {
      exportBoqExcel(liveState, rates, { projectName: 'Layout' })
      toast.success('BOQ exported as Excel.')
    } catch (err) {
      toast.error('Export failed.')
    }
  }

  function handleIssueClick(issue) {
    if (!issue.entityId || !SELECTABLE_ENTITY_TYPES.has(issue.entityType)) return
    switch (issue.entityType) {
      case 'wall':   selectWall(issue.entityId); break
      case 'room':   selectRoom(issue.entityId); break
      case 'column': selectColumn(issue.entityId); break
      case 'beam':   selectBeam(issue.entityId); break
      case 'stamp':  selectStamp(issue.entityId); break
    }
  }

  // Click a BOQ line label → select the underlying canvas entity. Used by
  // BOQ rows whose sourceEntityIds[] back-link to wall / room / column / beam /
  // stamp entities (currently: BBS-grouped steel lines). Foundation + slab
  // lines have no canvas-selection state today and silently no-op.
  function handleSelectEntity(line) {
    const ids = line.sourceEntityIds
    if (!ids || ids.length === 0) return
    const id = ids[0]
    const s = useStore.getState()
    if      (s.walls?.[id])   selectWall(id)
    else if (s.rooms?.[id])   selectRoom(id)
    else if (s.columns?.[id]) selectColumn(id)
    else if (s.beams?.[id])   selectBeam(id)
    else if (s.stamps?.[id])  selectStamp(id)
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

  const hasErrors = validation.counts.errors > 0
  const hasCostValue = totalCost !== null && totalCost !== undefined

  // Empty-state: no entities exist that could produce BOQ output. Header,
  // floor toggle, and export buttons stay visible; the section list and
  // cost row are replaced with a centered "No items yet" message. Export
  // buttons are disabled so users don't ship empty files.
  const isEmpty =
    Object.keys(rooms).length   === 0 &&
    Object.keys(columns).length === 0 &&
    Object.keys(stamps).length  === 0

  // Collapsed sidebar: thin strip with toggle + vertical label.
  // The toggle dispatches the same window event the Ctrl+B shortcut uses,
  // so both code paths converge on a single state mutation.
  if (collapsed) {
    return (
      <div className="boq-panel boq-panel--collapsed">
        <button
          type="button"
          className="boq-collapse-toggle"
          onClick={() => setCollapsed(false)}
          title="Toggle BOQ panel (Ctrl+B)"
          aria-label="Expand BOQ panel"
        >
          <ChevronRight size={14} strokeWidth={2} />
        </button>
        <div className="boq-collapsed-label" aria-hidden="true">BOQ Summary</div>
      </div>
    )
  }

  return (
    <div
      className="boq-panel"
      onScroll={() => openPopoverId && setOpenPopoverId(null)}
    >
      <button
        type="button"
        className="boq-collapse-toggle"
        onClick={() => setCollapsed(true)}
        title="Toggle BOQ panel (Ctrl+B)"
        aria-label="Collapse BOQ panel"
      >
        <ChevronLeft size={14} strokeWidth={2} />
      </button>
      <div className="boq-panel-header">
        <div className="boq-panel-title">BOQ Summary</div>
        {isMultiFloor && (
          <div className="boq-floor-toggle">
            <button
              onClick={() => setFloorScope('current')}
              className={floorScope === 'current' ? 'is-active' : ''}
            >This floor</button>
            <button
              onClick={() => setFloorScope('all')}
              className={floorScope === 'all' ? 'is-active' : ''}
            >All floors</button>
          </div>
        )}
      </div>
      <div className="boq-panel-disclaimer">
        Preview pricing — for estimation only. Final rates from ERP product catalog.
      </div>

      {isEmpty ? (
        <div className="boq-empty-state">
          <div className="boq-empty-state__title">No items yet</div>
          <div className="boq-empty-state__hint">
            Add rooms and structural elements to generate the BOQ.
          </div>
        </div>
      ) : (
      <>
      {/* Informational structure */}
      <InfoRow label="Walls"        value={wallCount} />
      <InfoRow label="Total length" value={fmtLen(totalLenFt)} />
      <InfoRow label="Wall area"    value={fmtArea(totalWallArea)}
        infoId="wallArea" openId={openPopoverId} onInfoClick={handleInfoClick} />
      <hr className="boq-divider" />
      <InfoRow label="Floor area" value={fmtArea(totalFloorArea)} />
      <hr className="boq-divider" />

      {/* Column headers for priceable section */}
      <div className="boq-col-header">
        <span>Item</span>
        <span>Qty</span>
        <span>Rate</span>
        <span>Cost</span>
      </div>

      {/* Flooring */}
      {flooringLine && (
        <div className="boq-group">
          <BoqRow line={flooringLine}
            rates={rates} onRateChange={setRate}
            openId={openPopoverId} onInfoClick={handleInfoClick} unit={unit}
            onSelectEntity={handleSelectEntity} />
        </div>
      )}

      {/* Masonry — per material type */}
      {hasMasonry && (
        <div className="boq-group">
          <SectionHeader title="Masonry" />
          {[...masonryByMaterial.entries()].map(([matKey, lines]) => {
            const mat = MATERIAL_LIBRARY[matKey]
            return (
              <div key={matKey} className="boq-section">
                <SubSectionHeader title={mat?.name ?? matKey} />
                {lines.map(line => (
                  <BoqSubRow key={line.id} line={line}
                    labelOverride={stripMaterialPrefix(line)}
                    rates={rates} onRateChange={setRate}
                    openId={openPopoverId} onInfoClick={handleInfoClick} unit={unit}
                    onSelectEntity={handleSelectEntity} />
                ))}
              </div>
            )
          })}
        </div>
      )}

      {/* Structural BOQ (RCC + Steel + Concrete Materials + Staircase) */}
      <StructuralBOQSection
        rccLines={rccLines}
        steelLines={steelLines}
        concreteMixLines={concreteMixLines}
        staircaseLines={staircaseLines}
        rates={rates} onRateChange={setRate}
        openId={openPopoverId} onInfoClick={handleInfoClick} unit={unit}
        onSelectEntity={handleSelectEntity}
      />

      {/* Plumbing (supply + drainage + fixtures) — Phase 1.1 */}
      <PlumbingBoqSection
        supplyLines={plumbingSupplyLines}
        drainageLines={plumbingDrainageLines}
        fixturesLines={plumbingFixturesLines}
        rates={rates} onRateChange={setRate}
        openId={openPopoverId} onInfoClick={handleInfoClick} unit={unit}
        onSelectEntity={handleSelectEntity}
      />

      {/* Electrical (wiring + points + fittings + DB) — Phase 1.2 */}
      <ElectricalBoqSection
        wiringLines={electricalWiring}
        pointLines={electricalPoints}
        fittingLines={electricalFittings}
        dbLines={electricalDb}
        rates={rates} onRateChange={setRate}
        openId={openPopoverId} onInfoClick={handleInfoClick} unit={unit}
        onSelectEntity={handleSelectEntity}
      />

      {/* HVAC (refrigerant + condensate + units) — Phase 1.3 */}
      <HvacBoqSection
        refrigerantLines={hvacRefrigerant}
        condensateLines={hvacCondensate}
        unitLines={hvacUnits}
        rates={rates} onRateChange={setRate}
        openId={openPopoverId} onInfoClick={handleInfoClick} unit={unit}
        onSelectEntity={handleSelectEntity}
      />

      {/* Plum concrete */}
      <PlumConcreteRow lines={plumLines}
        rates={rates} onRateChange={setRate}
        openId={openPopoverId} onInfoClick={handleInfoClick} unit={unit}
        onSelectEntity={handleSelectEntity} />

      {/* Shuttering */}
      <ShutteringSection lines={shutteringLines}
        rates={rates} onRateChange={setRate}
        openId={openPopoverId} onInfoClick={handleInfoClick} unit={unit}
        onSelectEntity={handleSelectEntity} />

      {/* Excavation */}
      <ExcavationSection lines={excavationLines}
        rates={rates} onRateChange={setRate}
        openId={openPopoverId} onInfoClick={handleInfoClick} unit={unit}
        onSelectEntity={handleSelectEntity} />

      {/* Plaster materials by system */}
      <PlasterSection lines={plasterLines}
        rates={rates} onRateChange={setRate}
        openId={openPopoverId} onInfoClick={handleInfoClick} unit={unit}
        onSelectEntity={handleSelectEntity} />

      {/* Plaster, Paint, Waterproofing, Roofing — other finishes */}
      {otherFinishLines.length > 0 && (
        <div className="boq-group">
          {otherFinishLines.map(line => (
            <BoqRow key={line.id} line={line}
              rates={rates} onRateChange={setRate}
              openId={openPopoverId} onInfoClick={handleInfoClick} unit={unit}
              onSelectEntity={handleSelectEntity} />
          ))}
        </div>
      )}

      {/* Civil works */}
      {hasCivil && (
        <div className="boq-group">
          <SectionHeader title="Civil Works" />

          {sumpLines.length > 0 && (
            <div className="boq-section">
              <SubSectionHeader title="Sump" suffix={`×${sumps.length}`} />
              {sumpLines.map(line => (
                <BoqSubRow key={line.id} line={line}
                  labelOverride={stripStampPrefix(line)}
                  rates={rates} onRateChange={setRate}
                  openId={openPopoverId} onInfoClick={handleInfoClick} unit={unit}
                  onSelectEntity={handleSelectEntity} />
              ))}
            </div>
          )}

          {septicLines.length > 0 && (
            <div className="boq-section">
              <SubSectionHeader title="Septic Tank" suffix={`×${septics.length}`} />
              {septicLines.map(line => (
                <BoqSubRow key={line.id} line={line}
                  labelOverride={stripStampPrefix(line)}
                  rates={rates} onRateChange={setRate}
                  openId={openPopoverId} onInfoClick={handleInfoClick} unit={unit}
                  onSelectEntity={handleSelectEntity} />
              ))}
            </div>
          )}

          {ohts.length > 0 && (
            <InfoRow label="OHT" value={`${ohts.length} unit${ohts.length > 1 ? 's' : ''}`} />
          )}
        </div>
      )}

      {/* Total cost — always rendered */}
      <div className="boq-total-row">
        <span className="boq-total-label">Total cost estimate</span>
        <span className={`boq-total-amount${hasCostValue ? '' : ' boq-total-amount--empty'}`}>
          {fmtCost(totalCost)}
        </span>
      </div>

      {/* Validation footer */}
      {validation.counts.total > 0 && (
        <div className={`boq-validation-footer${hasErrors ? ' boq-validation-footer--error' : ''}`}>
          <div className="boq-validation-title">
            {validation.counts.total} validation {validation.counts.total === 1 ? 'issue' : 'issues'}
            {hasErrors && ` (${validation.counts.errors} error${validation.counts.errors > 1 ? 's' : ''})`}
          </div>
          {validation.issues.slice(0, 5).map((iss, i) => {
            const selectable = !!iss.entityId && SELECTABLE_ENTITY_TYPES.has(iss.entityType)
            const sevClass = iss.severity === 'error'   ? 'boq-validation-severity--error'
                           : iss.severity === 'warning' ? 'boq-validation-severity--warning'
                           : 'boq-validation-severity--info'
            return (
              <button
                key={i}
                type="button"
                className="boq-validation-issue"
                data-no-target={selectable ? undefined : ''}
                onClick={() => selectable && handleIssueClick(iss)}
                title={selectable ? `Select ${iss.entityType}` : undefined}
              >
                <span className={`boq-validation-severity ${sevClass}`}>{iss.severity}</span>
                <span className="boq-validation-message">{iss.message}</span>
              </button>
            )
          })}
          {validation.issues.length > 5 && (
            <div className="boq-validation-overflow">+{validation.issues.length - 5} more</div>
          )}
        </div>
      )}
      </>
      )}

      {/* Export buttons */}
      <div className="boq-actions">
        <Button variant="secondary" size="sm" onClick={handleExportCSV} disabled={isEmpty}>CSV</Button>
        <Button variant="secondary" size="sm" onClick={handleExportPDF} disabled={isEmpty}>PDF</Button>
        <Button variant="secondary" size="sm" onClick={handleExportExcel} disabled={isEmpty}>Excel</Button>
      </div>

      <FormulaPopover data={formulaData} pos={popoverPos} popoverRef={popoverRef} />
    </div>
  )
}
