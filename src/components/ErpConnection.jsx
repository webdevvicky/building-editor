// ErpConnection — wires the cloud-sync UI into the app shell.
//
// The ERP connection is GLOBAL (one per editor installation), so this container
// drives off the cloudConn subscription rather than the current project id:
//   - the badge is shown whenever a global connection exists,
//   - `bound` tells the badge whether the OPEN project is the one that syncs
//     (conn.localProjectId === currentProjectId),
//   - the connect dialog (toolbar → "Connect to ERP") is always mounted so it
//     can open even before a connection exists.
//
// setCloudConn/clearCloudConn emit to subscribers, so connect/disconnect update
// the badge automatically — no manual reload.

import { useSyncExternalStore } from 'react'
import { useStore } from '../store'
import { getCurrentProjectId, subscribe as subscribeProject } from '../projects/manager'
import { getCachedConn, subscribe as subscribeConn } from '../projects/cloudConn'
import ConnectErpDialog from './ConnectErpDialog'
import SyncStatusBadge from './SyncStatusBadge'

// Position offsets only (inline-style is sanctioned for layout offsets, not for
// colors/spacing tokens). Sits above the FloorSwitcher row (top:56) and clear
// of the left-anchored toolbar.
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

  const projectId = useSyncExternalStore(subscribeProject, getCurrentProjectId, getCurrentProjectId)
  const conn = useSyncExternalStore(subscribeConn, getCachedConn, getCachedConn)

  const bound = !!conn && !!projectId && conn.localProjectId === projectId

  return (
    <>
      {conn && (
        <div style={badgeWrap}>
          <SyncStatusBadge conn={conn} bound={bound} />
        </div>
      )}
      <ConnectErpDialog
        open={activeTool === 'connect_erp'}
        onClose={() => setTool('select')}
        projectId={projectId}
        existingConn={conn}
      />
    </>
  )
}
