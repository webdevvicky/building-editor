// Read-only view of the derived structural members a wall or column carries (erp-saas
// D-280): its bands, tie band, loft, the sunshades over its windows, or its inline
// footing. Each shows its permanent label, what it comes from, the sizes the ERP
// quantifies it by and its IS-2502 bars. Nothing here edits a member: it changes only
// through its parent (the wall's beam flags, the window's sunshade, the column's
// type), so a member can never disagree with what it is derived from.

import { useMemo } from 'react'
import { useStore } from '../store'
import { describeDerivedMember } from '../boq/elementLabels.js'
import { derivedMemberFacts, derivedMemberErpKind } from '../projects/structuralFacts.js'

const box = {
  marginTop: 'var(--space-3)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--color-border)',
}
const heading = {
  fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-2)',
  color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)',
}
const row = {
  padding: 'var(--space-1) var(--space-2)', marginBottom: 'var(--space-1)',
  background: 'var(--color-bg-muted)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)',
}
const muted = { color: 'var(--color-text-muted)' }

function sizeText(kind, f) {
  if (kind === 'BEAM') return f.spanMm ? `${f.sectionWidthMm ?? '—'} × ${f.sectionDepthMm ?? '—'} mm, span ${f.spanMm} mm` : 'no section'
  if (kind === 'FOUNDATION') return `${f.sectionDepthMm} × ${f.sectionWidthMm} mm pad, ${f.thicknessMm} mm deep`
  const plan = `${f.sectionWidthMm ?? '—'} × ${f.sectionDepthMm ?? '—'} mm`
  return f.thicknessMm ? `${plan}, ${f.thicknessMm} mm thick` : `${plan} — thickness not set (no concrete quantity)`
}

function barsText(bars) {
  if (!bars.length) return 'no bars (no reinforcement spec)'
  const kg = bars.reduce((s, b) => s + b.totalWeightKg, 0)
  return `${bars.map((b) => `${b.count}× T${b.diaMm} ${b.role.toLowerCase()}`).join(', ')} — ${kg.toFixed(2)} kg`
}

/** @param {{ wallId?: string, columnId?: string }} props */
export default function DerivedMembersSection({ wallId, columnId }) {
  const derivedMembers = useStore((s) => s.derivedMembers)
  const walls = useStore((s) => s.walls)
  const nodes = useStore((s) => s.nodes)
  const columns = useStore((s) => s.columns)
  const projectSettings = useStore((s) => s.projectSettings)

  const rows = useMemo(() => {
    // The live store state: the bar engine caches its run per state object.
    const state = useStore.getState()
    return Object.values(derivedMembers)
      .filter((m) => (wallId ? m.hostWallId === wallId : m.hostColumnId === columnId))
      .map((m) => {
        const facts = derivedMemberFacts(m, state)
        const kind = derivedMemberErpKind(m)
        return { member: m, text: describeDerivedMember(state, m), size: sizeText(kind, facts), bars: barsText(facts.bars) }
      })
      .sort((a, b) => a.text.label.localeCompare(b.text.label))
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the facts read the whole drawing from the store; these subscribed parts are what they depend on
  }, [derivedMembers, walls, nodes, columns, projectSettings, wallId, columnId])

  if (!rows.length) return null
  return (
    <div style={box}>
      <div style={heading}>Derived members (read-only)</div>
      {rows.map(({ member, text, size, bars }) => (
        <div key={member.id} style={row} title={`ERP element ${member.ifcGlobalId}`}>
          <div><strong>{text.title}</strong> <span style={muted}>· {text.source}</span></div>
          <div style={muted}>{size}</div>
          <div style={muted}>{bars}</div>
          {member.predecessorIfcIds?.length > 0 && (
            <div style={muted}>replaces {member.predecessorIfcIds.length} earlier member(s)</div>
          )}
        </div>
      ))}
    </div>
  )
}
