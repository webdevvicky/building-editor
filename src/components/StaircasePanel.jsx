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
  const projectSettings = useStore(s => s.projectSettings)

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

  const totalSteps   = sc.flightCount * sc.stepsPerFlight
  const totalRiseFt  = (totalSteps * sc.riserIn) / 12
  const totalRunFt   = (totalSteps * sc.treadIn) / 12
  const floors       = projectSettings?.floors ?? []
  const isMultiFloor = floors.length > 1

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
          <option value="DOG_LEGGED">Dog-Legged (2 flights + landing)</option>
          <option value="STRAIGHT">Straight</option>
        </select>
      </div>

      {/* From / To floor pickers — Phase 1.6d schema slot; UI only renders meaningfully when multi-floor. */}
      {isMultiFloor && (
        <>
          <div style={fieldRow}>
            <div style={label}>From floor</div>
            <select
              value={sc.fromFloorId ?? floors[0]?.id}
              style={{ width: '100%', fontSize: 13 }}
              onKeyDown={e => e.stopPropagation()}
              onChange={e => update({ fromFloorId: e.target.value })}
            >
              {floors.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
          <div style={fieldRow}>
            <div style={label}>To floor</div>
            <select
              value={sc.toFloorId ?? floors[0]?.id}
              style={{ width: '100%', fontSize: 13 }}
              onKeyDown={e => e.stopPropagation()}
              onChange={e => update({ toFloorId: e.target.value })}
            >
              {floors.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
        </>
      )}

      <NumField fieldLabel="Flights"          fieldKey="flightCount"     value={sc.flightCount}     min={1}   onUpdate={update} />
      <NumField fieldLabel="Steps / flight"   fieldKey="stepsPerFlight"  value={sc.stepsPerFlight}  min={1}   onUpdate={update} />
      <NumField fieldLabel="Tread (in)"       fieldKey="treadIn"         value={sc.treadIn}         min={1}   onUpdate={update} />
      <NumField fieldLabel="Riser (in)"       fieldKey="riserIn"         value={sc.riserIn}         min={0.5} onUpdate={update} />
      <NumField fieldLabel="Waist slab (in)"  fieldKey="waistSlabIn"     value={sc.waistSlabIn}     min={1}   onUpdate={update} />
      <NumField fieldLabel="Landing width (ft)"  fieldKey="landingFtWidth"  value={sc.landingFtWidth}  min={1}   onUpdate={update} />
      <NumField fieldLabel="Landing length (ft)" fieldKey="landingFtLength" value={sc.landingFtLength} min={1}   onUpdate={update} />
      <NumField fieldLabel="Flight width (ft)"   fieldKey="flightWidthFt"   value={sc.flightWidthFt}   min={1}   onUpdate={update} />

      {/* Derived metrics — verifies dog-legged formula at a glance */}
      <div style={{ ...fieldRow, padding: '8px', background: '#f8f8f8', borderRadius: 4, fontSize: 11 }}>
        <div style={{ color: '#555' }}>Total steps: <strong>{totalSteps}</strong></div>
        <div style={{ color: '#555' }}>Total rise: <strong>{Math.round(totalRiseFt * 100) / 100} ft</strong></div>
        <div style={{ color: '#555' }}>Total run: <strong>{Math.round(totalRunFt * 100) / 100} ft</strong></div>
        {sc.type === 'DOG_LEGGED' && (
          <div style={{ color: '#888', marginTop: 4, fontSize: 10 }}>
            Dog-legged: 2 flights with mid-landing; volume = waist slab (inclined) + landings.
          </div>
        )}
      </div>
    </div>
  )
}
