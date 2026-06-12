// Room-by-room BOQ breakdown table. Opens as a modal (activeTool ===
// 'room_breakdown') alongside — not inside — the BOQ Summary panel, which
// stays untouched. Purely presentational: all numbers come from the pure
// computeRoomBreakdown() helper.

import { useStore } from '../store'
import { useUnits } from '../hooks/useUnits'
import { Modal } from './ui/Modal.jsx'
import { computeRoomBreakdown, EXACT_MATCH_COLUMNS } from '../boq/roomBreakdown'
import './RoomBreakdownPanel.css'

// Column registry — single source for header labels + per-row cell rendering.
// `kind` drives formatting: 'area' → fmtArea, 'volume' → fmtVolume,
// 'count' → integer. `sticky` pins the first two identity columns on scroll.
const COLUMNS = [
  { key: 'name',             label: 'Room',          kind: 'text',   sticky: true,  align: 'left'  },
  { key: 'typeLabel',        label: 'Type',          kind: 'text',   sticky: true,  align: 'left'  },
  { key: 'floorAreaFt2',     label: 'Floor area',    kind: 'area'                                  },
  { key: 'wallAreaFt2',      label: 'Wall area',     kind: 'area'                                  },
  { key: 'brickworkCft',     label: 'Brickwork',     kind: 'volume'                                },
  { key: 'plasterIntSft',    label: 'Plaster (int)', kind: 'area'                                  },
  { key: 'plasterExtSft',    label: 'Plaster (ext)', kind: 'area'                                  },
  { key: 'flooringSft',      label: 'Flooring',      kind: 'area'                                  },
  { key: 'paintSft',         label: 'Paint',         kind: 'area'                                  },
  { key: 'waterproofingSft', label: 'Waterproof',    kind: 'area'                                  },
  { key: 'tilesSft',         label: 'Tiles',         kind: 'area'                                  },
  { key: 'doors',            label: 'Doors',         kind: 'count'                                 },
  { key: 'windows',          label: 'Windows',       kind: 'count'                                 },
]

const EXACT = new Set(EXACT_MATCH_COLUMNS)

export default function RoomBreakdownPanel() {
  const activeTool = useStore(s => s.activeTool)
  const setTool    = useStore(s => s.setTool)
  // Subscribe to the entity maps + rates so the table re-renders on edits.
  // The data itself is read from getState() to avoid threading 10 selectors.
  const rooms   = useStore(s => s.rooms)
  const walls   = useStore(s => s.walls)
  const nodes   = useStore(s => s.nodes)
  const rates   = useStore(s => s.ratesByKey)
  const projectSettings = useStore(s => s.projectSettings)
  void rooms; void walls; void nodes; void projectSettings

  const { fmtArea, fmtVolume } = useUnits()

  const open = activeTool === 'room_breakdown'
  if (!open) return null

  const data = computeRoomBreakdown(useStore.getState(), rates ?? {})
  const { byFloor, totals, crossCheck, isMultiFloor, roomCount } = data

  // Cell formatter by column kind.
  const fmtCell = (col, value) => {
    if (value == null) return '—'
    switch (col.kind) {
      case 'area':   return fmtArea(value)
      case 'volume': return fmtVolume(value)
      case 'count':  return String(value)
      default:       return value
    }
  }

  // Whether the per-room totals reconcile with the project BOQ Summary for a
  // given exact-match column (small epsilon for float rounding).
  const reconciles = (key) =>
    Math.abs((totals[key] ?? 0) - (crossCheck[key] ?? 0)) < 0.05

  return (
    <Modal
      open={open}
      onClose={() => setTool('select')}
      title="Room-by-room BOQ breakdown"
      width={1080}
    >
      {roomCount === 0 ? (
        <div className="rbd-empty">
          <div className="rbd-empty__title">No rooms yet</div>
          <div className="rbd-empty__hint">
            Create rooms to see their individual BOQ contributions.
          </div>
        </div>
      ) : (
        <div className="rbd">
          <div className="rbd-scroll">
            <table className="rbd-table">
              <thead>
                <tr>
                  {COLUMNS.map(col => (
                    <th
                      key={col.key}
                      className={[
                        col.sticky ? 'rbd-sticky' : '',
                        col.align === 'left' ? 'rbd-left' : 'rbd-num',
                      ].join(' ').trim()}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {byFloor.map(group => (
                  <FloorGroup
                    key={group.floorId}
                    group={group}
                    showFloorHeader={isMultiFloor}
                    fmtCell={fmtCell}
                  />
                ))}
              </tbody>

              <tfoot>
                {/* Totals — column-wise sum of every room. */}
                <tr className="rbd-totals">
                  {COLUMNS.map((col, i) => {
                    if (i === 0) return <td key={col.key} className="rbd-sticky rbd-left">All rooms — total</td>
                    if (i === 1) return <td key={col.key} className="rbd-sticky rbd-left" />
                    return (
                      <td key={col.key} className="rbd-num">{fmtCell(col, totals[col.key])}</td>
                    )
                  })}
                </tr>

                {/* Cross-check — project BOQ Summary value for the columns that
                    reconcile exactly. Other columns left blank (documented in
                    the footnote). A ✓/≠ marker flags the reconciliation. */}
                <tr className="rbd-crosscheck">
                  {COLUMNS.map((col, i) => {
                    if (i === 0) return <td key={col.key} className="rbd-sticky rbd-left">BOQ Summary</td>
                    if (i === 1) return <td key={col.key} className="rbd-sticky rbd-left" />
                    if (!EXACT.has(col.key)) return <td key={col.key} className="rbd-num rbd-muted">—</td>
                    const okMatch = reconciles(col.key)
                    return (
                      <td key={col.key} className="rbd-num">
                        <span className="rbd-cc-value">{fmtCell(col, crossCheck[col.key])}</span>
                        <span
                          className={`rbd-cc-mark ${okMatch ? 'rbd-cc-mark--ok' : 'rbd-cc-mark--off'}`}
                          title={okMatch ? 'Matches the BOQ Summary' : 'Does not reconcile'}
                          aria-label={okMatch ? 'matches' : 'mismatch'}
                        >
                          {okMatch ? '✓' : '≠'}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="rbd-footnotes">
            <p>
              <strong>Cross-check.</strong> Flooring, Plaster (ext), Paint,
              Waterproof and Tiles reconcile exactly with the BOQ Summary
              (marked&nbsp;<span className="rbd-cc-mark rbd-cc-mark--ok">✓</span>).
              The remaining columns are per-room views with expected differences
              from the project totals:
            </p>
            <ul>
              <li>
                <strong>Brickwork</strong> — room scope halves shared partition
                walls and omits beam deduction, so it tracks but won&apos;t equal
                the project masonry line.
              </li>
              <li>
                <strong>Plaster (int)</strong> — inner-face wall plaster only;
                column plaster is project-level and not attributed to a room.
              </li>
              <li>
                <strong>Doors / Windows</strong> — an opening on a wall shared by
                two rooms is counted in each, so the column total can exceed the
                project&apos;s unique count.
              </li>
            </ul>
          </div>
        </div>
      )}
    </Modal>
  )
}

function FloorGroup({ group, showFloorHeader, fmtCell }) {
  return (
    <>
      {showFloorHeader && (
        <tr className="rbd-floor-header">
          <td className="rbd-sticky rbd-left" colSpan={2}>{group.floorLabel}</td>
          <td colSpan={COLUMNS.length - 2} />
        </tr>
      )}
      {group.rooms.map(row => (
        <tr key={row.roomId} className="rbd-room-row">
          {COLUMNS.map(col => (
            <td
              key={col.key}
              className={[
                col.sticky ? 'rbd-sticky' : '',
                col.align === 'left' ? 'rbd-left' : 'rbd-num',
              ].join(' ').trim()}
            >
              {fmtCell(col, row[col.key])}
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
