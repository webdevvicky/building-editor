// Validation engine — runs rules against current state.
// Rules are pure: each receives state and returns ValidationResult[].
// No hard-blocking — these surface as warnings in the BOQ panel footer.
//
// Rule shape (Arch 4 Phase 3 expanded):
//   {
//     id, version, order,
//     severity, category,
//     scope,                   // C7 — discipline scope for selective runs
//     affectedBy,              // state slices for incremental mode (Arch 3 DAG)
//     dismissable,             // true unless rule is severity 'error'
//     check(state) → { ok, issues: [{ entityType, entityId, message, severity?, category? }] },
//     message,
//   }

import { floatingColumn } from './rules/floatingColumn.js'
import { columnUnsupported } from './rules/columnUnsupported.js'
import { slabNoEnclosure } from './rules/slabNoEnclosure.js'
import { beamNoSupport } from './rules/beamNoSupport.js'
import { beamCircularRef } from './rules/beamCircularRef.js'
import { staircaseDisconnected } from './rules/staircaseDisconnected.js'
import { footingNoColumn } from './rules/footingNoColumn.js'
import { MEP_RULES } from '../mep/validation/index.js'
import {
  sortRulesForRun, filterRulesByScope,
  isIssueDismissed, buildIssueKey,
  VALIDATION_SCOPE,
} from './registry.js'

export const RULES = [
  floatingColumn,
  columnUnsupported,
  slabNoEnclosure,
  beamNoSupport,
  beamCircularRef,
  staircaseDisconnected,
  footingNoColumn,
  ...MEP_RULES,
]

export const SEVERITY = {
  INFO:    'info',
  WARNING: 'warning',
  ERROR:   'error',
}

// Re-export the scope taxonomy + helpers so callers don't need a
// second import path.
export { VALIDATION_SCOPE, buildIssueKey } from './registry.js'

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
// runValidation(state, opts?) — pure read of the validation state.
//
// opts: { scopes?: string[], suppressDismissed?: boolean }
//   - scopes: array of VALIDATION_SCOPE values; only matching rules run.
//             Omit / empty → run every scope (legacy behavior).
//   - suppressDismissed: when true, issues with a matching dismissal in
//             projectSettings.validation.dismissals are excluded.
//             Default true.
//
// Returns:
//   { issues, byRule, byCategory, byScope, counts, dismissalsApplied }
//
// Determinism: rules run in (scope, order, id) order; output byte-stable
// across repeated calls.
export function runValidation(state, opts = {}) {
  const scopes            = opts.scopes ?? null
  const suppressDismissed = opts.suppressDismissed !== false   // default true

  const issues    = []
  const byRule    = {}
  const byCategory = {}
  const byScope   = {}
  let   dismissalsApplied = 0

  const pushIssue = (issue) => {
    issues.push(issue)
    if (!byRule[issue.ruleId]) byRule[issue.ruleId] = []
    byRule[issue.ruleId].push(issue)
  }

  // Stable rule ordering for byte-stable output (Arch 4 C7 + Phase 2 contract).
  const selectedRules = filterRulesByScope(sortRulesForRun(RULES), scopes)

  for (const rule of selectedRules) {
    const result = rule.check(state)
    if (!result || !Array.isArray(result.issues)) continue
    for (const it of result.issues) {
      const composed = {
        ruleId:      rule.id,
        ruleVersion: rule.version,
        scope:       rule.scope,
        severity:    it.severity ?? rule.severity,
        category:    it.category ?? rule.category,
        entityType:  it.entityType,
        entityId:    it.entityId,
        ifcGlobalId: it.ifcGlobalId,        // C8 — preferred dismissal key
        message:     it.message ?? rule.message,
        meta:        it.meta,
      }
      // Dismissals only apply to rules that declared dismissable. ERROR
      // severities are never suppressed regardless of dismissable.
      if (suppressDismissed && rule.dismissable && composed.severity !== SEVERITY.ERROR) {
        if (isIssueDismissed(state, rule.id, rule.version, composed)) {
          dismissalsApplied += 1
          continue
        }
      }
      pushIssue(composed)
    }
  }

  // Action-emitted events: pre-formed issue records pushed by store actions
  // that reject an invalid op (e.g., cross_floor_split_attempt). They have
  // no scope discriminator today — surface under 'geometry' by default.
  // Skip if a scope filter is active and excludes 'geometry'.
  const allowEvents = !scopes || scopes.includes(VALIDATION_SCOPE.GEOMETRY)
  if (allowEvents) {
    for (const ev of (state.validationEvents ?? [])) {
      pushIssue({
        ruleId:      ev.ruleId,
        ruleVersion: ev.ruleVersion ?? 1,
        scope:       ev.scope ?? VALIDATION_SCOPE.GEOMETRY,
        severity:    ev.severity ?? SEVERITY.WARNING,
        category:    ev.category ?? 'topology',
        entityType:  ev.entityType ?? null,
        entityId:    ev.entityId ?? null,
        ifcGlobalId: ev.ifcGlobalId ?? null,
        message:     ev.message ?? ev.ruleId,
      })
    }
  }

  for (const issue of issues) {
    if (!byCategory[issue.category]) byCategory[issue.category] = []
    byCategory[issue.category].push(issue)
    if (!byScope[issue.scope]) byScope[issue.scope] = []
    byScope[issue.scope].push(issue)
  }

  const counts = {
    total:    issues.length,
    errors:   issues.filter(i => i.severity === SEVERITY.ERROR).length,
    warnings: issues.filter(i => i.severity === SEVERITY.WARNING).length,
    info:     issues.filter(i => i.severity === SEVERITY.INFO).length,
  }

  return { issues, byRule, byCategory, byScope, counts, dismissalsApplied }
}
