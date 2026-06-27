// syncMappers.js — pure editor → ERP translation.
//
// The editor's taxonomies (materialKey strings, opening types, MEP disciplines)
// do NOT match the ERP's Prisma enums. Every value that crosses the wire is
// mapped here so a payload can never carry an invalid enum (which the backend's
// `whitelist + forbidNonWhitelisted` ValidationPipe rejects 400). All functions
// are pure + total — they ALWAYS return a value the backend will accept.

const IN_TO_MM = 25.4

/** Inches → integer millimetres (matches liveSync.inToMm). */
export function inToMm(v) { return Math.round((Number(v) || 0) * IN_TO_MM) }

/** Millimetres → inches. The single mm→inch conversion for reconstruction. */
export function mmToIn(v) { return (Number(v) || 0) / IN_TO_MM }

/** Euclidean distance (inches) between two {x,y} nodes → mm. */
export function edgeLengthMm(a, b) {
  if (!a || !b) return 0
  const dx = (b.x ?? 0) - (a.x ?? 0)
  const dy = (b.y ?? 0) - (a.y ?? 0)
  return inToMm(Math.sqrt(dx * dx + dy * dy))
}

// ── WallOrientation (REQUIRED, no UNSPECIFIED in the enum) ───────────────────
// Computed from the edge vector's dominant axis. Screen y is downward; the exact
// compass value is informational (stored verbatim), so we only need a VALID enum.
// Valid: NORTH SOUTH EAST WEST NORTH_EAST NORTH_WEST SOUTH_EAST SOUTH_WEST INTERNAL.
export function wallOrientation(n1, n2) {
  if (!n1 || !n2) return 'INTERNAL'
  const dx = (n2.x ?? 0) - (n1.x ?? 0)
  const dy = (n2.y ?? 0) - (n1.y ?? 0)
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  if (adx < 1e-6 && ady < 1e-6) return 'INTERNAL'
  if (adx >= ady) return dx >= 0 ? 'EAST' : 'WEST'
  return dy >= 0 ? 'SOUTH' : 'NORTH'
}

// ── WallMaterial ─────────────────────────────────────────────────────────────
// Valid: RED_BRICK_9_INCH RED_BRICK_4_5_INCH AAC_BLOCK_{100,150,200}MM
//        FLY_ASH_BRICK HOLLOW_CONCRETE_BLOCK RCC GLASS_PARTITION GYPSUM_BOARD
//        STONE OTHER. Best-effort substring match; OTHER is the safe fallback.
export function wallMaterial(materialKey) {
  const k = String(materialKey ?? '').toUpperCase()
  if (!k) return 'OTHER'
  if (k.includes('AAC')) {
    if (k.includes('100')) return 'AAC_BLOCK_100MM'
    if (k.includes('150')) return 'AAC_BLOCK_150MM'
    return 'AAC_BLOCK_200MM'
  }
  if (k.includes('FLY')) return 'FLY_ASH_BRICK'
  if (k.includes('HOLLOW') || k.includes('CONCRETE_BLOCK')) return 'HOLLOW_CONCRETE_BLOCK'
  if (k.includes('RCC')) return 'RCC'
  if (k.includes('GLASS')) return 'GLASS_PARTITION'
  if (k.includes('GYPSUM')) return 'GYPSUM_BOARD'
  if (k.includes('STONE')) return 'STONE'
  if (k.includes('BRICK')) return k.includes('4') ? 'RED_BRICK_4_5_INCH' : 'RED_BRICK_9_INCH'
  return 'OTHER'
}

// ── OpeningType ──────────────────────────────────────────────────────────────
// Valid: DOOR WINDOW VENTILATOR ARCH SLIDING_DOOR FRENCH_DOOR.
export function openingType(type, subtype) {
  const k = `${String(type ?? '')} ${String(subtype ?? '')}`.toUpperCase()
  if (k.includes('SLIDING')) return 'SLIDING_DOOR'
  if (k.includes('FRENCH')) return 'FRENCH_DOOR'
  if (k.includes('VENT')) return 'VENTILATOR'
  if (k.includes('ARCH')) return 'ARCH'
  if (k.includes('DOOR')) return 'DOOR'
  return 'WINDOW'
}

// MEP discipline ⇄ BuildingElementKind mapping moved to elementRegistry.js
// (the single source of truth for all element kinds).
