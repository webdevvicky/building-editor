import { useEffect, useState, useSyncExternalStore } from 'react'
import { useStore } from '../store'
import {
  listProjects, createProject, openProject, renameProject, deleteProject,
  getCurrentProjectId, setCurrentProjectId, subscribe,
} from '../projects/manager'
import { dialog } from './ui/Dialog'
import { Modal } from './ui/Modal.jsx'
import { Button } from './ui/Button.jsx'

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
  padding: 'var(--space-3) var(--space-2)',
  borderBottom: '1px solid var(--color-border)',
}

const nameStyle = { flex: 1, fontWeight: 'var(--weight-medium)', color: 'var(--color-text)' }
const metaStyle = { color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }

const newBlock = {
  marginTop: 'var(--space-4)',
  padding: 'var(--space-4)',
  background: 'var(--color-bg-subtle)',
  borderRadius: 'var(--radius-md)',
  display: 'flex',
  gap: 'var(--space-2)',
  alignItems: 'center',
  flexWrap: 'wrap',
}

const inp = {
  padding: 'var(--space-2) var(--space-2)',
  fontSize: 'var(--text-base)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  minWidth: 200,
  color: 'var(--color-text)',
  background: 'var(--color-surface)',
}

const sel = {
  padding: 'var(--space-2) var(--space-2)',
  fontSize: 'var(--text-base)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text)',
  background: 'var(--color-surface)',
}

const currentTag = {
  marginLeft: 'var(--space-2)',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-success)',
  fontWeight: 'var(--weight-medium)',
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

  async function handleRename(id, currentName) {
    const next = await dialog.prompt('New name', { title: 'Rename project', defaultValue: currentName })
    if (next && next.trim()) renameProject(id, next.trim())
  }

  async function handleDelete(id, name) {
    const ok = await dialog.confirm(`Delete project "${name}"? This cannot be undone.`, {
      title: 'Delete project', confirmLabel: 'Delete', variant: 'danger',
    })
    if (!ok) return
    deleteProject(id)
  }

  const recent      = projects.slice(0, 5)
  const canDismiss  = !!getCurrentProjectId()

  return (
    <Modal
      open={open}
      onClose={canDismiss ? dismiss : undefined}
      title="Projects"
      width={560}
    >
      {recent.length === 0 ? (
        <div
          style={{
            color: 'var(--color-text-muted)',
            padding: 'var(--space-3) var(--space-1)',
          }}
        >
          No projects yet. Create one below to get started.
        </div>
      ) : (
        <div>
          <div style={{ ...metaStyle, marginBottom: 'var(--space-1)' }}>
            Recent projects {projects.length > 5 ? `(${projects.length} total, showing 5)` : ''}
          </div>
          {recent.map(p => {
            const isCurrent = p.id === currentId
            return (
              <div key={p.id} style={rowStyle}>
                <div style={nameStyle}>
                  {p.name}
                  {isCurrent && <span style={currentTag}>(current)</span>}
                  <div style={metaStyle}>
                    {p.type} - updated {formatDate(p.updated)}
                  </div>
                </div>
                <Button variant="primary" size="sm" onClick={() => handleOpen(p.id)}>Open</Button>
                <Button variant="secondary" size="sm" onClick={() => handleRename(p.id, p.name)}>Rename</Button>
                <Button variant="danger" size="sm" onClick={() => handleDelete(p.id, p.name)}>Delete</Button>
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
        <Button variant="primary" size="sm" onClick={handleCreate}>+ New project</Button>
      </div>

      {!canDismiss && (
        <div
          style={{
            marginTop: 'var(--space-4)',
            color: 'var(--color-warning)',
            fontSize: 'var(--text-xs)',
          }}
        >
          Open or create a project to continue.
        </div>
      )}
    </Modal>
  )
}
