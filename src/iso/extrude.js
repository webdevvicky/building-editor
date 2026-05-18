// Extrude a Solid (from src/iso/solids.js) into a flat list of render-ready
// faces. PURE module — no React, no store, no DOM.
//
// Output face shape:
//   {
//     points:      [[wx, wy, wz], ...],  // world inches, polygon corners
//     centroid:    [cx, cy, cz],         // centroid in world inches
//     elementType: string,               // 'wall' | 'column' | etc — from solid
//     entityId:    string | null,
//     floorId:     string | null,
//     faceKind:    'top' | 'side' | 'bottom',
//     meta:        object | null,
//   }
//
// Each face is later projected by the renderer using projection.worldToIso()
// on its `points`, then drawn as an SVG polygon. Depth sorting uses the
// centroid for painter's-algorithm ordering.

import { compareFacesBackToFront } from './sort'

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

  // Top face
  faces.push(makeFace(
    basePolygon.map(([x, y]) => [x, y, zHi]),
    { elementType, entityId, floorId, meta, faceKind: 'top' },
  ))

  // Side faces — one per edge of the base polygon.
  for (let i = 0; i < n; i++) {
    const [ax, ay] = basePolygon[i]
    const [bx, by] = basePolygon[(i + 1) % n]
    faces.push(makeFace(
      [[ax, ay, zLo], [bx, by, zLo], [bx, by, zHi], [ax, ay, zHi]],
      { elementType, entityId, floorId, meta, faceKind: 'side' },
    ))
  }

  // Bottom face — only useful for partly-underground items so the dirt-side
  // is visible against the ground plane. Skip otherwise to reduce face count.
  if (zHi <= 0) {
    // Reverse winding so the normal points down (matters if we ever do
    // backface culling; today purely cosmetic).
    faces.push(makeFace(
      [...basePolygon].reverse().map(([x, y]) => [x, y, zLo]),
      { elementType, entityId, floorId, meta, faceKind: 'bottom' },
    ))
  }

  return faces
}

// Flatten an array of solids into a sorted-back-to-front face list.
export function buildFaceList(solids) {
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
  faces.sort(compareFacesBackToFront)
  return faces
}

function makeFace(points, extra) {
  let cx = 0, cy = 0, cz = 0
  for (const [x, y, z] of points) { cx += x; cy += y; cz += z }
  const n = points.length
  return {
    points,
    centroid: [cx / n, cy / n, cz / n],
    ...extra,
  }
}
