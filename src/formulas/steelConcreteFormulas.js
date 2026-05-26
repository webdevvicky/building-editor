import {
  STEEL_KG_PER_M3,
  CEMENT_BAGS_PER_M3,
  SAND_M3_PER_M3_DRY,
  AGGREGATE_M3_PER_M3_DRY,
  AGGREGATE_SPLIT,
} from '../constants/structural'
import { safeR2 as r2 } from '../lib/numbers.js'

const FT3_TO_M3 = 0.0283168

const STEEL_NOTE =
  'Steel quantity = RCC volume × reinforcement density. Density reflects typical residential construction; verify with structural engineer for actual BBS.'

function getRccVolFt3(state, type) {
  if (type === 'FOOTING')   return Object.values(state.getFootingQuantities()).reduce((s, v) => s + (v.concreteVolFt3 ?? 0), 0)
  if (type === 'COLUMN')    return Object.values(state.getColumnQuantities()).reduce((s, v) => s + (v.volFt3 ?? 0), 0)
  if (type === 'STAIRCASE') return state.getStaircaseQuantities().reduce((s, v) => s + (v.totalRccFt3 ?? 0), 0)
  if (type === 'BEAM') { const q = state.getBeamQuantities(); return (q.plinth?.volFt3 ?? 0) + (q.lintel?.volFt3 ?? 0) + (q.roof?.volFt3 ?? 0) }
  if (type === 'SLAB') { const q = state.getSlabQuantities(); return (q.mainVolFt3 ?? 0) + (q.sunkenVolFt3 ?? 0) }
  return null // CIVIL_STAMP handled separately
}

// explainSteelByElement(state, elementType)
// elementType: 'FOOTING' | 'COLUMN' | 'BEAM' | 'SLAB' | 'STAIRCASE' | 'CIVIL_STAMP'
export function explainSteelByElement(state, elementType) {
  const density = STEEL_KG_PER_M3[elementType]
  if (!density) return { title: 'Steel — Unknown Element', steps: [] }

  const label = elementType.charAt(0) + elementType.slice(1).toLowerCase().replace('_', ' ')

  // CIVIL_STAMP: back-derive volume from pre-computed kg (no separate volume selector)
  if (elementType === 'CIVIL_STAMP') {
    const civilKg = r2(state.getSteelQuantities().civilStamp ?? 0)
    const volM3 = density > 0 ? r2(civilKg / density) : 0
    const noVol = civilKg === 0 ? [{ label: 'Note', value: 'No civil stamp volumes found.' }] : []
    return {
      title: 'Steel — Civil Stamps',
      steps: [
        { label: 'Element', value: 'Civil Stamps (sump, OHT, septic)' },
        { label: 'Derived RCC volume', value: `${civilKg} kg ÷ ${density} kg/m³ = ${volM3} m³` },
        { label: 'Steel weight', value: `${civilKg} kg`, bold: true },
        ...noVol,
      ],
      note: STEEL_NOTE,
    }
  }

  const volFt3 = getRccVolFt3(state, elementType)
  const volM3 = r2(volFt3 * FT3_TO_M3)
  const steelKg = r2(volM3 * density)

  const noVol2 = volFt3 === 0 ? [{ label: 'Note', value: 'No volume found for this element.' }] : []
  return {
    title: `Steel — ${label}`,
    steps: [
      { label: `${label} RCC volume`, value: `${r2(volFt3)} ft³` },
      { label: 'Convert to m³', value: `${r2(volFt3)} × 0.0283168 = ${volM3} m³` },
      { label: 'Reinforcement density', value: `${density} kg/m³` },
      { label: 'Steel weight', value: `${volM3} × ${density} = ${steelKg} kg`, bold: true },
      ...noVol2,
    ],
    note: STEEL_NOTE,
  }
}

// explainConcreteGrade(state, grade)
// grade: 'M20' | 'M7_5'
export function explainConcreteGrade(state, grade) {
  const gradeLabel = grade === 'M7_5' ? 'M7.5' : grade
  const data = state.getConcreteByGrade()[grade]

  if (!data || data.volM3 === 0) {
    return {
      title: `Concrete Mix — ${gradeLabel}`,
      steps: [{ label: 'Volume', value: '0 m³ — no elements use this grade.' }],
    }
  }

  const volM3 = r2(data.volM3)
  const cementRate = CEMENT_BAGS_PER_M3[grade]
  const cementBags = r2(volM3 * cementRate)
  const sandRate = SAND_M3_PER_M3_DRY[grade]
  const aggRate = AGGREGATE_M3_PER_M3_DRY[grade]
  const sandM3 = r2(volM3 * sandRate)
  const aggTotal = r2(volM3 * aggRate)
  const split = AGGREGATE_SPLIT[grade]

  const aggSteps =
    grade === 'M20'
      ? [
          { label: `Aggregate 10mm (${(split.mm10Ratio * 100).toFixed(0)}% of ${aggRate} m³/m³)`,
            value: `${aggTotal} × ${split.mm10Ratio} = ${r2(aggTotal * split.mm10Ratio)} m³` },
          { label: `Aggregate 20mm (${(split.mm20Ratio * 100).toFixed(0)}% of ${aggRate} m³/m³)`,
            value: `${aggTotal} × ${split.mm20Ratio} = ${r2(aggTotal * split.mm20Ratio)} m³` },
        ]
      : [
          { label: `Aggregate 20mm only — ${aggRate} m³/m³ (40mm gauge, single size)`,
            value: `${volM3} × ${aggRate} = ${aggTotal} m³` },
          { label: 'Note', value: 'JRM spec uses 40mm gauge for PCC — single size, no 10mm split.' },
        ]

  return {
    title: `Concrete Mix — ${gradeLabel}`,
    steps: [
      { label: `Total ${gradeLabel} concrete volume`, value: `${volM3} m³` },
      { label: `Cement (${cementRate} bags/m³)`, value: `${volM3} × ${cementRate} = ${cementBags} bags` },
      { label: `Sand — dry procurement (${sandRate} m³/m³)`, value: `${volM3} × ${sandRate} = ${sandM3} m³ (dry)` },
      ...aggSteps,
      { label: 'Total cement bags', value: `${cementBags} bags`, bold: true },
    ],
    note: 'Sand and aggregate shown as dry procurement volumes. Cement is by weight (50 kg/bag), not subject to dry-to-wet factor.',
  }
}
