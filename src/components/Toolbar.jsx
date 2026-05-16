import { useRef } from 'react'
import { useStore } from '../store'
import { getCurrentProjectId, saveCurrent } from '../projects/manager'

const TOOLS = [
  { id: 'draw',   label: '✏ Draw' },
  { id: 'select', label: '↖ Select' },
  { id: 'split',  label: '✂ Split' },
  { id: 'room',   label: '⬡ Room' },
  { id: 'stairs',        label: '⬜ Stairs' },
  { id: 'lift',          label: '⬛ Lift' },
  { id: 'sump',          label: '⬜ Sump' },
  { id: 'overhead_tank', label: '⬜ OHT' },
  { id: 'septic_tank',   label: '⬜ Septic' },
  { id: 'column',        label: '⬛ Column' },
  { id: 'beam',          label: '— Beam' },
  { id: 'slabs',         label: '▦ Slabs' },
  { id: 'foundations',   label: '▭ Foundations' },
  { id: 'floors',        label: '▤ Floors' },
  { id: 'bbs',           label: '∥ BBS' },
  { id: 'settings',      label: '⚙ Settings' },
]

const btn = (active, color) => ({
  padding: '6px 14px',
  borderRadius: 6,
  border: `1px solid ${color || '#ccc'}`,
  background: active ? (color || '#333') : '#fff',
  color: active ? '#fff' : (color || '#333'),
  cursor: 'pointer',
  fontWeight: 500,
  fontSize: 13,
})

const actionBtn = {
  padding: '6px 14px',
  borderRadius: 6,
  border: '1px solid #ccc',
  background: '#fff',
  color: '#333',
  cursor: 'pointer',
  fontWeight: 500,
  fontSize: 13,
}

const divider = <div style={{ width: 1, background: '#ddd', margin: '0 4px' }} />

export default function Toolbar() {
  const activeTool          = useStore(s => s.activeTool)
  const drawVirtual         = useStore(s => s.drawVirtual)
  const showDimensions      = useStore(s => s.showDimensions)
  const unit                = useStore(s => s.unit)
  const history             = useStore(s => s.history)
  const future              = useStore(s => s.future)
  const nodes               = useStore(s => s.nodes)
  const walls               = useStore(s => s.walls)
  const rooms               = useStore(s => s.rooms)
  const stamps              = useStore(s => s.stamps)
  const setTool             = useStore(s => s.setTool)
  const toggleDrawVirtual   = useStore(s => s.toggleDrawVirtual)
  const toggleShowDimensions = useStore(s => s.toggleShowDimensions)
  const setUnit             = useStore(s => s.setUnit)
  const undo                = useStore(s => s.undo)
  const redo                = useStore(s => s.redo)
  const loadProject         = useStore(s => s.loadProject)

  const fileInputRef = useRef(null)

  function handleSave() {
    const s = useStore.getState()
    const data = JSON.stringify({
      version: 6, unit: 'inch',
      nodes: s.nodes, walls: s.walls, rooms: s.rooms, stamps: s.stamps,
      columns: s.columns, beams: s.beams, slabs: s.slabs, staircases: s.staircases,
      foundations: s.foundations,
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
      catch { alert('Invalid JSON file') }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div style={{
      position: 'absolute', top: 12, left: 12,
      display: 'flex', gap: 6, zIndex: 10, flexWrap: 'wrap',
    }}>
      {/* Undo / Redo */}
      <button onClick={undo} disabled={!history.length} title="Undo (Ctrl+Z)"
        style={{ ...actionBtn, opacity: history.length ? 1 : 0.4, padding: '6px 10px' }}>↩</button>
      <button onClick={redo} disabled={!future.length} title="Redo (Ctrl+Y)"
        style={{ ...actionBtn, opacity: future.length ? 1 : 0.4, padding: '6px 10px' }}>↪</button>

      {divider}

      {/* Tool buttons */}
      {TOOLS.map(t => (
        <button key={t.id} onClick={() => setTool(t.id)} style={btn(activeTool === t.id)}>
          {t.label}
        </button>
      ))}

      {/* Virtual toggle — only when Draw is active */}
      {activeTool === 'draw' && <>
        {divider}
        <button onClick={toggleDrawVirtual} title="Draw open-plan boundary lines (excluded from BOQ)"
          style={{ ...btn(drawVirtual, '#888'), border: '1px dashed #999' }}>
          ┅ Virtual
        </button>
      </>}

      {divider}

      {/* Dimensions toggle */}
      <button onClick={toggleShowDimensions} title="Show/hide wall dimensions"
        style={btn(showDimensions, '#4a90e2')}>
        📐 Dims
      </button>

      {/* Unit toggle */}
      <div style={{ display: 'flex', border: '1px solid #ccc', borderRadius: 6, overflow: 'hidden' }}>
        <button onClick={() => setUnit('ft')}
          style={{ padding: '6px 10px', background: unit === 'ft' ? '#333' : '#fff',
            color: unit === 'ft' ? '#fff' : '#333', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
          ft
        </button>
        <button onClick={() => setUnit('m')}
          style={{ padding: '6px 10px', background: unit === 'm' ? '#333' : '#fff',
            color: unit === 'm' ? '#fff' : '#333', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500,
            borderLeft: '1px solid #ccc' }}>
          m
        </button>
      </div>

      {divider}

      {/* Projects (Phase 2.0) — multi-project localStorage with autosave */}
      <button style={actionBtn} onClick={() => setTool('projects')} title="Open project list">📁 Projects</button>
      <button style={actionBtn} title="Save current project (autosaved every 30s)"
        onClick={() => {
          const id = getCurrentProjectId()
          if (!id) { setTool('projects'); return }
          const s = useStore.getState()
          saveCurrent(id, {
            version: 7, nodes: s.nodes, walls: s.walls, rooms: s.rooms, stamps: s.stamps,
            columns: s.columns, beams: s.beams, slabs: s.slabs, staircases: s.staircases,
            foundations: s.foundations, projectSettings: s.projectSettings,
          })
        }}
      >💾 Save</button>

      {/* Legacy JSON Save / Load — retained for portability */}
      <button style={actionBtn} onClick={handleSave} title="Download project as JSON">⇩ JSON</button>
      <button style={actionBtn} onClick={() => fileInputRef.current.click()} title="Load project from JSON">⇪ JSON</button>
      <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleLoadFile}/>
    </div>
  )
}
