// Client-side Excel export of the BOQ.
//
// exportBoqExcel(state, rates, { projectName, unit | unitSystem })
//   → triggers browser download of `boq-${projectName}-${date}.xlsx`.
//
// 2026-05-26 — rewritten to consume src/boq/presentationModel.js. The
// exporter does NO independent math (no per-line cost calc, no
// subtotaling, no contingency math, no project-cost rollup). Every
// number on every sheet reads from the model so Excel ≡ PDF totals.
//
// Sheet layout governed by SHEET_BUCKETS — Summary + one sheet per
// non-empty bucket + Raw Data. Multi-category buckets show a "System"
// column prepended.
//
// Contingency displayMode (model.contingencySummary.displayMode):
//   - 'clean'    → Qty | Unit | Rate | Amount (contingency baked into Qty)
//   - 'detailed' → Qty (Base) | +% | Qty (Total) | Unit | Rate | Amount

import * as XLSX from 'xlsx'
import { getBoqLines } from '../boq/lines'
import { computeBoqPresentationModel } from '../boq/presentationModel.js'
import { formatQuantity, normalizeUnitMode } from '../lib/units.js'
import { warnUnmappedCategories } from './_buckets.js'

function todayStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function safeFile(name) {
  return String(name || 'project').replace(/[^a-z0-9_\-]+/gi, '_').slice(0, 60) || 'project'
}

import { safeR2 as r2 } from '../lib/numbers.js'

function fmtPct(p) {
  if (!p) return ''
  return `+${p}%`
}

// Build a sheet for a single bucket from the presentation model.
// Column layout depends on (a) bucket.isMulti and (b) contingency displayMode.
function buildSheetForBucket(bucket, displayMode, contingencyMode) {
  const multi    = bucket.isMulti
  const detailed = contingencyMode === 'detailed'

  // Column header arrays — exactly one shape per (multi × detailed) combo.
  const head = []
  head.push('ID')
  if (multi) head.push('System')
  head.push('Label')
  if (detailed) {
    head.push('Qty (Base)')
    head.push('+%')
    head.push('Qty (Total)')
  } else {
    head.push('Qty')
  }
  head.push('Qty (display)')
  head.push('Unit')
  head.push('Rate (Rs.)')
  head.push('Amount (Rs.)')
  const aoa = [head]

  for (const l of bucket.lines) {
    const row = []
    row.push(l.id)
    if (multi) row.push(l.systemColumn ?? '')
    row.push(l.label)
    if (detailed) {
      row.push(r2(l.qty))
      row.push(fmtPct(l.contingencyPct))
      row.push(r2(l.qtyTotal))
    } else {
      row.push(r2(l.qtyTotal))
    }
    row.push(formatQuantity(l.qtyTotal, l.unit, displayMode))
    row.push(l.unit || '')
    row.push(l.rate === null || l.rate === undefined ? '' : l.rate)
    row.push(l.amount === null || l.amount === undefined ? '' : l.amount)
    aoa.push(row)
  }

  // Subtotal row — pre-computed by the model.
  const subRow = new Array(head.length).fill('')
  subRow[head.length - 2] = 'Subtotal'
  subRow[head.length - 1] = bucket.subtotal
  aoa.push(subRow)

  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // Column widths — mirror header positions.
  const widths = []
  widths.push({ wch: 22 })            // ID
  if (multi) widths.push({ wch: 12 }) // System
  widths.push({ wch: 36 })            // Label
  if (detailed) {
    widths.push({ wch: 12 }); widths.push({ wch: 6 }); widths.push({ wch: 14 })
  } else {
    widths.push({ wch: 14 })
  }
  widths.push({ wch: 18 })            // Qty (display)
  widths.push({ wch: 8 })             // Unit
  widths.push({ wch: 12 })            // Rate
  widths.push({ wch: 14 })            // Amount
  ws['!cols'] = widths

  // Number format on Rate + Amount cells (last 2 columns).
  const rateColIdx   = head.length - 2
  const amountColIdx = head.length - 1
  for (let r = 1; r < aoa.length; r++) {
    const rc = XLSX.utils.encode_cell({ r, c: rateColIdx })
    const ac = XLSX.utils.encode_cell({ r, c: amountColIdx })
    if (ws[rc] && typeof ws[rc].v === 'number') ws[rc].z = '#,##0.00'
    if (ws[ac] && typeof ws[ac].v === 'number') ws[ac].z = '#,##0.00'
  }
  return ws
}

// New Summary sheet (Gap 9) — project metadata block + scope-of-work
// block + per-bucket subtotal table + contingency summary + project
// costs block + signature block.
function buildSummarySheet(model) {
  const aoa = []
  const m = model.projectMeta
  const so = model.scopeOfWork
  const cs = model.contingencySummary
  const pc = model.projectCosts

  // ── Project header ──────────────────────────────────────────────────────
  aoa.push(['BILL OF QUANTITIES', '', ''])
  aoa.push([])
  aoa.push(['Project title',  m.projectTitle, ''])
  aoa.push(['Owner',          m.ownerName,    ''])
  aoa.push(['Location',       m.location,     ''])
  aoa.push(['Date prepared',  m.preparedDate || todayStamp(), ''])
  aoa.push(['Prepared by',    m.preparedBy,   ''])
  aoa.push(['Checked by',     m.checkedBy,    ''])
  aoa.push(['Approved by',    m.approvedBy,   ''])
  aoa.push([])

  // ── Scope of work ───────────────────────────────────────────────────────
  aoa.push(['SCOPE OF WORK', '', ''])
  aoa.push(['Floors',                 so.floorCount, ''])
  aoa.push(['Total built-up area',    so.totalBuiltUpAreaSft, 'Sft'])
  if (so.plotAreaSft > 0)
    aoa.push(['Plot area',            so.plotAreaSft, 'Sft'])
  aoa.push(['Walls (count)',          so.wallCount, ''])
  aoa.push(['Columns (count)',        so.columnCount, ''])
  aoa.push(['Doors',                  so.openingCounts.doors, ''])
  aoa.push(['Windows',                so.openingCounts.windows, ''])
  aoa.push(['Ventilators',            so.openingCounts.ventilators, ''])
  if (Object.keys(so.roomCountByType).length > 0) {
    aoa.push([])
    aoa.push(['Rooms by type', '', ''])
    for (const [t, n] of Object.entries(so.roomCountByType).sort(([a], [b]) => a.localeCompare(b))) {
      aoa.push([`  ${t}`, n, ''])
    }
  }
  aoa.push([])

  // ── Bucket subtotals ────────────────────────────────────────────────────
  aoa.push(['CATEGORY SUBTOTALS', 'Lines', 'Subtotal (Rs.)'])
  for (const b of model.buckets) {
    aoa.push([b.name, b.lines.length, b.subtotal])
  }
  aoa.push([])

  // ── Contingency summary ─────────────────────────────────────────────────
  aoa.push(['CONTINGENCY', '', ''])
  aoa.push(['Display mode',       cs.displayMode, ''])
  aoa.push(['Default percent',    cs.defaultPercent + '%', ''])
  if (cs.overrides && Object.keys(cs.overrides).length > 0) {
    aoa.push(['Per-category overrides:', '', ''])
    for (const [cat, p] of Object.entries(cs.overrides).sort(([a], [b]) => a.localeCompare(b))) {
      aoa.push([`  ${cat}`, p + '%', ''])
    }
  }
  if (cs.excludedCategories?.length) {
    aoa.push(['Excluded categories', cs.excludedCategories.join(', '), ''])
  }
  aoa.push([])

  // ── Project costs ───────────────────────────────────────────────────────
  aoa.push(['PROJECT COST SUMMARY', '', 'Amount (Rs.)'])
  for (const row of pc.breakdown) {
    aoa.push([row.label, '', row.amount])
  }
  aoa.push([])
  aoa.push(['GRAND TOTAL', '', pc.grandTotal])
  aoa.push([])
  aoa.push([])

  // ── Signature block ─────────────────────────────────────────────────────
  aoa.push(['Prepared by',  'Checked by',   'Approved by'])
  aoa.push([m.preparedBy,   m.checkedBy,    m.approvedBy])
  aoa.push(['_______________', '_______________', '_______________'])
  aoa.push(['Signature',    'Signature',    'Signature'])

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 32 }, { wch: 24 }, { wch: 20 }]
  // Number format on the cost-summary subtotal column.
  for (let r = 0; r < aoa.length; r++) {
    const c = XLSX.utils.encode_cell({ r, c: 2 })
    if (ws[c] && typeof ws[c].v === 'number') ws[c].z = '#,##0.00'
  }
  return ws
}

function buildRawSheet(decoratedLines, displayMode) {
  const rows = decoratedLines.map(l => ({
    id:            l.id,
    category:      l.category,
    label:         l.label,
    qtyBase:       l.qty,
    contingencyPct: l.contingencyPct ?? 0,
    qtyTotal:      l.qtyTotal,
    qtyDisplay:    formatQuantity(l.qtyTotal, l.unit, displayMode),
    unit:          l.unit || '',
    rateKey:       l.rateKey,
    rate:          l.rate ?? '',
    isPer1000:     !!l.isPer1000,
    amount:        l.amount === null || l.amount === undefined ? '' : l.amount,
    floorId:       l.floorId,
    formulaId:     l.formulaId,
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [
    { wch: 26 }, { wch: 18 }, { wch: 36 }, { wch: 10 }, { wch: 8 }, { wch: 10 },
    { wch: 18 }, { wch: 8 }, { wch: 26 }, { wch: 12 }, { wch: 10 }, { wch: 14 },
    { wch: 8 }, { wch: 22 },
  ]
  return ws
}

export function exportBoqExcel(state, rates, opts = {}) {
  const projectName = opts.projectName || state?.projectSettings?.projectMeta?.projectTitle || 'Untitled'
  const displayMode = normalizeUnitMode(
    opts.unit ?? (opts.unitSystem === 'metric' ? 'm' : 'ft-in')
  )

  // Build canonical model once. Both Excel and PDF read this — no math
  // happens downstream.
  const lines = getBoqLines(state, rates || {})
  warnUnmappedCategories(lines.reduce((m, l) => {
    if (!m[l.category]) m[l.category] = []
    m[l.category].push(l)
    return m
  }, {}))

  const model = computeBoqPresentationModel(lines, rates || {}, state, { projectNameOverride: projectName })
  const contingencyMode = model.contingencySummary.displayMode

  const wb = XLSX.utils.book_new()

  // Summary first so it opens by default.
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(model), 'Summary')

  // One sheet per non-empty bucket, in registry order.
  for (const bucket of model.buckets) {
    const ws   = buildSheetForBucket(bucket, displayMode, contingencyMode)
    const name = bucket.name.slice(0, 31)
    XLSX.utils.book_append_sheet(wb, ws, name)
  }

  // Raw data dump last — flat decorated lines (every field).
  const allDecorated = model.buckets.flatMap(b => b.lines)
  XLSX.utils.book_append_sheet(wb, buildRawSheet(allDecorated, displayMode), 'Raw Data')

  XLSX.writeFile(wb, `boq-${safeFile(projectName)}-${todayStamp()}.xlsx`)

  return model.grandTotal   // returned for verify-script parity assertions
}
