// Presentational. Renders plaster-material BoqLine[] from the canonical
// pipeline, grouped by plaster system (line.meta.plasterSystemId).

import { SectionHeader, SubSectionHeader, BoqSubRow } from './BoqRow'

export default function PlasterSection({ lines, rates, onRateChange, openId, onInfoClick, unit }) {
  if (!lines || lines.length === 0) return null

  // Group by plaster system. boq/lines.js stamps line.meta.plasterSystemId
  // on every plaster line.
  const groups = new Map()
  for (const line of lines) {
    const key = line.meta?.plasterSystemId ?? 'unknown'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(line)
  }

  // Strip "Plaster <SystemLabel> — " prefix; the sub-section header has the system.
  const stripPrefix = (l) => l.label.replace(/^Plaster\s+.+?\s+[—-]\s*/, '')
  // Extract a sub-header label from the first line of each group: "Plaster <SystemLabel> — ..."
  const sysLabel = (firstLine) => {
    const m = firstLine.label.match(/^Plaster\s+(.+?)\s+[—-]/)
    return m ? m[1] : firstLine.meta?.plasterSystemId
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <SectionHeader title="Plaster Materials" />
      {[...groups.entries()].map(([sysId, groupLines]) => (
        <div key={sysId} style={{ marginBottom: 10 }}>
          <SubSectionHeader title={sysLabel(groupLines[0])} />
          {groupLines.map(line => (
            <BoqSubRow key={line.id} line={line} labelOverride={stripPrefix(line)}
              rates={rates} onRateChange={onRateChange}
              openId={openId} onInfoClick={onInfoClick} unit={unit} />
          ))}
        </div>
      ))}
    </div>
  )
}
