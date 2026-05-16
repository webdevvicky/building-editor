// Phase 2.0 — Client-side Excel export of the BOQ.
//
// exportBoqExcel(state, rates, { projectName })
//   → triggers browser download of `boq-${projectName}-${date}.xlsx`.
//
// One sheet per category that has lines, plus a Summary sheet and a Raw Data
// sheet. Amount cells are real formulas (=C*D, or =(C/1000)*D for isPer1000
// lines) so the user can tweak rates in Excel and see totals update.

import * as XLSX from 'xlsx'
import { getBoqLines, groupBoqLinesByCategory, totalBoqCost } from '../boq/lines'

const CATEGORY_SHEETS = {
  finishes:     'Finishes',
  masonry:      'Masonry',
  rcc:          'Structural',
  civil:        'Civil',
  shuttering:   'Shuttering',
  excavation:   'Excavation',
  concreteMix:  'Concrete',
  steel:        'Steel',
  plaster:      'Plaster',
  plumConcrete: 'Plum Concrete',
  staircase:    'Staircase',
}

const CATEGORY_ORDER = [
  'excavation', 'plumConcrete', 'rcc', 'concreteMix', 'steel',
  'shuttering', 'masonry', 'plaster', 'finishes', 'civil', 'staircase',
]

function todayStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function safeFile(name) {
  return String(name || 'project').replace(/[^a-z0-9_\-]+/gi, '_').slice(0, 60) || 'project'
}

function r2(n) { return Math.round(n * 100) / 100 }

function parseRate(rateStr) {
  if (rateStr === undefined || rateStr === null || rateStr === '') return null
  const r = parseFloat(rateStr)
  if (Number.isNaN(r) || r <= 0) return null
  return r
}

// Build a sheet for a single category. Columns: ID | Label | Qty | Unit | Rate | Amount.
// Amount is a live formula referring to Qty (col C) and Rate (col E).
function buildCategorySheet(lines, rates) {
  const aoa = [['ID', 'Label', 'Qty', 'Unit', 'Rate', 'Amount']]
  lines.forEach((l, i) => {
    const rowNum = i + 2 // 1-based, header is row 1
    const rate   = parseRate(rates ? rates[l.rateKey] : '')
    aoa.push([
      l.id,
      l.label,
      r2(l.qty),
      l.unit || '',
      rate === null ? '' : rate,
      // Formula cell, refers to C (qty) and E (rate) on this row.
      { f: l.isPer1000 ? `(C${rowNum}/1000)*E${rowNum}` : `C${rowNum}*E${rowNum}` },
    ])
  })

  // Append subtotal row.
  const subRow = lines.length + 2
  aoa.push(['', 'Subtotal', '', '', '', { f: `SUM(F2:F${subRow - 1})` }])

  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // Column widths.
  ws['!cols'] = [
    { wch: 22 }, { wch: 36 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 14 },
  ]

  // Number format on Rate + Amount columns.
  for (let r = 1; r < aoa.length; r++) {
    const rateCell = XLSX.utils.encode_cell({ r, c: 4 })
    const amtCell  = XLSX.utils.encode_cell({ r, c: 5 })
    if (ws[rateCell] && typeof ws[rateCell].v === 'number') ws[rateCell].z = '#,##0.00'
    if (ws[amtCell]) ws[amtCell].z = '#,##0.00'
  }

  return ws
}

function buildSummarySheet(grouped, grandTotal) {
  const aoa = [['Category', 'Lines', 'Subtotal (Rs.)']]
  for (const cat of CATEGORY_ORDER) {
    const ls = grouped[cat]
    if (!ls || ls.length === 0) continue
    const sub  = ls.reduce((s, l) => s + (l.cost ?? 0), 0)
    const some = ls.some(l => l.cost !== null)
    aoa.push([CATEGORY_SHEETS[cat] || cat, ls.length, some ? r2(sub) : ''])
  }
  aoa.push([])
  aoa.push(['GRAND TOTAL', '', grandTotal === null ? '' : r2(grandTotal)])

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 18 }]
  for (let r = 1; r < aoa.length; r++) {
    const cell = XLSX.utils.encode_cell({ r, c: 2 })
    if (ws[cell] && typeof ws[cell].v === 'number') ws[cell].z = '#,##0.00'
  }
  return ws
}

function buildRawSheet(lines, rates) {
  const rows = lines.map(l => ({
    id:        l.id,
    category:  l.category,
    label:     l.label,
    qty:       r2(l.qty),
    unit:      l.unit || '',
    rateKey:   l.rateKey,
    rate:      parseRate(rates ? rates[l.rateKey] : '') ?? '',
    isPer1000: !!l.isPer1000,
    cost:      l.cost === null ? '' : r2(l.cost),
    floorId:   l.floorId,
    formulaId: l.formulaId,
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [
    { wch: 26 }, { wch: 14 }, { wch: 36 }, { wch: 10 }, { wch: 8 },
    { wch: 26 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 8 }, { wch: 22 },
  ]
  return ws
}

export function exportBoqExcel(state, rates, opts = {}) {
  const projectName = opts.projectName || 'Untitled'
  const lines       = getBoqLines(state, rates || {})
  const grouped     = groupBoqLinesByCategory(lines)
  const grand       = totalBoqCost(lines)

  const wb = XLSX.utils.book_new()

  // Summary first so it opens by default.
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(grouped, grand), 'Summary')

  // One sheet per non-empty category, in our preferred display order.
  for (const cat of CATEGORY_ORDER) {
    const ls = grouped[cat]
    if (!ls || ls.length === 0) continue
    const ws   = buildCategorySheet(ls, rates)
    const name = (CATEGORY_SHEETS[cat] || cat).slice(0, 31) // Excel sheet name limit
    XLSX.utils.book_append_sheet(wb, ws, name)
  }

  // Raw data dump last — every field on every line.
  XLSX.utils.book_append_sheet(wb, buildRawSheet(lines, rates), 'Raw Data')

  XLSX.writeFile(wb, `boq-${safeFile(projectName)}-${todayStamp()}.xlsx`)
}
