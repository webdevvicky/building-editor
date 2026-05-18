// Presentational. Renders shuttering BoqLine[] from the canonical pipeline.
// Floor-scope is already applied by getBoqLines(state, rates, { floorId }).
// This component never reads the store.

import { SectionHeader, BoqSubRow, BoqTotalRow, fmtLineQty } from './BoqRow'

export default function ShutteringSection({ lines, rates, onRateChange, openId, onInfoClick, unit }) {
  if (!lines || lines.length === 0) return null

  // Strip "Shuttering — " prefix from labels (the section header carries that).
  const stripPrefix = l => l.label.replace(/^Shuttering\s+[—-]\s*/, '')

  const totalFt2 = lines.reduce((s, l) => s + (l.qty || 0), 0)
  const totalLine = { qty: Math.round(totalFt2 * 100) / 100, unit: 'ft²' }

  return (
    <div className="boq-group">
      <SectionHeader title="Shuttering" />
      {lines.map(line => (
        <BoqSubRow key={line.id} line={line} labelOverride={stripPrefix(line)}
          rates={rates} onRateChange={onRateChange}
          openId={openId} onInfoClick={onInfoClick} unit={unit} />
      ))}
      <BoqTotalRow label="Total" value={fmtLineQty(totalLine, unit)} />
    </div>
  )
}
