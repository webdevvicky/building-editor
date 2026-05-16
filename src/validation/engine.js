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
export function runValidation(state) {
  const issues = []
  const byRule = {}
  const byCategory = {}

  for (const rule of RULES) {
    const result = rule.check(state)
    const ruleIssues = []
    if (result && Array.isArray(result.issues)) {
      for (const it of result.issues) {
        const issue = {
          ruleId:     rule.id,
          severity:   rule.severity,
          category:   rule.category,
          entityType: it.entityType,
          entityId:   it.entityId,
          message:    it.message ?? rule.message,
        }
        issues.push(issue)
        ruleIssues.push(issue)
      }
    }
    if (ruleIssues.length > 0) byRule[rule.id] = ruleIssues
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
