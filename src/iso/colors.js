// Per-element-type palette for the iso viewer. Token-derived; tweak only
// these constants to restyle the entire scene.
//
// Each entry: { fill, stroke }. Tops render at full fill; sides darken by
// the SHADE_BY_FACE multiplier so the iso reads as 3D rather than flat.

export const ISO_COLORS = {
  wall:       { fill: '#cfd2d8', stroke: '#8a8f96' },
  column:     { fill: '#5e6ad2', stroke: '#4751a8' },
  beam:       { fill: '#c2790e', stroke: '#8a570a' },
  slab:       { fill: '#e4e6eb', stroke: '#a4a8af' },
  foundation: { fill: '#7a7f86', stroke: '#4a5056' },
  stamp:      { fill: '#2da160', stroke: '#1f7544' },
  staircase:  { fill: '#9b59b6', stroke: '#6b3f96' },
  plot:       { fill: '#fafbfc', stroke: '#d4d7dd' },
}

// Subtle face shading. Top is brightest; side faces are slightly darker.
// Bottom faces (rarely emitted; only for underground bodies) are darkest.
export const FACE_SHADE = {
  top:    1.0,
  side:   0.85,
  bottom: 0.65,
}

// Mix a hex color toward black by factor f (0..1). f=1 returns the color
// unchanged; f=0 returns black.
export function shade(hex, factor) {
  const f = Math.max(0, Math.min(1, factor))
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const r = Math.round(((n >> 16) & 0xff) * f)
  const g = Math.round(((n >>  8) & 0xff) * f)
  const b = Math.round((n & 0xff) * f)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

// Resolve a face's fill/stroke from its elementType + faceKind.
export function faceColors(elementType, faceKind) {
  const c = ISO_COLORS[elementType] || ISO_COLORS.wall
  const factor = FACE_SHADE[faceKind] ?? 1.0
  return {
    fill:   shade(c.fill, factor),
    stroke: c.stroke,
  }
}
