// Presentational ELV BOQ section.
//
// Consumes pre-filtered BoqLine[] from the canonical pipeline:
//   cctvLines     — category 'elv_cctv'      (CCTV cameras + coax + fittings)
//   dataLines     — category 'elv_data'      (LAN points, Wi-Fi, racks, CAT6, trunking risers)
//   securityLines — category 'elv_security'  (intrusion alarms, VDP, intercom)
//   avLines       — category 'elv_av'        (TV outlets, speakers)
//
// Floor scope is applied upstream by getBoqLines(state, rates, { floorId }).
// This component NEVER subscribes to the store and never computes quantities.
//
// Within each sub-system, lines are sub-grouped by line.meta.lineType
// (CABLE / FITTING / DEVICE / RISER) so cable, devices, and risers
// surface as distinct sub-headers under one procurement bucket.

import { SectionHeader, SubSectionHeader, BoqSubRow, fmtLineQty, BoqTotalRow } from './BoqRow'

const LINE_TYPE_LABELS = {
  CABLE:   'Cable',
  FITTING: 'Fittings',
  DEVICE:  'Devices',
  RISER:   'Risers',
}

const LINE_TYPE_ORDER = ['CABLE', 'DEVICE', 'FITTING', 'RISER']

function groupLinesByLineType(lines) {
  const map = new Map()
  for (const line of lines) {
    const lt = line.meta?.lineType ?? 'OTHER'
    if (!map.has(lt)) map.set(lt, [])
    map.get(lt).push(line)
  }
  const ordered = []
  for (const lt of LINE_TYPE_ORDER) if (map.has(lt)) ordered.push([lt, map.get(lt)])
  for (const [lt, group] of map) {
    if (!LINE_TYPE_ORDER.includes(lt)) ordered.push([lt, group])
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

function SubSystemBlock({ title, lines, rates, onRateChange, openId, onInfoClick, unit, onSelectEntity }) {
  if (!lines || lines.length === 0) return null
  const groups = groupLinesByLineType(lines)
  return (
    <>
      <SectionHeader title={title} />
      {groups.map(([lt, group]) => (
        <div key={lt} className="boq-section">
          <SubSectionHeader title={LINE_TYPE_LABELS[lt] ?? lt} />
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

export default function ElvBoqSection({
  cctvLines = [],
  dataLines = [],
  securityLines = [],
  avLines = [],
  rates,
  onRateChange,
  openId,
  onInfoClick,
  unit,
  onSelectEntity,
}) {
  const allLines = [...cctvLines, ...dataLines, ...securityLines, ...avLines]
  if (allLines.length === 0) return null

  const totalFt  = sumQty(allLines, 'ft')
  const totalNos = sumQty(allLines, 'nos')

  return (
    <div className="boq-group">
      <SubSystemBlock
        title="ELV — CCTV"
        lines={cctvLines}
        rates={rates}
        onRateChange={onRateChange}
        openId={openId}
        onInfoClick={onInfoClick}
        unit={unit}
        onSelectEntity={onSelectEntity}
      />
      <SubSystemBlock
        title="ELV — data / network"
        lines={dataLines}
        rates={rates}
        onRateChange={onRateChange}
        openId={openId}
        onInfoClick={onInfoClick}
        unit={unit}
        onSelectEntity={onSelectEntity}
      />
      <SubSystemBlock
        title="ELV — security"
        lines={securityLines}
        rates={rates}
        onRateChange={onRateChange}
        openId={openId}
        onInfoClick={onInfoClick}
        unit={unit}
        onSelectEntity={onSelectEntity}
      />
      <SubSystemBlock
        title="ELV — audio / video"
        lines={avLines}
        rates={rates}
        onRateChange={onRateChange}
        openId={openId}
        onInfoClick={onInfoClick}
        unit={unit}
        onSelectEntity={onSelectEntity}
      />
      {totalFt > 0 && (
        <BoqTotalRow
          label="Total ELV cable length"
          value={fmtLineQty({ qty: totalFt, unit: 'ft' }, unit)}
        />
      )}
      {totalNos > 0 && (
        <BoqTotalRow
          label="Total ELV devices/fittings"
          value={`${totalNos} nos`}
        />
      )}
    </div>
  )
}
