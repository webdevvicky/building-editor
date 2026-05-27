// Validation rule registry — Arch 4 Phase 3.
//
// Versioned + scoped + dismissable rule definition layer that wraps
// the existing engine.js. Rules declare:
//   - id, version, order — deterministic ordering
//   - severity, category — display semantics (existing)
//   - scope (C7)         — discipline-specific run filter
//   - affectedBy         — state slices that invalidate the rule
//                          (for future incremental mode via Arch 3 DAG)
//   - dismissable        — whether issues can be user-suppressed
//   - check(state)       — pure function returning { ok, issues }
//
// Scope taxonomy (Correction 7):
//   'geometry'         — basic shape (closed polygons, no zero-length walls)
//   'structural'       — load-bearing relationships
//   'mep'              — discipline rules
//   'boq'              — quantity sanity
//   'export'           — pre-export validity (IFC GlobalId etc.)
//   'constructability' — buildability + code compliance

export const VALIDATION_SCOPE = Object.freeze({
  GEOMETRY:         'geometry',
  STRUCTURAL:       'structural',
  MEP:              'mep',
  BOQ:              'boq',
  EXPORT:           'export',
  CONSTRUCTABILITY: 'constructability',
})

export const VALIDATION_SCOPES_ORDERED = Object.freeze([
  VALIDATION_SCOPE.GEOMETRY,
  VALIDATION_SCOPE.STRUCTURAL,
  VALIDATION_SCOPE.MEP,
  VALIDATION_SCOPE.BOQ,
  VALIDATION_SCOPE.EXPORT,
  VALIDATION_SCOPE.CONSTRUCTABILITY,
])

export function isValidValidationScope(s) {
  return VALIDATION_SCOPES_ORDERED.includes(s)
}

// Compose a rule's stable issue key (used for dismissal lookup).
// Format: `${ruleId}:${ruleVersion}:${entityType}:${ifcGlobalId|entityId|'_'}`
//
// C8 (ID exposure): prefer ifcGlobalId when entity is provided. Falls
// back to entityId (internal id) for cases where the issue isn't tied
// to a specific entity (e.g. project-wide BOQ sanity checks).
export function buildIssueKey(ruleId, ruleVersion, issue) {
  const type = issue.entityType ?? '_'
  const id   = issue.ifcGlobalId ?? issue.entityId ?? '_'
  return `${ruleId}:${ruleVersion}:${type}:${id}`
}

// Sort rules deterministically: (scope, order, id).
// Used by engine.js so runValidation output is byte-stable across runs.
export function sortRulesForRun(rules) {
  return [...rules].sort((a, b) => {
    if (a.scope !== b.scope) {
      return VALIDATION_SCOPES_ORDERED.indexOf(a.scope) -
             VALIDATION_SCOPES_ORDERED.indexOf(b.scope)
    }
    if (a.order !== b.order) return (a.order ?? 999) - (b.order ?? 999)
    return a.id.localeCompare(b.id)
  })
}

// Filter rules by requested scope set. Used by selective runValidation
// (e.g. IFC export only runs `'export'` scope rules).
export function filterRulesByScope(rules, scopes) {
  if (!scopes || !scopes.length) return rules
  const allow = new Set(scopes)
  return rules.filter(r => allow.has(r.scope))
}

// Read a project's dismissals map (handles missing projectSettings +
// missing validation subtree gracefully).
export function getDismissals(state) {
  return state?.projectSettings?.validation?.dismissals ?? {}
}

// True if the issue is dismissed for the current project.
export function isIssueDismissed(state, ruleId, ruleVersion, issue) {
  const dismissals = getDismissals(state)
  const key = buildIssueKey(ruleId, ruleVersion, issue)
  const entry = dismissals[key]
  if (!entry) return false
  // Expired dismissals don't suppress.
  if (entry.expiresAt && entry.expiresAt < Date.now()) return false
  return true
}

// Build a dismissal record (caller stamps it into projectSettings).
// `severity: 'error'` rules are non-dismissable by default — caller
// should check rule.dismissable before invoking this helper.
export function buildDismissal({ reason, dismissedBy, expiresAt }) {
  return Object.freeze({
    reason:      reason ?? '',
    dismissedBy: dismissedBy ?? 'unknown',
    dismissedAt: Date.now(),
    expiresAt:   expiresAt ?? null,
  })
}

// Sanity check exposed for verify scripts.
export function assertRuleWellFormed(rule, label = rule?.id ?? 'unknown') {
  const errs = []
  if (!rule || typeof rule !== 'object') return [`${label}: not an object`]
  if (typeof rule.id !== 'string' || !rule.id)             errs.push(`${label}: missing id`)
  if (typeof rule.version !== 'number')                    errs.push(`${label}: version must be number`)
  if (typeof rule.order !== 'number')                      errs.push(`${label}: order must be number`)
  if (!isValidValidationScope(rule.scope))                 errs.push(`${label}: invalid scope "${rule.scope}"`)
  if (!Array.isArray(rule.affectedBy))                     errs.push(`${label}: affectedBy must be array`)
  if (typeof rule.dismissable !== 'boolean')               errs.push(`${label}: dismissable must be boolean`)
  if (typeof rule.check !== 'function')                    errs.push(`${label}: check must be function`)
  if (typeof rule.severity !== 'string' || !rule.severity) errs.push(`${label}: missing severity`)
  if (typeof rule.category !== 'string' || !rule.category) errs.push(`${label}: missing category`)
  return errs
}
