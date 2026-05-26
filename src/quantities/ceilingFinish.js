// Ceiling finish material aggregator (Gap 7) — false ceiling materials
// (gypsum board / cement board / PVC panel / grid T-bar).
//
// Per-room override slot: room.ceilingFinishId (null = inherit project
// default projectSettings.defaultCeilingFinishSystemId).
//
// Only rooms with finishes.ceilingPlaster === true accept a ceiling
// finish (false ceiling sits below structural plaster). Rooms without
// the flag are skipped silently (a dev-warning surfaces in _meta.warnings
// if the room explicitly set ceilingFinishId without plaster).

import {
  getCeilingFinishSystem,
  DEFAULT_CEILING_FINISH_SYSTEM_ID,
} from '../specs/ceilingFinishSystems.js'
import { buildMeta, ATTRIBUTION_POLICY, isScopedState } from './_metaContract.js'

const ALGORITHM    = 'ROOM_CEILING_FINISH_ROLLUP_V1'
const CALC_VERSION = '2026-05-26'

const SFT_TO_SQM = 0.0929   // 1 ft² = 0.0929 m²

function r2(n) { return Math.round(n * 100) / 100 }

function _resolveSystemId(state, room) {
  if (room?.ceilingFinishId) return room.ceilingFinishId
  return state?.projectSettings?.defaultCeilingFinishSystemId ?? DEFAULT_CEILING_FINISH_SYSTEM_ID
}

export function computeCeilingFinishQuantities(state) {
  if (!state) {
    return {
      bySystem: {}, perMaterial: [],
      totals: { areaSft: 0, areaSqm: 0 },
      _meta:  buildMeta({ algorithm: ALGORITHM, calculationVersion: CALC_VERSION,
                          attributionPolicy: ATTRIBUTION_POLICY.OWNING_ROOM, scoped: false }),
    }
  }

  const rooms = state.rooms ?? {}
  const validIds = state.getValidRoomIds?.() ?? Object.keys(rooms)
  const bySystem = {}   // { [sysId]: { areaSft, rooms: [], materials } }
  const warnings = []

  for (const rid of validIds) {
    const room = rooms[rid]
    if (!room) continue
    const hasPlaster = room.finishes?.ceilingPlaster
    if (!hasPlaster) {
      if (room.ceilingFinishId) {
        warnings.push({ code: 'CEILING_FINISH_WITHOUT_PLASTER', roomId: rid,
                        message: `Room ${rid} has ceilingFinishId=${room.ceilingFinishId} but ceilingPlaster=false; skipped.` })
      }
      continue
    }
    const sysId = _resolveSystemId(state, room)
    if (sysId === 'NONE') continue
    const sys = getCeilingFinishSystem(sysId)
    if (!sys || (sys.materials?.length ?? 0) === 0) continue
    const areaSft = state.getRoomArea?.(rid) ?? 0
    if (areaSft <= 0) continue

    if (!bySystem[sysId]) {
      bySystem[sysId] = {
        systemId:  sysId,
        label:     sys.label,
        areaSft:   0,
        areaSqm:   0,
        rooms:     [],
        materials: [],
        _matAgg:   {},   // { [matId]: { def, qtyTotal } }
      }
    }
    const entry = bySystem[sysId]
    entry.areaSft += areaSft
    entry.areaSqm  = entry.areaSft * SFT_TO_SQM
    entry.rooms.push({ roomId: rid, name: room.name, areaSft: r2(areaSft) })

    for (const mat of sys.materials) {
      // qtyPerM2 is per square metre — multiply by m².
      const areaSqm = areaSft * SFT_TO_SQM
      const qty     = mat.qtyPerM2 * areaSqm
      if (!entry._matAgg[mat.id]) entry._matAgg[mat.id] = { def: mat, qtyTotal: 0 }
      entry._matAgg[mat.id].qtyTotal += qty
    }
  }

  // Finalize material lists per system.
  const perMaterial = []
  for (const sys of Object.values(bySystem)) {
    sys.areaSft = r2(sys.areaSft)
    sys.areaSqm = r2(sys.areaSqm)
    sys.materials = Object.values(sys._matAgg).map(({ def, qtyTotal }) => {
      const rounded = def.unit === 'nos' ? Math.ceil(qtyTotal) : r2(qtyTotal)
      const entry = {
        id:          def.id,
        label:       def.label,
        unit:        def.unit,
        qtyPerM2:    def.qtyPerM2,
        qtyTotal:    rounded,
      }
      perMaterial.push({
        systemId:    sys.systemId,
        systemLabel: sys.label,
        id:          def.id,
        label:       def.label,
        unit:        def.unit,
        qtyTotal:    rounded,
        sourceEntityIds: sys.rooms.map(r => r.roomId),
      })
      return entry
    })
    delete sys._matAgg
  }

  const totals = {
    areaSft: r2(Object.values(bySystem).reduce((s, v) => s + v.areaSft, 0)),
    areaSqm: r2(Object.values(bySystem).reduce((s, v) => s + v.areaSqm, 0)),
  }

  return {
    bySystem,
    perMaterial,
    totals,
    _meta: buildMeta({
      algorithm:          ALGORITHM,
      calculationVersion: CALC_VERSION,
      attributionPolicy:  ATTRIBUTION_POLICY.OWNING_ROOM,
      scoped:             isScopedState(state),
      extras: {
        systemsUsed: Object.keys(bySystem),
        warnings,
      },
    }),
  }
}
