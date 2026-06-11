// scripts/verify-integrity.mjs
//
// Arch 9 (Phase 1 Addition 2) — referential integrity verifier.
// Builds known-broken AND known-clean states; asserts the verifier
// finds the breaks and accepts the clean.

import { verifyIntegrity, assertIntegrity } from '../src/schema/integrity.js'
import { useStore } from '../src/store.js'

const passed = []
const failed = []
function check(name, cond, info) {
  (cond ? passed : failed).push(`${name}${info ? '  (' + info + ')' : ''}`)
}

const s = useStore.getState
const FT = 12

// ── 1. Empty state passes integrity ────────────────────────────────────
s().loadProject({})
const emptyResult = verifyIntegrity(s())
check('Empty state has zero integrity issues',
      emptyResult.valid && emptyResult.count === 0,
      `count=${emptyResult.count}`)

// ── 2. Sample project: nodes + walls + rooms + columns + stamp ─────────
const sw = s().getOrCreateNode(0, 0)
const se = s().getOrCreateNode(20 * FT, 0)
const ne = s().getOrCreateNode(20 * FT, 15 * FT)
const nw = s().getOrCreateNode(0, 15 * FT)
s().addWall(sw, se)
s().addWall(se, ne)
s().addWall(ne, nw)
s().addWall(nw, sw)
{
  const ids = Object.values(s().walls).map(w => w.id)
  ids.forEach(id => s().togglePendingWall(id))
  s().saveRoom('Living', 'LIVING')
}
s().addColumn(0, 0, 'C1', sw)
s().addStamp('sump', 25 * FT, -10 * FT)

const sampleResult = verifyIntegrity(s())
check('Sample 1-room project has zero integrity issues',
      sampleResult.valid,
      sampleResult.valid ? '' : sampleResult.issues.slice(0, 3).map(i => i.message).join(' | '))

// ── 3. Inject a broken wall (n1 points to nonexistent node) ────────────
const brokenState = {
  ...s(),
  walls: {
    ...s().walls,
    'broken-wall': {
      id:           'broken-wall',
      ifcGlobalId:  'broken1234567890123456',
      n1:           'nonexistent-node',
      n2:           sw,
      height:       120,
      thickness:    9,
      materialKey:  'IS_MODULAR_BRICK',
      openings:     [],
      floorId:      'F1',
      classification: null,
      isPlot:       false,
      isVirtual:    false,
      hasPlinthBeam: null,
      hasLintelBeam: null,
      hasRoofBeam:   null,
      hasBalconyRailingEdge: null,
      meta:         null,
    },
  },
}
const brokenResult = verifyIntegrity(brokenState)
check('Broken wall.n1 reference detected',
      !brokenResult.valid &&
      brokenResult.issues.some(i => i.kind === 'broken-ref' && i.entityType === 'wall' && i.field === 'n1' && i.missing === 'nonexistent-node'),
      `count=${brokenResult.count}`)

// ── 4. Inject a broken room.wallIds reference ──────────────────────────
const brokenRoomState = {
  ...s(),
  rooms: {
    ...s().rooms,
    'orphan-room': {
      id:              'orphan-room',
      ifcGlobalId:     'orphan1234567890123456',
      name:            'Orphan',
      type:            'BEDROOM',
      wallIds:         ['ghost-wall-1', 'ghost-wall-2'],
      finishes:        { flooring: true, ceilingPlaster: true, paint: true, waterproofing: false, roofing: false },
      floorId:         'F1',
      classification:  null,
      meta:            null,
    },
  },
}
const brokenRoomResult = verifyIntegrity(brokenRoomState)
check('Broken room.wallIds reference detected',
      !brokenRoomResult.valid &&
      brokenRoomResult.issues.filter(i => i.entityType === 'room' && i.field === 'wallIds').length === 2,
      `count of room.wallIds issues = ${brokenRoomResult.issues.filter(i => i.entityType === 'room' && i.field === 'wallIds').length}`)

// ── 5. Inject a broken column.attachedNodeId ───────────────────────────
const brokenColState = {
  ...s(),
  columns: {
    ...s().columns,
    'orphan-col': {
      id:                  'orphan-col',
      ifcGlobalId:         'orphancol12345678901',
      x:                   0, y: 0,
      columnTypeId:        'C1',
      attachedNodeId:      'ghost-node',
      baseFloorId:         'F1',
      topFloorId:          'F1',
      classification:      null,
      reinforcementSpecId: null,
      meta:                null,
    },
  },
}
const brokenColResult = verifyIntegrity(brokenColState)
check('Broken column.attachedNodeId reference detected',
      brokenColResult.issues.some(i => i.entityType === 'column' && i.field === 'attachedNodeId' && i.missing === 'ghost-node'))

// ── 6. Inject a broken floor reference (column.baseFloorId) ────────────
const brokenFloorState = {
  ...s(),
  columns: {
    ...s().columns,
    'col-on-ghost-floor': {
      id:                  'col-on-ghost-floor',
      ifcGlobalId:         'colghostfloor1234567',
      x:                   0, y: 0,
      columnTypeId:        'C1',
      attachedNodeId:      null,
      baseFloorId:         'F999',
      topFloorId:          'F999',
      classification:      null,
      reinforcementSpecId: null,
      meta:                null,
    },
  },
}
const brokenFloorResult = verifyIntegrity(brokenFloorState)
check('Broken column.baseFloorId (F999) detected',
      brokenFloorResult.issues.some(i => i.entityType === 'column' && i.field === 'baseFloorId' && i.missing === 'F999'))

// ── 6b. Phase ColumnStack — broken column.segments refs ────────────────
// A segment keyed by a ghost floor + referencing a ghost section/spec.
const brokenSegState = {
  ...s(),
  columns: {
    ...s().columns,
    'col-bad-seg': {
      id: 'col-bad-seg', ifcGlobalId: 'colbadseg1234567890ab',
      x: 0, y: 0, columnTypeId: 'C1', attachedNodeId: null,
      baseFloorId: 'F1', topFloorId: 'F1', classification: null,
      reinforcementSpecId: null, position: null, meta: null,
      segments: { F999: { columnTypeId: 'CX', reinforcementSpecId: 'SPEC_GHOST' } },
    },
  },
}
const brokenSegResult = verifyIntegrity(brokenSegState)
check('Broken column.segments floor key (F999) detected',
      brokenSegResult.issues.some(i => i.entityType === 'column' && i.field === 'segments.F999' && i.missing === 'F999'))
check('Broken column.segments columnTypeId (CX) detected',
      brokenSegResult.issues.some(i => i.entityType === 'column' && i.field === 'segments.F999.columnTypeId' && i.missing === 'CX'))

// ── 7. Deterministic ordering ──────────────────────────────────────────
// Build same broken state twice, assert byte-equal issue lists.
const r1 = verifyIntegrity(brokenState)
const r2 = verifyIntegrity(brokenState)
check('verifyIntegrity ordering is deterministic',
      r1.issues.length === r2.issues.length &&
      r1.issues.every((iss, idx) => iss.message === r2.issues[idx].message))

// ── 8. assertIntegrity throws on broken state, passes on clean ────────
let assertionThrew = false
try { assertIntegrity(brokenState, 'unit-test') } catch (e) { assertionThrew = true }
check('assertIntegrity throws on broken state', assertionThrew)

let assertionPassed = false
try { assertIntegrity(s(), 'sample'); assertionPassed = true } catch {}
check('assertIntegrity passes on clean sample state', assertionPassed)

// ── 9. Issue shape contract ────────────────────────────────────────────
const sampleIssue = brokenResult.issues[0]
check('issue carries kind / entityType / entityId / field / missing / message',
      sampleIssue &&
      'kind' in sampleIssue &&
      'entityType' in sampleIssue &&
      'entityId' in sampleIssue &&
      'field' in sampleIssue &&
      'missing' in sampleIssue &&
      'message' in sampleIssue)

console.log(`\nPASSED: ${passed.length}`)
for (const p of passed) console.log(`   ${p}`)
if (failed.length > 0) {
  console.log(`\nFAILED:`)
  for (const f of failed) console.log(`   ${f}`)
  process.exit(1)
}
console.log('\n✓ verify-integrity passed.')
