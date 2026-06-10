// Beam-tool endpoint targeting — resolve a click to a beam endpoint descriptor.
//
// Priority + per-type radius (the tier concept): COLUMN > BEAM > WALL > free
// POINT. Radii live in snap/toolPolicy.js::BEAM_TOOL_TARGETS. Beam + wall
// targets project the click onto the target's resolved segment to get the
// parametric t. Only EXPLICIT beams (state.beams) are targetable — wall-derived
// beam ids are not stable. Self-reference is prevented via opts.excludeBeamId.
//
// PURE & Node-testable. No React, no DOM, no Zustand dispatches. Resolves beam
// geometry ONLY through the canonical resolveBeamEndpoint.

import { resolveBeamEndpoint } from '../topology/beams.js'
import { BEAM_TOOL_TARGETS } from './toolPolicy.js'

const DEFAULT_FLOOR_ID = 'F1'

function _tol(kind) {
  return BEAM_TOOL_TARGETS.find(t => t.kind === kind)?.toleranceIn ?? 16
}

// Project (px,py) onto segment a→b. Returns { t∈[0,1], x, y, distIn }.
function _project(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { t: 0, x: ax, y: ay, distIn: Math.hypot(px - ax, py - ay) }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  if (t < 0) t = 0; else if (t > 1) t = 1
  const x = ax + t * dx, y = ay + t * dy
  return { t, x, y, distIn: Math.hypot(px - x, py - y) }
}

/**
 * Resolve a world-space click to a beam endpoint descriptor.
 *
 * @returns {{
 *   kind: 'COLUMN'|'BEAM'|'WALL'|'POINT',
 *   ref:  object,            // the endpoint descriptor to store on the beam
 *   point:{x,y},             // resolved/snapped world position (for preview)
 *   t?:   number,            // parametric position (BEAM/WALL only)
 *   entityId?: string,       // target column/beam/wall id
 *   label?: string,          // human label for hover/panel
 * }}  Never null — falls back to a free POINT at the click.
 *
 * opts: { floorId?, excludeBeamId? }
 */
export function resolveBeamTarget(state, worldPt, opts = {}) {
  const px = worldPt.x, py = worldPt.y
  const floorId = opts.floorId ?? state.currentFloorId ?? DEFAULT_FLOOR_ID
  const excludeBeamId = opts.excludeBeamId ?? null

  // 1. COLUMN (highest priority).
  {
    let best = null
    for (const c of Object.values(state.columns ?? {})) {
      const cFloor = c.baseFloorId ?? c.floorId ?? floorId
      if (cFloor !== floorId) continue
      const pos = c.attachedNodeId ? (state.nodes?.[c.attachedNodeId] ?? c) : c
      const d = Math.hypot(pos.x - px, pos.y - py)
      if (d <= _tol('COLUMN') && (!best || d < best.d)) best = { d, c, pos }
    }
    if (best) {
      return {
        kind: 'COLUMN',
        ref: { type: 'COLUMN', columnId: best.c.id },
        point: { x: best.pos.x, y: best.pos.y },
        entityId: best.c.id,
        label: best.c.columnTypeId ?? best.c.label ?? 'Column',
      }
    }
  }

  // 2. BEAM (explicit only).
  {
    let best = null
    for (const b of Object.values(state.beams ?? {})) {
      if (b.id === excludeBeamId) continue
      if ((b.floorId ?? floorId) !== floorId) continue
      const a = resolveBeamEndpoint(state, b.endpoints?.from)
      const z = resolveBeamEndpoint(state, b.endpoints?.to)
      if (!a || !z) continue
      const pr = _project(px, py, a.x, a.y, z.x, z.y)
      if (pr.distIn <= _tol('BEAM') && (!best || pr.distIn < best.pr.distIn)) best = { pr, b }
    }
    if (best) {
      return {
        kind: 'BEAM',
        ref: { type: 'BEAM', beamId: best.b.id, t: best.pr.t },
        point: { x: best.pr.x, y: best.pr.y },
        t: best.pr.t,
        entityId: best.b.id,
        label: `Beam ${best.b.id.slice(0, 4)}`,
      }
    }
  }

  // 3. WALL (non-plot; bearing).
  {
    let best = null
    for (const w of Object.values(state.walls ?? {})) {
      if (w.isPlot) continue
      if ((w.floorId ?? floorId) !== floorId) continue
      const n1 = state.nodes?.[w.n1], n2 = state.nodes?.[w.n2]
      if (!n1 || !n2) continue
      const pr = _project(px, py, n1.x, n1.y, n2.x, n2.y)
      if (pr.distIn <= _tol('WALL') && (!best || pr.distIn < best.pr.distIn)) best = { pr, w }
    }
    if (best) {
      return {
        kind: 'WALL',
        ref: { type: 'WALL', wallId: best.w.id, t: best.pr.t },
        point: { x: best.pr.x, y: best.pr.y },
        t: best.pr.t,
        entityId: best.w.id,
        label: `Wall ${best.w.id.slice(0, 4)}`,
      }
    }
  }

  // 4. Free point.
  return { kind: 'POINT', ref: { type: 'POINT', x: px, y: py }, point: { x: px, y: py } }
}

// Human description of a stored endpoint descriptor (for BeamPanel).
//   Column C1 · Beam B2 (mid-span 42%) · Wall W3 (60%) · Free point ·
//   Detached (was Beam B2)
export function describeBeamEndpoint(ep) {
  if (!ep) return '—'
  if (ep.type === 'COLUMN') return `Column ${String(ep.columnId).slice(0, 4)}`
  if (ep.type === 'BEAM')   return `Beam ${String(ep.beamId).slice(0, 4)} (${_tLabel(ep.t)})`
  if (ep.type === 'WALL')   return `Wall ${String(ep.wallId).slice(0, 4)} (${_tLabel(ep.t)})`
  if (ep.type === 'POINT') {
    if (ep.detachedFrom) {
      const d = ep.detachedFrom
      const id = d.beamId ?? d.wallId ?? d.columnId ?? ''
      return `Detached (was ${cap(d.type)} ${String(id).slice(0, 4)})`
    }
    return 'Free point'
  }
  return '—'
}
function _tLabel(t) {
  const n = Number(t)
  if (!Number.isFinite(n)) return '?'
  if (n <= 0.001) return 'start'
  if (n >= 0.999) return 'end'
  return `mid-span ${Math.round(n * 100)}%`
}
function cap(s) { return String(s ?? '').charAt(0) + String(s ?? '').slice(1).toLowerCase() }
