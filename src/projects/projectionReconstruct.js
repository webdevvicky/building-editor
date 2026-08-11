// projectionReconstruct.js — ERP projection → editor canvas state (pure).
//
// The ONE sanctioned reverse mapping, used only by the projection-mismatch
// guard's explicit "Load from ERP" action. The canonical Building Document
// remains editor-authored: this module only rebuilds a canvas STATE; the
// canonical doc is then re-written through the normal accept-before-project
// pipeline (buildSnapshot → checksum → upload) like any other edit session.
//
// Fidelity contract (v1):
//   • nodes / walls / openings / rooms — full reconstruction. Editor-born
//     buildings use the real node graph (walls carry n1/n2 sourceEditorIds);
//     seed-born rooms (no node graph) synthesize a rectangle from
//     posXMm/length/width or the saved polygon vertices, pairing the room's
//     existing wall rows to edges in creation order (N,S,E,W — the ERP's
//     auto-wall order; the state endpoint returns walls createdAt-asc).
//   • identity is PRESERVED: every reconstructed entity's ifcGlobalId is the
//     ERP row's sourceEditorId, so subsequent live-sync ops resolve to UPDATE,
//     never duplicate.
//   • structural + MEP elements are NOT reconstructed — the projection does
//     not carry their full editor fidelity (sections, routing, BBS). They
//     remain ERP-side; the banner discloses this.

import { mmToIn } from './syncMappers.js'

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
  return (erpOpenings ?? []).map((o) => ({
    id: o.sourceEditorId ?? uid('op'),
    ifcGlobalId: o.sourceEditorId ?? uid('op'),
    offset: mmToIn(o.offsetFromStartMm),
    width: mmToIn(o.widthMm),
    height: mmToIn(o.heightMm),
    type: openingTypeFor(o.openingType),
    orient: 0,
  }))
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

/**
 * Rebuild the editor snapshot payload from GET /geometry/buildings/:id/state.
 * Returns { payload, counts, skipped } — payload is loadProject-compatible.
 */
export function reconstructFromProjection(state) {
  const floors = state?.floors ?? []
  const erpNodes = state?.nodes ?? []
  const erpWalls = state?.walls ?? []
  const erpRooms = state?.rooms ?? []

  const floorEditorId = new Map() // ERP floor id → editor floor id
  floors.forEach((f, i) => {
    floorEditorId.set(f.id, f.sourceEditorId ?? (i === 0 ? DEFAULT_FLOOR_ID : `F${f.floorNumber ?? i + 1}`))
  })
  const floorIdFor = (erpFloorId) => floorEditorId.get(erpFloorId) ?? DEFAULT_FLOOR_ID

  const nodes = {}
  const walls = {}
  const rooms = {}

  // 1. Real node graph (editor-born buildings).
  for (const n of erpNodes) {
    const id = n.sourceEditorId ?? uid('nd')
    nodes[id] = {
      id,
      ifcGlobalId: id,
      x: mmToIn(n.xMm),
      y: mmToIn(n.yMm),
      floorIds: [DEFAULT_FLOOR_ID],
      kind: n.kind ?? 'CORNER',
      onWallId: null,
    }
  }

  // Room → its wall rows (via wall surfaces), preserving the endpoint's createdAt order.
  const roomWallRows = new Map()
  for (const w of erpWalls) {
    for (const s of w.wallSurfaces ?? []) {
      const roomSid = s.room?.sourceEditorId
      if (!roomSid) continue
      if (!roomWallRows.has(roomSid)) roomWallRows.set(roomSid, [])
      roomWallRows.get(roomSid).push(w)
    }
  }

  // 2. Walls with a real node graph map directly.
  const graphWallIds = new Set()
  for (const w of erpWalls) {
    const n1 = w.n1?.sourceEditorId
    const n2 = w.n2?.sourceEditorId
    if (!n1 || !n2 || !nodes[n1] || !nodes[n2]) continue
    const id = w.sourceEditorId ?? uid('wl')
    graphWallIds.add(w.sourceEditorId ?? id)
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
      floorId: DEFAULT_FLOOR_ID,
      classification: 'internal',
    }
  }

  const skipped = { rooms: [], elements: true }

  // 3. Rooms. Editor-born: reference graph walls. Seed-born: synthesize corners
  //    from polygon vertices or the rectangle (posXMm + length/width ft), then
  //    pair the room's wall rows to edges in creation order (N,S,E,W).
  for (const r of erpRooms) {
    const roomSid = r.sourceEditorId ?? uid('rm')
    const rows = roomWallRows.get(r.sourceEditorId) ?? []
    const graphRows = rows.filter((w) => w.n1?.sourceEditorId && w.n2?.sourceEditorId)

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
      const floorEid = floorIdFor(r.floorId)
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
          classification: 'internal',
        }
        return id
      })
    }

    rooms[roomSid] = {
      id: roomSid,
      ifcGlobalId: roomSid,
      name: r.name ?? 'Room',
      wallIds,
      nodeOrder: walkNodeOrder(wallIds, walls),
      type: r.roomType?.code ?? 'OTHER', // loadProject validates against ROOM_PRESETS
      customType: null,
    }
  }

  const payload = {
    version: 7,
    nodes,
    walls,
    rooms,
    stamps: {},
    columns: {},
    beams: {},
    slabs: {},
    staircases: {},
    foundations: {},
    plumbingFixtures: {},
    electricalPoints: {},
    hvacUnits: {},
    fireDevices: {},
    elvDevices: {},
    solarEquipment: {},
    risers: {},
    ratesByKey: {},
    projectSettings: undefined,
  }

  return {
    payload,
    counts: { rooms: Object.keys(rooms).length, walls: Object.keys(walls).length },
    skipped,
  }
}

/** Room/wall counts of a projection state — the banner's mismatch signal. */
export function projectionCounts(state) {
  return { rooms: (state?.rooms ?? []).length, walls: (state?.walls ?? []).length }
}
