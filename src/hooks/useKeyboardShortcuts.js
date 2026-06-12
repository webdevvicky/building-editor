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

// ── Single source of truth for keyboard shortcuts ─────────────────────────
//
// This array is BOTH the dispatch table (the hook below iterates it on every
// keydown and runs the first match) AND the display source consumed by the
// in-app Getting Started guide (HelpGuide.jsx imports KEYBOARD_SHORTCUTS and
// renders `combo` + `label`). Because the handler dispatches from the same
// array the guide renders, the two can never drift — add a shortcut here and
// it appears in Help automatically.
//
// Entry shape:
//   group          display bucket (HelpGuide groups by this)
//   combo          human-readable key combo (display only)
//   label          what the shortcut does (display only)
//   allowInForm    when true, fires even while typing in an input/textarea/
//                  select/contenteditable. Modifier shortcuts opt in; bare-key
//                  shortcuts do not (mirrors the old `if (inForm) return` gate).
//   closeDropdowns when false, the matched shortcut does NOT dispatch
//                  toolbar:close-dropdowns (Ctrl/Cmd+B and Enter preserve the
//                  original behaviour of returning without closing flyouts).
//   when(e, env)   predicate; env = { mod } where mod = ctrlKey || metaKey.
//   run(e, env)    the action to perform.
//
// ORDER IS LOAD-BEARING: the hook runs the FIRST matching entry, so modifier
// shortcuts are listed before the bare-key ones they would otherwise shadow
// (e.g. Ctrl/Cmd+S must precede bare S). Do not reorder casually.
export const KEYBOARD_SHORTCUTS = Object.freeze([
  // ── Modifier shortcuts — fire everywhere, including form inputs ──────────
  {
    group: 'History & project',
    combo: 'Ctrl/Cmd + Shift + Z',
    label: 'Redo',
    allowInForm: true,
    when: (e, { mod }) => mod && e.shiftKey && (e.key === 'z' || e.key === 'Z'),
    run: () => useStore.getState().redo?.(),
  },
  {
    group: 'History & project',
    combo: 'Ctrl/Cmd + Y',
    label: 'Redo',
    allowInForm: true,
    when: (e, { mod }) => mod && !e.shiftKey && (e.key === 'y' || e.key === 'Y'),
    run: () => useStore.getState().redo?.(),
  },
  {
    group: 'History & project',
    combo: 'Ctrl/Cmd + Z',
    label: 'Undo',
    allowInForm: true,
    when: (e, { mod }) => mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z'),
    run: () => useStore.getState().undo?.(),
  },
  {
    group: 'History & project',
    combo: 'Ctrl/Cmd + S',
    label: 'Save project',
    allowInForm: true,
    when: (e, { mod }) => mod && !e.shiftKey && (e.key === 's' || e.key === 'S'),
    run: () => handleSave(),
  },
  {
    group: 'View',
    combo: 'Ctrl/Cmd + B',
    label: 'Collapse / expand the BOQ sidebar',
    allowInForm: true,
    closeDropdowns: false,
    when: (e, { mod }) => mod && !e.shiftKey && (e.key === 'b' || e.key === 'B'),
    run: () => window.dispatchEvent(new CustomEvent('boq:toggle')),
  },
  {
    group: 'View',
    combo: 'Ctrl/Cmd + 3',
    label: 'Open the 3D view',
    allowInForm: true,
    when: (e, { mod }) => mod && !e.shiftKey && e.key === '3',
    run: () => useStore.getState().setTool?.('iso'),
  },

  // ── Bare-key shortcuts — suppressed while typing in a form field ─────────
  {
    group: 'Editing',
    combo: 'Esc',
    label: 'Switch to Select · close the open panel · cancel the current draw',
    when: (e) => e.key === 'Escape',
    run: () => handleEscape(),
  },
  {
    group: 'Editing',
    combo: 'Enter',
    label: 'Finish the current wall chain (Draw tool)',
    closeDropdowns: false,
    when: (e) => e.key === 'Enter' && useStore.getState().activeTool === 'draw',
    run: () => window.dispatchEvent(new CustomEvent('canvas:end-chain')),
  },
  {
    group: 'Editing',
    combo: 'Delete / Backspace',
    label: 'Delete the current selection (asks to confirm, offers Undo)',
    when: (e) => e.key === 'Delete' || e.key === 'Backspace',
    run: () => handleDelete(),
  },
  {
    group: 'Tools',
    combo: 'D',
    label: 'Draw walls',
    when: (e) => e.key === 'd' || e.key === 'D',
    run: () => useStore.getState().setTool?.('draw'),
  },
  {
    group: 'Tools',
    combo: 'S',
    label: 'Select',
    when: (e) => e.key === 's' || e.key === 'S',
    run: () => useStore.getState().setTool?.('select'),
  },
  {
    // Bare R = the face-detect Room tool (room_detect). Shift+R below = the
    // rectangle-room fast-draw tool. Split into two entries so each combo
    // shows separately in Help; behaviour is identical to the old single
    // shift-branching handler.
    group: 'Tools',
    combo: 'R',
    label: 'Room — click a wall inside a closed loop to create the room',
    when: (e) => (e.key === 'r' || e.key === 'R') && !e.shiftKey,
    run: () => useStore.getState().setTool?.('room_detect'),
  },
  {
    group: 'Tools',
    combo: 'Shift + R',
    label: 'Rectangle room — click two opposite corners',
    when: (e) => (e.key === 'r' || e.key === 'R') && e.shiftKey,
    run: () => useStore.getState().setTool?.('rect_room'),
  },
  {
    group: 'Tools',
    combo: 'Shift + B',
    label: 'Open the BBS Schedule',
    when: (e, { mod }) => (e.key === 'b' || e.key === 'B') && e.shiftKey && !mod,
    run: () => useStore.getState().setTool?.('bbs_schedule'),
  },
  {
    group: 'Tools',
    combo: 'Shift + K',
    label: 'Open the Room-by-room BOQ breakdown',
    when: (e, { mod }) => (e.key === 'k' || e.key === 'K') && e.shiftKey && !mod,
    run: () => useStore.getState().setTool?.('room_breakdown'),
  },
  {
    group: 'Tools',
    combo: 'J',
    label: 'Join walls',
    when: (e) => e.key === 'j' || e.key === 'J',
    run: () => useStore.getState().setTool?.('join_walls'),
  },
  {
    group: 'MEP',
    combo: 'P',
    label: 'Plumbing',
    when: (e) => e.key === 'p' || e.key === 'P',
    run: () => useStore.getState().setTool?.('plumbing'),
  },
  {
    group: 'MEP',
    combo: 'E',
    label: 'Electrical',
    when: (e) => e.key === 'e' || e.key === 'E',
    run: () => useStore.getState().setTool?.('electrical'),
  },
  {
    group: 'MEP',
    combo: 'H',
    label: 'HVAC',
    when: (e) => e.key === 'h' || e.key === 'H',
    run: () => useStore.getState().setTool?.('hvac'),
  },
  {
    group: 'MEP',
    combo: 'F',
    label: 'Fire',
    when: (e) => e.key === 'f' || e.key === 'F',
    run: () => useStore.getState().setTool?.('fire'),
  },
  {
    group: 'MEP',
    combo: 'L',
    label: 'ELV (low-voltage)',
    when: (e) => e.key === 'l' || e.key === 'L',
    run: () => useStore.getState().setTool?.('elv'),
  },
  {
    // Phase A Task 5 — F9 toggles snap globally. Canvas listens for the
    // `snap:toggle` window event and performs the actual store flip (kept
    // there because Canvas owns its own bypass-key state too). We dispatch,
    // then read the new value the next tick for the toast.
    group: 'View',
    combo: 'F9',
    label: 'Toggle snapping on / off',
    when: (e) => e.key === 'F9',
    run: () => {
      window.dispatchEvent(new CustomEvent('snap:toggle'))
      setTimeout(() => {
        const onNow = !!useStore.getState().projectSettings?.snap?.enabled
        toast.info(`Snap ${onNow ? 'on' : 'off'}`)
      }, 0)
    },
  },
])

/**
 * Mount-once global keyboard shortcuts. Listens on `window` for keydown and
 * dispatches from the KEYBOARD_SHORTCUTS registry above (first match wins).
 *
 * Form-aware: typing inside <input>/<textarea>/<select>/contenteditable
 * suppresses bare-key shortcuts but NOT modifier shortcuts (those declare
 * `allowInForm: true`) — they work everywhere by design.
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

      const env = { mod: e.ctrlKey || e.metaKey }

      for (const sc of KEYBOARD_SHORTCUTS) {
        if (inForm && !sc.allowInForm) continue
        if (!sc.when(e, env)) continue
        e.preventDefault()
        sc.run(e, env)
        if (sc.closeDropdowns !== false) closeDropdowns()
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
  // activeTool (foundations/floors/bbs/settings/projects/slabs/help/...).
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
