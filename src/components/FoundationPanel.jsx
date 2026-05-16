// Phase 1.8 — Foundation editor modal panel.
//
// Visibility: shown when activeTool === 'foundations' (closes cleanly when tool changes).
// Authority: foundation.columnIds[] / wallIds[] are the single source of truth.
// Goes through selectors getFoundationForColumn / getFoundationForWall / getColumnsByFoundation
// from the store — never traverses foundations inline.

import { useStore } from '../store'

const FOUNDATION_TYPES = ['ISOLATED', 'COMBINED', 'RAFT', 'STRIP', 'PILE']

const TYPE_COLORS = {
  ISOLATED: { background: '#e8f5e9', color: '#2e7d32' },
  COMBINED: { background: '#e3f2fd', color: '#1565c0' },
  RAFT:     { background: '#fff3e0', color: '#e65100' },
  STRIP:    { background: '#f3e5f5', color: '#6a1b9a' },
  PILE:     { background: '#fce4ec', color: '#ad1457' },
}

const overlay = {
  position: 'fixed', top: '50%', left: '50%',
  transform: 'translate(-50%, -50%)', zIndex: 100,
  width: 480, maxHeight: '80vh', overflowY: 'auto',
  background: '#fff', borderRadius: 8,
  padding: 20, boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
  fontSize: 13,
}

const headerRow = {
  display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', marginBottom: 16,
}

const closeBtn = {
  background: 'none', border: 'none', fontSize: 18,
  cursor: 'pointer', color: '#555', lineHeight: 1, padding: '0 4px',
}

const sectionHead = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
  color: '#aaa', letterSpacing: 0.5, marginBottom: 6, marginTop: 16,
}

const fieldRow = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }
const lbl      = { color: '#666', minWidth: 160, fontSize: 12 }
const numInput = { width: 80, fontSize: 13 }

const divider  = { borderTop: '1px solid #f0f0f0', margin: '6px 0' }

const card = {
  border: '1px solid #e0e0e0', borderRadius: 6,
  padding: '10px 12px', marginBottom: 10, cursor: 'pointer',
}
const cardSelected = {
  ...card,
  borderColor: '#3498db',
  background: '#f5fafd',
  boxShadow: '0 0 0 2px rgba(52,152,219,0.15)',
}

const chip = {
  display: 'inline-flex', alignItems: 'center',
  padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
  marginRight: 6,
}

const delBtn = {
  background: '#fff0f0', border: '1px solid #e74c3c',
  borderRadius: 4, color: '#e74c3c', cursor: 'pointer',
  fontSize: 11, padding: '2px 7px',
}

const addBtn = {
  padding: '6px 14px', fontSize: 12,
  background: '#f5f5f5', border: '1px solid #ccc',
  borderRadius: 4, cursor: 'pointer',
}

const addBtnPrimary = {
  ...addBtn,
  background: '#f0f7ff', borderColor: '#3498db', color: '#2471a3',
}

const selectStyle = {
  fontSize: 13, padding: '3px 6px',
  border: '1px solid #ccc', borderRadius: 4, background: '#fff',
}

const attachListStyle = {
  border: '1px solid #eee', borderRadius: 4,
  maxHeight: 140, overflowY: 'auto', padding: 4,
}

function NumField({ label, value, onChange, min = 0, step = 0.5 }) {
  return (
    <div style={fieldRow}>
      <span style={lbl}>{label}</span>
      <input
        type="number" min={min} step={step}
        style={numInput} value={value ?? 0}
        onKeyDown={e => e.stopPropagation()}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
      />
    </div>
  )
}

function geometrySummary(f) {
  const g = f.geometry || {}
  switch (f.type) {
    case 'ISOLATED':
    case 'COMBINED':
      return `${g.lengthFt ?? 0}×${g.widthFt ?? 0}×${g.depthFt ?? 0} ft`
    case 'RAFT':
      return `${g.areaFt2 ?? 0} ft² × ${g.depthFt ?? 0} ft`
    case 'STRIP':
      return `W ${g.widthFt ?? 0} × D ${g.depthFt ?? 0} ft`
    case 'PILE': {
      const n = g.pilesCount ?? 0
      const dia = g.pileDiamIn ?? 0
      const len = g.pileLengthFt ?? 0
      return `${n}× Ø${dia}″ / ${len} ft + cap ${g.capLengthFt ?? 0}×${g.capWidthFt ?? 0}`
    }
    default:
      return '—'
  }
}

export default function FoundationPanel() {
  const activeTool             = useStore(s => s.activeTool)
  const foundations            = useStore(s => s.foundations)
  const selectedFoundationId   = useStore(s => s.selectedFoundationId)
  const columns                = useStore(s => s.columns)
  const walls                  = useStore(s => s.walls)
  const projectSettings        = useStore(s => s.projectSettings)
  const getTotalFloorArea      = useStore(s => s.getTotalFloorArea)
  const getWallLength          = useStore(s => s.getWallLength)

  const addFoundation              = useStore(s => s.addFoundation)
  const updateFoundation           = useStore(s => s.updateFoundation)
  const deleteFoundation           = useStore(s => s.deleteFoundation)
  const attachColumnToFoundation   = useStore(s => s.attachColumnToFoundation)
  const detachColumnFromFoundation = useStore(s => s.detachColumnFromFoundation)
  const attachWallToFoundation     = useStore(s => s.attachWallToFoundation)
  const detachWallFromFoundation   = useStore(s => s.detachWallFromFoundation)
  const selectFoundation           = useStore(s => s.selectFoundation)
  const setTool                    = useStore(s => s.setTool)

  if (activeTool !== 'foundations') return null

  const fdnList    = Object.values(foundations)
  const selected   = selectedFoundationId ? foundations[selectedFoundationId] : null
  const columnTypes = projectSettings?.columnTypes ?? []

  const columnTypeLabel = (ctId) =>
    columnTypes.find(t => t.id === ctId)?.label ?? ctId

  // Patches geometry while preserving existing keys (per task brief).
  const patchGeometry = (id, partial) => {
    const current = foundations[id]?.geometry || {}
    updateFoundation(id, { geometry: { ...current, ...partial } })
  }

  function renderEditor(f) {
    const g = f.geometry || {}
    return (
      <div>
        <div style={fieldRow}>
          <span style={lbl}>Label</span>
          <input
            type="text" style={{ flex: 1, fontSize: 13, padding: '3px 6px', border: '1px solid #ccc', borderRadius: 4 }}
            value={f.label ?? ''}
            placeholder={`${f.type} foundation`}
            onKeyDown={e => e.stopPropagation()}
            onChange={e => updateFoundation(f.id, { label: e.target.value || null })}
          />
        </div>
        <div style={fieldRow}>
          <span style={lbl}>Concrete grade</span>
          <select
            style={selectStyle}
            value={f.grade ?? 'M20'}
            onKeyDown={e => e.stopPropagation()}
            onChange={e => updateFoundation(f.id, { grade: e.target.value })}
          >
            {['M15', 'M20', 'M25', 'M30'].map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>

        <div style={divider} />
        <div style={sectionHead}>Geometry</div>

        {(f.type === 'ISOLATED' || f.type === 'COMBINED') && (
          <>
            <NumField label="Length (ft)" step={0.5} value={g.lengthFt}
              onChange={v => patchGeometry(f.id, { lengthFt: v })} />
            <NumField label="Width (ft)" step={0.5} value={g.widthFt}
              onChange={v => patchGeometry(f.id, { widthFt: v })} />
            <NumField label="Depth (ft)" step={0.25} value={g.depthFt}
              onChange={v => patchGeometry(f.id, { depthFt: v })} />
            <NumField label="PCC depth (ft)" step={0.25} value={f.pccDepthFt}
              onChange={v => updateFoundation(f.id, { pccDepthFt: v })} />
            <NumField label="Plum concrete depth (ft)" step={0.25} value={f.plumDepthFt}
              onChange={v => updateFoundation(f.id, { plumDepthFt: v })} />
          </>
        )}

        {f.type === 'RAFT' && (
          <>
            <NumField label="Area (ft²)" step={1} value={g.areaFt2}
              onChange={v => patchGeometry(f.id, { areaFt2: v })} />
            <div style={{ ...fieldRow, marginTop: -4, marginBottom: 10 }}>
              <span style={lbl}></span>
              <button style={addBtn} onClick={() => patchGeometry(f.id, { areaFt2: Math.round((getTotalFloorArea() || 0) * 100) / 100 })}>
                Use building footprint
              </button>
            </div>
            <NumField label="Depth (ft)" step={0.25} value={g.depthFt}
              onChange={v => patchGeometry(f.id, { depthFt: v })} />
            <NumField label="PCC depth (ft)" step={0.25} value={f.pccDepthFt}
              onChange={v => updateFoundation(f.id, { pccDepthFt: v })} />
          </>
        )}

        {f.type === 'STRIP' && (
          <>
            <NumField label="Width (ft)" step={0.25} value={g.widthFt}
              onChange={v => patchGeometry(f.id, { widthFt: v })} />
            <NumField label="Depth (ft)" step={0.25} value={g.depthFt}
              onChange={v => patchGeometry(f.id, { depthFt: v })} />
            <NumField label="PCC depth (ft)" step={0.25} value={f.pccDepthFt}
              onChange={v => updateFoundation(f.id, { pccDepthFt: v })} />
          </>
        )}

        {f.type === 'PILE' && (
          <>
            <NumField label="Pile diameter (in)" step={1} value={g.pileDiamIn}
              onChange={v => patchGeometry(f.id, { pileDiamIn: v })} />
            <NumField label="Pile length (ft)" step={1} value={g.pileLengthFt}
              onChange={v => patchGeometry(f.id, { pileLengthFt: v })} />
            <NumField label="Piles count" step={1} value={g.pilesCount}
              onChange={v => patchGeometry(f.id, { pilesCount: v })} />
            <NumField label="Cap length (ft)" step={0.5} value={g.capLengthFt}
              onChange={v => patchGeometry(f.id, { capLengthFt: v })} />
            <NumField label="Cap width (ft)" step={0.5} value={g.capWidthFt}
              onChange={v => patchGeometry(f.id, { capWidthFt: v })} />
            <NumField label="Cap depth (ft)" step={0.25} value={g.capDepthFt}
              onChange={v => patchGeometry(f.id, { capDepthFt: v })} />
            <NumField label="PCC depth (ft)" step={0.25} value={f.pccDepthFt}
              onChange={v => updateFoundation(f.id, { pccDepthFt: v })} />
          </>
        )}

        {/* Column attach list — COMBINED + PILE + ISOLATED can host columns */}
        {(f.type === 'COMBINED' || f.type === 'PILE' || f.type === 'ISOLATED') && (
          <>
            <div style={divider} />
            <div style={sectionHead}>Attached columns ({(f.columnIds || []).length})</div>
            <div style={attachListStyle}>
              {Object.values(columns).length === 0 && (
                <div style={{ fontSize: 12, color: '#999', padding: 4 }}>No columns placed yet.</div>
              )}
              {Object.values(columns).map(col => {
                const attached = (f.columnIds || []).includes(col.id)
                const otherFdn = fdnList.find(of => of.id !== f.id && (of.columnIds || []).includes(col.id))
                return (
                  <label key={col.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', fontSize: 12, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={attached}
                      onKeyDown={e => e.stopPropagation()}
                      onChange={e => {
                        if (e.target.checked) attachColumnToFoundation(col.id, f.id)
                        else detachColumnFromFoundation(col.id)
                      }}
                    />
                    <span style={{ flex: 1 }}>
                      {columnTypeLabel(col.columnTypeId)} @ ({Math.round(col.x / 12)}, {Math.round(col.y / 12)})
                    </span>
                    {otherFdn && !attached && (
                      <span style={{ fontSize: 10, color: '#c0392b' }}>on {otherFdn.label ?? otherFdn.type}</span>
                    )}
                  </label>
                )
              })}
            </div>
          </>
        )}

        {/* Wall attach list — STRIP only */}
        {f.type === 'STRIP' && (
          <>
            <div style={divider} />
            <div style={sectionHead}>Attached walls ({(f.wallIds || []).length})</div>
            <div style={attachListStyle}>
              {Object.values(walls).length === 0 && (
                <div style={{ fontSize: 12, color: '#999', padding: 4 }}>No walls drawn yet.</div>
              )}
              {Object.values(walls).map(w => {
                const attached = (f.wallIds || []).includes(w.id)
                const otherFdn = fdnList.find(of => of.id !== f.id && (of.wallIds || []).includes(w.id))
                const lenFt = getWallLength(w.id) || 0
                return (
                  <label key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', fontSize: 12, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={attached}
                      onKeyDown={e => e.stopPropagation()}
                      onChange={e => {
                        if (e.target.checked) attachWallToFoundation(w.id, f.id)
                        else detachWallFromFoundation(w.id)
                      }}
                    />
                    <span style={{ flex: 1 }}>
                      Wall {w.id.slice(0, 6)} — {Math.round(lenFt * 100) / 100} ft
                    </span>
                    {otherFdn && !attached && (
                      <span style={{ fontSize: 10, color: '#c0392b' }}>on {otherFdn.label ?? otherFdn.type}</span>
                    )}
                  </label>
                )
              })}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div style={overlay}>
      <div style={headerRow}>
        <strong style={{ fontSize: 15 }}>Foundations</strong>
        <button style={closeBtn} onClick={() => setTool('select')}>×</button>
      </div>

      <div style={sectionHead}>Defined foundations ({fdnList.length})</div>

      {fdnList.length === 0 && (
        <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
          No foundations yet. Add one below to start grouping columns/walls.
        </div>
      )}

      {fdnList.map(f => {
        const isSel = f.id === selectedFoundationId
        const badge = TYPE_COLORS[f.type] ?? TYPE_COLORS.ISOLATED
        return (
          <div
            key={f.id}
            style={isSel ? cardSelected : card}
            onClick={() => selectFoundation(f.id)}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ ...chip, ...badge }}>{f.type}</span>
              <strong style={{ flex: 1, fontSize: 13 }}>{f.label ?? `${f.type} foundation`}</strong>
              <button
                style={delBtn}
                onClick={e => { e.stopPropagation(); deleteFoundation(f.id) }}
              >Delete</button>
            </div>
            <div style={{ fontSize: 11, color: '#666' }}>
              {geometrySummary(f)}
              <span style={{ color: '#aaa' }}> · </span>
              {(f.columnIds || []).length} col{(f.columnIds || []).length === 1 ? '' : 's'}
              <span style={{ color: '#aaa' }}> · </span>
              {(f.wallIds || []).length} wall{(f.wallIds || []).length === 1 ? '' : 's'}
            </div>
          </div>
        )
      })}

      {selected && (
        <>
          <div style={divider} />
          <div style={sectionHead}>Editing {selected.label ?? selected.type}</div>
          {renderEditor(selected)}
        </>
      )}

      <div style={divider} />
      <div style={sectionHead}>Add foundation</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select
          id="fdn-new-type"
          style={selectStyle}
          defaultValue="ISOLATED"
          onKeyDown={e => e.stopPropagation()}
        >
          {FOUNDATION_TYPES.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <button
          style={addBtnPrimary}
          onClick={() => {
            const sel = document.getElementById('fdn-new-type')
            const type = sel?.value || 'ISOLATED'
            const id = addFoundation(type, {})
            selectFoundation(id)
          }}
        >+ Add foundation</button>
      </div>
    </div>
  )
}
