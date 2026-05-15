import { CONCRETE_GRADE, PCC_BEDDING_THICKNESS_FT, BEAM_LEVEL_REGISTRY } from '../constants/structural'

// state = full Zustand store state (passed in — never imported from store.js)
// All functions return { title, steps: [{ label, value, bold? }], note? }

function r2(n) { return Math.round(n * 100) / 100 }

// ── explainColumnRCC ──────────────────────────────────────────────────────────

export function explainColumnRCC(state, columnTypeId) {
  const { projectSettings, columns } = state
  const { columnTypes, heights, slabSettings } = projectSettings

  const ct = columnTypes.find(t => t.id === columnTypeId)
  if (!ct) return { title: 'Column RCC', steps: [{ label: 'Column type not found', value: '—' }] }

  const colQtys = state.getColumnQuantities()
  const qty = colQtys[columnTypeId]
  if (!qty || qty.count === 0) {
    return {
      title: `Column RCC – ${ct.label}`,
      steps: [{ label: 'No columns of this type placed', value: '—' }],
    }
  }

  const isCircle   = ct.shape === 'circle'
  const sectionFt2 = isCircle
    ? Math.PI * Math.pow(ct.diamIn / 2, 2) / 144
    : (ct.widthIn * ct.depthIn) / 144

  const plinthHFt  = heights.plinthHeightFt
  const floorHFt   = heights.floorHeightFt
  const slabThickFt = slabSettings.mainThicknessIn / 12
  const colHeightFt = plinthHFt + floorHFt + slabThickFt

  const volPerCol  = r2(sectionFt2 * colHeightFt)
  const totalVol   = r2(volPerCol * qty.count)

  // Count node-attached vs standalone
  const allCols = Object.values(columns).filter(c => c.columnTypeId === columnTypeId)
  const attached   = allCols.filter(c => c.attachedNodeId).length
  const standalone = allCols.length - attached

  const sectionLabel = isCircle
    ? `π × (${ct.diamIn / 2}″ radius)² ÷ 144`
    : `${ct.widthIn}″ × ${ct.depthIn}″ ÷ 144`

  const steps = [
    { label: 'Column type',                                    value: ct.label },
    { label: 'Section formula',                                value: sectionLabel },
    { label: 'Section area',                                   value: `${r2(sectionFt2)} ft²` },
    { label: `Height  (${plinthHFt} + ${floorHFt} + ${r2(slabThickFt)} ft)`, value: `${r2(colHeightFt)} ft` },
    { label: 'Node-attached columns',                          value: String(attached) },
    { label: 'Standalone columns',                             value: String(standalone) },
    { label: 'Total columns',                                  value: String(qty.count) },
    { label: `Volume per column  (${r2(sectionFt2)} × ${r2(colHeightFt)})`, value: `${volPerCol} ft³` },
    { label: `Total RCC volume  (${volPerCol} × ${qty.count})`, value: `${totalVol} ft³`, bold: true },
  ]

  return {
    title: `Column RCC – ${ct.label} (${CONCRETE_GRADE.COLUMN})`,
    steps,
    note: 'Column height = plinth height + floor-to-ceiling height + slab thickness. Single floor only.',
  }
}

// ── explainFootingRCC ─────────────────────────────────────────────────────────

export function explainFootingRCC(state, footingTypeId) {
  const { projectSettings } = state
  const { footingTypes } = projectSettings

  const ft = footingTypes.find(t => t.id === footingTypeId)
  if (!ft) return { title: 'Footing RCC', steps: [{ label: 'Footing type not found', value: '—' }] }

  const footQtys = state.getFootingQuantities()
  const qty = footQtys[footingTypeId]
  if (!qty || qty.count === 0) {
    return {
      title: `Footing RCC – ${ft.label}`,
      steps: [{ label: 'No footings of this type', value: '—' }],
    }
  }

  const volPerFooting = r2(ft.lengthFt * ft.widthFt * ft.depthFt)
  const totalVol      = r2(volPerFooting * qty.count)

  const steps = [
    { label: 'Footing type',                                          value: ft.label },
    { label: `Dimensions`,                                            value: `${ft.lengthFt} ft × ${ft.widthFt} ft × ${ft.depthFt} ft` },
    { label: `Volume per footing  (${ft.lengthFt} × ${ft.widthFt} × ${ft.depthFt})`, value: `${volPerFooting} ft³` },
    { label: 'Footing count',                                         value: String(qty.count) },
    { label: `Total RCC volume  (${volPerFooting} × ${qty.count})`,  value: `${totalVol} ft³`, bold: true },
  ]

  return {
    title: `Footing RCC – ${ft.label} (${CONCRETE_GRADE.FOOTING})`,
    steps,
    note: 'Isolated footing only. Combined and raft footings deferred to Phase 2.',
  }
}

// ── explainFootingPCC ─────────────────────────────────────────────────────────

export function explainFootingPCC(state, footingTypeId) {
  const { projectSettings } = state
  const { footingTypes } = projectSettings

  const ft = footingTypes.find(t => t.id === footingTypeId)
  if (!ft) return { title: 'Footing PCC', steps: [{ label: 'Footing type not found', value: '—' }] }

  const footQtys = state.getFootingQuantities()
  const qty = footQtys[footingTypeId]
  if (!qty || qty.count === 0) {
    return {
      title: `Footing PCC – ${ft.label}`,
      steps: [{ label: 'No footings of this type', value: '—' }],
    }
  }

  const footprintFt2  = r2(ft.lengthFt * ft.widthFt)
  const pccPerFooting = r2(footprintFt2 * PCC_BEDDING_THICKNESS_FT)
  const totalPcc      = r2(pccPerFooting * qty.count)

  const steps = [
    { label: 'Footing type',                                             value: ft.label },
    { label: `Footprint  (${ft.lengthFt} ft × ${ft.widthFt} ft)`,       value: `${footprintFt2} ft²` },
    { label: 'PCC thickness',                                            value: '2 in (0.167 ft)' },
    { label: `PCC per footing  (${footprintFt2} × ${r2(PCC_BEDDING_THICKNESS_FT)})`, value: `${pccPerFooting} ft³` },
    { label: 'Footing count',                                            value: String(qty.count) },
    { label: `Total PCC volume  (${pccPerFooting} × ${qty.count})`,     value: `${totalPcc} ft³`, bold: true },
  ]

  return {
    title: `Footing PCC – ${ft.label} (M7.5)`,
    steps,
    note: 'PCC bedding layer 50mm (2 inches) under each footing. Grade M7.5.',
  }
}

// ── explainBeamRCC ────────────────────────────────────────────────────────────

export function explainBeamRCC(state, level) {
  const { projectSettings } = state
  const { beamDimensions } = projectSettings
  const levelLabel = BEAM_LEVEL_REGISTRY.find(l => l.id === level)?.label ?? level

  const beamQtys = state.getBeamQuantities()
  const qty = beamQtys[level]

  if (!qty) {
    return {
      title: `${levelLabel} RCC`,
      steps: [{ label: `No ${levelLabel.toLowerCase()}s placed`, value: '—' }],
    }
  }

  const dims = beamDimensions[level]
  const widthFt = r2(dims.widthIn / 12)
  const depthFt = r2(dims.depthIn / 12)

  // Count WALL_DERIVED vs EXPLICIT beams at this level
  const allBeams = state.getAllBeams()
  const levelBeams  = allBeams.filter(b => b.level === level)
  const derived     = levelBeams.filter(b => b.source === 'WALL_DERIVED').length
  const explicit    = levelBeams.filter(b => b.source === 'EXPLICIT').length

  const steps = [
    { label: 'Level',                                                    value: levelLabel },
    { label: 'Cross-section',                                            value: `${dims.widthIn}″ wide × ${dims.depthIn}″ deep` },
    { label: 'Section  (width × depth)',                                 value: `${widthFt} ft × ${depthFt} ft` },
    { label: 'Total beam length',                                        value: `${qty.totalLenFt} ft` },
    { label: `Volume  (${qty.totalLenFt} ft × ${widthFt} ft × ${depthFt} ft)`, value: `${qty.volFt3} ft³`, bold: true },
  ]

  const noteLines = [
    `Wall-derived beams: ${derived}. Explicitly drawn beams: ${explicit}.`,
  ]
  if (derived > 0) {
    noteLines.push('Wall-derived beam length computed from wall geometry. Beam deduction from masonry shown separately.')
  }

  return {
    title: `${levelLabel} RCC (${CONCRETE_GRADE.BEAM})`,
    steps,
    note: noteLines.join(' '),
  }
}
