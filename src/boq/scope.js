// Floor-scoped state wrapper for getBoqLines.
//
// The store's BOQ selectors (getMaterialQuantities, getColumnQuantities, etc.)
// are CLOSURES bound to the live store via Zustand's `get()`. Passing them a
// scoped state object DOES NOT scope them — they still read get().walls etc.
//
// To make per-floor BOQ work, we re-implement the relevant aggregators against
// floor-filtered collection maps and expose them on a state-like object. Pure
// functions in src/quantities/ that take `state` as a parameter then
// transparently auto-scope, because they call state.getXxx() (method dispatch)
// rather than the bound store closure.
//
// Adding a new aggregator that needs to support floor scoping: add a re-impl
// here AND wire it into the returned object so any caller through scopeState
// sees the scoped variant.

import { MATERIAL_LIBRARY, BONDING } from '../materials'
import {
  BEAM_LEVEL_REGISTRY,
  CEMENT_BAGS_PER_M3,
  STEEL_KG_PER_M3,
  AGGREGATE_SPLIT,
  SAND_M3_PER_M3_DRY,
  AGGREGATE_M3_PER_M3_DRY,
  PCC_BEDDING_THICKNESS_FT,
} from '../constants/structural'
import { getColumnAreaFt2 } from '../lib/columnShapes'

const FT3_TO_M3 = 0.0283168
const DEFAULT_FLOOR_ID = 'F1'

function r2(n) { return Math.round(n * 100) / 100 }

function filterMap(map, pred) {
  const out = {}
  for (const [k, v] of Object.entries(map || {})) if (pred(v)) out[k] = v
  return out
}

// A column is "on" a floor iff floorId ∈ [baseFloorId, topFloorId] in sequence.
function isColumnOnFloor(col, floorId, sortedFloors) {
  const baseIdx = sortedFloors.findIndex(f => f.id === (col.baseFloorId ?? floorId))
  const topIdx  = sortedFloors.findIndex(f => f.id === (col.topFloorId  ?? col.baseFloorId ?? floorId))
  const cIdx    = sortedFloors.findIndex(f => f.id === floorId)
  if (baseIdx === -1 || topIdx === -1 || cIdx === -1) return (col.baseFloorId ?? DEFAULT_FLOOR_ID) === floorId
  return cIdx >= Math.min(baseIdx, topIdx) && cIdx <= Math.max(baseIdx, topIdx)
}

export function scopeStateToFloor(state, floorId) {
  if (!floorId) return state

  const sortedFloors = [...(state.projectSettings?.floors ?? [])]
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))

  const onFloor = e => (e.floorId ?? DEFAULT_FLOOR_ID) === floorId

  const walls       = filterMap(state.walls,       onFloor)
  const rooms       = filterMap(state.rooms,       onFloor)
  const stamps      = filterMap(state.stamps,      onFloor)
  const beams       = filterMap(state.beams,       onFloor)
  const slabs       = filterMap(state.slabs,       onFloor)
  const foundations = filterMap(state.foundations, onFloor)
  const columns     = filterMap(state.columns,     col => isColumnOnFloor(col, floorId, sortedFloors))
  // Staircases are visible on both fromFloor and toFloor.
  const staircases  = filterMap(state.staircases, sc =>
    (sc.fromFloorId ?? DEFAULT_FLOOR_ID) === floorId ||
    (sc.toFloorId   ?? DEFAULT_FLOOR_ID) === floorId)

  const wallIdSet = new Set(Object.keys(walls))
  const roomIdSet = new Set(Object.keys(rooms))

  // Delegate per-entity helpers to the live store; they're pure on their input id.
  const getWallArea     = (id) => wallIdSet.has(id) ? state.getWallArea(id) : 0
  const getWallLength   = (id) => wallIdSet.has(id) ? state.getWallLength(id) : 0
  const getRoomArea     = (id) => roomIdSet.has(id) ? state.getRoomArea(id) : 0
  const getRoomWallArea = (id) => roomIdSet.has(id) ? state.getRoomWallArea(id) : 0
  const getRoomPolygon  = (id) => roomIdSet.has(id) ? state.getRoomPolygon(id) : null
  const isRoomValid     = (id) => roomIdSet.has(id) ? state.isRoomValid(id) : false
  const isRoomStructurallyValid = (id) => roomIdSet.has(id) ? state.isRoomStructurallyValid(id) : false
  const getColumnHeightFt = (col) => state.getColumnHeightFt(col)

  // ── Room-set selectors ────────────────────────────────────────────────
  const getValidRoomIds = () => state.getValidRoomIds().filter(id => roomIdSet.has(id))

  const sumRoomAreas = (pred) => Math.round(
    getValidRoomIds().filter(id => pred(rooms[id])).reduce((t, id) => t + getRoomArea(id), 0) * 100
  ) / 100

  const getTotalFloorArea         = () => Math.round(getValidRoomIds().reduce((t, id) => t + getRoomArea(id), 0) * 100) / 100
  const getTotalFlooringArea      = () => sumRoomAreas(r => r?.finishes?.flooring)
  const getTotalCeilingPlasterArea = () => sumRoomAreas(r => r?.finishes?.ceilingPlaster)
  const getTotalWaterproofingArea = () => sumRoomAreas(r => r?.finishes?.waterproofing)
  const getTotalRoofingArea       = () => sumRoomAreas(r => r?.finishes?.roofing)
  const getTotalPaintCeilingArea  = () => sumRoomAreas(r => r?.finishes?.paint)
  const getTotalPaintWallsArea    = () => Math.round(
    getValidRoomIds().filter(id => rooms[id]?.finishes?.paint).reduce((t, id) => t + getRoomWallArea(id), 0) * 100
  ) / 100

  // ── Wall-set selectors ────────────────────────────────────────────────
  const getTotalWallArea = () => Math.round(
    Object.keys(walls).reduce((t, id) => t + getWallArea(id), 0) * 100
  ) / 100

  const getAllWallsLength = () => Object.values(walls).reduce((total, wall) => {
    if (wall.isVirtual) return total
    const a = state.nodes[wall.n1], b = state.nodes[wall.n2]
    if (!a || !b) return total
    return total + Math.hypot(b.x - a.x, b.y - a.y) / 12
  }, 0)

  // Walls-adjacency restricted to scoped rooms.
  const getWallAdjacencyCount = () => {
    const count = {}
    for (const room of Object.values(rooms)) {
      for (const wid of (room.wallIds || [])) count[wid] = (count[wid] || 0) + 1
    }
    return count
  }

  const classifyWallBeamFlags = (wallId) => {
    const wall = walls[wallId]
    if (!wall) return Object.fromEntries(BEAM_LEVEL_REGISTRY.map(lvl => [lvl.flagName, false]))
    const cnt   = getWallAdjacencyCount()[wallId] ?? 0
    const isExt = cnt === 1, isPart = cnt === 2
    const result = {}
    for (const lvl of BEAM_LEVEL_REGISTRY) {
      const override = wall[lvl.flagName]
      result[lvl.flagName] = override !== null
        ? override
        : (lvl.autoExternal && isExt) || (lvl.autoPartition && isPart)
    }
    return result
  }

  // ── Masonry quantities (scoped walls) ─────────────────────────────────
  const getMaterialQuantities = () => {
    const WASTAGE = 1.05
    const acc = {}
    for (const w of Object.values(walls)) {
      if (w.isVirtual) continue
      const matKey = w.materialKey ?? 'IS_MODULAR_BRICK'
      const mat = MATERIAL_LIBRARY[matKey]
      if (!mat) continue
      const faceAreaFt2 = getWallArea(w.id)
      const thicknessFt = (w.thickness ?? 9) / 12
      if (!acc[matKey]) acc[matKey] = { volFt3: 0, faceAreaFt2: 0 }
      acc[matKey].volFt3      += faceAreaFt2 * thicknessFt
      acc[matKey].faceAreaFt2 += faceAreaFt2
    }
    const result = {}
    for (const [matKey, { volFt3, faceAreaFt2 }] of Object.entries(acc)) {
      const mat = MATERIAL_LIBRARY[matKey]
      const unitPer = mat.bricksPerFt3 ?? mat.blocksPerFt3
      const entry = {
        volFt3:      r2(volFt3),
        faceAreaFt2: r2(faceAreaFt2),
        unitCount:   Math.ceil(volFt3 * unitPer * WASTAGE),
      }
      if (mat.bondingType === BONDING.CEMENT_SAND) {
        const mortarVol = volFt3 * mat.mortarVolPerFt3Wall
        entry.cementBags = Math.ceil(mortarVol * mat.cementBagsPerFt3Mortar)
        entry.sandFt3    = r2(mortarVol * mat.sandFt3PerFt3Mortar)
      } else {
        const adhesiveKg = faceAreaFt2 * mat.adhesiveKgPerFt2
        entry.adhesiveKg    = r2(adhesiveKg)
        entry.adhesiveBags  = Math.ceil(adhesiveKg / mat.adhesiveBagKg)
      }
      result[matKey] = entry
    }
    return result
  }

  const getMasonryWithBeamDeduction = () => {
    const base = getMaterialQuantities()
    if (!base || Object.keys(base).length === 0) return base ?? {}
    const { beamDimensions, wastagePercent } = state.projectSettings
    const WASTAGE = 1 + (wastagePercent ?? 5) / 100
    const deductions = {}
    for (const wall of Object.values(walls)) {
      if (wall.isVirtual || wall.isPlot) continue
      const matKey = wall.materialKey ?? 'IS_MODULAR_BRICK'
      const flags  = classifyWallBeamFlags(wall.id)
      const n1 = state.nodes[wall.n1], n2 = state.nodes[wall.n2]
      if (!n1 || !n2) continue
      const wallLenFt   = Math.hypot(n2.x - n1.x, n2.y - n1.y) / 12
      const wallThickFt = (wall.thickness ?? 9) / 12
      let deductFt3 = 0
      for (const lvl of BEAM_LEVEL_REGISTRY) {
        if (!flags[lvl.flagName]) continue
        const dims = beamDimensions[lvl.id]
        if (!dims) continue
        deductFt3 += wallLenFt * Math.min(wallThickFt, dims.widthIn / 12) * (dims.depthIn / 12)
      }
      if (deductFt3 > 0) deductions[matKey] = (deductions[matKey] ?? 0) + deductFt3
    }
    if (Object.keys(deductions).length === 0) return base
    const result = {}
    for (const [matKey, qty] of Object.entries(base)) {
      const deduct = deductions[matKey] ?? 0
      if (deduct === 0) { result[matKey] = qty; continue }
      const adjustedVol = Math.max(0, qty.volFt3 - deduct)
      const ratio = qty.volFt3 > 0 ? adjustedVol / qty.volFt3 : 0
      const mat   = MATERIAL_LIBRARY[matKey]
      if (!mat) { result[matKey] = { ...qty, volFt3: r2(adjustedVol) }; continue }
      const unitsPer  = mat.bricksPerFt3 ?? mat.blocksPerFt3 ?? 0
      const adjusted  = { ...qty, volFt3: r2(adjustedVol), unitCount: Math.ceil(adjustedVol * unitsPer * WASTAGE) }
      if (mat.bondingType === BONDING.CEMENT_SAND) {
        const mortarVol = adjustedVol * mat.mortarVolPerFt3Wall
        adjusted.cementBags = Math.ceil(mortarVol * mat.cementBagsPerFt3Mortar)
        adjusted.sandFt3    = r2(mortarVol * mat.sandFt3PerFt3Mortar)
      } else {
        adjusted.adhesiveKg   = r2((qty.adhesiveKg ?? 0) * ratio)
        adjusted.adhesiveBags = Math.ceil(adjusted.adhesiveKg / (mat.adhesiveBagKg ?? 40))
      }
      result[matKey] = adjusted
    }
    return result
  }

  // ── Column / beam / foundation / slab / staircase ─────────────────────
  const getColumnQuantities = () => {
    const { columnTypes } = state.projectSettings
    const result = {}
    for (const col of Object.values(columns)) {
      const ct = columnTypes.find(t => t.id === col.columnTypeId)
      if (!ct) continue
      const sectionFt2  = getColumnAreaFt2(ct)
      const colHeightFt = getColumnHeightFt(col)
      if (!result[ct.id]) result[ct.id] = { count: 0, columnHeightFt: colHeightFt, sectionFt2, volFt3: 0, label: ct.label }
      result[ct.id].count  += 1
      result[ct.id].volFt3 += sectionFt2 * colHeightFt
    }
    for (const k of Object.keys(result)) result[k].volFt3 = r2(result[k].volFt3)
    return result
  }

  const getFoundationQuantities = () => {
    const { columnTypes } = state.projectSettings
    const colQ = getColumnQuantities()
    const attachedSet = new Set()
    for (const f of Object.values(foundations)) for (const cid of (f.columnIds || [])) attachedSet.add(cid)
    const defaultPlumDepthFt = state.projectSettings.foundationDefaults?.plumDepthFt ?? 0
    const byColumnTypeInline = {}
    for (const ctId of Object.keys(colQ)) {
      const ct = columnTypes.find(t => t.id === ctId)
      if (!ct) continue
      const { footingLengthFt: lFt, footingWidthFt: wFt, footingDepthFt: dFt } = ct
      if (!lFt || !wFt || !dFt) continue
      const count = Object.values(columns).filter(col => col.columnTypeId === ctId && !attachedSet.has(col.id)).length
      if (count === 0) continue
      const footprintFt2 = lFt * wFt
      byColumnTypeInline[ctId] = {
        count,
        concreteVolFt3: r2(footprintFt2 * dFt * count),
        pccVolFt3:      r2(footprintFt2 * PCC_BEDDING_THICKNESS_FT * count),
        plumVolFt3:     r2(footprintFt2 * defaultPlumDepthFt * count),
        footprintFt2:   r2(footprintFt2 * count),
        label:          ct.label,
        lengthFt:       lFt, widthFt: wFt, depthFt: dFt,
      }
    }
    const byFoundation = {}
    for (const [fid, f] of Object.entries(foundations)) {
      const g = f.geometry || {}
      let concreteVolFt3 = 0, footprintFt2 = 0
      if (f.type === 'ISOLATED' || f.type === 'COMBINED' || f.type === 'STRIP') {
        const lFt = g.lengthFt || 0, wFt = g.widthFt || 0, dFt = g.depthFt || 0
        footprintFt2 = lFt * wFt
        concreteVolFt3 = footprintFt2 * dFt
      } else if (f.type === 'RAFT') {
        footprintFt2 = g.areaFt2 || 0
        concreteVolFt3 = footprintFt2 * (g.depthFt || 0)
      } else if (f.type === 'PILE') {
        footprintFt2 = (g.capLengthFt || 0) * (g.capWidthFt || 0)
        const capVol = footprintFt2 * (g.capDepthFt || 0)
        const pileVol = (g.pilesCount || 0) * Math.PI * Math.pow((g.pileDiamIn || 0) / 24, 2) * (g.pileLengthFt || 0)
        concreteVolFt3 = capVol + pileVol
      }
      const pccDepthFt  = f.pccDepthFt ?? PCC_BEDDING_THICKNESS_FT
      const plumDepthFt = f.plumDepthFt ?? 0
      byFoundation[fid] = {
        id: fid, type: f.type, columnIds: f.columnIds || [], wallIds: f.wallIds || [],
        floorId: f.floorId || DEFAULT_FLOOR_ID,
        concreteVolFt3: r2(concreteVolFt3),
        pccVolFt3:      r2(footprintFt2 * pccDepthFt),
        plumVolFt3:     r2(footprintFt2 * plumDepthFt),
        footprintFt2:   r2(footprintFt2),
        label:          f.label ?? `${f.type} foundation`,
        grade:          f.grade ?? 'M20',
      }
    }
    return { byFoundation, byColumnTypeInline }
  }
  const getFootingQuantities = () => getFoundationQuantities().byColumnTypeInline

  // Wall-derived beams scoped to scoped walls.
  const getDerivedWallBeams = () => {
    const nodeToColId = {}
    for (const col of Object.values(columns)) {
      if (col.attachedNodeId) nodeToColId[col.attachedNodeId] = col.id
    }
    const out = []
    for (const wall of Object.values(walls)) {
      if (wall.isVirtual || wall.isPlot) continue
      const flags = classifyWallBeamFlags(wall.id)
      const n1 = state.nodes[wall.n1], n2 = state.nodes[wall.n2]
      if (!n1 || !n2) continue
      for (const lvl of BEAM_LEVEL_REGISTRY) {
        if (!flags[lvl.flagName]) continue
        const fromRef = nodeToColId[wall.n1] ? { type: 'COLUMN', columnId: nodeToColId[wall.n1] } : { type: 'POINT', x: n1.x, y: n1.y }
        const toRef   = nodeToColId[wall.n2] ? { type: 'COLUMN', columnId: nodeToColId[wall.n2] } : { type: 'POINT', x: n2.x, y: n2.y }
        out.push({ id: `derived_${wall.id}_${lvl.id}`, endpoints: { from: fromRef, to: toRef }, level: lvl.id, source: 'WALL_DERIVED', sourceWallId: wall.id })
      }
    }
    return out
  }
  const getAllBeams = () => [...Object.values(beams), ...getDerivedWallBeams()]

  const getBeamQuantities = () => {
    const { beamDimensions } = state.projectSettings
    const endpointPos = (ref) => {
      if (ref.type === 'COLUMN') {
        const col = columns[ref.columnId]
        if (!col) return null
        if (col.attachedNodeId) { const nd = state.nodes[col.attachedNodeId]; return nd ?? null }
        return { x: col.x, y: col.y }
      }
      return { x: ref.x, y: ref.y }
    }
    const result = Object.fromEntries(BEAM_LEVEL_REGISTRY.map(lvl => [lvl.id, null]))
    for (const beam of getAllBeams()) {
      const dims = beamDimensions[beam.level]
      if (!dims) continue
      const from = endpointPos(beam.endpoints.from), to = endpointPos(beam.endpoints.to)
      if (!from || !to) continue
      const lenFt = Math.hypot(to.x - from.x, to.y - from.y) / 12
      if (!result[beam.level]) result[beam.level] = { totalLenFt: 0, widthIn: dims.widthIn, depthIn: dims.depthIn, volFt3: 0 }
      result[beam.level].totalLenFt += lenFt
      result[beam.level].volFt3     += lenFt * (dims.widthIn / 12) * (dims.depthIn / 12)
    }
    for (const lvl of BEAM_LEVEL_REGISTRY) if (result[lvl.id]) {
      result[lvl.id].totalLenFt = r2(result[lvl.id].totalLenFt)
      result[lvl.id].volFt3     = r2(result[lvl.id].volFt3)
    }
    return result
  }

  const getSlabQuantities = () => {
    const { mainThicknessIn, sunkenDepthIn, autoSunkenRoomTypes } = state.projectSettings.slabSettings
    const validIds = getValidRoomIds()
    const validSet = new Set(validIds)
    let mainAreaFt2 = 0, sunkenAreaFt2 = 0
    const sunkenRooms = []
    if (Object.keys(slabs).length === 0) {
      // Fallback: auto-derive from room types
      for (const rid of validIds) {
        const room = rooms[rid]; if (!room) continue
        const area = getRoomArea(rid)
        if (autoSunkenRoomTypes.includes(room.type)) {
          sunkenAreaFt2 += area
          sunkenRooms.push({ roomId: rid, name: room.name, areaFt2: r2(area) })
        } else mainAreaFt2 += area
      }
    } else {
      for (const slab of Object.values(slabs)) {
        for (const rid of slab.roomIds) {
          if (!validSet.has(rid)) continue
          const area = getRoomArea(rid)
          if (slab.type === 'SUNKEN') {
            sunkenAreaFt2 += area
            sunkenRooms.push({ roomId: rid, name: rooms[rid]?.name ?? rid, areaFt2: r2(area) })
          } else mainAreaFt2 += area
        }
      }
    }
    return {
      mainAreaFt2:   r2(mainAreaFt2),
      mainVolFt3:    r2(mainAreaFt2 * mainThicknessIn / 12),
      sunkenAreaFt2: r2(sunkenAreaFt2),
      sunkenVolFt3:  r2(sunkenAreaFt2 * (mainThicknessIn + sunkenDepthIn) / 12),
      sunkenRooms,
    }
  }

  const getStaircaseQuantities = () => Object.values(staircases).map(sc => {
    const stepCount   = sc.flightCount * sc.stepsPerFlight
    const riserFt     = sc.riserIn / 12
    const treadFt     = sc.treadIn / 12
    const flightLenFt = Math.hypot(treadFt * sc.stepsPerFlight, riserFt * sc.stepsPerFlight)
    const waistThickFt = sc.waistSlabIn / 12
    const waistSlabFt3 = flightLenFt * sc.flightWidthFt * waistThickFt * sc.flightCount
    const landingCount = Math.max(1, sc.flightCount)
    const landingFt3   = sc.landingFtWidth * sc.landingFtLength * waistThickFt * landingCount
    const totalRccFt3  = r2(waistSlabFt3 + landingFt3)
    const graniteFt2   = r2(treadFt * sc.flightWidthFt * stepCount + sc.landingFtWidth * sc.landingFtLength * landingCount)
    return { id: sc.id, stepCount, waistSlabFt3: r2(waistSlabFt3), landingFt3: r2(landingFt3), totalRccFt3, graniteFt2 }
  })

  const getSunshadeQuantities = () => {
    const { projectionFt, thicknessIn } = state.projectSettings.sunshadeSettings
    let count = 0, totalVolFt3 = 0
    for (const wall of Object.values(walls)) {
      for (const op of (wall.openings || [])) {
        if (op.type !== 'window' || !op.hasSunshade) continue
        count++
        totalVolFt3 += projectionFt * (op.width / 12) * (thicknessIn / 12)
      }
    }
    return { count, totalVolFt3: r2(totalVolFt3) }
  }

  const getParapetQuantities = () => {
    const { enabled, heightFt, thicknessIn, materialKey } = state.projectSettings.parapetSettings
    if (!enabled) return { totalLenFt: 0, heightFt, thicknessIn, totalVolFt3: 0, materialKey }
    const adjCount = getWallAdjacencyCount()
    const validRoomIds = getValidRoomIds()
    const wallBordersRoofing = new Set()
    for (const rid of validRoomIds) {
      const room = rooms[rid]
      if (!room?.finishes?.roofing) continue
      for (const wid of room.wallIds) wallBordersRoofing.add(wid)
    }
    let totalLenFt = 0
    for (const wall of Object.values(walls)) {
      if (wall.isVirtual || wall.isPlot) continue
      if ((adjCount[wall.id] ?? 0) !== 1) continue
      if (!wallBordersRoofing.has(wall.id)) continue
      const n1 = state.nodes[wall.n1], n2 = state.nodes[wall.n2]
      if (!n1 || !n2) continue
      totalLenFt += Math.hypot(n2.x - n1.x, n2.y - n1.y) / 12
    }
    return {
      totalLenFt: r2(totalLenFt), heightFt, thicknessIn,
      totalVolFt3: r2(totalLenFt * heightFt * (thicknessIn / 12)),
      materialKey,
    }
  }

  // ── Civil stamp quantities (scoped stamps) ────────────────────────────
  const stampDims = (s) => ({
    wFt: (s.w || 0) / 12, hFt: (s.h || 0) / 12, dFt: (s.depth || 0) / 12,
    perimeterFt: 2 * (((s.w || 0) / 12) + ((s.h || 0) / 12)),
    footprintFt2: ((s.w || 0) / 12) * ((s.h || 0) / 12),
  })
  const getSumpCivilQty = () => Object.values(stamps)
    .filter(s => s.type === 'sump' && s.depth)
    .reduce((acc, s) => {
      const { dFt, perimeterFt, footprintFt2 } = stampDims(s)
      acc.excavFt3     += footprintFt2 * dFt
      acc.brickFt3     += perimeterFt * dFt * 0.75
      acc.rccBottomFt3 += footprintFt2 * 0.5
      acc.rccTopFt3    += footprintFt2 * 0.5
      acc.plasterFt2   += perimeterFt * dFt + footprintFt2
      return acc
    }, { excavFt3: 0, brickFt3: 0, rccBottomFt3: 0, rccTopFt3: 0, plasterFt2: 0 })
  const getSepticCivilQty = () => Object.values(stamps)
    .filter(s => s.type === 'septic_tank' && s.depth)
    .reduce((acc, s) => {
      const { wFt, hFt, dFt, perimeterFt, footprintFt2 } = stampDims(s)
      const partitionFt = Math.min(wFt, hFt)
      acc.excavFt3     += footprintFt2 * dFt
      acc.brickFt3     += (perimeterFt + partitionFt) * dFt * 0.75
      acc.rccBottomFt3 += footprintFt2 * 0.5
      acc.rccTopFt3    += footprintFt2 * 0.5
      acc.plasterFt2   += (perimeterFt + partitionFt) * dFt + footprintFt2
      return acc
    }, { excavFt3: 0, brickFt3: 0, rccBottomFt3: 0, rccTopFt3: 0, plasterFt2: 0 })
  const getStampsByType = (type) => Object.values(stamps).filter(s => s.type === type)
  const getTotalExcavationVolumeFt3 = () => Math.round(
    Object.values(stamps).filter(s => (s.type === 'sump' || s.type === 'septic_tank') && s.depth)
      .reduce((t, s) => t + (s.w * s.h * s.depth) / 1728, 0) * 100
  ) / 100

  // ── Composed: steel + concrete ────────────────────────────────────────
  // Per-entity steel computation with partial BBS exclusion. Mirrors the
  // store's getSteelQuantities(opts) signature so boq/lines.js can pass
  // the BBS-aggregator-emitted excludeIds and avoid double-counting.
  const getSteelQuantities = (opts = {}) => {
    const steelRatios = state.projectSettings.rccSpecs?.steelKgPerM3 ?? STEEL_KG_PER_M3
    const toM3 = ft3 => ft3 * FT3_TO_M3

    const toSet = (v) => v instanceof Set ? v : new Set(v ?? [])
    const exColumns       = toSet(opts.excludeColumnIds)
    const exBeams         = toSet(opts.excludeBeamIds)
    const exSlabs         = toSet(opts.excludeSlabIds)
    const exFoundations   = toSet(opts.excludeFoundationIds)
    const exInlineFooting = toSet(opts.excludeColumnTypeFootingIds)

    const { columnTypes, beamDimensions, slabSettings } = state.projectSettings

    // Columns
    let colFt3 = 0
    for (const col of Object.values(columns)) {
      if (exColumns.has(col.id)) continue
      const ct = columnTypes.find(t => t.id === col.columnTypeId)
      if (!ct) continue
      colFt3 += getColumnAreaFt2(ct) * getColumnHeightFt(col)
    }

    // Beams (scoped explicit + scoped wall-derived)
    const endpointPos = (ref) => {
      if (ref.type === 'COLUMN') {
        const col = columns[ref.columnId]
        if (!col) return null
        if (col.attachedNodeId) { const nd = state.nodes[col.attachedNodeId]; return nd ?? null }
        return { x: col.x, y: col.y }
      }
      return { x: ref.x, y: ref.y }
    }
    let beamFt3 = 0
    for (const b of getAllBeams()) {
      if (exBeams.has(b.id)) continue
      const dims = beamDimensions[b.level]
      if (!dims) continue
      const from = endpointPos(b.endpoints.from)
      const to   = endpointPos(b.endpoints.to)
      if (!from || !to) continue
      const lenFt = Math.hypot(to.x - from.x, to.y - from.y) / 12
      beamFt3 += lenFt * (dims.widthIn / 12) * (dims.depthIn / 12)
    }

    // Slabs (scoped). When scoped slabs map is empty, fall back to derived.
    let slabFt3 = 0
    if (Object.keys(slabs).length === 0) {
      const slabQ = getSlabQuantities()
      slabFt3 = slabQ.mainVolFt3 + slabQ.sunkenVolFt3
    } else {
      const validSet = new Set(getValidRoomIds())
      for (const slab of Object.values(slabs)) {
        if (exSlabs.has(slab.id)) continue
        let areaFt2 = 0
        for (const rid of (slab.roomIds ?? [])) {
          if (!validSet.has(rid)) continue
          areaFt2 += getRoomArea(rid) ?? 0
        }
        const isSunken = slab.type === 'SUNKEN'
        const thickIn = isSunken
          ? slabSettings.mainThicknessIn + slabSettings.sunkenDepthIn
          : slabSettings.mainThicknessIn
        slabFt3 += areaFt2 * thickIn / 12
      }
    }

    // Footings (scoped foundations + inline buckets)
    const fdnQ = getFoundationQuantities()
    let footFt3 = 0
    for (const [fid, q] of Object.entries(fdnQ.byFoundation)) {
      if (exFoundations.has(fid)) continue
      footFt3 += q.concreteVolFt3
    }
    for (const [ctId, q] of Object.entries(fdnQ.byColumnTypeInline)) {
      if (exInlineFooting.has(ctId)) continue
      footFt3 += q.concreteVolFt3
    }

    const stairQ = getStaircaseQuantities()
    const sumpQty   = getSumpCivilQty()
    const septicQty = getSepticCivilQty()
    const stairM3 = toM3(stairQ.reduce((s, q) => s + q.totalRccFt3, 0))
    const civilM3 = toM3(sumpQty.rccBottomFt3 + sumpQty.rccTopFt3 + septicQty.rccBottomFt3 + septicQty.rccTopFt3)

    const footM3 = toM3(footFt3), colM3 = toM3(colFt3), beamM3 = toM3(beamFt3), slabM3 = toM3(slabFt3)
    const footing    = Math.round(footM3  * (steelRatios.FOOTING    ?? STEEL_KG_PER_M3.FOOTING))
    const column     = Math.round(colM3   * (steelRatios.COLUMN     ?? STEEL_KG_PER_M3.COLUMN))
    const beam       = Math.round(beamM3  * (steelRatios.BEAM       ?? STEEL_KG_PER_M3.BEAM))
    const slab       = Math.round(slabM3  * (steelRatios.SLAB       ?? STEEL_KG_PER_M3.SLAB))
    const staircase  = Math.round(stairM3 * (steelRatios.STAIRCASE  ?? STEEL_KG_PER_M3.STAIRCASE))
    const civilStamp = Math.round(civilM3 * (steelRatios.CIVIL_STAMP ?? STEEL_KG_PER_M3.CIVIL_STAMP))
    return { footing, column, beam, slab, staircase, civilStamp, total: footing + column + beam + slab + staircase + civilStamp }
  }

  const getConcreteByGrade = () => {
    const colQ = getColumnQuantities()
    const fdnQ = getFoundationQuantities()
    const beamQ = getBeamQuantities()
    const slabQ = getSlabQuantities()
    const stairQ = getStaircaseQuantities()
    const sunQ = getSunshadeQuantities()
    const fdnConcreteFt3 =
      Object.values(fdnQ.byFoundation).reduce((s, q) => s + q.concreteVolFt3, 0) +
      Object.values(fdnQ.byColumnTypeInline).reduce((s, q) => s + q.concreteVolFt3, 0)
    const m20Ft3 =
      Object.values(colQ).reduce((s, q) => s + q.volFt3, 0) + fdnConcreteFt3 +
      Object.values(beamQ).filter(Boolean).reduce((s, q) => s + q.volFt3, 0) +
      slabQ.mainVolFt3 + slabQ.sunkenVolFt3 +
      stairQ.reduce((s, q) => s + q.totalRccFt3, 0) + sunQ.totalVolFt3
    const pccFt3 =
      Object.values(fdnQ.byFoundation).reduce((s, q) => s + q.pccVolFt3, 0) +
      Object.values(fdnQ.byColumnTypeInline).reduce((s, q) => s + q.pccVolFt3, 0)
    const m20M3 = m20Ft3 * FT3_TO_M3, pccM3 = pccFt3 * FT3_TO_M3
    const result = {}
    if (m20M3 > 0) result.M20 = {
      volM3:        r2(m20M3),
      cementBags:   Math.ceil(m20M3 * CEMENT_BAGS_PER_M3.M20),
      sandM3DRY:    r2(m20M3 * SAND_M3_PER_M3_DRY.M20),
      agg10mmM3DRY: r2(m20M3 * AGGREGATE_M3_PER_M3_DRY.M20 * AGGREGATE_SPLIT.M20.mm10Ratio),
      agg20mmM3DRY: r2(m20M3 * AGGREGATE_M3_PER_M3_DRY.M20 * AGGREGATE_SPLIT.M20.mm20Ratio),
    }
    if (pccM3 > 0) result.M7_5 = {
      volM3:        r2(pccM3),
      cementBags:   Math.ceil(pccM3 * CEMENT_BAGS_PER_M3.M7_5),
      sandM3DRY:    r2(pccM3 * SAND_M3_PER_M3_DRY.M7_5),
      agg20mmM3DRY: r2(pccM3 * AGGREGATE_M3_PER_M3_DRY.M7_5),
    }
    return result
  }

  // Build the scoped state. Spread first so the live state's helpers
  // (projectSettings, nodes, formula helpers, etc.) are inherited; then
  // override with floor-scoped collections and re-implemented selectors.
  return {
    ...state,
    walls, rooms, stamps, columns, beams, slabs, staircases, foundations,
    // Per-entity helpers (delegate)
    getWallArea, getWallLength, getRoomArea, getRoomWallArea, getRoomPolygon,
    isRoomValid, isRoomStructurallyValid, getColumnHeightFt,
    // Room-set selectors
    getValidRoomIds, sumRoomAreas, getTotalFloorArea,
    getTotalFlooringArea, getTotalCeilingPlasterArea, getTotalWaterproofingArea,
    getTotalRoofingArea, getTotalPaintCeilingArea, getTotalPaintWallsArea,
    // Wall-set selectors
    getTotalWallArea, getAllWallsLength, getWallAdjacencyCount, classifyWallBeamFlags,
    // Masonry
    getMaterialQuantities, getMasonryWithBeamDeduction,
    // Structural
    getColumnQuantities, getFoundationQuantities, getFootingQuantities,
    getDerivedWallBeams, getAllBeams, getBeamQuantities,
    getSlabQuantities, getStaircaseQuantities,
    getSunshadeQuantities, getParapetQuantities,
    // Composed
    getSteelQuantities, getConcreteByGrade,
    // Civil
    getSumpCivilQty, getSepticCivilQty, getStampsByType,
    getTotalExcavationVolumeFt3,
    // Floor scope marker (consumers can check)
    _scopedFloorId: floorId,
  }
}
