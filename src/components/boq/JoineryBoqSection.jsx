// Joinery BOQ section — presentational. Accepts pre-filtered
// joinery BoqLine[] from src/boq/lines.js. Lines are already grouped
// by subtype via line.meta.subtype + label prefix.

import { SectionHeader, BoqRow } from './BoqRow'

export default function JoineryBoqSection({ lines, rates, onRateChange, openId, onInfoClick, unit, onSelectEntity }) {
  if (!lines || lines.length === 0) return null
  return (
    <div className="boq-group">
      <SectionHeader title="Joinery (Doors / Windows / Ventilators)" />
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
