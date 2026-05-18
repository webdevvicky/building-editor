// Presentational. Renders excavation BoqLine[] from the canonical pipeline.
// Floor-scope is already applied by getBoqLines.

import { SectionHeader, BoqSubRow, BoqTotalRow, fmtLineQty } from './BoqRow'

export default function ExcavationSection({ lines, rates, onRateChange, openId, onInfoClick, unit, onSelectEntity }) {
  if (!lines || lines.length === 0) return null

  // Strip "Excavation — " prefix; the section header carries it.
  const stripPrefix = l => l.label.replace(/^Excavation\s+[—-]\s*/, '')

  const totalFt3  = lines.reduce((s, l) => s + (l.qty || 0), 0)
  const totalLine = { qty: Math.round(totalFt3 * 100) / 100, unit: 'ft³' }

  return (
    <div className="boq-group">
      <SectionHeader title="Excavation" />
      {lines.map(line => (
        <BoqSubRow key={line.id} line={line} labelOverride={stripPrefix(line)}
          rates={rates} onRateChange={onRateChange}
          openId={openId} onInfoClick={onInfoClick} unit={unit}
          onSelectEntity={onSelectEntity} />
      ))}
      <BoqTotalRow label="Total" value={fmtLineQty(totalLine, unit)} />
    </div>
  )
}
