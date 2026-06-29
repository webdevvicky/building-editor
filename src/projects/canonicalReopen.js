// canonicalReopen.js — Phase 2: the canonical READ path.
//
// Reopen hierarchy, integrity-gated:
//   1. R2 canonical document  (getCanonicalDocument → verifyChecksum → loadProject)
//   2. IDB local snapshot      (same-device durability / not-yet-uploaded edits)
//   3. empty                   (no canonical geometry yet → blank canvas)
//
// In every non-empty path we FIRST seed the id-map from the live projection
// (seedIdMapFromErp) so the write-through resolves existing entities to UPDATE —
// but we NEVER reconstruct the canvas from the projection. The PostgreSQL
// reconstruction path survives only behind the temporary dev rollback flag,
// handled in erpSession (not here).

import { getCanonicalDocument, verifyChecksum } from './canonicalDoc.js'
import { seedIdMapFromErp } from './liveSync.js'
import { getAssetStorage } from './storage/getAssetStorage.js'
import { DB_STORES } from './storage/indexedDb.js'

/**
 * Load the canvas from the canonical document, falling back R2 → IDB → empty.
 * @returns {Promise<{ source: 'r2'|'idb'|'empty', snapshotVersion: number|null }>}
 */
export async function reopenCanvas(conn, buildingId, loadProject) {
  // Id resolution for the projection write-through — required regardless of which
  // model source we load from. Failure is non-fatal (a fresh building has no rows).
  await seedIdMapFromErp(conn).catch((err) => {
    console.warn('[canonicalReopen] id-map seed failed', err)
  })

  // 1. R2 canonical document.
  try {
    const doc = await getCanonicalDocument(conn, buildingId)
    if (doc && doc.payload && (await verifyChecksum(doc.payload, doc.checksum))) {
      loadProject(doc.payload)
      return { source: 'r2', snapshotVersion: typeof doc.snapshotVersion === 'number' ? doc.snapshotVersion : null }
    }
  } catch (err) {
    console.warn('[canonicalReopen] R2 canonical read failed', err)
  }

  // 2. IDB local snapshot (the Phase 1 autosave's durable replica).
  try {
    const local = await getAssetStorage().get(DB_STORES.SNAPSHOTS, `${buildingId}`)
    if (local && local.payload && (await verifyChecksum(local.payload, local.checksum))) {
      loadProject(local.payload)
      // The server version is unknown from a local doc; let the upload queue seed
      // baseVersion from its own persisted/served value.
      return { source: 'idb', snapshotVersion: null }
    }
  } catch (err) {
    console.warn('[canonicalReopen] IDB snapshot read failed', err)
  }

  // 3. Empty — no canonical geometry → blank canvas (the correct result, not a fallback).
  return { source: 'empty', snapshotVersion: null }
}
