// Client-side PDF export of the BOQ.
//
// exportBoqPdf(state, rates, { projectName, preparedBy, unit | unitSystem })
//   → triggers browser download of `boq-${projectName}-${date}.pdf`.
//
// 2026-05-26 — rewritten to consume src/boq/presentationModel.js. The
// exporter does NO independent math; every number reads from the model
// so PDF ≡ Excel totals.
//
// Cover page = project metadata + scope of work + cost summary +
// signatures. One section per non-empty bucket. Summary page lists
// subtotals + grand total. Contingency displayMode toggles per-section
// table column shape (clean = Qty | Unit | Rate | Amount; detailed
// adds Qty (Base) | +% | Qty (Total) columns).
//
// jsPDF default font lacks U+20B9 — we use the ASCII prefix "Rs. ".

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
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

function fmtRs(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return ''
  return 'Rs. ' + Math.round(n).toLocaleString('en-IN')
}

function fmtPct(p) {
  if (!p) return ''
  return `+${p}%`
}

function fmtRate(rate, isPer1000) {
  if (rate === null || rate === undefined || rate === '') return ''
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

function drawCoverPage(doc, model, displayUnitSystem) {
  const m  = model.projectMeta
  const so = model.scopeOfWork
  const pc = model.projectCosts
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

  doc.setFontSize(10); doc.setTextColor(120)
  doc.text('BILL OF QUANTITIES', pageW / 2, 80, { align: 'center' })
  doc.setTextColor(0)
  doc.setFontSize(26); doc.setFont('helvetica', 'bold')
  doc.text(m.projectTitle || 'Untitled Project', pageW / 2, 120, { align: 'center', maxWidth: pageW - 80 })
  doc.setFont('helvetica', 'normal')

  // Project metadata block — left-aligned key/value list.
  let y = 170
  const colX = 80
  const valX = pageW / 2
  doc.setFontSize(10)
  const rows = [
    ['Owner',         m.ownerName || '-'],
    ['Location',      m.location  || '-'],
    ['Date prepared', m.preparedDate || todayStamp()],
    ['Unit system',   displayUnitSystem],
    ['Prepared by',   m.preparedBy || '-'],
    ['Checked by',    m.checkedBy  || '-'],
    ['Approved by',   m.approvedBy || '-'],
  ]
  for (const [k, v] of rows) {
    doc.setTextColor(100); doc.text(k, colX, y)
    doc.setTextColor(0);   doc.text(String(v), valX, y)
    y += 16
  }
  y += 12

  // Scope of work block.
  doc.setFont('helvetica', 'bold'); doc.text('Scope of work', colX, y); doc.setFont('helvetica', 'normal')
  y += 14
  const scope = [
    ['Floors',                  so.floorCount],
    ['Total built-up area',     `${so.totalBuiltUpAreaSft} Sft`],
    ...(so.plotAreaSft > 0 ? [['Plot area', `${so.plotAreaSft} Sft`]] : []),
    ['Doors',                   so.openingCounts.doors],
    ['Windows',                 so.openingCounts.windows],
    ['Ventilators',             so.openingCounts.ventilators],
    ['Walls (count)',           so.wallCount],
    ['Columns (count)',         so.columnCount],
  ]
  for (const [k, v] of scope) {
    doc.setTextColor(100); doc.text(k, colX, y)
    doc.setTextColor(0);   doc.text(String(v), valX, y)
    y += 14
  }
  y += 12

  // Project cost summary block.
  doc.setFont('helvetica', 'bold'); doc.text('Project cost summary', colX, y); doc.setFont('helvetica', 'normal')
  y += 14
  for (const row of pc.breakdown) {
    doc.setTextColor(100); doc.text(row.label, colX, y)
    doc.setTextColor(0);   doc.text(fmtRs(row.amount), valX, y)
    y += 14
  }
  y += 8
  doc.setFont('helvetica', 'bold')
  doc.text('GRAND TOTAL', colX, y)
  doc.text(fmtRs(pc.grandTotal), valX, y)
  doc.setFont('helvetica', 'normal')

  // Signature block — bottom of cover.
  doc.setFontSize(9); doc.setTextColor(100)
  const sigY = pageH - 130
  const colW = (pageW - 160) / 3
  ;['Prepared by', 'Checked by', 'Approved by'].forEach((lbl, i) => {
    const x = 80 + colW * i + colW / 2
    doc.text(lbl, x, sigY, { align: 'center' })
    doc.text(['preparedBy', 'checkedBy', 'approvedBy'][i] === 'preparedBy' ? (m.preparedBy || '-')
      : i === 1 ? (m.checkedBy || '-') : (m.approvedBy || '-'),
      x, sigY + 14, { align: 'center' })
    doc.text('_______________', x, sigY + 44, { align: 'center' })
    doc.text('Signature',       x, sigY + 56, { align: 'center' })
  })

  doc.setFontSize(8); doc.setTextColor(140)
  doc.text(
    'Generated client-side. Final rates and quantities must be verified before procurement.',
    pageW / 2, pageH - 70,
    { align: 'center', maxWidth: pageW - 120 },
  )
  doc.setTextColor(0)
}

export function exportBoqPdf(state, rates, opts = {}) {
  const projectName = opts.projectName || state?.projectSettings?.projectMeta?.projectTitle || 'Untitled'
  const displayMode = normalizeUnitMode(
    opts.unit ?? (opts.unitSystem === 'metric' ? 'm' : 'ft-in')
  )
  const unitSystem = opts.unitSystem || (displayMode === 'm' ? 'metric' : 'ft (Indian)')

  const lines = getBoqLines(state, rates || {})
  warnUnmappedCategories(lines.reduce((m, l) => {
    if (!m[l.category]) m[l.category] = []
    m[l.category].push(l)
    return m
  }, {}))

  const model = computeBoqPresentationModel(lines, rates || {}, state, { projectNameOverride: projectName })
  const detailed = model.contingencySummary.displayMode === 'detailed'

  const doc = new jsPDF({ unit: 'pt', format: 'a4' })

  // ── Cover page ──────────────────────────────────────────────────────────
  drawCoverPage(doc, model, unitSystem)

  // ── Per-bucket tables ───────────────────────────────────────────────────
  for (const bucket of model.buckets) {
    const multi = bucket.isMulti
    doc.addPage()
    doc.setFontSize(14); doc.setFont('helvetica', 'bold')
    doc.text(bucket.name, 40, 50)
    doc.setFont('helvetica', 'normal')

    const head = []
    if (multi) head.push('System')
    head.push('Item')
    if (detailed) { head.push('Qty (Base)'); head.push('+%'); head.push('Qty (Total)') }
    else          { head.push('Qty') }
    head.push('Unit'); head.push('Rate (Rs.)'); head.push('Amount (Rs.)')

    const body = bucket.lines.map(l => {
      const row = []
      if (multi) row.push(l.systemColumn ?? '')
      row.push(l.label)
      if (detailed) {
        row.push(String(l.qty))
        row.push(fmtPct(l.contingencyPct))
        row.push(formatQuantity(l.qtyTotal, l.unit, displayMode))
      } else {
        row.push(formatQuantity(l.qtyTotal, l.unit, displayMode))
      }
      row.push(l.unit || '')
      row.push(fmtRate(l.rate, l.isPer1000))
      row.push(fmtRs(l.amount))
      return row
    })

    const footColSpan = head.length - 1
    const foot = [[
      { content: 'Subtotal',           colSpan: footColSpan, styles: { halign: 'right', fontStyle: 'bold' } },
      { content: fmtRs(bucket.subtotal), styles: { fontStyle: 'bold' } },
    ]]

    autoTable(doc, {
      startY: 70,
      head:   [head],
      body,
      foot,
      margin: { left: 40, right: 40, bottom: 40 },
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [50, 50, 50], textColor: 255 },
    })
  }

  // ── Summary page (mirrors Excel Summary) ────────────────────────────────
  doc.addPage()
  doc.setFontSize(16); doc.setFont('helvetica', 'bold')
  doc.text('Summary', 40, 50)
  doc.setFont('helvetica', 'normal')

  const sumBody = model.buckets.map(b => [b.name, String(b.lines.length), fmtRs(b.subtotal)])

  autoTable(doc, {
    startY: 70,
    head:   [['Category', 'Lines', 'Subtotal (Rs.)']],
    body:   sumBody,
    foot:   [[
      { content: 'GRAND TOTAL', colSpan: 2, styles: { halign: 'right', fontStyle: 'bold', fillColor: [230, 230, 230] } },
      { content: fmtRs(model.grandTotal), styles: { fontStyle: 'bold', fillColor: [230, 230, 230] } },
    ]],
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

  return model.grandTotal   // returned for verify-script parity assertions
}
