// Steel by bar diameter — presentational. Accepts pre-filtered
// steel_by_diameter BoqLine[]. Mirrors the JoineryBoqSection pattern.
//
// Lines from src/boq/lines.js are emitted as one line per non-zero
// bar diameter (Ø8 / Ø10 / Ø12 / Ø16 / Ø20 / Ø25 / Ø32 mm). qty is
// the number of pieces at the standard bar length (default 6m;
// configurable via projectSettings.bbsDefaults.standardBarLengthM).

import { SectionHeader, BoqRow } from './BoqRow'

export default function SteelByDiaSection({ lines, rates, onRateChange, openId, onInfoClick, unit, onSelectEntity }) {
  if (!lines || lines.length === 0) return null
  return (
    <div className="boq-group">
      <SectionHeader title="Steel — by Bar Diameter (Procurement)" />
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
