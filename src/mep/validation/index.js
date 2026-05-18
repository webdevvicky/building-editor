// MEP validation barrel — discipline-specific rules.
//
// The main validation engine (src/validation/engine.js) holds the
// structural rules. MEP rules live here so disciplines can be added
// without bloating the engine's import list.

export { mepNoFloorTrap }      from './rules/mep_no_floor_trap.js'
export { mepDbLoadExceeded }   from './rules/mep_db_load_exceeded.js'
export { mepClashDetected }    from './rules/mep_clash_detected.js'

import { mepNoFloorTrap }    from './rules/mep_no_floor_trap.js'
import { mepDbLoadExceeded } from './rules/mep_db_load_exceeded.js'
import { mepClashDetected }  from './rules/mep_clash_detected.js'

export const MEP_RULES = [
  mepNoFloorTrap,
  mepDbLoadExceeded,
  mepClashDetected,
]
