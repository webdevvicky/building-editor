// Formula explainer: beam volume deducted from masonry per material key.
// Contract: (state, matKey?) => { title, steps: [{ label, value, bold? }], note? }
// state must expose: walls, nodes, projectSettings, classifyWallBeamFlags(wallId)

import { BEAM_LEVEL_REGISTRY } from '../constants/structural'

function r2(n) { return Math.round(n * 100) / 100 }

// Returns display label for a beam level, annotating auto-derived flags.
// wall[flag] === null means the flag was not set explicitly — resolved via room adjacency.
function levelLabel(beamDef, wall) {
  const explicit = wall[beamDef.flag]
  return explicit === null ? `${beamDef.label} (auto)` : beamDef.label
}

export function explainMasonryBeamDeduction(state, matKey) {
  const { walls, nodes, projectSettings, classifyWallBeamFlags } = state
  const beamDims = projectSettings?.beamDimensions ?? {}

  const title = `Beam Deduction — ${matKey ?? 'all materials'}`

  const NOTE =
    'Beam deduction calculated per wall as length × effective-beam-width × beam-depth. ' +
    'This is an approximation — junctions and corners may slightly over-deduct. ' +
    'Wastage allowance compensates. Auto-derived flags shown as ' +
    "'auto (external)' or 'auto (partition)'."

  const wallList = Object.values(walls)
    .filter(w => !w.isVirtual && !w.isPlot)
    .filter(w => !matKey || (w.materialKey ?? 'IS_MODULAR_BRICK') === matKey)

  const steps = []
  let grandTotal = 0
  let wallIndex = 0

  for (const wall of wallList) {
    const n1 = nodes[wall.n1], n2 = nodes[wall.n2]
    if (!n1 || !n2) continue

    const flags = classifyWallBeamFlags(wall.id)
    const activeBeams = BEAM_LEVEL_REGISTRY.filter(lvl => flags[lvl.flagName])
    if (activeBeams.length === 0) continue

    wallIndex++
    const wallLenFt   = Math.hypot(n2.x - n1.x, n2.y - n1.y) / 12
    const wallThickFt = (wall.thickness ?? 9) / 12
    const activeLabelStr = activeBeams.map(lvl => levelLabel({ flag: lvl.flagName, label: lvl.label }, wall)).join(', ')

    let wallDeduct = 0
    const perLevelParts = []

    for (const lvl of activeBeams) {
      const dim = beamDims[lvl.id]
      if (!dim) continue
      const effWidthFt = Math.min(wallThickFt, dim.widthIn / 12)
      const depthFt    = dim.depthIn / 12
      const deductFt3  = wallLenFt * effWidthFt * depthFt
      wallDeduct += deductFt3
      perLevelParts.push(
        `${lvl.label}: ${r2(wallLenFt)}×${r2(effWidthFt)}×${r2(depthFt)} = ${r2(deductFt3)} ft³`
      )
    }

    grandTotal += wallDeduct

    steps.push({
      label: `Wall ${wallIndex} — ${r2(wallLenFt)} ft [${activeLabelStr}]`,
      value: perLevelParts.join(' | '),
    })
    steps.push({
      label: `  ↳ Wall ${wallIndex} subtotal`,
      value: `${r2(wallDeduct)} ft³`,
    })
  }

  if (steps.length === 0) {
    return {
      title,
      steps: [{ label: 'No beam deductions for this material', value: '—' }],
      note: NOTE,
    }
  }

  steps.push({ label: 'Total beam deduction', value: `${r2(grandTotal)} ft³`, bold: true })

  return { title, steps, note: NOTE }
}
