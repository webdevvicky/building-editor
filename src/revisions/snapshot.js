// Build a revision snapshot from current store state.
//
// A revision freezes:
//   - the full project payload (same shape as autosave.buildSnapshot)
//   - ratesByKey at this moment
//   - a BOQ summary (every BoqLine reduced to { id, label, category, unit,
//     qty, rateKey, isPer1000, cost }) so future diffs are pure-function
//     comparisons that don't need to boot a transient store
//   - a validation summary (counts + truncated issue list)
//   - app + schema version stamps
//
// Why a frozen summary? `getBoqLines(state, rates)` uses Zustand selectors
// that are closures over `get()` — they can't be invoked on a plain JSON
// snapshot. We capture the BOQ at creation time so the diff stays a pure
// array-to-array comparison. Trade-off: if BOQ formulas change in code
// later, old revisions still show their original numbers (historical truth).

import { getBoqLines, totalBoqCost } from '../boq/lines'
import { runValidation } from '../validation/engine'

export const APP_VERSION = '2.5.0'

// Trim a BoqLine to the fields a revision needs. `meta` is dropped because
// it can carry large nested objects (sourceEntityIds lists, etc.) — diffs
// compare by label / qty / cost / rateKey, never by meta.
function summarizeLine(line) {
  return {
    id:        line.id,
    label:     line.label,
    category:  line.category,
    unit:      line.unit,
    qty:       line.qty,
    rateKey:   line.rateKey,
    isPer1000: !!line.isPer1000,
    cost:      line.cost ?? null,
    floorId:   line.floorId ?? null,
  }
}

// Trim a validation issue: drop entityId (UUIDs change across redraws so
// they're noise in a diff) but keep ruleId/severity/entityType/message so
// the comparison can show "added 2 floating_column warnings".
function summarizeIssue(iss) {
  return {
    ruleId:     iss.ruleId,
    severity:   iss.severity,
    category:   iss.category,
    entityType: iss.entityType ?? null,
    message:    iss.message,
  }
}

// Pure: build the BOQ summary from any live store state (or a state-shape
// object exposing the same selectors). Used by both revision creation and
// by the diff panel when it needs to recompute against current state.
export function buildBoqSummary(state, ratesByKey) {
  const rates = ratesByKey || {}
  const lines = getBoqLines(state, rates)
  return {
    rates:     { ...rates },
    lines:     lines.map(summarizeLine),
    totalCost: totalBoqCost(lines),
  }
}

export function buildValidationSummary(state) {
  const v = runValidation(state)
  return {
    errors:   v.counts.errors,
    warnings: v.counts.warnings,
    info:     v.counts.info,
    total:    v.counts.total,
    issues:   v.issues.slice(0, 50).map(summarizeIssue),
  }
}

// Build the full revision record body (without id/projectId/createdAt —
// the manager adds those). Call this with `useStore.getState()` and the
// current ratesByKey.
//
// opts:
//   label       string  — required-ish; manager will fall back if empty
//   note        string  — free text
//   authorName  string  — free text or null
//   isAuto      bool    — true for "auto-saved before restore" records
//   parentId    string  — when isAuto, the rev that triggered this auto-save
export function buildRevisionSnapshot(state, ratesByKey, opts = {}) {
  const snapshot = {
    version:         7,
    nodes:           state.nodes,
    walls:           state.walls,
    rooms:           state.rooms,
    stamps:          state.stamps,
    columns:         state.columns,
    beams:           state.beams,
    slabs:           state.slabs,
    staircases:      state.staircases,
    foundations:     state.foundations,
    ratesByKey:      { ...(ratesByKey || {}) },
    projectSettings: state.projectSettings,
  }
  return {
    label:             (opts.label && String(opts.label).trim()) || 'Untitled revision',
    note:              (opts.note  && String(opts.note ).trim()) || '',
    authorName:        opts.authorName || null,
    isAuto:            !!opts.isAuto,
    parentId:          opts.parentId ?? null,
    appVersion:        APP_VERSION,
    snapshot,
    boqSummary:        buildBoqSummary(state, ratesByKey),
    validationSummary: buildValidationSummary(state),
  }
}

// Suggests the next "vN" label based on existing manual revisions. Returns
// 'v1' if list is empty. Skips auto-revisions when scanning for the next N.
export function suggestNextLabel(revisions) {
  let maxN = 0
  for (const r of revisions || []) {
    if (r.isAuto) continue
    const m = /^v(\d+)$/i.exec((r.label || '').trim())
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > maxN) maxN = n
    }
  }
  return `v${maxN + 1}`
}
