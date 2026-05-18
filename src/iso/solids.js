// Pure geometry resolvers — turn an entity's primitive data into a `Solid`,
// the unified iso-renderable shape. NO store imports, NO direct state coupling.
// Every caller passes the exact primitives the resolver needs.
//
// These functions are designed to outlive the iso viewer: when a centralized
// geometry layer lands, BOQ and validation will consume the same solids.
//
// ── Solid shape ─────────────────────────────────────────────────────────
//   type Solid = {
//     kind: 'prism',
//     basePolygon: [[x, y], ...],   // CCW (or CW — extrusion is winding-agnostic)
//     zLo: number,                  // elevation of bottom face, inches
//     zHi: number,                  // elevation of top face, inches
//     elementType: string,          // 'wall' | 'column' | 'beam' | 'slab' |
//                                   //  'foundation' | 'stamp' | 'staircase' | 'plot'
//     entityId:  string | null,     // back-link for selection (future)
//     floorId:   string | null,
//     meta:      object | null,     // free-form per-element extras
//   }
//
// Every visible solid is a polygon extruded vertically — that's enough for
// everything the building editor produces today (walls, columns, slabs,
// beams, foundations, civil stamps). Circular columns are approximated as
// 16-gons; pile shafts likewise. The renderer's extrude.js treats every
// solid uniformly.

// ── helpers ─────────────────────────────────────────────────────────────

// Length of a line segment in inches.
function segLen(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1)
}

// Unit perpendicular vector to (x1,y1)→(x2,y2), rotated +90° (left side).
function perpUnit(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  const L  = Math.hypot(dx, dy)
  if (L === 0) return [0, 0]
  return [-dy / L, dx / L]
}

// Rectangular footprint corners around a segment with given half-thickness.
function segRectFootprint(x1, y1, x2, y2, halfThicknessIn) {
  const [px, py] = perpUnit(x1, y1, x2, y2)
  const ox = px * halfThicknessIn, oy = py * halfThicknessIn
  return [
    [x1 - ox, y1 - oy],
    [x2 - ox, y2 - oy],
    [x2 + ox, y2 + oy],
    [x1 + ox, y1 + oy],
  ]
}

// Axis-aligned rectangle around (cx, cy) with given width/height (inches).
function axisAlignedRect(cx, cy, wIn, hIn) {
  const hw = wIn / 2, hh = hIn / 2
  return [
    [cx - hw, cy - hh],
    [cx + hw, cy - hh],
    [cx + hw, cy + hh],
    [cx - hw, cy + hh],
  ]
}

// N-gon approximation of a circle centered at (cx, cy), radius rIn.
function approxCircle(cx, cy, rIn, segments = 16) {
  const pts = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    pts.push([cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn])
  }
  return pts
}

// ── Wall solid ──────────────────────────────────────────────────────────
//
// A wall is a vertical prism over a rectangular footprint formed by extending
// the wall's centerline ±thickness/2 perpendicularly. Virtual walls return
// null (caller filters them out).
export function resolveWallSolid({
  n1x, n1y, n2x, n2y,
  thicknessIn, baseZIn, topZIn,
  entityId = null, floorId = null,
  isVirtual = false,
}) {
  if (isVirtual) return null
  if (segLen(n1x, n1y, n2x, n2y) < 0.5) return null
  if (topZIn <= baseZIn) return null
  return {
    kind: 'prism',
    basePolygon: segRectFootprint(n1x, n1y, n2x, n2y, (thicknessIn ?? 0) / 2),
    zLo: baseZIn,
    zHi: topZIn,
    elementType: 'wall',
    entityId,
    floorId,
    meta: null,
  }
}

// ── Column solid ────────────────────────────────────────────────────────
//
// Rectangular columns extrude over an axis-aligned rectangle (we don't carry
// per-column rotation in the data model). Circular columns extrude over a
// 16-gon approximation.
export function resolveColumnSolid({
  x, y, columnType,
  baseZIn, topZIn,
  entityId = null, floorId = null,
}) {
  if (!columnType) return null
  if (topZIn <= baseZIn) return null
  let basePolygon
  if (columnType.shape === 'circle') {
    basePolygon = approxCircle(x, y, (columnType.diamIn ?? 12) / 2, 16)
  } else {
    basePolygon = axisAlignedRect(x, y, columnType.widthIn ?? 9, columnType.depthIn ?? 9)
  }
  return {
    kind: 'prism',
    basePolygon,
    zLo: baseZIn,
    zHi: topZIn,
    elementType: 'column',
    entityId,
    floorId,
    meta: { columnTypeId: columnType.id ?? null },
  }
}

// ── Beam solid ──────────────────────────────────────────────────────────
//
// A beam is a horizontal prism along a segment from (x1,y1) to (x2,y2), with
// width perpendicular to the segment and depth vertical. The caller supplies
// the beam's TOP Z (= top of slab or top of floor). The bottom Z is top - depth.
export function resolveBeamSolid({
  x1, y1, x2, y2,
  widthIn, depthIn,
  topZIn,
  entityId = null, floorId = null,
  level = null,
}) {
  if (segLen(x1, y1, x2, y2) < 0.5) return null
  if (depthIn <= 0) return null
  return {
    kind: 'prism',
    basePolygon: segRectFootprint(x1, y1, x2, y2, (widthIn ?? 0) / 2),
    zLo: topZIn - depthIn,
    zHi: topZIn,
    elementType: 'beam',
    entityId,
    floorId,
    meta: { level },
  }
}

// ── Slab solid ──────────────────────────────────────────────────────────
//
// A slab is a thin horizontal prism over a polygon (typically a room
// polygon, but the caller decides). Sunken slabs are rendered LOWER than
// their floor's main slab plane — caller passes `sunkBy` (inches below
// the normal slab plane). The thickness applies in the same direction —
// the slab body sits below the floor's reference plane.
export function resolveSlabSolid({
  polygon,
  topZIn,
  thicknessIn,
  sunkByIn = 0,
  entityId = null, floorId = null,
  role = null,
}) {
  if (!polygon || polygon.length < 3) return null
  if (thicknessIn <= 0) return null
  const top = topZIn - sunkByIn
  return {
    kind: 'prism',
    basePolygon: polygon.map(p => [p[0], p[1]]),
    zLo: top - thicknessIn,
    zHi: top,
    elementType: 'slab',
    entityId,
    floorId,
    meta: { role },
  }
}

// ── Foundation solids ───────────────────────────────────────────────────
//
// Foundations live below ground. The caller passes a single foundation
// entity (already resolved into geometry) plus optional inputs for
// type-specific computations (wall segments for STRIP, pile geometry).
// Returns Solid[] — one or many depending on type (PILE returns shafts + cap).
//
// Inline auto-isolated footings (column-type-keyed, no foundation entity)
// are NOT handled here; the scene builder emits them via the rectangular
// path with `kind: 'inlineFooting'` metadata for clarity.
export function resolveFoundationSolids({
  foundation,
  wallSegments = [],          // [{ x1, y1, x2, y2 }] for STRIP
  groundZIn = 0,              // top of foundation (typically z = 0)
}) {
  if (!foundation) return []
  const g    = foundation.geometry || {}
  const type = foundation.type
  const out  = []
  const FT   = 12

  if (type === 'ISOLATED' || type === 'COMBINED') {
    const lIn = (g.lengthFt || 0) * FT
    const wIn = (g.widthFt  || 0) * FT
    const dIn = (g.depthFt  || 0) * FT
    if (lIn > 0 && wIn > 0 && dIn > 0) {
      // Footprint centered on user-provided geometry.x/y if present, else (0,0)
      const cx = (g.x ?? 0), cy = (g.y ?? 0)
      out.push({
        kind: 'prism',
        basePolygon: axisAlignedRect(cx, cy, lIn, wIn),
        zLo: groundZIn - dIn,
        zHi: groundZIn,
        elementType: 'foundation',
        entityId: foundation.id,
        floorId: null,
        meta: { type, part: 'pad' },
      })
    }
  } else if (type === 'RAFT') {
    // Raft area is captured as areaFt2 only; we approximate as a square if
    // no polygon is available. (Phase 1.8 captures polygon in future.)
    const aFt2 = g.areaFt2 || 0
    const dIn  = (g.depthFt || 0) * FT
    if (aFt2 > 0 && dIn > 0) {
      const side = Math.sqrt(aFt2) * FT
      const cx = (g.x ?? 0), cy = (g.y ?? 0)
      out.push({
        kind: 'prism',
        basePolygon: axisAlignedRect(cx, cy, side, side),
        zLo: groundZIn - dIn,
        zHi: groundZIn,
        elementType: 'foundation',
        entityId: foundation.id,
        floorId: null,
        meta: { type, part: 'raft' },
      })
    }
  } else if (type === 'STRIP') {
    // One prism per attached wall segment.
    const wIn = (g.widthFt  || 0) * FT
    const dIn = (g.depthFt  || 0) * FT
    if (wIn > 0 && dIn > 0) {
      for (const seg of wallSegments) {
        out.push({
          kind: 'prism',
          basePolygon: segRectFootprint(seg.x1, seg.y1, seg.x2, seg.y2, wIn / 2),
          zLo: groundZIn - dIn,
          zHi: groundZIn,
          elementType: 'foundation',
          entityId: foundation.id,
          floorId: null,
          meta: { type, part: 'strip', wallId: seg.wallId ?? null },
        })
      }
    }
  } else if (type === 'PILE') {
    // Cap on top of N pile shafts.
    const capL = (g.capLengthFt || 0) * FT
    const capW = (g.capWidthFt  || 0) * FT
    const capD = (g.capDepthFt  || 0) * FT
    const pilesCount = g.pilesCount || 0
    const pileDiam  = (g.pileDiamIn   || 0)
    const pileLen   = (g.pileLengthFt || 0) * FT
    const cx = (g.x ?? 0), cy = (g.y ?? 0)
    if (capL > 0 && capW > 0 && capD > 0) {
      out.push({
        kind: 'prism',
        basePolygon: axisAlignedRect(cx, cy, capL, capW),
        zLo: groundZIn - capD,
        zHi: groundZIn,
        elementType: 'foundation',
        entityId: foundation.id,
        floorId: null,
        meta: { type, part: 'cap' },
      })
    }
    if (pilesCount > 0 && pileDiam > 0 && pileLen > 0) {
      // Arrange piles in a row along the cap's longer axis.
      const along = Math.max(capL, capW) - pileDiam
      const step  = pilesCount > 1 ? along / (pilesCount - 1) : 0
      const isLong = capL >= capW
      for (let i = 0; i < pilesCount; i++) {
        const off = pilesCount > 1 ? (-along / 2 + i * step) : 0
        const px = cx + (isLong ? off : 0)
        const py = cy + (isLong ? 0   : off)
        out.push({
          kind: 'prism',
          basePolygon: approxCircle(px, py, pileDiam / 2, 12),
          zLo: groundZIn - capD - pileLen,
          zHi: groundZIn - capD,
          elementType: 'foundation',
          entityId: foundation.id,
          floorId: null,
          meta: { type, part: 'shaft', pileIndex: i },
        })
      }
    }
  }
  return out
}

// Inline-footing solid (no foundation entity — derived from column-type).
// Centered under the column position with the column type's footing dims.
export function resolveInlineFootingSolid({
  x, y, columnType,
  groundZIn = 0,
  entityId = null,
}) {
  if (!columnType) return null
  const lIn = (columnType.footingLengthFt || 0) * 12
  const wIn = (columnType.footingWidthFt  || 0) * 12
  const dIn = (columnType.footingDepthFt  || 0) * 12
  if (lIn <= 0 || wIn <= 0 || dIn <= 0) return null
  return {
    kind: 'prism',
    basePolygon: axisAlignedRect(x, y, lIn, wIn),
    zLo: groundZIn - dIn,
    zHi: groundZIn,
    elementType: 'foundation',
    entityId,
    floorId: null,
    meta: { type: 'ISOLATED', part: 'inline', columnTypeId: columnType.id ?? null },
  }
}

// ── Stamp solids (civil tanks, stairs, lift) ────────────────────────────
//
// Underground tanks (sump / septic / OHT-when-on-roof) are rendered as a
// box below ground. Stairs / lift on a floor are rendered as a colored
// block at floor base, with no detailed step geometry (MVP).
export function resolveStampSolid({
  stamp, baseZIn = 0, entityId = null, floorId = null,
}) {
  if (!stamp) return null
  const wIn = stamp.w || 0
  const hIn = stamp.h || 0
  const dIn = stamp.depth || 0
  // stamp.x/y is the SW corner — center for our axis-aligned rect.
  const cx = stamp.x + wIn / 2
  const cy = stamp.y + hIn / 2

  if (stamp.type === 'sump' || stamp.type === 'septic_tank') {
    if (dIn <= 0) return null
    return {
      kind: 'prism',
      basePolygon: axisAlignedRect(cx, cy, wIn, hIn),
      zLo: baseZIn - dIn,
      zHi: baseZIn,
      elementType: 'stamp',
      entityId,
      floorId,
      meta: { type: stamp.type, underground: true },
    }
  }
  if (stamp.type === 'overhead_tank') {
    // Sits on the roof slab — caller passes baseZIn = top of roof slab.
    const tankHeightIn = dIn || 48
    return {
      kind: 'prism',
      basePolygon: axisAlignedRect(cx, cy, wIn, hIn),
      zLo: baseZIn,
      zHi: baseZIn + tankHeightIn,
      elementType: 'stamp',
      entityId,
      floorId,
      meta: { type: stamp.type, underground: false },
    }
  }
  // Stairs / lift — a low block at floor base. Height = 3ft for visibility.
  const blockHeightIn = 36
  return {
    kind: 'prism',
    basePolygon: axisAlignedRect(cx, cy, wIn, hIn),
    zLo: baseZIn,
    zHi: baseZIn + blockHeightIn,
    elementType: stamp.type === 'stairs' ? 'staircase' : 'stamp',
    entityId,
    floorId,
    meta: { type: stamp.type },
  }
}
