// Referential integrity verifier — checks FK-style links.
//
// 2026-05-26 (Arch 9 Phase 1 Addition 2). Distinct from validate.js:
//   - validate.js  = does opening.width have a finite number?
//   - integrity.js = does wall.n1 point to a real node?
//
// Used by:
//   - Every verify script's first assertion (mandatory baseline)
//   - Arch 5 migrations (after every step)
//   - Arch 2 journal replay (after applying each op, dev mode)
//   - Arch 5 persistence (before every write)
//
// Pure: takes state, returns { valid, issues, count }. Deterministic
// ordering for byte-stable verify output.

// Helper: resolve a collection from state via legacy or post-Arch-1 paths.
function _getCollection(state, key) {
  return state?.model?.[key] ?? state?.[key] ?? {}
}

// Helper: floors are an ARRAY in projectSettings.floors, not a collection
// map. Resolve the ids set once for the integrity walk.
function _floorIds(state) {
  const floors = state?.projectSettings?.floors ?? state?.model?.projectSettings?.floors ?? []
  return new Set(floors.map(f => f.id))
}

function _push(issues, entry) {
  issues.push(Object.freeze(entry))
}

// Main entry point. Returns:
//   {
//     valid:  boolean,
//     issues: [{ kind, entityType, entityId, field, missing, message }],
//     count:  number,
//   }
//
// `kind` is one of:
//   'broken-ref'           — FK target missing
//   'orphan-collection'    — collection key not recognized (informational)
//   'invariant-violation'  — cross-state invariant failed
export function verifyIntegrity(state) {
  const issues = []
  if (!state || typeof state !== 'object') {
    _push(issues, { kind: 'orphan-collection', entityType: '_root', entityId: null, field: null, missing: null, message: 'state is not an object' })
    return { valid: false, issues, count: 1 }
  }

  const nodes        = _getCollection(state, 'nodes')
  const walls        = _getCollection(state, 'walls')
  const rooms        = _getCollection(state, 'rooms')
  const stamps       = _getCollection(state, 'stamps')
  const columns      = _getCollection(state, 'columns')
  const beams        = _getCollection(state, 'beams')
  const slabs        = _getCollection(state, 'slabs')
  const staircases   = _getCollection(state, 'staircases')
  const foundations  = _getCollection(state, 'foundations')
  const plumbingFixtures = _getCollection(state, 'plumbingFixtures')
  const electricalPoints = _getCollection(state, 'electricalPoints')
  const hvacUnits        = _getCollection(state, 'hvacUnits')
  const fireDevices      = _getCollection(state, 'fireDevices')
  const elvDevices       = _getCollection(state, 'elvDevices')
  const solarEquipment   = _getCollection(state, 'solarEquipment')
  const risers           = _getCollection(state, 'risers')
  const floorIds = _floorIds(state)

  // ── 1. Wall n1 / n2 reference nodes ──────────────────────────────────────
  for (const w of Object.values(walls)) {
    if (!nodes[w.n1]) {
      _push(issues, { kind: 'broken-ref', entityType: 'wall', entityId: w.id, field: 'n1', missing: w.n1,
                      message: `wall ${w.id} n1 → node ${w.n1} not found` })
    }
    if (!nodes[w.n2]) {
      _push(issues, { kind: 'broken-ref', entityType: 'wall', entityId: w.id, field: 'n2', missing: w.n2,
                      message: `wall ${w.id} n2 → node ${w.n2} not found` })
    }
    if (w.floorId && floorIds.size > 0 && !floorIds.has(w.floorId)) {
      _push(issues, { kind: 'broken-ref', entityType: 'wall', entityId: w.id, field: 'floorId', missing: w.floorId,
                      message: `wall ${w.id} floorId → ${w.floorId} not in projectSettings.floors` })
    }
  }

  // ── 2. Room wallIds reference walls ──────────────────────────────────────
  for (const r of Object.values(rooms)) {
    for (const wid of (r.wallIds ?? [])) {
      if (!walls[wid]) {
        _push(issues, { kind: 'broken-ref', entityType: 'room', entityId: r.id, field: 'wallIds', missing: wid,
                        message: `room ${r.id} wallIds → wall ${wid} not found` })
      }
    }
    if (r.floorId && floorIds.size > 0 && !floorIds.has(r.floorId)) {
      _push(issues, { kind: 'broken-ref', entityType: 'room', entityId: r.id, field: 'floorId', missing: r.floorId,
                      message: `room ${r.id} floorId → ${r.floorId} not in projectSettings.floors` })
    }
  }

  // ── 3. Stamp.floorId → floors ────────────────────────────────────────────
  for (const s of Object.values(stamps)) {
    if (s.floorId && floorIds.size > 0 && !floorIds.has(s.floorId)) {
      _push(issues, { kind: 'broken-ref', entityType: 'stamp', entityId: s.id, field: 'floorId', missing: s.floorId,
                      message: `stamp ${s.id} floorId → ${s.floorId} not in projectSettings.floors` })
    }
  }

  // ── 4. Column attachedNodeId + base/top floor refs ───────────────────────
  for (const c of Object.values(columns)) {
    if (c.attachedNodeId !== null && c.attachedNodeId !== undefined && !nodes[c.attachedNodeId]) {
      _push(issues, { kind: 'broken-ref', entityType: 'column', entityId: c.id, field: 'attachedNodeId', missing: c.attachedNodeId,
                      message: `column ${c.id} attachedNodeId → node ${c.attachedNodeId} not found` })
    }
    if (c.baseFloorId && floorIds.size > 0 && !floorIds.has(c.baseFloorId)) {
      _push(issues, { kind: 'broken-ref', entityType: 'column', entityId: c.id, field: 'baseFloorId', missing: c.baseFloorId,
                      message: `column ${c.id} baseFloorId → ${c.baseFloorId} not in projectSettings.floors` })
    }
    if (c.topFloorId && floorIds.size > 0 && !floorIds.has(c.topFloorId)) {
      _push(issues, { kind: 'broken-ref', entityType: 'column', entityId: c.id, field: 'topFloorId', missing: c.topFloorId,
                      message: `column ${c.id} topFloorId → ${c.topFloorId} not in projectSettings.floors` })
    }
  }

  // ── 5. Beam endpoints reference columns (POINT endpoints exempt) ─────────
  for (const b of Object.values(beams)) {
    for (const which of ['from', 'to']) {
      const ep = b.endpoints?.[which]
      if (!ep) {
        _push(issues, { kind: 'broken-ref', entityType: 'beam', entityId: b.id, field: `endpoints.${which}`, missing: null,
                        message: `beam ${b.id} missing endpoints.${which}` })
        continue
      }
      if (ep.type === 'COLUMN' && !columns[ep.columnId]) {
        _push(issues, { kind: 'broken-ref', entityType: 'beam', entityId: b.id, field: `endpoints.${which}.columnId`, missing: ep.columnId,
                        message: `beam ${b.id} endpoints.${which}.columnId → column ${ep.columnId} not found` })
      }
    }
    if (b.floorId && floorIds.size > 0 && !floorIds.has(b.floorId)) {
      _push(issues, { kind: 'broken-ref', entityType: 'beam', entityId: b.id, field: 'floorId', missing: b.floorId,
                      message: `beam ${b.id} floorId → ${b.floorId} not in projectSettings.floors` })
    }
  }

  // ── 6. Slab roomIds reference rooms ──────────────────────────────────────
  for (const s of Object.values(slabs)) {
    for (const rid of (s.roomIds ?? [])) {
      if (!rooms[rid]) {
        _push(issues, { kind: 'broken-ref', entityType: 'slab', entityId: s.id, field: 'roomIds', missing: rid,
                        message: `slab ${s.id} roomIds → room ${rid} not found` })
      }
    }
    if (s.floorId && floorIds.size > 0 && !floorIds.has(s.floorId)) {
      _push(issues, { kind: 'broken-ref', entityType: 'slab', entityId: s.id, field: 'floorId', missing: s.floorId,
                      message: `slab ${s.id} floorId → ${s.floorId} not in projectSettings.floors` })
    }
  }

  // ── 7. Staircase floor refs ──────────────────────────────────────────────
  for (const sc of Object.values(staircases)) {
    for (const f of ['fromFloorId', 'toFloorId', 'floorId']) {
      const v = sc[f]
      if (v && floorIds.size > 0 && !floorIds.has(v)) {
        _push(issues, { kind: 'broken-ref', entityType: 'staircase', entityId: sc.id, field: f, missing: v,
                        message: `staircase ${sc.id} ${f} → ${v} not in projectSettings.floors` })
      }
    }
  }

  // ── 8. Foundation columnIds + wallIds + floorId ──────────────────────────
  for (const f of Object.values(foundations)) {
    for (const cid of (f.columnIds ?? [])) {
      if (!columns[cid]) {
        _push(issues, { kind: 'broken-ref', entityType: 'foundation', entityId: f.id, field: 'columnIds', missing: cid,
                        message: `foundation ${f.id} columnIds → column ${cid} not found` })
      }
    }
    for (const wid of (f.wallIds ?? [])) {
      if (!walls[wid]) {
        _push(issues, { kind: 'broken-ref', entityType: 'foundation', entityId: f.id, field: 'wallIds', missing: wid,
                        message: `foundation ${f.id} wallIds → wall ${wid} not found` })
      }
    }
    if (f.floorId && floorIds.size > 0 && !floorIds.has(f.floorId)) {
      _push(issues, { kind: 'broken-ref', entityType: 'foundation', entityId: f.id, field: 'floorId', missing: f.floorId,
                      message: `foundation ${f.id} floorId → ${f.floorId} not in projectSettings.floors` })
    }
  }

  // ── 9. MEP entities — roomId / wallId / floorId refs ─────────────────────
  const mepCollections = [
    ['plumbingFixture', plumbingFixtures],
    ['electricalPoint', electricalPoints],
    ['hvacUnit',        hvacUnits],
    ['fireDevice',      fireDevices],
    ['elvDevice',       elvDevices],
    ['solarEquipment',  solarEquipment],
  ]
  for (const [type, coll] of mepCollections) {
    for (const e of Object.values(coll)) {
      if (e.wallId && !walls[e.wallId]) {
        _push(issues, { kind: 'broken-ref', entityType: type, entityId: e.id, field: 'wallId', missing: e.wallId,
                        message: `${type} ${e.id} wallId → wall ${e.wallId} not found` })
      }
      if (e.roomId && !rooms[e.roomId]) {
        _push(issues, { kind: 'broken-ref', entityType: type, entityId: e.id, field: 'roomId', missing: e.roomId,
                        message: `${type} ${e.id} roomId → room ${e.roomId} not found` })
      }
      if (e.floorId && floorIds.size > 0 && !floorIds.has(e.floorId)) {
        _push(issues, { kind: 'broken-ref', entityType: type, entityId: e.id, field: 'floorId', missing: e.floorId,
                        message: `${type} ${e.id} floorId → ${e.floorId} not in projectSettings.floors` })
      }
    }
  }

  // ── 10. Riser floor refs ─────────────────────────────────────────────────
  for (const r of Object.values(risers)) {
    if (r.fromFloorId && floorIds.size > 0 && !floorIds.has(r.fromFloorId)) {
      _push(issues, { kind: 'broken-ref', entityType: 'riser', entityId: r.id, field: 'fromFloorId', missing: r.fromFloorId,
                      message: `riser ${r.id} fromFloorId → ${r.fromFloorId} not found` })
    }
    if (r.toFloorId && floorIds.size > 0 && !floorIds.has(r.toFloorId)) {
      _push(issues, { kind: 'broken-ref', entityType: 'riser', entityId: r.id, field: 'toFloorId', missing: r.toFloorId,
                      message: `riser ${r.id} toFloorId → ${r.toFloorId} not found` })
    }
  }

  // Deterministic ordering for byte-stable verify output.
  issues.sort((a, b) => {
    if (a.entityType !== b.entityType) return a.entityType.localeCompare(b.entityType)
    if ((a.entityId ?? '') !== (b.entityId ?? '')) return (a.entityId ?? '').localeCompare(b.entityId ?? '')
    return (a.field ?? '').localeCompare(b.field ?? '')
  })

  return {
    valid: issues.length === 0,
    issues,
    count: issues.length,
  }
}

// Convenience for verify scripts: throws if integrity fails.
export function assertIntegrity(state, contextLabel = '') {
  const result = verifyIntegrity(state)
  if (!result.valid) {
    const summary = result.issues.slice(0, 10).map(i => `  - ${i.message}`).join('\n')
    throw new Error(
      `Integrity check failed${contextLabel ? ` (${contextLabel})` : ''}: ${result.count} issue(s)\n` +
      summary +
      (result.issues.length > 10 ? `\n  ... and ${result.issues.length - 10} more` : '')
    )
  }
}
