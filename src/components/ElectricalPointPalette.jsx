// ElectricalPointPalette — Stream 2 floating point-type picker.
//
// Shown only while the Electrical tool is active. Selecting a type sets the store's
// `selectedElectricalPointType`, which the canvas stamps as the canonical `pointType`
// on the next placed point (Canvas.jsx MEP placement).

import { useStore } from '../store'
import {
  POINT_TYPE_GROUPS,
  POINT_TYPE_LABELS,
  DEFAULT_POINT_TYPE,
} from '../mep/catalogs/electricalPointTypes.js'

export default function ElectricalPointPalette() {
  const activeTool = useStore(s => s.activeTool)
  const selected = useStore(s => s.selectedElectricalPointType ?? DEFAULT_POINT_TYPE)
  const setSelected = useStore(s => s.setSelectedElectricalPointType)

  if (activeTool !== 'electrical') return null

  return (
    <div style={{
      position: 'absolute', top: 56, right: 16, zIndex: 20, width: 214,
      background: 'var(--color-surface, #fff)',
      border: '1px solid var(--color-border, #ccc)', borderRadius: 8,
      padding: '8px 10px', boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.15))',
      fontSize: 12, color: 'var(--color-text, #333)',
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Electrical point</div>
      {POINT_TYPE_GROUPS.map(group => (
        <div key={group.label} style={{ marginBottom: 6 }}>
          <div style={{
            fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4,
            color: 'var(--color-text-secondary, #888)', marginBottom: 3,
          }}>
            {group.label}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {group.types.map(t => {
              const isSel = t === selected
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSelected(t)}
                  title={POINT_TYPE_LABELS[t]}
                  style={{
                    cursor: 'pointer', borderRadius: 5, padding: '3px 7px', fontSize: 11,
                    border: '1px solid',
                    borderColor: isSel ? '#2563eb' : 'var(--color-border, #ccc)',
                    background: isSel ? 'rgba(37,99,235,0.12)' : 'transparent',
                    color: isSel ? '#2563eb' : 'inherit',
                    fontWeight: isSel ? 600 : 400,
                  }}
                >
                  {POINT_TYPE_LABELS[t]}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <div style={{ marginTop: 4, fontSize: 10, color: 'var(--color-text-secondary, #888)' }}>
        Click the canvas to place
      </div>
    </div>
  )
}
