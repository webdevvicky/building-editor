// Underlay calibration math — Phase 4 Tier-2 Step 15 + ADD 8.
//
// Calibration is stored in IMAGE PIXEL space, never in world coordinates.
// World coords are derived at render time from `placement` + `calibration`.
// This decouples calibration from canvas viewport state so future
// rotation / alignment snapping operates on the image directly.
//
// Stored shape (lives at state.projectSettings.underlay.calibration):
//   { p1Px: { x, y }, p2Px: { x, y }, knownLengthFt, inchesPerPixel }
//
// Formula:    inchesPerPixel = (knownLengthFt * 12) / hypot(p2Px - p1Px)
// Render:     renderWidthInches = imageWidthPx * inchesPerPixel
//             renderHeightInches = imageHeightPx * inchesPerPixel

// Compute inchesPerPixel from two image-pixel points and a known real-world
// distance in feet. Returns null when the two points are coincident (would
// divide by zero) or when knownLengthFt is non-positive.
export function computeInchesPerPixel(p1Px, p2Px, knownLengthFt) {
  if (!p1Px || !p2Px) return null
  if (!Number.isFinite(p1Px.x) || !Number.isFinite(p1Px.y)) return null
  if (!Number.isFinite(p2Px.x) || !Number.isFinite(p2Px.y)) return null
  if (!Number.isFinite(knownLengthFt) || knownLengthFt <= 0) return null
  const dx = p2Px.x - p1Px.x
  const dy = p2Px.y - p1Px.y
  const distPx = Math.hypot(dx, dy)
  if (distPx === 0) return null
  return (knownLengthFt * 12) / distPx
}

// Build a frozen calibration record from raw inputs. Returns null on
// invalid input so callers can keep `calibration: null` (uncalibrated state).
export function buildCalibration(p1Px, p2Px, knownLengthFt) {
  const inchesPerPixel = computeInchesPerPixel(p1Px, p2Px, knownLengthFt)
  if (inchesPerPixel === null) return null
  return Object.freeze({
    p1Px:          Object.freeze({ x: p1Px.x, y: p1Px.y }),
    p2Px:          Object.freeze({ x: p2Px.x, y: p2Px.y }),
    knownLengthFt,
    inchesPerPixel,
  })
}

// Render dimensions for an underlay's <image> element. Returns world inches
// (the canvas transform group already scales inches → SVG pixels).
// Uncalibrated underlays render at a provisional 1px-per-inch — still
// visible, but the calibration tool needs to run before draws line up.
export function renderDimensionsInches(underlay) {
  if (!underlay || !underlay.naturalSize) return { wIn: 0, hIn: 0 }
  const { wPx, hPx } = underlay.naturalSize
  const ipp = underlay.calibration?.inchesPerPixel ?? 1
  return { wIn: wPx * ipp, hIn: hPx * ipp }
}

// Default placement record — top-left at world origin. New underlay imports
// land here; user can drag to align with existing geometry.
export const DEFAULT_PLACEMENT = Object.freeze({
  xIn: 0, yIn: 0, rotationDeg: 0,
})
