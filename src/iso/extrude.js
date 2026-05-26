// Extrude a Solid (from src/iso/solids.js) into a flat list of render-ready
// faces. PURE module — no React, no store, no DOM.
//
// Output face shape:
//   {
//     points:        [[wx, wy, wz], ...],  // world inches, polygon corners
//     centroid:      [cx, cy, cz],         // centroid in world inches
//     elementType:   string,               // 'wall' | 'column' | etc — from solid
//     entityId:      string | null,
//     floorId:       string | null,
//     faceKind:      'top' | 'side' | 'bottom',
//     edgeIndex:     number | null,        // side faces: index into base polygon
//     originalIndex: number,               // pre-sort insertion order (stable tiebreak)
//     meta:          object | null,
//   }
//
// Each face is later projected by the renderer using projection.worldToIso()
// on its `points`, then drawn as an SVG polygon. Depth sorting uses the
// centroid for painter's-algorithm ordering.

import { DEFAULT_BASIS } from './projection'
import { makeBackToFrontComparator } from './sort'

// Extract faces from a single prism solid.
// - 1 top face   (polygon at zHi)
// - 1 bottom face only when zHi <= 0 (underground; visible from cutaway)
// - N side faces (one per base-polygon edge)
export function prismToFaces(solid) {
  if (!solid || solid.kind !== 'prism') return []
  const { basePolygon, zLo, zHi, elementType, entityId, floorId, meta } = solid
  if (zHi <= zLo) return []
  if (!basePolygon || basePolygon.length < 3) return []

  const faces = []
  const n = basePolygon.length

  // Top face — edgeIndex null since there's only one.
  faces.push(makeFace(
    basePolygon.map(([x, y]) => [x, y, zHi]),
    { elementType, entityId, floorId, meta, faceKind: 'top', edgeIndex: null },
  ))

  // Side faces — one per edge of the base polygon. edgeIndex disambiguates
  // them for stable React keys.
  for (let i = 0; i < n; i++) {
    const [ax, ay] = basePolygon[i]
    const [bx, by] = basePolygon[(i + 1) % n]
    faces.push(makeFace(
      [[ax, ay, zLo], [bx, by, zLo], [bx, by, zHi], [ax, ay, zHi]],
      { elementType, entityId, floorId, meta, faceKind: 'side', edgeIndex: i },
    ))
  }

  // Bottom face — only useful for partly-underground items so the dirt-side
  // is visible against the ground plane. Skip otherwise to reduce face count.
  if (zHi <= 0) {
    // Reverse winding so the normal points down (matters if we ever do
    // backface culling; today purely cosmetic).
    faces.push(makeFace(
      [...basePolygon].reverse().map(([x, y]) => [x, y, zLo]),
      { elementType, entityId, floorId, meta, faceKind: 'bottom', edgeIndex: null },
    ))
  }

  return faces
}

// Flatten an array of solids into a sorted-back-to-front face list for the
// given view basis. `basis` defaults to the historical 45°/30° iso so any
// caller that hasn't migrated still gets the same output as before.
export function buildFaceList(solids, basis = DEFAULT_BASIS) {
  const faces = []
  for (const s of solids) {
    if (!s) continue
    if (Array.isArray(s)) {
      for (const sub of s) {
        if (sub) faces.push(...prismToFaces(sub))
      }
    } else {
      faces.push(...prismToFaces(s))
    }
  }
  // Stamp insertion order BEFORE sorting so the comparator can use it as
  // the always-distinct final tiebreak.
  for (let i = 0; i < faces.length; i++) faces[i].originalIndex = i
  faces.sort(makeBackToFrontComparator(basis))
  return faces
}

function makeFace(points, extra) {
  let cx = 0, cy = 0, cz = 0
  for (const [x, y, z] of points) { cx += x; cy += y; cz += z }
  const n = points.length
  return {
    points,
    centroid: [cx / n, cy / n, cz / n],
    originalIndex: 0,   // assigned by buildFaceList before sort
    ...extra,
  }
}
