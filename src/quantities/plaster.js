// Plaster material quantities — internal (walls + columns + ceiling) and
// external (outer wall faces) split per Indian residential BOQ practice.
//
// Two-pass topology model (ROOM_FACE_ACCUMULATION_V2):
//   PASS 1 — Room iteration:
//     For each valid room on the current scope, sum getWallArea(wallId)
//     for each wallId in room.wallIds (skipping virtual + plot walls).
//     - Partition walls (adjacency===2) appear in TWO rooms' wallIds, so
//       they're counted twice — one inner face per room (correct).
//     - External walls (adjacency===1) appear in ONE room's wallIds, so
//       they're counted once — inner face only (outer goes to Pass 2).
//     Per-room ceiling adds when finishes.ceilingPlaster === true.
//     Plus per-column contribution: getColumnPerimeterFt × exposed floor
//     height (NOT the structural getColumnHeightFt, which includes plinth
//     + slab).
//   PASS 2 — Wall iteration over external walls:
//     For each wall where isExternalWall(state, wallId) is true, add
//     getWallArea(wallId) — interpreted here as the OUTER face area.
//     Partition walls are skipped by definition.
//
// Face ownership matrix (proves no surface is double-counted):
//   Partition (adj=2): both inner faces → Internal bucket (Pass 1 ×2).
//   External (adj=1):  inner face → Internal bucket (Pass 1 ×1).
//                      outer face → External bucket (Pass 2 ×1).
//   Column:            perimeter × exposedHeight → Internal (Pass 1 ×1).
//   Ceiling:           room floor area → Internal (Pass 1 ×1).
//   Plot / Virtual:    EXCLUDED from both passes.
//
// Opening subtraction contract (handled by getWallArea per face):
//   Each opening is deducted once per plastered face it interrupts.
//   - Partition opening: deducted twice (both rooms' inner faces) → both
//     inside Internal bucket. Net: 2× deduction inside one line.
//   - External opening: once Internal (room's inner face) + once External
//     (outer face). Net: 1× per line, total 2× across the two lines.
//   The implementation never accounts for openings explicitly — it just
//   calls getWallArea once per face. The contract is enforced structurally
//   by the face-ownership matrix.
//
// Wall height resolution:
//   Walls — use wall.height (existing; via getWallArea). FFL to slab bottom.
//   Columns — use the per-floor exposed height (floor.floorHeightFt of the
//     column's baseFloorId), NOT the structural multi-span height.
//     Multi-storey columns get plastered per floor via scope.js iteration.
//
// MANDATORY INVARIANT — quantity engines MUST NEVER consume rendered or
// visual geometry. Only topology APIs and canonical state geometry are
// allowed. No SVG-derived lengths, no overlay offsets, no visual wall
// thickness adjustments. Width × height × adjacency math from the store
// only. This invariant is checked by every reviewer; do not break it.

import {
  PLASTER_SYSTEMS, PLASTER_KIND, DEFAULT_PLASTER_SYSTEM_ID, FT2_TO_M2,
} from '../specs/plasterSystems'
import { isExternalWall } from '../topology/walls.js'
import { getColumnPerimeterFt } from '../lib/columnShapes.js'

const DEFAULT_FLOOR_HEIGHT_FT = 10
const DEFAULT_EXTERNAL_SYSTEM_ID = 'CEMENT_SAND_EXTERNAL'

function r2(n) { return Math.round(n * 100) / 100 }

function resolveInternalSystemId(room, projectSettings) {
  return room?.plasterSystemId
    ?? projectSettings?.defaultPlasterSystemId
    ?? DEFAULT_PLASTER_SYSTEM_ID
}

function resolveExternalSystemId(projectSettings) {
  return projectSettings?.defaultExternalPlasterSystemId
    ?? DEFAULT_EXTERNAL_SYSTEM_ID
}

// Private: per-floor exposed height for column plaster. Distinct from
// state.getColumnHeightFt(col) which includes plinth + slab thickness.
function getFloorHeightFtById(state, floorId) {
  const floors = state.projectSettings?.floors ?? []
  const f = floors.find(x => x.id === floorId)
  return f?.floorHeightFt ?? DEFAULT_FLOOR_HEIGHT_FT
}

function emptySystemEntry(sys, sysId) {
  return {
    systemId:              sysId,
    label:                 sys.label,
    kind:                  sys.kind,
    thicknessMm:           sys.thicknessMm,
    appliesContext:        sys.appliesContext,
    internalWallsAreaFt2:  0,
    columnAreaFt2:         0,
    ceilingAreaFt2:        0,
    externalWallsAreaFt2:  0,
    totalAreaFt2:          0,
    totalAreaM2:           0,
    rooms:                 [],
    externalWalls:         [],
    columns:               [],
  }
}

// Pure aggregator. Inputs come from `state` exclusively — never from
// canvas/SVG/rendered geometry (see invariant above).
export function computePlasterQuantities(state) {
  const { walls, rooms, columns = {}, projectSettings } = state
  const validIds = state.getValidRoomIds()
  const scopedFloorId = state._scopedFloorId ?? null

  const accBySystem = {}                  // systemId → entry (see emptySystemEntry)
  const totalsByFace = {
    partitionInnerFaces: 0,
    externalInnerFaces:  0,
    externalOuterFaces:  0,
    columnFaces:         0,
    ceilingFaces:        0,
  }
  const excluded = { virtualWalls: [], plotWalls: [], invalidRooms: [] }
  const warnings = []
  const perRoomMeta = []
  const perExternalWallMeta = []
  const perColumnMeta = []

  function ensureSystem(sysId) {
    const sys = PLASTER_SYSTEMS[sysId]
    if (!sys) return null
    if (!accBySystem[sysId]) accBySystem[sysId] = emptySystemEntry(sys, sysId)
    return accBySystem[sysId]
  }

  // ── PASS 1 — Room iteration (inner faces + ceiling + columns) ──────────
  const internalSysFallback = resolveInternalSystemId(null, projectSettings)
  for (const roomId of validIds) {
    const room = rooms[roomId]
    if (!room) { excluded.invalidRooms.push(roomId); continue }
    const sysId = resolveInternalSystemId(room, projectSettings)
    const sys = PLASTER_SYSTEMS[sysId]
    if (!sys) continue
    const bucket = ensureSystem(sysId)

    const wallContributions = []
    let roomWallSum = 0
    for (const wid of (room.wallIds ?? [])) {
      const w = walls[wid]
      if (!w) continue
      if (w.isVirtual) { if (!excluded.virtualWalls.includes(wid)) excluded.virtualWalls.push(wid); continue }
      if (w.isPlot)    { if (!excluded.plotWalls.includes(wid))    excluded.plotWalls.push(wid);    continue }
      const faceArea = state.getWallArea(wid)
      const openingDeduction = (w.openings ?? []).reduce(
        (s, o) => s + (o.width / 12) * (o.height / 12), 0
      )
      const isExt = isExternalWall(state, wid)
      wallContributions.push({
        wallId: wid,
        wallType: isExt ? 'EXTERNAL' : 'PARTITION',
        faceAreaFt2: r2(faceArea),
        openingDeductionFt2: r2(openingDeduction),
      })
      roomWallSum += faceArea
      if (isExt) totalsByFace.externalInnerFaces += faceArea
      else       totalsByFace.partitionInnerFaces += faceArea
    }

    const ceilingFt2 = room.finishes?.ceilingPlaster ? state.getRoomArea(roomId) : 0
    bucket.internalWallsAreaFt2 += roomWallSum
    bucket.ceilingAreaFt2       += ceilingFt2
    totalsByFace.ceilingFaces   += ceilingFt2

    bucket.rooms.push({
      roomId, name: room.name, plasterSystemId: sysId,
      wallSumFt2:    r2(roomWallSum),
      ceilingFt2:    r2(ceilingFt2),
      isCeilingPlastered: !!room.finishes?.ceilingPlaster,
    })
    perRoomMeta.push({
      roomId, name: room.name, plasterSystemId: sysId,
      wallContributions,
      wallSumFt2:         r2(roomWallSum),
      ceilingFt2:         r2(ceilingFt2),
      isCeilingPlastered: !!room.finishes?.ceilingPlaster,
    })
  }

  // Columns — attributed to default-internal system.
  const columnSysId = internalSysFallback
  const columnBucket = ensureSystem(columnSysId)
  if (columnBucket) {
    const columnTypes = projectSettings?.columnTypes ?? []
    for (const col of Object.values(columns)) {
      const ct = columnTypes.find(t => t.id === col.columnTypeId)
      if (!ct) {
        warnings.push({ code: 'COLUMN_TYPE_MISSING', columnId: col.id })
        continue
      }
      const perimeterFt = getColumnPerimeterFt(ct)
      // Per-floor exposed height — NOT the structural multi-span height.
      // For multi-storey columns scope.js routes per-floor calls; this
      // function consumes only the columns visible on the current scope.
      const floorId = col.baseFloorId ?? scopedFloorId ?? null
      const exposedHFt = floorId ? getFloorHeightFtById(state, floorId) : DEFAULT_FLOOR_HEIGHT_FT
      if (!floorId) warnings.push({ code: 'COLUMN_FLOOR_HEIGHT_FALLBACK', columnId: col.id })
      const areaFt2 = perimeterFt * exposedHFt
      columnBucket.columnAreaFt2 += areaFt2
      totalsByFace.columnFaces   += areaFt2
      columnBucket.columns.push({
        columnId: col.id, columnTypeId: ct.id,
        perimeterFt: r2(perimeterFt), exposedHeightFt: r2(exposedHFt),
        areaFt2: r2(areaFt2),
      })
      perColumnMeta.push({
        columnId: col.id, columnTypeId: ct.id,
        perimeterFt: r2(perimeterFt), exposedHeightFt: r2(exposedHFt),
        floorId, areaFt2: r2(areaFt2),
        plasterSystemId: columnSysId,
      })
    }
  }

  // ── PASS 2 — Wall iteration over external walls (outer faces only) ─────
  const externalSysId = resolveExternalSystemId(projectSettings)
  const externalBucket = ensureSystem(externalSysId)
  if (externalBucket) {
    for (const w of Object.values(walls)) {
      if (w.isVirtual) continue
      if (w.isPlot)    continue
      if (!isExternalWall(state, w.id)) continue
      const grossOuterAreaFt2 = state.getWallArea(w.id)
      const openings = (w.openings ?? []).map(o => ({
        id:     o.id,
        type:   o.type,
        areaFt2: r2((o.width / 12) * (o.height / 12)),
      }))
      externalBucket.externalWallsAreaFt2 += grossOuterAreaFt2
      totalsByFace.externalOuterFaces     += grossOuterAreaFt2

      const a = state.nodes?.[w.n1], b = state.nodes?.[w.n2]
      const lengthFt = (a && b) ? r2(Math.hypot(b.x - a.x, b.y - a.y) / 12) : 0
      const heightFt = r2((w.height ?? 120) / 12)
      externalBucket.externalWalls.push({
        wallId: w.id, lengthFt, heightFt,
        netOuterAreaFt2: r2(grossOuterAreaFt2),
      })
      perExternalWallMeta.push({
        wallId: w.id, lengthFt, heightFt,
        grossOuterAreaFt2: r2(lengthFt * heightFt),
        openings,
        netOuterAreaFt2:   r2(grossOuterAreaFt2),
        plasterSystemId:   externalSysId,
      })
    }
  }

  // ── Roll-up per system + materials math ────────────────────────────────
  const bySystem = {}
  for (const [sysId, acc] of Object.entries(accBySystem)) {
    const sys = PLASTER_SYSTEMS[sysId]
    const totalFt2 = acc.internalWallsAreaFt2
                   + acc.columnAreaFt2
                   + acc.ceilingAreaFt2
                   + acc.externalWallsAreaFt2
    const totalM2  = totalFt2 * FT2_TO_M2
    const entry = {
      systemId:             sysId,
      label:                sys.label,
      kind:                 sys.kind,
      thicknessMm:          sys.thicknessMm,
      appliesContext:       sys.appliesContext,
      internalWallsAreaFt2: r2(acc.internalWallsAreaFt2),
      columnAreaFt2:        r2(acc.columnAreaFt2),
      ceilingAreaFt2:       r2(acc.ceilingAreaFt2),
      externalWallsAreaFt2: r2(acc.externalWallsAreaFt2),
      totalAreaFt2:         r2(totalFt2),
      totalAreaM2:          r2(totalM2),
      rooms:                acc.rooms,
      columns:              acc.columns,
      externalWalls:        acc.externalWalls,
    }
    if (sys.kind === PLASTER_KIND.CEMENT_SAND) {
      entry.cementBags = Math.ceil(totalM2 * sys.cementBagsPerM2)
      entry.sandM3     = r2(totalM2 * sys.sandM3PerM2)
    } else {
      const materialKg   = totalM2 * sys.materialKgPerM2
      entry.materialKg   = r2(materialKg)
      entry.materialBags = Math.ceil(materialKg / sys.materialBagKg)
    }
    bySystem[sysId] = entry
  }

  // Top-level totals consumed by boq/lines.js for the visible BOQ lines.
  const totals = {
    internalWallsAndColumnsFt2: r2(
      Object.values(bySystem).reduce((s, q) => s + q.internalWallsAreaFt2 + q.columnAreaFt2, 0)
    ),
    externalWallsFt2: r2(Object.values(bySystem).reduce((s, q) => s + q.externalWallsAreaFt2, 0)),
    ceilingFt2:       r2(Object.values(bySystem).reduce((s, q) => s + q.ceilingAreaFt2, 0)),
  }
  const totalAreaFt2 = r2(Object.values(bySystem).reduce((s, q) => s + q.totalAreaFt2, 0))

  return {
    bySystem,
    totalAreaFt2,
    totals,
    _meta: {
      algorithm:          'ROOM_FACE_ACCUMULATION_V2',
      calculationVersion: '2026-05-19-internal-external-split',
      floorId:            scopedFloorId,
      totalsByFace: {
        partitionInnerFaces: r2(totalsByFace.partitionInnerFaces),
        externalInnerFaces:  r2(totalsByFace.externalInnerFaces),
        externalOuterFaces:  r2(totalsByFace.externalOuterFaces),
        columnFaces:         r2(totalsByFace.columnFaces),
        ceilingFaces:        r2(totalsByFace.ceilingFaces),
      },
      perRoom:         perRoomMeta,
      perColumn:       perColumnMeta,
      perExternalWall: perExternalWallMeta,
      excluded,
      warnings,
    },
  }
}
