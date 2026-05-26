// Phase 2.0 — Client-side Excel export of the BOQ.
//
// exportBoqExcel(state, rates, { projectName, unit | unitSystem })
//   → triggers browser download of `boq-${projectName}-${date}.xlsx`.
//
// Sheet layout governed by src/export/_buckets.js SHEET_BUCKETS so PDF
// and Excel stay in lock-step. Each non-empty bucket gets one sheet;
// multi-category buckets (Plumbing / Electrical / HVAC / Fire / ELV)
// add a "System" column so procurement can filter sub-systems within
// the discipline.

import * as XLSX from 'xlsx'
import { getBoqLines, groupBoqLinesByCategory, totalBoqCost } from '../boq/lines'
import { formatQuantity, normalizeUnitMode } from '../lib/units.js'
import {
  SHEET_BUCKETS, bucketLines, bucketIsMulti, bucketSystemLabel,
  warnUnmappedCategories,
} from './_buckets.js'

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

// Build a sheet for a single bucket. Column layout:
//
//   Single-category bucket (8 of 19 buckets):
//     A: ID | B: Label | C: Quantity (decimal) | D: Quantity (display) |
//     E: Unit | F: Rate | G: Amount
//     Amount formula: C*F (or (C/1000)*F for isPer1000 brick lines).
//
//   Multi-category bucket (5 MEP buckets):
//     A: ID | B: System | C: Label | D: Quantity (decimal) |
//     E: Quantity (display) | F: Unit | G: Rate | H: Amount
//     Amount formula: D*G (one column to the right of single-bucket case).
//
// "Quantity (decimal)" stays numeric so SUM() and the Amount formula
// keep working; "Quantity (display)" carries the human-readable string
// (feet-inches in ft-in mode, metric in m mode) for inspection.
function buildSheetForBucket(bucket, grouped, rates, displayMode) {
  const lines = bucketLines(bucket, grouped)
  const multi = bucketIsMulti(bucket)

  // Header
  const header = multi
    ? ['ID', 'System', 'Label', 'Quantity (decimal)', 'Quantity (display)', 'Unit', 'Rate', 'Amount']
    : ['ID', 'Label', 'Quantity (decimal)', 'Quantity (display)', 'Unit', 'Rate', 'Amount']
  const aoa = [header]

  // Column letters that shift between single/multi shape.
  // multi=true: qty=D(3), rate=G(6), amount=H(7)
  // multi=false: qty=C(2), rate=F(5), amount=G(6)
  const qtyColLetter   = multi ? 'D' : 'C'
  const rateColLetter  = multi ? 'G' : 'F'
  const amountColIdx   = multi ? 7 : 6
  const rateColIdx     = multi ? 6 : 5

  lines.forEach((l, i) => {
    const rowNum = i + 2 // 1-based, header is row 1
    const rate   = parseRate(rates ? rates[l.rateKey] : '')
    const formula = l.isPer1000
      ? `(${qtyColLetter}${rowNum}/1000)*${rateColLetter}${rowNum}`
      : `${qtyColLetter}${rowNum}*${rateColLetter}${rowNum}`
    const amountCell = { f: formula }

    if (multi) {
      aoa.push([
        l.id,
        bucketSystemLabel(bucket, l.category),
        l.label,
        r2(l.qty),
        formatQuantity(l.qty, l.unit, displayMode),
        l.unit || '',
        rate === null ? '' : rate,
        amountCell,
      ])
    } else {
      aoa.push([
        l.id,
        l.label,
        r2(l.qty),
        formatQuantity(l.qty, l.unit, displayMode),
        l.unit || '',
        rate === null ? '' : rate,
        amountCell,
      ])
    }
  })

  // Subtotal row — SUM over the Amount column.
  const lastDataRow = lines.length + 1 // header + N data rows
  const subRowSpacer = multi
    ? ['', '', 'Subtotal', '', '', '', '', { f: `SUM(${'H'}2:H${lastDataRow})` }]
    : ['', 'Subtotal',        '', '', '', '', { f: `SUM(${'G'}2:G${lastDataRow})` }]
  aoa.push(subRowSpacer)

  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // Column widths.
  ws['!cols'] = multi
    ? [{ wch: 22 }, { wch: 12 }, { wch: 36 }, { wch: 14 }, { wch: 18 }, { wch: 8 }, { wch: 12 }, { wch: 14 }]
    : [{ wch: 22 },              { wch: 36 }, { wch: 14 }, { wch: 18 }, { wch: 8 }, { wch: 12 }, { wch: 14 }]

  // Number format on Rate + Amount columns.
  for (let r = 1; r < aoa.length; r++) {
    const rateCell = XLSX.utils.encode_cell({ r, c: rateColIdx })
    const amtCell  = XLSX.utils.encode_cell({ r, c: amountColIdx })
    if (ws[rateCell] && typeof ws[rateCell].v === 'number') ws[rateCell].z = '#,##0.00'
    if (ws[amtCell]) ws[amtCell].z = '#,##0.00'
  }

  return ws
}

function buildSummarySheet(grouped, grandTotal) {
  const aoa = [['Category', 'Lines', 'Subtotal (Rs.)']]
  for (const bucket of SHEET_BUCKETS) {
    const ls = bucketLines(bucket, grouped)
    if (ls.length === 0) continue
    const sub  = ls.reduce((s, l) => s + (l.cost ?? 0), 0)
    const some = ls.some(l => l.cost !== null)
    aoa.push([bucket.name, ls.length, some ? r2(sub) : ''])
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

function buildRawSheet(lines, rates, displayMode) {
  const rows = lines.map(l => ({
    id:        l.id,
    category:  l.category,
    label:     l.label,
    qty:       r2(l.qty),
    qtyDisplay: formatQuantity(l.qty, l.unit, displayMode),
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
    { wch: 26 }, { wch: 14 }, { wch: 36 }, { wch: 10 }, { wch: 18 }, { wch: 8 },
    { wch: 26 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 8 }, { wch: 22 },
  ]
  return ws
}

export function exportBoqExcel(state, rates, opts = {}) {
  const projectName = opts.projectName || 'Untitled'
  // Display mode for the human-readable "Quantity (display)" column.
  // Prefer explicit `unit`, fall back to legacy unitSystem string, then 'ft-in'.
  const displayMode = normalizeUnitMode(
    opts.unit ?? (opts.unitSystem === 'metric' ? 'm' : 'ft-in')
  )
  const lines   = getBoqLines(state, rates || {})
  const grouped = groupBoqLinesByCategory(lines)
  const grand   = totalBoqCost(lines)

  // Dev warning if any emitted category isn't in SHEET_BUCKETS — would
  // otherwise appear only in Raw Data.
  warnUnmappedCategories(grouped)

  const wb = XLSX.utils.book_new()

  // Summary first so it opens by default.
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(grouped, grand), 'Summary')

  // One sheet per non-empty bucket, in registry order.
  for (const bucket of SHEET_BUCKETS) {
    const ls = bucketLines(bucket, grouped)
    if (ls.length === 0) continue
    const ws   = buildSheetForBucket(bucket, grouped, rates, displayMode)
    const name = bucket.name.slice(0, 31) // Excel sheet name limit
    XLSX.utils.book_append_sheet(wb, ws, name)
  }

  // Raw data dump last — every field on every line.
  XLSX.utils.book_append_sheet(wb, buildRawSheet(lines, rates, displayMode), 'Raw Data')

  XLSX.writeFile(wb, `boq-${safeFile(projectName)}-${todayStamp()}.xlsx`)
}
