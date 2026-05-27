// Paint materials — presentational. Accepts pre-filtered
// paint_materials BoqLine[]. One line per (system × layer) — e.g.
// "Standard acrylic interior (3-coat) — Primer (acrylic latex)".
//
// Qty is in gallons (or 'nos' for sandpaper sheets). Driven by paint
// system layer definitions in src/specs/paintSystems.js — per-room
// overrides via room.paintSystemId resolve through computePaintQuantities.

import { SectionHeader, BoqRow } from './BoqRow'

export default function PaintMaterialsBoqSection({ lines, rates, onRateChange, openId, onInfoClick, unit, onSelectEntity }) {
  if (!lines || lines.length === 0) return null
  return (
    <div className="boq-group">
      <SectionHeader title="Paint Materials (gallons by layer)" />
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
