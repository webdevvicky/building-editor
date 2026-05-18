// Toolbar — grouped cluster dropdowns. Each cluster button opens a flyout
// listing its tools as labeled rows with keyboard shortcuts. The tool registry
// lives in ./toolbarConfig.js so adding a new tool is a one-entry data change.
//
// Active-tool highlighting happens at TWO levels:
//   - The cluster trigger button uses variant="primary" when any of its tools
//     is the currently-active tool (via collectToolIds + activeTool match).
//   - Inside the open flyout, the matching DropdownItem gets the
//     ui-dropdown__item--active class (primary-bg + bold).
//
// Keyboard shortcuts continue to work through src/hooks/useKeyboardShortcuts.js.
// The flyout shortcut chips are display-only reminders. When a shortcut fires
// elsewhere, useKeyboardShortcuts dispatches `toolbar:close-dropdowns` so any
// open flyout closes automatically.

import { useRef, Fragment } from 'react'
import { useStore } from '../store'
import { getCurrentProjectId, saveCurrent } from '../projects/manager'
import { dialog } from './ui/Dialog'
import { toast } from './ui/Toast'
import {
  Dropdown,
  DropdownGroup,
  DropdownItem,
  DropdownToggle,
  DropdownSegmented,
} from './ui/Dropdown'
import { TOOL_CLUSTERS, collectToolIds } from './toolbarConfig'
import './Toolbar.css'

const TOGGLE_ACTIONS = {
  showDimensions: 'toggleShowDimensions',
  drawVirtual:    'toggleDrawVirtual',
}

export default function Toolbar() {
  const activeTool          = useStore(s => s.activeTool)
  const showDimensions      = useStore(s => s.showDimensions)
  const drawVirtual         = useStore(s => s.drawVirtual)
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

  // ── One-shot action handlers ────────────────────────────────────────────

  function handleExportJson() {
    const s = useStore.getState()
    const data = JSON.stringify({
      version: 7, unit: 'inch',
      nodes: s.nodes, walls: s.walls, rooms: s.rooms, stamps: s.stamps,
      columns: s.columns, beams: s.beams, slabs: s.slabs, staircases: s.staircases,
      foundations: s.foundations,
      plumbingFixtures: s.plumbingFixtures, electricalPoints: s.electricalPoints,
      hvacUnits: s.hvacUnits, fireDevices: s.fireDevices, elvDevices: s.elvDevices,
      solarEquipment: s.solarEquipment, risers: s.risers,
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
        dialog.alert(
          'Could not load this file. Please make sure it is a valid project JSON export.',
          { title: 'Invalid file' }
        )
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
      version: 7,
      nodes: s.nodes, walls: s.walls, rooms: s.rooms, stamps: s.stamps,
      columns: s.columns, beams: s.beams, slabs: s.slabs, staircases: s.staircases,
      foundations: s.foundations,
      plumbingFixtures: s.plumbingFixtures, electricalPoints: s.electricalPoints,
      hvacUnits: s.hvacUnits, fireDevices: s.fireDevices, elvDevices: s.elvDevices,
      solarEquipment: s.solarEquipment, risers: s.risers,
      ratesByKey: s.ratesByKey ?? {},
      projectSettings: s.projectSettings,
    })
    if (ok === false) toast.error('Could not save — storage quota exceeded.')
    else toast.success('Project saved.')
  }

  const ACTION_HANDLERS = {
    save:   handleSaveProject,
    import: () => fileInputRef.current?.click(),
    export: handleExportJson,
    undo,
    redo,
  }

  const ACTION_DISABLED = {
    undo: history.length === 0,
    redo: future.length === 0,
  }

  // ── Item dispatch ───────────────────────────────────────────────────────

  function renderItem(item, key) {
    if (item.type === 'tool') {
      return (
        <DropdownItem
          key={key}
          icon={item.icon}
          label={item.label}
          shortcut={item.shortcut}
          active={activeTool === item.toolId}
          onSelect={() => setTool(item.toolId)}
        />
      )
    }
    if (item.type === 'toggle') {
      const checked = { showDimensions, drawVirtual }[item.storeKey]
      const handler = { showDimensions: toggleShowDimensions, drawVirtual: toggleDrawVirtual }[item.storeKey]
      return (
        <DropdownToggle
          key={key}
          icon={item.icon}
          label={item.label}
          checked={checked}
          onToggle={handler}
        />
      )
    }
    if (item.type === 'segmented') {
      return (
        <DropdownSegmented
          key={key}
          options={item.options}
          value={unit}
          onChange={setUnit}
        />
      )
    }
    if (item.type === 'action') {
      return (
        <DropdownItem
          key={key}
          icon={item.icon}
          label={item.label}
          shortcut={item.shortcut}
          disabled={ACTION_DISABLED[item.actionId] ?? false}
          onSelect={ACTION_HANDLERS[item.actionId]}
        />
      )
    }
    return null
  }

  function clusterIsActive(cluster) {
    return collectToolIds(cluster).includes(activeTool)
  }

  return (
    <div className="toolbar">
      {TOOL_CLUSTERS.map(cluster => (
        <Dropdown
          key={cluster.id}
          label={cluster.label}
          isActive={clusterIsActive(cluster)}
        >
          {cluster.groups
            ? cluster.groups.map(group => (
                <DropdownGroup key={group.title} title={group.title}>
                  {group.items.map((item, i) => (
                    <Fragment key={i}>{renderItem(item, i)}</Fragment>
                  ))}
                </DropdownGroup>
              ))
            : cluster.items.map((item, i) => (
                <Fragment key={i}>{renderItem(item, i)}</Fragment>
              ))
          }
        </Dropdown>
      ))}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleLoadFile}
      />
    </div>
  )
}
