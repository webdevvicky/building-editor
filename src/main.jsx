import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { useStore } from './store'
import { installAutosave } from './projects/autosave'
import { getCurrentProjectId, bootPersistence } from './projects/manager'
import { hydrateConnCache } from './projects/cloudConn'
import { parseErpLaunchHash, setErpLaunchContext, getErpLaunchContext } from './projects/erpLaunchContext'
import { initErpSession } from './projects/erpSession'

// ERP-driven launch: when the ERP opens the editor for a building it appends a
// `#erpLaunch?buildingId=&token=&erpUrl=` fragment. Parse + strip it BEFORE any
// other boot work so (a) the JWT never lingers in history and (b) the launch
// context is set before bootPersistence (manager.js reads it to skip local
// current-project hydration). parseErpLaunchHash is sync + side-effect-free.
const _erpLaunch =
  typeof window !== 'undefined' ? parseErpLaunchHash(window.location.hash) : null
if (_erpLaunch) {
  setErpLaunchContext(_erpLaunch)
  try {
    window.history.replaceState(
      null, '', window.location.pathname + window.location.search,
    )
  } catch { /* non-browser / blocked — best effort */ }
}
// SECURITY: sanitized — never log the token.
const _erpCtxForLog = getErpLaunchContext()
console.log('[ERP] launch context set', _erpCtxForLog
  ? { buildingId: _erpCtxForLog.buildingId, erpUrl: _erpCtxForLog.erpUrl, hasToken: !!_erpCtxForLog.token }
  : null)

// Phase 2.0 — debounced autosave to the current project (via IDB). Registering
// the store subscription is safe before boot — flush() reads getProjectId()
// lazily, so it sees the hydrated current-project id once boot completes. In
// ERP mode getCurrentProjectId() stays null, so autosave is a no-op (live sync
// owns persistence).
installAutosave(useStore, getCurrentProjectId)

// Deterministic boot: AWAIT the IDB-backed persistence layer before rendering
// <App/>. The migration shim runs once (localStorage → IDB) and the in-memory
// cache (current project id, projects list) hydrates here — so by the time the
// app mounts, getCurrentProjectId() is stable. This removes the boot/handoff
// race where the #connect deep link read a null current-project id and the
// hydrate then clobbered the id it had just set. The boot skeleton in
// index.html covers this window (< 500ms in practice).
async function boot() {
  try {
    await bootPersistence()
    console.log('[ERP] boot persistence done')
    // Hydrate the in-memory cloud-connection mirror so getCachedConn() (autosave
    // hot path) and the sync badge are correct from first render.
    await hydrateConnCache()
    // ERP-driven launch: activate live sync (build the floor-id map, initLiveSync,
    // hydrate the id-map) BEFORE the app renders so the canvas + every mutation
    // are bound to the ERP building from first paint. Failures are swallowed so a
    // sync hiccup never blocks the editor from opening.
    if (_erpLaunch) {
      await initErpSession().catch((err) => {
        console.warn('[boot] ERP session init failed', err)
      })
      console.log('[ERP] erp session init done')
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[boot] persistence init failed', err)
  }
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

boot()
