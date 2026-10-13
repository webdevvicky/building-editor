// canonicalReopen.js — Phase 2: the canonical READ path.
//
// Reopen loads the canvas from ONE copy, chosen by the save rule (canonicalSyncQueue
// header): a copy is only ever uploaded on the server version it was edited from.
//
//   1. Unsent local edits made on the server's CURRENT version  → the local copy is
//      the newest anywhere: load it; the queue resumes its upload on that version.
//   2. Unsent local edits made on an OLDER version (someone saved since) → a clash:
//      load the server copy, keep the local one aside (never uploaded, never lost),
//      clear the unsent flag and report the clash to the caller (XR-15).
//   3. The server's canonical document (checksum-verified).
//   4. The local snapshot, when the server cannot be reached, has no document, or
//      holds one that fails its checksum (same-device rescue).
//   5. A server document that fails its checksum with no local rescue →
//      'integrity-failed' (the caller refuses to write).
//   6. Empty — a building with no canonical geometry yet → blank canvas.
//
// In every path we FIRST seed the id-map from the live projection (seedIdMapFromErp)
// so the write-through resolves existing entities to UPDATE — but we NEVER
// reconstruct the canvas from the projection (that is only the user's explicit
// "Load from ERP", projectionGuard).

import { getCanonicalDocument, verifyChecksum } from './canonicalDoc.js'
import { seedIdMapFromErp } from './liveSync.js'
import { getAssetStorage } from './storage/getAssetStorage.js'
import { DB_STORES } from './storage/indexedDb.js'
import { readCanonicalQueueMeta, writeCanonicalQueueMeta, keepClashCopy } from './canonicalSyncQueue.js'

async function _readVerifiedLocal(buildingId) {
  try {
    const local = await getAssetStorage().get(DB_STORES.SNAPSHOTS, `${buildingId}`)
    if (local && local.payload && (await verifyChecksum(local.payload, local.checksum))) return local
  } catch (err) {
    console.warn('[canonicalReopen] IDB snapshot read failed', err)
  }
  return null
}

/**
 * Load the canvas from the right copy (see the header).
 *
 * `snapshotVersion` is the server version the loaded canvas descends from — the
 * upload queue's base (`initCanonicalSyncQueue({ knownBaseVersion })`); null means
 * "unknown here, keep the persisted base" (an offline reopen of the local copy).
 * `clash` is set when unsent local edits lost to a newer server version.
 *
 * @returns {Promise<{ source: 'r2'|'idb'|'idb-unsent'|'empty'|'integrity-failed',
 *                     snapshotVersion: number|null,
 *                     clash: { localBaseVersion: number, serverVersion: number }|null }>}
 */
export async function reopenCanvas(conn, buildingId, loadProject) {
  // Id resolution for the projection write-through — required regardless of which
  // model source we load from. Failure is non-fatal (a fresh building has no rows).
  await seedIdMapFromErp(conn).catch((err) => {
    console.warn('[canonicalReopen] id-map seed failed', err)
  })

  let server = null
  let serverReachable = false
  try {
    server = await getCanonicalDocument(conn, buildingId)
    serverReachable = true
  } catch (err) {
    console.warn('[canonicalReopen] R2 canonical read failed', err)
  }
  const serverVersion = typeof server?.snapshotVersion === 'number' ? server.snapshotVersion : 0
  const serverHasDoc = !!server?.payload
  const serverValid = serverHasDoc && (await verifyChecksum(server.payload, server.checksum))
  if (serverHasDoc && !serverValid) console.warn('[canonicalReopen] R2 canonical checksum MISMATCH — refusing to load')

  const local = await _readVerifiedLocal(buildingId)
  const meta = await readCanonicalQueueMeta(buildingId)
  const localUnsent = !!(local && meta?.dirty)
  let clash = null

  if (serverReachable && localUnsent) {
    // 1. The unsent local copy descends from the server's current version (or the
    //    server has no document at all, so nothing newer exists) — it is the newest.
    if (meta.baseVersion === serverVersion || !serverHasDoc) {
      loadProject(local.payload)
      return { source: 'idb-unsent', snapshotVersion: serverVersion, clash: null }
    }
    // 2. Someone saved a newer version since these edits were made: keep them aside,
    //    never upload them on the newer number, and open the server's copy.
    await keepClashCopy(buildingId, local, meta.baseVersion)
    await writeCanonicalQueueMeta(buildingId, { baseVersion: serverVersion, dirty: false })
    clash = { localBaseVersion: meta.baseVersion, serverVersion }
  }

  // 3. The server's canonical document.
  if (serverValid) {
    loadProject(server.payload)
    return { source: 'r2', snapshotVersion: serverVersion, clash }
  }

  // 4. The local copy rescues an unreachable / empty / corrupt server document — but
  //    never a copy that just lost a clash.
  if (local && !clash) {
    loadProject(local.payload)
    // Unreachable or corrupt: the base is unknown here, the queue keeps its persisted
    // one (a CAS refusal then surfaces any clash). Empty server: the copy descends from
    // nothing the server holds, so version 0 is its true base.
    return { source: 'idb', snapshotVersion: serverReachable && !serverHasDoc ? 0 : null, clash: null }
  }

  // 5. The server HAD a document we could not verify and nothing rescued it → refuse writes.
  if (serverHasDoc) return { source: 'integrity-failed', snapshotVersion: null, clash }

  // 6. Empty — no canonical geometry → blank canvas (the correct result, not a fallback).
  return { source: 'empty', snapshotVersion: serverReachable ? 0 : null, clash }
}
