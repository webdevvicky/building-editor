// scripts/verify-editor-write-guard.mjs
//
// Verifies the read-only write gate (editorWriteGuard) that protects good canonical
// data after a failed reopen:
//   - engaged latch blocks the canonicalSyncQueue upload (sync() → 'idle', no PUT)
//   - a clear latch uploads normally (sync() → 'uploaded')
//   - subscribers are notified on engage; the latch is idempotent (first reason wins)
//
// Pure Node: in-memory IDB + a fake backend that records whether a PUT was attempted.

import assert from 'node:assert'
import { makeMemoryAdapter, DB_STORES } from '../src/projects/storage/indexedDb.js'
import { setAssetStorage } from '../src/projects/storage/getAssetStorage.js'
import {
  engageEditorReadOnly, isEditorReadOnly, editorReadOnlyReason,
  subscribeEditorReadOnly, _resetEditorWriteGuard,
} from '../src/projects/editorWriteGuard.js'
import {
  initCanonicalSyncQueue, teardownCanonicalSyncQueue, _setDirtyForTest, sync,
} from '../src/projects/canonicalSyncQueue.js'
import { buildSnapshotDoc } from '../src/projects/canonicalDoc.js'

let pass = 0, fail = 0
function ok(label, cond) {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}`) }
}
function header(t) { console.log(`\n${t}`) }

let putAttempts = 0
let putVersion = 3
const okRes = (body) => ({ ok: true, status: 200, text: async () => '', json: async () => body })
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); const method = opts.method ?? 'GET'
  if (u.includes('/document') && method === 'PUT') {
    putAttempts++
    putVersion++
    return okRes({ success: true, data: { snapshotVersion: putVersion } })
  }
  if (u.includes('/document') && method === 'GET') {
    return okRes({ success: true, data: { snapshotVersion: putVersion, checksum: null, payload: null } })
  }
  return { ok: false, status: 404, json: async () => ({}), text: async () => 'nf' }
}

const conn = { erpUrl: 'http://erp.test', getToken: async () => 'scoped-token' }

async function seedDirtyDoc() {
  const doc = await buildSnapshotDoc({ version: 7, rooms: {}, walls: {}, nodes: {}, projectSettings: null })
  await getStore().put(DB_STORES.SNAPSHOTS, 'bld', doc)
  _setDirtyForTest()
}
function getStore() { return _store }
let _store = null

async function main() {
  // ── 1. Latch semantics ────────────────────────────────────────────────────
  header('Latch semantics')
  _resetEditorWriteGuard()
  ok('starts clear', isEditorReadOnly() === false)
  let notified = null
  const unsub = subscribeEditorReadOnly((r) => { notified = r })
  engageEditorReadOnly('boom')
  ok('engaged', isEditorReadOnly() === true)
  ok('reason set', editorReadOnlyReason() === 'boom')
  ok('subscriber notified with reason', notified === 'boom')
  engageEditorReadOnly('second reason ignored')
  ok('idempotent — first reason wins', editorReadOnlyReason() === 'boom')
  unsub()

  // ── 2. Gate blocks the canonical upload ───────────────────────────────────
  header('Read-only gate blocks canonical upload')
  _store = makeMemoryAdapter(); setAssetStorage(_store)
  putAttempts = 0
  teardownCanonicalSyncQueue()
  await initCanonicalSyncQueue(conn, 'bld', { knownBaseVersion: 3 })
  await seedDirtyDoc()
  // Guard is still engaged from part 1.
  let r = await sync()
  ok("engaged latch → sync() returns 'idle'", r === 'idle')
  ok('no PUT attempted while read-only', putAttempts === 0)

  // ── 3. Clearing the latch restores uploads ────────────────────────────────
  header('Cleared latch uploads normally')
  _resetEditorWriteGuard()
  r = await sync()
  ok("clear latch → sync() returns 'uploaded'", r === 'uploaded')
  ok('exactly one PUT attempted', putAttempts === 1)
  teardownCanonicalSyncQueue()

  console.log(`\n${fail === 0 ? '✓ PASS' : '✗ FAIL'} — ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
