// Grills + handrails BOQ section — presentational.
// Lines: window grills, main-door safety grill, staircase + balcony handrails.

import { SectionHeader, BoqRow } from './BoqRow'

export default function GrillsBoqSection({ lines, rates, onRateChange, openId, onInfoClick, unit, onSelectEntity }) {
  if (!lines || lines.length === 0) return null
  return (
    <div className="boq-group">
      <SectionHeader title="MS Grills & Handrails" />
      {lines.map(line => (
        <BoqRow
          key={`${line.rateKey}::${line.formulaId}`}
          line={line}
          rates={rates} onRateChange={onRateChange}
          openId={openId} onInfoClick={onInfoClick} unit={unit}
          onSelectEntity={onSelectEntity}
        />
      ))}
    </div>
  )
}
