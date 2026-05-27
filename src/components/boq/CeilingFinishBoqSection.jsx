// Ceiling finish — presentational. Accepts pre-filtered
// ceiling_finish BoqLine[]. False-ceiling materials (gypsum board,
// cement board, GI framing, screws, etc.) per system.
//
// Only rooms with finishes.ceilingPlaster=true contribute (false
// ceiling sits below structural plaster). Per-room overrides via
// room.ceilingFinishId resolve through computeCeilingFinishQuantities.

import { SectionHeader, BoqRow } from './BoqRow'

export default function CeilingFinishBoqSection({ lines, rates, onRateChange, openId, onInfoClick, unit, onSelectEntity }) {
  if (!lines || lines.length === 0) return null
  return (
    <div className="boq-group">
      <SectionHeader title="Ceiling Finish (False Ceiling Materials)" />
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
