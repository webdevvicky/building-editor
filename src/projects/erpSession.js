// erpSession.js — activate live ERP sync from an erpLaunchContext.
//
// Boot order (main.jsx):
//   1. parse + strip the #erpLaunch hash      (erpLaunchContext)
//   2. bootPersistence                         (IDB; current-project skipped in ERP mode)
//   3. initErpSession  → initLiveSync          (THIS FILE — activates _liveMode)
//   4. initErpSession  → hydrateFromErp        (THIS FILE — populates the id-map)
//   5. render <App/>
//
// initLiveSync needs a `conn` carrying { buildingId, floorIds, erpUrl, getToken }.
// The geometry REST calls in liveSync.js key on:
//   - c.buildingId            → POST /geometry/buildings/:buildingId/{nodes,elements}
//   - c.floorIds[editorKey]   → POST /geometry/floors/:floorId/rooms   (ADD_ROOM)
//   - c.erpUrl + c.getToken() → request base URL + Bearer auth
//
// We deliberately DON'T pass resolveErpId/registerErpId — liveSync.js falls back
// to its own internal _idMap, which hydrateFromErp populates. One id-map, one
// source of truth.

import { getErpLaunchContext } from './erpLaunchContext.js'
import { initLiveSync, hydrateFromErp, getLiveMode } from './liveSync.js'
import { initLiveSyncQueue, setResyncBuilder } from './liveSyncQueue.js'
import { startSyncEngine } from './syncEngine.js'
import { buildFullSyncOps } from './syncEmitters.js'
import { initCanonicalSyncQueue, installCanonicalAutosave } from './canonicalSyncQueue.js'
import { reopenCanvas } from './canonicalReopen.js'
import { DEFAULT_FLOOR_ID } from '../structuralSlice.js'
import { useStore } from '../store.js'

// ─── ERP REST helpers ───────────────────────────────────────────────────────

async function _erpFetch(erpUrl, token, method, path, body) {
  const url = `${erpUrl.replace(/\/$/, '')}/api/v1${path}`
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`[erpSession] ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

// The ERP ResponseInterceptor wraps payloads as { success, data, meta, error }.
function _unwrap(envelope) {
  return envelope && envelope.data !== undefined ? envelope.data : envelope
}

// Editor floor key for an ERP BuildingFloor row. Prefer the round-tripped
// sourceEditorId (set when the editor created the floor); else derive 'F{n}'
// from floorNumber (ground floorNumber 0 → editor 'F1').
function _floorKey(floor) {
  if (floor && floor.sourceEditorId) return floor.sourceEditorId
  const n = Number.isFinite(floor?.floorNumber) ? floor.floorNumber : 0
  return `F${n + 1}`
}

/**
 * Build the { editorFloorKey: erpFloorId } map the live ADD_ROOM op needs.
 * A freshly-created building has no floors yet — create the editor's default
 * floor (sourceEditorId = 'F1' so the mapping is stable on the next launch) so
 * the first room the user draws has a floor to attach to.
 *
 * @returns {Promise<{ floorIds: Record<string,string>, isNewBuilding: boolean }>}
 */
async function _buildFloorIdsMap({ erpUrl, token, buildingId }) {
  const env = await _erpFetch(
    erpUrl, token, 'GET',
    `/building-structure/buildings/${buildingId}/floors`,
  )
  const floors = _unwrap(env)
  if (Array.isArray(floors) && floors.length > 0) {
    const map = {}
    for (const f of floors) map[_floorKey(f)] = f.id
    return { floorIds: map, isNewBuilding: false }
  }
  // New building — create F1. floorHeight is REQUIRED: the geometry createFloor
  // service writes `floorHeight: dto.floorHeight ?? null`, but the column is
  // non-nullable (Decimal @default(10)), so omitting it makes Prisma reject the
  // create with a null-value error. Send the editor's default 10 ft.
  const created = _unwrap(await _erpFetch(
    erpUrl, token, 'POST',
    `/geometry/buildings/${buildingId}/floors`,
    { floorNumber: 1, sourceEditorId: DEFAULT_FLOOR_ID, floorHeight: 10 },
  ))
  return { floorIds: { [DEFAULT_FLOOR_ID]: created.id }, isNewBuilding: true }
}

/**
 * Activate live ERP sync. No-op (returns false) when not in ERP-launch mode.
 * Throws are caught by the caller (main.jsx) so a failed init never blocks the
 * editor from rendering.
 *
 * @returns {Promise<boolean>} true when live sync was activated.
 */
export async function initErpSession() {
  const ctx = getErpLaunchContext()
  // SECURITY: sanitized — never log the token.
  console.log('[ERP] initErpSession called', ctx
    ? { buildingId: ctx.buildingId, erpUrl: ctx.erpUrl, hasToken: !!ctx.token }
    : null)
  if (!ctx) return false

  const { floorIds, isNewBuilding } = await _buildFloorIdsMap(ctx)

  const conn = {
    buildingId: ctx.buildingId,
    floorIds,
    erpUrl: ctx.erpUrl,
    getToken: () => Promise.resolve(ctx.token),
  }
  console.log('[ERP] calling initLiveSync with conn:', conn)
  initLiveSync(conn)
  console.log('[ERP] liveMode after init:', getLiveMode())

  // Durable outbox queue (FIFO worker, retry/backoff, IDB persistence). Must be
  // active before the engine emits anything.
  await initLiveSyncQueue(ctx.buildingId)
  setResyncBuilder(() => buildFullSyncOps(useStore.getState()))

  // Phase 2 — REOPEN from the canonical Building Document (R2 → IDB → empty),
  // integrity-gated, with the id-map seeded in every path. PostgreSQL
  // reconstruction is reached ONLY via the temporary dev rollback flag
  // (reopen=reconstruct), removed in Phase 3. A brand-new building has nothing to
  // load — start on a blank canvas.
  let reopenVersion = null
  if (!isNewBuilding) {
    const loadProject = useStore.getState().loadProject
    if (ctx.reopen === 'reconstruct') {
      // Temporary dev rollback: legacy lossy PG reconstruction.
      await hydrateFromErp(conn, loadProject).catch((err) => {
        console.warn('[erpSession] hydrateFromErp (dev rollback) failed', err)
      })
    } else {
      const res = await reopenCanvas(conn, ctx.buildingId, loadProject).catch((err) => {
        console.warn('[erpSession] reopenCanvas failed', err)
        return null
      })
      reopenVersion = res?.snapshotVersion ?? null
      console.log('[erpSession] reopen source', res?.source ?? 'unknown')
    }
  }

  // The ONE wiring point: subscribe to the store and emit ordered ops on every
  // committed geometry change. Started AFTER reconstruction so its shadow is
  // seeded with the loaded geometry — the reconstruction itself emits NOTHING.
  startSyncEngine(useStore)

  // Continue WRITING the canonical Building Document (R2-backed): the durable
  // upload outbox + the ERP-mode autosave that persists the model to IDB and
  // enqueues an upload on every committed change. The reopen above already
  // fetched the canonical version, so pass it as knownBaseVersion (no extra GET).
  // Failures are swallowed so a canonical sync hiccup never blocks the editor.
  // This path NEVER touches liveSyncQueue or the PG projection.
  try {
    await initCanonicalSyncQueue(conn, ctx.buildingId, { knownBaseVersion: reopenVersion })
    installCanonicalAutosave(useStore, ctx.buildingId)
  } catch (err) {
    console.warn('[erpSession] canonical document sync init failed', err)
  }

  // Editor name reflects the ERP project + building (not a local IDB name).
  // Done AFTER loadProject so it isn't overwritten; projectSettings isn't a
  // synced collection, so this emits nothing. Non-fatal on failure.
  try {
    const b = _unwrap(await _erpFetch(
      ctx.erpUrl, ctx.token, 'GET', `/building-structure/buildings/${ctx.buildingId}`,
    ))
    const label = [b?.project?.name, b?.name].filter(Boolean).join(' — ')
    if (label) {
      useStore.getState().setProjectSettings({ name: label })
      if (typeof document !== 'undefined') document.title = label
    }
  } catch (err) {
    console.warn('[erpSession] project name fetch failed', err)
  }
  return true
}
