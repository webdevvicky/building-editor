// Joinery hardware — presentational. Accepts pre-filtered
// joinery_hardware BoqLine[]. One line per hardware item summed
// across all openings (hinges, locks, latches, closers, stoppers,
// handles, tracks, window stays, mosquito mesh).
//
// Mosquito mesh special-case: qty is in Sft (mesh per opening area),
// not nos — the unit field carries this.

import { SectionHeader, BoqRow } from './BoqRow'

export default function JoineryHardwareBoqSection({ lines, rates, onRateChange, openId, onInfoClick, unit, onSelectEntity }) {
  if (!lines || lines.length === 0) return null
  return (
    <div className="boq-group">
      <SectionHeader title="Joinery Hardware (Doors + Windows)" />
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
