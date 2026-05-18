// MEP validation barrel — discipline-specific rules.
//
// The main validation engine (src/validation/engine.js) holds the
// structural rules. MEP rules live here so disciplines can be added
// without bloating the engine's import list. Engine integration lands
// when MEP rules need to surface in the BOQ footer alongside structural
// rules — for now they're exported but not yet wired into RULES.

export { mepNoFloorTrap } from './rules/mep_no_floor_trap.js'
export { mepDbLoadExceeded } from './rules/mep_db_load_exceeded.js'

import { mepNoFloorTrap } from './rules/mep_no_floor_trap.js'
import { mepDbLoadExceeded } from './rules/mep_db_load_exceeded.js'

export const MEP_RULES = [
  mepNoFloorTrap,
  mepDbLoadExceeded,
]
