// Phase W — central wall-split propagation logic.
//
// planWallSplit(state, wallId, x, y) returns a complete propagation plan
// describing exactly what changes when wallId is split at world (x, y):
//   - openings partitioned by offset
//   - junctions partitioned by parametric t
//   - MEP fixtures (5 disciplines) partitioned + rebased by wallT
//   - foundation.wallIds[] propagation
//   - room.wallIds[] propagation
//
// The store action (splitWall) applies the plan inside one
// _runAtomically frame.
//
// REFUSAL CASES
//   - 'wall-not-found' | 'wall-endpoints-missing' | 'invalid-offset'
//   - 'split-too-close-to-endpoint': split within SNAP_IN of n1 or n2
//   - 'opening-straddles-split': an opening's range overlaps the split point
//   - 'junction-near-split': an existing junction is within SNAP_IN of split offset
//
// PURITY
//   Pure & Node-testable. No React, no DOM, no Zustand dispatches.

import { SNAP_IN } from '../geometry.js'

// Project click (x, y) onto wall's centerline.
function _projectOntoWall(n1, n2, x, y) {
  const dx = n2.x - n1.x, dy = n2.y - n1.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return null
  let t = ((x - n1.x) * dx + (y - n1.y) * dy) / len2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const wallLenIn = Math.sqrt(len2)
  return {
    t,
    offsetIn:    t * wallLenIn,
    wallLenIn,
    splitX:      n1.x + dx * t,
    splitY:      n1.y + dy * t,
  }
}

// Partition openings by their CENTER position relative to splitOffset.
// Returns { w1Openings, w2Openings } where w2's offsets are rebased.
// Refuses if any opening's range straddles the split point.
function _partitionOpenings(openings, splitOffsetIn) {
  const w1 = [], w2 = []
  for (const op of openings) {
    const offset = op.offset ?? 0
    const width  = op.width ?? 0
    // Opening occupies [offset, offset + width].
    if (offset + width <= splitOffsetIn) {
      // Entirely on n1-side.
      w1.push({ ...op })
    } else if (offset >= splitOffsetIn) {
      // Entirely on n2-side; rebase offset.
      w2.push({ ...op, offset: offset - splitOffsetIn })
    } else {
      // Straddles.
      return { straddle: true, opening: op }
    }
  }
  return { w1Openings: w1, w2Openings: w2 }
}

// Partition junctions on the wall by parametric t.
// Returns { w1, w2 } where each is an array of node ids.
// Refuses if any junction is within SNAP_IN (in inches along the wall) of splitT.
function _partitionJunctions(state, wall, n1, n2, splitT, wallLenIn) {
  const w1 = [], w2 = []
  const dx = n2.x - n1.x, dy = n2.y - n1.y
  const len2 = dx * dx + dy * dy
  for (const jId of (wall.junctions ?? [])) {
    const j = state.nodes?.[jId]
    if (!j) continue
    const t = len2 > 0
      ? ((j.x - n1.x) * dx + (j.y - n1.y) * dy) / len2
      : 0
    const distAlongWall = Math.abs(t - splitT) * wallLenIn
    if (distAlongWall < SNAP_IN) {
      return { straddle: true, junctionId: jId }
    }
    if (t < splitT) w1.push({ nodeId: jId, t })
    else            w2.push({ nodeId: jId, t })
  }
  return { w1Junctions: w1, w2Junctions: w2 }
}

// Partition MEP fixtures of a single collection by wallT.
// Returns { w1: [{ fixtureId, newWallT }], w2: [...] }.
function _partitionFixtures(collection, wallId, splitT) {
  const w1 = [], w2 = []
  for (const f of Object.values(collection ?? {})) {
    if (f.wallId !== wallId) continue
    const t = f.wallT ?? 0
    if (t < splitT) {
      // Rebase: w1 covers [0, splitT] of the original; new t = t / splitT
      const newT = splitT > 0 ? t / splitT : 0
      w1.push({ fixtureId: f.id, newWallT: Math.max(0, Math.min(1, newT)) })
    } else {
      // w2 covers [splitT, 1]; new t = (t - splitT) / (1 - splitT)
      const newT = splitT < 1 ? (t - splitT) / (1 - splitT) : 0
      w2.push({ fixtureId: f.id, newWallT: Math.max(0, Math.min(1, newT)) })
    }
  }
  return { w1, w2 }
}

/**
 * Plan the propagation for splitting wallId at world (x, y).
 * Pure: does not mutate state. Returns either { ok: true, ...plan } or
 * { ok: false, reason }.
 */
export function planWallSplit(state, wallId, x, y) {
  const wall = state.walls?.[wallId]
  if (!wall) return { ok: false, reason: 'wall-not-found' }
  const n1 = state.nodes?.[wall.n1]
  const n2 = state.nodes?.[wall.n2]
  if (!n1 || !n2) return { ok: false, reason: 'wall-endpoints-missing' }

  const proj = _projectOntoWall(n1, n2, x, y)
  if (!proj) return { ok: false, reason: 'invalid-offset' }
  const { t: splitT, offsetIn: splitOffsetIn, wallLenIn, splitX, splitY } = proj

  // Refusal: too close to endpoints.
  if (splitOffsetIn < SNAP_IN || splitOffsetIn > wallLenIn - SNAP_IN) {
    return { ok: false, reason: 'split-too-close-to-endpoint',
             offsetIn: splitOffsetIn, wallLenIn }
  }

  // Refusal: opening straddles.
  const openingResult = _partitionOpenings(wall.openings ?? [], splitOffsetIn)
  if (openingResult.straddle) {
    return { ok: false, reason: 'opening-straddles-split',
             opening: openingResult.opening }
  }

  // Refusal: junction near split.
  const junctionResult = _partitionJunctions(state, wall, n1, n2, splitT, wallLenIn)
  if (junctionResult.straddle) {
    return { ok: false, reason: 'junction-near-split',
             junctionId: junctionResult.junctionId }
  }

  // Partition MEP fixtures across 5 disciplines.
  const mepPartition = {
    plumbingFixtures: _partitionFixtures(state.plumbingFixtures, wallId, splitT),
    electricalPoints: _partitionFixtures(state.electricalPoints, wallId, splitT),
    hvacUnits:        _partitionFixtures(state.hvacUnits,        wallId, splitT),
    fireDevices:      _partitionFixtures(state.fireDevices,      wallId, splitT),
    elvDevices:       _partitionFixtures(state.elvDevices,       wallId, splitT),
  }

  // Foundations referencing this wallId — each needs idx-replacement
  // of wallId with [w1Id, w2Id]. Collect for the store action.
  const foundationsAffected = []
  for (const f of Object.values(state.foundations ?? {})) {
    if ((f.wallIds ?? []).includes(wallId)) {
      foundationsAffected.push(f.id)
    }
  }

  // Rooms referencing this wallId — same idx-replacement.
  const roomsAffected = []
  for (const r of Object.values(state.rooms ?? {})) {
    if ((r.wallIds ?? []).includes(wallId)) {
      roomsAffected.push(r.id)
    }
  }

  return {
    ok: true,
    splitOffsetIn,
    splitT,
    wallLenIn,
    splitWorld: { x: splitX, y: splitY },
    floorId:    wall.floorId,
    w1Openings:  openingResult.w1Openings,
    w2Openings:  openingResult.w2Openings,
    w1Junctions: junctionResult.w1Junctions,
    w2Junctions: junctionResult.w2Junctions,
    mep:         mepPartition,
    foundationsAffected,
    roomsAffected,
  }
}
