// Column shape strategy registry.
// Consumers call the exported helpers — never branch on ct.shape directly.
// Adding a new shape: add an entry to COLUMN_SHAPES with the required functions.
//
// Phase 1.6 consumers (shuttering) use perimeterFt.
// Phase 1.7 consumers (BBS) use barLayoutZones + stirrupLengthFt — stubs today,
// filled in when columnType.reinforcementSpecId points at a real spec.

const DEFAULT_COVER_IN = 1.5  // typical cover for residential RCC columns
const DEFAULT_STIRRUP_HOOK_FT = 10 / 12 // ~10 in 90°/135° hook return (BBS Phase 1.7 will derive from bar dia)

const COLUMN_SHAPES = {
  rect: {
    // Cross-section area in ft²
    areaFt2: ct => (ct.widthIn * ct.depthIn) / 144,
    // Cross-section perimeter in ft (Phase 1.6a shuttering, Phase 1.7 stirrup base)
    perimeterFt: ct => 2 * (ct.widthIn + ct.depthIn) / 12,
    // Reinforcement bar layout zones (Phase 1.7 BBS will read from reinforcementSpec)
    barLayoutZones: () => ({ corners: 4, intermediate: 0, ring: false }),
    // Stirrup perimeter inside the cover + hook returns. Phase 1.7 overrides hook from bar dia.
    stirrupLengthFt: (ct, coverIn = DEFAULT_COVER_IN) => {
      const wIn = Math.max(0, ct.widthIn - 2 * coverIn)
      const dIn = Math.max(0, ct.depthIn - 2 * coverIn)
      return 2 * (wIn + dIn) / 12 + 2 * DEFAULT_STIRRUP_HOOK_FT
    },
    // Human-readable dimension string for labels and UI
    dimLabel: ct => `${ct.widthIn} × ${ct.depthIn} in`,
    // Formula string for formula popover explainers
    formulaLabel: ct => `${ct.widthIn}″ × ${ct.depthIn}″ ÷ 144`,
    // SVG element dimensions { w, h } in pixels for canvas rendering (center-anchor)
    svgDims: (ct, pxPerInch) => ({ w: ct.widthIn * pxPerInch, h: ct.depthIn * pxPerInch }),
  },
  circle: {
    areaFt2: ct => Math.PI * Math.pow(ct.diamIn / 2, 2) / 144,
    perimeterFt: ct => Math.PI * ct.diamIn / 12,
    barLayoutZones: () => ({ corners: 0, intermediate: 0, ring: true }),
    stirrupLengthFt: (ct, coverIn = DEFAULT_COVER_IN) => {
      const dIn = Math.max(0, ct.diamIn - 2 * coverIn)
      return Math.PI * dIn / 12 + DEFAULT_STIRRUP_HOOK_FT
    },
    dimLabel: ct => `Ø ${ct.diamIn} in`,
    formulaLabel: ct => `π × (${ct.diamIn / 2}″ radius)² ÷ 144`,
    svgDims: (ct, pxPerInch) => ({ r: (ct.diamIn / 2) * pxPerInch }),
  },
}

function getShape(ct) {
  return COLUMN_SHAPES[ct.shape] ?? COLUMN_SHAPES.rect
}

export function getColumnAreaFt2(ct)                  { return getShape(ct).areaFt2(ct) }
export function getColumnPerimeterFt(ct)              { return getShape(ct).perimeterFt(ct) }
export function getColumnBarLayoutZones(ct)           { return getShape(ct).barLayoutZones(ct) }
export function getColumnStirrupLengthFt(ct, coverIn) { return getShape(ct).stirrupLengthFt(ct, coverIn) }
export function getColumnDimLabel(ct)                 { return getShape(ct).dimLabel(ct) }
export function getColumnFormulaLabel(ct)             { return getShape(ct).formulaLabel(ct) }
export function getColumnSvgDims(ct, pxPerInch)       { return getShape(ct).svgDims(ct, pxPerInch) }
