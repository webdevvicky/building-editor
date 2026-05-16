import { useEffect, useState, useSyncExternalStore } from 'react'
import { useStore } from '../store'
import {
  listProjects, createProject, openProject, renameProject, deleteProject,
  getCurrentProjectId, setCurrentProjectId, subscribe,
} from '../projects/manager'

// ── styling (matches ProjectSettingsPanel) ───────────────────────────────────
const overlay = {
  position: 'fixed', top: '50%', left: '50%',
  transform: 'translate(-50%, -50%)', zIndex: 200,
  width: 560, maxHeight: '80vh', overflowY: 'auto',
  background: '#fff', borderRadius: 8,
  padding: 22, boxShadow: '0 4px 32px rgba(0,0,0,0.22)',
  fontSize: 13,
}

const backdrop = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 199,
}

const headerRow = {
  display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', marginBottom: 14,
}

const closeBtn = {
  background: 'none', border: 'none', fontSize: 18,
  cursor: 'pointer', color: '#555', lineHeight: 1, padding: '0 4px',
}

const rowStyle = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '10px 8px', borderBottom: '1px solid #eee',
}

const nameStyle = { flex: 1, fontWeight: 500 }
const metaStyle = { color: '#888', fontSize: 11 }

const smallBtn = {
  padding: '4px 10px', fontSize: 12, borderRadius: 4,
  border: '1px solid #ccc', background: '#fff', cursor: 'pointer',
}

const primaryBtn = {
  ...smallBtn, background: '#333', color: '#fff', borderColor: '#333',
}

const dangerBtn = {
  ...smallBtn, color: '#c33', borderColor: '#e2b8b8',
}

const newBlock = {
  marginTop: 16, padding: 14, background: '#fafafa', borderRadius: 6,
  display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
}

const inp = {
  padding: '6px 8px', fontSize: 13, border: '1px solid #ccc',
  borderRadius: 4, minWidth: 200,
}

const sel = {
  padding: '6px 8px', fontSize: 13, border: '1px solid #ccc', borderRadius: 4,
}

// Subscribe React to the manager's listener set via useSyncExternalStore.
function useManagerProjects() {
  return useSyncExternalStore(
    subscribe,
    () => listProjects(),
    () => [],
  )
}

function useCurrentProjectId() {
  return useSyncExternalStore(
    subscribe,
    () => getCurrentProjectId(),
    () => null,
  )
}

function formatDate(ms) {
  if (!ms) return ''
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export default function ProjectsPanel() {
  const activeTool  = useStore(s => s.activeTool)
  const setTool     = useStore(s => s.setTool)
  const loadProject = useStore(s => s.loadProject)

  const projects  = useManagerProjects()
  const currentId = useCurrentProjectId()

  // On mount: if no current project id is set, force the modal open.
  const [forceOpen, setForceOpen] = useState(false)
  useEffect(() => {
    if (!getCurrentProjectId()) setForceOpen(true)
  }, [])

  const open = forceOpen || activeTool === 'projects'

  // New-project form state.
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('Residential')

  if (!open) return null

  function dismiss() {
    // Only allow dismiss if we have a current project.
    if (!getCurrentProjectId()) return
    setForceOpen(false)
    if (activeTool === 'projects') setTool('select')
  }

  function handleOpen(id) {
    const data = openProject(id)
    if (data) {
      loadProject(data)
      setCurrentProjectId(id)
      setForceOpen(false)
      if (activeTool === 'projects') setTool('select')
    }
  }

  function handleCreate() {
    const name = newName.trim() || 'Untitled project'
    const rec  = createProject(name, newType)
    if (!rec) return
    const data = openProject(rec.id)
    if (data) loadProject(data)
    setNewName('')
    setForceOpen(false)
    if (activeTool === 'projects') setTool('select')
  }

  function handleRename(id, currentName) {
    const next = window.prompt('Rename project', currentName)
    if (next && next.trim()) renameProject(id, next.trim())
  }

  function handleDelete(id, name) {
    if (!window.confirm(`Delete project "${name}"? This cannot be undone.`)) return
    deleteProject(id)
  }

  const recent      = projects.slice(0, 5)
  const canDismiss  = !!getCurrentProjectId()

  return (
    <>
      <div style={backdrop} onClick={dismiss} />
      <div style={overlay} onKeyDown={e => e.stopPropagation()}>
        <div style={headerRow}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Projects</div>
          {canDismiss && <button style={closeBtn} onClick={dismiss} title="Close">x</button>}
        </div>

        {recent.length === 0 ? (
          <div style={{ color: '#888', padding: '12px 4px' }}>
            No projects yet. Create one below to get started.
          </div>
        ) : (
          <div>
            <div style={{ ...metaStyle, marginBottom: 4 }}>
              Recent projects {projects.length > 5 ? `(${projects.length} total, showing 5)` : ''}
            </div>
            {recent.map(p => {
              const isCurrent = p.id === currentId
              return (
                <div key={p.id} style={rowStyle}>
                  <div style={nameStyle}>
                    {p.name}
                    {isCurrent && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: '#1a7' }}>
                        (current)
                      </span>
                    )}
                    <div style={metaStyle}>
                      {p.type} - updated {formatDate(p.updated)}
                    </div>
                  </div>
                  <button style={primaryBtn} onClick={() => handleOpen(p.id)}>Open</button>
                  <button style={smallBtn}   onClick={() => handleRename(p.id, p.name)}>Rename</button>
                  <button style={dangerBtn}  onClick={() => handleDelete(p.id, p.name)}>Delete</button>
                </div>
              )
            })}
          </div>
        )}

        <div style={newBlock}>
          <input
            style={inp}
            value={newName}
            placeholder="New project name"
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Enter') handleCreate()
            }}
          />
          <select style={sel} value={newType} onChange={e => setNewType(e.target.value)}>
            <option value="Residential">Residential</option>
            <option value="Commercial">Commercial</option>
            <option value="Industrial">Industrial</option>
          </select>
          <button style={primaryBtn} onClick={handleCreate}>+ New project</button>
        </div>

        {!canDismiss && (
          <div style={{ marginTop: 14, color: '#a60', fontSize: 11 }}>
            Open or create a project to continue.
          </div>
        )}
      </div>
    </>
  )
}
