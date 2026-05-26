// Canonical presentation model (Addition 1).
//
// Single object consumed by BOTH Excel and PDF exporters. Neither
// exporter does independent math — they only render the model. This
// prevents "Excel total ≠ PDF total" drift forever.
//
// Pipeline:
//   getBoqLines(state, rates)
//     → computeBoqPresentationModel(lines, rates, state)
//     → exportBoqExcel / exportBoqPdf
//
// Model shape:
//   {
//     projectMeta,           // header (project title / owner / location / preparedBy / signatures)
//     scopeOfWork,           // auto-stats (floor count, built-up area, room counts, opening counts)
//     buckets: [             // grouped per SHEET_BUCKETS registry
//       { name, isMulti, systemColumnLabel,
//         lines: [{ ...line, contingencyPct, qtyTotal, amount }],
//         subtotal },
//     ],
//     contingencySummary,    // per-category effective %, displayMode
//     projectCosts,          // labor + supervision + GST block (Gap 8)
//     grandTotal,            // SUM(line.amount) — the single source for both exporters
//     presentationVersion,
//     generatedAt,
//   }
//
// Every line carries:
//   - line.qty           — base qty (unchanged from getBoqLines)
//   - line.contingencyPct — resolved % (0 if excluded)
//   - line.qtyTotal      — qty × (1 + pct/100)
//   - line.amount        — qtyTotal × rate (null if no rate)

import { SHEET_BUCKETS, bucketLines, bucketIsMulti, bucketSystemLabel } from '../export/_buckets.js'
import { resolveContingencyPctForLine, resolveContingencyDefaults } from './_contingencyResolver.js'
import { computeScopeOfWork } from './_scopeOfWork.js'
import { computeProjectCosts, DEFAULT_PROJECT_COSTS } from './projectCosts.js'
import { safeR2 as r2 } from '../lib/numbers.js'

export const PRESENTATION_VERSION = '2026-05-26-V1'

function parseRate(rateStr) {
  if (rateStr === undefined || rateStr === null || rateStr === '') return null
  const r = parseFloat(rateStr)
  if (Number.isNaN(r) || r <= 0) return null
  return r
}

// Compute amount for a line given a rate + contingency-adjusted qtyTotal.
// `isPer1000` divides qty by 1000 first (brick rates are per-1000).
function _amount(qtyTotal, rate, isPer1000) {
  if (rate === null || rate === undefined) return null
  return isPer1000 ? (qtyTotal / 1000) * rate : qtyTotal * rate
}

// Decorate every line with contingencyPct / qtyTotal / amount derived
// against the live state + rates. Pure: produces a new array, doesn't
// mutate input.
function _decorateLines(lines, rates, state) {
  return lines.map(line => {
    const pct = resolveContingencyPctForLine(state, line)
    const qtyTotal = pct === 0 ? line.qty : line.qty * (1 + pct / 100)
    const rate = parseRate(rates?.[line.rateKey])
    const amount = _amount(qtyTotal, rate, line.isPer1000)
    return {
      ...line,
      contingencyPct: pct,
      qtyTotal:       r2(qtyTotal),
      rate,
      amount:         amount === null ? null : r2(amount),
    }
  })
}

// Group decorated lines by bucket order, computing per-bucket subtotals.
function _bucketize(decoratedLines) {
  // Build category→lines index once.
  const byCat = {}
  for (const l of decoratedLines) {
    if (!byCat[l.category]) byCat[l.category] = []
    byCat[l.category].push(l)
  }
  const out = []
  for (const bucket of SHEET_BUCKETS) {
    const lines = bucketLines(bucket, byCat)
    if (lines.length === 0) continue
    const isMulti = bucketIsMulti(bucket)
    const subtotal = r2(lines.reduce((s, l) => s + (l.amount ?? 0), 0))
    out.push({
      name:              bucket.name,
      isMulti,
      systemColumnLabel: isMulti ? 'System' : null,
      // Stamp the System column value once so exporters don't re-derive.
      lines: lines.map(l => ({
        ...l,
        systemColumn: isMulti ? bucketSystemLabel(bucket, l.category) : '',
      })),
      subtotal,
    })
  }
  return out
}

function _buildContingencySummary(decoratedLines, state) {
  const defaults = resolveContingencyDefaults(state)
  const perCategoryEffective = {}
  for (const l of decoratedLines) {
    if (!l.category) continue
    if (perCategoryEffective[l.category] !== undefined) continue
    perCategoryEffective[l.category] = l.contingencyPct ?? 0
  }
  return {
    defaultPercent:     defaults.defaultPercent,
    overrides:          defaults.overrides,
    excludedCategories: defaults.excludedCategories,
    displayMode:        defaults.displayMode,
    perCategoryEffective,
  }
}

function _readProjectMeta(state) {
  const meta = state?.projectSettings?.projectMeta ?? {}
  return {
    projectTitle: meta.projectTitle ?? '',
    ownerName:    meta.ownerName    ?? '',
    location:     meta.location     ?? '',
    preparedBy:   meta.preparedBy   ?? '',
    checkedBy:    meta.checkedBy    ?? '',
    approvedBy:   meta.approvedBy   ?? '',
    preparedDate: meta.preparedDate ?? null,
  }
}

function _readProjectCostsConfig(state) {
  return state?.projectSettings?.projectCosts ?? DEFAULT_PROJECT_COSTS
}

// Main entry point.
//   computeBoqPresentationModel(lines, rates, state, opts?)
// - lines:  output of getBoqLines(state, rates)
// - rates:  same rates object passed to getBoqLines
// - state:  the Zustand state (for projectMeta / contingency /
//           projectCosts / scopeOfWork)
// - opts:   { projectNameOverride? }  // exporter caller's option
export function computeBoqPresentationModel(lines, rates, state, opts = {}) {
  const decorated = _decorateLines(lines ?? [], rates ?? {}, state)
  const buckets   = _bucketize(decorated)

  // Materials subtotal = sum across every bucket subtotal. Single source of
  // truth — both exporters read this value, no resummation downstream.
  const materialSubtotal = r2(buckets.reduce((s, b) => s + (b.subtotal ?? 0), 0))

  const projectCostsConfig = _readProjectCostsConfig(state)
  const projectCosts       = computeProjectCosts(materialSubtotal, projectCostsConfig)
  const contingencySummary = _buildContingencySummary(decorated, state)

  // Override projectMeta.projectTitle if the exporter caller passed a
  // projectNameOverride (used today by autosave name → file name path).
  const projectMeta = _readProjectMeta(state)
  if (opts.projectNameOverride && !projectMeta.projectTitle) {
    projectMeta.projectTitle = opts.projectNameOverride
  }

  return {
    projectMeta,
    scopeOfWork:        computeScopeOfWork(state),
    buckets,
    contingencySummary,
    projectCosts,
    materialSubtotal,
    grandTotal:         projectCosts.grandTotal,
    presentationVersion: PRESENTATION_VERSION,
    generatedAt:        Date.now(),
  }
}
