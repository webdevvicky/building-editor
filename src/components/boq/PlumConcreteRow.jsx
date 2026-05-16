// Presentational. Renders plum concrete BoqLine (single line, when present).

import { BoqRow } from './BoqRow'

export default function PlumConcreteRow({ lines, rates, onRateChange, openId, onInfoClick, unit }) {
  if (!lines || lines.length === 0) return null

  return (
    <div style={{ marginBottom: 8 }}>
      {lines.map(line => (
        <BoqRow key={line.id} line={line}
          rates={rates} onRateChange={onRateChange}
          openId={openId} onInfoClick={onInfoClick} unit={unit} />
      ))}
    </div>
  )
}
