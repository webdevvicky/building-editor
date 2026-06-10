// scripts/verify-beam-connections.mjs
//
// Beam connections — beam-to-beam / beam-on-wall / detached endpoints
// (Phase 1 kernel). Drives the REAL store actions + the canonical resolver.
//
// Sections:
//   A — Resolver: parametric BEAM / WALL / POINT endpoints
//   B — Cycle guard: cyclic BEAM refs resolve to null (no NaN)
//   C — Integrity: dangling beamId / wallId + beam-cycle issues
//   D — Validation: beam_no_support (v2) + beam_circular_ref (error)
//   E — Delete cascades: deleteBeam / deleteColumn / deleteWall detach to
//       a frozen POINT with detachedFrom provenance (undo restores)
//   F — BBS: secondary beam emits rebar with interior anchorage at the
//       beam-to-beam joint; FK descriptors present; integrity valid
//
// Run:
//   node --experimental-loader ./scripts/resolver-hook.mjs scripts/verify-beam-connections.mjs

import { useStore } from '../src/store.js'
import { resolveBeamEndpoint, getBeamLengthFt } from '../src/topology/beams.js'
import { verifyIntegrity, FK_DESCRIPTORS } from '../src/schema/integrity.js'
import { beamNoSupport } from '../src/validation/rules/beamNoSupport.js'
import { beamCircularRef } from '../src/validation/rules/beamCircularRef.js'
import { computeRebarGroups } from '../src/bbs/index.js'

const s = useStore.getState
let pass = 0, fail = 0
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`) }
  else      { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`) }
}
function header(t) { console.log('\n' + '─'.repeat(70) + '\n' + t.toUpperCase() + '\n' + '─'.repeat(70)) }
const near = (a, b, eps = 1e-6) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= eps
function reset() {
  s().loadProject({
    nodes: {}, walls: {}, rooms: {}, stamps: {}, columns: {}, beams: {},
    slabs: {}, staircases: {}, foundations: {}, projectSettings: undefined, unit: 'inch',
  })
}
// A 2-beam cycle injected directly into state.beams.
const CYCLE_BEAMS = {
  BX: { id: 'BX', ifcGlobalId: 'AAAAAAAAAAAAAAAAAAAAAA', level: 'roof', source: 'EXPLICIT', floorId: 'F1', reinforcementSpecId: null, sourceWallId: null, meta: null,
        endpoints: { from: { type: 'POINT', x: 0, y: 0 }, to: { type: 'BEAM', beamId: 'BY', t: 0.5 } } },
  BY: { id: 'BY', ifcGlobalId: 'BBBBBBBBBBBBBBBBBBBBBB', level: 'roof', source: 'EXPLICIT', floorId: 'F1', reinforcementSpecId: null, sourceWallId: null, meta: null,
        endpoints: { from: { type: 'BEAM', beamId: 'BX', t: 0.5 }, to: { type: 'POINT', x: 100, y: 0 } } },
}

// ── Section A — Resolver ───────────────────────────────────────────────
header('Section A — Resolver: parametric BEAM / WALL / POINT')
{
  reset()
  const A = s().addColumn(0, 0)
  const B = s().addColumn(120, 0)
  const P = s().addBeam(A, B, 'roof')                       // primary, COLUMN-COLUMN
  const C = s().addColumn(60, 120)
  const Sid = s().addBeamWithEndpoints({ type: 'COLUMN', columnId: C }, { type: 'BEAM', beamId: P, t: 0.5 }, 'roof')
  const S = s().beams[Sid]
  const toPos = resolveBeamEndpoint(s(), S.endpoints.to)
  ok('A.1 BEAM endpoint resolves to t=0.5 midpoint of primary (60,0)',
     toPos && near(toPos.x, 60) && near(toPos.y, 0), JSON.stringify(toPos))
  ok('A.2 secondary length = 10ft', near(getBeamLengthFt(s(), S), 10), String(getBeamLengthFt(s(), S)))

  // WALL endpoint — beam bears on a wall at t=0.5.
  const w1 = s().getOrCreateNode(0, 200)
  const w2 = s().getOrCreateNode(120, 200)
  s().addWall(w1, w2)
  const wallId = Object.values(s().walls)[0].id
  const Wid = s().addBeamWithEndpoints({ type: 'WALL', wallId, t: 0.5 }, { type: 'POINT', x: 60, y: 300 }, 'roof')
  const wPos = resolveBeamEndpoint(s(), s().beams[Wid].endpoints.from)
  ok('A.3 WALL endpoint resolves to wall midpoint (60,200)',
     wPos && near(wPos.x, 60) && near(wPos.y, 200), JSON.stringify(wPos))

  // POINT (detached) — resolves to its frozen x,y; detachedFrom is provenance only.
  const ptPos = resolveBeamEndpoint(s(), { type: 'POINT', x: 42, y: 7, detachedFrom: { type: 'BEAM', beamId: 'gone' } })
  ok('A.4 detached POINT resolves to its frozen x,y', ptPos && near(ptPos.x, 42) && near(ptPos.y, 7))

  // Unknown type — null, not {x: undefined}.
  ok('A.5 unknown endpoint type → null (no NaN)', resolveBeamEndpoint(s(), { type: 'NONSENSE' }) === null)
}

// ── Section B — Cycle guard ────────────────────────────────────────────
header('Section B — Cycle guard: cyclic BEAM refs resolve to null')
{
  reset()
  useStore.setState({ beams: { ...CYCLE_BEAMS } })
  const rx = resolveBeamEndpoint(s(), s().beams.BX.endpoints.to)
  ok('B.1 cyclic BEAM endpoint resolves to null (no NaN)', rx === null, JSON.stringify(rx))
  ok('B.2 getBeamLengthFt on cyclic beam = 0 (safe)', getBeamLengthFt(s(), s().beams.BX) === 0)
}

// ── Section C — Integrity ──────────────────────────────────────────────
header('Section C — Integrity: dangling refs + cycles')
{
  reset()
  useStore.setState({
    beams: {
      BD: { id: 'BD', ifcGlobalId: 'CCCCCCCCCCCCCCCCCCCCCC', level: 'roof', source: 'EXPLICIT', floorId: 'F1', reinforcementSpecId: null, sourceWallId: null, meta: null,
            endpoints: { from: { type: 'BEAM', beamId: 'MISSING', t: 0.5 }, to: { type: 'WALL', wallId: 'GHOST', t: 0.5 } } },
    },
  })
  const intg = verifyIntegrity(s())
  ok('C.1 integrity flags dangling beamId',
     intg.issues.some(i => i.field === 'endpoints.from.beamId' && i.missing === 'MISSING'))
  ok('C.2 integrity flags dangling wallId',
     intg.issues.some(i => i.field === 'endpoints.to.wallId' && i.missing === 'GHOST'))

  useStore.setState({ beams: { ...CYCLE_BEAMS } })
  const intg2 = verifyIntegrity(s())
  ok('C.3 integrity flags beam-cycle', intg2.issues.some(i => i.kind === 'beam-cycle'))
}

// ── Section D — Validation rules ───────────────────────────────────────
header('Section D — Validation: beam_no_support v2 + beam_circular_ref')
{
  reset()
  const ca = s().addColumn(0, 0), cb = s().addColumn(120, 0)
  s().addBeam(ca, cb, 'roof')
  ok('D.1 beam_no_support rule is version 2', beamNoSupport.version === 2)
  ok('D.2 column-column beam is supported (not flagged)', beamNoSupport.check(s()).ok)

  // A beam with a free POINT end + a dangling column end is unsupported.
  useStore.setState({
    beams: {
      BF: { id: 'BF', ifcGlobalId: 'DDDDDDDDDDDDDDDDDDDDDD', level: 'roof', source: 'EXPLICIT', floorId: 'F1', reinforcementSpecId: null, sourceWallId: null, meta: null,
            endpoints: { from: { type: 'COLUMN', columnId: 'nope' }, to: { type: 'POINT', x: 0, y: 0 } } },
    },
  })
  const r1 = beamNoSupport.check(s())
  ok('D.3 beam_no_support flags a free-POINT / dangling beam', !r1.ok && r1.issues.some(i => i.entityId === 'BF'))

  useStore.setState({ beams: { ...CYCLE_BEAMS } })
  const r3 = beamCircularRef.check(s())
  ok('D.4 beam_circular_ref flags the cycle', !r3.ok && r3.issues.length >= 2)
  ok('D.5 beam_circular_ref is an error + non-dismissable',
     beamCircularRef.severity === 'error' && beamCircularRef.dismissable === false)
}

// ── Section E — Delete cascades (detach + provenance + undo) ────────────
header('Section E — Delete cascades: detach to POINT + detachedFrom + undo')
{
  reset()
  const eA = s().addColumn(0, 0), eB = s().addColumn(120, 0)
  const eP = s().addBeam(eA, eB, 'roof')
  const eC = s().addColumn(60, 120)
  const eS = s().addBeamWithEndpoints({ type: 'COLUMN', columnId: eC }, { type: 'BEAM', beamId: eP, t: 0.5 }, 'roof')
  s().deleteBeam(eP)
  ok('E.1 deleting the primary does NOT delete the secondary', !!s().beams[eS])
  const det = s().beams[eS].endpoints.to
  ok('E.2 secondary BEAM endpoint detached to POINT at the joint (60,0)',
     det.type === 'POINT' && near(det.x, 60) && near(det.y, 0))
  ok('E.3 detachedFrom provenance preserved', det.detachedFrom?.type === 'BEAM' && det.detachedFrom?.beamId === eP)
  ok('E.4 detach emits a beam_endpoint_detached validationEvent',
     (s().validationEvents ?? []).some(e => e.ruleId === 'beam_endpoint_detached'))
  ok('E.5 primary beam removed', !s().beams[eP])
  s().undo()
  ok('E.6 undo restores primary + reconnects the secondary endpoint',
     !!s().beams[eP] && s().beams[eS]?.endpoints.to.type === 'BEAM')

  // deleteColumn → detach (not delete) the beam.
  reset()
  const fA = s().addColumn(0, 0), fB = s().addColumn(120, 0)
  const fBeam = s().addBeam(fA, fB, 'roof')
  s().deleteColumn(fA)
  ok('E.7 deleting a column detaches (not deletes) its beam', !!s().beams[fBeam])
  ok('E.8 column endpoint detached to POINT with COLUMN provenance',
     s().beams[fBeam].endpoints.from.type === 'POINT' && s().beams[fBeam].endpoints.from.detachedFrom?.type === 'COLUMN')

  // deleteWall → detach the bearing beam.
  reset()
  const gw1 = s().getOrCreateNode(0, 0), gw2 = s().getOrCreateNode(120, 0)
  s().addWall(gw1, gw2)
  const gWall = Object.values(s().walls)[0].id
  const gBeam = s().addBeamWithEndpoints({ type: 'WALL', wallId: gWall, t: 0.5 }, { type: 'POINT', x: 60, y: 120 }, 'roof')
  s().deleteWall(gWall)
  ok('E.9 deleting a wall detaches the bearing beam (POINT + WALL provenance)',
     !!s().beams[gBeam] && s().beams[gBeam].endpoints.from.type === 'POINT' && s().beams[gBeam].endpoints.from.detachedFrom?.type === 'WALL')
}

// ── Section F — BBS + FK descriptors + integrity ───────────────────────
header('Section F — BBS interior anchorage + FK descriptors + integrity')
{
  reset()
  s().setProjectSettings({
    reinforcementSpecs: {
      BEAM_RES: { id: 'BEAM_RES', label: 'Beam', elementType: 'BEAM',
        topBars: { count: 2, diaMm: 10 }, bottomBars: { count: 2, diaMm: 10 },
        stirrupBarDiaMm: 8, stirrupSpacingIn: 6, coverMm: 25 },
    },
    bbsDefaults: { BEAM: { roof: 'BEAM_RES' } },
  })
  const hA = s().addColumn(0, 0), hB = s().addColumn(120, 0)
  const hP = s().addBeam(hA, hB, 'roof')
  const hC = s().addColumn(60, 120)
  const hS = s().addBeamWithEndpoints({ type: 'COLUMN', columnId: hC }, { type: 'BEAM', beamId: hP, t: 0.5 }, 'roof')
  const out = computeRebarGroups(s())
  const sGroups = out.groups.filter(g => g.elementId === hS)
  ok('F.1 BBS emits rebar groups for the beam-to-beam secondary', sGroups.length > 0, `groups=${sGroups.length}`)
  const top = sGroups.find(g => g.role === 'TOP')
  ok('F.2 secondary BEAM-end anchorage is interior (isExteriorTo=false)', top && top.meta?.isExteriorTo === false)
  ok('F.3 integrity valid for the beam-to-beam fixture', verifyIntegrity(s()).valid)

  ok('F.4 beamId FK descriptors present (gated BEAM)',
     FK_DESCRIPTORS.some(d => d.field === 'endpoints.from.beamId' && d.gateValue === 'BEAM') &&
     FK_DESCRIPTORS.some(d => d.field === 'endpoints.to.beamId' && d.gateValue === 'BEAM'))
  ok('F.5 wallId FK descriptors present (gated WALL)',
     FK_DESCRIPTORS.some(d => d.field === 'endpoints.from.wallId' && d.gateValue === 'WALL') &&
     FK_DESCRIPTORS.some(d => d.field === 'endpoints.to.wallId' && d.gateValue === 'WALL'))
}

// ── Summary ────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(70))
console.log(`PASS: ${pass}  FAIL: ${fail}`)
console.log('═'.repeat(70))
if (fail > 0) { console.error(`✗ verify-beam-connections FAILED: ${fail} assertions`); process.exit(1) }
else { console.log(`✓ verify-beam-connections passed (${pass} assertions)`) }
