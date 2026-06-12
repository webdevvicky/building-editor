// Room-by-room BOQ breakdown.
//
// Produces one row per valid room with the room-attributable quantities
// (floor area, wall area, brickwork, plaster internal/external, flooring,
// paint, waterproofing, tiles, door/window counts), grouped by floor, plus a
// column-wise totals row and a project-level cross-check.
//
// DRY contract — this module computes NOTHING itself. Every quantity is read
// back from an existing engine:
//   - Per-room finishes/masonry/tiles/openings → scopeStateToRoom + getBoqLines
//     (the canonical room-scope BOQ path; same engine the floor toggle uses).
//   - Plaster internal/external split → the project-level
//     computePlasterQuantities(state)._meta, which classifies each wall face as
//     EXTERNAL/PARTITION against the FULL graph. (Per-room scope can't do this:
//     in single-room scope every wall reads adjacency=1, so partitions would be
//     mis-counted as external — see scope.js. So plaster comes from one
//     project-level call and is attributed back to rooms here.)
//
// Cross-check honesty (see CLAUDE.md feature notes): the columns that reconcile
// EXACTLY to the BOQ Summary are flooring, plaster-external, paint,
// waterproofing and tiles (all room-attributable, single-owner). brickwork
// (no beam deduction in room scope), plaster-internal (excludes columns, which
// are not room-owned) and door/window counts (a shared-wall opening is counted
// in each adjoining room) have documented, expected deltas. The panel surfaces
// the exact-match comparator and footnotes the rest.

import { scopeStateToRoom } from './scope'
import { getBoqLines } from './lines'
import { computePlasterQuantities } from '../quantities/plaster.js'
import { computeScopeOfWork } from './_scopeOfWork.js'
import { getElementLabels } from './elementLabels.js'
import { getRoomGeometry } from '../topology/rooms.js'
import { ROOM_TYPE_LABELS } from '../roomPresets.js'
import { safeR2 as r2 } from '../lib/numbers.js'

const DEFAULT_FLOOR_ID = 'F1'

// BOQ line ids we read per room (kept inline so the module has no hidden
// coupling to the constants barrel; these strings are the stable line ids
// emitted by boq/lines.js).
const LINE = Object.freeze({
  FLOORING:        'finishes_flooring',
  PAINT_WALLS:     'finishes_paint_walls',
  PAINT_CEILING:   'finishes_paint_ceiling',
  WATERPROOFING:   'finishes_waterproofing',
  TILES_FLOOR:     'tiles_floor',
  PLASTER_EXTERNAL:'finishes_plaster_walls_external',
})

// Column keys that reconcile exactly to the project BOQ Summary lines.
export const EXACT_MATCH_COLUMNS = Object.freeze([
  'flooringSft', 'plasterExtSft', 'paintSft', 'waterproofingSft', 'tilesSft',
])

function lineIndex(lines) {
  const byId = {}
  for (const l of lines) byId[l.id] = l
  return byId
}

/**
 * computeRoomBreakdown(state, rates) →
 *   {
 *     byFloor: [{ floorId, floorLabel, rooms: [RoomRow] }],
 *     totals:  { ...column sums },
 *     crossCheck: { flooringSft, plasterExtSft, paintSft, waterproofingSft, tilesSft },
 *     isMultiFloor: boolean,
 *   }
 *
 * `state` is the live store (or any state-shaped object). `rates` is only
 * threaded through getBoqLines so line shapes match the rest of the app; this
 * module reads quantities, never costs.
 */
export function computeRoomBreakdown(state, rates = {}) {
  const validIds = state.getValidRoomIds?.() ?? []

  // Element labels (W-001, etc.) — computed once, shared across rooms (DRY).
  const elementLabels = getElementLabels(state)

  // ── Project-level plaster split (correct EXTERNAL/PARTITION classification).
  const plaster = computePlasterQuantities(state)
  const internalByRoom = {}            // roomId  → inner-face wall plaster (Sft)
  const wallContribsByRoom = {}        // roomId  → wallContributions[]
  for (const pr of (plaster?._meta?.perRoom ?? [])) {
    internalByRoom[pr.roomId] = pr.wallSumFt2 ?? 0
    wallContribsByRoom[pr.roomId] = pr.wallContributions ?? []
  }
  const externalByWall = {}            // wallId  → outer-face plaster (Sft)
  for (const ew of (plaster?._meta?.perExternalWall ?? [])) {
    externalByWall[ew.wallId] = ew.netOuterAreaFt2 ?? 0
  }

  // ── Per-room rows.
  const rows = []
  for (const roomId of validIds) {
    const room = state.rooms?.[roomId]
    if (!room) continue

    const rs    = scopeStateToRoom(state, roomId)
    const lines = getBoqLines(rs, rates, {})
    const byId  = lineIndex(lines)
    const qty   = (id) => byId[id]?.qty ?? 0

    // Brickwork (Cft): sum masonry volume across materials (HALF_PARTITION).
    const masonry = rs.getMasonryWithBeamDeduction?.() ?? {}
    let brickworkCft = 0
    for (const m of Object.values(masonry)) brickworkCft += m?.volFt3 ?? 0

    // External plaster: this room's external walls' outer faces (each external
    // wall belongs to exactly one room, so summing across rooms = project ext).
    let plasterExtSft = 0
    for (const wid of (room.wallIds ?? [])) plasterExtSft += externalByWall[wid] ?? 0

    const openings = computeScopeOfWork(rs).openingCounts

    // Carpet (clear-internal) area — pure geometry; fall back to stored area.
    const carpetAreaFt2 = r2(
      getRoomGeometry(state, roomId, 'clear_internal')?.area ??
      state.getRoomArea(roomId)
    )

    // Per-wall detail rows for this room (from the plaster wall contributions).
    const perWall = (wallContribsByRoom[roomId] ?? [])
      .map((wc) => {
        const w = state.walls?.[wc.wallId]
        if (!w) return null
        const heightFt    = r2((w.height ?? 120) / 12)
        const thicknessIn = w.thickness ?? 9
        return {
          label:             elementLabels.walls[wc.wallId]?.label ?? wc.wallId,
          wallId:            wc.wallId,
          ifcGlobalId:       w.ifcGlobalId ?? null,
          faceType:          wc.wallType,                    // 'EXTERNAL' | 'PARTITION'
          effectiveLengthFt: r2(wc.effectiveLengthFt),
          heightFt,
          thicknessIn,
          grossAreaSft:      r2(wc.effectiveLengthFt * heightFt),
          openingDeductSft:  r2(wc.openingDeductionFt2),
          netPlasterSft:     r2(wc.faceAreaFt2),             // faceAreaFt2 is already net
          netPaintSft:       r2(wc.faceAreaFt2),             // paint zone == plaster zone
          brickworkCft:      r2(wc.faceAreaFt2 * (thicknessIn / 12)),
          openings: (w.openings ?? []).map((o) => ({
            type:     o.type,
            subtype:  o.subtype ?? null,
            widthFt:  r2((o.width  ?? 0) / 12),
            heightFt: r2((o.height ?? 0) / 12),
            areaSft:  r2(((o.width ?? 0) * (o.height ?? 0)) / 144),
          })),
        }
      })
      .filter(Boolean)

    const ceilingHeightFt = r2(perWall.reduce((m, pw) => Math.max(m, pw.heightFt), 0))

    rows.push({
      roomId,
      name:             room.name || 'Untitled',
      type:             room.type || 'OTHER',
      typeLabel:        ROOM_TYPE_LABELS[room.type] ?? room.type ?? 'Other',
      floorId:          room.floorId ?? DEFAULT_FLOOR_ID,
      floorAreaFt2:     r2(state.getRoomArea(roomId)),
      carpetAreaFt2,
      wallAreaFt2:      r2(state.getRoomWallArea(roomId)),
      wallCount:        perWall.length,
      ceilingHeightFt,
      perWall,
      brickworkCft:     r2(brickworkCft),
      plasterIntSft:    r2(internalByRoom[roomId] ?? 0),
      plasterExtSft:    r2(plasterExtSft),
      flooringSft:      r2(qty(LINE.FLOORING)),
      paintSft:         r2(qty(LINE.PAINT_WALLS) + qty(LINE.PAINT_CEILING)),
      waterproofingSft: r2(qty(LINE.WATERPROOFING)),
      tilesSft:         r2(qty(LINE.TILES_FLOOR)),
      doors:            openings.doors,
      windows:          openings.windows,
    })
  }

  // ── Group by floor (sequence order). Only floors that have rooms appear.
  const floors = (state.projectSettings?.floors ?? [])
    .slice()
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
  const labelOf = (id) => floors.find(f => f.id === id)?.label ?? id

  const order = []                     // floorId order (sequence first, then any stragglers)
  const groups = new Map()
  for (const f of floors) { order.push(f.id); groups.set(f.id, []) }
  for (const row of rows) {
    if (!groups.has(row.floorId)) { order.push(row.floorId); groups.set(row.floorId, []) }
    groups.get(row.floorId).push(row)
  }
  const byFloor = []
  for (const floorId of order) {
    const frooms = groups.get(floorId)
    if (!frooms || frooms.length === 0) continue
    frooms.sort((a, b) => a.name.localeCompare(b.name))
    byFloor.push({ floorId, floorLabel: labelOf(floorId), rooms: frooms })
  }

  // ── Column-wise totals.
  const sum = (key) => r2(rows.reduce((t, row) => t + (row[key] || 0), 0))
  const totals = {
    floorAreaFt2:     sum('floorAreaFt2'),
    wallAreaFt2:      sum('wallAreaFt2'),
    brickworkCft:     sum('brickworkCft'),
    plasterIntSft:    sum('plasterIntSft'),
    plasterExtSft:    sum('plasterExtSft'),
    flooringSft:      sum('flooringSft'),
    paintSft:         sum('paintSft'),
    waterproofingSft: sum('waterproofingSft'),
    tilesSft:         sum('tilesSft'),
    doors:            rows.reduce((t, row) => t + row.doors, 0),
    windows:          rows.reduce((t, row) => t + row.windows, 0),
  }

  // ── Project-level cross-check (only the exact-match columns).
  const projLines = getBoqLines(state, rates, {})
  const pById = lineIndex(projLines)
  const pq = (id) => r2(pById[id]?.qty ?? 0)
  const crossCheck = {
    flooringSft:      pq(LINE.FLOORING),
    plasterExtSft:    pq(LINE.PLASTER_EXTERNAL),
    paintSft:         r2(pq(LINE.PAINT_WALLS) + pq(LINE.PAINT_CEILING)),
    waterproofingSft: pq(LINE.WATERPROOFING),
    tilesSft:         pq(LINE.TILES_FLOOR),
  }

  return {
    byFloor,
    totals,
    crossCheck,
    isMultiFloor: byFloor.length > 1,
    roomCount: rows.length,
  }
}
