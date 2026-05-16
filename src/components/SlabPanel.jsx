import { useStore } from '../store'
import { resolveSlabReinforcementSpec, humanizeAssignmentSource } from '../specs/resolution'

const overlay = {
  position: 'fixed', top: '50%', left: '50%',
  transform: 'translate(-50%, -50%)', zIndex: 100,
  width: 420, background: '#fff', borderRadius: 8,
  padding: 20, boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
  maxHeight: '80vh', overflowY: 'auto', fontSize: 13,
}

const headerRow = {
  display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', marginBottom: 14,
}

const closeBtn = {
  background: 'none', border: 'none', fontSize: 18,
  cursor: 'pointer', color: '#555', lineHeight: 1, padding: '0 4px',
}

const sectionHead = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
  color: '#aaa', letterSpacing: 0.5, marginBottom: 6, marginTop: 14,
}

const slabCard = {
  border: '1px solid #e0e0e0', borderRadius: 6,
  padding: '10px 12px', marginBottom: 10,
}

const inlineRow = {
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
}

const chip = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '2px 8px', borderRadius: 12, fontSize: 11,
  marginRight: 4, marginBottom: 4,
}

// Supported slab types with BOQ calculations. BALCONY and TERRACE removed — they had
// no quantity calculation path and produced silent zero output. Add back when a proper
// calculation pipeline exists for them.
const TYPE_COLORS = {
  MAIN:   { background: '#e8f5e9', color: '#2e7d32' },
  SUNKEN: { background: '#e3f2fd', color: '#1565c0' },
}

const numInput = { width: 60, fontSize: 13 }

const addBtn = {
  marginTop: 12, padding: '6px 14px', fontSize: 12,
  background: '#f5f5f5', border: '1px solid #ccc',
  borderRadius: 4, cursor: 'pointer',
}

const assignSelect = { fontSize: 12, marginLeft: 4 }

const SLAB_SOURCE_COLOR = {
  INSTANCE:        { bg: '#e8f5e9', fg: '#2e7d32' },
  TYPE:            { bg: '#e3f2fd', fg: '#1565c0' },
  CLASS:           { bg: '#e3f2fd', fg: '#1565c0' },
  PROJECT_DEFAULT: { bg: '#fff8e1', fg: '#a37200' },
  ESTIMATE:        { bg: '#f5f5f5', fg: '#888' },
}
function slabResBadge(source) {
  const c = SLAB_SOURCE_COLOR[source] ?? SLAB_SOURCE_COLOR.ESTIMATE
  return { marginTop: 2, padding: '3px 7px', borderRadius: 4, fontSize: 10,
           background: c.bg, color: c.fg, display: 'inline-block', lineHeight: 1.3 }
}
const slabApplyBtn = {
  marginTop: 4, padding: '2px 8px', fontSize: 10,
  background: '#fafafa', border: '1px solid #bbb', borderRadius: 3,
  color: '#444', cursor: 'pointer',
}

const delBtn = {
  background: '#fff0f0', border: '1px solid #e74c3c',
  borderRadius: 4, color: '#e74c3c', cursor: 'pointer',
  fontSize: 11, padding: '2px 7px', marginLeft: 'auto',
}

export default function SlabPanel() {
  const slabs           = useStore(s => s.slabs)
  const rooms           = useStore(s => s.rooms)
  const activeTool      = useStore(s => s.activeTool)
  const getValidRoomIds = useStore(s => s.getValidRoomIds)
  const setTool         = useStore(s => s.setTool)
  const autoInitSlabs   = useStore(s => s.autoInitSlabs)
  const addSlab         = useStore(s => s.addSlab)
  const updateSlab      = useStore(s => s.updateSlab)
  const deleteSlab      = useStore(s => s.deleteSlab)
  const assignRoomToSlab = useStore(s => s.assignRoomToSlab)
  const setSlabReinforcementSpec = useStore(s => s.setSlabReinforcementSpec)
  const applyReinforcementSpecToMatching = useStore(s => s.applyReinforcementSpecToMatching)
  const projectSettings = useStore(s => s.projectSettings)

  if (activeTool !== 'slabs') return null

  const slabList = Object.values(slabs)
  const mainSlab = slabList.find(s => s.type === 'MAIN')

  const validIds   = getValidRoomIds()
  const assignedIds = new Set(slabList.flatMap(s => s.roomIds))
  const unassigned  = validIds.filter(id => !assignedIds.has(id))

  return (
    <div style={overlay}>
      <div style={headerRow}>
        <strong style={{ fontSize: 15 }}>Slab Management</strong>
        <button style={closeBtn} onClick={() => setTool('select')}>×</button>
      </div>

      {slabList.length === 0 ? (
        <div>
          <div style={{ color: '#666', marginBottom: 12 }}>
            No slabs configured. Click below to auto-initialize from room types.
          </div>
          <button style={{ ...addBtn, background: '#e8f5e9', borderColor: '#81c784' }} onClick={autoInitSlabs}>
            Auto-Init Slabs
          </button>
        </div>
      ) : (
        slabList.map(slab => {
          const badge = TYPE_COLORS[slab.type] ?? TYPE_COLORS.MAIN
          const canDelete = slab.roomIds.length === 0
          return (
            <div key={slab.id} style={slabCard}>
              <div style={inlineRow}>
                <span style={{ ...chip, ...badge }}>{slab.type}</span>
                <span style={{ color: '#888', fontSize: 11 }}>×{slab.thicknessIn} in</span>
                {canDelete && (
                  <button style={delBtn} onClick={() => deleteSlab(slab.id)}>Delete</button>
                )}
              </div>

              <div style={inlineRow}>
                <label style={{ fontSize: 11, color: '#888' }}>Thickness (in)</label>
                <input
                  type="number" min={1} style={numInput}
                  value={slab.thicknessIn}
                  onKeyDown={e => e.stopPropagation()}
                  onChange={e => updateSlab(slab.id, { thicknessIn: parseFloat(e.target.value) || 1 })}
                />
                {slab.type === 'SUNKEN' && (
                  <>
                    <label style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>Sink depth (in)</label>
                    <input
                      type="number" min={0} style={numInput}
                      value={slab.sinkDepthIn}
                      onKeyDown={e => e.stopPropagation()}
                      onChange={e => updateSlab(slab.id, { sinkDepthIn: parseFloat(e.target.value) || 0 })}
                    />
                  </>
                )}
              </div>

              {/* Phase 1.7+ — per-slab reinforcement spec with centralized resolution */}
              {(() => {
                const specs = projectSettings?.reinforcementSpecs ?? {}
                const slabSpecs = Object.values(specs).filter(sp => sp.elementType === 'SLAB')
                const state = useStore.getState()
                const resolved = resolveSlabReinforcementSpec(state, slab.id)
                const slabRole = slab.role ?? slab.classification ?? null
                const handleApply = () => {
                  const peers = Object.values(state.slabs).filter(
                    sl => sl.id !== slab.id && (sl.role ?? sl.classification ?? null) === slabRole
                  )
                  if (peers.length === 0) {
                    window.alert('No matching slabs to update — no other slabs share this role.')
                    return
                  }
                  const specLabel = slab.reinforcementSpecId
                    ? (specs[slab.reinforcementSpecId]?.label ?? slab.reinforcementSpecId)
                    : 'no spec (clear)'
                  const ok = window.confirm(
                    `Apply "${specLabel}" to ${peers.length} other ${slabRole ?? 'matching'} slab${peers.length === 1 ? '' : 's'}?`
                  )
                  if (!ok) return
                  applyReinforcementSpecToMatching({
                    elementType: 'SLAB',
                    sourceEntityId: slab.id,
                    specId: slab.reinforcementSpecId ?? null,
                  })
                }
                return (
                  <div style={{ marginBottom: 6 }}>
                    <div style={inlineRow}>
                      <label style={{ fontSize: 11, color: '#888' }}>Steel spec</label>
                      <select
                        value={slab.reinforcementSpecId ?? ''}
                        onKeyDown={e => e.stopPropagation()}
                        onChange={e => setSlabReinforcementSpec(slab.id, e.target.value || null)}
                        style={{ fontSize: 12 }}
                      >
                        <option value="">— Inherit —</option>
                        {slabSpecs.map(sp => <option key={sp.id} value={sp.id}>{sp.label}</option>)}
                      </select>
                      <button style={slabApplyBtn} onClick={handleApply}
                              title="Copy this spec to all other slabs with the same role">
                        Apply to matching
                      </button>
                    </div>
                    <div style={slabResBadge(resolved.source)}>
                      {resolved.specLabel} · {humanizeAssignmentSource(resolved.source)}
                    </div>
                  </div>
                )
              })()}

              {/* Role badge — Fix 3 */}
              {slab.role && (
                <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>
                  Role: <strong style={{ color: '#555' }}>{slab.role}</strong>
                </div>
              )}

              {slab.roomIds.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Rooms</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {slab.roomIds.map(rid => {
                      const roomName = rooms[rid]?.name ?? rid
                      const otherSlabs = slabList.filter(s => s.id !== slab.id)
                      return (
                        <div key={rid} style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ ...chip, background: '#f5f5f5', color: '#333' }}>
                            {roomName}
                            {mainSlab && mainSlab.id !== slab.id && (
                              <button
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e74c3c', fontSize: 11, padding: 0, lineHeight: 1 }}
                                title="Move back to MAIN slab"
                                onClick={() => assignRoomToSlab(rid, mainSlab.id)}
                              >×</button>
                            )}
                          </span>
                          {otherSlabs.length > 0 && (
                            <select
                              style={assignSelect}
                              value=""
                              onKeyDown={e => e.stopPropagation()}
                              onChange={e => { if (e.target.value) assignRoomToSlab(rid, e.target.value) }}
                            >
                              <option value="">Move to…</option>
                              {otherSlabs.map(s => (
                                <option key={s.id} value={s.id}>{s.type}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })
      )}

      {slabList.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          <button style={addBtn} onClick={() => addSlab('MAIN', [], 5, 0)}>
            + Main slab
          </button>
          <button style={addBtn} onClick={() => addSlab('SUNKEN', [], 5, 4)}>
            + Sunken slab
          </button>
        </div>
      )}

      {unassigned.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={sectionHead}>Unassigned rooms</div>
          {unassigned.map(rid => (
            <div key={rid} style={{ ...inlineRow, marginBottom: 6 }}>
              <span style={{ flex: 1 }}>{rooms[rid]?.name ?? rid}</span>
              <select
                style={{ fontSize: 12 }}
                value=""
                onKeyDown={e => e.stopPropagation()}
                onChange={e => { if (e.target.value) assignRoomToSlab(rid, e.target.value) }}
              >
                <option value="">Assign to…</option>
                {slabList.map(s => (
                  <option key={s.id} value={s.id}>{s.type}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
