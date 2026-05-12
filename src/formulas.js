import { MATERIAL_LIBRARY, BONDING } from './materials'
import { GRID_IN, DEFAULT_WALL_HEIGHT_IN, DEFAULT_WALL_THICK_IN } from './geometry'

// state = { walls, nodes, rooms, stamps, getWallArea, getValidRoomIds, getRoomArea, getRoomWallArea }
// All functions return { title, steps: [{label, value, bold?}], note? }

const WASTAGE = 1.05

function r2(n) { return Math.round(n * 100) / 100 }

function wallLengthFt(wall, nodes) {
  const a = nodes[wall.n1], b = nodes[wall.n2]
  if (!a || !b) return 0
  return Math.hypot(b.x - a.x, b.y - a.y) / GRID_IN
}

function wallOpeningAreaFt2(wall) {
  return (wall.openings || []).reduce(
    (s, o) => s + (o.width / GRID_IN) * (o.height / GRID_IN), 0
  )
}

// Accumulates face area and wall volume for all non-virtual walls of a given material.
// Returns unrounded values so callers can ceil/round without intermediate rounding error.
function matVolumes({ walls, getWallArea }, matKey) {
  let faceAreaFt2 = 0, volFt3 = 0, count = 0
  for (const w of Object.values(walls)) {
    if (w.isVirtual) continue
    if ((w.materialKey ?? 'IS_MODULAR_BRICK') !== matKey) continue
    const area = getWallArea(w.id)
    faceAreaFt2 += area
    volFt3 += area * ((w.thickness ?? DEFAULT_WALL_THICK_IN) / GRID_IN)
    count++
  }
  return { count, faceAreaFt2, volFt3 }
}

// Per-room area breakdown for any finish-flag-gated item.
function roomAreaSteps({ rooms, getValidRoomIds, getRoomArea }, finishKey) {
  const ids = getValidRoomIds().filter(id => rooms[id]?.finishes?.[finishKey])
  let total = 0
  const steps = ids.map(id => {
    const area = r2(getRoomArea(id))
    total += area
    return { label: rooms[id].name, value: `${area} ft²` }
  })
  if (ids.length === 0) steps.push({ label: 'No eligible rooms', value: '—' })
  steps.push({ label: 'Total', value: `${r2(total)} ft²`, bold: true })
  return steps
}

function civilStamps({ stamps }, stampType) {
  return Object.values(stamps).filter(s => s.type === stampType && s.depth)
}

const STAMP_NAME = { sump: 'Sump', septic_tank: 'Septic Tank' }

// ── Exported formula functions ────────────────────────────────────────────────

export function explainWallArea({ walls, nodes }) {
  const nonVirtual = Object.values(walls).filter(w => !w.isVirtual)
  let grossFt2 = 0, openingFt2 = 0
  for (const w of nonVirtual) {
    grossFt2   += wallLengthFt(w, nodes) * ((w.height ?? DEFAULT_WALL_HEIGHT_IN) / GRID_IN)
    openingFt2 += wallOpeningAreaFt2(w)
  }
  return {
    title: 'Wall Area',
    steps: [
      { label: 'Non-virtual walls',              value: String(nonVirtual.length) },
      { label: 'Gross area (Σ length × height)', value: `${r2(grossFt2)} ft²` },
      { label: 'Openings deducted',              value: `${r2(openingFt2)} ft²` },
      { label: 'Net wall area',                  value: `${r2(Math.max(0, grossFt2 - openingFt2))} ft²`, bold: true },
    ],
    note: 'Virtual walls (open-plan dividers) excluded. Each physical wall counted once.',
  }
}

export function explainFlooring(state) {
  return {
    title: 'Flooring',
    steps: roomAreaSteps(state, 'flooring'),
    note: 'Only rooms with the flooring finish flag enabled are included.',
  }
}

export function explainPlasterWalls({ walls, nodes }) {
  const nonVirtual = Object.values(walls).filter(w => !w.isVirtual)
  let grossFt2 = 0, openingFt2 = 0
  for (const w of nonVirtual) {
    grossFt2   += wallLengthFt(w, nodes) * ((w.height ?? DEFAULT_WALL_HEIGHT_IN) / GRID_IN)
    openingFt2 += wallOpeningAreaFt2(w)
  }
  return {
    title: 'Plaster (Walls)',
    steps: [
      { label: 'Non-virtual walls',              value: String(nonVirtual.length) },
      { label: 'Gross area (Σ length × height)', value: `${r2(grossFt2)} ft²` },
      { label: 'Openings deducted',              value: `${r2(openingFt2)} ft²` },
      { label: 'Net area (one face per wall)',    value: `${r2(Math.max(0, grossFt2 - openingFt2))} ft²`, bold: true },
    ],
    note: 'Currently computed across all walls (ungated). Per-room wall plaster finish flag deferred to Phase 1.5 — will be gated by room.finishes.wallPlaster when implemented.',
  }
}

export function explainPlasterCeiling(state) {
  return {
    title: 'Plaster (Ceiling)',
    steps: roomAreaSteps(state, 'ceilingPlaster'),
    note: 'Ceiling plaster area = floor area (flat ceilings assumed). Gated by room.finishes.ceilingPlaster.',
  }
}

export function explainPaintWalls({ rooms, getValidRoomIds, getRoomWallArea }) {
  const ids = getValidRoomIds().filter(id => rooms[id]?.finishes?.paint)
  let total = 0
  const steps = ids.map(id => {
    const area = r2(getRoomWallArea(id))
    total += area
    return { label: rooms[id].name, value: `${area} ft²` }
  })
  if (ids.length === 0) steps.push({ label: 'No eligible rooms', value: '—' })
  steps.push({ label: 'Total', value: `${r2(total)} ft²`, bold: true })
  return {
    title: 'Paint (Walls)',
    steps,
    note: 'Both faces of shared walls between two painted rooms are counted. Gated by room.finishes.paint.',
  }
}

export function explainPaintCeiling(state) {
  return {
    title: 'Paint (Ceiling)',
    steps: roomAreaSteps(state, 'paint'),
    note: 'Ceiling paint area = floor area. Gated by the same room.finishes.paint flag as paint walls.',
  }
}

export function explainWaterproofing(state) {
  return {
    title: 'Waterproofing',
    steps: roomAreaSteps(state, 'waterproofing'),
    note: 'Waterproofing area = floor area (wet rooms). Gated by room.finishes.waterproofing.',
  }
}

export function explainRoofing(state) {
  return {
    title: 'Roofing',
    steps: roomAreaSteps(state, 'roofing'),
    note: 'Roofing area = floor area. Typically enabled for top-floor rooms only. Gated by room.finishes.roofing.',
  }
}

export function explainUnits(state, matKey) {
  const mat = MATERIAL_LIBRARY[matKey]
  if (!mat) return { title: matKey, steps: [{ label: 'Unknown material', value: '—' }] }
  const { count, faceAreaFt2, volFt3 } = matVolumes(state, matKey)
  const isBrick = mat.bricksPerFt3 !== undefined
  const density = mat.bricksPerFt3 ?? mat.blocksPerFt3
  const unit = isBrick ? 'bricks' : 'blocks'
  const total = Math.ceil(volFt3 * density * WASTAGE)
  return {
    title: `${mat.name} – ${isBrick ? 'Bricks' : 'Blocks'}`,
    steps: [
      { label: 'Walls using this material',            value: String(count) },
      { label: 'Total face area (net, Σ per wall)',    value: `${r2(faceAreaFt2)} ft²` },
      { label: 'Total volume (Σ face × thickness)',    value: `${r2(volFt3)} ft³` },
      { label: `${isBrick ? 'Bricks' : 'Blocks'} per ft³`, value: String(density) },
      { label: 'Wastage',                             value: '5%' },
      { label: `Total (ceil)`,                        value: `${total.toLocaleString('en-IN')} ${unit}`, bold: true },
    ],
    note: isBrick
      ? 'Density includes mortar joints. Wastage 5% — currently fixed. Will become project-level setting in Phase 1.5 (varies by builder).'
      : `${mat.name} uses thin-bed adhesive — no mortar volume in unit count. Wastage 5% — currently fixed.`,
  }
}

export function explainCement(state, matKey) {
  const mat = MATERIAL_LIBRARY[matKey]
  if (!mat || mat.bondingType !== BONDING.CEMENT_SAND) return null
  const { volFt3 } = matVolumes(state, matKey)
  const mortarVol  = volFt3 * mat.mortarVolPerFt3Wall
  const cementBags = Math.ceil(mortarVol * mat.cementBagsPerFt3Mortar)
  return {
    title: `${mat.name} – Cement`,
    steps: [
      { label: 'Wall volume',                                              value: `${r2(volFt3)} ft³` },
      { label: `Mortar vol  (× ${mat.mortarVolPerFt3Wall} ft³/ft³ wall)`, value: `${r2(mortarVol)} ft³` },
      { label: `Cement  (× ${mat.cementBagsPerFt3Mortar} bags/ft³, ceil)`, value: `${cementBags} bags`, bold: true },
    ],
    note: 'Mortar ratio 1:6 — currently fixed in material library. Will become project-level setting in Phase 1.5 (varies by builder/package).',
  }
}

export function explainSand(state, matKey) {
  const mat = MATERIAL_LIBRARY[matKey]
  if (!mat || mat.bondingType !== BONDING.CEMENT_SAND) return null
  const { volFt3 } = matVolumes(state, matKey)
  const mortarVol = volFt3 * mat.mortarVolPerFt3Wall
  const sandFt3   = mortarVol * mat.sandFt3PerFt3Mortar
  return {
    title: `${mat.name} – Sand`,
    steps: [
      { label: 'Wall volume',                                              value: `${r2(volFt3)} ft³` },
      { label: `Mortar vol  (× ${mat.mortarVolPerFt3Wall} ft³/ft³ wall)`, value: `${r2(mortarVol)} ft³` },
      { label: `Sand  (× ${mat.sandFt3PerFt3Mortar} loose ft³/ft³)`,     value: `${r2(sandFt3)} ft³`, bold: true },
    ],
    note: 'Dry-to-wet expansion factor included in multiplier. Mortar ratio 1:6 — currently fixed in material library. Will become project-level setting in Phase 1.5.',
  }
}

export function explainAdhesive(state, matKey) {
  const mat = MATERIAL_LIBRARY[matKey]
  if (!mat || mat.bondingType !== BONDING.THIN_BED) return null
  const { count, faceAreaFt2 } = matVolumes(state, matKey)
  const adhesiveKg   = faceAreaFt2 * mat.adhesiveKgPerFt2
  const adhesiveBags = Math.ceil(adhesiveKg / mat.adhesiveBagKg)
  const kgPerM2      = (mat.adhesiveKgPerFt2 / 0.0929).toFixed(1)
  return {
    title: `${mat.name} – Adhesive`,
    steps: [
      { label: 'Walls using this material',                  value: String(count) },
      { label: 'Total wall face area',                      value: `${r2(faceAreaFt2)} ft²` },
      { label: `Adhesive  (× ${mat.adhesiveKgPerFt2} kg/ft²)`, value: `${r2(adhesiveKg)} kg` },
      { label: `Bag size`,                                  value: `${mat.adhesiveBagKg} kg/bag` },
      { label: 'Adhesive bags (ceil)',                      value: `${adhesiveBags} bags`, bold: true },
    ],
    note: `${mat.adhesiveKgPerFt2} kg/ft² = ${kgPerM2} kg/m² from manufacturer spec. Currently fixed in material library.`,
  }
}

export function explainCivilExcavation({ stamps }, stampType) {
  const typeName = STAMP_NAME[stampType] || stampType
  const relevant  = civilStamps({ stamps }, stampType)
  let totalRaw = 0
  const steps = relevant.map(s => {
    const wFt = s.w / 12, hFt = s.h / 12, dFt = s.depth / 12
    const vol = wFt * hFt * dFt
    totalRaw += vol
    return { label: `"${s.name}"  (${r2(wFt)}×${r2(hFt)}×${r2(dFt)} ft)`, value: `${r2(vol)} ft³` }
  })
  if (!relevant.length) steps.push({ label: `No ${typeName} stamps`, value: '0 ft³' })
  steps.push({ label: 'Total excavation', value: `${r2(totalRaw)} ft³`, bold: true })
  return {
    title: `${typeName} – Excavation`,
    steps,
    note: 'OHT excluded — above-ground installation, no excavation. OHT structural quantities deferred to Phase 1.5.',
  }
}

export function explainCivilBrickwork({ stamps }, stampType) {
  const typeName = STAMP_NAME[stampType] || stampType
  const relevant  = civilStamps({ stamps }, stampType)
  let totalRaw = 0
  const steps = relevant.map(s => {
    const wFt = s.w / 12, hFt = s.h / 12, dFt = s.depth / 12
    const perimFt = 2 * (wFt + hFt)
    let activeFt = perimFt, suffix = ''
    if (stampType === 'septic_tank') {
      const partFt = Math.min(wFt, hFt)
      activeFt = perimFt + partFt
      suffix = ` + ${r2(partFt)} ft partition`
    }
    const vol = activeFt * dFt * 0.75
    totalRaw += vol
    return { label: `"${s.name}"  (perim ${r2(perimFt)} ft${suffix} × ${r2(dFt)} ft × 0.75 ft)`, value: `${r2(vol)} ft³` }
  })
  if (!relevant.length) steps.push({ label: `No ${typeName} stamps`, value: '0 ft³' })
  steps.push({ label: 'Total brickwork', value: `${r2(totalRaw)} ft³`, bold: true })
  return {
    title: `${typeName} – Brickwork (9")`,
    steps,
    note: 'Wall thickness 9" (0.75 ft) — Indian residential standard. Computed on outer dimensions; inner clear dims are slightly smaller. Acceptable for schematic BOQ.',
  }
}

export function explainCivilRCC({ stamps }, stampType) {
  const typeName = STAMP_NAME[stampType] || stampType
  const relevant  = civilStamps({ stamps }, stampType)
  let totalRaw = 0
  const steps = relevant.map(s => {
    const footFt2 = (s.w / 12) * (s.h / 12)
    const vol = footFt2 * 0.5 + footFt2 * 0.5
    totalRaw += vol
    return { label: `"${s.name}"  (${r2(footFt2)} ft² × 0.5 ft bottom + 0.5 ft top)`, value: `${r2(vol)} ft³` }
  })
  if (!relevant.length) steps.push({ label: `No ${typeName} stamps`, value: '0 ft³' })
  steps.push({ label: 'Total RCC', value: `${r2(totalRaw)} ft³`, bold: true })
  return {
    title: `${typeName} – RCC Slabs`,
    steps,
    note: 'Top and bottom slabs each 6" (0.5 ft) thick. Merged to a single rate in BOQ; stored separately for future spec divergence in Phase 1.5.',
  }
}

export function explainCivilPlaster({ stamps }, stampType) {
  const typeName = STAMP_NAME[stampType] || stampType
  const relevant  = civilStamps({ stamps }, stampType)
  let totalRaw = 0
  const steps = relevant.map(s => {
    const wFt = s.w / 12, hFt = s.h / 12, dFt = s.depth / 12
    const perimFt = 2 * (wFt + hFt)
    const footFt2 = wFt * hFt
    let wallsFt2 = perimFt * dFt, suffix = ''
    if (stampType === 'septic_tank') {
      wallsFt2 = (perimFt + Math.min(wFt, hFt)) * dFt
      suffix = ' (incl. partition)'
    }
    const vol = wallsFt2 + footFt2
    totalRaw += vol
    return { label: `"${s.name}"  (walls ${r2(wallsFt2)}${suffix} + floor ${r2(footFt2)} ft²)`, value: `${r2(vol)} ft²` }
  })
  if (!relevant.length) steps.push({ label: `No ${typeName} stamps`, value: '0 ft²' })
  steps.push({ label: 'Total inner plaster', value: `${r2(totalRaw)} ft²`, bold: true })
  return {
    title: `${typeName} – Plaster (Inner)`,
    steps,
    note: 'Inner surface only: 4 walls + floor. Outer faces not plastered for underground tanks.',
  }
}

export function explainCivilWaterproofing({ stamps }, stampType) {
  const base = explainCivilPlaster({ stamps }, stampType)
  return {
    ...base,
    title: base.title.replace('Plaster (Inner)', 'Waterproofing'),
    note: 'Waterproofing area = all inner plastered faces (4 walls + floor). Approximation — real systems vary (floor-only, floor + upturn, full tank, external membrane). Requires material spec input in Phase 1.5.',
  }
}
