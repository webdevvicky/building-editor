// scripts/verify-ifc-ids.mjs
//
// Arch 6 (Phase 1) — every persistent entity carries an internal `id`
// (36-char UUID) AND an `ifcGlobalId` (22-char IFC base64 GUID).
//
// Assertions:
//   1. uid() / uidIfc() / newEntityIds() format correctness
//   2. uuidToIfcGuid round-trip via ifcGuidToUuid
//   3. Determinism (same UUID always → same IFC GUID)
//   4. Sample-project: every entity created via store actions carries
//      both fields, both well-formed.

import {
  uid, uidIfc, newEntityIds,
  uuidToIfcGuid, ifcGuidToUuid,
  isValidUuid, isValidIfcGuid,
} from '../src/lib/ids.js'
import { useStore } from '../src/store.js'

const passed = []
const failed = []
function check(name, cond, info) {
  (cond ? passed : failed).push(`${name}${info ? '  (' + info + ')' : ''}`)
}

const s = useStore.getState

// ── 1. uid() ─────────────────────────────────────────────────────────────
const u1 = uid()
check('uid() returns a valid UUID', isValidUuid(u1), `got "${u1}"`)
const u2 = uid()
check('uid() is unique across calls', u1 !== u2)

// ── 2. uidIfc() ──────────────────────────────────────────────────────────
const g1 = uidIfc()
check('uidIfc() returns a 22-char IFC GUID', isValidIfcGuid(g1), `got "${g1}" (length ${g1.length})`)
const g2 = uidIfc()
check('uidIfc() is unique across calls', g1 !== g2)

// ── 3. newEntityIds() ────────────────────────────────────────────────────
const pair = newEntityIds()
check('newEntityIds() returns { id, ifcGlobalId }',
      'id' in pair && 'ifcGlobalId' in pair)
check('newEntityIds().id is valid UUID', isValidUuid(pair.id))
check('newEntityIds().ifcGlobalId is valid IFC GUID', isValidIfcGuid(pair.ifcGlobalId))

// ── 4. uuidToIfcGuid + round-trip ────────────────────────────────────────
const sampleUuid = '550e8400-e29b-41d4-a716-446655440000'
const sampleIfc  = uuidToIfcGuid(sampleUuid)
check('uuidToIfcGuid: known sample',
      sampleIfc.length === 22 && isValidIfcGuid(sampleIfc),
      `got "${sampleIfc}"`)
check('uuidToIfcGuid: deterministic',
      uuidToIfcGuid(sampleUuid) === sampleIfc)
const roundtrip = ifcGuidToUuid(sampleIfc)
check('uuidToIfcGuid → ifcGuidToUuid: round-trip',
      roundtrip.toLowerCase() === sampleUuid.toLowerCase(),
      `original=${sampleUuid}  back=${roundtrip}`)

// ── 5. Format-edge cases ─────────────────────────────────────────────────
check('uuidToIfcGuid rejects non-string', (() => {
  try { uuidToIfcGuid(null); return false } catch { return true }
})())
check('uuidToIfcGuid rejects bad length', (() => {
  try { uuidToIfcGuid('not-a-uuid'); return false } catch { return true }
})())
check('ifcGuidToUuid rejects bad length', (() => {
  try { ifcGuidToUuid('too-short'); return false } catch { return true }
})())

// ── 6. Sample-project: every entity has both fields ──────────────────────
const FT = 12
s().loadProject({})  // fresh
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
const wallId = Object.values(s().walls)[0].id
s().addOpening(wallId, { offset: 3 * FT, width: 3 * FT, height: 7 * FT, type: 'door', orient: 0 })

const allEntities = [
  ...Object.values(s().nodes).map(n => ['node', n]),
  ...Object.values(s().walls).map(w => ['wall', w]),
  ...Object.values(s().rooms).map(r => ['room', r]),
  ...Object.values(s().stamps).map(st => ['stamp', st]),
  ...Object.values(s().columns).map(c => ['column', c]),
  // openings are sub-shapes inside walls
  ...Object.values(s().walls).flatMap(w => (w.openings ?? []).map(o => ['opening', o])),
]
const malformed = allEntities.filter(([, e]) => !isValidUuid(e.id) || !isValidIfcGuid(e.ifcGlobalId))
check('Every created entity has valid id + ifcGlobalId',
      malformed.length === 0,
      `${malformed.length} malformed entities (first: ${malformed[0]?.[0] ?? 'none'} ${JSON.stringify(malformed[0]?.[1] ?? {}).slice(0, 80)})`)

// id ≠ ifcGlobalId for every entity (different ID spaces)
const collisions = allEntities.filter(([, e]) => e.id === e.ifcGlobalId)
check('id and ifcGlobalId are distinct on every entity',
      collisions.length === 0)

// All ifcGlobalIds are unique
const seenIfc = new Set()
const dupes = allEntities.filter(([, e]) => {
  if (seenIfc.has(e.ifcGlobalId)) return true
  seenIfc.add(e.ifcGlobalId)
  return false
})
check('All ifcGlobalIds are unique across entities',
      dupes.length === 0)

console.log(`\nPASSED: ${passed.length}`)
for (const p of passed) console.log(`   ${p}`)
if (failed.length > 0) {
  console.log(`\nFAILED:`)
  for (const f of failed) console.log(`   ${f}`)
  process.exit(1)
}
console.log('\n✓ verify-ifc-ids passed.')
