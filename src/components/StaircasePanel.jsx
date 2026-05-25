import { useStore } from '../store'
import { Panel } from './ui/Panel'
import { Field } from './ui/Field'
import FeetInchesInput from './ui/FeetInchesInput.jsx'
import { DEFAULT_PRECISION } from '../lib/units.js'

function NumField({ fieldLabel, value, fieldKey, min, onUpdate }) {
  return (
    <Field label={fieldLabel}>
      <input
        type="number"
        value={value}
        min={min}
        onKeyDown={e => e.stopPropagation()}
        onChange={e => onUpdate({ [fieldKey]: parseFloat(e.target.value) })}
      />
    </Field>
  )
}

// Feet-inches input for staircase landing/flight dimensions (decimal-feet storage).
function FtField({ fieldLabel, value, fieldKey, min, onUpdate }) {
  return (
    <Field label={fieldLabel}>
      <FeetInchesInput
        value={value ?? 0}
        onCommit={v => onUpdate({ [fieldKey]: v })}
        min={min}
        precision={DEFAULT_PRECISION.staircase}
      />
    </Field>
  )
}

export default function StaircasePanel() {
  const selectedStampId = useStore(s => s.selectedStampId)
  const stamps          = useStore(s => s.stamps)
  const staircases      = useStore(s => s.staircases)
  const updateStaircase = useStore(s => s.updateStaircase)
  const projectSettings = useStore(s => s.projectSettings)
  const selectStamp     = useStore(s => s.selectStamp)

  if (!selectedStampId) return null
  if (stamps[selectedStampId]?.type !== 'stairs') return null

  const sc = staircases[selectedStampId]

  if (!sc) {
    return (
      <Panel
        title="Staircase Details"
        onClose={() => selectStamp(null)}
        width={260}
        position={{ top: 56, left: 16 }}
      >
        <div style={{ color: 'var(--color-text-muted)' }}>No staircase data</div>
      </Panel>
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
    <Panel
      title="Staircase Details"
      onClose={() => selectStamp(null)}
      width={260}
      position={{ top: 56, left: 16 }}
    >
      <Field label="Type">
        <select
          value={sc.type}
          onKeyDown={e => e.stopPropagation()}
          onChange={e => update({ type: e.target.value })}
        >
          <option value="DOG_LEGGED">Dog-Legged (2 flights + landing)</option>
          <option value="STRAIGHT">Straight</option>
        </select>
      </Field>

      {/* From / To floor pickers — Phase 1.6d schema slot; UI only renders meaningfully when multi-floor. */}
      {isMultiFloor && (
        <>
          <Field label="From floor">
            <select
              value={sc.fromFloorId ?? floors[0]?.id}
              onKeyDown={e => e.stopPropagation()}
              onChange={e => update({ fromFloorId: e.target.value })}
            >
              {floors.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </Field>
          <Field label="To floor">
            <select
              value={sc.toFloorId ?? floors[0]?.id}
              onKeyDown={e => e.stopPropagation()}
              onChange={e => update({ toFloorId: e.target.value })}
            >
              {floors.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </Field>
        </>
      )}

      <NumField fieldLabel="Flights"          fieldKey="flightCount"     value={sc.flightCount}     min={1}   onUpdate={update} />
      <NumField fieldLabel="Steps / flight"   fieldKey="stepsPerFlight"  value={sc.stepsPerFlight}  min={1}   onUpdate={update} />
      <NumField fieldLabel="Tread (in)"       fieldKey="treadIn"         value={sc.treadIn}         min={1}   onUpdate={update} />
      <NumField fieldLabel="Riser (in)"       fieldKey="riserIn"         value={sc.riserIn}         min={0.5} onUpdate={update} />
      <NumField fieldLabel="Waist slab (in)"  fieldKey="waistSlabIn"     value={sc.waistSlabIn}     min={1}   onUpdate={update} />
      <FtField  fieldLabel="Landing width"  fieldKey="landingFtWidth"  value={sc.landingFtWidth}  min={1}   onUpdate={update} />
      <FtField  fieldLabel="Landing length" fieldKey="landingFtLength" value={sc.landingFtLength} min={1}   onUpdate={update} />
      <FtField  fieldLabel="Flight width"   fieldKey="flightWidthFt"   value={sc.flightWidthFt}   min={1}   onUpdate={update} />

      {/* Derived metrics — verifies dog-legged formula at a glance */}
      <div style={{
        marginTop: 'var(--space-2)',
        padding: 'var(--space-2)',
        background: 'var(--color-bg-muted)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--text-xs)',
      }}>
        <div style={{ color: 'var(--color-text-secondary)' }}>Total steps: <strong>{totalSteps}</strong></div>
        <div style={{ color: 'var(--color-text-secondary)' }}>Total rise: <strong>{Math.round(totalRiseFt * 100) / 100} ft</strong></div>
        <div style={{ color: 'var(--color-text-secondary)' }}>Total run: <strong>{Math.round(totalRunFt * 100) / 100} ft</strong></div>
        {sc.type === 'DOG_LEGGED' && (
          <div style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-1)', fontSize: 'var(--text-xs)' }}>
            Dog-legged: 2 flights with mid-landing; volume = waist slab (inclined) + landings.
          </div>
        )}
      </div>
    </Panel>
  )
}
