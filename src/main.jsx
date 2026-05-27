import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { useStore } from './store'
import { installAutosave } from './projects/autosave'
import { getCurrentProjectId, bootPersistence } from './projects/manager'

// Phase 4 Tier-2 (Phase B): boot the IDB-backed persistence layer.
// Migration shim runs once (localStorage → IDB) then hydrates the
// in-memory cache that ProjectsPanel + autosave both read from. Boot
// is fire-and-forget — useSyncExternalStore returns empty until
// notify() fires from bootPersistence.
bootPersistence().catch((err) => {
  // eslint-disable-next-line no-console
  console.warn('[boot] persistence init failed', err)
})

// Phase 2.0 — debounced autosave to the current project (now via IDB).
installAutosave(useStore, getCurrentProjectId)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
