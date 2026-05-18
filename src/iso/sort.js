// Painter's-algorithm sort. Camera looks at world origin from up-and-back,
// so "back" of the scene = LARGER x+y. Draw back first so front overlays.
// Ties in (x+y) are broken by z ASCENDING — lower z drawn first, higher
// (taller) drawn last so it sits on top.
//
// This is imperfect for adjacent walls sharing a node — their faces are
// co-planar at the seam, so the painter algorithm can flicker. IsoScene
// renders a thin stroke around every face to mask the seam (see iso.css).
export function compareFacesBackToFront(a, b) {
  const ax = a.centroid[0] + a.centroid[1]
  const bx = b.centroid[0] + b.centroid[1]
  // Back first: larger (x+y) drawn first → ascending order is REVERSED.
  // i.e., we want larger ax to come BEFORE larger bx. So compare returns
  // > 0 when a should come AFTER b. "a should come after" = "a has smaller x+y".
  if (ax !== bx) return bx - ax     // descending in (x+y)
  return a.centroid[2] - b.centroid[2]  // ascending in z (low on bottom, high on top)
}
