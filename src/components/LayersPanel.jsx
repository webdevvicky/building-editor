import { useState } from 'react'
import { useStore } from '../store'
import { DEFAULT_LAYER_VISIBILITY } from '../constants/layers'
import { Panel } from './ui/Panel.jsx'
import { Button } from './ui/Button.jsx'

const LAYER_LABELS = {
  walls:      'Walls',
  columns:    'Columns',
  beams:      'Beams',
  stamps:     'Stamps',
  roomFills:  'Room fills',
  roomLabels: 'Room labels',
  nodes:      'Nodes',

  // Plumbing
  plumbingFixtures:        'Fixtures',
  plumbingSupplyRoutes:    'Cold supply',
  plumbingDrainageRoutes:  'Drainage',
  plumbingHotWaterRoutes:  'Hot supply',
  risers:                  'Risers',

  // Electrical
  electricalPoints:        'Points',
  electricalWiringRoutes:  'Wiring',
  electricalSubmainRoutes: 'Submains',

  // HVAC
  hvacUnits:               'Units',
  hvacRefrigerantRoutes:   'Refrigerant',
  hvacCondensateRoutes:    'Condensate',

  // Fire
  fireDevices:             'Devices',
  fireDetectionRoutes:     'Detection',
  fireSprinklerRoutes:     'Sprinkler',
}

const LAYER_GROUPS = [
  {
    title: 'Structural',
    keys: ['walls', 'columns', 'beams', 'stamps', 'roomFills', 'roomLabels', 'nodes'],
  },
  {
    title: 'Plumbing',
    keys: [
      'plumbingFixtures',
      'plumbingSupplyRoutes',
      'plumbingDrainageRoutes',
      'plumbingHotWaterRoutes',
      'risers',
    ],
  },
  {
    title: 'Electrical',
    keys: [
      'electricalPoints',
      'electricalWiringRoutes',
      'electricalSubmainRoutes',
    ],
  },
  {
    title: 'HVAC',
    keys: [
      'hvacUnits',
      'hvacRefrigerantRoutes',
      'hvacCondensateRoutes',
    ],
  },
  {
    title: 'Fire',
    keys: [
      'fireDevices',
      'fireDetectionRoutes',
      'fireSprinklerRoutes',
    ],
  },
]

export default function LayersPanel() {
  const [expanded, setExpanded] = useState(false)
  const layerVisibility   = useStore(s => s.layerVisibility)
  const setLayerVisibility = useStore(s => s.setLayerVisibility)

  const allOn = Object.values(layerVisibility).every(Boolean)

  const toggleHeader = (
    <button
      onClick={() => setExpanded(v => !v)}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--space-2) var(--space-3)',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: 'var(--text-xs)',
        fontWeight: 'var(--weight-semibold)',
        color: 'var(--color-text-secondary)',
      }}
    >
      <span>Layers</span>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
        {expanded ? '▲' : '▼'}
      </span>
    </button>
  )

  return (
    <Panel
      width={200}
      position={{ bottom: 56, left: 16 }}
      zIndex={'var(--z-overlay)'}
    >
      {toggleHeader}

      {expanded && (
        <div style={{ padding: '0 var(--space-3) var(--space-2)' }}>
          {LAYER_GROUPS.map(group => (
            <div key={group.title} style={{ marginBottom: 'var(--space-2)' }}>
              <div style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                fontWeight: 'var(--weight-semibold)',
                marginBottom: 'var(--space-1)',
              }}>
                {group.title}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 'var(--space-1) var(--space-3)',
              }}>
                {group.keys.map(key => (
                  <label
                    key={key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-1)',
                      cursor: 'pointer',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={layerVisibility[key] ?? true}
                      onChange={e => setLayerVisibility({ [key]: e.target.checked })}
                      style={{ cursor: 'pointer', accentColor: 'var(--color-primary)' }}
                    />
                    {LAYER_LABELS[key] ?? key}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setLayerVisibility(
                Object.fromEntries(
                  Object.keys(DEFAULT_LAYER_VISIBILITY).map(k => [k, !allOn])
                )
              )
            }
          >
            {allOn ? 'Hide all' : 'Show all'}
          </Button>
        </div>
      )}
    </Panel>
  )
}
