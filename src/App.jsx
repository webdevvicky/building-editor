import Canvas from './components/Canvas'
import Toolbar from './components/Toolbar'
import RoomPanel from './components/RoomPanel'
import BOQPanel from './components/BOQPanel'
import OpeningPanel from './components/OpeningPanel'
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
import FloorSwitcher from './components/FloorSwitcher'
import FloorsManagerPanel from './components/FloorsManagerPanel'
import BBSSpecPanel from './components/BBSSpecPanel'
import PlumbingFixturePanel from './components/PlumbingFixturePanel'
import MepDefaultsModal from './components/MepDefaultsModal'
import ProjectsPanel from './components/ProjectsPanel'
import RevisionsPanel from './components/RevisionsPanel'
import IsoView from './components/IsoView'
import { DialogHost } from './components/ui/Dialog'
import { ToastHost } from './components/ui/Toast'
import { DesktopGate } from './components/DesktopGate'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'

export default function App() {
  useKeyboardShortcuts()
  return (
    <DesktopGate>
      <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
        <Toolbar />
        <FloorSwitcher />
        <RoomPanel />
        <OpeningPanel />
        <StampPanel />
        <BulkWallPanel />
        <RoomDetailPanel />
        <ColumnPanel />
        <BeamPanel />
        <StaircasePanel />
        <SlabPanel />
        <FoundationPanel />
        <FloorsManagerPanel />
        <BBSSpecPanel />
        <PlumbingFixturePanel />
        <MepDefaultsModal />
        <ProjectSettingsPanel />
        <ProjectsPanel />
        <RevisionsPanel />
        <IsoView />
        <LayersPanel />
        <BOQPanel />
        <Canvas />
        <DialogHost />
        <ToastHost />
      </div>
    </DesktopGate>
  )
}
