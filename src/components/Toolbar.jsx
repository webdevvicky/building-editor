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
  // Phase A Task 5 — snap toolbar surface. Subscribe at the top of the
  // component so hook order stays stable (the indicator branch reads `snap`,
  // the segmented branch with path='projectSettings.snap.pitchIn' uses
  // `setSnapSettings` to write the new pitch).
  const snap                = useStore(s => s.projectSettings?.snap)
  const setSnapSettings     = useStore(s => s.setSnapSettings)
  const setProjectSettings  = useStore(s => s.setProjectSettings)

  const fileInputRef = useRef(null)
  // Phase 4 Tier-2 Step 18 — separate file input for underlay imports
  // (different accept filter + handler) so the JSON import stays intact.
  const underlayInputRef = useRef(null)

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

  // Per-floor underlay import (Fix 3). Each floor owns its own asset blob
  // under a deterministic key: `${projectId}::underlay::${floorId}`. We
  // pass that floorId through to storeAsset via opts.assetId so the key is
  // stable across re-imports (replacing a floor's plan keeps the same key).
  // FIX 2 wires the multi-page page picker by pre-importing pdfRender and
  // checking numPages; we call selectPage() either automatically (1 page)
  // or by opening PDFPagePickerModal (>1 page) before storing.
  async function handleUnderlayImport(file) {
    if (!file) return
    try {
      const { importUnderlayFile } = await import('../underlay/pdfRender.js')
      const { storeAsset, deleteAsset, ASSET_TYPES }
        = await import('../projects/storage/assets.js')
      const { getAssetStorage }
        = await import('../projects/storage/getAssetStorage.js')
      const projectId = getCurrentProjectId() ?? 'orphan'
      const floorId   = useStore.getState().currentFloorId
      if (!floorId) {
        dialog.alert('No active floor — open Floors and select one first.', { title: 'No floor selected' })
        return
      }
      const result = await importUnderlayFile(file, {
        // FIX 2 — multi-page PDF page picker. When the PDF has >1 page,
        // importUnderlayFile returns { needsPagePicker: true, choosePage,
        // numPages, thumbnails } so we can prompt the user. Single-page
        // PDFs and images skip this branch entirely.
        async onMultiPage({ numPages, thumbnails, choosePage }) {
          // Mount the modal via the imperative dialog primitive? No — we
          // need a dedicated thumbnails UI. Mount through the page-picker
          // request channel: store the pending request and let the modal
          // component drive the choice.
          return new Promise((resolve) => {
            const detail = { numPages, thumbnails, resolve, choosePage }
            window.dispatchEvent(new CustomEvent('underlay:page-picker', { detail }))
          })
        },
      })
      if (result == null) return  // user cancelled the page picker
      const storage = getAssetStorage()
      // If this floor already had an underlay, drop its blob first so we
      // don't strand orphaned assets when the new storeAsset overwrites.
      const prev = useStore.getState().projectSettings?.floors?.find(f => f.id === floorId)?.underlay
      if (prev?.storageKey && prev.storageKey !== `${projectId}::underlay::${floorId}`) {
        try { await deleteAsset(storage, prev.storageKey) } catch { /* swallow */ }
      }
      const storageKey = await storeAsset(
        storage, projectId, ASSET_TYPES.UNDERLAY, result.dataUrl,
        {
          assetId:          floorId,   // deterministic key per floor
          mimeType:         result.mimeType,
          originalFileName: result.originalFileName,
          naturalSize:      { wPx: result.wPx, hPx: result.hPx },
        },
      )
      useStore.getState().setUnderlay({
        kind:             result.kind,
        storageKey,
        originalFileName: result.originalFileName,
        naturalSize:      { wPx: result.wPx, hPx: result.hPx },
        placement:        { xIn: 0, yIn: 0, rotationDeg: 0 },
        calibration:      null,
        opacity:          0.35,
        visible:          true,
        pageNumber:       result.pageNumber ?? null,
      }, floorId)
      toast.success(`Imported ${result.originalFileName}. Run "Calibrate scale" next.`)
    } catch (err) {
      console.error(err)
      dialog.alert(
        `Could not import "${file.name}". Make sure it is a valid PDF or image.`,
        { title: 'Underlay import failed' }
      )
    }
  }

  async function handleUnderlayClear() {
    const floorId = useStore.getState().currentFloorId
    const u = useStore.getState().projectSettings?.floors?.find(f => f.id === floorId)?.underlay
    if (!u) return
    const ok = await dialog.confirm(
      `Remove the imported floor plan "${u.originalFileName ?? 'underlay'}" from this floor?`,
      { title: 'Clear underlay', confirmLabel: 'Remove', variant: 'danger' }
    )
    if (!ok) return
    try {
      const { deleteAsset } = await import('../projects/storage/assets.js')
      const { getAssetStorage } = await import('../projects/storage/getAssetStorage.js')
      if (u.storageKey) await deleteAsset(getAssetStorage(), u.storageKey)
    } catch { /* swallow */ }
    useStore.getState().clearUnderlay(floorId)
    toast.success('Underlay cleared from this floor.')
  }

  const ACTION_HANDLERS = {
    save:   handleSaveProject,
    import: () => fileInputRef.current?.click(),
    export: handleExportJson,
    undo,
    redo,
    underlay_import: () => underlayInputRef.current?.click(),
    underlay_clear:  handleUnderlayClear,
  }

  const ACTION_DISABLED = {
    undo: history.length === 0,
    redo: future.length === 0,
  }

  // ── Path-based read/write (used by `toggle` and `segmented` items that
  // carry an optional `path` field instead of a flat top-level storeKey).
  // Resolves a dotted path against the current store snapshot for reading,
  // and dispatches to a specialized setter for writing.
  function readPath(path) {
    if (!path) return undefined
    const s = useStore.getState()
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), s)
  }

  function writePath(path, value) {
    // Phase A — snap pitch is the only path we route today. New paths add
    // a single switch case here mapping to their specialized setter.
    if (path === 'projectSettings.snap.pitchIn') {
      setSnapSettings({ pitchIn: value })
      return
    }
    if (path === 'projectSettings.snap.enabled') {
      setSnapSettings({ enabled: !!value })
      return
    }
    // Fallback: nest the value under projectSettings.<key> via the generic
    // setter. This will only be hit if a future config entry adds a new
    // path without registering its setter — emit a warning so we notice.
    console.warn(`toolbar path "${path}" — no specialized setter; using setProjectSettings fallback`)
    const segs = path.split('.')
    if (segs[0] === 'projectSettings' && segs.length === 2) {
      setProjectSettings({ [segs[1]]: value })
    }
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
      // Path-driven toggle (e.g. projectSettings.snap.enabled) OR legacy
      // flat-storeKey toggle (showDimensions, drawVirtual).
      if (item.path) {
        const checked = !!readPath(item.path)
        return (
          <DropdownToggle
            key={key}
            icon={item.icon}
            label={item.label}
            checked={checked}
            onToggle={() => writePath(item.path, !checked)}
          />
        )
      }
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
      // Path-driven segmented (e.g. projectSettings.snap.pitchIn) OR
      // legacy flat-storeKey segmented ('unit'). Same options array shape
      // in both cases.
      if (item.path) {
        return (
          <DropdownSegmented
            key={key}
            options={item.options}
            value={readPath(item.path)}
            onChange={v => writePath(item.path, v)}
          />
        )
      }
      return (
        <DropdownSegmented
          key={key}
          options={item.options}
          value={unit}
          onChange={setUnit}
        />
      )
    }
    if (item.type === 'indicator') {
      // Read-only status badge. Currently only the snap indicator exists —
      // it reflects projectSettings.snap.enabled + pitchIn live.
      if (item.indicatorId === 'snap') {
        const text = snap?.enabled
          ? `SNAP ${snap.pitchIn}"`
          : 'SNAP OFF'
        const Icon = item.icon
        return (
          <div
            key={key}
            className="ui-toolbar__indicator"
            data-snap-on={snap?.enabled ? 'true' : 'false'}
            title="Toggle snap with F9; configure in Project Settings → Snap"
          >
            {Icon && <Icon size={14} strokeWidth={2} />}
            <span>{text}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </div>
        )
      }
      return null
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
      <input
        ref={underlayInputRef}
        type="file"
        accept="image/*,.pdf"
        style={{ display: 'none' }}
        onChange={e => {
          const f = e.target.files?.[0]
          handleUnderlayImport(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}
