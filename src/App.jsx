import Canvas from './components/Canvas'
import Toolbar from './components/Toolbar'
import RoomPanel from './components/RoomPanel'
import BOQPanel from './components/BOQPanel'
import OpeningPanel from './components/OpeningPanel'
import StampPanel from './components/StampPanel'
import BulkWallPanel from './components/BulkWallPanel'
import RoomDetailPanel from './components/RoomDetailPanel'
import ColumnPanel from './components/ColumnPanel'
import StaircasePanel from './components/StaircasePanel'
import SlabPanel from './components/SlabPanel'
import ProjectSettingsPanel from './components/ProjectSettingsPanel'
import LayersPanel from './components/LayersPanel'
import FoundationPanel from './components/FoundationPanel'
import FloorSwitcher from './components/FloorSwitcher'
import FloorsManagerPanel from './components/FloorsManagerPanel'
import BBSSpecPanel from './components/BBSSpecPanel'
import ProjectsPanel from './components/ProjectsPanel'

export default function App() {
  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <Toolbar />
      <FloorSwitcher />
      <RoomPanel />
      <OpeningPanel />
      <StampPanel />
      <BulkWallPanel />
      <RoomDetailPanel />
      <ColumnPanel />
      <StaircasePanel />
      <SlabPanel />
      <FoundationPanel />
      <FloorsManagerPanel />
      <BBSSpecPanel />
      <ProjectSettingsPanel />
      <ProjectsPanel />
      <LayersPanel />
      <BOQPanel />
      <Canvas />
    </div>
  )
}
