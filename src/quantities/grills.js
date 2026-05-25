// MS Grills and handrails quantity aggregator.
//
// Three groups:
//   1. Window grills        — Sft, sum of window opening areas where grill
//                             is enabled (per-opening override OR project
//                             default + external-only filter).
//   2. Main door safety grill — Nos, count of MAIN_DOOR subtype openings
//                             with grill enabled.
//   3. Handrails:
//      - Staircase handrails — Rft, per staircase × 2 sides.
//      - Balcony handrails   — Rft, per BALCONY room's polygon edges that
//                             match the railing rule (external OR
//                             explicit wall.hasBalconyRailingEdge).
//
// Attribution policy: NONE for project-level totals; per-opening / per-
// balcony breakdown lists carry their own roomId / floorId so room-scope
// wrappers can filter. Staircase handrails are PROJECT/FLOOR scope only
// (declared via scopeSupport in boq/lines.js).
//
// Geometry contract: polygon-derived perimeter via topology helpers
// (Correction 2). No wall-length summing for any linear quantity.

import { OPENING_SUBTYPE } from '../constants/joinery.js'
import { getValidRoomIds, getRoomPolygon } from '../topology/rooms.js'
import { isExternalWall } from '../topology/walls.js'
import { getWallSurfaces } from '../topology/surfaces.js'
import { buildMeta, ATTRIBUTION_POLICY, isScopedState } from './_metaContract.js'

const ALGORITHM = 'GRILL_ROLLUP_V1'
const CALC_VERSION = '2026-05-25'
const GRID_IN = 12
const LARGE_DOOR_FT = 4  // doors wider than this cut a balcony rail

function r2(n) { return Math.round(n * 100) / 100 }

// Resolve effective opening-grill flag (per-opening override → project default).
function _openingHasGrill(state, wall, opening, projectSettings) {
  if (opening.hasGrill === true)  return true
  if (opening.hasGrill === false) return false
  // null → inherit
  const grills = projectSettings?.grills ?? {}
  if (opening.subtype === OPENING_SUBTYPE.MAIN_DOOR) {
    return Boolean(grills.mainDoorSafetyGrillEnabled)
  }
  if (opening.type === 'window') {
    if (!grills.windowGrillEnabled) return false
    if (grills.windowGrillExternalOnly) {
      return _wallIsExternalOrRailing(state, wall)
    }
    return true
  }
  return false
}

function _wallIsExternalOrRailing(state, wall) {
  if (wall.hasBalconyRailingEdge === true)  return true
  if (wall.hasBalconyRailingEdge === false) return false
  return isExternalWall(state, wall.id)
}

// Per-staircase handrail length (Rft, both sides).
function _staircaseHandrailRft(sc) {
  const treadFt    = (sc.treadIn  ?? 0) / 12
  const riserFt    = (sc.riserIn  ?? 0) / 12
  const stepsPF    = sc.stepsPerFlight ?? 0
  const flightCt   = sc.flightCount    ?? 0
  if (treadFt <= 0 || stepsPF <= 0 || flightCt <= 0) return 0
  const flightLen  = Math.hypot(treadFt * stepsPF, riserFt * stepsPF)
  const landingEdge = sc.landingFtWidth ?? 0
  const oneSide    = flightLen * flightCt + landingEdge * Math.max(0, flightCt - 1)
  return r2(oneSide * 2)   // both sides
}

// Per-BALCONY-room handrail length via polygon edge inspection.
// Each edge is owned by a single wall (via getWallSurfaces); count its
// polygon length when the railing rule fires. Door widths on counted
// edges are subtracted.
function _balconyHandrailRft(state, room) {
  const poly = getRoomPolygon(state, room.id)
  if (!poly || poly.length < 3) return 0
  // Match polygon edge → wall via shared node pair (n1,n2) ↔ poly[i],poly[i+1].
  // Build node-pair→wall index for this room.
  const wallByNodePair = new Map()
  for (const wid of (room.wallIds ?? [])) {
    const w = state.walls?.[wid]
    if (!w) continue
    const k1 = `${w.n1}|${w.n2}`
    const k2 = `${w.n2}|${w.n1}`
    wallByNodePair.set(k1, w)
    wallByNodePair.set(k2, w)
  }

  let totalIn = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const wall = _findWallForEdge(state, a, b, wallByNodePair)
    if (!wall) continue
    if (!_isRailingEdge(state, wall)) continue
    const edgeIn = Math.hypot(b.x - a.x, b.y - a.y)
    // Subtract large door widths on this wall.
    let doorIn = 0
    for (const op of (wall.openings ?? [])) {
      if (op.type !== 'door') continue
      if ((op.width ?? 0) / GRID_IN >= LARGE_DOOR_FT) doorIn += op.width ?? 0
    }
    totalIn += Math.max(0, edgeIn - doorIn)
  }
  return r2(totalIn / GRID_IN)
}

function _findWallForEdge(state, a, b, wallByNodePair) {
  // Iterate map looking for the wall whose nodes are at points a,b. The
  // wallByNodePair indexes by node-id; we resolve via state.nodes equality.
  for (const wall of wallByNodePair.values()) {
    const n1 = state.nodes?.[wall.n1]
    const n2 = state.nodes?.[wall.n2]
    if (!n1 || !n2) continue
    if ((n1.x === a.x && n1.y === a.y && n2.x === b.x && n2.y === b.y)
     || (n1.x === b.x && n1.y === b.y && n2.x === a.x && n2.y === a.y)) {
      return wall
    }
  }
  return null
}

function _isRailingEdge(state, wall) {
  if (wall.isVirtual || wall.isPlot) return false
  // Explicit override wins.
  if (wall.hasBalconyRailingEdge === true)  return true
  if (wall.hasBalconyRailingEdge === false) return false
  // Heuristic: external + no door > LARGE_DOOR_FT.
  if (!isExternalWall(state, wall.id)) return false
  for (const op of (wall.openings ?? [])) {
    if (op.type === 'door' && (op.width ?? 0) / GRID_IN >= LARGE_DOOR_FT) return false
  }
  return true
}

export function computeGrillQuantities(state) {
  const projectSettings = state.projectSettings ?? {}
  const grillsSettings  = projectSettings.grills ?? {}

  // ── Window grills + main-door grills ────────────────────────────────────
  let windowGrillFt2 = 0
  let mainDoorGrillCount = 0
  const perWindow = []
  for (const wall of Object.values(state.walls ?? {})) {
    if (wall.isVirtual || wall.isPlot) continue
    for (const op of (wall.openings ?? [])) {
      const has = _openingHasGrill(state, wall, op, projectSettings)
      if (!has) continue
      if (op.type === 'window') {
        const areaFt2 = ((op.width ?? 0) * (op.height ?? 0)) / 144
        windowGrillFt2 += areaFt2
        perWindow.push({ wallId: wall.id, openingId: op.id, areaFt2: r2(areaFt2), floorId: wall.floorId ?? null })
      } else if (op.type === 'door' && op.subtype === OPENING_SUBTYPE.MAIN_DOOR) {
        mainDoorGrillCount += 1
      }
    }
  }

  // ── Staircase handrails ─────────────────────────────────────────────────
  const perStaircase = []
  let staircaseHandrailRft = 0
  if (grillsSettings.staircaseHandrailEnabled !== false) {
    for (const sc of Object.values(state.staircases ?? {})) {
      const enabled = sc.hasHandrail === false
        ? false
        : (sc.hasHandrail === true || grillsSettings.staircaseHandrailEnabled !== false)
      if (!enabled) continue
      const rft = _staircaseHandrailRft(sc)
      if (rft <= 0) continue
      perStaircase.push({
        staircaseId:    sc.id,
        floorId:        sc.floorId ?? null,
        lengthRft:      rft,
        breakdown: {
          flightCount:    sc.flightCount,
          stepsPerFlight: sc.stepsPerFlight,
          treadIn:        sc.treadIn,
          riserIn:        sc.riserIn,
          landingFtWidth: sc.landingFtWidth,
        },
      })
      staircaseHandrailRft += rft
    }
  }

  // ── Balcony handrails ───────────────────────────────────────────────────
  const perBalcony = []
  let balconyHandrailRft = 0
  if (grillsSettings.balconyHandrailEnabled !== false) {
    for (const rid of getValidRoomIds(state)) {
      const room = state.rooms[rid]
      if (!room || room.type !== 'BALCONY') continue
      // Per-room override.
      const ovr = room.balconyHandrail
      const enabled = (ovr?.enabled === false)
        ? false
        : (ovr?.enabled === true || grillsSettings.balconyHandrailEnabled !== false)
      if (!enabled) continue
      const rft = _balconyHandrailRft(state, room)
      if (rft <= 0) continue
      perBalcony.push({ roomId: rid, floorId: room.floorId ?? null, lengthRft: rft })
      balconyHandrailRft += rft
    }
  }

  return {
    windowGrillFt2:        r2(windowGrillFt2),
    mainDoorGrillCount,
    staircaseHandrailRft:  r2(staircaseHandrailRft),
    balconyHandrailRft:    r2(balconyHandrailRft),
    perWindow,
    perStaircase,
    perBalcony,
    _meta: buildMeta({
      algorithm:          ALGORITHM,
      calculationVersion: CALC_VERSION,
      attributionPolicy:  ATTRIBUTION_POLICY.OWNING_ROOM,
      scoped:             isScopedState(state),
      extras:             {
        largeDoorThresholdFt: LARGE_DOOR_FT,
      },
    }),
  }
}
