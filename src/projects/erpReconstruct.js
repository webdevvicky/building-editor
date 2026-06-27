// erpReconstruct.js — map the ERP building-state payload into a loadProject()
// snapshot so the editor canvas rebuilds existing geometry on reopen.
//
// Identity rule (the whole point): the editor's internal `id` AND `ifcGlobalId`
// are BOTH set to the ERP `sourceEditorId`. So wall→node refs (n1/n2),
// room.wallIds, and the sync id-map all line up, and a later edit resolves to an
// UPDATE — never a duplicate ADD. Units: ERP stores mm/ft; the editor is inches.

import { uidIfc } from '../lib/ids.js'
import { mmToIn } from './syncMappers.js'
import { entryForErpKind } from './elementRegistry.js'

const toIn = mmToIn // single mm→inch source (syncMappers)

// Editor opening type is just door|window (ventilator etc. collapse to window).
const openingType = (t) => (String(t ?? '').toUpperCase() === 'DOOR' ? 'door' : 'window')

/**
 * @param {{nodes?:any[], walls?:any[], rooms?:any[], elements?:any[]}} state
 * @returns {object} a loadProject()-shaped snapshot
 */
export function reconstructSnapshot(state) {
  const s = state || {}

  // ── Nodes ──────────────────────────────────────────────────────────────────
  // Reconstructed nodes are CORNER (onWallId null) — we don't carry the
  // T-junction parent, and a CORNER always satisfies the node invariant.
  const nodes = {}
  const nodeByCoord = new Map() // `${xMm},${yMm}` → sourceEditorId (for nodeOrder)
  for (const n of s.nodes ?? []) {
    if (!n.sourceEditorId) continue
    nodes[n.sourceEditorId] = {
      id: n.sourceEditorId, ifcGlobalId: n.sourceEditorId,
      x: toIn(n.xMm), y: toIn(n.yMm),
      floorIds: ['F1'], kind: 'CORNER', onWallId: null,
    }
    nodeByCoord.set(`${n.xMm},${n.yMm}`, n.sourceEditorId)
  }

  // ── Walls ──────────────────────────────────────────────────────────────────
  // Skip any wall whose endpoints didn't reconstruct (dangling ref guard).
  const walls = {}
  for (const w of s.walls ?? []) {
    const src = w.sourceEditorId
    const n1 = w.n1NodeSourceEditorId
    const n2 = w.n2NodeSourceEditorId
    if (!src || !nodes[n1] || !nodes[n2]) continue
    walls[src] = {
      id: src, ifcGlobalId: src, n1, n2,
      height: w.heightMm != null ? toIn(w.heightMm) : 120,
      thickness: w.thicknessMm != null ? toIn(w.thicknessMm) : 9,
      materialKey: 'IS_MODULAR_BRICK', // ERP enum ≠ editor key; editor default
      openings: (w.openings ?? []).map((o) => ({
        ifcGlobalId: uidIfc(), // RoomOpening has no sourceEditorId — fresh id
        type: openingType(o.openingType),
        width: toIn(o.widthMm), height: toIn(o.heightMm),
        offset: toIn(o.offsetFromStartMm ?? 0),
      })),
      floorId: 'F1', labelNo: null, classification: null,
      isPlot: false, isVirtual: false,
      hasPlinthBeam: null, hasLintelBeam: null, hasRoofBeam: null, hasBalconyRailingEdge: null,
      meta: null, junctions: [], splitOrigin: 'NONE',
    }
  }

  // ── Rooms ──────────────────────────────────────────────────────────────────
  // wallIds: walls whose owner surface points back to this room (+ survived the
  // dangling guard). nodeOrder: vertices (in sortOrder) matched to nodes by exact
  // mm coordinate (vertices & nodes share the same editor-derived integer mm).
  const rooms = {}
  for (const r of s.rooms ?? []) {
    const src = r.sourceEditorId
    if (!src) continue
    const wallIds = (s.walls ?? [])
      .filter((w) => w.roomSourceEditorId === src && walls[w.sourceEditorId])
      .map((w) => w.sourceEditorId)
    const nodeOrder = (r.vertices ?? [])
      .slice().sort((a, b) => a.sortOrder - b.sortOrder)
      .map((v) => nodeByCoord.get(`${v.xMm},${v.yMm}`))
      .filter(Boolean)
    rooms[src] = {
      id: src, ifcGlobalId: src,
      name: r.name ?? 'Room',
      wallIds, nodeOrder,
      type: r.roomTypeCode ?? 'OTHER', // loadProject re-validates against ROOM_PRESETS
      finishes: null, customType: null,
      floorId: 'F1', classification: null, meta: null, labelNo: null,
    }
  }

  // ── Elements (registry-driven — kind→collection lives ONLY in the registry) ──
  const elementCollections = {
    columns: {}, beams: {}, slabs: {}, staircases: {}, foundations: {}, risers: {},
    plumbingFixtures: {}, electricalPoints: {}, hvacUnits: {}, fireDevices: {},
    elvDevices: {}, solarEquipment: {},
  }
  for (const e of s.elements ?? []) {
    if (!e.sourceEditorId) continue
    const entry = entryForErpKind(e.kind)
    if (!entry || !elementCollections[entry.collection]) continue
    elementCollections[entry.collection][e.sourceEditorId] = {
      id: e.sourceEditorId, ifcGlobalId: e.sourceEditorId,
      floorId: 'F1', labelNo: null,
      ...entry.toEditorShape(e),
    }
  }

  return {
    version: 7, unit: 'inch',
    nodes, walls, rooms, stamps: {},
    ...elementCollections,
    ratesByKey: {}, projectSettings: null,
  }
}
