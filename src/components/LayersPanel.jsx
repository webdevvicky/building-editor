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
  slabs:      'Slabs',
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

  // ELV
  elvDevices:              'Devices',
  elvCctvRoutes:           'CCTV',
  elvDataRoutes:           'Data',

  // Diagnostics
  clashes:                 'Clashes',
}

const LAYER_GROUPS = [
  {
    title: 'Structural',
    keys: ['walls', 'columns', 'beams', 'stamps', 'slabs', 'roomFills', 'roomLabels', 'nodes'],
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
  {
    title: 'ELV',
    keys: [
      'elvDevices',
      'elvCctvRoutes',
      'elvDataRoutes',
    ],
  },
  {
    title: 'Diagnostics',
    keys: [
      'clashes',
    ],
  },
]

export default function LayersPanel() {
  const [expanded, setExpanded] = useState(false)
  const layerVisibility    = useStore(s => s.layerVisibility)
  const setLayerVisibility = useStore(s => s.setLayerVisibility)
  // Per-floor underlay (Fix 3): controls show the CURRENT floor's underlay
  // only. ADD 9 still applies — group hidden when the active floor has no
  // underlay. Setters target the current floor via the floorId parameter.
  const currentFloorId     = useStore(s => s.currentFloorId)
  const underlay           = useStore(s => {
    const fid = s.currentFloorId
    return s.projectSettings?.floors?.find(f => f.id === fid)?.underlay ?? null
  })
  const setUnderlayOpacity = useStore(s => s.setUnderlayOpacity)
  const setUnderlayVisible = useStore(s => s.setUnderlayVisible)

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
          {/* Underlay group — hidden when current floor has no underlay
              (ADD 9). Controls target the current floor only (Fix 3). */}
          {underlay && (
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <div style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                fontWeight: 'var(--weight-semibold)',
                marginBottom: 'var(--space-1)',
              }}>
                Underlay (this floor)
              </div>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                cursor: 'pointer', fontSize: 'var(--text-xs)',
                color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)',
              }}>
                <input
                  type="checkbox"
                  checked={underlay.visible !== false}
                  onChange={e => setUnderlayVisible(e.target.checked, currentFloorId)}
                />
                <span>Show floor plan</span>
              </label>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)',
              }}>
                <span>Opacity</span>
                <input
                  type="range"
                  min={0.05} max={1} step={0.05}
                  value={underlay.opacity ?? 0.35}
                  onChange={e => setUnderlayOpacity(parseFloat(e.target.value), currentFloorId)}
                  style={{ flex: 1 }}
                />
                <span style={{ width: 28, textAlign: 'right' }}>
                  {Math.round((underlay.opacity ?? 0.35) * 100)}%
                </span>
              </div>
            </div>
          )}

          {LAYER_GROUPS.map(group => {
            // Per-discipline master toggle (Arch 8 Phase 1).
            // Tri-state: all-on / partial / all-off. Click flips entire group
            // to the opposite of its current dominant state.
            const groupStates = group.keys.map(k => layerVisibility[k] ?? true)
            const allOnGroup  = groupStates.every(Boolean)
            const allOffGroup = groupStates.every(v => !v)
            const partial     = !allOnGroup && !allOffGroup
            const indicator   = allOnGroup ? '☑' : allOffGroup ? '☐' : '◪'
            const flipGroup = () => {
              const nextValue = !allOnGroup   // if any off → on; if all on → all off
              const patch = {}
              for (const k of group.keys) patch[k] = nextValue
              setLayerVisibility(patch)
            }
            return (
              <div key={group.title} style={{ marginBottom: 'var(--space-2)' }}>
                <button
                  onClick={flipGroup}
                  title={allOnGroup ? `Hide all ${group.title}` : `Show all ${group.title}`}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    fontSize: 'var(--text-xs)',
                    color: partial ? 'var(--color-primary)' : 'var(--color-text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    fontWeight: 'var(--weight-semibold)',
                    marginBottom: 'var(--space-1)',
                  }}
                >
                  <span>{group.title}</span>
                  <span style={{ fontSize: 'var(--text-sm)' }}>{indicator}</span>
                </button>
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
            )
          })}
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
