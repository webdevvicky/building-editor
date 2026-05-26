// Iso projection — parameterised orthographic, pure math.
//
// World axes (matching the store):
//   x  →  east   (plan-X, inches, store's wall.x)
//   y  →  north  (plan-Y, inches, store's wall.y)
//   z  →  up     (elevation, inches; positive above ground, negative below)
//
// View = { azimuthDeg, elevationDeg }
//   azimuthDeg   — compass azimuth of the camera position. 45 = NE corner
//                  (default, matches the historical fixed view). 135 = SE,
//                  225 = SW, 315 = NW.
//   elevationDeg — screen-tilt angle for the X/Y axes (engineering iso
//                  convention). 30 = standard isometric drawing. Lower
//                  approaches a side elevation, higher approaches plan.
//
// At { azimuthDeg: 45, elevationDeg: 30 } the projection reproduces the
// historical fixed 30° iso byte-for-byte:
//   sx =  (x - y) * cos30
//   sy = -(x + y) * sin30 - z
//
// All inputs/outputs are in inches. The IsoScene component multiplies by a
// pixels-per-inch factor at render time, so this module stays unit-agnostic.

export const COS30 = Math.cos(Math.PI / 6)   // ≈ 0.8660254
export const SIN30 = 0.5

export const DEFAULT_VIEW = Object.freeze({ azimuthDeg: 45, elevationDeg: 30 })

// Elevation threshold above which makeViewBasis switches to a true
// orthographic plan projection. The engineering-iso formula degenerates
// at el=90° (the `right` basis collapses to zero because of cos(el)),
// so above this threshold we project plan-view directly: x/y onto screen,
// z onto the depth axis. Anything in [10°, 70°] (the orbit-drag range)
// uses the engineering-iso path and is unaffected.
export const TOP_VIEW_THRESHOLD_DEG = 89.5

// Build the camera basis vectors for a given view. Cached by the caller —
// every per-vertex projection re-uses the same basis without re-evaluating
// trig.
//
// Returns { right, up, forward }, each a 3-tuple in world coordinates:
//   right   — world direction that maps to screen +sx (right on screen)
//   up      — world direction that maps to screen -sy (up on screen, since
//             SVG y-down means screen-sy = -dot(world, up))
//   forward — world direction along camera→scene depth axis. Larger
//             dot(centroid, forward) = farther back. Used by the
//             painter's-algorithm sort.
export function makeViewBasis(view) {
  const azDeg = view?.azimuthDeg ?? DEFAULT_VIEW.azimuthDeg
  const elDeg = view?.elevationDeg ?? DEFAULT_VIEW.elevationDeg

  // Top-down plan projection. The azimuth still rotates the floor plan
  // so users can orient north however they prefer; elevation has no
  // further effect once we're looking straight down. Depth axis is -z
  // (camera looks down, so lower-z faces are farther from the camera
  // and get drawn first).
  if (elDeg >= TOP_VIEW_THRESHOLD_DEG) {
    const azRad = azDeg * Math.PI / 180
    const ca = Math.cos(azRad), sa = Math.sin(azRad)
    return Object.freeze({
      right:   Object.freeze([  ca,  sa, 0 ]),
      up:      Object.freeze([ -sa,  ca, 0 ]),
      forward: Object.freeze([   0,   0, -1 ]),
    })
  }

  const delta = (azDeg - 45) * Math.PI / 180
  const elRad = elDeg * Math.PI / 180
  const ca = Math.cos(delta), sa = Math.sin(delta)
  const ce = Math.cos(elRad), se = Math.sin(elRad)

  // Effective transform: pre-rotate world by -delta around Z, then apply
  // the engineering-iso formula sx = (x' - y') * cos(el),
  // sy = -(x' + y') * sin(el) - z. Expanding with
  //   x' = x*ca + y*sa,  y' = -x*sa + y*ca
  // gives the basis below.
  return Object.freeze({
    right:   Object.freeze([ (ca + sa) * ce, (sa - ca) * ce, 0 ]),
    up:      Object.freeze([ (ca - sa) * se, (sa + ca) * se, 1 ]),
    forward: Object.freeze([ (ca - sa),       (ca + sa),     0 ]),
  })
}

// Convenience basis cached at module load — covers callers that just want
// the historical default view.
export const DEFAULT_BASIS = makeViewBasis(DEFAULT_VIEW)

export function worldToIso(x, y, z, basis = DEFAULT_BASIS) {
  const r = basis.right, u = basis.up
  return {
    sx:   x * r[0] + y * r[1] + z * r[2],
    sy: -(x * u[0] + y * u[1] + z * u[2]),
  }
}

export function viewForward(basis = DEFAULT_BASIS) {
  return basis.forward
}

// Sort floors by `sequence` ascending — every iso computation should use this
// canonical order so floor stacking is deterministic regardless of insertion
// order in the project file.
export function sortedFloors(floors) {
  return [...(floors || [])].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
}

// Returns the elevation Z (inches) of the base of `floorId` — i.e., the
// elevation where the walls of that floor start. Includes accumulated
// floor heights + slab thicknesses for all floors below, plus the optional
// exploded gap between floors (for the iso "exploded view").
//
//   slabThicknessIn — between-floor slab thickness (typically the project's
//                     mainThicknessIn). Added once per floor below the target.
//   explodedGapIn   — visual-only gap added between stacked floors. 0 = no
//                     gap (true elevation). Default in IsoView is 24in.
//
// floorBaseZIn(F1) = F1.plinthHeightFt × 12
// floorBaseZIn(F2) = F1.plinthHeightFt × 12 + F1.floorHeightFt × 12
//                  + slabThicknessIn + explodedGapIn + F2.plinthHeightFt × 12
export function floorBaseZIn(sortedFloorList, floorId, slabThicknessIn = 0, explodedGapIn = 0) {
  if (!sortedFloorList || sortedFloorList.length === 0) return 0
  const idx = sortedFloorList.findIndex(f => f.id === floorId)
  if (idx < 0) return 0
  let z = 0
  for (let i = 0; i < idx; i++) {
    z += (sortedFloorList[i].plinthHeightFt ?? 0) * 12
    z += (sortedFloorList[i].floorHeightFt  ?? 0) * 12
    z += slabThicknessIn
    z += explodedGapIn
  }
  z += (sortedFloorList[idx].plinthHeightFt ?? 0) * 12
  return z
}

// Top of a floor's open space (where the roof slab sits ON top of). Walls and
// columns on this floor terminate at this Z; the slab occupies [top, top + slabThk].
export function floorTopZIn(sortedFloorList, floorId, slabThicknessIn, explodedGapIn) {
  const base = floorBaseZIn(sortedFloorList, floorId, slabThicknessIn, explodedGapIn)
  const f = sortedFloorList.find(fl => fl.id === floorId)
  return base + (f?.floorHeightFt ?? 0) * 12
}
