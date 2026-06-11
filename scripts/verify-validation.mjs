// scripts/verify-validation.mjs
//
// Arch 4 Phase 3 — formalized validation engine.
//
// Assertions:
//   1. Every rule declares version + order + scope + affectedBy + dismissable
//   2. sortRulesForRun: deterministic ordering (scope, order, id)
//   3. filterRulesByScope: selective runs work
//   4. runValidation: produces byScope grouping
//   5. Issue keys (buildIssueKey) use ifcGlobalId when present (C8)
//   6. Dismissals suppress matching issues
//   7. Dismissals do NOT suppress ERROR-severity issues
//   8. Dismissal version tagging: ruleVersion bump invalidates old dismissals
//   9. Deterministic output: identical state → identical issue order

import { runValidation, RULES, SEVERITY } from '../src/validation/engine.js'
import {
  VALIDATION_SCOPE, VALIDATION_SCOPES_ORDERED, isValidValidationScope,
  buildIssueKey, sortRulesForRun, filterRulesByScope,
  buildDismissal, isIssueDismissed, getDismissals,
  assertRuleWellFormed,
} from '../src/validation/registry.js'
import { useStore } from '../src/store.js'

const passed = []
const failed = []
function check(name, cond, info) {
  (cond ? passed : failed).push(`${name}${info ? '  (' + info + ')' : ''}`)
}

const s = useStore.getState

// ── 1. Scope taxonomy (C7) ─────────────────────────────────────────────
check('VALIDATION_SCOPE is frozen', Object.isFrozen(VALIDATION_SCOPE))
check('VALIDATION_SCOPES_ORDERED has 6 entries', VALIDATION_SCOPES_ORDERED.length === 6)
const expectedScopes = ['geometry', 'structural', 'mep', 'boq', 'export', 'constructability']
check('VALIDATION_SCOPES_ORDERED matches taxonomy',
      expectedScopes.every(s => VALIDATION_SCOPES_ORDERED.includes(s)))
check('isValidValidationScope accepts known',   isValidValidationScope('structural'))
check('isValidValidationScope rejects unknown', !isValidValidationScope('bogus'))

// ── 2. Every rule well-formed ──────────────────────────────────────────
for (const rule of RULES) {
  const errs = assertRuleWellFormed(rule)
  check(`rule "${rule.id}" well-formed`, errs.length === 0,
        errs.length ? errs.join('; ') : '')
}
// All current rules use version=1; specific scope values.
const ruleById = Object.fromEntries(RULES.map(r => [r.id, r]))
check('floating_column scope=structural', ruleById['floating_column']?.scope === 'structural')
check('mep_clash_detected scope=mep',     ruleById['mep_clash_detected']?.scope === 'mep')
check('slab_no_enclosure dismissable=false (error severity)',
      ruleById['slab_no_enclosure']?.dismissable === false)
check('floating_column dismissable=true (warning)',
      ruleById['floating_column']?.dismissable === true)
check('column_unsupported scope=structural', ruleById['column_unsupported']?.scope === 'structural')
check('column_unsupported severity=warning', ruleById['column_unsupported']?.severity === 'warning')
check('column_unsupported dismissable=true', ruleById['column_unsupported']?.dismissable === true)

// ── 3. sortRulesForRun: deterministic ─────────────────────────────────
const sorted1 = sortRulesForRun(RULES)
const sorted2 = sortRulesForRun(RULES)
check('sortRulesForRun: deterministic',
      sorted1.map(r => r.id).join(',') === sorted2.map(r => r.id).join(','))
// Scope-grouped: structural rules come before mep rules.
const structuralIdx = sorted1.findIndex(r => r.scope === 'structural')
const mepIdx        = sorted1.findIndex(r => r.scope === 'mep')
check('sortRulesForRun: structural scope before mep scope',
      structuralIdx >= 0 && mepIdx >= 0 && structuralIdx < mepIdx)

// ── 4. filterRulesByScope: selective runs ──────────────────────────────
const onlyMep = filterRulesByScope(RULES, ['mep'])
check('filterRulesByScope mep: returns only mep rules',
      onlyMep.every(r => r.scope === 'mep') && onlyMep.length === 3)
const onlyStructural = filterRulesByScope(RULES, ['structural'])
check('filterRulesByScope structural: returns only structural rules',
      onlyStructural.every(r => r.scope === 'structural') && onlyStructural.length === 7)
const allScopes = filterRulesByScope(RULES, [])
check('filterRulesByScope empty: returns all rules',
      allScopes.length === RULES.length)

// ── 5. buildIssueKey: prefers ifcGlobalId (C8) ─────────────────────────
const issueWithIfc = { entityType: 'wall', entityId: 'wall-internal-id', ifcGlobalId: 'IFC-22-CHAR-ID-AAAAAA' }
const key1 = buildIssueKey('foo', 1, issueWithIfc)
check('buildIssueKey: uses ifcGlobalId when present',
      key1 === 'foo:1:wall:IFC-22-CHAR-ID-AAAAAA')
const issueNoIfc = { entityType: 'wall', entityId: 'fallback-id' }
const key2 = buildIssueKey('foo', 1, issueNoIfc)
check('buildIssueKey: falls back to entityId when no ifcGlobalId',
      key2 === 'foo:1:wall:fallback-id')

// ── 6. runValidation: produces byScope grouping ────────────────────────
s().loadProject({})
const FT = 12
// Build a project that triggers floating_column rule
const nA = s().getOrCreateNode(0, 0)
const nB = s().getOrCreateNode(20 * FT, 0)
const nC = s().getOrCreateNode(20 * FT, 15 * FT)
const nD = s().getOrCreateNode(0, 15 * FT)
s().addWall(nA, nB); s().addWall(nB, nC); s().addWall(nC, nD); s().addWall(nD, nA)
{
  const ids = Object.values(s().walls).map(w => w.id)
  ids.forEach(id => s().togglePendingWall(id))
  s().saveRoom('Living', 'LIVING')
}
// Add a column far away from any wall — should trigger floating_column.
s().addColumn(1000 * FT, 1000 * FT, 'C1')

const result1 = runValidation(s())
check('runValidation: returns byScope', !!result1.byScope)
check('runValidation: returns counts', typeof result1.counts.total === 'number')
check('runValidation: floating_column issue detected',
      result1.byRule['floating_column']?.length >= 1,
      `byRule.floating_column.length=${result1.byRule['floating_column']?.length}`)

// ── 7. Selective runs ──────────────────────────────────────────────────
const onlyMepResult = runValidation(s(), { scopes: ['mep'] })
check('runValidation(scopes=mep): no structural issues',
      !onlyMepResult.byRule['floating_column'])
const onlyStructResult = runValidation(s(), { scopes: ['structural'] })
check('runValidation(scopes=structural): includes floating_column',
      onlyStructResult.byRule['floating_column']?.length >= 1)

// ── 8. Dismissal suppression ───────────────────────────────────────────
// Take a column issue, dismiss it, re-run.
const colIssue = result1.byRule['floating_column'][0]
const colId = colIssue.entityId
const dismissalKey = buildIssueKey('floating_column', 1, colIssue)

const dismissal = buildDismissal({
  reason:      'standalone column for future canopy',
  dismissedBy: 'engineer-1',
})
s().setProjectSettings({
  validation: { dismissals: { [dismissalKey]: dismissal } },
})

const resultAfterDismiss = runValidation(s())
check('dismissal: suppresses the dismissed issue',
      !resultAfterDismiss.byRule['floating_column'] ||
      !resultAfterDismiss.byRule['floating_column'].some(i => i.entityId === colId),
      `still present: ${resultAfterDismiss.byRule['floating_column']?.length}`)
check('dismissal: reports dismissalsApplied count',
      resultAfterDismiss.dismissalsApplied >= 1,
      `got ${resultAfterDismiss.dismissalsApplied}`)

// suppressDismissed: false bypasses dismissal
const resultNoSuppress = runValidation(s(), { suppressDismissed: false })
check('runValidation(suppressDismissed=false): dismissed issue reappears',
      resultNoSuppress.byRule['floating_column']?.some(i => i.entityId === colId))

// ── 9. Dismissal version invalidation ──────────────────────────────────
// If a rule's version bumps, old dismissals (keyed on old version) should
// NOT suppress new-version issues.
const v2Key = buildIssueKey('floating_column', 2, colIssue)
check('dismissal v1 ≠ dismissal v2 key',
      v2Key !== dismissalKey)
// isIssueDismissed checks rule version, so passing v2 → no match
const dismissedV2 = isIssueDismissed(s(), 'floating_column', 2, colIssue)
check('dismissal does not survive ruleVersion bump',
      dismissedV2 === false)
const dismissedV1 = isIssueDismissed(s(), 'floating_column', 1, colIssue)
check('dismissal still active at original ruleVersion',
      dismissedV1 === true)

// ── 10. Expired dismissal does not suppress ────────────────────────────
const expiredDismissal = buildDismissal({
  reason:    'should expire',
  expiresAt: Date.now() - 1000,
})
s().setProjectSettings({
  validation: { dismissals: { [dismissalKey]: expiredDismissal } },
})
const resultExpired = runValidation(s())
check('dismissal: expired entry does not suppress',
      resultExpired.byRule['floating_column']?.some(i => i.entityId === colId))

// Clean up dismissals for downstream.
s().setProjectSettings({ validation: { dismissals: {} } })

// ── 11. ERROR-severity rules never dismissable ─────────────────────────
// slab_no_enclosure is ERROR severity. Even if user dismisses, it should
// still appear (rule.dismissable === false).
const slabRule = ruleById['slab_no_enclosure']
check('slab_no_enclosure severity is error', slabRule.severity === SEVERITY.ERROR)
check('slab_no_enclosure dismissable is false', slabRule.dismissable === false)

// ── 12. Deterministic ordering (byte-stable runs) ─────────────────────
const r1 = runValidation(s())
const r2 = runValidation(s())
check('runValidation: byte-stable issue ordering',
      r1.issues.map(i => `${i.ruleId}/${i.entityId}`).join(',') ===
      r2.issues.map(i => `${i.ruleId}/${i.entityId}`).join(','))

// ── 13. Issues carry ruleVersion + scope ───────────────────────────────
const firstIssue = r1.issues[0]
if (firstIssue) {
  check('issue carries ruleVersion', typeof firstIssue.ruleVersion === 'number')
  check('issue carries scope',       isValidValidationScope(firstIssue.scope))
}

console.log(`\nPASSED: ${passed.length}`)
for (const p of passed) console.log(`   ${p}`)
if (failed.length > 0) {
  console.log(`\nFAILED:`)
  for (const f of failed) console.log(`   ${f}`)
  process.exit(1)
}
console.log('\n✓ verify-validation passed.')
