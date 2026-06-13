// buildPackage(state) — pure function, no UI imports.
//
// Produces a BuildingModelPackage v1 object for ERP consumption.
//
// Unit boundary (INCH-native editor → ERP):
//   coordinates : mm = Math.round(inches * 25.4)
//   heights/lengths: ft = inches / 12
//   thicknesses : thicknessIn — left in inches as-specified
//
// ID exposure policy (C8): all element IDs in the package are ifcGlobalId
// (stable, 22-char IFC base64). Internal UUIDs never appear in the output.
//
// faceType derivation:
//   wall adjacency count (number of rooms referencing the wall) determines type.
//   count === 1 → EXTERNAL, count >= 2 → PARTITION.
//   walls not referenced by any room are excluded from the rooms[] output
//   (they carry no context anyway).
//
// Shared-wall emission:
//   The ERP expects each wall emitted under EVERY room whose wallIds includes it.
//   The ERP is responsible for deduplication by ifcGlobalId. faceType is stable
//   (derived from the global adjacency map), so identical walls under two rooms
//   carry the same faceType, which is correct (PARTITION).
//
// Beam endpoint resolution:
//   COLUMN endpoint → fromIfcGuid = column.ifcGlobalId (never internal id).
//   WALL endpoint   → fromIfcGuid = wall.ifcGlobalId.
//   BEAM endpoint   → fromIfcGuid = null (the referenced beam's ifcGlobalId).
//   POINT endpoint  → fromIfcGuid = null + raw {xMm, yMm} coordinate.
//
// Does NOT call Date.now() or Math.random() — caller stamps exportedAt.
//
// Importable by Node verify scripts (no 'import.meta.env', no React/DOM).

import { getElementLabels } from './elementLabels.js'
import { computeBoqPresentationModel } from './presentationModel.js'
import { getBoqLines } from './lines.js'
import { getRoomArea, getRoomGeometry } from '../topology/rooms.js'
import { getWallAdjacencyCount } from '../topology/walls.js'
import { resolveBeamEndpoint } from '../topology/beams.js'

const DEFAULT_FLOOR_ID = 'F1'

// ── Unit conversion helpers ────────────────────────────────────────────────

/** Convert inches to integer millimetres (ERP coordinate boundary). */
function inToMm(inches) {
  return Math.round(inches * 25.4)
}

/** Convert inches to feet (ERP height/length boundary). */
function inToFt(inches) {
  return inches / 12
}

// ── Wall adjacency map ─────────────────────────────────────────────────────

/**
 * Build a wall → room-count map for faceType derivation.
 * Delegates to the topology helper (memoized, correct for both live store and
 * plain state-shaped objects). The topology helper is pure and has no UI deps,
 * so it is safe to call from verify scripts.
 */
function buildWallAdjacency(state) {
  return getWallAdjacencyCount(state)
}

// ── Room bounding-box origin (posXMm / posYMm) ────────────────────────────

/**
 * Derives the room's reference position as the min-X, min-Y corner of its
 * bounding box (in mm). This is a stable, unambiguous reference point for
 * the ERP to anchor room labels and locate rooms on imported floor plans.
 * Polygon centroid would also work but introduces floating-point
 * ambiguity — min corner is simpler and deterministic.
 */
function roomOriginMm(state, room) {
  const nodeOrder = (Array.isArray(room.nodeOrder) && room.nodeOrder.length >= 3)
    ? room.nodeOrder
    : null
  if (!nodeOrder) return { posXMm: null, posYMm: null }

  let minX = Infinity, minY = Infinity
  for (const nid of nodeOrder) {
    const n = state.nodes?.[nid]
    if (!n) continue
    if (n.x < minX) minX = n.x
    if (n.y < minY) minY = n.y
  }
  if (!Number.isFinite(minX)) return { posXMm: null, posYMm: null }
  return { posXMm: inToMm(minX), posYMm: inToMm(minY) }
}

// ── Beam endpoint → { ifcGuid, point } ───────────────────────────────────

/**
 * Resolve a beam endpoint reference to the package-format fields:
 *   ifcGuid  — ifcGlobalId of the referenced COLUMN or WALL entity, or null
 *   pointMm  — { xMm, yMm } for POINT endpoints (or WALL/BEAM/COLUMN when
 *               the referenced entity has no ifcGlobalId), or null
 */
function resolveEndpointForPackage(state, endpointRef) {
  if (!endpointRef) return { ifcGuid: null, pointMm: null }

  if (endpointRef.type === 'COLUMN') {
    const col = state.columns?.[endpointRef.columnId]
    const ifcGuid = col?.ifcGlobalId ?? null
    return { ifcGuid, pointMm: null }
  }

  if (endpointRef.type === 'WALL') {
    const wall = state.walls?.[endpointRef.wallId]
    const ifcGuid = wall?.ifcGlobalId ?? null
    return { ifcGuid, pointMm: null }
  }

  if (endpointRef.type === 'BEAM') {
    const beam = state.beams?.[endpointRef.beamId]
    const ifcGuid = beam?.ifcGlobalId ?? null
    if (ifcGuid) return { ifcGuid, pointMm: null }
    // Dangling beam ref — fall through to resolved world coords below.
  }

  // POINT endpoint (or unresolvable BEAM ref): emit raw world coords.
  const pos = resolveBeamEndpoint(state, endpointRef)
  if (pos) {
    return { ifcGuid: null, pointMm: { xMm: inToMm(pos.x), yMm: inToMm(pos.y) } }
  }

  return { ifcGuid: null, pointMm: null }
}

// ── Floor-level builders ──────────────────────────────────────────────────

function buildRoomWalls(state, room, adjCount, elementLabels) {
  const out = []
  for (const wid of (room.wallIds ?? [])) {
    const wall = state.walls?.[wid]
    if (!wall) continue
    if (wall.isPlot || wall.isVirtual) continue

    const count = adjCount[wid] ?? 0
    const faceType = count >= 2 ? 'PARTITION' : 'EXTERNAL'

    // Wall geometry
    const n1 = state.nodes?.[wall.n1]
    const n2 = state.nodes?.[wall.n2]
    const lengthIn = (n1 && n2)
      ? Math.hypot(n2.x - n1.x, n2.y - n1.y)
      : 0

    const openings = (wall.openings ?? []).map(o => ({
      type:       o.type,      // 'door' | 'window'
      widthFt:    inToFt(o.width  ?? 0),
      heightFt:   inToFt(o.height ?? 0),
      positionFt: inToFt(o.offset ?? 0),  // offset from wall n1 along wall
    }))

    const wallLabel = elementLabels?.walls?.[wid]

    out.push({
      ifcGlobalId:  wall.ifcGlobalId ?? null,
      labelNo:      wallLabel?.labelNo ?? wall.labelNo ?? null,
      thicknessIn:  wall.thickness ?? 9,
      heightFt:     inToFt(wall.height ?? 120),
      lengthFt:     inToFt(lengthIn),
      materialKey:  wall.materialKey ?? null,
      faceType,
      openings,
    })
  }
  return out
}

function buildRooms(state, floorRooms, adjCount, elementLabels) {
  const out = []
  for (const room of floorRooms) {
    const roomLabel = elementLabels?.rooms?.[room.id]

    // Area — use the topology helper directly so this stays pure / Node-safe
    const areaSqft = getRoomArea(state, room.id)

    // Carpet area — clear_internal geometry; fallback to centrelinearea
    let carpetAreaSqft = areaSqft
    try {
      const geom = getRoomGeometry(state, room.id, 'clear_internal')
      if (geom && !geom.collapsed && geom.area > 0) {
        carpetAreaSqft = geom.area
      }
    } catch {
      // fall back to centrelinearea
    }

    // Position (min bounding-box corner)
    const { posXMm, posYMm } = roomOriginMm(state, room)

    // Polygon vertices in node order → mm
    const nodeOrder = (Array.isArray(room.nodeOrder) && room.nodeOrder.length >= 3)
      ? room.nodeOrder
      : null
    const vertices = nodeOrder
      ? nodeOrder
          .map(nid => {
            const n = state.nodes?.[nid]
            return n ? { xMm: inToMm(n.x), yMm: inToMm(n.y) } : null
          })
          .filter(Boolean)
      : []

    const walls = buildRoomWalls(state, room, adjCount, elementLabels)

    out.push({
      ifcGlobalId:     room.ifcGlobalId ?? null,
      labelNo:         roomLabel?.labelNo ?? room.labelNo ?? null,
      name:            room.name ?? '',
      type:            room.type ?? 'OTHER',
      areaSqft,
      carpetAreaSqft,
      posXMm,
      posYMm,
      vertices,
      walls,
    })
  }
  return out
}

function buildColumns(state, floorId, elementLabels) {
  const out = []
  for (const col of Object.values(state.columns ?? {})) {
    // Column belongs on a floor if floorId falls within its baseFloorId→topFloorId span.
    // For simplicity we include a column if baseFloorId matches the floor.
    // This matches how elementLabels.js labels columns (baseFloorId anchors the label).
    const colBaseFloor = col.baseFloorId ?? col.floorId ?? DEFAULT_FLOOR_ID
    if (colBaseFloor !== floorId) continue

    const colLabel = elementLabels?.columns?.[col.id]

    // World position in mm (prefer attachedNode for accuracy)
    let xMm = null, yMm = null
    if (col.attachedNodeId) {
      const node = state.nodes?.[col.attachedNodeId]
      if (node) { xMm = inToMm(node.x); yMm = inToMm(node.y) }
    }
    if (xMm === null) {
      xMm = inToMm(col.x ?? 0)
      yMm = inToMm(col.y ?? 0)
    }

    out.push({
      ifcGlobalId:  col.ifcGlobalId ?? null,
      labelNo:      colLabel?.labelNo ?? col.labelNo ?? null,
      xMm,
      yMm,
      columnTypeId: col.columnTypeId ?? null,
      baseFloor:    col.baseFloorId  ?? col.floorId ?? DEFAULT_FLOOR_ID,
      topFloor:     col.topFloorId   ?? col.floorId ?? DEFAULT_FLOOR_ID,
    })
  }
  return out
}

function buildBeams(state, floorId, elementLabels) {
  const out = []
  for (const beam of Object.values(state.beams ?? {})) {
    if ((beam.floorId ?? DEFAULT_FLOOR_ID) !== floorId) continue
    // Only EXPLICIT beams (WALL_DERIVED beams live in the computed overlay;
    // they are not persisted in state.beams)
    if (beam.source === 'WALL_DERIVED') continue

    const beamLabel = elementLabels?.beams?.[beam.id]

    // Compute length from resolved endpoints
    const fromPos = resolveBeamEndpoint(state, beam.endpoints?.from)
    const toPos   = resolveBeamEndpoint(state, beam.endpoints?.to)
    const lengthFt = (fromPos && toPos)
      ? inToFt(Math.hypot(toPos.x - fromPos.x, toPos.y - fromPos.y))
      : 0

    const fromEp = resolveEndpointForPackage(state, beam.endpoints?.from)
    const toEp   = resolveEndpointForPackage(state, beam.endpoints?.to)

    out.push({
      ifcGlobalId:  beam.ifcGlobalId ?? null,
      labelNo:      beamLabel?.labelNo ?? beam.labelNo ?? null,
      level:        beam.level ?? null,   // 'plinth' | 'lintel' | 'roof'
      fromIfcGuid:  fromEp.ifcGuid,
      fromPointMm:  fromEp.pointMm,
      toIfcGuid:    toEp.ifcGuid,
      toPointMm:    toEp.pointMm,
      lengthFt,
    })
  }
  return out
}

function buildSlabs(state, floorId, elementLabels) {
  const out = []
  for (const slab of Object.values(state.slabs ?? {})) {
    if ((slab.floorId ?? DEFAULT_FLOOR_ID) !== floorId) continue

    const slabLabel = elementLabels?.slabs?.[slab.id]

    // Area = sum of valid rooms referenced by this slab
    let areaFt2 = 0
    for (const rid of (slab.roomIds ?? [])) {
      areaFt2 += getRoomArea(state, rid)
    }

    out.push({
      ifcGlobalId:  slab.ifcGlobalId ?? null,
      labelNo:      slabLabel?.labelNo ?? slab.labelNo ?? null,
      areaFt2,
      thicknessIn:  slab.thicknessIn ?? 5,
    })
  }
  return out
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * buildPackage(state) → BuildingModelPackage v1
 *
 * Pure function. No mutations, no Date.now(), no Math.random().
 * Safe for Node verify scripts and browser export paths alike.
 *
 * @param {object} state — Zustand state snapshot (or any state-shaped object)
 * @returns {BuildingModelPackage}
 */
export function buildPackage(state) {
  if (!state) throw new TypeError('buildPackage: state is required')

  // ── Element labels (W-001, R-001, etc.) ─────────────────────────────────
  const elementLabels = getElementLabels(state)

  // ── Wall adjacency map (used for faceType on all floors in one pass) ────
  const adjCount = buildWallAdjacency(state)

  // ── Floor list ──────────────────────────────────────────────────────────
  const floorDefs = (state.projectSettings?.floors ?? [])
    .slice()
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))

  // Ensure there is at least one synthetic floor entry (single-floor projects
  // may only use the DEFAULT_FLOOR_ID constant without a floors[] entry).
  const effectiveFloors = floorDefs.length > 0
    ? floorDefs
    : [{ id: DEFAULT_FLOOR_ID, label: 'Floor 1', sequence: 0, plinthHeightFt: 1.5, floorHeightFt: 10 }]

  // ── Group rooms by floor ─────────────────────────────────────────────────
  const roomsByFloor = {}
  for (const room of Object.values(state.rooms ?? {})) {
    const fid = room.floorId ?? DEFAULT_FLOOR_ID
    if (!roomsByFloor[fid]) roomsByFloor[fid] = []
    roomsByFloor[fid].push(room)
  }

  // ── Build floors array ───────────────────────────────────────────────────
  const floors = effectiveFloors.map(floor => {
    const floorId = floor.id
    // Element labels don't track floors themselves (floors use their own id/label).
    // Rooms, walls, columns, beams, slabs carry labelNos — floors do not.

    const floorRooms = (roomsByFloor[floorId] ?? [])
      .slice()
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))

    return {
      ifcGlobalId:    floor.ifcGlobalId ?? null,   // floors may not have an ifcGlobalId — null if absent
      labelNo:        floor.labelNo     ?? null,
      name:           floor.label       ?? floorId,
      sequence:       floor.sequence    ?? 0,
      heightFt:       floor.floorHeightFt   ?? 10,
      plinthHeightFt: floor.plinthHeightFt  ?? 1.5,
      rooms:    buildRooms(state, floorRooms, adjCount, elementLabels),
      columns:  buildColumns(state, floorId, elementLabels),
      beams:    buildBeams(state, floorId, elementLabels),
      slabs:    buildSlabs(state, floorId, elementLabels),
    }
  })

  // ── BOQ summary ──────────────────────────────────────────────────────────
  // computeBoqPresentationModel requires BOQ lines as first arg.
  // We call getBoqLines with the full-project state and pass through.
  const rates = state.ratesByKey ?? {}
  let boqSummary = null
  try {
    const lines = getBoqLines(state, rates, {})
    boqSummary = computeBoqPresentationModel(lines, rates, state)
  } catch {
    // BOQ computation may fail if topology helpers missing (e.g. in verify fixtures).
    // Return null so the package is still valid — ERP treats null as "not yet computed".
    boqSummary = null
  }

  // ── Return package ───────────────────────────────────────────────────────
  return {
    schemaVersion:    1,
    exportedAt:       null,          // caller stamps before upload
    editorProjectId:  state.projectSettings?.editorProjectId ?? null,
    floors,
    boqSummary,
    elementLabels,
  }
}

export default buildPackage
