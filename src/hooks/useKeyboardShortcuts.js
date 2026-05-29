import { useEffect } from 'react'
import { useStore } from '../store'
import { dialog } from '../components/ui/Dialog'
import { toast } from '../components/ui/Toast'
import { getCurrentProjectId, saveCurrent } from '../projects/manager'

// Close any open toolbar dropdown via the decoupled window-event pattern
// (the Dropdown primitive listens for this event). Mirrors the boq:toggle
// pattern used for the BOQ panel collapse — see CLAUDE.md.
function closeDropdowns() {
  window.dispatchEvent(new CustomEvent('toolbar:close-dropdowns'))
}

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
        closeDropdowns()
        return
      }
      // Ctrl+Y / Cmd+Y → redo
      if (mod && !e.shiftKey && (key === 'y' || key === 'Y')) {
        e.preventDefault()
        useStore.getState().redo?.()
        closeDropdowns()
        return
      }
      // Ctrl+Z / Cmd+Z → undo
      if (mod && !e.shiftKey && (key === 'z' || key === 'Z')) {
        e.preventDefault()
        useStore.getState().undo?.()
        closeDropdowns()
        return
      }
      // Ctrl+S / Cmd+S → save
      if (mod && !e.shiftKey && (key === 's' || key === 'S')) {
        e.preventDefault()
        handleSave()
        closeDropdowns()
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
        closeDropdowns()
        return
      }

      // ── Form-input-aware shortcuts below ──────────────────────────────
      if (inForm) return

      if (key === 'Escape') {
        e.preventDefault()
        handleEscape()
        closeDropdowns()
        return
      }
      // Area 2A — Enter ends wall chain in draw tool. Canvas listens for
      // this window event (see canvas:end-chain in Canvas.jsx) so the
      // keyboard hook stays decoupled from concrete component state.
      if (key === 'Enter' && useStore.getState().activeTool === 'draw') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('canvas:end-chain'))
        return
      }
      if (key === 'Delete' || key === 'Backspace') {
        e.preventDefault()
        handleDelete()
        closeDropdowns()
        return
      }
      if (key === 'd' || key === 'D') {
        e.preventDefault()
        useStore.getState().setTool?.('draw')
        closeDropdowns()
        return
      }
      if (key === 's' || key === 'S') {
        e.preventDefault()
        useStore.getState().setTool?.('select')
        closeDropdowns()
        return
      }
      if (key === 'r' || key === 'R') {
        e.preventDefault()
        // Area 2B — Shift+R picks the rectangle-room tool.
        useStore.getState().setTool?.(e.shiftKey ? 'rect_room' : 'room')
        closeDropdowns()
        return
      }
      // Phase R1 — Shift+A picks the room_detect tool. Bare A is reserved
      // (intentional future-territory; not bound here).
      if ((key === 'a' || key === 'A') && e.shiftKey) {
        e.preventDefault()
        useStore.getState().setTool?.('room_detect')
        closeDropdowns()
        return
      }
      // BBS-5 — Shift+B opens the BBS Schedule panel. Bare B is unbound
      // (Ctrl+B toggles BOQ — handled in the modifier section above).
      if ((key === 'b' || key === 'B') && e.shiftKey && !mod) {
        e.preventDefault()
        useStore.getState().setTool?.('bbs_schedule')
        closeDropdowns()
        return
      }
      // Phase W follow-up — bare J picks the Manual Join tool.
      if (key === 'j' || key === 'J') {
        e.preventDefault()
        useStore.getState().setTool?.('join_walls')
        closeDropdowns()
        return
      }
      if (key === 'p' || key === 'P') {
        e.preventDefault()
        useStore.getState().setTool?.('plumbing')
        closeDropdowns()
        return
      }
      if (key === 'e' || key === 'E') {
        e.preventDefault()
        useStore.getState().setTool?.('electrical')
        closeDropdowns()
        return
      }
      if (key === 'h' || key === 'H') {
        e.preventDefault()
        useStore.getState().setTool?.('hvac')
        closeDropdowns()
        return
      }
      if (key === 'f' || key === 'F') {
        e.preventDefault()
        useStore.getState().setTool?.('fire')
        closeDropdowns()
        return
      }
      if (key === 'l' || key === 'L') {
        e.preventDefault()
        useStore.getState().setTool?.('elv')
        closeDropdowns()
        return
      }
      // Phase A Task 5 — F9 toggles snap globally. Canvas component
      // listens for the `snap:toggle` window event and performs the
      // actual store flip (kept there because Canvas owns its own
      // bypass-key state too). We just dispatch and then schedule a
      // toast read the next tick so it reflects the new value.
      if (key === 'F9') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('snap:toggle'))
        setTimeout(() => {
          const onNow = !!useStore.getState().projectSettings?.snap?.enabled
          toast.info(`Snap ${onNow ? 'on' : 'off'}`)
        }, 0)
        closeDropdowns()
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

  // Opening selection takes priority — a door/window is a sub-entity of a
  // wall, so when the user has explicitly clicked one we delete the opening,
  // not the parent wall.
  if (s.selectedOpening?.wallId && s.selectedOpening?.openingId) {
    const { wallId, openingId } = s.selectedOpening
    const wall = s.walls?.[wallId]
    const op   = (wall?.openings ?? []).find(o => o.id === openingId)
    entityType  = op?.type === 'window' ? 'window' : 'door'
    entityId    = openingId
    entityLabel = entityType
    deleteFn = () => {
      useStore.getState().removeOpening?.(wallId, openingId)
      useStore.getState().selectOpening?.(null, null)
    }
  } else if (s.selectedWallId) {
    entityType = 'wall'
    entityId = s.selectedWallId
    entityLabel = 'wall'
    deleteFn = () => useStore.getState().deleteWall?.(entityId)
    // Return value carries { purgedRoomIds, purgedRoomNames } so the
    // toast below can upgrade to persistent when rooms went with it.
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
  } else if (s.selectedHvacUnitId) {
    entityType = 'hvac unit'
    entityId = s.selectedHvacUnitId
    entityLabel = 'HVAC unit'
    deleteFn = () => {
      useStore.getState().deleteHvacUnit?.(entityId)
      useStore.getState().selectHvacUnit?.(null)
    }
  } else if (s.selectedFireDeviceId) {
    entityType = 'fire device'
    entityId = s.selectedFireDeviceId
    entityLabel = 'fire device'
    deleteFn = () => {
      useStore.getState().deleteFireDevice?.(entityId)
      useStore.getState().selectFireDevice?.(null)
    }
  } else if (s.selectedElvDeviceId) {
    entityType = 'ELV device'
    entityId = s.selectedElvDeviceId
    entityLabel = 'ELV device'
    deleteFn = () => {
      useStore.getState().deleteElvDevice?.(entityId)
      useStore.getState().selectElvDevice?.(null)
    }
  } else if (s.selectedWallIds?.length) {
    entityType = 'walls'
    entityLabel = `${s.selectedWallIds.length} walls`
    const ids = [...s.selectedWallIds]
    deleteFn = () => {
      const del = useStore.getState().deleteWall
      if (!del) return { purgedRoomNames: [] }
      const acc = []
      for (const id of ids) {
        const r = del(id)
        if (r && Array.isArray(r.purgedRoomNames)) acc.push(...r.purgedRoomNames)
      }
      return { purgedRoomNames: acc }
    }
  }

  if (!deleteFn) return

  const ok = await dialog.confirm(`Delete this ${entityLabel}?`, {
    title: `Delete ${entityType}`,
    confirmLabel: 'Delete',
    variant: 'danger',
  })
  if (!ok) return

  const result = deleteFn()
  const purgedRoomNames = Array.isArray(result?.purgedRoomNames) ? result.purgedRoomNames : []

  if (purgedRoomNames.length > 0) {
    // Persistent (sticky) toast — the consequence (lost room + name/type/
    // finishes/MEP customization) is bigger than a plain wall delete.
    // Single Undo restores both the wall and the purged rooms atomically.
    const list = purgedRoomNames.map(n => `"${n}"`).join(', ')
    const roomWord = purgedRoomNames.length === 1 ? 'room' : 'rooms'
    toast.action(
      `Deleted ${entityLabel} — also removed ${purgedRoomNames.length} ${roomWord}: ${list}.`,
      {
        label: 'Undo',
        onClick: () => useStore.getState().undo?.(),
        duration: null,
      }
    )
  } else {
    toast.action(`Deleted ${entityLabel}.`, {
      label: 'Undo',
      onClick: () => useStore.getState().undo?.(),
      duration: 5000,
    })
  }
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
