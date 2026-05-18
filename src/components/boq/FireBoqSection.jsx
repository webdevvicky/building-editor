// Presentational Fire BOQ section.
//
// Consumes pre-filtered BoqLine[] from the canonical pipeline:
//   detectionLines   — category 'fire_detection'    (cable + fittings)
//   suppressionLines — category 'fire_suppression'  (GI sprinkler pipe + fittings + risers)
//   equipmentLines   — category 'fire_equipment'    (detectors, extinguishers, panels, ...)
//
// Floor scope is applied upstream by getBoqLines(state, rates, { floorId }).
// This component NEVER subscribes to the store and never computes quantities.

import { SectionHeader, SubSectionHeader, BoqSubRow, BoqRow, fmtLineQty, BoqTotalRow } from './BoqRow'

const SYSTEM_LABELS = {
  DETECTION:   'Detection',
  SUPPRESSION: 'Suppression',
}

const SYSTEM_ORDER = ['DETECTION', 'SUPPRESSION']

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

export default function FireBoqSection({
  detectionLines = [],
  suppressionLines = [],
  equipmentLines = [],
  rates,
  onRateChange,
  openId,
  onInfoClick,
  unit,
  onSelectEntity,
}) {
  const hasAny =
    detectionLines.length + suppressionLines.length + equipmentLines.length > 0
  if (!hasAny) return null

  const totalFt  = sumQty([...detectionLines, ...suppressionLines], 'ft')
  const totalNos = sumQty(equipmentLines, 'nos')

  return (
    <div className="boq-group">
      <GroupedSubSection
        title="Fire — detection"
        lines={detectionLines}
        rates={rates}
        onRateChange={onRateChange}
        openId={openId}
        onInfoClick={onInfoClick}
        unit={unit}
        onSelectEntity={onSelectEntity}
      />
      <GroupedSubSection
        title="Fire — suppression"
        lines={suppressionLines}
        rates={rates}
        onRateChange={onRateChange}
        openId={openId}
        onInfoClick={onInfoClick}
        unit={unit}
        onSelectEntity={onSelectEntity}
      />
      {equipmentLines.length > 0 && (
        <>
          <SectionHeader title="Fire — equipment" />
          {equipmentLines.map(line => (
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
          label="Total fire pipe/cable length"
          value={fmtLineQty({ qty: totalFt, unit: 'ft' }, unit)}
        />
      )}
      {totalNos > 0 && (
        <BoqTotalRow
          label="Total fire devices"
          value={`${totalNos} nos`}
        />
      )}
    </div>
  )
}
