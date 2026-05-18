import { useRef } from 'react'
import {
  Pencil,
  MousePointer2,
  Scissors,
  Hexagon,
  Columns3,
  RectangleHorizontal,
  LayoutGrid,
  Anchor,
  Stamp,
  ArrowDownUp,
  Droplet,
  Container,
  Cylinder,
  Building2,
  Ruler,
  Settings,
  EyeOff,
  FolderOpen,
  Save,
  Upload,
  Download,
  Undo2,
  Redo2,
  History,
  Box,
} from 'lucide-react'
import { useStore } from '../store'
import { getCurrentProjectId, saveCurrent } from '../projects/manager'
import { dialog } from './ui/Dialog'
import { toast } from './ui/Toast'
import { Button } from './ui/Button'
import './Toolbar.css'

const ICON_SIZE = 14
const ICON_STROKE = 2

export default function Toolbar() {
  const activeTool          = useStore(s => s.activeTool)
  const drawVirtual         = useStore(s => s.drawVirtual)
  const showDimensions      = useStore(s => s.showDimensions)
  const unit                = useStore(s => s.unit)
  const history             = useStore(s => s.history)
  const future              = useStore(s => s.future)
  const setTool             = useStore(s => s.setTool)
  const toggleDrawVirtual   = useStore(s => s.toggleDrawVirtual)
  const toggleShowDimensions = useStore(s => s.toggleShowDimensions)
  const setUnit             = useStore(s => s.setUnit)
  const undo                = useStore(s => s.undo)
  const redo                = useStore(s => s.redo)
  const loadProject         = useStore(s => s.loadProject)

  const fileInputRef = useRef(null)

  function handleExportJson() {
    const s = useStore.getState()
    const data = JSON.stringify({
      version: 6, unit: 'inch',
      nodes: s.nodes, walls: s.walls, rooms: s.rooms, stamps: s.stamps,
      columns: s.columns, beams: s.beams, slabs: s.slabs, staircases: s.staircases,
      foundations: s.foundations,
      ratesByKey: s.ratesByKey ?? {},
      projectSettings: s.projectSettings,
    }, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'layout.json'; a.click()
    URL.revokeObjectURL(url)
  }

  function handleLoadFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try { loadProject(JSON.parse(ev.target.result)) }
      catch {
        dialog.alert('Could not load this file. Please make sure it is a valid project JSON export.', { title: 'Invalid file' })
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function handleSaveProject() {
    const id = getCurrentProjectId()
    if (!id) { setTool('projects'); return }
    const s = useStore.getState()
    const ok = saveCurrent(id, {
      version: 7, nodes: s.nodes, walls: s.walls, rooms: s.rooms, stamps: s.stamps,
      columns: s.columns, beams: s.beams, slabs: s.slabs, staircases: s.staircases,
      foundations: s.foundations, ratesByKey: s.ratesByKey ?? {},
      projectSettings: s.projectSettings,
    })
    if (ok === false) toast.error('Could not save — storage quota exceeded.')
    else toast.success('Project saved.')
  }

  // Helper: tool button (icon-only, primary when active, ghost otherwise)
  const toolBtn = (toolId, Icon, title) => (
    <Button
      size="sm"
      variant={activeTool === toolId ? 'primary' : 'ghost'}
      title={title}
      onClick={() => setTool(toolId)}
    >
      <Icon size={ICON_SIZE} strokeWidth={ICON_STROKE} />
    </Button>
  )

  return (
    <div className="toolbar">
      {/* Cluster 1 — Draw */}
      <div className="toolbar-cluster">
        {toolBtn('draw',   Pencil,         'Draw walls (D)')}
        {toolBtn('select', MousePointer2,  'Select (S)')}
        {toolBtn('split',  Scissors,       'Split wall')}
        {toolBtn('room',   Hexagon,        'Room (R)')}
      </div>

      <div className="toolbar-divider" />

      {/* Cluster 2 — Structural & Civil */}
      <div className="toolbar-cluster">
        {toolBtn('column',        Columns3,            'Column')}
        {toolBtn('beam',          RectangleHorizontal, 'Beam')}
        {toolBtn('slabs',         LayoutGrid,          'Slabs')}
        {toolBtn('foundations',   Anchor,              'Foundations')}
        {toolBtn('stairs',        Stamp,               'Stairs')}
        {toolBtn('lift',          ArrowDownUp,         'Lift')}
        {toolBtn('plumbing',      Droplet,             'Plumbing (P)')}
        {toolBtn('sump',          Droplet,             'Sump')}
        {toolBtn('overhead_tank', Container,           'Overhead tank')}
        {toolBtn('septic_tank',   Cylinder,            'Septic tank')}
      </div>

      <div className="toolbar-divider" />

      {/* Cluster 3 — View & Settings */}
      <div className="toolbar-cluster">
        {toolBtn('floors',   Building2, 'Floors')}
        {toolBtn('bbs',      Ruler,     'BBS')}
        {toolBtn('iso',      Box,       '3D View (Ctrl+3)')}
        {toolBtn('settings', Settings,  'Settings')}

        <Button
          size="sm"
          variant={showDimensions ? 'primary' : 'ghost'}
          title="Show/hide wall dimensions"
          onClick={toggleShowDimensions}
        >
          <Ruler size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </Button>

        <Button
          size="sm"
          variant={drawVirtual ? 'primary' : 'ghost'}
          title="Draw open-plan boundary lines (excluded from BOQ)"
          onClick={toggleDrawVirtual}
        >
          <EyeOff size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </Button>

        <div className="toolbar-segmented">
          <Button
            size="sm"
            variant={unit === 'ft' ? 'primary' : 'ghost'}
            title="Display units in feet"
            onClick={() => setUnit('ft')}
          >
            ft
          </Button>
          <Button
            size="sm"
            variant={unit === 'm' ? 'primary' : 'ghost'}
            title="Display units in metres"
            onClick={() => setUnit('m')}
          >
            m
          </Button>
        </div>
      </div>

      <div className="toolbar-divider" />

      {/* Cluster 4 — Project */}
      <div className="toolbar-cluster">
        <Button
          size="sm"
          variant={activeTool === 'projects' ? 'primary' : 'ghost'}
          title="Open project list"
          onClick={() => setTool('projects')}
        >
          <FolderOpen size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </Button>

        <Button
          size="sm"
          variant={activeTool === 'revisions' ? 'primary' : 'ghost'}
          title="Revisions"
          onClick={() => setTool('revisions')}
        >
          <History size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </Button>

        <Button
          size="sm"
          variant="ghost"
          title="Save project (Ctrl+S)"
          onClick={handleSaveProject}
        >
          <Save size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </Button>

        <Button
          size="sm"
          variant="ghost"
          title="Import project from JSON"
          onClick={() => fileInputRef.current.click()}
        >
          <Upload size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </Button>

        <Button
          size="sm"
          variant="ghost"
          title="Export project as JSON"
          onClick={handleExportJson}
        >
          <Download size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </Button>

        <Button
          size="sm"
          variant="ghost"
          disabled={!history.length}
          title="Undo (Ctrl+Z)"
          onClick={undo}
        >
          <Undo2 size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </Button>

        <Button
          size="sm"
          variant="ghost"
          disabled={!future.length}
          title="Redo (Ctrl+Y)"
          onClick={redo}
        >
          <Redo2 size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </Button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleLoadFile}
        />
      </div>
    </div>
  )
}
