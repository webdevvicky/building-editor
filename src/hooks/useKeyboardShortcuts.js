import { useEffect } from 'react'
import { useStore } from '../store'
import { dialog } from '../components/ui/Dialog'
import { toast } from '../components/ui/Toast'
import { getCurrentProjectId, saveCurrent } from '../projects/manager'

/**
 * Mount-once global keyboard shortcuts. Listens on `window` for keydown.
 *
 * Form-aware: typing inside <input>/<textarea>/<select>/contenteditable
 * suppresses bare-key shortcuts (Esc / Delete / D / S / R) but NOT
 * modifier shortcuts (Ctrl/Cmd + Z/Y/S) — those work everywhere by design.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    function onKeyDown(e) {
      const t = e.target
      const tag = t?.tagName
      const inForm =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        t?.isContentEditable === true

      const mod = e.ctrlKey || e.metaKey
      const key = e.key

      // ── Modifier shortcuts (always-active) ────────────────────────────
      // Ctrl+Shift+Z / Cmd+Shift+Z → redo  (check before plain Ctrl+Z)
      if (mod && e.shiftKey && (key === 'z' || key === 'Z')) {
        e.preventDefault()
        useStore.getState().redo?.()
        return
      }
      // Ctrl+Y / Cmd+Y → redo
      if (mod && !e.shiftKey && (key === 'y' || key === 'Y')) {
        e.preventDefault()
        useStore.getState().redo?.()
        return
      }
      // Ctrl+Z / Cmd+Z → undo
      if (mod && !e.shiftKey && (key === 'z' || key === 'Z')) {
        e.preventDefault()
        useStore.getState().undo?.()
        return
      }
      // Ctrl+S / Cmd+S → save
      if (mod && !e.shiftKey && (key === 's' || key === 'S')) {
        e.preventDefault()
        handleSave()
        return
      }
      // Ctrl+B / Cmd+B → toggle BOQ sidebar (BOQPanel listens on window)
      if (mod && !e.shiftKey && (key === 'b' || key === 'B')) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('boq:toggle'))
        return
      }
      // Ctrl+3 / Cmd+3 → open 2.5D iso view
      if (mod && !e.shiftKey && key === '3') {
        e.preventDefault()
        useStore.getState().setTool?.('iso')
        return
      }

      // ── Form-input-aware shortcuts below ──────────────────────────────
      if (inForm) return

      if (key === 'Escape') {
        e.preventDefault()
        handleEscape()
        return
      }
      if (key === 'Delete' || key === 'Backspace') {
        e.preventDefault()
        handleDelete()
        return
      }
      if (key === 'd' || key === 'D') {
        e.preventDefault()
        useStore.getState().setTool?.('draw')
        return
      }
      if (key === 's' || key === 'S') {
        e.preventDefault()
        useStore.getState().setTool?.('select')
        return
      }
      if (key === 'r' || key === 'R') {
        e.preventDefault()
        useStore.getState().setTool?.('room')
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

// ── Helpers ─────────────────────────────────────────────────────────────

function handleEscape() {
  // setTool('select') already clears every selectedXId + selectedWallIds.
  // Calling it unconditionally also closes any modal panel opened by
  // activeTool (foundations/floors/bbs/settings/projects/slabs/...).
  useStore.getState().setTool?.('select')
}

async function handleDelete() {
  const s = useStore.getState()
  let entityType, entityId, entityLabel, deleteFn

  if (s.selectedWallId) {
    entityType = 'wall'
    entityId = s.selectedWallId
    entityLabel = 'wall'
    deleteFn = () => useStore.getState().deleteWall?.(entityId)
  } else if (s.selectedRoomId) {
    entityType = 'room'
    entityId = s.selectedRoomId
    const r = s.rooms?.[entityId]
    entityLabel = r ? `room "${r.name || 'Untitled'}"` : 'room'
    deleteFn = () => useStore.getState().deleteRoom?.(entityId)
  } else if (s.selectedColumnId) {
    entityType = 'column'
    entityId = s.selectedColumnId
    entityLabel = 'column'
    deleteFn = () => {
      useStore.getState().deleteColumn?.(entityId)
      useStore.getState().selectColumn?.(null)
    }
  } else if (s.selectedBeamId) {
    entityType = 'beam'
    entityId = s.selectedBeamId
    entityLabel = 'beam'
    deleteFn = () => {
      useStore.getState().deleteBeam?.(entityId)
      useStore.getState().selectBeam?.(null)
    }
  } else if (s.selectedStampId) {
    entityType = 'stamp'
    entityId = s.selectedStampId
    entityLabel = 'stamp'
    deleteFn = () => useStore.getState().deleteStamp?.(entityId)
  } else if (s.selectedWallIds?.length) {
    entityType = 'walls'
    entityLabel = `${s.selectedWallIds.length} walls`
    const ids = [...s.selectedWallIds]
    deleteFn = () => {
      const del = useStore.getState().deleteWall
      if (!del) return
      ids.forEach((id) => del(id))
    }
  }

  if (!deleteFn) return

  const ok = await dialog.confirm(`Delete this ${entityLabel}?`, {
    title: `Delete ${entityType}`,
    confirmLabel: 'Delete',
    variant: 'danger',
  })
  if (!ok) return

  deleteFn()

  toast.action(`Deleted ${entityLabel}.`, {
    label: 'Undo',
    onClick: () => useStore.getState().undo?.(),
    duration: 5000,
  })
}

function handleSave() {
  // Mirrors Toolbar.jsx → handleSaveProject so there's a single save shape.
  const id = getCurrentProjectId()
  if (!id) {
    useStore.getState().setTool?.('projects')
    return
  }
  const s = useStore.getState()
  const ok = saveCurrent(id, {
    version: 7,
    nodes: s.nodes,
    walls: s.walls,
    rooms: s.rooms,
    stamps: s.stamps,
    columns: s.columns,
    beams: s.beams,
    slabs: s.slabs,
    staircases: s.staircases,
    foundations: s.foundations,
    ratesByKey: s.ratesByKey ?? {},
    projectSettings: s.projectSettings,
  })
  if (ok === false) toast.error('Could not save — storage quota exceeded.')
  else toast.success('Project saved.')
}
