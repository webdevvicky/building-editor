import { useStore } from '../store'

const panelStyle = {
  position: 'absolute', top: 56, left: 16,
  background: '#fff', border: '1px solid #ccc', borderRadius: 8,
  padding: '12px 14px', zIndex: 10, minWidth: 220, fontSize: 13,
  maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
}

const fieldRow = { marginTop: 8 }
const label = { color: '#888', marginBottom: 2, fontSize: 11 }

const inputStyle = { width: '100%', fontSize: 13, boxSizing: 'border-box' }

function NumField({ fieldLabel, value, fieldKey, min, onUpdate }) {
  return (
    <div style={fieldRow}>
      <div style={label}>{fieldLabel}</div>
      <input
        type="number"
        style={inputStyle}
        value={value}
        min={min}
        onKeyDown={e => e.stopPropagation()}
        onChange={e => onUpdate({ [fieldKey]: parseFloat(e.target.value) })}
      />
    </div>
  )
}

export default function StaircasePanel() {
  const selectedStampId = useStore(s => s.selectedStampId)
  const stamps          = useStore(s => s.stamps)
  const staircases      = useStore(s => s.staircases)
  const updateStaircase = useStore(s => s.updateStaircase)

  if (!selectedStampId) return null
  if (stamps[selectedStampId]?.type !== 'stairs') return null

  const sc = staircases[selectedStampId]

  if (!sc) {
    return (
      <div style={panelStyle}>
        <strong>Staircase Details</strong>
        <div style={{ marginTop: 8, color: '#999' }}>No staircase data</div>
      </div>
    )
  }

  function update(patch) {
    updateStaircase(selectedStampId, patch)
  }

  const totalSteps = sc.flightCount * sc.stepsPerFlight

  return (
    <div style={panelStyle}>
      <strong>Staircase Details</strong>

      <div style={fieldRow}>
        <div style={label}>Type</div>
        <select
          value={sc.type}
          style={{ width: '100%', fontSize: 13 }}
          onKeyDown={e => e.stopPropagation()}
          onChange={e => update({ type: e.target.value })}
        >
          <option value="DOG_LEGGED">Dog-Legged</option>
          <option value="STRAIGHT">Straight</option>
        </select>
      </div>

      <NumField fieldLabel="Flights"          fieldKey="flightCount"     value={sc.flightCount}     min={1}   onUpdate={update} />
      <NumField fieldLabel="Steps / flight"   fieldKey="stepsPerFlight"  value={sc.stepsPerFlight}  min={1}   onUpdate={update} />
      <NumField fieldLabel="Tread (in)"       fieldKey="treadIn"         value={sc.treadIn}         min={1}   onUpdate={update} />
      <NumField fieldLabel="Riser (in)"       fieldKey="riserIn"         value={sc.riserIn}         min={0.5} onUpdate={update} />
      <NumField fieldLabel="Waist slab (in)"  fieldKey="waistSlabIn"     value={sc.waistSlabIn}     min={1}   onUpdate={update} />
      <NumField fieldLabel="Landing width (ft)"  fieldKey="landingFtWidth"  value={sc.landingFtWidth}  min={1}   onUpdate={update} />
      <NumField fieldLabel="Landing length (ft)" fieldKey="landingFtLength" value={sc.landingFtLength} min={1}   onUpdate={update} />
      <NumField fieldLabel="Flight width (ft)"   fieldKey="flightWidthFt"   value={sc.flightWidthFt}   min={1}   onUpdate={update} />

      <div style={{ ...fieldRow, color: '#555' }}>
        <span style={{ color: '#888', fontSize: 11 }}>Total steps: </span>
        {totalSteps}
      </div>
    </div>
  )
}
