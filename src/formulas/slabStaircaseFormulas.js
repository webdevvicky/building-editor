// Structural BOQ formula explainers for slab, sunshade, parapet, staircase.
// Each function: (state) => { title, steps: [{ label, value, bold? }], note? }
// state is the full Zustand store state — no store imports needed.

import { safeR2 as r2 } from '../lib/numbers.js'

// ---------------------------------------------------------------------------
// 1. Main slab
// ---------------------------------------------------------------------------
export function explainSlabMain(state) {
  const slabQtys = state.getSlabQuantities()
  const thicknessIn = state.projectSettings?.slabSettings?.mainThicknessIn ?? 0
  const thicknessFt = r2(thicknessIn / 12)

  if (!slabQtys || slabQtys.mainAreaFt2 === 0) {
    return {
      title: 'Main slab',
      steps: [{ label: 'No main slab area', value: '—' }],
      note: 'Main slab covers all rooms except sunken rooms. Thickness from projectSettings.slabSettings.',
    }
  }

  const area = r2(slabQtys.mainAreaFt2)
  const vol = r2(slabQtys.mainVolFt3)
  const sunkenCount = (slabQtys.sunkenRooms ?? []).length
  const roomCount = Object.keys(state.rooms ?? {}).length
  const mainRoomCount = roomCount - sunkenCount

  return {
    title: 'Main slab',
    steps: [
      { label: 'Total rooms', value: `${roomCount} rooms` },
      { label: 'Sunken rooms excluded', value: `${sunkenCount} rooms` },
      { label: 'Main slab rooms', value: `${mainRoomCount} rooms` },
      { label: 'Main slab area', value: `${area} ft²` },
      { label: 'Slab thickness', value: `${thicknessIn} in (${thicknessFt} ft)` },
      { label: 'Volume  =  area × thickness', value: `${area} × ${thicknessFt} = ${vol} ft³`, bold: true },
    ],
    note: 'Main slab covers all rooms except sunken rooms. Thickness from projectSettings.slabSettings.',
  }
}

// ---------------------------------------------------------------------------
// 2. Sunken slab
// ---------------------------------------------------------------------------
export function explainSlabSunken(state) {
  const slabQtys = state.getSlabQuantities()
  const mainThicknessIn = state.projectSettings?.slabSettings?.mainThicknessIn ?? 0
  const sunkenDepthIn = state.projectSettings?.slabSettings?.sunkenDepthIn ?? 0
  const totalThicknessIn = mainThicknessIn + sunkenDepthIn
  const totalThicknessFt = r2(totalThicknessIn / 12)

  const sunkenRooms = slabQtys?.sunkenRooms ?? []

  if (sunkenRooms.length === 0) {
    return {
      title: 'Sunken slab',
      steps: [{ label: 'No sunken rooms', value: '—' }],
      note: 'Sunken slab depth = main thickness + sink depth to accommodate waterproofing and structural depression.',
    }
  }

  const steps = []

  for (const room of sunkenRooms) {
    steps.push({ label: room.name, value: `${r2(room.areaFt2)} ft²` })
  }

  const totalArea = r2(slabQtys.sunkenAreaFt2)
  const totalVol = r2(slabQtys.sunkenVolFt3)

  steps.push({ label: 'Total sunken area', value: `${totalArea} ft²` })
  steps.push({ label: 'Main thickness', value: `${mainThicknessIn} in` })
  steps.push({ label: 'Sink depth', value: `${sunkenDepthIn} in` })
  steps.push({ label: 'Total slab depth  =  main + sink', value: `${mainThicknessIn} + ${sunkenDepthIn} = ${totalThicknessIn} in (${totalThicknessFt} ft)` })
  steps.push({ label: 'Volume  =  area × depth', value: `${totalArea} × ${totalThicknessFt} = ${totalVol} ft³`, bold: true })

  return {
    title: 'Sunken slab',
    steps,
    note: 'Sunken slab depth = main thickness + sink depth to accommodate waterproofing and structural depression.',
  }
}

// ---------------------------------------------------------------------------
// 3. Sunshades
// ---------------------------------------------------------------------------
export function explainSunshades(state) {
  const sunQtys = state.getSunshadeQuantities()
  const projectionFt = state.projectSettings?.sunshadeSettings?.projectionFt ?? 0
  const thicknessIn = state.projectSettings?.sunshadeSettings?.thicknessIn ?? 0
  const thicknessFt = r2(thicknessIn / 12)

  if (!sunQtys || sunQtys.count === 0) {
    return {
      title: 'Sunshades',
      steps: [{ label: 'No windows with sunshade enabled', value: '—' }],
      note: 'Sunshade quantity = projection × window width × slab thickness. One sunshade per window with hasSunshade enabled.',
    }
  }

  const count = sunQtys.count
  const totalVol = r2(sunQtys.totalVolFt3)

  return {
    title: 'Sunshades',
    steps: [
      { label: 'Windows with sunshade', value: `${count}` },
      { label: 'Projection length', value: `${r2(projectionFt)} ft` },
      { label: 'Sunshade thickness', value: `${thicknessIn} in (${thicknessFt} ft)` },
      { label: 'Formula  =  projection × width × thickness × count', value: `(summed per window)` },
      { label: 'Total sunshade volume', value: `${totalVol} ft³`, bold: true },
    ],
    note: 'Sunshade quantity = projection × window width × slab thickness. One sunshade per window with hasSunshade enabled.',
  }
}

// ---------------------------------------------------------------------------
// 4. Parapet
// ---------------------------------------------------------------------------
export function explainParapet(state) {
  const parapetQtys = state.getParapetQuantities()
  const settings = state.projectSettings?.parapetSettings ?? {}
  const materialKey = parapetQtys?.materialKey ?? settings.materialKey ?? '—'

  if (!parapetQtys || parapetQtys.totalLenFt === 0) {
    return {
      title: 'Parapet',
      steps: [{ label: 'No parapet perimeter found', value: '—' }],
      note: 'Parapet measured along external walls adjacent to roofing rooms only. Thickness shown is structural; plaster applied separately.',
    }
  }

  const lenFt = r2(parapetQtys.totalLenFt)
  const heightFt = r2(parapetQtys.heightFt)
  const thicknessIn = parapetQtys.thicknessIn
  const thicknessFt = r2(thicknessIn / 12)
  const totalVol = r2(parapetQtys.totalVolFt3)

  return {
    title: 'Parapet',
    steps: [
      { label: 'External parapet perimeter', value: `${lenFt} ft` },
      { label: 'Parapet height', value: `${heightFt} ft` },
      { label: 'Parapet thickness', value: `${thicknessIn} in (${thicknessFt} ft)` },
      { label: 'Material', value: materialKey },
      { label: 'Volume  =  perimeter × height × thickness', value: `${lenFt} × ${heightFt} × ${thicknessFt} = ${totalVol} ft³`, bold: true },
    ],
    note: 'Parapet measured along external walls adjacent to roofing rooms only. Thickness shown is structural; plaster applied separately.',
  }
}

// ---------------------------------------------------------------------------
// 5. Staircase RCC
// ---------------------------------------------------------------------------
export function explainStaircaseRCC(state) {
  const staircases = state.getStaircaseQuantities()

  if (!staircases || staircases.length === 0) {
    return {
      title: 'Staircase RCC',
      steps: [{ label: 'No staircases found', value: '—' }],
      note: 'Waist slab volume based on inclined slab spanning step hypotenuse. Landing volume uses landing dimensions × waist slab thickness.',
    }
  }

  const steps = []
  let grandTotalRcc = 0

  for (const sc of staircases) {
    const label = `Staircase ${sc.id}`
    steps.push({ label: `${label} — steps`, value: `${sc.stepCount}` })
    steps.push({ label: `${label} — waist slab`, value: `${r2(sc.waistSlabFt3)} ft³` })
    steps.push({ label: `${label} — landing`, value: `${r2(sc.landingFt3)} ft³` })
    steps.push({ label: `${label} — granite area`, value: `${r2(sc.graniteFt2)} ft²` })
    steps.push({ label: `${label} — total RCC`, value: `${r2(sc.totalRccFt3)} ft³` })
    grandTotalRcc += sc.totalRccFt3
  }

  steps.push({ label: 'Grand total RCC', value: `${r2(grandTotalRcc)} ft³`, bold: true })

  return {
    title: 'Staircase RCC',
    steps,
    note: 'Waist slab volume based on inclined slab spanning step hypotenuse. Landing volume uses landing dimensions × waist slab thickness.',
  }
}
