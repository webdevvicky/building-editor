// Face-aware draw — face → centerline conversion at the authoring boundary.
//
// Canonical storage stays CENTERLINE. This module sits between user
// clicks (which the architect typically traces along an inside or
// outside FACE per drafting convention) and `addWall` / `addRectangleRoom`
// (which store wall n1/n2 nodes on the centerline). The conversion is
// a single application of the same offset kernel that powers the
// inset (clear_internal) + built-up calculations — see
// `src/topology/rooms.js::_offsetClosedPolygon / _offsetOpenPolyline`.
//
// CLOSURE-IN-FACE-SPACE — load-bearing ordering rule (lock):
//
//   The "click-on-origin to close" decision MUST be made against the
//   buffered FACE points, BEFORE the kernel converts them to centerline
//   positions. Reason: face-space points and centerline-space points
//   differ by the per-edge halfThickness offset. A 4-click face loop
//   that touches the origin (closure) becomes, after conversion, four
//   centerline corners whose offset means the first and last are at
//   different positions in centerline space. Detecting closure on the
//   converted geometry would silently mark the face-closed loop as
//   open and the caller would commit an open chain. The check on the
//   face buffer is the only correct ordering.
//
//   The Canvas chain-draw buffer pushes raw face points + per-point
//   snapRef; the closure detector runs on those raw points; only AFTER
//   the buffer is confirmed closed/open does the kernel run.
//
// PURITY
//   Pure & Node-testable. No React, no DOM, no Zustand dispatches.

import {
  _offsetClosedPolygon,
  _offsetOpenPolyline,
  polygonSignedAreaIn2,
} from '../topology/rooms.js'
import { DEFAULT_WALL_THICK_IN } from '../geometry.js'

/**
 * Convert a buffer of user-clicked face points to centerline node
 * positions.
 *
 * @param {Array<{x:number, y:number}>} points
 *   World-coordinate face points in click order. For closed chains
 *   (chain that returns to the origin or rect_room corners) the first
 *   point is NOT duplicated at the end — `closed` flags the closure.
 *
 * @param {Array<'face'|'centerline'>} perPointSnapRef
 *   Same length as `points`. Each entry tags the click as either a
 *   free face position ('face' — gets converted) or a snap to existing
 *   centerline geometry ('centerline' — pinned, no conversion). The
 *   classification comes from the snap registry via `getSnapRef`.
 *
 * @param {object} opts
 * @param {'inside_face' | 'centerline' | 'outside_face'} opts.drawReference
 * @param {boolean} opts.closed                    — closed polygon vs open polyline
 * @param {number}  [opts.halfThicknessIn]         — defaults to DEFAULT_WALL_THICK_IN/2
 *
 * @returns {{
 *   points:    Array<{x:number, y:number}>,
 *   collapsed: boolean,
 *   warnings:  Array<{code: string, ...}>,
 * }}
 *
 * Collapsed conversion (the offset folds the polygon back through
 * itself, or new area < 1 in²): `collapsed: true`. Callers refuse the
 * draw — never partial-commit / clamp. The caller (store.addRectangleRoom
 * + Canvas chain commit) emits a validationEvent + toast.error.
 *
 * `'centerline'` drawReference is a no-op: returns `points` verbatim
 * (after a shallow clone) and `collapsed: false`. Same fast path the
 * existing draw flow takes.
 */
export function convertFacePointsToCenterline(points, perPointSnapRef, opts = {}) {
  const drawReference = opts.drawReference ?? 'inside_face'
  if (drawReference !== 'inside_face' && drawReference !== 'centerline' && drawReference !== 'outside_face') {
    throw new Error(`convertFacePointsToCenterline: invalid drawReference "${drawReference}"`)
  }
  const closed = Boolean(opts.closed)
  const halfIn = opts.halfThicknessIn ?? (DEFAULT_WALL_THICK_IN / 2)

  // Fast path: centerline mode means user clicks are already centerline
  // positions; no conversion needed.
  if (drawReference === 'centerline') {
    return {
      points: points.map(p => ({ x: p.x, y: p.y })),
      collapsed: false,
      warnings: [],
    }
  }

  if (!Array.isArray(points) || points.length < 2) {
    return {
      points: points ? points.map(p => ({ x: p.x, y: p.y })) : [],
      collapsed: false,
      warnings: [{ code: 'TOO_FEW_POINTS' }],
    }
  }
  if (!Array.isArray(perPointSnapRef) || perPointSnapRef.length !== points.length) {
    throw new Error(`convertFacePointsToCenterline: perPointSnapRef length ${perPointSnapRef?.length} ≠ points length ${points.length}`)
  }

  // Pinned indices = vertices that snapped to existing centerline
  // geometry. Their position passes through unchanged so the new
  // wall's centerline joins the existing centerline node correctly
  // (architectural-join correctness > geometric face-perfection at
  // the joint — accept the small notch from adjacent face edges).
  const pinnedIndices = new Set()
  for (let i = 0; i < perPointSnapRef.length; i++) {
    if (perPointSnapRef[i] === 'centerline') pinnedIndices.add(i)
  }

  // direction: 'outward' for inside_face (face → centerline pushes AWAY
  // from the room interior), 'inward' for outside_face (face → centerline
  // pulls TOWARD the interior).
  const direction = drawReference === 'inside_face' ? 'outward' : 'inward'

  if (closed) {
    if (points.length < 3) {
      return {
        points: points.map(p => ({ x: p.x, y: p.y })),
        collapsed: true,
        warnings: [{ code: 'CLOSED_TOO_FEW_POINTS', count: points.length }],
      }
    }
    const halfPerEdge = new Array(points.length).fill(halfIn)
    const { newVerts, warnings } = _offsetClosedPolygon(points, halfPerEdge, {
      direction,
      pinnedIndices,
    })
    // Collapse detection — kernel-result winding flipped OR new area
    // tiny relative to original.
    const origArea = polygonSignedAreaIn2(points)
    const newArea  = polygonSignedAreaIn2(newVerts)
    const flipped  = Math.sign(newArea) !== Math.sign(origArea) && origArea !== 0
    const tiny     = Math.abs(newArea) < 1
    const collapsed = flipped || tiny
    if (collapsed) {
      warnings.push({
        code: 'FACE_CONVERSION_COLLAPSED',
        origAreaIn2: origArea,
        newAreaIn2:  newArea,
        drawReference,
      })
    }
    return { points: newVerts, collapsed, warnings }
  }

  // Open polyline. N-1 edges.
  const halfPerEdge = new Array(points.length - 1).fill(halfIn)
  const { newVerts, warnings } = _offsetOpenPolyline(points, halfPerEdge, {
    direction,
    pinnedIndices,
  })

  // Open-polyline collapse: a vertex offsetting past its neighbors so
  // the polyline self-crosses. Detected by zero-length or sign-flipped
  // segments compared to the input.
  let collapsed = false
  for (let i = 0; i < newVerts.length - 1; i++) {
    const a = newVerts[i], b = newVerts[i + 1]
    const segLen = Math.hypot(b.x - a.x, b.y - a.y)
    if (segLen < 1e-6) {
      collapsed = true
      warnings.push({ code: 'OPEN_SEGMENT_COLLAPSED', segmentIndex: i })
      break
    }
    // Direction-reversal check: input segment vs output segment.
    const ia = points[i], ib = points[i + 1]
    const idx = ib.x - ia.x, idy = ib.y - ia.y
    const odx = b.x - a.x,   ody = b.y - a.y
    const dot = idx * odx + idy * ody
    if (dot < 0) {
      collapsed = true
      warnings.push({ code: 'OPEN_SEGMENT_REVERSED', segmentIndex: i })
      break
    }
  }
  if (collapsed) {
    warnings.push({ code: 'FACE_CONVERSION_COLLAPSED', drawReference })
  }
  return { points: newVerts, collapsed, warnings }
}

/**
 * Closure detector for chain-draw buffers. Returns true if the LAST
 * point in the buffer is within `toleranceIn` of the FIRST point — the
 * chain closes back onto the origin in FACE SPACE.
 *
 * MUST be called on face-space points, BEFORE `convertFacePointsToCenterline`
 * runs. See module header for the load-bearing ordering rule.
 */
export function isFaceChainClosed(points, toleranceIn) {
  if (!Array.isArray(points) || points.length < 3) return false
  const first = points[0]
  const last  = points[points.length - 1]
  const dx = last.x - first.x
  const dy = last.y - first.y
  return Math.hypot(dx, dy) <= (toleranceIn ?? 4)
}
