// scripts/verify-erp-connection.mjs
//
// Verifies the source-agnostic ERP connection abstraction (Defect A architecture):
//   - authenticated services get { erpUrl, token, subscription } from ONE registry,
//   - a service subscriber fires for BOTH launch sources (erpLaunch AND cloudConn) —
//     no launch-specific wiring,
//   - source-guarded clear (a legacy disconnect can't wipe an #erpLaunch connection),
//   - and (static) taxonomy is wired to erpConnection, NOT to a specific launch path,
//     while both launch paths (erpSession + cloudConn) register into it.
//
// Pure Node: erpConnection.js has no browser deps.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  setErpConnection, clearErpConnection, getErpConnection,
  getErpApiBase, getErpAccessToken, subscribeErpConnection, _resetErpConnection,
} from '../src/projects/erpConnection.js'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'projects')
let pass = 0, fail = 0
function ok(label, cond) { if (cond) { pass++; console.log(`  ✓ ${label}`) } else { fail++; console.log(`  ✗ ${label}`) } }

// ── Part A: functional, source-agnostic ─────────────────────────────────────
_resetErpConnection()
ok('starts empty (no connection)', getErpConnection() === null && getErpApiBase() === null)

// A service (mimicking taxonomy.initRoomTypesSync) subscribes once — no launch knowledge.
const seen = []
const unsub = subscribeErpConnection((conn) => { if (conn) seen.push(conn.source) })

// Launch path 1: #erpLaunch registers.
setErpConnection({ erpUrl: 'http://erp:3001', getToken: async () => 'tok-erplaunch', source: 'erpLaunch' })
ok('service fired for erpLaunch source', seen.includes('erpLaunch'))
ok('api base resolves', getErpApiBase() === 'http://erp:3001')
assert.strictEqual(await getErpAccessToken(), 'tok-erplaunch')
ok('token resolves via getErpAccessToken (erpLaunch)', true)

// Launch path 2: legacy cloudConn registers (same registry, same subscriber).
setErpConnection({ erpUrl: 'http://erp2:3001', getToken: () => 'tok-cloudconn', source: 'cloudConn' })
ok('SAME service fired for cloudConn source (source-agnostic)', seen.includes('cloudConn'))
assert.strictEqual(await getErpAccessToken(), 'tok-cloudconn')
ok('token resolves via getErpAccessToken (cloudConn, sync getToken awaited)', true)

// Source-guarded clear: a legacy disconnect must NOT wipe a non-cloudConn connection.
setErpConnection({ erpUrl: 'http://erp:3001', getToken: async () => 't', source: 'erpLaunch' })
clearErpConnection('cloudConn')
ok('clear(cloudConn) does NOT wipe an active erpLaunch connection', getErpConnection() !== null)
clearErpConnection('erpLaunch')
ok('clear(erpLaunch) wipes the erpLaunch connection', getErpConnection() === null)

unsub()
_resetErpConnection()

// ── Part B: static wiring (DRY / no launch-specific duplication) ─────────────
const taxonomy = readFileSync(join(SRC, 'taxonomy.js'), 'utf8')
ok('taxonomy subscribes to erpConnection (not a launch path)', /subscribeErpConnection/.test(taxonomy))
ok('taxonomy no longer imports the cloudConn subscribe', !/subscribe as subscribeConn/.test(taxonomy))
ok('taxonomy uses conn.getToken() (launch-agnostic token)', /conn\.getToken\(\)/.test(taxonomy))
ok('taxonomy surfaces load errors (no silent catch)', /_reportRoomTypesError|console\.error/.test(taxonomy) && !/catch\(\(\) => \{ \/\* offline/.test(taxonomy))

const erpSession = readFileSync(join(SRC, 'erpSession.js'), 'utf8')
ok('erpSession registers into the abstraction (setErpConnection)', /setErpConnection\(/.test(erpSession))

const cloudConn = readFileSync(join(SRC, 'cloudConn.js'), 'utf8')
ok('cloudConn bridges into the abstraction (setErpConnection + clearErpConnection)',
  /setErpConnection\(/.test(cloudConn) && /clearErpConnection\(/.test(cloudConn))

console.log(`\nverify-erp-connection: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
