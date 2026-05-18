import { useMemo, useState } from 'react'
import { Modal } from './ui/Modal.jsx'
import { Button } from './ui/Button.jsx'
import { diffProject, diffBoq, diffValidation } from '../revisions/diff'
import './revisions.css'

const CATEGORY_LABELS = {
  finishes:     'Finishes',
  masonry:      'Masonry',
  rcc:          'RCC — Structural',
  civil:        'Civil Works',
  shuttering:   'Shuttering',
  excavation:   'Excavation',
  concreteMix:  'Concrete Mix',
  steel:        'Steel',
  plaster:      'Plaster Materials',
  plumConcrete: 'Plum Concrete',
  staircase:    'Staircase',
}

function fmtDate(ms) {
  if (!ms) return ''
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return '' }
}

function fmtNum(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return Math.round(n * 100) / 100
}

function fmtDelta(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return ''
  const rounded = Math.round(n * 100) / 100
  if (Math.abs(rounded) < 1e-9) return '0'
  return rounded > 0 ? `+${rounded}` : `${rounded}`
}

function fmtCost(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return '₹' + Math.round(n).toLocaleString('en-IN')
}

function fmtFieldValue(v) {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number')  return String(Math.round(v * 1000) / 1000)
  if (typeof v === 'string')  return v.length > 40 ? v.slice(0, 37) + '…' : v
  if (Array.isArray(v))       return `[${v.length} item${v.length === 1 ? '' : 's'}]`
  if (typeof v === 'object')  return `{${Object.keys(v).length} keys}`
  return String(v)
}

// Collapsible entity-diff section, one per entity type.
function EntityDiffSection({ label, diff }) {
  const [open, setOpen] = useState(diff.counts.added + diff.counts.removed + diff.counts.modified > 0)
  const total = diff.counts.added + diff.counts.removed + diff.counts.modified
  if (total === 0) return null

  return (
    <div className="rev-diff-section">
      <button
        type="button"
        className="rev-diff-section__head"
        onClick={() => setOpen(!open)}
      >
        <span className="rev-diff-section__chev">{open ? '▾' : '▸'}</span>
        <span className="rev-diff-section__label">{label}</span>
        <span className="rev-diff-section__counts">
          {diff.counts.added   > 0 && <span className="rev-tag rev-tag--add">+{diff.counts.added}</span>}
          {diff.counts.removed > 0 && <span className="rev-tag rev-tag--rem">−{diff.counts.removed}</span>}
          {diff.counts.modified> 0 && <span className="rev-tag rev-tag--mod">~{diff.counts.modified}</span>}
        </span>
      </button>
      {open && (
        <div className="rev-diff-section__body">
          <FloorGroupedList title="Added"    items={diff.addedByFloor}    variant="add" />
          <FloorGroupedList title="Removed"  items={diff.removedByFloor}  variant="rem" />
          <FloorGroupedList title="Modified" items={diff.modifiedByFloor} variant="mod" />
        </div>
      )}
    </div>
  )
}

// Grouped-by-floor sub-list. `items` is Map<floorId, items[]>.
function FloorGroupedList({ title, items, variant }) {
  if (!items || items.size === 0) return null
  return (
    <div className="rev-diff-grouplist">
      <div className="rev-diff-grouplist__title">{title}</div>
      {[...items.entries()].map(([floorId, list]) => (
        <FloorGroup key={floorId} floorId={floorId} list={list} variant={variant} />
      ))}
    </div>
  )
}

function FloorGroup({ floorId, list, variant }) {
  const [open, setOpen] = useState(false)
  const heading = floorId === '—' ? 'Unscoped' : `Floor ${floorId}`
  return (
    <div className="rev-diff-floorgroup">
      <button
        type="button"
        className="rev-diff-floorgroup__head"
        onClick={() => setOpen(!open)}
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>{heading}</span>
        <span className={`rev-tag rev-tag--${variant}`}>{list.length}</span>
      </button>
      {open && (
        <div className="rev-diff-floorgroup__body">
          {list.map(item => (
            <div key={item.id} className="rev-diff-item">
              <div className="rev-diff-item__title">
                {item.name ? item.name : <code className="rev-diff-item__id">{item.id.slice(0, 8)}</code>}
              </div>
              {item.fields && item.fields.length > 0 && (
                <ul className="rev-diff-item__fields">
                  {item.fields.map(f => (
                    <li key={f.field}>
                      <span className="rev-diff-field">{f.field}:</span>
                      <span className="rev-diff-from">{fmtFieldValue(f.a)}</span>
                      {' → '}
                      <span className="rev-diff-to">{fmtFieldValue(f.b)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BoqDiffTab({ boqDiff }) {
  if (!boqDiff) return null
  const categories = Object.keys(boqDiff.byCategory)
  return (
    <div className="rev-boq-tab">
      <div className="rev-boq-total">
        <span>Total cost</span>
        <span>{fmtCost(boqDiff.totalA)}</span>
        <span className="rev-boq-arrow">→</span>
        <span>{fmtCost(boqDiff.totalB)}</span>
        <span className={`rev-boq-delta${boqDiff.deltaTotal > 0 ? ' rev-boq-delta--pos' : boqDiff.deltaTotal < 0 ? ' rev-boq-delta--neg' : ''}`}>
          {boqDiff.deltaTotal !== null ? fmtDelta(boqDiff.deltaTotal) : ''}
        </span>
      </div>

      {categories.length === 0 && (
        <div className="rev-empty">No BOQ lines on either revision.</div>
      )}

      {categories.map(cat => {
        const lines = boqDiff.byCategory[cat]
        const changedCount = lines.filter(l => l.status !== 'unchanged').length
        return (
          <BoqCategorySection
            key={cat}
            title={CATEGORY_LABELS[cat] || cat}
            lines={lines}
            changedCount={changedCount}
          />
        )
      })}
    </div>
  )
}

function BoqCategorySection({ title, lines, changedCount }) {
  const [open, setOpen] = useState(changedCount > 0)
  return (
    <div className="rev-boq-section">
      <button
        type="button"
        className="rev-boq-section__head"
        onClick={() => setOpen(!open)}
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>{title}</span>
        <span className="rev-boq-section__count">
          {changedCount > 0
            ? `${changedCount} changed of ${lines.length}`
            : `${lines.length} unchanged`}
        </span>
      </button>
      {open && (
        <table className="rev-boq-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty (A)</th>
              <th>Qty (B)</th>
              <th>Δ Qty</th>
              <th>Cost (A)</th>
              <th>Cost (B)</th>
              <th>Δ Cost</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(l => (
              <tr key={l.id} className={`rev-boq-row rev-boq-row--${l.status}`}>
                <td>{l.label}</td>
                <td>{l.status === 'added' ? '—' : `${fmtNum(l.qtyA)} ${l.unit}`}</td>
                <td>{l.status === 'removed' ? '—' : `${fmtNum(l.qtyB)} ${l.unit}`}</td>
                <td className={`rev-delta-cell${l.deltaQty > 0 ? ' pos' : l.deltaQty < 0 ? ' neg' : ''}`}>
                  {l.status === 'unchanged' ? '' : `${fmtDelta(l.deltaQty)} ${l.unit}`}
                </td>
                <td>{l.status === 'added' ? '—' : fmtCost(l.costA)}</td>
                <td>{l.status === 'removed' ? '—' : fmtCost(l.costB)}</td>
                <td className={`rev-delta-cell${l.deltaCost > 0 ? ' pos' : l.deltaCost < 0 ? ' neg' : ''}`}>
                  {l.status === 'unchanged' || l.deltaCost === null ? '' : fmtDelta(l.deltaCost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function ProjectSettingsDiff({ ps }) {
  if (!ps) return null
  const anyChange =
    ps.counts.fields + ps.counts.floors + ps.counts.steel + ps.counts.columnTypes > 0
  if (!anyChange) return null
  return (
    <div className="rev-diff-section">
      <div className="rev-diff-section__head rev-diff-section__head--static">
        <span className="rev-diff-section__label">{ps.label}</span>
      </div>
      <div className="rev-diff-section__body">
        {ps.fieldChanges.length > 0 && (
          <ul className="rev-diff-item__fields">
            {ps.fieldChanges.map(c => (
              <li key={c.path}>
                <span className="rev-diff-field">{c.path}:</span>
                <span className="rev-diff-from">{fmtFieldValue(c.a)}</span>
                {' → '}
                <span className="rev-diff-to">{fmtFieldValue(c.b)}</span>
              </li>
            ))}
          </ul>
        )}
        {ps.steelKgPerM3.length > 0 && (
          <div>
            <div className="rev-diff-grouplist__title">Steel ratios (kg/m³)</div>
            <ul className="rev-diff-item__fields">
              {ps.steelKgPerM3.map(c => (
                <li key={c.element}>
                  <span className="rev-diff-field">{c.element}:</span>
                  <span className="rev-diff-from">{fmtFieldValue(c.a)}</span>
                  {' → '}
                  <span className="rev-diff-to">{fmtFieldValue(c.b)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(ps.floors.counts.added + ps.floors.counts.removed + ps.floors.counts.modified > 0) && (
          <EntityDiffSection label="Floors"       diff={ps.floors} />
        )}
        {(ps.columnTypes.counts.added + ps.columnTypes.counts.removed + ps.columnTypes.counts.modified > 0) && (
          <EntityDiffSection label="Column types" diff={ps.columnTypes} />
        )}
      </div>
    </div>
  )
}

export default function RevisionDiffPanel({ revA, revB, onClose }) {
  const [tab, setTab] = useState('elements')

  const projectDiff = useMemo(
    () => diffProject(revA.snapshot, revB.snapshot),
    [revA, revB],
  )
  const boqDiff = useMemo(
    () => diffBoq(revA.boqSummary, revB.boqSummary),
    [revA, revB],
  )
  const valDiff = useMemo(
    () => diffValidation(revA.validationSummary, revB.validationSummary),
    [revA, revB],
  )

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Compare: ${revA.label} → ${revB.label}`}
      width={900}
    >
      <div className="rev-diff-panel">
        <div className="rev-diff-header">
          <div className="rev-diff-header__col">
            <div className="rev-diff-header__label">From</div>
            <div className="rev-diff-header__title">{revA.label}</div>
            <div className="rev-diff-header__meta">
              {fmtDate(revA.createdAt)}
              {revA.authorName && <> · {revA.authorName}</>}
            </div>
          </div>
          <div className="rev-diff-header__arrow">→</div>
          <div className="rev-diff-header__col">
            <div className="rev-diff-header__label">To</div>
            <div className="rev-diff-header__title">{revB.label}</div>
            <div className="rev-diff-header__meta">
              {fmtDate(revB.createdAt)}
              {revB.authorName && <> · {revB.authorName}</>}
            </div>
          </div>
        </div>

        <div className="rev-diff-summary">
          <span className="rev-tag rev-tag--add">+{projectDiff.totals.added} added</span>
          <span className="rev-tag rev-tag--rem">−{projectDiff.totals.removed} removed</span>
          <span className="rev-tag rev-tag--mod">~{projectDiff.totals.modified} modified</span>
          {(valDiff.delta.errors !== 0 || valDiff.delta.warnings !== 0) && (
            <span className="rev-tag rev-tag--val">
              validation: {valDiff.delta.errors >= 0 ? '+' : ''}{valDiff.delta.errors}E /
              {' '}{valDiff.delta.warnings >= 0 ? '+' : ''}{valDiff.delta.warnings}W
            </span>
          )}
        </div>

        <div className="rev-diff-tabs">
          <button
            className={`rev-diff-tab${tab === 'elements' ? ' is-active' : ''}`}
            onClick={() => setTab('elements')}
          >Elements</button>
          <button
            className={`rev-diff-tab${tab === 'boq' ? ' is-active' : ''}`}
            onClick={() => setTab('boq')}
          >BOQ</button>
        </div>

        <div className="rev-diff-body">
          {tab === 'elements' ? (
            <>
              <EntityDiffSection label="Walls"        diff={projectDiff.walls} />
              <EntityDiffSection label="Rooms"        diff={projectDiff.rooms} />
              <EntityDiffSection label="Columns"      diff={projectDiff.columns} />
              <EntityDiffSection label="Beams"        diff={projectDiff.beams} />
              <EntityDiffSection label="Slabs"        diff={projectDiff.slabs} />
              <EntityDiffSection label="Foundations"  diff={projectDiff.foundations} />
              <EntityDiffSection label="Stamps"       diff={projectDiff.stamps} />
              <EntityDiffSection label="Staircases"   diff={projectDiff.staircases} />
              <EntityDiffSection label="Nodes"        diff={projectDiff.nodes} />
              <ProjectSettingsDiff ps={projectDiff.projectSettings} />
              {projectDiff.totals.added + projectDiff.totals.removed + projectDiff.totals.modified === 0 && (
                <div className="rev-empty">No element changes between these revisions.</div>
              )}
            </>
          ) : (
            <BoqDiffTab boqDiff={boqDiff} />
          )}
        </div>

        <div className="rev-diff-footer">
          <span>
            From snapshot computed with app v{revA.appVersion || '?'};
            To with v{revB.appVersion || '?'}.
          </span>
          <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  )
}
