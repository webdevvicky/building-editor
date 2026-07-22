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
 *
 * Distinguishes a GENUINELY empty building (no server document → blank canvas is
 * correct) from an INTEGRITY FAILURE (the server HAS a document but it failed its
 * checksum and no valid local snapshot rescued it). The latter returns
 * `'integrity-failed'` so the caller can refuse to write — otherwise a blank canvas
 * would silently overwrite good server data on the next edit.
 *
 * @returns {Promise<{ source: 'r2'|'idb'|'empty'|'integrity-failed', snapshotVersion: number|null }>}
 */
export async function reopenCanvas(conn, buildingId, loadProject) {
  // Id resolution for the projection write-through — required regardless of which
  // model source we load from. Failure is non-fatal (a fresh building has no rows).
  await seedIdMapFromErp(conn).catch((err) => {
    console.warn('[canonicalReopen] id-map seed failed', err)
  })

  // Did the server return a document we could not verify? Distinguishes "empty
  // building" from "corrupt/failed-integrity document" for the write-gate below.
  let serverDocPresentButUnverified = false

  // 1. R2 canonical document.
  try {
    const doc = await getCanonicalDocument(conn, buildingId)
    if (doc && doc.payload) {
      if (await verifyChecksum(doc.payload, doc.checksum)) {
        loadProject(doc.payload)
        return { source: 'r2', snapshotVersion: typeof doc.snapshotVersion === 'number' ? doc.snapshotVersion : null }
      }
      // A document EXISTS but its bytes don't match its checksum — do NOT load it,
      // and remember that the server holds data we must not clobber.
      serverDocPresentButUnverified = true
      console.warn('[canonicalReopen] R2 canonical checksum MISMATCH — refusing to load')
    }
  } catch (err) {
    console.warn('[canonicalReopen] R2 canonical read failed', err)
  }

  // 2. IDB local snapshot (the Phase 1 autosave's durable replica). This can rescue a
  //    failed R2 read on the SAME device (a fresh/incognito browser has no local copy).
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

  // 3a. The server HAD a document we could not verify, and IDB did not rescue it →
  //     integrity failure. Signal the caller to refuse writes (protect server data).
  if (serverDocPresentButUnverified) {
    return { source: 'integrity-failed', snapshotVersion: null }
  }

  // 3b. Empty — no canonical geometry → blank canvas (the correct result, not a fallback).
  return { source: 'empty', snapshotVersion: null }
}
