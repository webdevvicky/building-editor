// verify-ghost-overlay — proves the Ghost overlay invariants:
//   1. Ghosts are DERIVED (standard − placed), computed purely, never mutating state.
//   2. Ghosts are NEVER persisted — buildSnapshot has no ghost data (structural).
//   3. Placing real objects reduces the ghost; removing them restores it.
//   4. Placed-beyond-standard surfaces as "additional" (the commercial signal).

import assert from 'node:assert'
import { computeRoomGhosts } from '../src/ghosts/ghostCatalog.js'
import { buildSnapshot } from '../src/projects/_snapshot.js'

let passed = 0
const ok = (msg) => { passed++; console.log('  ✓', msg) }

// A minimal, valid editor state: one bedroom, standard = 5 electrical + 1 door.
const erpRoomTypes = [
  { code: 'BEDROOM', label: 'Bedroom', defaultElectricalPointCount: 5, defaultFixtureSpec: { doors: 1 } },
]
const baseState = () => ({
  nodes: {}, walls: {}, stamps: {}, columns: {}, beams: {}, slabs: {},
  staircases: {}, foundations: {}, plumbingFixtures: {}, electricalPoints: {},
  hvacUnits: {}, fireDevices: {}, elvDevices: {}, solarEquipment: {}, risers: {},
  projectSettings: { floors: [] },
  rooms: { r1: { id: 'r1', roomTypeCode: 'BEDROOM', wallIds: [], nodeOrder: [] } },
})

// 1. Empty room → the full standard shows as ghosts (nothing placed yet).
const s = baseState()
const before = JSON.stringify(s)
let ghosts = computeRoomGhosts(s, 'r1', erpRoomTypes)
const elec = () => computeRoomGhosts(s, 'r1', erpRoomTypes).find((g) => g.key === 'electrical')
assert.strictEqual(elec().standard, 5)
assert.strictEqual(elec().placed, 0)
assert.strictEqual(elec().ghost, 5)
ok('empty room: standard 5 electrical → 5 ghosts, 0 placed')

// 2. computeRoomGhosts is PURE — it did not mutate the state.
assert.strictEqual(JSON.stringify(s), before)
ok('computeRoomGhosts does not mutate state (pure derived view)')

// 3. Place 3 real electrical points → ghost drops to 2, placed 3.
for (let i = 0; i < 3; i++) s.electricalPoints[`e${i}`] = { id: `e${i}`, roomId: 'r1' }
assert.strictEqual(elec().placed, 3)
assert.strictEqual(elec().ghost, 2)
ok('placed 3 → ghost 2 (standard − placed)')

// 4. Ghosts are NEVER in the snapshot — only the real placed objects are.
const snap = buildSnapshot(s)
assert.ok(!('ghosts' in snap), 'snapshot must have no ghost collection')
assert.strictEqual(Object.keys(snap.electricalPoints).length, 3)
ok('buildSnapshot has NO ghost data; only the 3 real points persist')

// 5. Delete a placed point → the ghost returns (recomputed, not stored).
delete s.electricalPoints.e2
assert.strictEqual(elec().placed, 2)
assert.strictEqual(elec().ghost, 3)
ok('delete a placed object → ghost returns automatically')

// 6. Placed beyond standard → 0 ghosts + "additional" surfaces (commercial signal).
for (let i = 3; i < 8; i++) s.electricalPoints[`e${i}`] = { id: `e${i}`, roomId: 'r1' }
assert.strictEqual(elec().placed, 7)
assert.strictEqual(elec().ghost, 0)
assert.strictEqual(elec().additional, 2)
ok('placed 7 vs standard 5 → 0 ghosts, additional +2')

// 7. A room with an unknown/unset type has no standard → no ghosts fabricated.
const s2 = baseState()
s2.rooms.r1.roomTypeCode = null
assert.deepStrictEqual(
  computeRoomGhosts(s2, 'r1', erpRoomTypes).map((g) => g.ghost),
  [0, 0, 0],
)
ok('no roomTypeCode → no standard → no fabricated ghosts')

console.log(`\n✓ PASS — ${passed} passed, 0 failed`)
