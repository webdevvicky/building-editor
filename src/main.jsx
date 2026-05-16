import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { useStore } from './store'
import { installAutosave } from './projects/autosave'
import { getCurrentProjectId } from './projects/manager'

// Phase 2.0 — debounced autosave to the current project in localStorage.
installAutosave(useStore, getCurrentProjectId)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
