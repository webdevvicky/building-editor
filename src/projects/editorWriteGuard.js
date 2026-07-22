// editorWriteGuard.js — a hard latch that blocks ALL editor→ERP writes.
//
// Engaged when reopen could NOT establish a trustworthy base: the server's canonical
// document exists but FAILS its checksum (and no valid local snapshot rescued it). A
// blank/partial canvas must never overwrite good canonical data — the base-version
// CAS only rejects STALE writes, not a writer that reopened blank and then adopted the
// server's current version. Both write paths consult this before touching the ERP:
//   - syncCoordinator (projection ops + canonical acceptance) — skips its whole tick,
//   - canonicalSyncQueue (R2 upload outbox) — reports 'idle' instead of uploading.
//
// The latch is one-way for a session (there is no safe automatic recovery from a
// failed reopen — the user must reload); a fresh launch starts clear.

let _readOnly = false;
let _reason = null;
const _listeners = new Set();

/** Engage read-only mode with a user-facing reason. Idempotent (first reason wins). */
export function engageEditorReadOnly(reason) {
  if (_readOnly) return;
  _readOnly = true;
  _reason = reason || 'Editing is disabled to protect your saved data.';
  for (const fn of _listeners) {
    try { fn(_reason); } catch { /* listener errors never block the latch */ }
  }
}

export function isEditorReadOnly() { return _readOnly; }
export function editorReadOnlyReason() { return _reason; }

/** Subscribe to read-only state (fires immediately if already engaged). Returns an unsubscribe. */
export function subscribeEditorReadOnly(fn) {
  _listeners.add(fn);
  if (_readOnly) { try { fn(_reason); } catch { /* */ } }
  return () => _listeners.delete(fn);
}

/** Test/reset seam — not used by production code. */
export function _resetEditorWriteGuard() { _readOnly = false; _reason = null; }
