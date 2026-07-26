// editorWriteGuard.js — the editor→ERP write gate.
//
// Two severities, one module (doc 48A Phase 0, generalized from the integrity latch):
//
//  1. HARD read-only (one-way latch) — the base is UNTRUSTWORTHY and continuing to
//     write would risk clobbering good server data. Engaged for:
//       • INTEGRITY FAILURE — the server's canonical document failed its checksum on
//         reopen and no local snapshot rescued it (a blank/partial canvas must never
//         overwrite good data), and
//       • STALE BASE — the server advanced beyond our base and refused our writes
//         repeatedly (genuine divergence: another writer is ahead → reload to reconcile).
//     The HARD latch skips the WHOLE sync tick (local accept + ERP projection) via
//     `isEditorHardReadOnly()`. One-way for the session — the user must reload.
//
//  2. CONNECTION LOST (releasable) — the editor is offline. This is NOT a data-safety
//     latch: the durable IDB outbox already buffers edits and replays on reconnect, so
//     LOCAL ACCEPT MUST CONTINUE (offline-first durability is preserved). It only (a)
//     surfaces the read-only/offline banner so a disconnected editor never *looks*
//     saved-to-server, and (b) pauses the ERP upload attempt (which would fail anyway)
//     until reconnect, via the broad `isEditorReadOnly()`. Clears automatically on reconnect.
//
// Consumers:
//   - syncCoordinator  → `isEditorHardReadOnly()` (skip local accept ONLY on the hard latch),
//   - canonicalSyncQueue → `isEditorReadOnly()`   (pause upload on hard latch OR offline),
//   - EditorReadOnlyBanner → `isEditorReadOnly()` + `editorReadOnlyReason()` (shows either reason).

let _hardReadOnly = false; // integrity / stale-base — one-way latch
let _hardReason = null;
let _connectionLost = false; // releasable — offline
let _connectionReason = null;
const _listeners = new Set();

function _emit() {
  const reason = editorReadOnlyReason();
  for (const fn of _listeners) {
    try { fn(reason); } catch { /* listener errors never block the gate */ }
  }
}

/** Engage the HARD read-only latch with a user-facing reason. Idempotent (first reason wins). */
export function engageEditorReadOnly(reason) {
  if (_hardReadOnly) return;
  _hardReadOnly = true;
  _hardReason = reason || 'Editing is disabled to protect your saved data.';
  _emit();
}

/**
 * Set the (releasable) connection-lost state. Offline blocks ERP upload + shows the
 * banner but NEVER blocks local accept — edits stay durable in IDB and replay on
 * reconnect. Pass `false` on reconnect to clear it.
 */
export function setEditorConnectionLost(lost, reason) {
  const next = !!lost;
  if (_connectionLost === next) return;
  _connectionLost = next;
  _connectionReason = next
    ? (reason || 'You are offline. Your changes are saved on this device and will sync when you reconnect.')
    : null;
  _emit();
}

/** The read-only SURFACE (banner + upload gate): hard latch OR offline. */
export function isEditorReadOnly() { return _hardReadOnly || _connectionLost; }

/**
 * The HARD gate (integrity / stale-base only, NOT connection loss). Drives the
 * whole-tick skip in syncCoordinator so offline edits still persist locally.
 */
export function isEditorHardReadOnly() { return _hardReadOnly; }

export function isEditorConnectionLost() { return _connectionLost; }

/** The most severe active reason (hard latch wins over an offline notice). */
export function editorReadOnlyReason() { return _hardReason || _connectionReason; }

/** Subscribe to gate changes (fires immediately if already read-only). Returns an unsubscribe. */
export function subscribeEditorReadOnly(fn) {
  _listeners.add(fn);
  if (isEditorReadOnly()) { try { fn(editorReadOnlyReason()); } catch { /* */ } }
  return () => _listeners.delete(fn);
}

/**
 * Wire browser online/offline events to the connection-lost state. Idempotent; a no-op
 * outside a browser (tests / SSR). Call once from the ERP session bootstrap.
 */
let _watchWired = false;
export function initEditorConnectionWatch() {
  if (_watchWired) return;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  _watchWired = true;
  const sync = () => setEditorConnectionLost(!navigatorOnline());
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  sync(); // seed from the current state
}

function navigatorOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** Test/reset seam — not used by production code. */
export function _resetEditorWriteGuard() {
  _hardReadOnly = false; _hardReason = null;
  _connectionLost = false; _connectionReason = null;
  _watchWired = false;
}
