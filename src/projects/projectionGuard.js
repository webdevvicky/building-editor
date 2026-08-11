// projectionGuard.js — detects editor-canvas vs ERP-projection divergence.
//
// After a connected reopen, the guard compares what the canvas loaded against
// what the ERP projection holds. When the projection has geometry the canvas
// lacks (canonical document missing or stale — e.g. seed-born buildings, a
// lost R2 object), a persistent top banner warns the user and offers
// "Load from ERP": an EXPLICIT, user-consented reconstruction of the canvas
// from the projection (projectionReconstruct.js). The canonical document is
// then re-authored by the editor itself through the normal pipeline on the
// next committed change — the server never synthesizes canonical content.

import { fetchBuildingState } from './liveSync.js'
import { reconstructFromProjection, projectionCounts } from './projectionReconstruct.js'

let _state = null // { projRooms, projWalls, canvasRooms, canvasWalls } | null
let _conn = null
let _projection = null
const _listeners = new Set()

const emit = () => { for (const l of _listeners) l() }

export function subscribeProjectionMismatch(listener) {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

export function projectionMismatch() {
  return _state
}

/**
 * Compare the loaded canvas against the ERP projection; engage the banner on
 * divergence. Non-fatal on fetch failure (never blocks the editor).
 */
export async function checkProjectionMismatch(conn, getCanvasCounts) {
  try {
    const state = await fetchBuildingState(conn)
    const proj = projectionCounts(state)
    const canvas = getCanvasCounts()
    if (proj.rooms > canvas.rooms || proj.walls > canvas.walls) {
      _conn = conn
      _projection = state
      _state = {
        projRooms: proj.rooms,
        projWalls: proj.walls,
        canvasRooms: canvas.rooms,
        canvasWalls: canvas.walls,
      }
      emit()
    }
  } catch (err) {
    console.warn('[projectionGuard] projection check failed', err)
  }
}

/** The banner's "Load from ERP" action. Returns the reconstruction summary. */
export async function loadFromErp(loadProject) {
  // Refresh the state so the rebuild reflects the newest projection.
  const state = _conn ? await fetchBuildingState(_conn).catch(() => _projection) : _projection
  const { payload, counts, skipped } = reconstructFromProjection(state ?? {})
  loadProject(payload)
  dismissProjectionMismatch()
  return { counts, skipped }
}

export function dismissProjectionMismatch() {
  _state = null
  _projection = null
  emit()
}
