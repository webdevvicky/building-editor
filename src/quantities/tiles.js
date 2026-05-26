// Tiles, skirting, kitchen counter quantity aggregator.
//
// Per-room rollup with attribution policy = INTERIOR_ONLY (each room
// claims its own interior face only — partitions get the per-room half
// naturally because Pass 1 iterates each room and only its own face is
// in scope; this differs from plaster which intentionally double-counts
// both inner faces).
//
// Geometry contract (Rev 2 Correction 2): perimeter / longest-edge
// derive from getRoomPolygon edge loop via topology helpers. NEVER from
// summing wall entity lengths — splits make that drift.
//
// Outputs (per room + totals):
//   floorTilesFt2     — room area × floorTileAllowance (when finishes.flooring)
//   wallTilesFt2      — perimeter × dadoHeightFt − door deductions × allowance
//   skirtingRft       — perimeter when included (override-aware) AND dado=0
//                       (dado supersedes skirting)
//   kitchenCounterFt2 — KITCHEN only: lengthFt × depthFt
//
// 2026-05-26 — extended for per-room overrides + FULL sentinel:
//   - room.dadoHeightFt: number | 'FULL' | null
//       null  → inherit projectSettings.tileDefaults.dadoHeightsFt[room.type]
//       'FULL' → resolve to floor-height − slab-thickness (room's floor)
//       number → explicit numeric override (feet)
//   - room.includeSkirting: boolean | null
//       null  → derive from default rule (room.type ∈ skirtingApplyToTypes
//               AND dadoFt === 0 AND finishes.flooring)
//       true  → force include
//       false → force exclude
//   - tileDefaults.dadoHeightsFt[type] may also carry 'FULL' sentinel.
//
// MANDATORY INVARIANT — pure function of state, no rendered geometry.
// Reads state.rooms / state.walls / projectSettings; perimeter via
// getRoomPerimeterFt (polygon-based, NOT wallIds).

import { getValidRoomIds, getRoomArea, getRoomPerimeterFt, getLongestPolygonEdgeFt } from '../topology/rooms.js'
import { getRoomsForWall } from '../topology/walls.js'
import { buildMeta, ATTRIBUTION_POLICY, isScopedState } from './_metaContract.js'

const ALGORITHM = 'ROOM_TILE_ROLLUP_V1'
const CALC_VERSION = '2026-05-26'

const FULL_SENTINEL = 'FULL'

function r2(n) { return Math.round(n * 100) / 100 }

// Compute "full height" for tiles = floor-height − slab-thickness, in feet.
// Picks the floor matching room.floorId; defaults to floors[0]; falls back
// to 10ft / 5in if neither is set (matches DEFAULT_PROJECT_SETTINGS).
export function _fullHeightFt(state, room) {
  const ps = state?.projectSettings ?? {}
  const floors = Array.isArray(ps.floors) ? ps.floors : []
  const floor = floors.find(f => f.id === room?.floorId) ?? floors[0] ?? null
  const floorHeightFt = floor?.floorHeightFt ?? ps.heights?.floorHeightFt ?? 10
  const slabIn        = ps.slabSettings?.mainThicknessIn ?? 5
  return Math.max(0, floorHeightFt - slabIn / 12)
}

// Resolve effective dado height for a room. Handles:
//   - explicit numeric override on room (room.dadoHeightFt: number)
//   - FULL sentinel on room (resolved against room's floor)
//   - falls through to projectSettings.tileDefaults.dadoHeightsFt[type]
//   - which may itself be the FULL sentinel
//   - final fallback: 0
export function _resolveDadoFt(room, state) {
  const v = room?.dadoHeightFt
  if (typeof v === 'number') return v
  if (v === FULL_SENTINEL)   return _fullHeightFt(state, room)
  const map = state?.projectSettings?.tileDefaults?.dadoHeightsFt ?? {}
  const def = map[room?.type] ?? map.OTHER
  if (def === FULL_SENTINEL) return _fullHeightFt(state, room)
  return typeof def === 'number' ? def : 0
}

// Resolve dado source label — used by RoomDetailPanel badge.
// Returns 'override' | 'override-full' | 'default' | 'default-full' | 'none'.
export function _resolveDadoSource(room, state) {
  const v = room?.dadoHeightFt
  if (v === FULL_SENTINEL)   return 'override-full'
  if (typeof v === 'number') return 'override'
  const map = state?.projectSettings?.tileDefaults?.dadoHeightsFt ?? {}
  const def = map[room?.type] ?? map.OTHER
  if (def === FULL_SENTINEL) return 'default-full'
  if (typeof def === 'number' && def > 0) return 'default'
  return 'none'
}

// Resolve effective skirting inclusion.
// Override (true/false) wins over the default rule.
// Default rule: room.type ∈ skirtingApplyToTypes AND dadoFt === 0
//               AND finishes.flooring.
function _includeSkirting(room, dadoFt, skirtingTypes) {
  if (room?.includeSkirting === true)  return true
  if (room?.includeSkirting === false) return false
  return dadoFt === 0
      && skirtingTypes.has(room?.type)
      && !!room?.finishes?.flooring
}

// UI helper — surfaces *why* skirting was included / excluded.
// 'override-on' | 'override-off' | 'default-on' | 'default-off-dado' |
// 'default-off-type' | 'default-off-no-flooring'.
export function _resolveSkirtingSource(room, state) {
  if (room?.includeSkirting === true)  return 'override-on'
  if (room?.includeSkirting === false) return 'override-off'
  const dadoFt = _resolveDadoFt(room, state)
  if (dadoFt > 0) return 'default-off-dado'
  const types = new Set(state?.projectSettings?.tileDefaults?.skirtingApplyToTypes ?? [])
  if (!types.has(room?.type)) return 'default-off-type'
  if (!room?.finishes?.flooring) return 'default-off-no-flooring'
  return 'default-on'
}

function _kitchenCounterFt2(state, room, projectSettings) {
  if (room.type !== 'KITCHEN') return 0
  const def = projectSettings?.kitchenCounter
                ?? { defaultDepthFt: 2, defaultLengthMode: 'longest_wall' }
  const override = room.kitchenCounter
  if (override) {
    return r2((override.lengthFt ?? 0) * (override.depthFt ?? def.defaultDepthFt))
  }
  const depthFt = def.defaultDepthFt
  let lengthFt = 0
  if (def.defaultLengthMode === 'half_perimeter') {
    lengthFt = getRoomPerimeterFt(state, room.id) / 2
  } else if (def.defaultLengthMode === 'manual') {
    lengthFt = 0   // no entry → no counter
  } else {
    // 'longest_wall' (default)
    lengthFt = getLongestPolygonEdgeFt(state, room.id)
  }
  return r2(lengthFt * depthFt)
}

// Compute door-opening deduction for wall tiles on a room boundary.
// Subtract min(doorWidth, perimeter overlap) × min(doorHeight, dadoHeight)
// for each door whose wall is in room.wallIds.
function _doorDeductionFt2(state, room, dadoHeightFt) {
  if (dadoHeightFt <= 0) return 0
  let totalIn2 = 0
  for (const wid of (room.wallIds ?? [])) {
    const wall = state.walls?.[wid]
    if (!wall || wall.isVirtual || wall.isPlot) continue
    for (const op of (wall.openings ?? [])) {
      if (op.type !== 'door') continue
      const dh = Math.min(op.height ?? 0, dadoHeightFt * 12)
      totalIn2 += (op.width ?? 0) * dh
    }
  }
  return totalIn2 / 144
}

export function computeTileQuantities(state) {
  const projectSettings = state.projectSettings ?? {}
  const tileDefaults    = projectSettings.tileDefaults ?? {}
  const floorAllowance  = tileDefaults.floorTileAllowance ?? 1.05
  const wallAllowance   = tileDefaults.wallTileAllowance  ?? 1.10
  const skirtingTypes   = new Set(tileDefaults.skirtingApplyToTypes ?? [])
  const skirtingHeightIn = tileDefaults.skirtingHeightIn ?? 4

  const perRoom = []
  for (const rid of getValidRoomIds(state)) {
    const room = state.rooms[rid]
    if (!room) continue
    const dadoFt = _resolveDadoFt(room, state)
    const dadoSource = _resolveDadoSource(room, state)
    const perimeterFt = getRoomPerimeterFt(state, rid)
    const floorAreaFt2 = getRoomArea(state, rid)

    const floorTilesFt2 = room.finishes?.flooring
      ? r2(floorAreaFt2 * floorAllowance)
      : 0

    let wallTilesFt2 = 0
    if (dadoFt > 0) {
      const gross   = perimeterFt * dadoFt
      const deducts = _doorDeductionFt2(state, room, dadoFt)
      wallTilesFt2 = r2(Math.max(0, gross - deducts) * wallAllowance)
    }

    // Skirting only when included (override or default rule) AND no dado.
    let skirtingRft = 0
    const skirtingIncluded = _includeSkirting(room, dadoFt, skirtingTypes)
    if (skirtingIncluded && dadoFt === 0) {
      // Subtract door widths on perimeter (no skirting across doorways).
      let doorWidthFt = 0
      for (const wid of (room.wallIds ?? [])) {
        const wall = state.walls?.[wid]
        for (const op of (wall?.openings ?? [])) {
          if (op.type === 'door') doorWidthFt += (op.width ?? 0) / 12
        }
      }
      skirtingRft = r2(Math.max(0, perimeterFt - doorWidthFt))
    }

    const kitchenCounterFt2 = _kitchenCounterFt2(state, room, projectSettings)

    perRoom.push({
      roomId:           rid,
      roomType:         room.type,
      roomName:         room.name,
      floorId:          room.floorId ?? null,
      perimeterFt:      r2(perimeterFt),
      dadoHeightFt:     dadoFt,
      dadoSource,
      floorTilesFt2,
      wallTilesFt2,
      skirtingRft,
      skirtingIncluded,
      skirtingSource:   _resolveSkirtingSource(room, state),
      skirtingHeightIn,
      kitchenCounterFt2,
    })
  }

  // Totals + per-room-type buckets.
  const totals = { floorTilesFt2: 0, wallTilesFt2: 0, skirtingRft: 0, kitchenCounterFt2: 0 }
  const byRoomType = {}
  for (const p of perRoom) {
    totals.floorTilesFt2     += p.floorTilesFt2
    totals.wallTilesFt2      += p.wallTilesFt2
    totals.skirtingRft       += p.skirtingRft
    totals.kitchenCounterFt2 += p.kitchenCounterFt2
    if (!byRoomType[p.roomType]) {
      byRoomType[p.roomType] = { floorTilesFt2: 0, wallTilesFt2: 0, skirtingRft: 0, kitchenCounterFt2: 0, rooms: [] }
    }
    const b = byRoomType[p.roomType]
    b.floorTilesFt2     += p.floorTilesFt2
    b.wallTilesFt2      += p.wallTilesFt2
    b.skirtingRft       += p.skirtingRft
    b.kitchenCounterFt2 += p.kitchenCounterFt2
    b.rooms.push(p.roomId)
  }
  for (const k of Object.keys(totals)) totals[k] = r2(totals[k])
  for (const t of Object.keys(byRoomType)) {
    for (const k of ['floorTilesFt2','wallTilesFt2','skirtingRft','kitchenCounterFt2']) {
      byRoomType[t][k] = r2(byRoomType[t][k])
    }
  }

  return {
    perRoom,
    totals,
    byRoomType,
    _meta: buildMeta({
      algorithm:          ALGORITHM,
      calculationVersion: CALC_VERSION,
      attributionPolicy:  ATTRIBUTION_POLICY.INTERIOR_ONLY,
      scoped:             isScopedState(state),
      extras:             {
        allowances:        { floor: floorAllowance, wall: wallAllowance },
        skirtingHeightIn,
        fullSentinelValue: FULL_SENTINEL,
      },
    }),
  }
}

// Re-exports for callers that need direct topology / resolution helpers.
export { getRoomsForWall }
export { FULL_SENTINEL }
