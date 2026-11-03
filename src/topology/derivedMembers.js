// Derived structural members (erp-saas D-280) — members the editor's bar-bending
// engine builds from another entity instead of storing as their own element:
//
//   WALL_BEAM       plinth / lintel / roof band along a wall (getDerivedWallBeams)
//   TIE_BEAM        tie / grade band along a wall that opts in (wall.hasTieBeam)
//   INLINE_FOOTING  the pad under a column no drawn foundation carries
//   SUNSHADE        the chajja over a window that has one (opening.hasSunshade)
//   LOFT            the RCC shelf cast into a wall (wall.loft)
//
// Two halves, both pure:
//
// 1. `derivedMemberCandidates(state)` — which members the drawing implies NOW, each
//    with its parent links. It is the ONE answer to "does this member exist": the BBS
//    engine, the quantity adapters and the ERP sync all read it, so a member is never
//    counted by one and missed by another. It never double counts an explicit entity:
//    a column carried by a drawn foundation has no inline footing, and a wall whose
//    band an explicit beam of the same level covers has no wall-derived beam
//    (getDerivedWallBeams).
//
// 2. `reconcileDerivedMembers(base, prevState, nextState)` — the permanent identity
//    of each member (`state.derivedMembers`, saved with the drawing and in undo
//    history). A member keeps the id minted when it first appeared for as long as the
//    same physical member exists; its parent links are recorded separately and follow
//    the drawing:
//      • moving / resizing an opening keeps its sunshade (keyed by the opening);
//      • a wall split keeps every member that stays whole (a sunshade moves to the
//        piece its window is on; a band beam whose wall is rebuilt along the same
//        line keeps its id);
//      • a band beam actually cut into pieces, or pieces combined into one, gets NEW
//        ids that name their predecessors (`predecessorIfcIds`) — approved work or
//        payment on the old member is never silently transferred;
//      • a member the drawing no longer implies is dropped here, which retires it in
//        the ERP (its history and BOQ identity are kept there).
//    The store runs it on every committed change that touches its inputs
//    (`store/derivedMembersMiddleware.js`), in the same commit as the parent change.

import { uid, uidIfc } from '../lib/ids.js'
import { getDerivedWallBeams } from './beams.js'

export const DERIVATION_KIND = Object.freeze({
  WALL_BEAM: 'WALL_BEAM',
  TIE_BEAM: 'TIE_BEAM',
  INLINE_FOOTING: 'INLINE_FOOTING',
  SUNSHADE: 'SUNSHADE',
  LOFT: 'LOFT',
})

/** Per kind: its label prefix, its reading, and whether it is a linear member along its wall. */
export const DERIVATION_KINDS = Object.freeze({
  WALL_BEAM: { prefix: (level) => ({ plinth: 'PB', lintel: 'LB', roof: 'RB' })[level] ?? 'WB', noun: (level) => `${(level ?? '').charAt(0).toUpperCase()}${(level ?? '').slice(1)} band`, linear: true },
  TIE_BEAM: { prefix: () => 'TB', noun: () => 'Tie band', linear: true },
  INLINE_FOOTING: { prefix: () => 'FI', noun: () => 'Footing', linear: false },
  SUNSHADE: { prefix: () => 'SS', noun: () => 'Sunshade', linear: false },
  LOFT: { prefix: () => 'LF', noun: () => 'Loft', linear: false },
})

// What a member is keyed by within its kind: a band by its wall and level, a loft by
// its wall, a sunshade by its OPENING (it follows the window across walls), a footing
// by its column.
function memberKey(m) {
  switch (m.derivationKind) {
    case DERIVATION_KIND.WALL_BEAM: return `WB|${m.hostWallId}|${m.level}`
    case DERIVATION_KIND.TIE_BEAM: return `TB|${m.hostWallId}`
    case DERIVATION_KIND.LOFT: return `LF|${m.hostWallId}`
    case DERIVATION_KIND.SUNSHADE: return `SS|${m.hostOpeningId}`
    case DERIVATION_KIND.INLINE_FOOTING: return `IF|${m.hostColumnId}`
    default: throw new Error(`derivedMembers: unknown derivation kind ${m.derivationKind}`)
  }
}

/**
 * Columns that stand on an inline footing: a column whose type gives a footing pad and
 * that no drawn foundation carries. The one rule for both the editor's footing
 * quantities (`getFoundationQuantities`) and the derived footing members.
 */
export function inlineFootingColumns(state) {
  const attached = new Set()
  for (const f of Object.values(state.foundations ?? {})) for (const cid of (f.columnIds ?? [])) attached.add(cid)
  const types = state.projectSettings?.columnTypes ?? []
  const out = []
  for (const column of Object.values(state.columns ?? {})) {
    if (attached.has(column.id)) continue
    const columnType = types.find((t) => t.id === column.columnTypeId)
    if (!columnType || !(columnType.footingLengthFt > 0 && columnType.footingWidthFt > 0 && columnType.footingDepthFt > 0)) continue
    out.push({ column, columnType })
  }
  return out
}

const isSolidWall = (state, w) => !w.isVirtual && !w.isPlot && state.nodes?.[w.n1] && state.nodes?.[w.n2]

/**
 * The members the drawing implies now: `{ derivationKind, level, hostWallId,
 * hostOpeningId, hostColumnId, floorId }`, in a stable order.
 */
export function derivedMemberCandidates(state) {
  const out = []
  for (const beam of getDerivedWallBeams(state)) {
    const wall = state.walls[beam.sourceWallId]
    out.push({ derivationKind: DERIVATION_KIND.WALL_BEAM, level: beam.level, hostWallId: wall.id, hostOpeningId: null, hostColumnId: null, floorId: wall.floorId ?? null })
  }
  const sunshadeOn = state.projectSettings?.sunshadeSettings?.enabled !== false
  for (const wall of Object.values(state.walls ?? {})) {
    if (!isSolidWall(state, wall)) continue
    const floorId = wall.floorId ?? null
    if (wall.hasTieBeam === true) {
      out.push({ derivationKind: DERIVATION_KIND.TIE_BEAM, level: 'tie', hostWallId: wall.id, hostOpeningId: null, hostColumnId: null, floorId })
    }
    if (wall.loft?.enabled === true && wall.loft.widthFt > 0 && wall.loft.depthFt > 0) {
      out.push({ derivationKind: DERIVATION_KIND.LOFT, level: null, hostWallId: wall.id, hostOpeningId: null, hostColumnId: null, floorId })
    }
    if (!sunshadeOn) continue
    for (const opening of (wall.openings ?? [])) {
      if (opening.type !== 'window' || !opening.hasSunshade || !(opening.width > 0)) continue
      out.push({ derivationKind: DERIVATION_KIND.SUNSHADE, level: null, hostWallId: wall.id, hostOpeningId: opening.id, hostColumnId: null, floorId })
    }
  }
  for (const { column } of inlineFootingColumns(state)) {
    out.push({ derivationKind: DERIVATION_KIND.INLINE_FOOTING, level: null, hostWallId: null, hostOpeningId: null, hostColumnId: column.id, floorId: column.baseFloorId ?? column.floorId ?? null })
  }
  return out
}

/** The registered member of each candidate (null when a bare state never passed through the store). */
export function derivedMembersWithIdentity(state) {
  const byKey = new Map(Object.values(state.derivedMembers ?? {}).map((m) => [memberKey(m), m]))
  return derivedMemberCandidates(state).map((candidate) => {
    const key = memberKey(candidate)
    return { candidate, key, member: byKey.get(key) ?? null }
  })
}

/** The id the BBS groups of a candidate carry: its member's id, else its key. */
export function derivedElementId(entry) {
  return entry.member?.id ?? entry.key
}

// ── Geometry for lineage: a linear member's segment is its wall's centreline ─────

function wallSegment(state, wallId) {
  const w = state?.walls?.[wallId]
  const a = w && state.nodes?.[w.n1], b = w && state.nodes?.[w.n2]
  return a && b ? { a, b } : null
}

const LINE_TOLERANCE_IN = 1
const OVERLAP_MIN_IN = 1

function distToLine(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len
}

// Two segments on one line that share more than a point.
function overlapsAlong(s1, s2) {
  if (distToLine(s2.a, s1.a, s1.b) > LINE_TOLERANCE_IN || distToLine(s2.b, s1.a, s1.b) > LINE_TOLERANCE_IN) return false
  const dx = s1.b.x - s1.a.x, dy = s1.b.y - s1.a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return false
  const t = (p) => ((p.x - s1.a.x) * dx + (p.y - s1.a.y) * dy) / len
  const [lo1, hi1] = [0, len]
  const [lo2, hi2] = [Math.min(t(s2.a), t(s2.b)), Math.max(t(s2.a), t(s2.b))]
  return Math.min(hi1, hi2) - Math.max(lo1, lo2) > OVERLAP_MIN_IN
}

const samePoint = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) <= LINE_TOLERANCE_IN
const sameSegment = (s1, s2) =>
  (samePoint(s1.a, s2.a) && samePoint(s1.b, s2.b)) || (samePoint(s1.a, s2.b) && samePoint(s1.b, s2.a))

// ── Identity ─────────────────────────────────────────────────────────────────────

function nextLabelNo(members, prefix, floorId) {
  let max = 0
  for (const m of members) {
    if (m.floorId !== floorId || DERIVATION_KINDS[m.derivationKind].prefix(m.level) !== prefix) continue
    if ((m.labelNo ?? 0) > max) max = m.labelNo
  }
  return max + 1
}

function withLinks(member, candidate) {
  return {
    ...member,
    hostWallId: candidate.hostWallId,
    hostOpeningId: candidate.hostOpeningId,
    hostColumnId: candidate.hostColumnId,
    floorId: candidate.floorId,
  }
}

const sameRecord = (a, b) =>
  a.hostWallId === b.hostWallId && a.hostOpeningId === b.hostOpeningId && a.hostColumnId === b.hostColumnId &&
  a.floorId === b.floorId && a.labelNo === b.labelNo && a.ifcGlobalId === b.ifcGlobalId &&
  (a.predecessorIfcIds ?? []).join() === (b.predecessorIfcIds ?? []).join()

/**
 * The registry after a change (see the file header). `base` is the registry the change
 * starts from; `prevState` is the drawing it described (null when the registry comes
 * with the change — undo, redo, load — and so already matches it). Returns `base`
 * itself when nothing changed.
 */
export function reconcileDerivedMembers(base, prevState, nextState) {
  const records = Object.values(base ?? {})
  const byKey = new Map(records.map((m) => [memberKey(m), m]))
  const candidates = derivedMemberCandidates(nextState)
  const out = new Map()
  const placed = []           // { candidate, member } in candidate order
  const matched = new Set()
  for (const candidate of candidates) {
    const member = byKey.get(memberKey(candidate)) ?? null
    if (member) matched.add(member.id)
    placed.push({ candidate, member, predecessors: [] })
  }

  // Lineage: a linear member that is gone, on a line a member of the same kind and level
  // now runs along, was cut or combined (or rebuilt whole).
  const retiring = records.filter((m) => !matched.has(m.id) && DERIVATION_KINDS[m.derivationKind].linear)
  if (prevState && retiring.length) {
    for (const gone of retiring) {
      const was = wallSegment(prevState, gone.hostWallId)
      if (!was) continue
      for (const p of placed) {
        const c = p.candidate
        if (c.derivationKind !== gone.derivationKind || c.level !== gone.level) continue
        const now = wallSegment(nextState, c.hostWallId)
        if (now && overlapsAlong(was, now)) p.predecessors.push({ member: gone, was })
      }
    }
  }
  const successorCount = new Map()
  for (const p of placed) for (const { member } of p.predecessors) successorCount.set(member.id, (successorCount.get(member.id) ?? 0) + 1)

  const minted = []
  const mint = (candidate, predecessorIfcIds) => {
    const prefix = DERIVATION_KINDS[candidate.derivationKind].prefix(candidate.level)
    const member = {
      id: uid(),
      ifcGlobalId: uidIfc(),
      derivationKind: candidate.derivationKind,
      level: candidate.level,
      hostWallId: candidate.hostWallId,
      hostOpeningId: candidate.hostOpeningId,
      hostColumnId: candidate.hostColumnId,
      floorId: candidate.floorId,
      labelNo: nextLabelNo([...out.values(), ...records, ...minted], prefix, candidate.floorId),
      predecessorIfcIds,
    }
    minted.push(member)
    return member
  }

  for (const p of placed) {
    const { candidate, member, predecessors } = p
    if (member && predecessors.length === 0) { out.set(member.id, withLinks(member, candidate)); continue }
    if (member) {
      // Combined: the surviving wall's member now also covers a member that went.
      const merged = mint(candidate, [member.ifcGlobalId, ...predecessors.map((x) => x.member.ifcGlobalId)])
      out.set(merged.id, merged)
      continue
    }
    if (predecessors.length === 1) {
      const { member: gone, was } = predecessors[0]
      const now = wallSegment(nextState, candidate.hostWallId)
      if (successorCount.get(gone.id) === 1 && now && sameSegment(was, now) && !out.has(gone.id)) {
        out.set(gone.id, withLinks(gone, candidate))   // rebuilt whole along the same line
        continue
      }
    }
    const fresh = mint(candidate, predecessors.map((x) => x.member.ifcGlobalId))
    out.set(fresh.id, fresh)
  }

  if (out.size === records.length && records.every((m) => out.has(m.id) && sameRecord(out.get(m.id), m))) return base
  return Object.fromEntries(out)
}
