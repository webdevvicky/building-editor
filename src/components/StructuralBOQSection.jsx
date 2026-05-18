// Presentational. Renders the four structural sub-sections from
// canonical BoqLine[] slices supplied by BOQPanel:
//   - Structural RCC  ← lines with category='rcc'
//   - Structural Steel ← category='steel' (already grouped-by-spec by the BBS pipeline)
//   - Concrete Materials ← category='concreteMix', grouped by formulaId (M7.5 vs M20)
//   - Staircase ← category='staircase'
//
// This component does NOT read the store. All quantity / cost data lives
// in the line objects. Floor-scope is applied upstream in getBoqLines.

import {
  SectionHeader, SubSectionHeader, BoqSubRow, BoqTotalRow, fmtLineQty,
} from './boq/BoqRow'

export default function StructuralBOQSection({
  rccLines, steelLines, concreteMixLines, staircaseLines,
  rates, onRateChange, openId, onInfoClick, unit,
}) {
  const hasRCC      = rccLines?.length > 0
  const hasSteel    = steelLines?.length > 0
  const hasConcrete = concreteMixLines?.length > 0
  const hasStair    = staircaseLines?.length > 0

  // Group concrete lines by formulaId so each grade gets one sub-section.
  // boq/lines.js emits formulaId='conc_M7_5' or 'conc_M20' across all rows
  // of a grade.
  const concreteByGrade = new Map()
  for (const line of (concreteMixLines ?? [])) {
    const k = line.formulaId
    if (!concreteByGrade.has(k)) concreteByGrade.set(k, [])
    concreteByGrade.get(k).push(line)
  }
  // Strip "M20 – " / "M7.5 – " prefix so rows show "Cement / Sand / Agg".
  // Grade is shown in the sub-section header.
  const stripGradePrefix = (l) => l.label.replace(/^M[\d.]+_*\d*\s*[–—-]\s*/, '')
  const gradeLabel = (firstLine) => {
    const m = firstLine.label.match(/^([^\s–—-]+)/)
    return m ? m[1] : firstLine.formulaId
  }

  const totalSteelKg = (steelLines ?? []).reduce((s, l) => s + (l.qty || 0), 0)
  const totalSteelLine = { qty: Math.round(totalSteelKg * 100) / 100, unit: 'kg' }

  return (
    <>
      {hasRCC && (
        <div className="boq-group">
          <SectionHeader title="Structural RCC" />
          {rccLines.map(line => (
            <BoqSubRow key={line.id} line={line}
              rates={rates} onRateChange={onRateChange}
              openId={openId} onInfoClick={onInfoClick} unit={unit} />
          ))}
        </div>
      )}

      {hasSteel && (
        <div className="boq-group">
          <SectionHeader title="Structural Steel" />
          {steelLines.map(line => (
            <BoqSubRow key={line.id} line={line}
              rates={rates} onRateChange={onRateChange}
              openId={openId} onInfoClick={onInfoClick} unit={unit} />
          ))}
          <BoqTotalRow label="Total steel" value={fmtLineQty(totalSteelLine, unit)} />
        </div>
      )}

      {hasConcrete && (
        <div className="boq-group">
          <SectionHeader title="Concrete Materials" />
          {[...concreteByGrade.entries()].map(([formulaId, gradeLines]) => (
            <div key={formulaId} className="boq-section">
              <SubSectionHeader title={gradeLabel(gradeLines[0])} />
              {gradeLines.map(line => (
                <BoqSubRow key={line.id} line={line}
                  labelOverride={stripGradePrefix(line)}
                  rates={rates} onRateChange={onRateChange}
                  openId={openId} onInfoClick={onInfoClick} unit={unit} />
              ))}
            </div>
          ))}
        </div>
      )}

      {hasStair && (
        <div className="boq-group">
          <SectionHeader title="Staircase" />
          {staircaseLines.map(line => (
            <BoqSubRow key={line.id} line={line}
              rates={rates} onRateChange={onRateChange}
              openId={openId} onInfoClick={onInfoClick} unit={unit} />
          ))}
        </div>
      )}
    </>
  )
}
