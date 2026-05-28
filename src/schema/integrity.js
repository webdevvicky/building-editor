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

  // ── Phase W — INV-W1 through INV-W10 ──────────────────────────────────
  //
  // INV-W1: A wall's n1 and n2 are CORNER-kind nodes (not TJUNCTION).
  // INV-W2: A TJUNCTION node's onWallId references a wall whose
  //         junctions[] contains this node id (two-way reference).
  // INV-W3: A TJUNCTION node lies on its parent wall's centerline
  //         within SNAP_IN perpendicular tolerance.
  // INV-W7: room.wallIds contains deduplicated wallIds (no duplicates).
  // INV-W8: room.nodeOrder forms a closed loop (length >= 3,
  //         distinct nodes, adjacency in the expanded wall graph).
  //         Light check: nodeOrder is array of valid node ids.
  // INV-W9: wall.splitOrigin is one of {'NONE', 'USER_SPLIT'}.
  // INV-W10: Junctions on a wall are mutually ≥ SNAP_IN apart along
  //          the wall (no zero-length segments).
  //
  // INV-W4, W5, W6 are existing FK/range checks already enforced above
  // (opening offsets in range, MEP wallT validity via verifyOpenings,
  // foundation wallIds existence).

  const SNAP_IN_W = 4
  for (const w of Object.values(walls)) {
    // INV-W1 (refined): a wall MAY end at a TJUNCTION node (this is
    // exactly what "wall A T-junctions onto wall B" looks like — A's
    // endpoint is a TJUNCTION node on B). The actual invariant is that
    // a wall cannot T-junction onto ITSELF: its n1/n2 must not appear
    // in its own junctions[] list. (junctions[] is the set of nodes
    // attached MID-SPAN to this wall.)
    const n1 = nodes[w.n1], n2 = nodes[w.n2]
    const junctionSet = new Set(w.junctions ?? [])
    if (junctionSet.has(w.n1)) {
      _push(issues, { kind: 'inv-w1', entityType: 'wall', entityId: w.id, field: 'n1', missing: null,
                      message: `INV-W1: wall ${w.id} n1=${w.n1} also appears in this wall's junctions[]` })
    }
    if (junctionSet.has(w.n2)) {
      _push(issues, { kind: 'inv-w1', entityType: 'wall', entityId: w.id, field: 'n2', missing: null,
                      message: `INV-W1: wall ${w.id} n2=${w.n2} also appears in this wall's junctions[]` })
    }

    // INV-W9: splitOrigin one of {'NONE', 'USER_SPLIT'}.
    const so = w.splitOrigin
    if (so != null && so !== 'NONE' && so !== 'USER_SPLIT') {
      _push(issues, { kind: 'inv-w9', entityType: 'wall', entityId: w.id, field: 'splitOrigin', missing: null,
                      message: `INV-W9: wall ${w.id} splitOrigin '${so}' must be 'NONE' or 'USER_SPLIT'` })
    }

    // INV-W2 + INV-W10: junctions ↔ TJUNCTION node consistency + spacing.
    const junctionIds = w.junctions ?? []
    if (junctionIds.length > 0 && n1 && n2) {
      // INV-W2: each junction id must reference a TJUNCTION node whose
      // onWallId === w.id.
      for (const jId of junctionIds) {
        const j = nodes[jId]
        if (!j) {
          _push(issues, { kind: 'inv-w2', entityType: 'wall', entityId: w.id, field: 'junctions', missing: jId,
                          message: `INV-W2: wall ${w.id} junctions[] references missing node ${jId}` })
          continue
        }
        if ((j.kind ?? 'CORNER') !== 'TJUNCTION') {
          _push(issues, { kind: 'inv-w2', entityType: 'wall', entityId: w.id, field: 'junctions', missing: jId,
                          message: `INV-W2: wall ${w.id} junctions[] contains non-TJUNCTION node ${jId}` })
        }
        if (j.onWallId !== w.id) {
          _push(issues, { kind: 'inv-w2', entityType: 'wall', entityId: w.id, field: 'junctions', missing: jId,
                          message: `INV-W2: wall ${w.id} junctions[] contains node ${jId} whose onWallId='${j.onWallId}' (mismatch)` })
        }

        // INV-W3: junction must lie on the wall's centerline within SNAP_IN.
        const dx = n2.x - n1.x, dy = n2.y - n1.y
        const len2 = dx * dx + dy * dy
        if (len2 > 0) {
          let t = ((j.x - n1.x) * dx + (j.y - n1.y) * dy) / len2
          if (t < 0) t = 0
          else if (t > 1) t = 1
          const projX = n1.x + t * dx
          const projY = n1.y + t * dy
          const perpDist = Math.hypot(j.x - projX, j.y - projY)
          if (perpDist > SNAP_IN_W) {
            _push(issues, { kind: 'inv-w3', entityType: 'wall', entityId: w.id, field: 'junctions', missing: jId,
                            message: `INV-W3: junction ${jId} is ${perpDist.toFixed(2)}in off wall ${w.id}'s centerline (> SNAP_IN)` })
          }
        }
      }

      // INV-W10: junctions monotonic + ≥ SNAP_IN apart.
      // Order by t-projection.
      const dx = n2.x - n1.x, dy = n2.y - n1.y
      const len = Math.hypot(dx, dy)
      const len2 = dx * dx + dy * dy
      if (len2 > 0) {
        const tEntries = []
        for (const jId of junctionIds) {
          const j = nodes[jId]
          if (!j) continue
          const t = ((j.x - n1.x) * dx + (j.y - n1.y) * dy) / len2
          tEntries.push({ nodeId: jId, t })
        }
        tEntries.sort((a, b) => a.t - b.t)
        let prevT = 0
        for (const e of tEntries) {
          const segmentLenIn = (e.t - prevT) * len
          if (segmentLenIn < SNAP_IN_W) {
            _push(issues, { kind: 'inv-w10', entityType: 'wall', entityId: w.id, field: 'junctions', missing: e.nodeId,
                            message: `INV-W10: wall ${w.id} segment ending at junction ${e.nodeId} is ${segmentLenIn.toFixed(2)}in (< SNAP_IN)` })
          }
          prevT = e.t
        }
        const finalSeg = (1 - prevT) * len
        if (finalSeg < SNAP_IN_W) {
          _push(issues, { kind: 'inv-w10', entityType: 'wall', entityId: w.id, field: 'junctions', missing: null,
                          message: `INV-W10: wall ${w.id} final segment (to n2) is ${finalSeg.toFixed(2)}in (< SNAP_IN)` })
        }
      }
    }
  }

  // INV-W2 reverse direction: every TJUNCTION node's onWallId must point
  // to a wall whose junctions[] contains this node.
  for (const n of Object.values(nodes)) {
    if ((n.kind ?? 'CORNER') !== 'TJUNCTION') continue
    const parentWallId = n.onWallId
    if (!parentWallId) {
      _push(issues, { kind: 'inv-w2', entityType: 'node', entityId: n.id, field: 'onWallId', missing: null,
                      message: `INV-W2: TJUNCTION node ${n.id} has null onWallId` })
      continue
    }
    const parent = walls[parentWallId]
    if (!parent) {
      _push(issues, { kind: 'inv-w2', entityType: 'node', entityId: n.id, field: 'onWallId', missing: parentWallId,
                      message: `INV-W2: TJUNCTION node ${n.id} onWallId → ${parentWallId} not found` })
      continue
    }
    if (!((parent.junctions ?? []).includes(n.id))) {
      _push(issues, { kind: 'inv-w2', entityType: 'node', entityId: n.id, field: 'onWallId', missing: parentWallId,
                      message: `INV-W2: TJUNCTION node ${n.id} bound to wall ${parentWallId}, but wall.junctions[] does not contain it` })
    }
  }

  // INV-W7: room.wallIds deduplicated (no duplicates).
  for (const r of Object.values(rooms)) {
    const wIds = r.wallIds ?? []
    const uniq = new Set(wIds)
    if (uniq.size !== wIds.length) {
      _push(issues, { kind: 'inv-w7', entityType: 'room', entityId: r.id, field: 'wallIds', missing: null,
                      message: `INV-W7: room ${r.id} wallIds contains duplicates (length=${wIds.length}, unique=${uniq.size})` })
    }
  }

  // INV-W8: room.nodeOrder forms a closed loop. Light check:
  // length ≥ 3, all entries are valid node ids, no duplicates in the loop.
  for (const r of Object.values(rooms)) {
    const nOrder = r.nodeOrder ?? []
    if (nOrder.length > 0 && nOrder.length < 3) {
      _push(issues, { kind: 'inv-w8', entityType: 'room', entityId: r.id, field: 'nodeOrder', missing: null,
                      message: `INV-W8: room ${r.id} nodeOrder has ${nOrder.length} entries (need ≥3 or 0)` })
    }
    const seen = new Set()
    for (const nid of nOrder) {
      if (!nodes[nid]) {
        _push(issues, { kind: 'inv-w8', entityType: 'room', entityId: r.id, field: 'nodeOrder', missing: nid,
                        message: `INV-W8: room ${r.id} nodeOrder references missing node ${nid}` })
      }
      if (seen.has(nid)) {
        _push(issues, { kind: 'inv-w8', entityType: 'room', entityId: r.id, field: 'nodeOrder', missing: nid,
                        message: `INV-W8: room ${r.id} nodeOrder contains duplicate node ${nid}` })
      }
      seen.add(nid)
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

// ── FK_DESCRIPTORS — single FK authority (Correction 8) ───────────────────
//
// Declarative description of every cross-entity reference checked above.
// Consumed by the template rewriter (src/projects/templates.js) to remap
// IDs when cloning a project. The contract: ANY new FK added to the
// inline verifier walk above MUST also appear here. Verify-templates
// enforces sync by cloning a fixture that exercises every descriptor
// and asserting verifyIntegrity passes after the rewrite — if the
// verifier added a check that the descriptor list lacks, the rewriter
// leaves a dangling reference and the assertion fires.
//
// Shape:
//   { collection, field, target, isArray?, gateField?, gateValue? }
//   - collection: top-level state key whose entities have the FK
//   - field:      dot-path to the FK value on an entity
//   - target:     'nodes' | 'walls' | 'rooms' | 'columns' | etc. (entity collection)
//                 OR 'floors' (refers to projectSettings.floors[].id)
//   - isArray:    true when field holds an array of FKs (room.wallIds, slab.roomIds, ...)
//   - gateField + gateValue: only follow the FK when entity[gateField] === gateValue
//                            (used for beam endpoints — only COLUMN endpoints carry an FK)
export const FK_DESCRIPTORS = Object.freeze([
  // Walls → nodes
  Object.freeze({ collection: 'walls', field: 'n1', target: 'nodes' }),
  Object.freeze({ collection: 'walls', field: 'n2', target: 'nodes' }),
  // Phase W — walls → T-junction nodes (array of nodeIds)
  Object.freeze({ collection: 'walls', field: 'junctions', target: 'nodes', isArray: true, optional: true }),
  // Phase W — TJUNCTION node → parent wall (optional; null for CORNER nodes)
  Object.freeze({ collection: 'nodes', field: 'onWallId', target: 'walls', optional: true }),
  // Rooms → walls
  Object.freeze({ collection: 'rooms', field: 'wallIds', target: 'walls', isArray: true }),
  // Phase W — rooms → nodes (closed polygon node sequence)
  Object.freeze({ collection: 'rooms', field: 'nodeOrder', target: 'nodes', isArray: true, optional: true }),
  // Columns → nodes
  Object.freeze({ collection: 'columns', field: 'attachedNodeId', target: 'nodes', optional: true }),
  // Beams → columns (only when endpoint.type === 'COLUMN')
  Object.freeze({ collection: 'beams', field: 'endpoints.from.columnId', target: 'columns',
                  optional: true, gateField: 'endpoints.from.type', gateValue: 'COLUMN' }),
  Object.freeze({ collection: 'beams', field: 'endpoints.to.columnId',   target: 'columns',
                  optional: true, gateField: 'endpoints.to.type',   gateValue: 'COLUMN' }),
  // Slabs → rooms
  Object.freeze({ collection: 'slabs', field: 'roomIds', target: 'rooms', isArray: true }),
  // Foundations → columns + walls
  Object.freeze({ collection: 'foundations', field: 'columnIds', target: 'columns', isArray: true }),
  Object.freeze({ collection: 'foundations', field: 'wallIds',   target: 'walls',   isArray: true }),
  // MEP — wallId + roomId on 6 collections
  ...[
    'plumbingFixtures', 'electricalPoints', 'hvacUnits',
    'fireDevices', 'elvDevices', 'solarEquipment',
  ].flatMap(coll => [
    Object.freeze({ collection: coll, field: 'wallId', target: 'walls', optional: true }),
    Object.freeze({ collection: coll, field: 'roomId', target: 'rooms', optional: true }),
  ]),
])

// Floor refs (target: projectSettings.floors[].id). Separate because the
// "collection" of floor IDs lives in projectSettings.floors[], not as a
// top-level entity map. Floors are NOT remapped during template cloning
// (floor IDs like 'F1' are project-internal and collision-free), but the
// rewriter walks this list to validate every reference resolves post-clone.
export const FLOOR_REF_DESCRIPTORS = Object.freeze([
  Object.freeze({ collection: 'nodes', field: 'floorIds', isArray: true }),
  Object.freeze({ collection: 'walls', field: 'floorId' }),
  Object.freeze({ collection: 'rooms', field: 'floorId' }),
  Object.freeze({ collection: 'stamps', field: 'floorId' }),
  Object.freeze({ collection: 'columns', field: 'baseFloorId' }),
  Object.freeze({ collection: 'columns', field: 'topFloorId' }),
  Object.freeze({ collection: 'beams', field: 'floorId' }),
  Object.freeze({ collection: 'slabs', field: 'floorId' }),
  Object.freeze({ collection: 'staircases', field: 'fromFloorId' }),
  Object.freeze({ collection: 'staircases', field: 'toFloorId' }),
  Object.freeze({ collection: 'staircases', field: 'floorId' }),
  Object.freeze({ collection: 'foundations', field: 'floorId' }),
  ...['plumbingFixtures', 'electricalPoints', 'hvacUnits',
      'fireDevices', 'elvDevices', 'solarEquipment'].map(coll =>
    Object.freeze({ collection: coll, field: 'floorId' })),
  Object.freeze({ collection: 'risers', field: 'fromFloorId' }),
  Object.freeze({ collection: 'risers', field: 'toFloorId' }),
])

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
