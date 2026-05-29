// BBS-5 — Bar Bending Schedule panel.
//
// Purely presentational. computeRebarGroups(state, { floorId }) is the
// single source of truth; everything in this file is rendering and local
// UI state (tab selection, drill-down expansion).
//
// Indian 10-column site BBS layout (residential convention):
//   Sl | Member | Mark | Type & Dia | Shape | Members | Bars Each |
//   Total Bars | Cut Length (mm) | Total Length (m) | Unit Wt (kg/m) |
//   Total Wt (kg)
//
// /* TODO BBS-5b: Excel + PDF export */

import React, { useMemo, useState } from 'react'
import { useStore } from '../store'
import { computeRebarGroups, ELEMENT_TYPE } from '../bbs/index.js'
import { BBS_CATEGORY_ORDER, BBS_CATEGORY_LABEL } from '../bbs/types.js'
import { concreteByBbsCategory } from '../bbs/concrete.js'
import { exportBbsExcel, exportBbsPdf } from '../export/bbs.js'
import { CATALOG_VERSION } from '../specs/cuttingLength.js'
import { humanizeAssignmentSource } from '../specs/resolution.js'
import { safeR2 } from '../lib/numbers.js'
import { Modal } from './ui/Modal.jsx'
import { Button } from './ui/Button.jsx'

// ── styling tokens (CSS variables only — no hex) ─────────────────────────
const headerWrap = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
  flexWrap: 'wrap',
  marginBottom: 'var(--space-3)',
}
const headerTitle = {
  fontSize: 'var(--text-md)',
  fontWeight: 'var(--weight-semibold)',
  color: 'var(--color-text)',
}
const headerMuted = {
  fontSize: 'var(--text-sm)',
  color: 'var(--color-text-muted)',
}
const headerPill = {
  fontSize: 'var(--text-xs)',
  background: 'var(--color-primary-bg)',
  color: 'var(--color-primary-text)',
  border: '1px solid var(--color-primary)',
  borderRadius: 'var(--radius-sm)',
  padding: '2px var(--space-2)',
  fontWeight: 'var(--weight-medium)',
}
const tabsRow = {
  display: 'flex',
  gap: 'var(--space-1)',
  flexWrap: 'wrap',
  marginBottom: 'var(--space-2)',
}
const tabBtn = (active) => ({
  fontSize: 'var(--text-sm)',
  padding: '4px var(--space-3)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  background: active ? 'var(--color-primary-bg)' : 'var(--color-surface)',
  color: active ? 'var(--color-primary-text)' : 'var(--color-text-secondary)',
  fontWeight: active ? 'var(--weight-semibold)' : 'var(--weight-regular)',
  cursor: 'pointer',
})
const tableWrap = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  overflow: 'auto',
  maxHeight: 420,
  background: 'var(--color-surface)',
}
const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 'var(--text-sm)',
  fontVariantNumeric: 'tabular-nums',
}
const thStyle = {
  textAlign: 'left',
  padding: 'var(--space-2) var(--space-2)',
  borderBottom: '1px solid var(--color-border-strong)',
  background: 'var(--color-bg-subtle)',
  color: 'var(--color-text-secondary)',
  fontWeight: 'var(--weight-semibold)',
  fontSize: 'var(--text-xs)',
  textTransform: 'uppercase',
  letterSpacing: 0.3,
  position: 'sticky',
  top: 0,
  zIndex: 1,
}
const tdStyle = {
  padding: 'var(--space-2)',
  borderBottom: '1px solid var(--color-border)',
  color: 'var(--color-text)',
  whiteSpace: 'nowrap',
}
const tdNumStyle = { ...tdStyle, textAlign: 'right' }
const groupHeaderRow = {
  ...tdStyle,
  background: 'var(--color-bg-muted)',
  color: 'var(--color-text-secondary)',
  fontWeight: 'var(--weight-semibold)',
  fontSize: 'var(--text-xs)',
  textTransform: 'uppercase',
  letterSpacing: 0.3,
  cursor: 'pointer',
}
const sectionHead = {
  fontSize: 'var(--text-xs)',
  fontWeight: 'var(--weight-bold)',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
  letterSpacing: 0.5,
  marginBottom: 'var(--space-2)',
  marginTop: 'var(--space-4)',
}
const summaryGrid = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  overflow: 'hidden',
  background: 'var(--color-surface)',
}
const sourcePill = (source) => {
  // Tier color: instance/wall override = success, type/class default = info,
  // project default = muted, estimate = warning.
  let bg = 'var(--color-bg-muted)'
  let fg = 'var(--color-text-secondary)'
  let bd = 'var(--color-border)'
  if (source === 'INSTANCE' || source === 'WALL_INSTANCE') {
    bg = 'var(--color-success-bg)'
    fg = 'var(--color-success)'
    bd = 'var(--color-success-border)'
  } else if (source === 'TYPE' || source === 'CLASS') {
    bg = 'var(--color-primary-bg)'
    fg = 'var(--color-primary-text)'
    bd = 'var(--color-primary)'
  } else if (source === 'ESTIMATE') {
    bg = 'var(--color-warning-bg)'
    fg = 'var(--color-warning)'
    bd = 'var(--color-warning-border)'
  }
  return {
    fontSize: 'var(--text-xs)',
    background: bg,
    color: fg,
    border: `1px solid ${bd}`,
    borderRadius: 'var(--radius-sm)',
    padding: '1px var(--space-2)',
    fontWeight: 'var(--weight-medium)',
    display: 'inline-block',
    marginLeft: 'var(--space-2)',
  }
}
const footerNote = {
  marginTop: 'var(--space-3)',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-muted)',
  textAlign: 'right',
}
const emptyState = {
  textAlign: 'center',
  padding: 'var(--space-8) var(--space-4)',
  color: 'var(--color-text-muted)',
  fontSize: 'var(--text-sm)',
}

// ── element-type label maps ──────────────────────────────────────────────
const ELEMENT_LABEL = {
  [ELEMENT_TYPE.COLUMN]:  'Column',
  [ELEMENT_TYPE.BEAM]:    'Beam',
  [ELEMENT_TYPE.FOOTING]: 'Footing',
  [ELEMENT_TYPE.SLAB]:    'Slab',
}
const ELEMENT_TABS = [
  { id: 'ALL',     label: 'All' },
  { id: ELEMENT_TYPE.FOOTING, label: 'Footings' },
  { id: ELEMENT_TYPE.COLUMN,  label: 'Columns' },
  { id: ELEMENT_TYPE.BEAM,    label: 'Beams' },
  { id: ELEMENT_TYPE.SLAB,    label: 'Slabs' },
  { id: 'ABSTRACT', label: 'Abstract' },
  { id: 'SUMMARY', label: 'Summary' },
]
const DIA_COLS = [8, 10, 12, 16, 20, 25]

// ── helpers ──────────────────────────────────────────────────────────────
function floorLabelOf(state, floorId) {
  if (!floorId) return '—'
  const floors = state?.projectSettings?.floors ?? []
  const f = floors.find(x => x.id === floorId)
  return f?.label || floorId
}

function shapeGlyph(shapeCode) {
  // Tiny ASCII / unicode glyphs as compact shape hints. Real IS 2502
  // sketches are deferred to a follow-up.
  switch (shapeCode) {
    case '00': return '──'
    case '01': return '└─'
    case '02': return '┘─└'
    case '03': return '╱╲╱'
    case '11': return '└'
    case '38': return '└┘'
    case '75': return '▭'
    default:   return shapeCode || '—'
  }
}

function membersAndBarsEach(g) {
  // Inline footing buckets carry footingCount in meta and aggregate N
  // identical footings into one group. Split count → (members × barsEach).
  const fc = g?.meta?.footingCount
  if (typeof fc === 'number' && fc > 1 && g.count % fc === 0) {
    return { members: fc, barsEach: g.count / fc }
  }
  return { members: 1, barsEach: g.count }
}

// Group rows by (floorId, elementType, elementId) preserving sorted order.
function groupForRendering(groups) {
  const out = []
  let current = null
  for (const g of groups) {
    const key = `${g.floorId}::${g.elementType}::${g.elementId}`
    if (!current || current.key !== key) {
      current = {
        key,
        floorId:     g.floorId,
        elementType: g.elementType,
        elementId:   g.elementId,
        rows:        [],
      }
      out.push(current)
    }
    current.rows.push(g)
  }
  return out
}

// ── main panel ───────────────────────────────────────────────────────────
export default function BBSSchedulePanel() {
  const activeTool       = useStore(s => s.activeTool)
  const setTool          = useStore(s => s.setTool)
  const currentFloorId   = useStore(s => s.currentFloorId)
  // Subscribe to the slices computeRebarGroups depends on so the panel
  // recomputes on edits.
  const projectSettings  = useStore(s => s.projectSettings)
  const columns          = useStore(s => s.columns)
  const beams            = useStore(s => s.beams)
  const slabs            = useStore(s => s.slabs)
  const foundations      = useStore(s => s.foundations)
  const walls            = useStore(s => s.walls)
  // eslint-disable-next-line no-unused-vars
  const _deps = { projectSettings, columns, beams, slabs, foundations, walls }

  const [selectedElement, setSelectedElement] = useState('ALL')
  const [selectedFloor,   setSelectedFloor]   = useState('ALL')
  const [collapsed,       setCollapsed]       = useState(() => new Set())

  const open = activeTool === 'bbs_schedule'
  const onClose = () => setTool('select')

  // ── Compute ────────────────────────────────────────────────────────────
  const result = useMemo(() => {
    if (!open) return null
    const state = useStore.getState()
    const opts = selectedFloor === 'ALL' ? undefined : { floorId: selectedFloor }
    return computeRebarGroups(state, opts)
    // _deps is intentionally read above so the store fields are
    // tracked even though computeRebarGroups uses getState() directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedFloor, projectSettings, columns, beams, slabs, foundations, walls])

  if (!open) return null

  const groups = result?.groups ?? []
  const filtered = selectedElement === 'ALL' || selectedElement === 'SUMMARY'
    ? groups
    : groups.filter(g => g.elementType === selectedElement)

  const projectTitle = projectSettings?.projectMeta?.projectTitle || 'Untitled project'
  const stdBarLengthM = result?.standardBarLengthM ?? 6
  const floors = [...(projectSettings?.floors ?? [])].sort(
    (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0),
  )

  function toggleCollapse(key) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="BBS Schedule"
      width={1080}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div style={headerMuted}>
            Catalog: IS 2502 v{CATALOG_VERSION}
          </div>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      }
    >
      {/* Header */}
      <div style={headerWrap}>
        <span style={headerTitle}>{projectTitle}</span>
        <span style={headerPill}>Std bar length: {stdBarLengthM} m</span>
        <span style={headerMuted}>
          Current floor: {floorLabelOf({ projectSettings }, currentFloorId)}
        </span>
      </div>

      {/* Element tabs */}
      <div style={tabsRow}>
        {ELEMENT_TABS.map(t => (
          <button
            key={t.id}
            type="button"
            style={tabBtn(selectedElement === t.id)}
            onClick={() => setSelectedElement(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Floor tabs */}
      <div style={tabsRow}>
        <button
          type="button"
          style={tabBtn(selectedFloor === 'ALL')}
          onClick={() => setSelectedFloor('ALL')}
        >
          All Floors
        </button>
        {floors.map(f => (
          <button
            key={f.id}
            type="button"
            style={tabBtn(selectedFloor === f.id)}
            onClick={() => setSelectedFloor(f.id)}
          >
            {f.label || f.id}
          </button>
        ))}
      </div>

      {/* Body */}
      {selectedElement === 'ABSTRACT' ? (
        <AbstractView result={result} />
      ) : selectedElement === 'SUMMARY' ? (
        <SummaryView result={result} />
      ) : groups.length === 0 ? (
        <div style={emptyState}>
          No reinforcement specs assigned. Open BBS Specs to assign defaults.
        </div>
      ) : filtered.length === 0 ? (
        <div style={emptyState}>
          No bars of the selected element type in this scope.
        </div>
      ) : (
        <ScheduleTable
          groups={filtered}
          state={{ projectSettings }}
          collapsed={collapsed}
          toggleCollapse={toggleCollapse}
        />
      )}

      {/* Summary by diameter — visible under every tab except SUMMARY/ABSTRACT */}
      {selectedElement !== 'SUMMARY' && selectedElement !== 'ABSTRACT' && groups.length > 0 && (
        <>
          <div style={sectionHead}>Summary by Diameter</div>
          <DiameterSummary result={result} />
        </>
      )}

      <div style={{ ...footerNote, display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', alignItems: 'center' }}>
        <span>Export full schedule (detail sheets + abstract):</span>
        <Button variant="secondary" disabled={groups.length === 0}
          onClick={() => {
            const opts = { generatedAt: new Date().toISOString() }
            if (selectedFloor !== 'ALL') opts.floorId = selectedFloor
            exportBbsExcel(useStore.getState(), opts)
          }}>Excel</Button>
        <Button variant="secondary" disabled={groups.length === 0}
          onClick={() => {
            const opts = { generatedAt: new Date().toISOString() }
            if (selectedFloor !== 'ALL') opts.floorId = selectedFloor
            exportBbsPdf(useStore.getState(), opts)
          }}>PDF</Button>
      </div>
    </Modal>
  )
}

// ── abstract view (Level 2) — category × diameter kg + concrete + ratio ──────
function AbstractView({ result }) {
  const byCat = result?.totals?.byBbsCategory ?? {}
  const concrete = useMemo(
    () => concreteByBbsCategory(useStore.getState(), byCat),
    [byCat],
  )
  const cats = [
    ...BBS_CATEGORY_ORDER.filter(c => byCat[c]),
    ...Object.keys(byCat).filter(c => !BBS_CATEGORY_ORDER.includes(c)),
  ]
  if (cats.length === 0) return <div style={emptyState}>No bars scheduled in this scope.</div>
  let grandKg = 0, grandM3 = 0
  return (
    <div style={summaryGrid}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Member</th>
            {DIA_COLS.map(d => <th key={d} style={{ ...thStyle, textAlign: 'right' }}>Ø{d}</th>)}
            <th style={{ ...thStyle, textAlign: 'right' }}>Total kg</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Conc m³</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>kg/m³</th>
          </tr>
        </thead>
        <tbody>
          {cats.map(c => {
            const ent = byCat[c]
            const m3 = concrete[c] ?? 0
            grandKg += ent.totalKg; grandM3 += m3
            return (
              <tr key={c}>
                <td style={tdStyle}>{BBS_CATEGORY_LABEL[c] ?? c}</td>
                {DIA_COLS.map(d => <td key={d} style={tdNumStyle}>{safeR2(ent.byDiaKg?.[d] ?? 0).toFixed(1)}</td>)}
                <td style={{ ...tdNumStyle, fontWeight: 'var(--weight-semibold)' }}>{safeR2(ent.totalKg).toFixed(1)}</td>
                <td style={tdNumStyle}>{m3 > 0 ? safeR2(m3).toFixed(2) : '—'}</td>
                <td style={tdNumStyle}>{m3 > 0 ? safeR2(ent.totalKg / m3).toFixed(0) : '—'}</td>
              </tr>
            )
          })}
          <tr>
            <td style={{ ...tdStyle, fontWeight: 'var(--weight-bold)' }}>GRAND TOTAL</td>
            {DIA_COLS.map(d => <td key={d} style={tdNumStyle} />)}
            <td style={{ ...tdNumStyle, fontWeight: 'var(--weight-bold)' }}>{safeR2(grandKg).toFixed(1)}</td>
            <td style={{ ...tdNumStyle, fontWeight: 'var(--weight-bold)' }}>{grandM3 > 0 ? safeR2(grandM3).toFixed(2) : '—'}</td>
            <td style={{ ...tdNumStyle, fontWeight: 'var(--weight-bold)' }}>{grandM3 > 0 ? safeR2(grandKg / grandM3).toFixed(0) : '—'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ── schedule table ───────────────────────────────────────────────────────
function ScheduleTable({ groups, state, collapsed, toggleCollapse }) {
  const renderGroups = useMemo(() => groupForRendering(groups), [groups])

  let sl = 0
  return (
    <div style={tableWrap}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Sl</th>
            <th style={thStyle}>Member</th>
            <th style={thStyle}>Mark</th>
            <th style={thStyle}>Type &amp; Dia</th>
            <th style={thStyle}>Shape</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Members</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Bars Each</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Total Bars</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Cut Length (mm)</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Total Length (m)</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Unit Wt (kg/m)</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Total Wt (kg)</th>
          </tr>
        </thead>
        <tbody>
          {renderGroups.map(g => {
            const isCollapsed = collapsed.has(g.key)
            const memberLabel = ELEMENT_LABEL[g.elementType] || g.elementType
            const floorLbl = floorLabelOf(state, g.floorId)
            const groupTotalKg = g.rows.reduce((s, r) => s + (r.totalWeightKg || 0), 0)
            return (
              <React.Fragment key={g.key}>
                <tr onClick={() => toggleCollapse(g.key)}>
                  <td colSpan={12} style={groupHeaderRow}>
                    {isCollapsed ? '▸' : '▾'} {floorLbl} · {memberLabel} {g.elementId}
                    {'  '}—{'  '}
                    {g.rows.length} bar group{g.rows.length === 1 ? '' : 's'}, {safeR2(groupTotalKg).toFixed(1)} kg
                  </td>
                </tr>
                {!isCollapsed && g.rows.map(row => {
                  sl += 1
                  const { members, barsEach } = membersAndBarsEach(row)
                  return (
                    <tr key={row.markId + ':' + sl}>
                      <td style={tdStyle}>{sl}</td>
                      <td style={tdStyle}>{memberLabel} {g.elementId}</td>
                      <td style={tdStyle}>
                        {row.markId}
                        <span style={sourcePill(row.specSource)}>
                          {humanizeAssignmentSource(row.specSource)}
                        </span>
                      </td>
                      <td style={tdStyle}>{row.steelGrade} Ø{row.diaMm}</td>
                      <td style={tdStyle} title={`IS 2502 shape ${row.shapeCode}`}>
                        {shapeGlyph(row.shapeCode)} <span style={{ color: 'var(--color-text-muted)' }}>({row.shapeCode})</span>
                      </td>
                      <td style={tdNumStyle}>{members}</td>
                      <td style={tdNumStyle}>{barsEach}</td>
                      <td style={tdNumStyle}>{row.count}</td>
                      <td style={tdNumStyle}>{Math.round(row.cuttingLengthMm)}</td>
                      <td style={tdNumStyle}>{safeR2(row.totalLengthM).toFixed(2)}</td>
                      <td style={tdNumStyle}>{safeR2(row.unitWeightKgPerM).toFixed(3)}</td>
                      <td style={tdNumStyle}>{safeR2(row.totalWeightKg).toFixed(1)}</td>
                    </tr>
                  )
                })}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── summary views ────────────────────────────────────────────────────────
function DiameterSummary({ result }) {
  const byDia = result?.totals?.byDiameter ?? {}
  const diaKeys = Object.keys(byDia)
    .map(Number)
    .sort((a, b) => a - b)
  if (diaKeys.length === 0) {
    return <div style={emptyState}>No bars to summarize.</div>
  }
  return (
    <div style={summaryGrid}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Diameter (mm)</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Total Weight (kg)</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Pieces @ std length</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Column</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Beam</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Footing</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Slab</th>
          </tr>
        </thead>
        <tbody>
          {diaKeys.map(d => {
            const row = byDia[d]
            return (
              <tr key={d}>
                <td style={tdStyle}>Ø{d}</td>
                <td style={tdNumStyle}>{safeR2(row.totalKg).toFixed(1)}</td>
                <td style={tdNumStyle}>
                  {row.pieces} <span style={{ color: 'var(--color-text-muted)' }}>@ {row.standardBarLengthM}m</span>
                </td>
                <td style={tdNumStyle}>{safeR2(row.byCategory?.column ?? 0).toFixed(1)}</td>
                <td style={tdNumStyle}>{safeR2(row.byCategory?.beam ?? 0).toFixed(1)}</td>
                <td style={tdNumStyle}>{safeR2(row.byCategory?.footing ?? 0).toFixed(1)}</td>
                <td style={tdNumStyle}>{safeR2(row.byCategory?.slab ?? 0).toFixed(1)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SummaryView({ result }) {
  const totals = result?.totals
  if (!totals || totals.totalWeightKg <= 0) {
    return <div style={emptyState}>No bars scheduled in this scope.</div>
  }
  const cat = totals.byCategory ?? { column: 0, beam: 0, footing: 0, slab: 0 }
  return (
    <>
      <div style={sectionHead}>Totals by Element</div>
      <div style={summaryGrid}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Element</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Total Weight (kg)</th>
            </tr>
          </thead>
          <tbody>
            <tr><td style={tdStyle}>Footings</td><td style={tdNumStyle}>{safeR2(cat.footing).toFixed(1)}</td></tr>
            <tr><td style={tdStyle}>Columns</td><td style={tdNumStyle}>{safeR2(cat.column).toFixed(1)}</td></tr>
            <tr><td style={tdStyle}>Beams</td><td style={tdNumStyle}>{safeR2(cat.beam).toFixed(1)}</td></tr>
            <tr><td style={tdStyle}>Slabs</td><td style={tdNumStyle}>{safeR2(cat.slab).toFixed(1)}</td></tr>
            <tr>
              <td style={{ ...tdStyle, fontWeight: 'var(--weight-bold)' }}>Total</td>
              <td style={{ ...tdNumStyle, fontWeight: 'var(--weight-bold)' }}>
                {safeR2(totals.totalWeightKg).toFixed(1)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={sectionHead}>Summary by Diameter</div>
      <DiameterSummary result={result} />
    </>
  )
}

