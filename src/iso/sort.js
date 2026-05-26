// Painter's-algorithm sort. The painter draws BACK faces first so FRONT
// faces overlay them. "Back" = farther from the camera = larger
// dot(centroid, viewForward).
//
// At the default 45°/30° iso, viewForward ≈ (1, 1, 0), so depth = x + y —
// matches the historical fixed-iso behaviour byte-for-byte.
//
// Ties in depth are broken — in order — by:
//   z ascending           — low geometry drawn first so taller things overlay
//   entityId ascending    — stable per face-pair regardless of build order
//   faceKind ascending    — top vs side vs bottom is deterministic
//   originalIndex asc.    — pre-sort insertion order is the final fallback
//
// The extra stable keys matter most during rotation: with only (depth, z)
// you get visible flicker as nearly-coplanar faces swap order one frame to
// the next.
//
// This is imperfect for adjacent walls sharing a node — their faces are
// co-planar at the seam, so the painter algorithm can still flicker on
// some camera angles. IsoScene renders a thin stroke around every face
// to mask the seam (see iso.css).

import { DEFAULT_BASIS, viewForward } from './projection'

export function makeBackToFrontComparator(basis = DEFAULT_BASIS) {
  const f = viewForward(basis)
  const fx = f[0], fy = f[1], fz = f[2]
  return function compareFacesBackToFront(a, b) {
    const da = a.centroid[0] * fx + a.centroid[1] * fy + a.centroid[2] * fz
    const db = b.centroid[0] * fx + b.centroid[1] * fy + b.centroid[2] * fz
    // Back first: larger depth drawn first → comparator returns < 0 when
    // a should come BEFORE b. a comes before b when a is FARTHER (larger
    // depth). So we want a-first when da > db, i.e., return db - da.
    if (da !== db) return db - da

    // z ascending — low drawn first so high overlays.
    const az = a.centroid[2], bz = b.centroid[2]
    if (az !== bz) return az - bz

    // entityId ascending. Treat null/undefined as the empty string so the
    // comparator is total.
    const ae = a.entityId ?? '', be = b.entityId ?? ''
    if (ae !== be) return ae < be ? -1 : 1

    // faceKind ascending. ('bottom' < 'side' < 'top' alphabetically — fine.)
    const ak = a.faceKind ?? '', bk = b.faceKind ?? ''
    if (ak !== bk) return ak < bk ? -1 : 1

    // originalIndex — final, ALWAYS-distinct fallback. extrude.js stamps
    // every face with a monotonically increasing index before this sort.
    return (a.originalIndex ?? 0) - (b.originalIndex ?? 0)
  }
}

// Legacy default-basis comparator — kept so any non-IsoView callers
// continue to compile. Equivalent to makeBackToFrontComparator() at the
// default view.
export const compareFacesBackToFront = makeBackToFrontComparator(DEFAULT_BASIS)
