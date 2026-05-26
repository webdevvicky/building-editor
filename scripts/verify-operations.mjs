// scripts/verify-operations.mjs
//
// Arch 2 Phase 2 — operation dispatcher correctness.
// Assertions:
//   1. Registry well-formedness: every op has version, kind, apply
//   2. Buildable: buildOp() produces well-formed operations
//   3. Dispatch routes user/system/transient correctly
//   4. apply → inverse round-trip: applying inverse restores prior state
//   5. Integrity verification gates user/system ops
//   6. Transactions accumulate + commit as composite
//   7. Transient ops in transactions are forbidden
//   8. Schema-version mismatch detected

import {
  OP_KIND, OPERATIONS, KIND_BY_TYPE,
  buildOp, dispatch, transaction, getOperation, listOperationTypes,
  OperationError, SCHEMA_VERSION,
} from '../src/operations/index.js'
import { uid, uidIfc, newEntityIds } from '../src/lib/ids.js'
import { verifyIntegrity } from '../src/schema/integrity.js'

const passed = []
const failed = []
function check(name, cond, info) {
  (cond ? passed : failed).push(`${name}${info ? '  (' + info + ')' : ''}`)
}

// ── 1. Registry well-formedness ─────────────────────────────────────────
check('OPERATIONS is frozen', Object.isFrozen(OPERATIONS))
const types = listOperationTypes()
check('registry has ADD_WALL', types.includes('ADD_WALL'))
check('registry has DELETE_WALL', types.includes('DELETE_WALL'))
check('registry has ADD_OPENING', types.includes('ADD_OPENING'))
check('registry has ADD_COLUMN', types.includes('ADD_COLUMN'))
check('registry has transient ops', types.includes('SET_SELECTED_WALL_ID'))
check('registry has system ops', types.includes('BACKFILL_IFC_GLOBAL_ID'))

for (const t of types) {
  const def = getOperation(t)
  check(`${t}: has version`, typeof def.version === 'number' && def.version >= 1)
  check(`${t}: has kind`, [OP_KIND.USER, OP_KIND.SYSTEM, OP_KIND.TRANSIENT].includes(def.kind))
  check(`${t}: has apply function`, typeof def.apply === 'function')
}

check('KIND_BY_TYPE maps every type', Object.keys(KIND_BY_TYPE).length === types.length)

// ── 2. buildOp ──────────────────────────────────────────────────────────
const opId = uid()
const builtOp = buildOp({
  id:      opId,
  type:    'ADD_WALL',
  kind:    OP_KIND.USER,
  payload: { id: 'w1', ifcGlobalId: uidIfc(), n1: 'n1', n2: 'n2' },
})
check('buildOp: type matches', builtOp.type === 'ADD_WALL')
check('buildOp: kind matches', builtOp.kind === OP_KIND.USER)
check('buildOp: schemaVersion stamped', builtOp.schemaVersion === SCHEMA_VERSION)
check('buildOp: timestamp set', typeof builtOp.timestamp === 'number' && builtOp.timestamp > 0)
check('buildOp: frozen', Object.isFrozen(builtOp))

let buildThrew = false
try { buildOp({ type: 'ADD_WALL', kind: OP_KIND.USER, payload: {} }) } catch { buildThrew = true }
check('buildOp: throws when id missing', buildThrew)

let kindThrew = false
try { buildOp({ id: opId, type: 'ADD_WALL', kind: 'bogus', payload: {} }) } catch { kindThrew = true }
check('buildOp: throws on invalid kind', kindThrew)

// ── 3. Dispatch user op ─────────────────────────────────────────────────
const initialState = {
  nodes: {
    'n1': { id: 'n1', ifcGlobalId: 'aaaaaaaaaaaaaaaaaaaaaa', x: 0, y: 0, floorIds: ['F1'] },
    'n2': { id: 'n2', ifcGlobalId: 'bbbbbbbbbbbbbbbbbbbbbb', x: 120, y: 0, floorIds: ['F1'] },
  },
  walls:        {},
  rooms:        {},
  stamps:       {},
  columns:      {},
  beams:        {},
  slabs:        {},
  staircases:   {},
  foundations:  {},
  plumbingFixtures: {}, electricalPoints: {}, hvacUnits: {},
  fireDevices: {}, elvDevices: {}, solarEquipment: {}, risers: {},
  projectSettings: { floors: [{ id: 'F1' }] },
}

// In-memory side-effects mock — captures every routing call so we can
// assert the dispatcher routes by kind correctly.
function makeMockSideEffects(state) {
  const journal = []
  const history = []
  let dirtyCount = 0
  return {
    state,
    journal,
    history,
    getDirtyCount: () => dirtyCount,
    getState: () => state,
    setState: (next) => { Object.assign(state, next) },
    appendHistory: (op, inv) => { history.push({ op, inv }) },
    appendJournal: (op, inv) => { journal.push({ op, inv }) },
    markAutosaveDirty: () => { dirtyCount++ },
  }
}

const sfx1 = makeMockSideEffects(structuredClone(initialState))
const wallIds = newEntityIds()
const addWallOp = buildOp({
  id:      uid(),
  type:    'ADD_WALL',
  kind:    OP_KIND.USER,
  payload: { id: wallIds.id, ifcGlobalId: wallIds.ifcGlobalId, n1: 'n1', n2: 'n2' },
})
const dispatched = dispatch(addWallOp, sfx1)
check('user op: setState applied', !!sfx1.state.walls[wallIds.id])
check('user op: history appended', sfx1.history.length === 1)
check('user op: journal appended', sfx1.journal.length === 1)
check('user op: autosave dirty', sfx1.getDirtyCount() === 1)
check('user op: returned op has inverse', !!dispatched.inverse)
check('user op: inverse type is DELETE_WALL', dispatched.inverse.type === 'DELETE_WALL')

// ── 4. Apply → inverse round-trip ───────────────────────────────────────
const stateBefore = structuredClone(initialState)
const sfx2 = makeMockSideEffects(structuredClone(initialState))
const wallIds2 = newEntityIds()
const addOp = buildOp({
  id: uid(), type: 'ADD_WALL', kind: OP_KIND.USER,
  payload: { id: wallIds2.id, ifcGlobalId: wallIds2.ifcGlobalId, n1: 'n1', n2: 'n2' },
})
const sealed = dispatch(addOp, sfx2)
const inverseOp = buildOp({
  id: uid(), type: sealed.inverse.type, kind: OP_KIND.USER,
  payload: sealed.inverse.payload,
})
dispatch(inverseOp, sfx2)
check('round-trip: walls collection back to empty',
      Object.keys(sfx2.state.walls).length === 0)
// Other slices unchanged
check('round-trip: nodes preserved',
      Object.keys(sfx2.state.nodes).length === Object.keys(stateBefore.nodes).length)

// ── 5. Integrity gate ───────────────────────────────────────────────────
// Bad wall (n1 → nonexistent node) should be rejected by the dispatcher.
const sfx3 = makeMockSideEffects(structuredClone(initialState))
const badIds = newEntityIds()
const badOp = buildOp({
  id: uid(), type: 'ADD_WALL', kind: OP_KIND.USER,
  payload: { id: badIds.id, ifcGlobalId: badIds.ifcGlobalId, n1: 'ghost', n2: 'n2' },
})
let integrityThrew = false
try { dispatch(badOp, sfx3) } catch (e) {
  if (e instanceof OperationError && /integrity/.test(e.message)) integrityThrew = true
}
check('integrity gate: rejects op producing broken refs', integrityThrew)
check('integrity gate: walls collection unchanged after rejection',
      Object.keys(sfx3.state.walls).length === 0)

// ── 6. Transient op routing ─────────────────────────────────────────────
const sfx4 = makeMockSideEffects(structuredClone(initialState))
const transientOp = buildOp({
  id: uid(), type: 'SET_SELECTED_WALL_ID', kind: OP_KIND.TRANSIENT,
  payload: { id: 'some-wall' },
})
dispatch(transientOp, sfx4)
check('transient op: state mutated', sfx4.state.selectedWallId === 'some-wall')
check('transient op: NO history append', sfx4.history.length === 0)
check('transient op: NO journal append', sfx4.journal.length === 0)
check('transient op: NO autosave dirty', sfx4.getDirtyCount() === 0)

// ── 7. System op routing ────────────────────────────────────────────────
const sfx5 = makeMockSideEffects(structuredClone(initialState))
const sysOp = buildOp({
  id: uid(), type: 'BACKFILL_IFC_GLOBAL_ID', kind: OP_KIND.SYSTEM,
  payload: { slice: 'nodes', id: 'n1', ifcGlobalId: 'cccccccccccccccccccccc' },
})
dispatch(sysOp, sfx5)
check('system op: NO history (no undo)', sfx5.history.length === 0)
check('system op: journal appended (audit)', sfx5.journal.length === 1)
check('system op: autosave dirty', sfx5.getDirtyCount() === 1)
check('system op: state mutated',
      sfx5.state.nodes['n1'].ifcGlobalId === 'cccccccccccccccccccccc')

// ── 8. Transactions ─────────────────────────────────────────────────────
const sfx6 = makeMockSideEffects(structuredClone(initialState))
const wIds = [newEntityIds(), newEntityIds()]
transaction('add-two-walls', () => {
  // Add wall #1
  dispatch(buildOp({
    id: uid(), type: 'ADD_WALL', kind: OP_KIND.USER,
    payload: { id: wIds[0].id, ifcGlobalId: wIds[0].ifcGlobalId, n1: 'n1', n2: 'n2' },
  }), sfx6)
  // Second wall — needs different node pair to pass integrity.
  // Add a third node first (system op).
  sfx6.state.nodes['n3'] = { id: 'n3', ifcGlobalId: 'dddddddddddddddddddddd', x: 200, y: 0, floorIds: ['F1'] }
  dispatch(buildOp({
    id: uid(), type: 'ADD_WALL', kind: OP_KIND.USER,
    payload: { id: wIds[1].id, ifcGlobalId: wIds[1].ifcGlobalId, n1: 'n2', n2: 'n3' },
  }), sfx6)
}, sfx6)
check('transaction: 2 walls applied to state', Object.keys(sfx6.state.walls).length === 2)
check('transaction: ONE composite history entry',
      sfx6.history.length === 1 && sfx6.history[0].op.type === 'TRANSACTION')
check('transaction: ONE composite journal entry',
      sfx6.journal.length === 1 && sfx6.journal[0].op.type === 'TRANSACTION')
check('transaction: composite carries children list',
      Array.isArray(sfx6.history[0].op.payload?.children) &&
      sfx6.history[0].op.payload.children.length === 2)
check('transaction: ONE autosave dirty', sfx6.getDirtyCount() === 1)

// ── 9. Transient in transaction forbidden ───────────────────────────────
const sfx7 = makeMockSideEffects(structuredClone(initialState))
let txThrew = false
try {
  transaction('mixed', () => {
    dispatch(buildOp({
      id: uid(), type: 'SET_SELECTED_WALL_ID', kind: OP_KIND.TRANSIENT,
      payload: { id: 'foo' },
    }), sfx7)
  }, sfx7)
} catch (e) {
  if (e instanceof OperationError) txThrew = true
}
check('transaction: TRANSIENT op inside throws OperationError', txThrew)

// ── 10. Kind/registry mismatch ──────────────────────────────────────────
const sfx8 = makeMockSideEffects(structuredClone(initialState))
const badKindOp = {
  ...buildOp({ id: uid(), type: 'ADD_WALL', kind: OP_KIND.USER, payload: { id: 'x', ifcGlobalId: 'eeeeeeeeeeeeeeeeeeeeee', n1: 'n1', n2: 'n2' } }),
  kind: OP_KIND.SYSTEM,   // mismatch — ADD_WALL is USER in registry
}
let mismatchThrew = false
try { dispatch(badKindOp, sfx8) } catch (e) {
  if (e instanceof OperationError && /doesn't match registry/.test(e.message)) mismatchThrew = true
}
check('kind mismatch: registry kind enforced', mismatchThrew)

console.log(`\nPASSED: ${passed.length}`)
for (const p of passed) console.log(`   ${p}`)
if (failed.length > 0) {
  console.log(`\nFAILED:`)
  for (const f of failed) console.log(`   ${f}`)
  process.exit(1)
}
console.log('\n✓ verify-operations passed.')
