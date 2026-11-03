// writePipeline.js — start of the ONE ORDERED write pipeline (Invariants #5/#7).
// Init the canonical upload outbox first (baseVersion seed; failures swallowed so a
// sync hiccup never blocks the editor), then the sync engine in COORDINATED mode
// (it computes element signatures, so bar settings must already be applied) and the
// coordinator. A failure part-way resets everything it started.
import { deferWritePipeline } from './bbsSettingsSession.js'
import { initCanonicalSyncQueue, teardownCanonicalSyncQueue } from './canonicalSyncQueue.js'
import { startSyncEngine, stopSyncEngine } from './syncEngine.js'
import { initLiveSyncQueue, teardownLiveSyncQueue } from './liveSyncQueue.js'
import { startSyncCoordinator, stopSyncCoordinator, requestFullSync } from './syncCoordinator.js'

/**
 * @param {object} store zustand store
 * @param {object} conn  ERP connection
 * @param {string} buildingId
 * @param {{ knownBaseVersion: number|null, projectAll?: boolean }} opts
 *   projectAll: re-project every element once started (used when bar settings were
 *   adopted after the drawing was loaded, so the stored bars are the new ones).
 */
export async function startWritePipeline(store, conn, buildingId, { knownBaseVersion, projectAll = false }) {
  try {
    try {
      await initCanonicalSyncQueue(conn, buildingId, { knownBaseVersion, deferUpload: true })
    } catch (err) {
      console.warn('[writePipeline] canonical document sync init failed', err)
    }
    startSyncEngine(store, { coordinated: true })
    await initLiveSyncQueue(buildingId)
    startSyncCoordinator(store, buildingId)
    if (projectAll) requestFullSync()
  } catch (err) {
    stopSyncCoordinator()
    stopSyncEngine()
    teardownLiveSyncQueue()
    teardownCanonicalSyncQueue()
    throw err
  }
}

/**
 * The write pipeline computes bar-dependent signatures, so a reopened drawing with no
 * saved ERP settings waits for the explicit review; Apply resumes it.
 */
export async function beginWritePipeline(store, conn, buildingId, knownBaseVersion) {
  const start = (projectAll) => startWritePipeline(store, conn, buildingId, { knownBaseVersion, projectAll })
  if (store.getState().bbsSettingsStatus === 'review') deferWritePipeline(start)
  else await start(false)
}
