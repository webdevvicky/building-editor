import { useEffect, useState } from 'react'
import Canvas from './components/Canvas'
import Toolbar from './components/Toolbar'
import BOQPanel from './components/BOQPanel'
import OpeningPanel from './components/OpeningPanel'
import OpeningDetailPanel from './components/OpeningDetailPanel'
import StampPanel from './components/StampPanel'
import BulkWallPanel from './components/BulkWallPanel'
import RoomDetailPanel from './components/RoomDetailPanel'
import ColumnPanel from './components/ColumnPanel'
import BeamPanel from './components/BeamPanel'
import StaircasePanel from './components/StaircasePanel'
import SlabPanel from './components/SlabPanel'
import ProjectSettingsPanel from './components/ProjectSettingsPanel'
import LayersPanel from './components/LayersPanel'
import FoundationPanel from './components/FoundationPanel'
import CalibrationModal from './components/CalibrationModal'
import PDFPagePickerModal from './components/PDFPagePickerModal'
import FloorSwitcher from './components/FloorSwitcher'
import FloorsManagerPanel from './components/FloorsManagerPanel'
import BBSSpecPanel from './components/BBSSpecPanel'
import BBSSchedulePanel from './components/BBSSchedulePanel'
import PlumbingFixturePanel from './components/PlumbingFixturePanel'
import ElectricalPointPanel from './components/ElectricalPointPanel'
import HvacPanel from './components/HvacPanel'
import FirePanel from './components/FirePanel'
import ElvPanel from './components/ElvPanel'
import MepDefaultsModal from './components/MepDefaultsModal'
import ProjectsPanel from './components/ProjectsPanel'
import RevisionsPanel from './components/RevisionsPanel'
import IsoView from './components/IsoView'
import HelpGuide from './components/HelpGuide'
import RoomBreakdownPanel from './components/RoomBreakdownPanel'
import ErpConnection from './components/ErpConnection'
import SyncStatusBadge from './components/SyncStatusBadge'
import { DialogHost } from './components/ui/Dialog'
import { ToastHost } from './components/ui/Toast'
import { DesktopGate } from './components/DesktopGate'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useStore } from './store'
import {
  getCurrentProjectId, createProject, openProject, setCurrentProjectId,
} from './projects/manager'
import { parseConnectHash, runConnectHandoff } from './projects/connectHandoff'
import { toast } from './components/ui/Toast'

// Full-screen gate shown while the one-time `#connect` handoff runs — BEFORE
// any app UI (esp. the Projects dialog) mounts. Inline style is for layout
// offsets only; colors/typography come from design tokens.
const connectingWrap = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--space-2)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  zIndex: 'var(--z-modal)',
}

function ConnectingScreen() {
  return (
    <div style={connectingWrap} role="status" aria-live="polite">
      <div style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)' }}>
        Connecting to ERP…
      </div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
        Securing your editor session — this only takes a moment.
      </div>
    </div>
  )
}

export default function App() {
  useKeyboardShortcuts()

  // Deep-link auto-connect: when the URL fragment is a `#connect?…` handoff, the
  // one-time code exchange MUST finish before any UI renders — otherwise the
  // Projects dialog can flash open before the handoff creates the project. Gate
  // the whole app on it. `parseConnectHash` is sync + side-effect-free, so the
  // lazy initial state decides synchronously whether to gate.
  const [connecting, setConnecting] = useState(
    () => typeof window !== 'undefined' && parseConnectHash(window.location.hash) != null,
  )

  useEffect(() => {
    if (!connecting) return
    const loadProject = useStore.getState().loadProject
    runConnectHandoff({
      getCurrentProjectId, createProject, openProject, setCurrentProjectId,
      loadProject, getState: useStore.getState, toast,
    })
      .catch(() => { /* the handler toasts its own failures */ })
      .finally(() => setConnecting(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // While connecting, render only the loading gate + ToastHost (so the
  // connect success/error toast surfaces immediately).
  if (connecting) {
    return (
      <>
        <ConnectingScreen />
        <ToastHost />
      </>
    )
  }

  return (
    <DesktopGate>
      <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
        <Toolbar />
        <FloorSwitcher />
        <OpeningPanel />
        <OpeningDetailPanel />
        <StampPanel />
        <BulkWallPanel />
        <RoomDetailPanel />
        <ColumnPanel />
        <BeamPanel />
        <StaircasePanel />
        <SlabPanel />
        <FoundationPanel />
        <CalibrationModal />
        <PDFPagePickerModal />
        <FloorsManagerPanel />
        <BBSSpecPanel />
        <BBSSchedulePanel />
        <PlumbingFixturePanel />
        <ElectricalPointPanel />
        <HvacPanel />
        <FirePanel />
        <ElvPanel />
        <MepDefaultsModal />
        <ProjectSettingsPanel />
        <ProjectsPanel />
        <RevisionsPanel />
        <IsoView />
        <HelpGuide />
        <RoomBreakdownPanel />
        <ErpConnection />
        <LayersPanel />
        <BOQPanel />
        <Canvas />
        <DialogHost />
        <ToastHost />
        <SyncStatusBadge />
      </div>
    </DesktopGate>
  )
}
