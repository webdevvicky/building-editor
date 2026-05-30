// SelectionPanel — locked wrapper for every selection-driven side panel
// (OpeningPanel, ColumnPanel, RoomDetailPanel, MEP panels, etc.).
//
// Locks in:
//   - position { top: 56, left: 16 } so all selection panels share the
//     same anchor (mutually exclusive UX).
//   - zIndex var(--z-selection-panel) (30) so selection panels render
//     above LayersPanel (zIndex var(--z-overlay) = 50 was inverting and
//     covering the bottom of the active selection panel).
//   - max-height + internal scroll so tall panels never run off-screen
//     into the LayersPanel zone at the bottom.
//
// Pass-through props (title, onClose, width, footer, children) match
// the underlying Panel primitive exactly. Width override allowed for
// the few panels that need it (BulkWallPanel, etc.).

import { Panel } from './Panel.jsx'

const DEFAULT_POSITION = { top: 56, left: 16 }
// Leave room: toolbar (56px) + LayersPanel bottom anchor (56px) + breathing room (~120px).
const MAX_HEIGHT_STYLE = { maxHeight: 'calc(100vh - 56px - 120px)', overflow: 'hidden auto' }

export default function SelectionPanel({
  title,
  onClose,
  width = 260,
  position = DEFAULT_POSITION,
  footer,
  children,
  className,
}) {
  return (
    <Panel
      title={title}
      onClose={onClose}
      width={width}
      position={position}
      zIndex={'var(--z-selection-panel)'}
      footer={footer}
      className={['ui-panel--selection', className].filter(Boolean).join(' ')}
    >
      <div style={MAX_HEIGHT_STYLE}>
        {children}
      </div>
    </Panel>
  )
}
