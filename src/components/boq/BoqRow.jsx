// Shared BOQ row primitives. Every BOQ section consumes pre-filtered
// BoqLine[] from the canonical pipeline (boq/lines.js) and renders rows
// via these components. Sections do NOT subscribe to the store directly
// for quantity data — that data lives in the line objects.

import './boq.css'

function fmtCost(n) {
  if (n === null || n === undefined) return '—'
  return '₹' + Math.round(n).toLocaleString('en-IN')
}

// Format a BoqLine's qty for display. Honors the user's unit preference
// for area/volume; other unit types pass through.
// Rev 2 + units phase: route through formatQuantity so feet-inches mode +
// Indian unit labels (Sft / Cft / Rft) are honored consistently with
// Canvas / panels / PDF / Excel.
import { formatQuantity, normalizeUnitMode } from '../../lib/units.js'
export function fmtLineQty(line, unit) {
  const mode = normalizeUnitMode(unit)
  return formatQuantity(line.qty, line.unit, mode)
}

export function SectionHeader({ title }) {
  return (
    <div className="boq-section-header">
      <span className="boq-section-title">{title}</span>
      <span className="boq-section-rule" />
    </div>
  )
}

export function SubSectionHeader({ title, suffix }) {
  return (
    <div className="boq-subsection-header">
      <span>{title}</span>
      {suffix && <span className="boq-subsection-suffix">{suffix}</span>}
    </div>
  )
}

export function InfoIcon({ id, openId, onInfoClick }) {
  return (
    <button
      data-info-btn=""
      onClick={e => onInfoClick(id, e)}
      title="Show formula"
      className={`boq-info-icon${openId === id ? ' is-active' : ''}`}
    >ⓘ</button>
  )
}

// Composed rate input with ₹ prefix. Handles the per-1000 case for brick rates
// by widening the prefix label to "₹/1000".
function RateInput({ value, onChange, isPer1000, unit }) {
  const prefix = isPer1000 ? '₹/1000' : '₹'
  return (
    <div className={`boq-rate-input${isPer1000 ? ' boq-rate-input--per1000' : ''}`}>
      <span className="boq-rate-prefix">{prefix}</span>
      <input
        type="number" min="0" step="0.01"
        value={value}
        onChange={onChange}
        placeholder={isPer1000 ? '' : `/${unit}`}
        className="boq-rate-field"
      />
    </div>
  )
}

// Render the label cell. When the line has back-link entity ids AND
// onSelectEntity is provided, only the label text becomes clickable —
// the rest of the row (qty / rate input / cost) stays untouched so
// rate-editing isn't disrupted.
function LabelCell({ line, label, openId, onInfoClick, onSelectEntity }) {
  const clickable = !!onSelectEntity && (line.sourceEntityIds?.length ?? 0) > 0
  const cls = clickable ? 'boq-row-label--clickable' : undefined
  const handleClick = clickable ? () => onSelectEntity(line) : undefined
  return (
    <div className="boq-row-label">
      <span className={cls} onClick={handleClick}>{label}</span>
      {line.formulaId && <InfoIcon id={line.formulaId} openId={openId} onInfoClick={onInfoClick} />}
    </div>
  )
}

// Top-level priced row (used for finishes flooring/plaster/paint).
export function BoqRow({ line, rates, onRateChange, openId, onInfoClick, unit, labelOverride, onSelectEntity }) {
  const label   = labelOverride ?? line.label
  const rateVal = rates[line.rateKey] ?? ''
  const hasCost = line.cost !== null && line.cost !== undefined
  return (
    <div className="boq-row">
      <LabelCell line={line} label={label}
        openId={openId} onInfoClick={onInfoClick} onSelectEntity={onSelectEntity} />
      <span className="boq-row-qty">{fmtLineQty(line, unit)}</span>
      <RateInput
        value={rateVal}
        onChange={e => onRateChange(line.rateKey, e.target.value)}
        isPer1000={!!line.isPer1000}
        unit={line.unit}
      />
      <span className={`boq-row-cost${hasCost ? '' : ' boq-row-cost--empty'}`}>
        {fmtCost(line.cost)}
      </span>
    </div>
  )
}

// Indented priced sub-row (used inside grouped sections — masonry, structural,
// shuttering, plaster, etc.).
export function BoqSubRow({ line, rates, onRateChange, openId, onInfoClick, unit, labelOverride, onSelectEntity }) {
  const label   = labelOverride ?? line.label
  const rateVal = rates[line.rateKey] ?? ''
  const hasCost = line.cost !== null && line.cost !== undefined
  return (
    <div className="boq-row boq-row--subrow">
      <LabelCell line={line} label={label}
        openId={openId} onInfoClick={onInfoClick} onSelectEntity={onSelectEntity} />
      <span className="boq-row-qty">{fmtLineQty(line, unit)}</span>
      <RateInput
        value={rateVal}
        onChange={e => onRateChange(line.rateKey, e.target.value)}
        isPer1000={!!line.isPer1000}
        unit={line.unit}
      />
      <span className={`boq-row-cost${hasCost ? '' : ' boq-row-cost--empty'}`}>
        {fmtCost(line.cost)}
      </span>
    </div>
  )
}

// Static totals/info row (no rate input). Used for things like "Total steel"
// at the bottom of grouped sections.
export function BoqTotalRow({ label, value }) {
  return (
    <div className="boq-total-static">
      <span>{label}</span>
      <span className="boq-row-qty">{value}</span>
      <span /><span />
    </div>
  )
}
