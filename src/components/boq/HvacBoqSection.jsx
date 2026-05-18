// Presentational HVAC BOQ section.
//
// Consumes pre-filtered BoqLine[] from the canonical pipeline:
//   refrigerantLines — category 'hvac_refrigerant'  (copper pipe + fittings)
//   condensateLines  — category 'hvac_condensate'   (UPVC pipe + fittings)
//   unitLines        — category 'hvac_units'        (AC indoor/outdoor, fans, ...)
//
// Floor scope is applied upstream by getBoqLines(state, rates, { floorId }).
// This component NEVER subscribes to the store and never computes quantities.
//
// Grouping rule: refrigerant lines are sub-grouped by line.meta.system so
// future systems (e.g. VRF branch piping) slot in beside REFRIGERANT
// without component changes. Today there's just one system per category
// but the pattern matches ElectricalBoqSection.

import { SectionHeader, SubSectionHeader, BoqSubRow, BoqRow, fmtLineQty, BoqTotalRow } from './BoqRow'

const SYSTEM_LABELS = {
  REFRIGERANT: 'Refrigerant',
  CONDENSATE:  'Condensate',
}

const SYSTEM_ORDER = ['REFRIGERANT', 'CONDENSATE']

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

export default function HvacBoqSection({
  refrigerantLines = [],
  condensateLines = [],
  unitLines = [],
  rates,
  onRateChange,
  openId,
  onInfoClick,
  unit,
  onSelectEntity,
}) {
  const hasAny =
    refrigerantLines.length + condensateLines.length + unitLines.length > 0
  if (!hasAny) return null

  const totalFt  = sumQty([...refrigerantLines, ...condensateLines], 'ft')
  const totalNos = sumQty(unitLines, 'nos')

  return (
    <div className="boq-group">
      <GroupedSubSection
        title="HVAC — refrigerant"
        lines={refrigerantLines}
        rates={rates}
        onRateChange={onRateChange}
        openId={openId}
        onInfoClick={onInfoClick}
        unit={unit}
        onSelectEntity={onSelectEntity}
      />
      <GroupedSubSection
        title="HVAC — condensate"
        lines={condensateLines}
        rates={rates}
        onRateChange={onRateChange}
        openId={openId}
        onInfoClick={onInfoClick}
        unit={unit}
        onSelectEntity={onSelectEntity}
      />
      {unitLines.length > 0 && (
        <>
          <SectionHeader title="HVAC — units" />
          {unitLines.map(line => (
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
          label="Total HVAC pipe length"
          value={fmtLineQty({ qty: totalFt, unit: 'ft' }, unit)}
        />
      )}
      {totalNos > 0 && (
        <BoqTotalRow
          label="Total HVAC units"
          value={`${totalNos} nos`}
        />
      )}
    </div>
  )
}
