// scripts/verify-erp-connection.mjs
//
// Verifies the authenticated ERP connection registry:
//   - authenticated services get { erpUrl, token, subscription } from ONE registry,
//   - a subscriber fires immediately and on every change,
//   - and (static) taxonomy is wired to erpConnection, the #erpLaunch session
//     registers into it, and the legacy manual-connect path is gone (XR-06).
//
// Pure Node: erpConnection.js has no browser deps.

import assert from 'node:assert'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  setErpConnection, getErpConnection,
  getErpApiBase, getErpAccessToken, subscribeErpConnection, _resetErpConnection,
} from '../src/projects/erpConnection.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const SRC = join(ROOT, 'projects')
let pass = 0, fail = 0
function ok(label, cond) { if (cond) { pass++; console.log(`  ✓ ${label}`) } else { fail++; console.log(`  ✗ ${label}`) } }

// ── Part A: functional ───────────────────────────────────────────────────────
_resetErpConnection()
ok('starts empty (no connection)', getErpConnection() === null && getErpApiBase() === null)

const seen = []
const unsub = subscribeErpConnection((conn) => { seen.push(conn ? conn.erpUrl : null) })
ok('subscriber fires immediately with the current (empty) connection', seen.length === 1 && seen[0] === null)

setErpConnection({ erpUrl: 'http://erp:3001', getToken: async () => 'tok-erplaunch', buildingId: 'b1' })
ok('subscriber fired for the new connection', seen.includes('http://erp:3001'))
ok('api base resolves', getErpApiBase() === 'http://erp:3001')
assert.strictEqual(await getErpAccessToken(), 'tok-erplaunch')
ok('token resolves via getErpAccessToken', true)

setErpConnection({ erpUrl: 'http://erp2:3001', getToken: () => 'tok-sync' })
assert.strictEqual(await getErpAccessToken(), 'tok-sync')
ok('a sync getToken is awaited too', true)

unsub()
_resetErpConnection()
let threw = false
try { await getErpAccessToken() } catch { threw = true }
ok('no connection → getErpAccessToken throws', threw)

// ── Part B: static wiring ───────────────────────────────────────────────────
const taxonomy = readFileSync(join(SRC, 'taxonomy.js'), 'utf8')
ok('taxonomy subscribes to erpConnection (not a launch path)', /subscribeErpConnection/.test(taxonomy))
ok('taxonomy uses conn.getToken() (launch-agnostic token)', /conn\.getToken\(\)/.test(taxonomy))
ok('taxonomy surfaces load errors (no silent catch)', /_reportRoomTypesError|console\.error/.test(taxonomy) && !/catch\(\(\) => \{ \/\* offline/.test(taxonomy))

const erpSession = readFileSync(join(SRC, 'erpSession.js'), 'utf8')
ok('erpSession registers into the registry (setErpConnection)', /setErpConnection\(/.test(erpSession))

// XR-06: the legacy manual-connect path called ERP routes that no longer exist — it is deleted, not kept.
for (const gone of ['projects/cloudConn.js', 'projects/connectHandoff.js', 'components/ConnectErpDialog.jsx', 'components/ErpConnection.jsx']) {
  ok(`legacy connect file deleted: ${gone}`, !existsSync(join(ROOT, gone)))
}
const app = readFileSync(join(ROOT, 'App.jsx'), 'utf8')
const main = readFileSync(join(ROOT, 'main.jsx'), 'utf8')
ok('App.jsx no longer wires the #connect handoff or the connect dialog', !/connectHandoff|ErpConnection|parseConnectHash/.test(app))
ok('main.jsx no longer hydrates the legacy connection cache', !/cloudConn|hydrateConnCache/.test(main))

console.log(`\nverify-erp-connection: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
