// Generic apply-room-defaults engine.
//
// Discipline modules pass in a catalog (e.g., ROOM_ELECTRICAL_DEFAULTS keyed
// by room type) and this module returns a list of suggested placements for
// every defaulted entry. NO store mutation — caller decides whether to
// commit any of the suggestions.
//
// Deterministic: same room state + same catalog → same suggestions, every
// time. This is load-bearing for verify-mep.mjs stability assertions.

import {
  getRoomSurfaces,
  // MAIN-THREAD-built; assumed to exist at runtime in topology/index.js:
  //   getRoomCentroid(state, roomId) → { x, y } | null
  //   getNearestWallToPoint(state, point, candidateWallIds?) →
  //     { wallId, projected, distance, t } | null
  getRoomCentroid,
  getNearestWallToPoint,
} from '../../topology/index.js'

// Helper: longest interior wall surface of a room (the surface whose other
// side faces another room or whose wall length is greatest). Deterministic
// tie-break by wallId.
function _findLongestInteriorSurface(state, roomId) {
  const surfaces = getRoomSurfaces(state, roomId) ?? []
  // Surfaces shape: array of { wallId, face: 'A'|'B', otherRoomId|null, lengthIn, ... }
  let best = null
  for (const s of surfaces) {
    if (!s || s.otherRoomId == null) continue   // interior only
    if (!best ||
        s.lengthIn > best.lengthIn ||
        (s.lengthIn === best.lengthIn && s.wallId < best.wallId)) {
      best = s
    }
  }
  // Fallback: longest of any wall (external-only rooms still need defaults).
  if (!best) {
    for (const s of surfaces) {
      if (!s) continue
      if (!best ||
          s.lengthIn > best.lengthIn ||
          (s.lengthIn === best.lengthIn && s.wallId < best.wallId)) {
        best = s
      }
    }
  }
  return best
}

// Helper: longest external wall surface (high-mount AC indoor placements).
function _findLongestExternalSurface(state, roomId) {
  const surfaces = getRoomSurfaces(state, roomId) ?? []
  let best = null
  for (const s of surfaces) {
    if (!s || s.otherRoomId != null) continue   // external only
    if (!best ||
        s.lengthIn > best.lengthIn ||
        (s.lengthIn === best.lengthIn && s.wallId < best.wallId)) {
      best = s
    }
  }
  return best
}

// Uniformly-spaced t parameters along [0,1] for `count` items. count=1 → [0.5];
// count=2 → [1/3, 2/3]; etc. Symmetric, deterministic.
function _uniformParams(count) {
  if (count <= 0) return []
  return Array.from({ length: count }, (_, i) => (i + 1) / (count + 1))
}

// Heuristic placement registry. Keyed by point/fixture type id. Each entry
// names the placement strategy. New entries land here when new fixture or
// point types are added.
//
// 'WALL_UNIFORM'    — spaced along longest interior wall.
// 'WALL_CORNERS'    — corner-of-room wall position (t≈0.08, 0.92).
// 'WALL_EXTERNAL_HIGH' — top of external wall (AC indoor).
// 'ROOM_CENTROID'   — geometric center (fans, default for unknowns).
//
// All defaults are SUGGESTED; nothing here mutates state.
const _STRATEGY_BY_TYPE = Object.freeze({
  LIGHT:           'WALL_UNIFORM',
  FAN:             'ROOM_CENTROID',
  EXHAUST_FAN:     'ROOM_CENTROID',
  SOCKET_5A:       'WALL_CORNERS',
  SOCKET_15A:      'WALL_CORNERS',
  AC_INDOOR_POINT: 'WALL_EXTERNAL_HIGH',
  GEYSER_POINT:    'WALL_CORNERS',
})

function _strategyFor(type) {
  return _STRATEGY_BY_TYPE[type] ?? 'ROOM_CENTROID'
}

// Project a t parameter along a wall surface to an (x,y) point. Surfaces
// from getRoomSurfaces are expected to carry .a/.b endpoints (world inches);
// if they don't, fall back to room centroid.
function _projectAlongSurface(surface, t) {
  if (!surface || !surface.a || !surface.b) return null
  return {
    x: surface.a.x + (surface.b.x - surface.a.x) * t,
    y: surface.a.y + (surface.b.y - surface.a.y) * t,
  }
}

export function applyRoomDefaults(state, roomId, catalog, opts = {}) {
  void opts
  if (!state || !roomId || !catalog) return []
  const room = state.rooms?.[roomId]
  if (!room) return []
  const roomType = room.type ?? 'OTHER'
  const defaults = catalog[roomType] ?? catalog.DEFAULT ?? null
  if (!defaults || !Array.isArray(defaults)) return []

  // Group default entries by their placement strategy + (for WALL_UNIFORM)
  // by type, so we can space them uniformly along the longest wall.
  const entries = []
  // Bucket by strategy first.
  const byStrategy = new Map()
  for (const entry of defaults) {
    if (!entry || !entry.type) continue
    const strategy = entry.placement ?? _strategyFor(entry.type)
    const bucket = byStrategy.get(strategy) ?? []
    bucket.push(entry)
    byStrategy.set(strategy, bucket)
  }

  const centroid = getRoomCentroid(state, roomId)
  const longestInterior = _findLongestInteriorSurface(state, roomId)
  const longestExternal = _findLongestExternalSurface(state, roomId)

  for (const [strategy, bucket] of byStrategy) {
    // Stable order within bucket: by type, then by index.
    const ordered = [...bucket].sort((a, b) =>
      a.type < b.type ? -1 : a.type > b.type ? 1 : 0
    )

    if (strategy === 'WALL_UNIFORM' && longestInterior) {
      const ts = _uniformParams(ordered.length * (ordered[0]?.count ?? 1))
      let i = 0
      for (const entry of ordered) {
        const count = Math.max(1, entry.count ?? 1)
        for (let c = 0; c < count; c++) {
          const t = ts[i++] ?? 0.5
          const proj = _projectAlongSurface(longestInterior, t) ?? centroid
          entries.push({
            type: entry.type,
            suggestedX: proj?.x ?? 0,
            suggestedY: proj?.y ?? 0,
            suggestedWallId: longestInterior.wallId,
            suggestedWallT: t,
          })
        }
      }
    } else if (strategy === 'WALL_CORNERS' && longestInterior) {
      // Corners: alternating t = 0.08 + i*step bounded into [0.08, 0.92].
      const count = ordered.reduce((s, e) => s + Math.max(1, e.count ?? 1), 0)
      const cornerTs = count <= 2
        ? [0.08, 0.92].slice(0, count)
        : Array.from({ length: count }, (_, i) =>
            0.08 + (0.84 * i) / (count - 1)
          )
      let i = 0
      for (const entry of ordered) {
        const c = Math.max(1, entry.count ?? 1)
        for (let k = 0; k < c; k++) {
          const t = cornerTs[i++] ?? 0.08
          const proj = _projectAlongSurface(longestInterior, t) ?? centroid
          entries.push({
            type: entry.type,
            suggestedX: proj?.x ?? 0,
            suggestedY: proj?.y ?? 0,
            suggestedWallId: longestInterior.wallId,
            suggestedWallT: t,
          })
        }
      }
    } else if (strategy === 'WALL_EXTERNAL_HIGH' && longestExternal) {
      // Place at midpoint of external wall — height comes from catalog.
      for (const entry of ordered) {
        const c = Math.max(1, entry.count ?? 1)
        for (let k = 0; k < c; k++) {
          const t = 0.5
          const proj = _projectAlongSurface(longestExternal, t) ?? centroid
          entries.push({
            type: entry.type,
            suggestedX: proj?.x ?? 0,
            suggestedY: proj?.y ?? 0,
            suggestedWallId: longestExternal.wallId,
            suggestedWallT: t,
          })
        }
      }
    } else {
      // ROOM_CENTROID (default fallback).
      const near = centroid
        ? getNearestWallToPoint(state, centroid)
        : null
      for (const entry of ordered) {
        const c = Math.max(1, entry.count ?? 1)
        for (let k = 0; k < c; k++) {
          entries.push({
            type: entry.type,
            suggestedX: centroid?.x ?? 0,
            suggestedY: centroid?.y ?? 0,
            suggestedWallId: near?.wallId ?? null,
            suggestedWallT:  near?.t ?? null,
          })
        }
      }
    }
  }

  // Deterministic output order: by (type, x, y).
  entries.sort((a, b) =>
    a.type < b.type ? -1 :
    a.type > b.type ?  1 :
    a.suggestedX - b.suggestedX || a.suggestedY - b.suggestedY
  )
  return entries
}
