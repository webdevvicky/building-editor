import { useEffect, useState, useSyncExternalStore } from 'react'
import { useStore } from '../store'
import {
  listProjects, createProject, openProject, renameProject, deleteProject,
  getCurrentProjectId, setCurrentProjectId, subscribe,
} from '../projects/manager'
import { isErpLaunchMode } from '../projects/erpLaunchContext'
import {
  listTemplates as listTemplatesApi, deleteTemplate, renameTemplate,
  createSnapshotFromTemplate,
} from '../projects/templates'
import { dialog } from './ui/Dialog'
import { toast } from './ui/Toast'
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

  // Area 2C Step 9 — Templates tab. Async-fetched list (templates live in
  // IDB, not in the manager's sync cache). Refresh on tab open + after
  // every CRUD action via _templatesRev bump.
  const [tab, setTab] = useState('projects')
  const [templates, setTemplates] = useState([])
  const [templatesRev, setTemplatesRev] = useState(0)
  useEffect(() => {
    if (tab !== 'templates') return
    let cancelled = false
    listTemplatesApi().then(list => { if (!cancelled) setTemplates(list) })
    return () => { cancelled = true }
  }, [tab, templatesRev])

  // On mount: if no current project id is set, force the modal open. In
  // ERP-launch mode the editor is bound to the ERP building (no local current
  // project by design), so the "new project" dialog must NOT force open.
  // bootPersistence + the ERP launch context are both resolved before this
  // component mounts (main.jsx awaits them), so the lazy initializer reads
  // stable values — no setState-in-effect needed.
  const [forceOpen, setForceOpen] = useState(
    () => !isErpLaunchMode() && !getCurrentProjectId(),
  )

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

  // Area 2C Step 9 — template actions.
  async function handleUseTemplate(tmpl) {
    const projectName = await dialog.prompt('Name the new project', {
      title: `Use template "${tmpl.name}"`,
      defaultValue: tmpl.name,
    })
    if (!projectName || !projectName.trim()) return
    const snap = await createSnapshotFromTemplate(tmpl.id)
    if (!snap) { toast.error('Template not found'); return }
    const rec = createProject(projectName.trim(), 'Residential')
    if (!rec) return
    // openProject returns the empty-shape blank; we then loadProject with
    // the rewritten template snapshot so the new project starts populated.
    openProject(rec.id)
    loadProject(snap)
    setCurrentProjectId(rec.id)
    setForceOpen(false)
    if (activeTool === 'projects') setTool('select')
    toast.success(`Created "${projectName}" from template`)
  }
  async function handleRenameTemplate(tmpl) {
    const next = await dialog.prompt('New template name', { title: 'Rename template', defaultValue: tmpl.name })
    if (!next || !next.trim()) return
    await renameTemplate(tmpl.id, next.trim())
    setTemplatesRev(v => v + 1)
  }
  async function handleDeleteTemplate(tmpl) {
    const ok = await dialog.confirm(`Delete template "${tmpl.name}"? This can't be undone.`, {
      title: 'Delete template', variant: 'danger', confirmLabel: 'Delete',
    })
    if (!ok) return
    await deleteTemplate(tmpl.id)
    setTemplatesRev(v => v + 1)
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
      {/* Area 2C Step 9 — Tabs row */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', borderBottom: '1px solid var(--color-border)', marginBottom: 'var(--space-3)' }}>
        <button
          onClick={() => setTab('projects')}
          style={{
            padding: 'var(--space-2) var(--space-3)',
            background: 'transparent',
            border: 'none',
            borderBottom: tab === 'projects' ? '2px solid var(--color-primary)' : '2px solid transparent',
            color: tab === 'projects' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
            fontWeight: 'var(--weight-medium)',
            cursor: 'pointer',
          }}>Recent projects</button>
        <button
          onClick={() => setTab('templates')}
          style={{
            padding: 'var(--space-2) var(--space-3)',
            background: 'transparent',
            border: 'none',
            borderBottom: tab === 'templates' ? '2px solid var(--color-primary)' : '2px solid transparent',
            color: tab === 'templates' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
            fontWeight: 'var(--weight-medium)',
            cursor: 'pointer',
          }}>Templates</button>
      </div>

      {tab === 'templates' ? (
        templates.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)', padding: 'var(--space-3) var(--space-1)' }}>
            No templates saved yet. Open a project and use “Save as template” in Project Settings to create one.
          </div>
        ) : (
          <div>
            {templates.map(t => (
              <div key={t.id} style={rowStyle}>
                <div style={nameStyle}>
                  {t.name}
                  <div style={metaStyle}>{t.kind} · saved {formatDate(t.createdAt)}</div>
                </div>
                <Button variant="primary"   size="sm" onClick={() => handleUseTemplate(t)}>Use</Button>
                <Button variant="secondary" size="sm" onClick={() => handleRenameTemplate(t)}>Rename</Button>
                <Button variant="danger"    size="sm" onClick={() => handleDeleteTemplate(t)}>Delete</Button>
              </div>
            ))}
          </div>
        )
      ) : (
      <>
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
      </>
      )}
    </Modal>
  )
}
