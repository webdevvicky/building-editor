import { useState, useEffect } from 'react'
import { useStore } from '../store'

const PRESETS = {
  door:   { width: 3, height: 7 },
  window: { width: 4, height: 4 },
}

// 4 door orientations: [hinge side, swing direction]
// 0: hinge at start, opens left   1: hinge at start, opens right
// 2: hinge at end,   opens left   3: hinge at end,   opens right
const ORIENT_LABELS = ['↖', '↙', '↗', '↘']
const ORIENT_TIPS   = [
  'Hinge at start, opens left',
  'Hinge at start, opens right',
  'Hinge at end, opens left',
  'Hinge at end, opens right',
]

export default function OpeningPanel() {
  const selectedWallId    = useStore(s => s.selectedWallId)
  const walls             = useStore(s => s.walls)
  const getWallLength     = useStore(s => s.getWallLength)
  const addOpening        = useStore(s => s.addOpening)
  const removeOpening     = useStore(s => s.removeOpening)
  const setOpeningOrient  = useStore(s => s.setOpeningOrient)
  const deleteWall        = useStore(s => s.deleteWall)
  const setWallHeight     = useStore(s => s.setWallHeight)
  const setWallThickness  = useStore(s => s.setWallThickness)
  const setWallIsPlot     = useStore(s => s.setWallIsPlot)
  const setWallIsVirtual  = useStore(s => s.setWallIsVirtual)
  const setDraftOpening   = useStore(s => s.setDraftOpening)

  const [type,   setType]   = useState('door')
  const [width,  setWidth]  = useState(3)
  const [height, setHeight] = useState(7)
  const [offset, setOffset] = useState(0)
  const [orient, setOrient] = useState(0)

  // Push current form state to store so Canvas can show a live preview
  useEffect(() => {
    if (!selectedWallId) return
    setDraftOpening({ type, width: Number(width), height: Number(height), offset: Number(offset), orient })
  }, [type, width, height, offset, orient, selectedWallId])

  // Clear preview when panel unmounts
  useEffect(() => () => setDraftOpening(null), [])

  if (!selectedWallId) return null
  const wall = walls[selectedWallId]
  if (!wall) return null

  const wallHeight = wall.height ?? 10
  const wallLen    = getWallLength(selectedWallId)
  const openings   = wall.openings || []

  const w = Number(width)
  const h = Number(height)
  const o = Number(offset)

  const errHeight  = h > wallHeight ? `Opening height (${h} ft) exceeds wall height (${wallHeight} ft)` : null
  const errFit     = (o + w) > wallLen ? `Doesn't fit — ${o} + ${w} = ${o + w} ft, wall is ${wallLen} ft` : null
  const errOverlap = openings.some(ex => !(o + w <= ex.offset || o >= ex.offset + ex.width))
    ? 'Overlaps an existing opening' : null
  const errNeg     = o < 0 ? 'Offset cannot be negative' : null
  const error      = errNeg || errFit || errHeight || errOverlap

  function selectType(t) {
    setType(t)
    setWidth(PRESETS[t].width)
    setHeight(PRESETS[t].height)
  }

  function setOffsetQuick(pos) {
    if (pos === 'start')  setOffset(0)
    if (pos === 'center') setOffset(Math.max(0, Math.round((wallLen - w) / 2 * 10) / 10))
    if (pos === 'end')    setOffset(Math.max(0, Math.round((wallLen - w) * 10) / 10))
  }

  function handleAdd() {
    if (error) return
    addOpening(selectedWallId, { offset: o, width: w, height: h, type, orient: type === 'door' ? orient : 0 })
  }

  const btnBase = { padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12, border: '1px solid #ccc' }
  const qBtn    = { padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11, border: '1px solid #ccc', background: '#f5f5f5', color: '#555' }

  return (
    <div style={{
      position: 'absolute', top: 56, right: 16,
      background: '#fff', border: '1px solid #ccc', borderRadius: 8,
      padding: '12px 14px', zIndex: 10, minWidth: 220, fontSize: 13,
      maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontWeight: 700, color: '#333' }}>Wall Properties</span>
        <button onClick={() => deleteWall(selectedWallId)}
          style={{ background: '#fff0f0', border: '1px solid #e74c3c', borderRadius: 4,
            color: '#e74c3c', cursor: 'pointer', fontSize: 11, padding: '3px 8px', fontWeight: 600 }}>
          Delete wall
        </button>
      </div>

      {/* Wall height */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <label style={{ color: '#555', flex: 1 }}>Height</label>
        <input type="number" value={wallHeight} min={1}
          onChange={e => setWallHeight(selectedWallId, e.target.value)}
          onKeyDown={e => e.stopPropagation()}
          style={{ width: 52, padding: '3px 6px', border: '1px solid #ccc', borderRadius: 4 }}
        />
        <span style={{ color: '#999', fontSize: 11 }}>ft</span>
      </div>

      {/* Wall thickness */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <label style={{ color: '#555', flex: 1 }}>Thickness</label>
        <input type="number" value={wall.thickness ?? 0.5} min={0.1} step={0.1}
          onChange={e => setWallThickness(selectedWallId, e.target.value)}
          onKeyDown={e => e.stopPropagation()}
          style={{ width: 52, padding: '3px 6px', border: '1px solid #ccc', borderRadius: 4 }}
        />
        <span style={{ color: '#999', fontSize: 11 }}>ft</span>
      </div>
      <div style={{ color: '#999', fontSize: 11, marginBottom: 12 }}>Length: {wallLen} ft</div>

      {/* Plot boundary toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <input type="checkbox" id="isPlot" checked={wall.isPlot ?? false}
          onChange={e => setWallIsPlot(selectedWallId, e.target.checked)} style={{ cursor: 'pointer' }}
        />
        <label htmlFor="isPlot" style={{ color: wall.isPlot ? '#a0522d' : '#555', fontWeight: wall.isPlot ? 700 : 400, cursor: 'pointer' }}>
          Plot boundary wall
        </label>
      </div>

      {/* Virtual wall toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <input type="checkbox" id="isVirtual" checked={wall.isVirtual ?? false}
          onChange={e => setWallIsVirtual(selectedWallId, e.target.checked)} style={{ cursor: 'pointer' }}
        />
        <label htmlFor="isVirtual" style={{ color: wall.isVirtual ? '#888' : '#555', fontWeight: wall.isVirtual ? 700 : 400, cursor: 'pointer' }}>
          Virtual wall (open plan)
        </label>
      </div>

      <div style={{ borderTop: '1px solid #eee', margin: '8px 0' }} />
      <div style={{ fontWeight: 600, marginBottom: 8, color: '#555', fontSize: 12 }}>Add Opening</div>

      {/* Type toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <button onClick={() => selectType('door')}
          style={{ ...btnBase, background: type === 'door' ? '#333' : '#fff', color: type === 'door' ? '#fff' : '#333' }}>
          Door
        </button>
        <button onClick={() => selectType('window')}
          style={{ ...btnBase, background: type === 'window' ? '#333' : '#fff', color: type === 'window' ? '#fff' : '#333' }}>
          Window
        </button>
      </div>

      {/* W × H */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
        <label style={{ color: '#555' }}>W</label>
        <input type="number" value={width} min={1}
          onChange={e => setWidth(e.target.value)}
          onKeyDown={e => e.stopPropagation()}
          style={{ width: 44, padding: '3px 6px', border: '1px solid #ccc', borderRadius: 4 }}
        />
        <label style={{ color: '#555' }}>H</label>
        <input type="number" value={height} min={1}
          onChange={e => setHeight(e.target.value)}
          onKeyDown={e => e.stopPropagation()}
          style={{ width: 44, padding: '3px 6px', border: `1px solid ${errHeight ? '#e74c3c' : '#ccc'}`, borderRadius: 4 }}
        />
      </div>

      {/* Door swing selector */}
      {type === 'door' && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ color: '#555', fontSize: 11, marginBottom: 4 }}>Swing direction</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {ORIENT_LABELS.map((lbl, i) => (
              <button key={i} onClick={() => setOrient(i)} title={ORIENT_TIPS[i]}
                style={{ ...qBtn, width: 32, textAlign: 'center',
                  background: orient === i ? '#333' : '#f5f5f5',
                  color: orient === i ? '#fff' : '#555',
                  fontSize: 14, padding: '3px 0' }}>
                {lbl}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Offset */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
          <label style={{ color: '#555' }}>Starts at</label>
          <input type="number" value={offset} min={0} step={0.5}
            onChange={e => setOffset(e.target.value)}
            onKeyDown={e => e.stopPropagation()}
            style={{ width: 52, padding: '3px 6px', border: `1px solid ${(errFit || errNeg) ? '#e74c3c' : '#ccc'}`, borderRadius: 4 }}
          />
          <span style={{ color: '#999', fontSize: 11 }}>ft from start</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => setOffsetQuick('start')}  style={qBtn}>Start</button>
          <button onClick={() => setOffsetQuick('center')} style={qBtn}>Center</button>
          <button onClick={() => setOffsetQuick('end')}    style={qBtn}>End</button>
        </div>
      </div>

      {error && <div style={{ color: '#e74c3c', fontSize: 11, margin: '6px 0' }}>{error}</div>}

      <button onClick={handleAdd} disabled={!!error}
        style={{ width: '100%', marginTop: 8, padding: '6px', borderRadius: 4, border: 'none',
          background: error ? '#ccc' : '#333', color: '#fff',
          cursor: error ? 'not-allowed' : 'pointer', fontSize: 12 }}>
        + Add {type}
      </button>

      {/* Opening list */}
      <div style={{ borderTop: '1px solid #eee', marginTop: 10 }}>
        {openings.length === 0 && (
          <div style={{ color: '#aaa', fontSize: 12, paddingTop: 8 }}>No openings</div>
        )}
        {openings.map(op => (
          <div key={op.id} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '5px 0', borderBottom: '1px solid #f0f0f0',
          }}>
            <div>
              <span style={{ color: '#555', fontSize: 12 }}>
                {op.type === 'window' ? '▭ Window' : '▮ Door'}{' '}
                {op.width}×{op.height} ft @ {op.offset} ft
              </span>
              {/* Flip swing button for existing doors */}
              {op.type === 'door' && (
                <button onClick={() => setOpeningOrient(selectedWallId, op.id, ((op.orient ?? 0) + 1) % 4)}
                  title={`Swing: ${ORIENT_TIPS[(op.orient ?? 0)]}\nClick to flip`}
                  style={{ marginLeft: 6, fontSize: 12, background: '#f5f5f5', border: '1px solid #ddd',
                    borderRadius: 3, cursor: 'pointer', padding: '1px 5px', color: '#555' }}>
                  {ORIENT_LABELS[op.orient ?? 0]}
                </button>
              )}
            </div>
            <button onClick={() => removeOpening(selectedWallId, op.id)}
              style={{ background: 'none', border: 'none', color: '#e74c3c', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
