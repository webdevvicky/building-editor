import { useStore } from './store.js'
import BbsSettingsBanner from './components/BbsSettingsBanner.jsx'
import { getErpLaunchContext } from './projects/erpLaunchContext.js'
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
import SyncStatusBadge from './components/SyncStatusBadge'
import EditorReadOnlyBanner from './components/EditorReadOnlyBanner'
import ProjectionMismatchBanner from './components/ProjectionMismatchBanner'
import { DialogHost } from './components/ui/Dialog'
import { ToastHost } from './components/ui/Toast'
import { DesktopGate } from './components/DesktopGate'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'

export default function App() {
  const status = useStore(s => s.bbsSettingsStatus)
  const settings = useStore(s => s.projectSettings.bbsSettings)
  if (getErpLaunchContext() && (status !== 'ready' || settings?.source !== 'ERP')) return <><EditorReadOnlyBanner /><BbsSettingsBanner /></>
  return <EditorWorkspace />
}

function EditorWorkspace() {
  useKeyboardShortcuts()
  return (
    <DesktopGate>
      <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', overflow: 'hidden' }}>
        <BbsSettingsBanner />
        <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
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
          <LayersPanel />
          <BOQPanel />
          <Canvas />
          <DialogHost />
          <ToastHost />
          <SyncStatusBadge />
          <EditorReadOnlyBanner />
          <ProjectionMismatchBanner />
        </div>
      </div>
    </DesktopGate>
  )
}
