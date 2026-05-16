// Shared BOQ row primitives. Every BOQ section consumes pre-filtered
// BoqLine[] from the canonical pipeline (boq/lines.js) and renders rows
// via these components. Sections do NOT subscribe to the store directly
// for quantity data — that data lives in the line objects.

const COL = '1fr 68px 88px 70px'
const GAP = 3

const rateInputStyle = {
  width: 48, fontSize: 10, padding: '2px 4px',
  border: '1px solid #ddd', borderRadius: 3, textAlign: 'right', outline: 'none',
}

function fmtCost(n) {
  if (n === null || n === undefined) return '—'
  return '₹' + Math.round(n).toLocaleString('en-IN')
}

// Format a BoqLine's qty for display. Honors the user's unit preference
// for area/volume; other unit types pass through.
export function fmtLineQty(line, unit) {
  const q = line.qty
  if (line.unit === 'ft²') {
    return unit === 'm' ? `${Math.round(q * 0.0929 * 100) / 100} m²` : `${q} ft²`
  }
  if (line.unit === 'ft³') {
    return unit === 'm' ? `${Math.round(q * 0.0283 * 100) / 100} m³` : `${q} ft³`
  }
  if (line.unit === 'nos') return q.toLocaleString('en-IN')
  return `${q} ${line.unit}`
}

export function SectionHeader({ title }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: '#aaa',
      textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
    }}>
      {title}
    </div>
  )
}

export function SubSectionHeader({ title, suffix }) {
  return (
    <div style={{ fontWeight: 600, color: '#555', fontSize: 12, marginBottom: 4 }}>
      {title}
      {suffix && <span style={{ color: '#aaa', fontWeight: 400, marginLeft: 6 }}>{suffix}</span>}
    </div>
  )
}

function InfoIcon({ id, openId, onInfoClick }) {
  return (
    <button
      data-info-btn=""
      onClick={e => onInfoClick(id, e)}
      title="Show formula"
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 12, color: openId === id ? '#555' : '#bbb',
        padding: '0 1px', lineHeight: 1, flexShrink: 0,
      }}
    >ⓘ</button>
  )
}

// Top-level priced row (used for finishes flooring/plaster/paint).
export function BoqRow({ line, rates, onRateChange, openId, onInfoClick, unit, labelOverride }) {
  const placeholder = line.isPer1000 ? '₹/1000' : `₹/${line.unit}`
  const label       = labelOverride ?? line.label
  const rateVal     = rates[line.rateKey] ?? ''
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COL, gap: GAP,
      marginBottom: 6, alignItems: 'center',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ color: '#555', fontSize: 12 }}>{label}</span>
        {line.formulaId && <InfoIcon id={line.formulaId} openId={openId} onInfoClick={onInfoClick} />}
      </div>
      <span style={{ fontWeight: 600, textAlign: 'right', fontSize: 12 }}>
        {fmtLineQty(line, unit)}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        <input
          type="number" min="0" step="0.01"
          value={rateVal}
          onChange={e => onRateChange(line.rateKey, e.target.value)}
          placeholder={placeholder}
          style={{ ...rateInputStyle, width: 52, fontSize: 11 }}
        />
      </div>
      <span style={{ textAlign: 'right', fontSize: 12, color: line.cost !== null && line.cost !== undefined ? '#333' : '#ccc' }}>
        {fmtCost(line.cost)}
      </span>
    </div>
  )
}

// Indented priced sub-row (used inside grouped sections — masonry, structural,
// shuttering, plaster, etc.).
export function BoqSubRow({ line, rates, onRateChange, openId, onInfoClick, unit, labelOverride }) {
  const placeholder = line.isPer1000 ? '₹/1000' : `₹/${line.unit}`
  const label       = labelOverride ?? line.label
  const rateVal     = rates[line.rateKey] ?? ''
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COL, gap: GAP,
      marginBottom: 4, paddingLeft: 10, alignItems: 'center',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ color: '#888', fontSize: 11 }}>{label}</span>
        {line.formulaId && <InfoIcon id={line.formulaId} openId={openId} onInfoClick={onInfoClick} />}
      </div>
      <span style={{ fontWeight: 500, textAlign: 'right', fontSize: 11 }}>
        {fmtLineQty(line, unit)}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        <input
          type="number" min="0" step="0.01"
          value={rateVal}
          onChange={e => onRateChange(line.rateKey, e.target.value)}
          placeholder={placeholder}
          style={rateInputStyle}
        />
      </div>
      <span style={{ textAlign: 'right', fontSize: 11, color: line.cost !== null && line.cost !== undefined ? '#333' : '#ccc' }}>
        {fmtCost(line.cost)}
      </span>
    </div>
  )
}

// Static totals/info row (no rate input). Used for things like "Total steel"
// at the bottom of grouped sections.
export function BoqTotalRow({ label, value }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: COL, gap: GAP,
      marginBottom: 4, paddingLeft: 10, alignItems: 'center',
    }}>
      <span style={{ color: '#888', fontSize: 11, fontWeight: 600 }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'right', fontSize: 11 }}>{value}</span>
      <span /><span />
    </div>
  )
}
