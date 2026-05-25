// Tiles BOQ section — presentational. Accepts pre-filtered
// tiles BoqLine[] from src/boq/lines.js (floor, dado, skirting, counter).

import { SectionHeader, BoqRow } from './BoqRow'

export default function TilesBoqSection({ lines, rates, onRateChange, openId, onInfoClick, unit, onSelectEntity }) {
  if (!lines || lines.length === 0) return null
  return (
    <div className="boq-group">
      <SectionHeader title="Tiles, Skirting & Counter" />
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
