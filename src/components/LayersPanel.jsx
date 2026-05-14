import { useState } from 'react'
import { useStore } from '../store'
import { DEFAULT_LAYER_VISIBILITY } from '../constants/layers'

const LAYER_LABELS = {
  walls:      'Walls',
  columns:    'Columns',
  beams:      'Beams',
  stamps:     'Stamps',
  roomFills:  'Room fills',
  roomLabels: 'Room labels',
  nodes:      'Nodes',
}

export default function LayersPanel() {
  const [expanded, setExpanded] = useState(false)
  const layerVisibility   = useStore(s => s.layerVisibility)
  const setLayerVisibility = useStore(s => s.setLayerVisibility)

  const allOn = Object.values(layerVisibility).every(Boolean)

  return (
    <div style={{
      position: 'fixed', bottom: 56, left: 16, zIndex: 50,
      background: '#fff', borderRadius: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      border: '1px solid #e0e0e0', userSelect: 'none', minWidth: 160,
    }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 10px', background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 11, fontWeight: 600, color: '#555',
        }}
      >
        <span>Layers</span>
        <span style={{ fontSize: 9, color: '#aaa' }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div style={{ padding: '4px 10px 8px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 12px', marginBottom: 6 }}>
            {Object.entries(DEFAULT_LAYER_VISIBILITY).map(([key]) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11, color: '#444' }}>
                <input
                  type="checkbox"
                  checked={layerVisibility[key] ?? true}
                  onChange={e => setLayerVisibility({ [key]: e.target.checked })}
                  style={{ cursor: 'pointer', accentColor: '#3498db' }}
                />
                {LAYER_LABELS[key]}
              </label>
            ))}
          </div>
          <button
            onClick={() => setLayerVisibility(Object.fromEntries(Object.keys(DEFAULT_LAYER_VISIBILITY).map(k => [k, !allOn])))}
            style={{
              fontSize: 10, color: '#888', background: 'none', border: '1px solid #ddd',
              borderRadius: 3, padding: '2px 6px', cursor: 'pointer', width: '100%',
            }}
          >
            {allOn ? 'Hide all' : 'Show all'}
          </button>
        </div>
      )}
    </div>
  )
}
