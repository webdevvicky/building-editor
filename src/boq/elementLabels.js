// Element-level human-readable labels for spatial tracking.
//
// Site engineers reference walls / rooms / columns / beams / slabs by short
// stable codes (W-001, R-003, C-001, B-004, S-001 — with a floor segment in
// multi-floor projects: W-F1-001). These codes appear in site diaries, work
// orders, and the BOQ exports' "Element IDs" sheet, so they MUST be stable for
// an element's lifetime — adding or deleting other elements must never renumber
// an existing one.
//
// STORAGE MODEL (assign-once, never reassigned):
//   - Each entity carries an immutable integer `labelNo` (per-type, per-floor
//     sequence), assigned once at creation via assignLabelsToState() and stored
//     in the model snapshot (so undo/redo restore it with the entity).
//   - We store the NUMBER, not the rendered string. The rendered prefix adapts
//     to single- vs multi-floor at read time (getElementLabels), so an element's
//     number never changes even when the project later gains a second floor.
//     A single→multi-floor transition only ADDS a floor qualifier
//     (W-001 → W-F1-001, still wall #1 on F1) — it is additive disambiguation,
//     not a renumber.
//
// This module is pure (no React / DOM / store mutation). The store wires
// assignLabelsToState into its creation actions + loadProject.

import { isExternalWall, getRoomsForWall } from '../topology/walls.js'
import { ROOM_TYPE_LABELS } from '../roomPresets.js'

const DEFAULT_FLOOR_ID = 'F1'

// Per-entity-type prefix letter. Keep in sync with the BBS mark-prefix
// convention where it overlaps, but these are SPATIAL labels (distinct purpose).
export const LABEL_PREFIX = Object.freeze({
  wall: 'W', room: 'R', column: 'C', beam: 'B', slab: 'S',
})

// The five labelled collections + how to read each entity's owning floor.
// Columns span floors (baseFloorId/topFloorId); the base floor anchors the label.
const LABELLED = Object.freeze([
  { key: 'walls',   type: 'wall',   floorOf: (e) => e.floorId },
  { key: 'rooms',   type: 'room',   floorOf: (e) => e.floorId },
  { key: 'columns', type: 'column', floorOf: (e) => e.baseFloorId ?? e.floorId },
  { key: 'beams',   type: 'beam',   floorOf: (e) => e.floorId },
  { key: 'slabs',   type: 'slab',   floorOf: (e) => e.floorId },
])

const pad3 = (n) => String(n).padStart(3, '0')

/**
 * assignLabelsToState(state) → { changed: boolean, collections: { walls, rooms, columns, beams, slabs } }
 *
 * Pure planner. Reads the five entity maps off `state`, and for every entity
 * with labelNo == null assigns the next per-floor sequence (1 + max existing
 * labelNo on that floor for that type, advancing as it goes so multiple fresh
 * entities get distinct numbers). Entities that already carry a labelNo are
 * returned UNCHANGED — labels are never reassigned.
 *
 * Returns new collection objects only for the maps that changed (referential
 * stability for Zustand); `changed` is false when nothing needed a label.
 * The store action commits the result with a single set().
 */
export function assignLabelsToState(state) {
  const out = {}
  let changed = false

  for (const { key, floorOf } of LABELLED) {
    const map = state[key]
    if (!map) continue
    const entries = Object.values(map)

    // High-water mark per floor (seed from already-labelled entities).
    const maxByFloor = new Map()
    let anyMissing = false
    for (const e of entries) {
      const floor = floorOf(e) ?? DEFAULT_FLOOR_ID
      if (typeof e.labelNo === 'number') {
        if (!maxByFloor.has(floor) || e.labelNo > maxByFloor.get(floor)) {
          maxByFloor.set(floor, e.labelNo)
        }
      } else {
        anyMissing = true
      }
    }
    if (!anyMissing) continue

    // Assign in a deterministic order (by id) so concurrent fresh entities
    // get reproducible numbers across runs.
    const unlabeled = entries
      .filter((e) => typeof e.labelNo !== 'number')
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))

    const nextMap = { ...map }
    for (const e of unlabeled) {
      const floor = floorOf(e) ?? DEFAULT_FLOOR_ID
      const next = (maxByFloor.get(floor) ?? 0) + 1
      maxByFloor.set(floor, next)
      nextMap[e.id] = { ...e, labelNo: next }
    }
    out[key] = nextMap
    changed = true
  }

  return { changed, collections: out }
}

// ── Read-side: format stored labelNo into display strings ────────────────────

function isMultiFloor(state) {
  return (state.projectSettings?.floors?.length ?? 1) > 1
}

function floorLabelOf(state, floorId) {
  const f = (state.projectSettings?.floors ?? []).find((x) => x.id === floorId)
  return f?.label ?? floorId ?? DEFAULT_FLOOR_ID
}

function formatLabel(prefix, floorId, labelNo, multi, id) {
  if (typeof labelNo !== 'number') {
    // Fallback for un-labelled entities (should not happen post-assignment).
    return `${prefix}-${String(id ?? '').slice(0, 4) || '???'}`
  }
  return multi
    ? `${prefix}-${floorId}-${pad3(labelNo)}`
    : `${prefix}-${pad3(labelNo)}`
}

// Cardinal-direction heuristic for a wall's face, from its node coordinates.
// Orthogonal walls map cleanly; oblique walls are tagged "oblique".
function wallOrientation(state, wall) {
  const a = state.nodes?.[wall.n1]
  const b = state.nodes?.[wall.n2]
  if (!a || !b) return ''
  const dx = b.x - a.x
  const dy = b.y - a.y
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  if (adx === 0 && ady === 0) return ''
  const ratio = adx === 0 ? Infinity : ady / adx
  if (ratio > 3) return dy < 0 ? 'N' : 'S'        // mostly vertical run
  if (ratio < 1 / 3) return dx > 0 ? 'E' : 'W'    // mostly horizontal run
  return 'oblique'
}

function wallLengthFt(state, wall) {
  const a = state.nodes?.[wall.n1]
  const b = state.nodes?.[wall.n2]
  if (!a || !b) return 0
  return Math.hypot(b.x - a.x, b.y - a.y) / 12
}

/**
 * getElementLabels(state) → {
 *   walls:   { [id]: { label, description, ifcGlobalId, floorId, labelNo, thicknessIn?, lengthFt? } },
 *   rooms:   { [id]: { label, description, ifcGlobalId, floorId, labelNo, areaFt2? } },
 *   columns: { [id]: { label, description, ifcGlobalId, floorId, labelNo, typeId? } },
 *   beams:   { [id]: { label, description, ifcGlobalId, floorId, labelNo, level? } },
 *   slabs:   { [id]: { label, description, ifcGlobalId, floorId, labelNo } },
 * }
 *
 * Pure read. Formats the stored labelNo into display strings + a human
 * description, adapting the prefix to single/multi-floor at read time.
 */
export function getElementLabels(state) {
  const multi = isMultiFloor(state)
  const result = { walls: {}, rooms: {}, columns: {}, beams: {}, slabs: {} }

  // Walls
  for (const w of Object.values(state.walls ?? {})) {
    const floorId = w.floorId ?? DEFAULT_FLOOR_ID
    const orient = wallOrientation(state, w)
    const lenFt = Math.round(wallLengthFt(state, w) * 10) / 10
    const thk = w.thickness ?? 9
    const ext = isExternalWall(state, w.id)
    const rooms = getRoomsForWall(state, w.id) ?? []
    const roomName = rooms[0]?.name
    const descParts = [
      orient ? `${orient} face` : 'wall',
      `${lenFt} ft`,
      `${thk}″`,
      ext ? 'external' : 'partition',
    ]
    if (roomName) descParts.push(roomName)
    result.walls[w.id] = {
      label:       formatLabel(LABEL_PREFIX.wall, floorId, w.labelNo, multi, w.id),
      description: descParts.join(' · '),
      ifcGlobalId: w.ifcGlobalId ?? null,
      floorId,
      labelNo:     w.labelNo ?? null,
      thicknessIn: thk,
      lengthFt:    lenFt,
    }
  }

  // Rooms
  for (const r of Object.values(state.rooms ?? {})) {
    const floorId = r.floorId ?? DEFAULT_FLOOR_ID
    const typeLabel = ROOM_TYPE_LABELS[r.type] ?? r.type ?? 'Other'
    const areaFt2 = Math.round((state.getRoomArea?.(r.id) ?? 0) * 10) / 10
    result.rooms[r.id] = {
      label:       formatLabel(LABEL_PREFIX.room, floorId, r.labelNo, multi, r.id),
      description: `${r.name || 'Untitled'} · ${typeLabel} · ${floorLabelOf(state, floorId)} · ${areaFt2} Sft`,
      ifcGlobalId: r.ifcGlobalId ?? null,
      floorId,
      labelNo:     r.labelNo ?? null,
      areaFt2,
    }
  }

  // Columns
  for (const c of Object.values(state.columns ?? {})) {
    const floorId = c.baseFloorId ?? c.floorId ?? DEFAULT_FLOOR_ID
    const typeId = c.columnTypeId ?? '—'
    result.columns[c.id] = {
      label:       formatLabel(LABEL_PREFIX.column, floorId, c.labelNo, multi, c.id),
      description: `${typeId} type · ${floorLabelOf(state, floorId)}`,
      ifcGlobalId: c.ifcGlobalId ?? null,
      floorId,
      labelNo:     c.labelNo ?? null,
      typeId,
    }
  }

  // Beams (explicit only — wall-derived beams have no stored entity / labelNo)
  for (const b of Object.values(state.beams ?? {})) {
    const floorId = b.floorId ?? DEFAULT_FLOOR_ID
    const level = b.beamClass ?? b.level ?? '—'
    result.beams[b.id] = {
      label:       formatLabel(LABEL_PREFIX.beam, floorId, b.labelNo, multi, b.id),
      description: `${level} · ${floorLabelOf(state, floorId)}`,
      ifcGlobalId: b.ifcGlobalId ?? null,
      floorId,
      labelNo:     b.labelNo ?? null,
      level,
    }
  }

  // Slabs
  for (const sl of Object.values(state.slabs ?? {})) {
    const floorId = sl.floorId ?? DEFAULT_FLOOR_ID
    const role = sl.role ?? sl.classification ?? sl.type ?? '—'
    result.slabs[sl.id] = {
      label:       formatLabel(LABEL_PREFIX.slab, floorId, sl.labelNo, multi, sl.id),
      description: `${role} · ${floorLabelOf(state, floorId)}`,
      ifcGlobalId: sl.ifcGlobalId ?? null,
      floorId,
      labelNo:     sl.labelNo ?? null,
    }
  }

  return result
}
