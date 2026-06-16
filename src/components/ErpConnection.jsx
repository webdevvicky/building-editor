// ErpConnection — wires the existing cloud-sync UI into the app shell.
//
// Pure wiring (DRY): ConnectErpDialog + SyncStatusBadge are unchanged. This
// container owns the small amount of glue they need —
//   - the current project id (manager.js) + its persisted `cloud` connection
//     record (cloudConn.js), reloaded after connect / disconnect,
//   - the activeTool gate that opens the dialog (Project → "Connect to ERP"
//     sets activeTool='connect_erp', mirroring settings/floors/projects modals).
//
// Renders:
//   - <SyncStatusBadge> pinned top-center, visible at all times the project is
//     open (idle / synced / unsynced / syncing / error),
//   - <ConnectErpDialog> as a modal opened by the toolbar entry.

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useStore } from '../store'
import { getCurrentProjectId, subscribe } from '../projects/manager'
import { getCloudConn } from '../projects/cloudConn'
import ConnectErpDialog from './ConnectErpDialog'
import SyncStatusBadge from './SyncStatusBadge'

// Position offsets only (inline-style is sanctioned for layout offsets, not
// for colors/spacing tokens). Sits above the FloorSwitcher row (top:56) and
// clear of the left-anchored toolbar.
const badgeWrap = {
  position: 'fixed',
  top: 'var(--space-3)',
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 'var(--z-overlay)',
}

export default function ErpConnection() {
  const activeTool = useStore((s) => s.activeTool)
  const setTool = useStore((s) => s.setTool)
  const projectId = useSyncExternalStore(subscribe, getCurrentProjectId, getCurrentProjectId)

  const [conn, setConn] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey((k) => k + 1)

  // Note: the deep-link auto-connect (#connect handoff) runs in App.jsx BEFORE
  // any UI mounts (so the one-time exchange completes before the Projects
  // dialog can appear). By the time this container mounts, the connection is
  // already attached to the current project; the conn-loading effect below
  // picks it up via the projectId change.
  useEffect(() => {
    if (!projectId) {
      setConn(null)
      return
    }
    let cancelled = false
    getCloudConn()
      .then((c) => { if (!cancelled) setConn(c) })
      .catch(() => { if (!cancelled) setConn(null) })
    return () => { cancelled = true }
  }, [projectId, reloadKey])

  if (!projectId) return null

  return (
    <>
      <div style={badgeWrap}>
        <SyncStatusBadge conn={conn} />
      </div>
      <ConnectErpDialog
        open={activeTool === 'connect_erp'}
        onClose={() => setTool('select')}
        projectId={projectId}
        existingConn={conn}
        onConnected={reload}
        onDisconnected={reload}
      />
    </>
  )
}
