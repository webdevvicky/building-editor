// Phase 2.0 — Client-side PDF export of the BOQ.
//
// exportBoqPdf(state, rates, { projectName, preparedBy, unit | unitSystem })
//   → triggers browser download of `boq-${projectName}-${date}.pdf`.
//
// Built on jsPDF + jspdf-autotable. No network access. The default jsPDF font
// ships without the U+20B9 INR glyph, so we render the currency as the ASCII
// prefix "Rs. " throughout.
//
// Section layout mirrors Excel sheet layout via src/export/_buckets.js so the
// two exports never drift. Multi-category MEP buckets render a "System"
// column so procurement reads which sub-system each line belongs to.

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
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

function fmtRs(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return ''
  return 'Rs. ' + Math.round(n).toLocaleString('en-IN')
}

function fmtPdfQty(line, displayMode) {
  if (!line) return ''
  const v = line.qty
  if (v === null || v === undefined || Number.isNaN(v)) return ''
  return formatQuantity(v, line.unit, displayMode)
}

function fmtRate(rate, isPer1000) {
  if (rate === '' || rate === null || rate === undefined) return ''
  const r = parseFloat(rate)
  if (Number.isNaN(r) || r <= 0) return ''
  return 'Rs. ' + r.toLocaleString('en-IN') + (isPer1000 ? ' /1000' : '')
}

function drawFooter(doc, page, pageCount) {
  const w = doc.internal.pageSize.getWidth()
  const h = doc.internal.pageSize.getHeight()
  doc.setFontSize(8)
  doc.setTextColor(120)
  doc.text('Preliminary estimate - for budgeting only', 40, h - 20)
  doc.text(`Page ${page} of ${pageCount || '?'}`, w - 40, h - 20, { align: 'right' })
  doc.setTextColor(0)
}

export function exportBoqPdf(state, rates, opts = {}) {
  const projectName = opts.projectName || 'Untitled'
  const preparedBy  = opts.preparedBy  || '-'
  // Prefer explicit display unit ('ft' | 'ft-in' | 'm'); fall back to
  // legacy unitSystem string ('metric' | 'ft (Indian)'). Indian engineers
  // get feet-inches as the default friendly format.
  const displayMode = normalizeUnitMode(
    opts.unit ?? (opts.unitSystem === 'metric' ? 'm' : 'ft-in')
  )
  const unitSystem  = opts.unitSystem  || (displayMode === 'm' ? 'metric' : 'ft (Indian)')

  const lines    = getBoqLines(state, rates || {})
  const grouped  = groupBoqLinesByCategory(lines)
  const grandTot = totalBoqCost(lines)

  // Dev warning if a category isn't in SHEET_BUCKETS — would otherwise
  // silently disappear from per-section pages.
  warnUnmappedCategories(grouped)

  const doc = new jsPDF({ unit: 'pt', format: 'a4' })

  // ── Cover page ──────────────────────────────────────────────────────────
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  doc.setFontSize(10)
  doc.setTextColor(120)
  doc.text('BILL OF QUANTITIES', pageW / 2, 140, { align: 'center' })
  doc.setTextColor(0)
  doc.setFontSize(34)
  doc.setFont('helvetica', 'bold')
  doc.text(projectName, pageW / 2, 200, { align: 'center', maxWidth: pageW - 80 })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  doc.text(`Date: ${todayStamp()}`, pageW / 2, 260, { align: 'center' })
  doc.text(`Unit system: ${unitSystem}`, pageW / 2, 282, { align: 'center' })
  doc.text(`Prepared by: ${preparedBy}`, pageW / 2, 304, { align: 'center' })

  doc.setFontSize(9)
  doc.setTextColor(140)
  doc.text(
    'Generated client-side. Final rates and quantities must be verified before procurement.',
    pageW / 2, pageH - 80,
    { align: 'center', maxWidth: pageW - 120 },
  )
  doc.setTextColor(0)

  // ── Per-bucket tables ───────────────────────────────────────────────────
  const subtotals = []

  for (const bucket of SHEET_BUCKETS) {
    const bucketLs = bucketLines(bucket, grouped)
    if (bucketLs.length === 0) continue
    const multi = bucketIsMulti(bucket)

    doc.addPage()
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text(bucket.name, 40, 50)
    doc.setFont('helvetica', 'normal')

    // Build table body. Multi-bucket adds a System column at index 1.
    const body = bucketLs.map(l => multi
      ? [
          bucketSystemLabel(bucket, l.category),
          l.label,
          fmtPdfQty(l, displayMode),
          l.unit || '',
          fmtRate(rates ? rates[l.rateKey] : '', l.isPer1000),
          fmtRs(l.cost),
        ]
      : [
          l.label,
          fmtPdfQty(l, displayMode),
          l.unit || '',
          fmtRate(rates ? rates[l.rateKey] : '', l.isPer1000),
          fmtRs(l.cost),
        ]
    )

    const catSub  = bucketLs.reduce((s, l) => s + (l.cost ?? 0), 0)
    const hasCost = bucketLs.some(l => l.cost !== null)
    subtotals.push({ label: bucket.name, sub: hasCost ? catSub : null, count: bucketLs.length })

    const head = multi
      ? [['System', 'Item', 'Qty', 'Unit', 'Rate (Rs.)', 'Amount (Rs.)']]
      : [['Item', 'Qty', 'Unit', 'Rate (Rs.)', 'Amount (Rs.)']]

    // Subtotal foot — colSpan covers all columns except the Amount column.
    const footColSpan = multi ? 5 : 4
    const foot = hasCost ? [[
      { content: 'Subtotal', colSpan: footColSpan, styles: { halign: 'right', fontStyle: 'bold' } },
      { content: fmtRs(catSub), styles: { fontStyle: 'bold' } },
    ]] : undefined

    // Column styles — shifted +1 in multi mode for the leading System column.
    const columnStyles = multi
      ? {
          0: { halign: 'left',  cellWidth: 70 },   // System
          1: { cellWidth: 200 },                   // Item
          2: { halign: 'right', cellWidth: 60 },   // Qty
          3: { halign: 'left',  cellWidth: 40 },   // Unit
          4: { halign: 'right', cellWidth: 80 },   // Rate
          5: { halign: 'right', cellWidth: 80 },   // Amount
        }
      : {
          0: { cellWidth: 240 },
          1: { halign: 'right', cellWidth: 60 },
          2: { halign: 'left',  cellWidth: 40 },
          3: { halign: 'right', cellWidth: 90 },
          4: { halign: 'right', cellWidth: 90 },
        }

    autoTable(doc, {
      startY: 70,
      head,
      body,
      foot,
      margin: { left: 40, right: 40, bottom: 40 },
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [50, 50, 50], textColor: 255 },
      columnStyles,
    })
  }

  // ── Summary page ─────────────────────────────────────────────────────────
  doc.addPage()
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('Summary', 40, 50)
  doc.setFont('helvetica', 'normal')

  const sumBody = subtotals.map(s => [s.label, String(s.count), fmtRs(s.sub)])
  const hasAnyCost = grandTot !== null

  autoTable(doc, {
    startY: 70,
    head:   [['Category', 'Lines', 'Subtotal (Rs.)']],
    body:   sumBody,
    foot:   hasAnyCost ? [[
      { content: 'GRAND TOTAL', colSpan: 2, styles: { halign: 'right', fontStyle: 'bold', fillColor: [230, 230, 230] } },
      { content: fmtRs(grandTot), styles: { fontStyle: 'bold', fillColor: [230, 230, 230] } },
    ]] : undefined,
    margin: { left: 40, right: 40, bottom: 40 },
    styles: { fontSize: 10, cellPadding: 5 },
    headStyles: { fillColor: [50, 50, 50], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 280 },
      1: { halign: 'right', cellWidth: 80 },
      2: { halign: 'right', cellWidth: 140 },
    },
  })

  // ── Footers on every page ───────────────────────────────────────────────
  const total = doc.internal.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    drawFooter(doc, i, total)
  }

  doc.save(`boq-${safeFile(projectName)}-${todayStamp()}.pdf`)
}
