// Validation engine — runs rules against current state.
// Rules are pure: each receives state and returns ValidationResult[].
// No hard-blocking — these surface as warnings in the BOQ panel footer.
//
// Rule shape:
//   { id, severity, category, check(state) → { ok, issues: [{ entityType, entityId, message }] }, message }

import { floatingColumn } from './rules/floatingColumn.js'
import { slabNoEnclosure } from './rules/slabNoEnclosure.js'
import { beamNoSupport } from './rules/beamNoSupport.js'
import { staircaseDisconnected } from './rules/staircaseDisconnected.js'
import { footingNoColumn } from './rules/footingNoColumn.js'

export const RULES = [
  floatingColumn,
  slabNoEnclosure,
  beamNoSupport,
  staircaseDisconnected,
  footingNoColumn,
]

export const SEVERITY = {
  INFO:    'info',
  WARNING: 'warning',
  ERROR:   'error',
}

// Returns { issues: Issue[], byRule: { [ruleId]: Issue[] }, byCategory: { [cat]: Issue[] }, counts }
// Issue = { ruleId, severity, category, entityType, entityId, message }
//
// Two issue sources flow through this function:
//   1. State-inspection rules (RULES above) — pure functions that examine
//      the current entity graph and report structural violations.
//   2. Action-emitted events from state.validationEvents — transient issues
//      pushed by store actions when they reject an invalid operation
//      (e.g., splitWall on an off-floor wall). The store keeps a bounded
//      ring buffer; this engine simply surfaces what's there. No
//      console.warn / console.log anywhere — all signal flows through here.
export function runValidation(state) {
  const issues = []
  const byRule = {}
  const byCategory = {}

  const pushIssue = (issue) => {
    issues.push(issue)
    if (!byRule[issue.ruleId]) byRule[issue.ruleId] = []
    byRule[issue.ruleId].push(issue)
  }

  for (const rule of RULES) {
    const result = rule.check(state)
    if (result && Array.isArray(result.issues)) {
      for (const it of result.issues) {
        pushIssue({
          ruleId:     rule.id,
          severity:   rule.severity,
          category:   rule.category,
          entityType: it.entityType,
          entityId:   it.entityId,
          message:    it.message ?? rule.message,
        })
      }
    }
  }

  // Action-emitted events: pre-formed issue records with their own ruleId.
  for (const ev of (state.validationEvents ?? [])) {
    pushIssue({
      ruleId:     ev.ruleId,
      severity:   ev.severity ?? SEVERITY.WARNING,
      category:   ev.category ?? 'topology',
      entityType: ev.entityType ?? null,
      entityId:   ev.entityId ?? null,
      message:    ev.message ?? ev.ruleId,
    })
  }

  for (const issue of issues) {
    if (!byCategory[issue.category]) byCategory[issue.category] = []
    byCategory[issue.category].push(issue)
  }

  const counts = {
    total:    issues.length,
    errors:   issues.filter(i => i.severity === SEVERITY.ERROR).length,
    warnings: issues.filter(i => i.severity === SEVERITY.WARNING).length,
    info:     issues.filter(i => i.severity === SEVERITY.INFO).length,
  }

  return { issues, byRule, byCategory, counts }
}
