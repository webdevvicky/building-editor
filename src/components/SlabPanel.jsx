import { useStore } from '../store'
import { resolveSlabReinforcementSpec, humanizeAssignmentSource } from '../specs/resolution'
import { dialog } from './ui/Dialog'
import { Modal } from './ui/Modal.jsx'
import { Button } from './ui/Button.jsx'

const sectionHead = {
  fontSize: 'var(--text-xs)',
  fontWeight: 'var(--weight-bold)',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
  letterSpacing: 0.5,
  marginBottom: 'var(--space-2)',
  marginTop: 'var(--space-4)',
}

const slabCard = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-3) var(--space-3)',
  marginBottom: 'var(--space-3)',
  background: 'var(--color-surface)',
}

const inlineRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  marginBottom: 'var(--space-2)',
}

const chip = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-1)',
  padding: '2px var(--space-2)',
  borderRadius: 'var(--radius-full)',
  fontSize: 'var(--text-xs)',
  fontWeight: 'var(--weight-medium)',
  marginRight: 'var(--space-1)',
  marginBottom: 'var(--space-1)',
}

const TYPE_COLORS = {
  MAIN:   { background: 'var(--color-success-bg)', color: 'var(--color-success)' },
  SUNKEN: { background: 'var(--color-primary-bg)', color: 'var(--color-primary)' },
}

const numInput = {
  width: 60,
  fontSize: 'var(--text-base)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '2px var(--space-2)',
  color: 'var(--color-text)',
  background: 'var(--color-surface)',
}

const labelStyle = { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }

const selectStyle = {
  fontSize: 'var(--text-sm)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '2px var(--space-2)',
  color: 'var(--color-text)',
  background: 'var(--color-surface)',
}

const SLAB_SOURCE_COLOR = {
  INSTANCE:        { bg: 'var(--color-success-bg)', fg: 'var(--color-success)' },
  TYPE:            { bg: 'var(--color-primary-bg)', fg: 'var(--color-primary)' },
  CLASS:           { bg: 'var(--color-primary-bg)', fg: 'var(--color-primary)' },
  PROJECT_DEFAULT: { bg: 'var(--color-warning-bg)', fg: 'var(--color-warning)' },
  ESTIMATE:        { bg: 'var(--color-bg-muted)',   fg: 'var(--color-text-muted)' },
}
function slabResBadge(source) {
  const c = SLAB_SOURCE_COLOR[source] ?? SLAB_SOURCE_COLOR.ESTIMATE
  return {
    marginTop: 'var(--space-1)',
    padding: '3px var(--space-2)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--text-xs)',
    background: c.bg,
    color: c.fg,
    display: 'inline-block',
    lineHeight: 1.3,
    fontWeight: 'var(--weight-medium)',
  }
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

  const open = activeTool === 'slabs'
  const onClose = () => setTool('select')

  const slabList = Object.values(slabs)
  const mainSlab = slabList.find(s => s.type === 'MAIN')

  const validIds   = getValidRoomIds()
  const assignedIds = new Set(slabList.flatMap(s => s.roomIds))
  const unassigned  = validIds.filter(id => !assignedIds.has(id))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Slab Management"
      width={520}
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}
    >
      {slabList.length === 0 ? (
        <div>
          <div
            style={{
              color: 'var(--color-text-secondary)',
              marginBottom: 'var(--space-3)',
            }}
          >
            No slabs configured. Click below to auto-initialize from room types.
          </div>
          <Button variant="primary" size="sm" onClick={autoInitSlabs}>
            Auto-Init Slabs
          </Button>
        </div>
      ) : (
        slabList.map(slab => {
          const badge = TYPE_COLORS[slab.type] ?? TYPE_COLORS.MAIN
          const canDelete = slab.roomIds.length === 0
          return (
            <div key={slab.id} style={slabCard}>
              <div style={inlineRow}>
                <span style={{ ...chip, ...badge }}>{slab.type}</span>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
                  ×{slab.thicknessIn} in
                </span>
                {canDelete && (
                  <div style={{ marginLeft: 'auto' }}>
                    <Button variant="danger" size="sm" onClick={() => deleteSlab(slab.id)}>
                      Delete
                    </Button>
                  </div>
                )}
              </div>

              <div style={inlineRow}>
                <label style={labelStyle}>Thickness (in)</label>
                <input
                  type="number" min={1} style={numInput}
                  value={slab.thicknessIn}
                  onKeyDown={e => e.stopPropagation()}
                  onChange={e => updateSlab(slab.id, { thicknessIn: parseFloat(e.target.value) || 1 })}
                />
                {slab.type === 'SUNKEN' && (
                  <>
                    <label style={{ ...labelStyle, marginLeft: 'var(--space-2)' }}>
                      Sink depth (in)
                    </label>
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
                const handleApply = async () => {
                  const peers = Object.values(state.slabs).filter(
                    sl => sl.id !== slab.id && (sl.role ?? sl.classification ?? null) === slabRole
                  )
                  if (peers.length === 0) {
                    await dialog.alert('No matching slabs to update — no other slabs share this role.', { title: 'No matching slabs' })
                    return
                  }
                  const specLabel = slab.reinforcementSpecId
                    ? (specs[slab.reinforcementSpecId]?.label ?? slab.reinforcementSpecId)
                    : 'no spec (clear)'
                  const ok = await dialog.confirm(
                    `Apply "${specLabel}" to ${peers.length} other ${slabRole ?? 'matching'} slab${peers.length === 1 ? '' : 's'}?`,
                    { title: 'Apply to matching slabs?', confirmLabel: 'Apply', variant: 'default' }
                  )
                  if (!ok) return
                  applyReinforcementSpecToMatching({
                    elementType: 'SLAB',
                    sourceEntityId: slab.id,
                    specId: slab.reinforcementSpecId ?? null,
                  })
                }
                return (
                  <div style={{ marginBottom: 'var(--space-2)' }}>
                    <div style={inlineRow}>
                      <label style={labelStyle}>Steel spec</label>
                      <select
                        value={slab.reinforcementSpecId ?? ''}
                        onKeyDown={e => e.stopPropagation()}
                        onChange={e => setSlabReinforcementSpec(slab.id, e.target.value || null)}
                        style={selectStyle}
                      >
                        <option value="">— Inherit —</option>
                        {slabSpecs.map(sp => <option key={sp.id} value={sp.id}>{sp.label}</option>)}
                      </select>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleApply}
                        title="Copy this spec to all other slabs with the same role"
                      >
                        Apply to matching
                      </Button>
                    </div>
                    <div style={slabResBadge(resolved.source)}>
                      {resolved.specLabel} · {humanizeAssignmentSource(resolved.source)}
                    </div>
                  </div>
                )
              })()}

              {/* Role badge — Fix 3 */}
              {slab.role && (
                <div
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-muted)',
                    marginBottom: 'var(--space-1)',
                  }}
                >
                  Role:{' '}
                  <strong style={{ color: 'var(--color-text-secondary)' }}>{slab.role}</strong>
                </div>
              )}

              {slab.roomIds.length > 0 && (
                <div style={{ marginTop: 'var(--space-1)' }}>
                  <div
                    style={{
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-text-muted)',
                      marginBottom: 'var(--space-1)',
                    }}
                  >
                    Rooms
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
                    {slab.roomIds.map(rid => {
                      const roomName = rooms[rid]?.name ?? rid
                      const otherSlabs = slabList.filter(s => s.id !== slab.id)
                      return (
                        <div
                          key={rid}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            marginBottom: 'var(--space-1)',
                          }}
                        >
                          <span
                            style={{
                              ...chip,
                              background: 'var(--color-bg-muted)',
                              color: 'var(--color-text)',
                            }}
                          >
                            {roomName}
                            {mainSlab && mainSlab.id !== slab.id && (
                              <button
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  color: 'var(--color-error)',
                                  fontSize: 'var(--text-xs)',
                                  padding: 0,
                                  lineHeight: 1,
                                }}
                                title="Move back to MAIN slab"
                                onClick={() => assignRoomToSlab(rid, mainSlab.id)}
                              >×</button>
                            )}
                          </span>
                          {otherSlabs.length > 0 && (
                            <select
                              style={{ ...selectStyle, marginLeft: 'var(--space-1)' }}
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
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
          <Button variant="secondary" size="sm" onClick={() => addSlab('MAIN', [], 5, 0)}>
            + Main slab
          </Button>
          <Button variant="secondary" size="sm" onClick={() => addSlab('SUNKEN', [], 5, 4)}>
            + Sunken slab
          </Button>
        </div>
      )}

      {unassigned.length > 0 && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <div style={sectionHead}>Unassigned rooms</div>
          {unassigned.map(rid => (
            <div key={rid} style={{ ...inlineRow, marginBottom: 'var(--space-2)' }}>
              <span style={{ flex: 1 }}>{rooms[rid]?.name ?? rid}</span>
              <select
                style={selectStyle}
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
    </Modal>
  )
}
