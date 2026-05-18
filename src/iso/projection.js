// Iso projection — fixed 30°/30° standard isometric, pure math.
//
// World axes (matching the store):
//   x  →  east   (plan-X, inches, store's wall.x)
//   y  →  north  (plan-Y, inches, store's wall.y)
//   z  →  up     (elevation, inches; positive above ground, negative below)
//
// Iso projection (camera looking at world origin from a corner up-and-back):
//   sx = (x - y) * cos(30°)
//   sy = -(x + y) * sin(30°) - z      (SVG y-down, so larger z → smaller sy = higher on screen)
//
// All inputs/outputs are in inches. The IsoScene component multiplies by a
// pixels-per-inch factor at render time, so this module stays unit-agnostic.

export const COS30 = Math.cos(Math.PI / 6)   // ≈ 0.8660254
export const SIN30 = 0.5

export function worldToIso(x, y, z) {
  return {
    sx:  (x - y) * COS30,
    sy: -(x + y) * SIN30 - z,
  }
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
