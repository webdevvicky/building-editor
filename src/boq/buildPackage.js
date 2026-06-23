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
import { computeRebarGroups, ELEMENT_TYPE } from '../bbs/index.js'
import { getColumnHeightFt, getColumnAreaFt2 } from '../topology/columns.js'
import {
  resolveColumnTypeForColumn,
  resolveColumnReinforcementSpecForColumn,
  resolveBeamReinforcementSpec,
  resolveSlabReinforcementSpecForSlab,
} from '../specs/resolution.js'

const DEFAULT_FLOOR_ID = 'F1'

// schemaVersion history:
//   2 — structural elements (COLUMN/BEAM/SLAB) carry a typed `structural`
//       sub-object (section/height/length/concrete + steel) + a `bbs` sub-object
//       (per-element bar-bending rows from computeRebarGroups).
//   3 — each floor carries the authoritative WALL NODE GRAPH: `nodes[]`
//       ({ifcGlobalId,xMm,yMm,zMm,kind,onWallIfcId}) + `walls[]`
//       ({ifcGlobalId,n1IfcId,n2IfcId}); openings gain `positionMm`. Lets the
//       ERP store/render real wall geometry (no reconstruction). zMm is null
//       today (2-D) — future 3-D elevation needs no schema change.
// The editor is the single source of truth; the ERP stores these verbatim.
const PACKAGE_SCHEMA_VERSION = 3

// ── Unit conversion helpers ────────────────────────────────────────────────

/** Convert inches to integer millimetres (ERP coordinate boundary). */
function inToMm(inches) {
  return Math.round(inches * 25.4)
}

/** Convert inches to feet (ERP height/length boundary). */
function inToFt(inches) {
  return inches / 12
}

/** Convert feet to integer millimetres. */
function ftToMm(feet) {
  return Math.round(feet * 304.8)
}

/** Convert cubic feet to cubic metres (3 dp). */
function ft3ToM3(ft3) {
  return Math.round(ft3 * 0.0283168 * 1000) / 1000
}

/** Round kg to 2 dp for stable JSON output. */
function roundKg(kg) {
  return Math.round(kg * 100) / 100
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
      positionMm: inToMm(o.offset ?? 0),  // schemaVersion 3 — 2-D placement along the wall axis
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

/**
 * buildFloorGeometry(state, floorId) → { nodes, walls }   (schemaVersion 3)
 *
 * The authoritative WALL NODE GRAPH for a floor. Walls reference nodes by
 * ifcGlobalId (shared-node model — a corner/T-junction is one node referenced by
 * every incident wall). Only emits walls whose BOTH endpoints resolve to a node
 * with an ifcGlobalId (plot/virtual walls excluded). `zMm` is null (2-D); it
 * becomes a real value when the editor gains floor elevation — no schema change.
 * Pure; no Date.now()/Math.random().
 */
function buildFloorGeometry(state, floorId) {
  const walls = []
  const nodeIds = new Set()
  for (const wall of Object.values(state.walls ?? {})) {
    if ((wall.floorId ?? DEFAULT_FLOOR_ID) !== floorId) continue
    if (wall.isPlot || wall.isVirtual) continue
    const n1 = state.nodes?.[wall.n1]
    const n2 = state.nodes?.[wall.n2]
    if (!n1?.ifcGlobalId || !n2?.ifcGlobalId || !wall.ifcGlobalId) continue
    walls.push({
      ifcGlobalId: wall.ifcGlobalId,
      n1IfcId:     n1.ifcGlobalId,
      n2IfcId:     n2.ifcGlobalId,
    })
    nodeIds.add(wall.n1)
    nodeIds.add(wall.n2)
  }

  const nodes = []
  for (const nid of nodeIds) {
    const n = state.nodes?.[nid]
    if (!n?.ifcGlobalId) continue
    nodes.push({
      ifcGlobalId: n.ifcGlobalId,
      xMm:         inToMm(n.x ?? 0),
      yMm:         inToMm(n.y ?? 0),
      zMm:         null,                      // 2-D today; future 3-D elevation
      kind:        n.kind ?? 'CORNER',        // 'CORNER' | 'TJUNCTION'
      onWallIfcId: n.onWallId ? (state.walls?.[n.onWallId]?.ifcGlobalId ?? null) : null,
    })
  }

  return { nodes, walls }
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

// ── Unified element export (structural + MEP anchor) ───────────────────────

// Any 36-char UUID string is an INTERNAL editor id (rotates, useless to the
// ERP, and forbidden in the package by the C8 ID-exposure policy). The element
// spec is a JSONB blob of the entity's descriptive/dimensional fields ONLY —
// every internal id graph reference is stripped. Cross-element anchoring is
// expressed exclusively via resolved ifcGlobalIds (roomIfcId / wallIfcId).
const _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sanitizeSpec(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeSpec).filter(v => v !== undefined)
  }
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (k === 'id' || k === 'ifcGlobalId') continue
      const sv = sanitizeSpec(v)
      if (sv !== undefined) out[k] = sv
    }
    return out
  }
  if (typeof value === 'string' && _UUID_RE.test(value)) return undefined
  return value
}

/** Resolve an entity's room/wall references to ifcGlobalIds (never internal ids). */
function resolveElementAnchor(state, entity) {
  const anchor = {}
  const room = entity.roomId ? state.rooms?.[entity.roomId] : null
  if (room?.ifcGlobalId) anchor.roomIfcId = room.ifcGlobalId
  const wall = entity.wallId ? state.walls?.[entity.wallId] : null
  if (wall?.ifcGlobalId) anchor.wallIfcId = wall.ifcGlobalId
  return anchor
}

// Editor MEP state collection → BuildingElement kind.
const MEP_ELEMENT_COLLECTIONS = [
  ['plumbingFixtures', 'MEP_PLUMBING'],
  ['electricalPoints', 'MEP_ELECTRICAL'],
  ['hvacUnits',        'MEP_HVAC'],
  ['fireDevices',      'MEP_FIRE'],
  ['elvDevices',       'MEP_ELV'],
  ['solarEquipment',   'MEP_SOLAR'],
]

// ── Typed structural spec + per-element BBS (schemaVersion 2) ───────────────

/**
 * Compress a RebarGroup[] (from computeRebarGroups) into a compact, ERP-bound
 * per-element BBS snapshot. The editor's IS-2502/IS-456/IS-13920 engine is
 * authoritative; the ERP stores these rows verbatim and never recalculates.
 * Returns null when the element has no resolved rebar (keeps the package lean).
 */
function buildElementBbs(groups) {
  if (!groups || groups.length === 0) return null
  const byDiaKg = {}
  let totalWeightKg = 0
  const rows = groups.map(g => {
    totalWeightKg += g.totalWeightKg
    byDiaKg[g.diaMm] = roundKg((byDiaKg[g.diaMm] ?? 0) + g.totalWeightKg)
    return {
      markId:          g.markId,
      role:            g.role,
      diaMm:           g.diaMm,
      shapeCode:       g.shapeCode,
      cuttingLengthMm: Math.round(g.cuttingLengthMm),
      count:           g.count,
      totalLengthM:    Math.round(g.totalLengthM * 1000) / 1000,
      totalWeightKg:   roundKg(g.totalWeightKg),
      bbsCategory:     g.meta?.bbsCategory ?? null,
    }
  })
  return {
    rows,
    totalWeightKg: roundKg(totalWeightKg),
    byDiaKg,
    steelGrade:    groups[0]?.steelGrade ?? 'Fe500D',
  }
}

/** Typed structural fields for a COLUMN (position, section, height, concrete, steel). */
function buildColumnStructural(state, col) {
  try {
    const columnTypes = state.projectSettings?.columnTypes ?? []
    const ct = resolveColumnTypeForColumn(state, col, columnTypes)
    const heightFt = getColumnHeightFt(state, col)
    const areaFt2 = ct ? getColumnAreaFt2(ct) : 0
    const resolved = resolveColumnReinforcementSpecForColumn(state, col, ct)
    // World position in mm (prefer attached node — mirrors buildColumns()).
    let xMm = null, yMm = null
    if (col.attachedNodeId) {
      const node = state.nodes?.[col.attachedNodeId]
      if (node) { xMm = inToMm(node.x); yMm = inToMm(node.y) }
    }
    if (xMm === null) { xMm = inToMm(col.x ?? 0); yMm = inToMm(col.y ?? 0) }
    return {
      xMm,
      yMm,
      sectionShape:   ct?.shape ?? 'rect',
      sectionWidthMm: ct?.widthIn != null ? inToMm(ct.widthIn) : null,
      sectionDepthMm: ct?.depthIn != null ? inToMm(ct.depthIn) : null,
      diamMm:         ct?.diamIn  != null ? inToMm(ct.diamIn)  : null,
      heightMm:       Number.isFinite(heightFt) ? ftToMm(heightFt) : null,
      concreteM3:     ft3ToM3(areaFt2 * (heightFt || 0)),
      steelGrade:     resolved.spec?.steelGrade ?? 'Fe500D',
      reinforcementSpecLabel: resolved.specLabel,
    }
  } catch {
    return null
  }
}

/** Typed structural fields for a BEAM (section, span, concrete, steel). */
function buildBeamStructural(state, beam) {
  try {
    const dims = state.projectSettings?.beamDimensions?.[beam.level] ?? null
    const fromPos = resolveBeamEndpoint(state, beam.endpoints?.from)
    const toPos   = resolveBeamEndpoint(state, beam.endpoints?.to)
    const lengthFt = (fromPos && toPos)
      ? inToFt(Math.hypot(toPos.x - fromPos.x, toPos.y - fromPos.y))
      : 0
    const sectionFt2 = dims ? (dims.widthIn * dims.depthIn) / 144 : 0
    const resolved = resolveBeamReinforcementSpec(state, beam)
    return {
      level:          beam.level ?? null,
      sectionWidthMm: dims?.widthIn != null ? inToMm(dims.widthIn) : null,
      sectionDepthMm: dims?.depthIn != null ? inToMm(dims.depthIn) : null,
      lengthMm:       ftToMm(lengthFt),
      // Resolved endpoint world coords (mm) so the viewer can draw the beam line.
      fromPointMm:    fromPos ? { xMm: inToMm(fromPos.x), yMm: inToMm(fromPos.y) } : null,
      toPointMm:      toPos   ? { xMm: inToMm(toPos.x),   yMm: inToMm(toPos.y)   } : null,
      concreteM3:     ft3ToM3(sectionFt2 * lengthFt),
      steelGrade:     resolved.spec?.steelGrade ?? 'Fe500D',
      reinforcementSpecLabel: resolved.specLabel,
    }
  } catch {
    return null
  }
}

/** Typed structural fields for a SLAB (thickness, area, role, concrete, steel). */
function buildSlabStructural(state, slab) {
  try {
    let areaFt2 = 0
    const roomIfcIds = []
    for (const rid of (slab.roomIds ?? [])) {
      areaFt2 += getRoomArea(state, rid)
      const ifc = state.rooms?.[rid]?.ifcGlobalId
      if (ifc) roomIfcIds.push(ifc)
    }
    const thicknessIn = slab.thicknessIn ?? 5
    const resolved = resolveSlabReinforcementSpecForSlab(state, slab)
    return {
      type:         slab.type ?? null,
      role:         slab.role ?? null,
      thicknessMm:  inToMm(thicknessIn),
      sinkDepthMm:  slab.sinkDepthIn != null ? inToMm(slab.sinkDepthIn) : null,
      grade:        slab.grade ?? null,
      areaSqft:     Math.round(areaFt2 * 100) / 100,
      // ifcGlobalIds of the rooms this slab covers — the viewer shades their polygons.
      roomIfcIds,
      concreteM3:   ft3ToM3(areaFt2 * (thicknessIn / 12)),
      steelGrade:   resolved.spec?.steelGrade ?? 'Fe500D',
      reinforcementSpecLabel: resolved.specLabel,
    }
  } catch {
    return null
  }
}

/**
 * buildElements(state, floorId, elementLabels, rebarByElement) → ImportElement[]
 *
 * Emits every floor-scoped structural + MEP entity (and risers anchored to
 * their from-floor) as a kind-discriminated element carrying its ifcGlobalId,
 * label, optional room/wall anchor, and a UUID-stripped JSONB spec. The ERP
 * imports these into ONE generic BuildingElement table (kind + spec), never
 * 16 typed tables. Wall-derived beams are skipped (computed overlay, not
 * persisted). Pure; no Date.now()/Math.random().
 *
 * schemaVersion 2: COLUMN/BEAM/SLAB elements additionally carry `structural`
 * (typed geometry + concrete + steel) and `bbs` (per-element bar schedule).
 * `rebarByElement` is the `byElement` map from computeRebarGroups(state).
 */
function buildElements(state, floorId, elementLabels, rebarByElement) {
  const out = []
  const bbsFor = (elementType, entityId) =>
    buildElementBbs(rebarByElement?.[elementType]?.[entityId])
  const push = (kind, entity, labelMap) => {
    if (!entity?.ifcGlobalId) return
    const label = labelMap?.[entity.id]
    const el = {
      ifcGlobalId: entity.ifcGlobalId,
      labelNo:     label?.labelNo ?? entity.labelNo ?? null,
      kind,
      name:        entity.name ?? null,
      ...resolveElementAnchor(state, entity),
      spec:        sanitizeSpec(entity),
    }
    if (kind === 'COLUMN') {
      el.structural = buildColumnStructural(state, entity)
      el.bbs = bbsFor(ELEMENT_TYPE.COLUMN, entity.id)
    } else if (kind === 'BEAM') {
      el.structural = buildBeamStructural(state, entity)
      el.bbs = bbsFor(ELEMENT_TYPE.BEAM, entity.id)
    } else if (kind === 'SLAB') {
      el.structural = buildSlabStructural(state, entity)
      el.bbs = bbsFor(ELEMENT_TYPE.SLAB, entity.id)
    }
    out.push(el)
  }

  for (const col of Object.values(state.columns ?? {})) {
    if ((col.baseFloorId ?? col.floorId ?? DEFAULT_FLOOR_ID) !== floorId) continue
    push('COLUMN', col, elementLabels?.columns)
  }
  for (const beam of Object.values(state.beams ?? {})) {
    if ((beam.floorId ?? DEFAULT_FLOOR_ID) !== floorId) continue
    if (beam.source === 'WALL_DERIVED') continue // computed overlay, not persisted
    push('BEAM', beam, elementLabels?.beams)
  }
  for (const slab of Object.values(state.slabs ?? {})) {
    if ((slab.floorId ?? DEFAULT_FLOOR_ID) !== floorId) continue
    push('SLAB', slab, elementLabels?.slabs)
  }
  for (const f of Object.values(state.foundations ?? {})) {
    if ((f.floorId ?? DEFAULT_FLOOR_ID) !== floorId) continue
    push('FOUNDATION', f, elementLabels?.foundations)
  }
  for (const sc of Object.values(state.staircases ?? {})) {
    if ((sc.floorId ?? sc.fromFloorId ?? DEFAULT_FLOOR_ID) !== floorId) continue
    push('STAIRCASE', sc, elementLabels?.staircases)
  }
  for (const [collectionKey, kind] of MEP_ELEMENT_COLLECTIONS) {
    for (const e of Object.values(state[collectionKey] ?? {})) {
      if ((e.floorId ?? DEFAULT_FLOOR_ID) !== floorId) continue
      push(kind, e)
    }
  }
  // Risers span floors; emit once, anchored to their from-floor.
  for (const r of Object.values(state.risers ?? {})) {
    if ((r.fromFloorId ?? r.floorId ?? DEFAULT_FLOOR_ID) !== floorId) continue
    push('RISER', r)
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

  // ── Bar-bending schedule (computed once; sliced per element below) ──────
  // The editor's IS-2502 engine is the single source of truth. Computed once
  // for the whole project and indexed by elementId so each element carries its
  // own authoritative BBS snapshot. Wrapped — verify fixtures may lack the full
  // projectSettings BBS needs; a null map degrades to "no bbs" gracefully.
  let rebarByElement = null
  try {
    rebarByElement = computeRebarGroups(state).byElement
  } catch {
    rebarByElement = null
  }

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

    const geometry = buildFloorGeometry(state, floorId)

    return {
      ifcGlobalId:    floor.ifcGlobalId ?? null,   // floors may not have an ifcGlobalId — null if absent
      labelNo:        floor.labelNo     ?? null,
      name:           floor.label       ?? floorId,
      sequence:       floor.sequence    ?? 0,
      heightFt:       floor.floorHeightFt   ?? 10,
      plinthHeightFt: floor.plinthHeightFt  ?? 1.5,
      rooms:    buildRooms(state, floorRooms, adjCount, elementLabels),
      // schemaVersion 3 — the authoritative wall node graph for this floor.
      nodes:    geometry.nodes,
      walls:    geometry.walls,
      columns:  buildColumns(state, floorId, elementLabels),
      beams:    buildBeams(state, floorId, elementLabels),
      slabs:    buildSlabs(state, floorId, elementLabels),
      elements: buildElements(state, floorId, elementLabels, rebarByElement),
    }
  })

  // ── BOQ summary ──────────────────────────────────────────────────────────
  // computeBoqPresentationModel requires BOQ lines as first arg.
  // We call getBoqLines with the full-project state and pass through.
  const rates = state.ratesByKey ?? {}
  let boqSummary
  try {
    const lines = getBoqLines(state, rates, {})
    boqSummary = computeBoqPresentationModel(lines, rates, state)
  } catch {
    // BOQ computation may fail if topology helpers missing (e.g. in verify fixtures).
    // Return null so the package is still valid — ERP treats null as "not yet computed".
    boqSummary = null
  }

  // ── Reconciliation provenance ────────────────────────────────────────────
  // Walls minted by splitWall/joinWalls carry the ifcGlobalId(s) of the wall(s)
  // they replace. Surfacing this lets the ERP import REMAP execution rows
  // (snags, progress, photos, finishes) from the disappearing parent onto the
  // successor instead of orphaning them. ifcGlobalIds only (C8).
  const provenance = buildProvenance(state)

  // ── Return package ───────────────────────────────────────────────────────
  return {
    schemaVersion:    PACKAGE_SCHEMA_VERSION,
    exportedAt:       null,          // caller stamps before upload
    editorProjectId:  state.projectSettings?.editorProjectId ?? null,
    floors,
    provenance,
    boqSummary,
    elementLabels,
  }
}

/**
 * Collect wall lineage into the package-level provenance array.
 * One entry per wall that was split/join-derived:
 *   { newId: <ifcGlobalId>, op: 'SPLIT' | 'JOIN', parentIds: [<ifcGlobalId>...] }
 * Walls with no provenance (originals / baselined) are omitted.
 */
function buildProvenance(state) {
  const out = []
  for (const wall of Object.values(state.walls ?? {})) {
    const prov = wall.provenance
    if (!prov || !prov.op) continue
    const newId = wall.ifcGlobalId
    const parentIds = Array.isArray(prov.parentIds)
      ? prov.parentIds.filter(Boolean)
      : []
    if (!newId || parentIds.length === 0) continue
    out.push({ newId, op: prov.op, parentIds })
  }
  return out
}

export default buildPackage
