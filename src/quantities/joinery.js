// Joinery (doors / windows / ventilators) quantity aggregator.
//
// Rolls every opening up to its `subtype` bucket and emits per-subtype
// frame perimeter (Rft), shutter area (Sft), and counts.
//
// Attribution policy: OWNING_ROOM — every opening is attributed to the
// room owning its primary interior face. Used by room-scope filtering
// in scope.js wrappers. Project-level totals are unaffected.
//
// Units (Rev 2 Correction 3):
//   Frame perimeter = 2*(w+h)/12  → Rft
//   Shutter area    = (w*h)/144   → Sft
//   Ventilator area = (w*h)/144   → Sft (no shutter; frame + area only)
//
// MANDATORY INVARIANT — pure function of state. No mutation, no rendered/
// visual geometry. Reads `state.walls` directly; consumes the
// subtype field stamped on every opening by addOpening / loadProject.

import { OPENING_SUBTYPE } from '../constants/joinery.js'
import { getWallSurfaces } from '../topology/surfaces.js'
import { buildMeta, ATTRIBUTION_POLICY, isScopedState } from './_metaContract.js'
import { safeR2 as r2 } from '../lib/numbers.js'

const ALGORITHM = 'OPENING_SUBTYPE_ROLLUP_V1'
const CALC_VERSION = '2026-05-25'

function frameRft(o) {
  const w = (o.width  ?? 0) / 12
  const h = (o.height ?? 0) / 12
  return 2 * (w + h)
}
function shutterFt2(o) {
  const w = (o.width  ?? 0) / 12
  const h = (o.height ?? 0) / 12
  return w * h
}

// Pick the room id this opening should attribute to — owning room of
// the primary interior face. Used for per-room scope filtering; project
// totals iterate every opening regardless.
function _attributeToRoom(state, wallId) {
  const surfaces = getWallSurfaces(state, wallId)
  if (!surfaces) return null
  const a = surfaces.faceA?.roomId
  const b = surfaces.faceB?.roomId
  if (a && b) return a < b ? a : b   // deterministic tiebreak by id
  return a ?? b ?? null
}

function emptyBucket() {
  return { count: 0, frameRft: 0, shutterFt2: 0, instances: [] }
}

export function computeJoineryQuantities(state) {
  const bySubtype = {
    [OPENING_SUBTYPE.MAIN_DOOR]:     emptyBucket(),
    [OPENING_SUBTYPE.INTERNAL_DOOR]: emptyBucket(),
    [OPENING_SUBTYPE.WINDOW]:        emptyBucket(),
    [OPENING_SUBTYPE.VENTILATOR]:    emptyBucket(),
  }
  const perInstance = []

  for (const wall of Object.values(state.walls ?? {})) {
    if (wall.isVirtual || wall.isPlot) continue
    const attributedRoomId = _attributeToRoom(state, wall.id)
    for (const op of (wall.openings ?? [])) {
      const subtype = op.subtype
      if (!subtype || !bySubtype[subtype]) continue
      const fr = frameRft(op)
      const sh = shutterFt2(op)
      const bucket = bySubtype[subtype]
      bucket.count      += 1
      bucket.frameRft   += fr
      bucket.shutterFt2 += sh
      const inst = {
        wallId:           wall.id,
        openingId:        op.id,
        type:             op.type,
        subtype,
        widthIn:          op.width,
        heightIn:         op.height,
        frameRft:         r2(fr),
        shutterFt2:       r2(sh),
        roomId:           attributedRoomId,
        floorId:          wall.floorId ?? null,
      }
      bucket.instances.push(inst)
      perInstance.push(inst)
    }
  }

  // Round bucket totals.
  for (const k of Object.keys(bySubtype)) {
    bySubtype[k].frameRft   = r2(bySubtype[k].frameRft)
    bySubtype[k].shutterFt2 = r2(bySubtype[k].shutterFt2)
  }

  const totals = {
    doorCount:        bySubtype[OPENING_SUBTYPE.MAIN_DOOR].count
                    + bySubtype[OPENING_SUBTYPE.INTERNAL_DOOR].count,
    windowCount:      bySubtype[OPENING_SUBTYPE.WINDOW].count,
    ventilatorCount:  bySubtype[OPENING_SUBTYPE.VENTILATOR].count,
    doorFrameRft:     r2(bySubtype[OPENING_SUBTYPE.MAIN_DOOR].frameRft
                       + bySubtype[OPENING_SUBTYPE.INTERNAL_DOOR].frameRft),
    doorShutterFt2:   r2(bySubtype[OPENING_SUBTYPE.MAIN_DOOR].shutterFt2
                       + bySubtype[OPENING_SUBTYPE.INTERNAL_DOOR].shutterFt2),
    windowFrameRft:   bySubtype[OPENING_SUBTYPE.WINDOW].frameRft,
    windowShutterFt2: bySubtype[OPENING_SUBTYPE.WINDOW].shutterFt2,
    ventilatorFrameRft: bySubtype[OPENING_SUBTYPE.VENTILATOR].frameRft,
    ventilatorAreaFt2:  bySubtype[OPENING_SUBTYPE.VENTILATOR].shutterFt2,
  }

  return {
    bySubtype,
    totals,
    _meta: buildMeta({
      algorithm:          ALGORITHM,
      calculationVersion: CALC_VERSION,
      attributionPolicy:  ATTRIBUTION_POLICY.OWNING_ROOM,
      scoped:             isScopedState(state),
      extras:             { perInstance },
    }),
  }
}
