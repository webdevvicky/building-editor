// Barrel — every entity schema indexed by entityType.
//
// Used by:
//   - src/schema/normalize.js (default injection on load)
//   - src/schema/validate.js  (type + invariant checks)
//   - src/schema/integrity.js (referential integrity)
//   - Future migrations + journal replay + persistence write paths

import nodeSchema             from './node.js'
import wallSchema             from './wall.js'
import openingSchema          from './opening.js'
import roomSchema             from './room.js'
import stampSchema            from './stamp.js'
import columnSchema           from './column.js'
import beamSchema             from './beam.js'
import slabSchema             from './slab.js'
import staircaseSchema        from './staircase.js'
import foundationSchema       from './foundation.js'
import plumbingFixtureSchema  from './plumbingFixture.js'
import electricalPointSchema  from './electricalPoint.js'
import hvacUnitSchema         from './hvacUnit.js'
import fireDeviceSchema       from './fireDevice.js'
import elvDeviceSchema        from './elvDevice.js'
import solarEquipmentSchema   from './solarEquipment.js'
import riserSchema            from './riser.js'

export const ENTITY_SCHEMAS = Object.freeze({
  node:             nodeSchema,
  wall:             wallSchema,
  opening:          openingSchema,
  room:             roomSchema,
  stamp:            stampSchema,
  column:           columnSchema,
  beam:             beamSchema,
  slab:             slabSchema,
  staircase:        staircaseSchema,
  foundation:       foundationSchema,
  plumbingFixture:  plumbingFixtureSchema,
  electricalPoint:  electricalPointSchema,
  hvacUnit:         hvacUnitSchema,
  fireDevice:       fireDeviceSchema,
  elvDevice:        elvDeviceSchema,
  solarEquipment:   solarEquipmentSchema,
  riser:            riserSchema,
})

// Map an entity's storeSlice path (e.g. 'model.walls' or legacy 'walls')
// to the matching schema. Both legacy and post-Arch-1 paths work.
export const SCHEMAS_BY_SLICE = Object.freeze(
  Object.fromEntries(
    Object.values(ENTITY_SCHEMAS).flatMap(s => {
      const slicePath = s.storeSlice ?? ''
      const legacyPath = slicePath.replace(/^model\./, '')
      return [
        [slicePath,  s],
        [legacyPath, s],
      ]
    })
  )
)

export function getSchema(entityType) {
  return ENTITY_SCHEMAS[entityType] ?? null
}

export function listSchemas() {
  return Object.values(ENTITY_SCHEMAS)
}

export {
  nodeSchema, wallSchema, openingSchema, roomSchema, stampSchema,
  columnSchema, beamSchema, slabSchema, staircaseSchema, foundationSchema,
  plumbingFixtureSchema, electricalPointSchema, hvacUnitSchema,
  fireDeviceSchema, elvDeviceSchema, solarEquipmentSchema, riserSchema,
}
