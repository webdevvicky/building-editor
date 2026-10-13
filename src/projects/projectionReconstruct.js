// projectionReconstruct.js — ERP projection → editor canvas state (pure).
//
// The ONE sanctioned reverse mapping, used only by the projection-mismatch
// guard's explicit "Load from ERP" action. It rebuilds from EXACTLY what
// GET /geometry/buildings/:id/state returns — the projection contract owned by the
// ERP's GeometryLiveService.getBuildingState (field names below are that
// contract; erp-saas `geometry-live.service.spec.ts` → "getBuildingState" pins the
// same shape). The canonical doc is then re-written through the normal
// accept-before-project pipeline like any other edit session.
//
// Fidelity contract (XR-01, XR-10):
//   • identity is PRESERVED: every rebuilt entity's id and ifcGlobalId is the ERP
//     row's sourceEditorId, so later live-sync ops resolve to UPDATE — never a
//     duplicate ADD that inflates the BOQ. References between entities (wall n1/n2,
//     room walls, slab rooms, a point's room/wall, a foundation's columns, a beam's
//     column) are the referenced row's editor id, as the projection gives them.
//   • floors: the editor floor list is rebuilt from the ERP floors (label, plinth and
//     underlay — editor-only — kept from the current settings by floor id); rooms,
//     walls, nodes and elements land on their own floor.
//   • every ELEMENT_REGISTRY kind is rebuilt through its registry `toEditorShape`
//     (typed columns + the descriptive `spec`), then completed by its entity schema
//     defaults — no kind is dropped.
//   • editor-only data the ERP never holds (project settings other than floors,
//     stamps, rates) is kept from the current canvas, never reset.
//   • seed-born rooms (no node graph) synthesize corners from the saved polygon
//     vertices or the rectangle, pairing the room's wall rows to edges in creation
//     order (N,S,E,W; the state endpoint returns walls createdAt-asc).

import { mmToIn } from './syncMappers.js'
import { ELEMENT_ENTRIES, entryForErpKind } from './elementRegistry.js'
import { SCHEMAS_BY_SLICE } from '../schema/entities/index.js'
import { normalizeEntity } from '../schema/normalize.js'
import { SCHEMA_VERSION } from '../operations/_schemaVersion.js'

const FT_TO_IN = 12
const DEFAULT_FLOOR_ID = 'F1'

let _seq = 0
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${(_seq++).toString(36)}`

/** ERP WallMaterial enum → editor materialKey (best-effort inverse of syncMappers.wallMaterial). */
function materialKeyFor(erpMaterial) {
  const m = String(erpMaterial ?? '').toUpperCase()
  if (m.startsWith('AAC_BLOCK')) return 'AAC_BLOCK'
  if (m === 'FLY_ASH_BRICK') return 'FLY_ASH_BRICK'
  if (m === 'HOLLOW_CONCRETE_BLOCK') return 'CONCRETE_BLOCK'
  if (m === 'RCC') return 'RCC'
  if (m === 'GLASS_PARTITION') return 'GLASS'
  if (m === 'GYPSUM_BOARD') return 'GYPSUM'
  if (m === 'STONE') return 'STONE'
  return 'IS_MODULAR_BRICK'
}

/** ERP OpeningType enum → editor opening base type (subtype re-derives on load). */
function openingTypeFor(erpType) {
  const t = String(erpType ?? '').toUpperCase()
  if (t === 'WINDOW' || t === 'VENTILATOR') return 'window'
  return 'door' // DOOR, SLIDING_DOOR, FRENCH_DOOR, ARCH
}

function mapOpenings(erpOpenings) {
  return (erpOpenings ?? []).map((o) => {
    const id = o.sourceEditorId ?? uid('op')
    return {
      id,
      ifcGlobalId: id,
      offset: mmToIn(o.offsetFromStartMm),
      width: mmToIn(o.widthMm),
      height: mmToIn(o.heightMm),
      type: openingTypeFor(o.openingType),
      orient: 0,
    }
  })
}

/**
 * Order a room's walls into a closed loop and return the node order.
 * Returns [] when the walls do not chain (loadProject tolerates it).
 */
function walkNodeOrder(wallIds, walls) {
  if (wallIds.length < 3) return []
  const remaining = new Set(wallIds)
  const first = walls[wallIds[0]]
  if (!first?.n1 || !first?.n2) return []
  const order = [first.n1]
  let cursor = first.n2
  remaining.delete(wallIds[0])
  while (remaining.size > 0) {
    let advanced = false
    for (const wid of remaining) {
      const w = walls[wid]
      if (!w?.n1 || !w?.n2) return []
      if (w.n1 === cursor || w.n2 === cursor) {
        order.push(cursor)
        cursor = w.n1 === cursor ? w.n2 : w.n1
        remaining.delete(wid)
        advanced = true
        break
      }
    }
    if (!advanced) return []
  }
  return cursor === order[0] ? order : []
}

/** The editor floor list from the ERP floors; editor-only floor fields kept from the current settings. */
function rebuildFloors(erpFloors, currentFloors, editorFloorIdOf) {
  if (!erpFloors.length) return currentFloors ?? null
  const currentById = new Map((currentFloors ?? []).map((f) => [f.id, f]))
  return [...erpFloors]
    .sort((a, b) => (a.floorNumber ?? 0) - (b.floorNumber ?? 0))
    .map((f, i) => {
      const id = editorFloorIdOf(f, i)
      const cur = currentById.get(id) ?? {}
      const floorNumber = f.floorNumber ?? i + 1
      return {
        plinthHeightFt: 1.5,
        meta: null,
        underlay: null,
        ...cur,
        id,
        label: cur.label ?? `Floor ${floorNumber}`,
        sequence: floorNumber - 1,
        floorHeightFt: f.floorHeight != null ? Number(f.floorHeight) : (cur.floorHeightFt ?? 10),
        ...(f.floorLength != null ? { floorLength: Number(f.floorLength) } : {}),
        ...(f.floorWidth != null ? { floorWidth: Number(f.floorWidth) } : {}),
      }
    })
}

/**
 * Rebuild the editor snapshot payload from GET /geometry/buildings/:id/state.
 *
 * `keep` is the current canvas's editor-only data the ERP never holds
 * (`projectSettings`, `stamps`, `ratesByKey`); it is carried over, never reset.
 *
 * @returns {{ payload: object, counts: object, skipped: { rooms: string[], elements: string[] },
 *             idMappings: Array<[string, string]> }} — payload is loadProject-compatible.
 */
export function reconstructFromProjection(state, keep = {}) {
  const floors = state?.floors ?? []
  const erpNodes = state?.nodes ?? []
  const erpWalls = state?.walls ?? []
  const erpRooms = state?.rooms ?? []
  const erpElements = state?.elements ?? []

  const editorFloorIdOf = (f, i) => f.sourceEditorId ?? (i === 0 ? DEFAULT_FLOOR_ID : `F${f.floorNumber ?? i + 1}`)
  const floorEditorId = new Map() // ERP floor id → editor floor id
  floors.forEach((f, i) => floorEditorId.set(f.id, editorFloorIdOf(f, i)))
  const floorFor = (erpFloorId) => (erpFloorId ? floorEditorId.get(erpFloorId) : undefined)

  const nodes = {}
  const walls = {}
  const rooms = {}
  // editor-id → ERP-row-id pairs for entities whose ERP rows lack a
  // sourceEditorId (seed-born geometry) — registered into the live-sync id-map
  // so UPDATE/DELETE of reconstructed entities resolves the real ERP row.
  const idMappings = []
  const skipped = { rooms: [], elements: [] }

  // Room → its floor, and room → its wall rows (every room a wall bounds, by editor id).
  const roomFloor = new Map()
  for (const r of erpRooms) if (r.sourceEditorId) roomFloor.set(r.sourceEditorId, floorFor(r.floorId) ?? DEFAULT_FLOOR_ID)
  const roomWallRows = new Map()
  for (const w of erpWalls) {
    for (const roomSid of w.roomSourceEditorIds ?? []) {
      if (!roomWallRows.has(roomSid)) roomWallRows.set(roomSid, [])
      roomWallRows.get(roomSid).push(w)
    }
  }
  const wallFloor = (w) => roomFloor.get((w.roomSourceEditorIds ?? [])[0]) ?? DEFAULT_FLOOR_ID

  // 1. Real node graph (editor-born buildings).
  for (const n of erpNodes) {
    const id = n.sourceEditorId ?? uid('nd')
    if (!n.sourceEditorId && n.id) idMappings.push([id, n.id])
    nodes[id] = {
      id,
      ifcGlobalId: id,
      x: mmToIn(n.xMm),
      y: mmToIn(n.yMm),
      floorIds: [],
      kind: n.kind ?? 'CORNER',
      onWallId: n.onWallSourceEditorId ?? null,
    }
  }

  // 2. Walls with a real node graph map directly.
  for (const w of erpWalls) {
    const n1 = w.n1NodeSourceEditorId
    const n2 = w.n2NodeSourceEditorId
    if (!n1 || !n2 || !nodes[n1] || !nodes[n2]) continue
    const id = w.sourceEditorId ?? uid('wl')
    if (!w.sourceEditorId && w.id) idMappings.push([id, w.id])
    walls[id] = {
      id,
      ifcGlobalId: id,
      n1,
      n2,
      height: mmToIn(w.heightMm),
      thickness: mmToIn(w.thicknessMm),
      materialKey: materialKeyFor(w.wallMaterial),
      isPlot: false,
      isVirtual: false,
      openings: mapOpenings(w.openings),
      floorId: wallFloor(w),
      classification: null,
      junctions: erpNodes.filter((n) => n.onWallSourceEditorId && n.onWallSourceEditorId === w.sourceEditorId)
        .map((n) => n.sourceEditorId),
    }
  }

  // 3. Rooms. Editor-born: reference graph walls. Seed-born: synthesize corners
  //    from polygon vertices or the rectangle (posXMm + length/width ft), then
  //    pair the room's wall rows to edges in creation order (N,S,E,W).
  for (const r of erpRooms) {
    const roomSid = r.sourceEditorId ?? uid('rm')
    if (!r.sourceEditorId && r.id) idMappings.push([roomSid, r.id])
    const floorEid = floorFor(r.floorId) ?? DEFAULT_FLOOR_ID
    const rows = roomWallRows.get(r.sourceEditorId) ?? []
    const graphRows = rows.filter((w) => walls[w.sourceEditorId])

    let wallIds
    if (graphRows.length >= 3) {
      wallIds = graphRows.map((w) => w.sourceEditorId)
    } else {
      // Synthesize corner nodes: saved polygon vertices win; else the rectangle.
      let cornersMm = (r.vertices ?? []).map((v) => [v.xMm, v.yMm])
      if (cornersMm.length < 3) {
        const x = r.posXMm ?? 0
        const y = r.posYMm ?? 0
        // length/width are Decimal FEET strings on the wire.
        const wMm = Math.round(Number(r.width ?? 0) * FT_TO_IN * 25.4)
        const lMm = Math.round(Number(r.length ?? 0) * FT_TO_IN * 25.4)
        if (!wMm || !lMm) { skipped.rooms.push(r.name ?? roomSid); continue }
        // N, S, E, W wall order ⇔ corners clockwise from top-left.
        cornersMm = [[x, y], [x + wMm, y], [x + wMm, y + lMm], [x, y + lMm]]
      }
      const cornerIds = cornersMm.map(([xMm, yMm], i) => {
        const id = `${roomSid}-n${i}`
        nodes[id] = {
          id, ifcGlobalId: id,
          x: mmToIn(xMm), y: mmToIn(yMm),
          floorIds: [floorEid], kind: 'CORNER', onWallId: null,
        }
        return id
      })
      wallIds = cornerIds.map((_, i) => {
        const row = rows[i] // creation-order pairing (N,S,E,W for rectangles)
        const id = row?.sourceEditorId ?? `${roomSid}-w${i}`
        if (row && !row.sourceEditorId && row.id) idMappings.push([id, row.id])
        walls[id] = {
          id,
          ifcGlobalId: id,
          n1: cornerIds[i],
          n2: cornerIds[(i + 1) % cornerIds.length],
          height: row ? mmToIn(row.heightMm) : 120,
          thickness: row ? mmToIn(row.thicknessMm) : 4.5,
          materialKey: materialKeyFor(row?.wallMaterial),
          isPlot: false,
          isVirtual: false,
          openings: mapOpenings(row?.openings),
          floorId: floorEid,
          classification: null,
          junctions: [],
        }
        return id
      })
    }

    const typeCode = r.roomType?.code ?? null
    rooms[roomSid] = {
      id: roomSid,
      ifcGlobalId: roomSid,
      name: r.name ?? 'Room',
      wallIds,
      nodeOrder: walkNodeOrder(wallIds, walls),
      type: typeCode ?? 'OTHER', // loadProject validates against ROOM_PRESETS
      roomTypeCode: typeCode,
      customType: null,
      floorId: floorEid,
    }
  }

  // A node sits on the floors of the walls that use it.
  for (const w of Object.values(walls)) {
    for (const nid of [w.n1, w.n2]) {
      const n = nodes[nid]
      if (n && !n.floorIds.includes(w.floorId)) n.floorIds.push(w.floorId)
    }
  }
  for (const n of Object.values(nodes)) if (n.floorIds.length === 0) n.floorIds.push(DEFAULT_FLOOR_ID)

  // 4. Every element kind, through its registry inverse + its entity schema defaults.
  const collections = Object.fromEntries(ELEMENT_ENTRIES.map((e) => [e.collection, {}]))
  for (const e of erpElements) {
    const entry = entryForErpKind(e.kind)
    if (!entry) { skipped.elements.push(e.kind); continue }
    const id = e.sourceEditorId ?? uid('el')
    if (!e.sourceEditorId && e.id) idMappings.push([id, e.id])
    const shape = Object.fromEntries(
      Object.entries(entry.toEditorShape(e, { floorFor })).filter(([, v]) => v !== undefined),
    )
    const { entity } = normalizeEntity({ ...shape, id, ifcGlobalId: id }, SCHEMAS_BY_SLICE[entry.collection])
    collections[entry.collection][id] = entity
  }

  const currentSettings = keep.projectSettings ?? undefined
  const rebuiltFloors = rebuildFloors(floors, currentSettings?.floors, editorFloorIdOf)
  const projectSettings = currentSettings
    ? { ...currentSettings, ...(rebuiltFloors ? { floors: rebuiltFloors } : {}) }
    : undefined

  const payload = {
    version: SCHEMA_VERSION,
    nodes,
    walls,
    rooms,
    stamps: keep.stamps ?? {},
    ...collections,
    ratesByKey: keep.ratesByKey ?? {},
    projectSettings,
  }

  const elementCount = Object.values(collections).reduce((n, c) => n + Object.keys(c).length, 0)
  return {
    payload,
    counts: { rooms: Object.keys(rooms).length, walls: Object.keys(walls).length, elements: elementCount },
    skipped,
    idMappings,
  }
}

/** Room/wall counts of a projection state — the banner's mismatch signal. */
export function projectionCounts(state) {
  return { rooms: (state?.rooms ?? []).length, walls: (state?.walls ?? []).length }
}
