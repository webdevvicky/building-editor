import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { useStore } from './store'
import { installAutosave } from './projects/autosave'
import { getCurrentProjectId, bootPersistence } from './projects/manager'
import { hydrateConnCache } from './projects/cloudConn'

// Phase 2.0 — debounced autosave to the current project (via IDB). Registering
// the store subscription is safe before boot — flush() reads getProjectId()
// lazily, so it sees the hydrated current-project id once boot completes.
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
    // Hydrate the in-memory cloud-connection mirror so getCachedConn() (autosave
    // hot path) and the sync badge are correct from first render.
    await hydrateConnCache()
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
