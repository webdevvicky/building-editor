// BBS export — Excel + PDF (BBS-5b, pulled forward 2026-05-29).
//
// THREE levels share ONE source: computeRebarGroups(state). Level 1 = per-bar
// detail rows (fabricator view). Level 2 = category × diameter abstract
// (procurement view, Karthick TOTAL format). Level 3 = this module serializing
// both to .xlsx (one detail sheet per category + a TOTAL sheet + Raw) and .pdf.
//
// buildBbsWorkbookModel() is PURE + Node-testable (no Date, no file I/O) — the
// download wrappers (exportBbsExcel / exportBbsPdf) add the SheetJS / jsPDF
// serialization on top. verify-bbs-export.mjs drives the pure builder.

import { computeRebarGroups } from '../bbs/index.js'
import { concreteByBbsCategory } from '../bbs/concrete.js'
import {
  BBS_CATEGORY_ORDER, BBS_CATEGORY_LABEL, getBarMarkPrefix,
} from '../bbs/types.js'
import { CATALOG_VERSION } from '../specs/cuttingLength.js'
import { safeR2 } from '../lib/numbers.js'

const MM_PER_FT = 304.8
const DIA_COLS = [8, 10, 12, 16, 20, 25, 32]

function round3(n) { return Math.round((Number(n) || 0) * 1000) / 1000 }
function mmToFt(mm) { return (Number(mm) || 0) / MM_PER_FT }

// members/barsEach split (mirrors the panel — inline footing buckets).
function membersAndBarsEach(g) {
  const fc = g?.meta?.footingCount
  if (typeof fc === 'number' && fc > 1 && g.count % fc === 0) {
    return { members: fc, barsEach: g.count / fc }
  }
  return { members: 1, barsEach: g.count }
}

// ── Pure model builder ───────────────────────────────────────────────────────
// Returns { meta, detailSheets:[{category,label,rows}], totalSheet, raw }.
export function buildBbsWorkbookModel(state, opts = {}) {
  const result = computeRebarGroups(state, opts.floorId ? { floorId: opts.floorId } : {})
  const groups = result.groups
  const byBbsCategory = result.totals.byBbsCategory
  const concrete = concreteByBbsCategory(state, byBbsCategory)

  // Group RebarGroups by abstract category, preserving canonical order.
  const byCat = new Map()
  for (const g of groups) {
    const cat = g.meta?.bbsCategory ?? 'OTHER'
    if (!byCat.has(cat)) byCat.set(cat, [])
    byCat.get(cat).push(g)
  }
  const orderedCats = [
    ...BBS_CATEGORY_ORDER.filter(c => byCat.has(c)),
    ...[...byCat.keys()].filter(c => !BBS_CATEGORY_ORDER.includes(c)),
  ]

  // ── Level 1 — per-bar detail rows, one sheet per category ──────────────────
  const detailSheets = orderedCats.map(cat => {
    const rows = byCat.get(cat).map(g => {
      const { members, barsEach } = membersAndBarsEach(g)
      const nd = g.nominalDimensions || {}
      const byDiaM = {}
      for (const d of DIA_COLS) byDiaM[d] = d === g.diaMm ? safeR2(g.totalLengthM) : 0
      return {
        mark: g.markId,
        member: BBS_CATEGORY_LABEL[cat] ?? g.elementType,
        elementId: g.elementId,
        structuralNo: members,
        barsEach,
        shapeCode: g.shapeCode,
        aFt: safeR2(mmToFt(nd.A)),
        bFt: safeR2(mmToFt(nd.B)),
        cFt: safeR2(mmToFt(nd.C)),
        lapFt: safeR2(mmToFt(g.meta?.lapLengthMm ?? g.meta?.anchorageMm ?? 0)),
        diaMm: g.diaMm,
        cuttingLenFt: safeR2(mmToFt(g.cuttingLengthMm)),
        nos: g.count,
        byDiaM,
        totalLengthM: safeR2(g.totalLengthM),
        weightKg: safeR2(g.totalWeightKg),
      }
    })
    return { category: cat, label: BBS_CATEGORY_LABEL[cat] ?? cat, rows }
  })

  // ── Level 2 — abstract: category × diameter (kg) + concrete + ratio ────────
  const totalRows = orderedCats.map(cat => {
    const ent = byBbsCategory[cat] ?? { totalKg: 0, byDiaKg: {} }
    const byDiaKg = {}
    for (const d of DIA_COLS) byDiaKg[d] = safeR2(ent.byDiaKg?.[d] ?? 0)
    const m3 = round3(concrete[cat] ?? 0)
    const totalKg = safeR2(ent.totalKg ?? 0)
    return {
      category: cat,
      label: BBS_CATEGORY_LABEL[cat] ?? cat,
      byDiaKg,
      totalKg,
      concreteM3: m3,
      kgPerM3: m3 > 0 ? safeR2(totalKg / m3) : null,
    }
  })
  const grandKg = safeR2(totalRows.reduce((a, r) => a + r.totalKg, 0))
  const grandM3 = round3(totalRows.reduce((a, r) => a + r.concreteM3, 0))
  const weightPer12mByDia = {}
  for (const d of DIA_COLS) weightPer12mByDia[d] = safeR2((result.standardBarLengthM ?? 12) * (d * d) / 162)

  const totalSheet = {
    diaCols: DIA_COLS,
    rows: totalRows,
    grandKg,
    grandM3,
    grandKgPerM3: grandM3 > 0 ? safeR2(grandKg / grandM3) : null,
    weightPerBarByDia: weightPer12mByDia,
    standardBarLengthM: result.standardBarLengthM ?? 12,
  }

  return {
    meta: {
      projectTitle: state.projectSettings?.projectMeta?.projectTitle || 'Untitled project',
      catalogVersion: CATALOG_VERSION,
      floorScope: opts.floorId ?? 'ALL',
      generatedAt: opts.generatedAt ?? null,
    },
    detailSheets,
    totalSheet,
    raw: groups,
  }
}

// ── Excel ─────────────────────────────────────────────────────────────────────
function _safeFile(name) {
  return String(name || 'project').replace(/[^a-z0-9_\-]+/gi, '_').slice(0, 50) || 'project'
}
function _todayStamp() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export async function exportBbsExcel(state, opts = {}) {
  const XLSX = await import('xlsx')
  const model = buildBbsWorkbookModel(state, opts)
  const wb = XLSX.utils.book_new()

  // TOTAL sheet first (the procurement view).
  XLSX.utils.book_append_sheet(wb, _totalSheetAoa(XLSX, model.totalSheet, model.meta), 'TOTAL')

  // One detail sheet per category.
  const used = new Set(['TOTAL'])
  for (const sheet of model.detailSheets) {
    let name = (getBarMarkPrefix(sheet.category) + '-' + sheet.label).slice(0, 28)
    let n = name; let i = 2
    while (used.has(n)) { n = `${name} ${i++}` }
    used.add(n)
    XLSX.utils.book_append_sheet(wb, _detailSheetAoa(XLSX, sheet, model.totalSheet.diaCols), n)
  }

  XLSX.writeFile(wb, `bbs-${_safeFile(model.meta.projectTitle)}-${_todayStamp()}.xlsx`)
}

function _detailSheetAoa(XLSX, sheet, diaCols) {
  const head = ['Mark', 'Member', 'Struct No', 'Bars Each', 'Shape', 'a (ft)', 'b (ft)', 'c (ft)',
    'Lap (ft)', 'Dia (mm)', 'Cut Len (ft)', 'Nos', ...diaCols.map(d => `${d}mm (m)`), 'Wt (kg)']
  const aoa = [[sheet.label], head]
  for (const r of sheet.rows) {
    aoa.push([r.mark, r.member, r.structuralNo, r.barsEach, r.shapeCode, r.aFt, r.bFt, r.cFt,
      r.lapFt, r.diaMm, r.cuttingLenFt, r.nos, ...diaCols.map(d => r.byDiaM[d] || ''), r.weightKg])
  }
  return XLSX.utils.aoa_to_sheet(aoa)
}

function _totalSheetAoa(XLSX, total, meta) {
  const aoa = [
    [`BAR BENDING SCHEDULE — ABSTRACT`],
    [meta.projectTitle],
    [`Catalog: IS 2502 v${meta.catalogVersion}   Floor: ${meta.floorScope}`],
    [],
    ['S.No', 'Member', ...total.diaCols.map(d => `${d}mm (kg)`), 'Total (kg)', 'Concrete (m³)', 'Steel kg/m³'],
  ]
  total.rows.forEach((r, i) => {
    aoa.push([i + 1, r.label, ...total.diaCols.map(d => r.byDiaKg[d] || 0),
      r.totalKg, r.concreteM3, r.kgPerM3 ?? '—'])
  })
  aoa.push(['', 'GRAND TOTAL', ...total.diaCols.map(() => ''), total.grandKg, total.grandM3, total.grandKgPerM3 ?? '—'])
  aoa.push(['', `Weight of 1 bar @ ${total.standardBarLengthM} m (kg)`,
    ...total.diaCols.map(d => total.weightPerBarByDia[d])])
  return XLSX.utils.aoa_to_sheet(aoa)
}

// ── PDF ─────────────────────────────────────────────────────────────────────
export async function exportBbsPdf(state, opts = {}) {
  const { default: jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const model = buildBbsWorkbookModel(state, opts)
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })

  // Cover.
  doc.setFontSize(10); doc.setTextColor(120)
  doc.text('BAR BENDING SCHEDULE', doc.internal.pageSize.getWidth() / 2, 70, { align: 'center' })
  doc.setTextColor(0); doc.setFontSize(20); doc.setFont('helvetica', 'bold')
  doc.text(model.meta.projectTitle, doc.internal.pageSize.getWidth() / 2, 100, { align: 'center', maxWidth: 480 })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text(`Catalog: IS 2502 v${model.meta.catalogVersion}   Floor: ${model.meta.floorScope}`,
    doc.internal.pageSize.getWidth() / 2, 124, { align: 'center' })

  // Abstract (Level 2).
  autoTable(doc, {
    startY: 150,
    head: [['S.No', 'Member', ...model.totalSheet.diaCols.map(d => `${d}`), 'Total kg', 'm³', 'kg/m³']],
    body: model.totalSheet.rows.map((r, i) => [i + 1, r.label,
      ...model.totalSheet.diaCols.map(d => r.byDiaKg[d] || '·'), r.totalKg, r.concreteM3, r.kgPerM3 ?? '—']),
    foot: [['', 'GRAND TOTAL', ...model.totalSheet.diaCols.map(() => ''),
      model.totalSheet.grandKg, model.totalSheet.grandM3, model.totalSheet.grandKgPerM3 ?? '—']],
    styles: { fontSize: 7, cellPadding: 2 }, headStyles: { fillColor: [50, 50, 50], textColor: 255 },
    margin: { left: 30, right: 30 },
  })

  // Per-category detail pages (Level 1).
  for (const sheet of model.detailSheets) {
    doc.addPage()
    doc.setFontSize(12); doc.setFont('helvetica', 'bold')
    doc.text(sheet.label, 30, 40); doc.setFont('helvetica', 'normal')
    autoTable(doc, {
      startY: 54,
      head: [['Mark', 'Shape', 'a', 'b', 'c', 'Lap', 'Dia', 'Cut(ft)', 'Nos', 'Len(m)', 'Wt(kg)']],
      body: sheet.rows.map(r => [r.mark, r.shapeCode, r.aFt, r.bFt, r.cFt, r.lapFt,
        r.diaMm, r.cuttingLenFt, r.nos, r.totalLengthM, r.weightKg]),
      styles: { fontSize: 7, cellPadding: 2 }, headStyles: { fillColor: [50, 50, 50], textColor: 255 },
      margin: { left: 30, right: 30 },
    })
  }

  const total = doc.internal.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120)
    doc.text('Preliminary BBS — for procurement estimation', 30, doc.internal.pageSize.getHeight() - 18)
    doc.text(`Page ${i} of ${total}`, doc.internal.pageSize.getWidth() - 30, doc.internal.pageSize.getHeight() - 18, { align: 'right' })
    doc.setTextColor(0)
  }
  doc.save(`bbs-${_safeFile(model.meta.projectTitle)}-${_todayStamp()}.pdf`)
}
