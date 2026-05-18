// Presentational plumbing BOQ section.
//
// Consumes pre-filtered BoqLine[] from the canonical pipeline:
//   supplyLines   — category 'plumbing_supply'    (CPVC pipes + supply fittings)
//   drainageLines — category 'plumbing_drainage'  (UPVC pipes + drainage fittings)
//   fixturesLines — category 'plumbing_fixtures'  (WC / wash basin / floor trap / …)
//
// Floor scope is applied upstream by getBoqLines(state, rates, { floorId }).
// This component NEVER subscribes to the store and never computes quantities.
//
// Grouping rule: supply + drainage are sub-grouped by line.meta.system so
// users see "Cold Supply" / "Hot Supply" / "Soil Drain" / "Waste Drain"
// etc. as sub-section headers. Fixtures stay flat.

import { SectionHeader, SubSectionHeader, BoqSubRow, BoqRow, fmtLineQty, BoqTotalRow } from './BoqRow'

// Map system code → human-readable group header.
const SYSTEM_LABELS = {
  COLD_SUPPLY: 'Cold supply',
  HOT_SUPPLY:  'Hot supply',
  HOT_RECIRC:  'Hot recirc',
  SOIL_DRAIN:  'Soil drain',
  WASTE_DRAIN: 'Waste drain',
  RAINWATER:   'Rainwater',
  VENT:        'Vent',
}

// Stable insertion order for sub-sections; unknown systems pin to the end
// in their original encounter order.
const SYSTEM_ORDER = [
  'COLD_SUPPLY', 'HOT_SUPPLY', 'HOT_RECIRC',
  'SOIL_DRAIN',  'WASTE_DRAIN', 'VENT', 'RAINWATER',
]

function groupLinesBySystem(lines) {
  const map = new Map()
  for (const line of lines) {
    const system = line.meta?.system ?? 'OTHER'
    if (!map.has(system)) map.set(system, [])
    map.get(system).push(line)
  }
  // Order by SYSTEM_ORDER first, then insertion order for any leftovers.
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

export default function PlumbingBoqSection({
  supplyLines = [],
  drainageLines = [],
  fixturesLines = [],
  rates,
  onRateChange,
  openId,
  onInfoClick,
  unit,
  onSelectEntity,
}) {
  const hasAny =
    supplyLines.length + drainageLines.length + fixturesLines.length > 0
  if (!hasAny) return null

  const totalFt = sumQty([...supplyLines, ...drainageLines], 'ft')
  const totalNos = sumQty([...supplyLines, ...drainageLines, ...fixturesLines], 'nos')

  return (
    <div className="boq-group">
      <GroupedSubSection
        title="Plumbing — supply"
        lines={supplyLines}
        rates={rates}
        onRateChange={onRateChange}
        openId={openId}
        onInfoClick={onInfoClick}
        unit={unit}
        onSelectEntity={onSelectEntity}
      />
      <GroupedSubSection
        title="Plumbing — drainage"
        lines={drainageLines}
        rates={rates}
        onRateChange={onRateChange}
        openId={openId}
        onInfoClick={onInfoClick}
        unit={unit}
        onSelectEntity={onSelectEntity}
      />
      {fixturesLines.length > 0 && (
        <>
          <SectionHeader title="Plumbing — fixtures" />
          {fixturesLines.map(line => (
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
          label="Total pipe length"
          value={fmtLineQty({ qty: totalFt, unit: 'ft' }, unit)}
        />
      )}
      {totalNos > 0 && (
        <BoqTotalRow
          label="Total count (fixtures + fittings)"
          value={`${totalNos} nos`}
        />
      )}
    </div>
  )
}
