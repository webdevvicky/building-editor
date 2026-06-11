// In-app Getting Started guide. Opens as a modal (via the shared <Modal>
// primitive) when activeTool === 'help' — the same activeTool-gated pattern
// every other panel uses, so Esc / outside-click / the × button all close it
// for free (handleEscape → setTool('select')).
//
// Content is data-driven (SECTIONS below) so it stays easy to keep accurate.
// The Keyboard Shortcuts section is NOT hardcoded here — it renders the
// KEYBOARD_SHORTCUTS registry that the keyboard hook actually dispatches from,
// so the two can never drift.

import { useStore } from '../store'
import { Modal } from './ui/Modal.jsx'
import { KEYBOARD_SHORTCUTS } from '../hooks/useKeyboardShortcuts'
import './HelpGuide.css'

// Each feature row: a short bold name + a one-line description derived from
// how the feature actually behaves in code.
const SECTIONS = [
  {
    title: 'Drawing tools',
    features: [
      ['Draw walls (D)', 'Click to start a wall, click again to keep chaining segments. Click the green origin dot to close the loop, or press Enter / double-click to finish. Esc cancels the chain.'],
      ['Drawing to', 'In the Draw flyout, choose whether your clicks mean the Inside face, Centre, or Outside face of the wall. Default is Inside — it matches architect room dimensions (clear inside).'],
      ['Rectangle room (Shift+R)', 'Click two opposite corners to drop a finished room and its four walls in one step.'],
      ['Room (R)', 'Click any wall that sits inside a closed loop of walls — the smallest enclosing room on that side is detected and created.'],
      ['Split wall', 'Click a point on a wall to break it into two separate walls (openings, junctions and fixtures are carried across).'],
      ['Join walls (J)', 'Merge two in-line walls back into one. Only walls with matching material, height and thickness can join.'],
      ['Column', 'Place a structural column. Columns snap to nearby wall corners and to the active snap grid.'],
      ['Beam', 'Click two endpoints to place a beam. An endpoint can be a column, another beam (beam-to-beam secondary), a wall bearing point, or a free point — column wins over beam, beam over wall, wall over free point.'],
      ['Slabs', 'Manage slab regions (floor / roof / sunken) for the active floor.'],
      ['Foundations', 'Create isolated, combined, raft, strip or pile foundations and attach columns or walls to them.'],
      ['Civil stamps', 'Drop sumps, overhead tanks, septic tanks, stairs and lifts as sized civil blocks.'],
    ],
  },
  {
    title: 'Snapping',
    features: [
      ['Snap pitch', 'Pick the grid pitch (1″ / 3″ / 6″ / 12″ / 24″) from the View & Settings → Snap control. Clicks round to this grid for clean dimensions.'],
      ['Toggle snap (F9)', 'Turn snapping on or off at any time. Hold Alt while clicking to bypass snap for one pixel-accurate point (the bypass key is configurable in Project Settings → Snap).'],
    ],
  },
  {
    title: 'Floors',
    features: [
      ['Switch floors', 'When a project has more than one floor, the floor tabs appear at the top of the canvas — click one to switch.'],
      ['Manage floors', 'Open Floors to add, rename or delete floors and set each floor\'s plinth and floor heights.'],
      ['Per-floor underlay', 'Each floor keeps its own imported plan, so you can trace every storey from its own drawing.'],
    ],
  },
  {
    title: 'Underlay (tracing over a plan)',
    features: [
      ['Import PDF / image', 'View & Settings → Underlay → Import. The plan loads behind your drawing on the active floor.'],
      ['Multi-page PDFs', 'If the PDF has several pages, a thumbnail picker lets you choose which page to place.'],
      ['Calibrate scale', 'Run Calibrate scale, then click two points a known distance apart and type that distance. Everything you trace afterwards is then to scale.'],
      ['Opacity & clear', 'Adjust underlay opacity / visibility in the Layers panel; Clear underlay removes it from the floor.'],
    ],
  },
  {
    title: 'MEP services',
    features: [
      ['Plumbing (P) · Electrical (E) · HVAC (H) · Fire (F) · ELV (L)', 'Each discipline has its own tool for placing fixtures, points, units and devices. Routes and sizes are derived automatically to Indian standards.'],
      ['Auto defaults on new rooms', 'When you create a room, suggested fixtures and points for that room type can be applied in one click.'],
    ],
  },
  {
    title: 'View & settings',
    features: [
      ['3D view (Ctrl+3)', 'Open the 2.5D / 3D viewer. Use the NE / SE / SW / NW / Top preset buttons, the elevation slider, and the Pan / Orbit toggle; scroll to zoom.'],
      ['Show dimensions', 'Toggle wall length labels on the canvas.'],
      ['Draw virtual walls', 'Allow drawing virtual (non-physical) walls that don\'t add masonry.'],
      ['Units', 'Switch readouts between ft, ft-in and metres.'],
      ['Layers', 'The Layers panel toggles visibility of walls, columns, beams, rooms, MEP routes and more.'],
    ],
  },
  {
    title: 'BOQ & BBS',
    features: [
      ['BOQ Summary', 'The right-hand panel lists every quantity by category with editable rates, plus scope-of-work, carpet / built-up area and the project cost summary.'],
      ['This floor / All floors', 'In a multi-floor project, toggle the BOQ between the active floor only and the whole building.'],
      ['Collapse (Ctrl+B)', 'Collapse the BOQ sidebar to reclaim canvas width.'],
      ['Export', 'Export the BOQ to CSV, PDF or Excel. Excel cells use live formulas so you can adjust rates in the sheet.'],
      ['BBS Schedule (Shift+B)', 'Open the bar-bending schedule — mark, shape, cutting length and weight per bar, following IS 2502. Reinforcement specs are set in the BBS panel.'],
    ],
  },
  {
    title: 'Project',
    features: [
      ['Open / Save (Ctrl+S)', 'Manage projects from the Project menu. Work autosaves; Ctrl+S saves on demand.'],
      ['Import / Export JSON', 'Move a project in or out as a portable JSON file.'],
      ['Revisions', 'Browse saved revisions of the current project.'],
      ['Undo / Redo', 'Ctrl+Z and Ctrl+Y (or Ctrl+Shift+Z) step through your edit history.'],
    ],
  },
  {
    title: 'Tips for accurate drawings',
    features: [
      ['Calibrate before you trace', 'Always calibrate the underlay scale before drawing over an imported plan — otherwise every traced dimension is wrong.'],
      ['Keep snap on', 'Leave snapping on at a sensible pitch (e.g. 3″ or 6″) so corners meet cleanly and walls actually connect. Hold Alt only when you need an exact off-grid point.'],
      ['Draw to the inside face', 'With "Drawing to: Inside" you can trace an architect\'s clear room dimensions directly and the carpet area comes out right.'],
      ['Watch the validation footer', 'The BOQ panel flags issues (e.g. a beam with no support, an unenclosed slab). Click an issue to jump straight to the entity on the canvas.'],
    ],
  },
]

// Display order for the keyboard-shortcut groups. Decoupled from the registry
// array order (which is dispatch-order, not display-order).
const SHORTCUT_GROUP_ORDER = ['Editing', 'Tools', 'MEP', 'View', 'History & project']

function FeatureRow({ name, desc }) {
  return (
    <div className="help-feature">
      <div className="help-feature__name">{name}</div>
      <div className="help-feature__desc">{desc}</div>
    </div>
  )
}

function ShortcutsTable() {
  // Group the live registry by `group`, preserving registry order within each
  // group. Any new shortcut added to KEYBOARD_SHORTCUTS shows up here with no
  // edit to this component.
  const groups = []
  for (const g of SHORTCUT_GROUP_ORDER) {
    const rows = KEYBOARD_SHORTCUTS.filter(s => s.group === g)
    if (rows.length) groups.push([g, rows])
  }
  // Safety net: surface any shortcut whose group isn't in the display order,
  // so a future group can never silently disappear from Help.
  const known = new Set(SHORTCUT_GROUP_ORDER)
  const others = KEYBOARD_SHORTCUTS.filter(s => !known.has(s.group))
  if (others.length) groups.push(['Other', others])

  return (
    <div className="help-shortcuts">
      {groups.map(([group, rows]) => (
        <div key={group} className="help-shortcuts__group">
          <div className="help-shortcuts__group-title">{group}</div>
          <table className="help-shortcuts__table">
            <tbody>
              {rows.map((s, i) => (
                <tr key={`${s.combo}-${i}`}>
                  <td className="help-shortcuts__keys"><kbd>{s.combo}</kbd></td>
                  <td className="help-shortcuts__label">{s.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

export default function HelpGuide() {
  const activeTool = useStore(s => s.activeTool)
  const setTool    = useStore(s => s.setTool)
  const open = activeTool === 'help'

  return (
    <Modal open={open} onClose={() => setTool('select')} title="Getting started" width={680}>
      <div className="help-guide">
        <p className="help-guide__intro">
          A quick tour of the Building Editor — draw a plan, lay out structure
          and services, and read off a quantity estimate (BOQ) to Indian
          standards. Designed for desktop use.
        </p>

        {SECTIONS.map(section => (
          <section key={section.title} className="help-section">
            <h3 className="help-section__title">{section.title}</h3>
            {section.features.map(([name, desc]) => (
              <FeatureRow key={name} name={name} desc={desc} />
            ))}
          </section>
        ))}

        <section className="help-section">
          <h3 className="help-section__title">Keyboard shortcuts</h3>
          <ShortcutsTable />
        </section>
      </div>
    </Modal>
  )
}
