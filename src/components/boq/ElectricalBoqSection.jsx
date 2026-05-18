// Presentational electrical BOQ section.
//
// Consumes pre-filtered BoqLine[] from the canonical pipeline:
//   wiringLines  — categories electrical_lighting | electrical_power |
//                  electrical_hvac | electrical_submain | electrical_solar |
//                  electrical_ev (wire + conduit + risers)
//   pointLines   — category 'electrical_points'    (LIGHT / FAN / SOCKET / ...)
//   fittingLines — category 'electrical_fittings'  (MCB counts)
//   dbLines      — category 'electrical_db'        (Distribution Board count)
//
// Floor scope is applied upstream by getBoqLines(state, rates, { floorId }).
// This component NEVER subscribes to the store and never computes quantities.
//
// Grouping rule: wiring is sub-grouped by line.meta.system so users see
// "Lighting" / "5A Power" / "AC" / "Geyser" / etc. as sub-section headers.
// Points and fittings stay flat. DB renders as a single info-style row.

import { SectionHeader, SubSectionHeader, BoqSubRow, BoqRow, fmtLineQty, BoqTotalRow } from './BoqRow'

const SYSTEM_LABELS = {
  LIGHTING:  'Lighting',
  POWER_5A:  '5A power',
  POWER_15A: '15A power',
  AC:        'AC',
  GEYSER:    'Geyser',
  SUBMAIN:   'Submain',
  SOLAR_TIE: 'Solar tie-in',
  SOLAR:     'Solar',
  EV:        'EV charger',
}

const SYSTEM_ORDER = [
  'LIGHTING', 'POWER_5A', 'POWER_15A', 'AC', 'GEYSER',
  'SUBMAIN', 'SOLAR_TIE', 'SOLAR', 'EV',
]

function groupLinesBySystem(lines) {
  const map = new Map()
  for (const line of lines) {
    const system = line.meta?.system ?? 'OTHER'
    if (!map.has(system)) map.set(system, [])
    map.get(system).push(line)
  }
  const ordered = []
  for (const sys of SYSTEM_ORDER) if (map.has(sys)) ordered.push([sys, map.get(sys)])
  for (const [sys, group] of map) {
    if (!SYSTEM_ORDER.includes(sys)) ordered.push([sys, group])
  }
  return ordered
}

function sumQty(lines, unit) {
  let total = 0
  for (const l of lines) {
    if (l.unit !== unit) continue
    total += Number(l.qty) || 0
  }
  return Math.round(total * 100) / 100
}

function GroupedSubSection({ title, lines, rates, onRateChange, openId, onInfoClick, unit, onSelectEntity }) {
  if (!lines || lines.length === 0) return null
  const groups = groupLinesBySystem(lines)
  return (
    <>
      <SectionHeader title={title} />
      {groups.map(([sys, group]) => (
        <div key={sys} className="boq-section">
          <SubSectionHeader title={SYSTEM_LABELS[sys] ?? sys} />
          {group.map(line => (
            <BoqSubRow
              key={line.id}
              line={line}
              rates={rates}
              onRateChange={onRateChange}
              openId={openId}
              onInfoClick={onInfoClick}
              unit={unit}
              onSelectEntity={onSelectEntity}
            />
          ))}
        </div>
      ))}
    </>
  )
}

export default function ElectricalBoqSection({
  wiringLines = [],
  pointLines = [],
  fittingLines = [],
  dbLines = [],
  rates,
  onRateChange,
  openId,
  onInfoClick,
  unit,
  onSelectEntity,
}) {
  const hasAny =
    wiringLines.length + pointLines.length + fittingLines.length + dbLines.length > 0
  if (!hasAny) return null

  const totalFt  = sumQty(wiringLines, 'ft')
  const totalNos = sumQty([...pointLines, ...fittingLines, ...dbLines], 'nos')

  return (
    <div className="boq-group">
      <GroupedSubSection
        title="Electrical — wiring"
        lines={wiringLines}
        rates={rates}
        onRateChange={onRateChange}
        openId={openId}
        onInfoClick={onInfoClick}
        unit={unit}
        onSelectEntity={onSelectEntity}
      />
      {pointLines.length > 0 && (
        <>
          <SectionHeader title="Electrical — points" />
          {pointLines.map(line => (
            <BoqRow
              key={line.id}
              line={line}
              rates={rates}
              onRateChange={onRateChange}
              openId={openId}
              onInfoClick={onInfoClick}
              unit={unit}
              onSelectEntity={onSelectEntity}
            />
          ))}
        </>
      )}
      {fittingLines.length > 0 && (
        <>
          <SectionHeader title="Electrical — fittings" />
          {fittingLines.map(line => (
            <BoqRow
              key={line.id}
              line={line}
              rates={rates}
              onRateChange={onRateChange}
              openId={openId}
              onInfoClick={onInfoClick}
              unit={unit}
              onSelectEntity={onSelectEntity}
            />
          ))}
        </>
      )}
      {dbLines.length > 0 && (
        <>
          <SectionHeader title="Electrical — distribution" />
          {dbLines.map(line => (
            <BoqRow
              key={line.id}
              line={line}
              rates={rates}
              onRateChange={onRateChange}
              openId={openId}
              onInfoClick={onInfoClick}
              unit={unit}
              onSelectEntity={onSelectEntity}
            />
          ))}
        </>
      )}
      {totalFt > 0 && (
        <BoqTotalRow
          label="Total wire + conduit length"
          value={fmtLineQty({ qty: totalFt, unit: 'ft' }, unit)}
        />
      )}
      {totalNos > 0 && (
        <BoqTotalRow
          label="Total count (points + fittings + DBs)"
          value={`${totalNos} nos`}
        />
      )}
    </div>
  )
}
