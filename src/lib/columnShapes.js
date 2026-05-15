// Column shape strategy registry.
// Consumers call the exported helpers — never branch on ct.shape directly.
// Adding a new shape: add an entry to COLUMN_SHAPES with the four required functions.

const COLUMN_SHAPES = {
  rect: {
    // Cross-section area in ft²
    areaFt2: ct => (ct.widthIn * ct.depthIn) / 144,
    // Human-readable dimension string for labels and UI
    dimLabel: ct => `${ct.widthIn} × ${ct.depthIn} in`,
    // Formula string for formula popover explainers
    formulaLabel: ct => `${ct.widthIn}″ × ${ct.depthIn}″ ÷ 144`,
    // SVG element dimensions { w, h } in pixels for canvas rendering (center-anchor)
    svgDims: (ct, pxPerInch) => ({ w: ct.widthIn * pxPerInch, h: ct.depthIn * pxPerInch }),
  },
  circle: {
    areaFt2: ct => Math.PI * Math.pow(ct.diamIn / 2, 2) / 144,
    dimLabel: ct => `Ø ${ct.diamIn} in`,
    formulaLabel: ct => `π × (${ct.diamIn / 2}″ radius)² ÷ 144`,
    svgDims: (ct, pxPerInch) => ({ r: (ct.diamIn / 2) * pxPerInch }),
  },
}

function getShape(ct) {
  return COLUMN_SHAPES[ct.shape] ?? COLUMN_SHAPES.rect
}

export function getColumnAreaFt2(ct)                  { return getShape(ct).areaFt2(ct) }
export function getColumnDimLabel(ct)                 { return getShape(ct).dimLabel(ct) }
export function getColumnFormulaLabel(ct)             { return getShape(ct).formulaLabel(ct) }
export function getColumnSvgDims(ct, pxPerInch)       { return getShape(ct).svgDims(ct, pxPerInch) }
