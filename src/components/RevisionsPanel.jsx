import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { History as HistoryIcon } from 'lucide-react'
import { useStore } from '../store'
import { getCurrentProjectId } from '../projects/manager'
import {
  listRevisions, createRevision, deleteRevision, subscribe, REVISION_CAP,
} from '../revisions/manager'
import { buildRevisionSnapshot, suggestNextLabel, APP_VERSION } from '../revisions/snapshot'
import { Modal } from './ui/Modal.jsx'
import { Button } from './ui/Button.jsx'
import { dialog } from './ui/Dialog'
import { toast } from './ui/Toast'
import RevisionDiffPanel from './RevisionDiffPanel'
import './revisions.css'

const AUTHOR_KEY = 'boq_last_author_name'

function readLastAuthor() {
  try { return localStorage.getItem(AUTHOR_KEY) || '' }
  catch { return '' }
}

function writeLastAuthor(name) {
  try {
    if (name) localStorage.setItem(AUTHOR_KEY, name)
    else      localStorage.removeItem(AUTHOR_KEY)
  } catch { /* ignore */ }
}

function fmtDate(ms) {
  if (!ms) return ''
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return '' }
}

function useRevisions(projectId) {
  return useSyncExternalStore(
    subscribe,
    () => listRevisions(projectId),
    () => [],
  )
}

export default function RevisionsPanel() {
  const activeTool  = useStore(s => s.activeTool)
  const setTool     = useStore(s => s.setTool)
  const loadProject = useStore(s => s.loadProject)
  const open        = activeTool === 'revisions'

  const projectId = getCurrentProjectId()
  const revisions = useRevisions(projectId)

  // Hide auto-revisions by default; toggle to reveal.
  const [showAuto, setShowAuto] = useState(false)
  const visible = useMemo(
    () => revisions.filter(r => showAuto || !r.isAuto),
    [revisions, showAuto],
  )

  // Selection state for compare.
  const [selected, setSelected] = useState([])  // array of revisionId (max 2)
  const [diffPair, setDiffPair] = useState(null) // { a, b } when diff modal open

  // Create form state.
  const [label, setLabel]   = useState('')
  const [note, setNote]     = useState('')
  const [author, setAuthor] = useState(readLastAuthor)

  // Re-seed suggested label when revisions change and label is empty.
  useEffect(() => {
    if (!open) return
    setLabel(prev => prev || suggestNextLabel(revisions))
  }, [open, revisions])

  function dismiss() { setTool('select') }

  function toggleSelect(id) {
    setSelected(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id)
      // Keep the two most-recent selections; older one drops off.
      const next = [...prev, id]
      return next.length > 2 ? next.slice(next.length - 2) : next
    })
  }

  function handleCreate() {
    if (!projectId) return
    const state = useStore.getState()
    const body  = buildRevisionSnapshot(state, state.ratesByKey, {
      label, note, authorName: author || null,
    })
    const rec = createRevision(projectId, body)
    if (!rec) {
      toast.error('Could not save revision — storage quota exceeded.')
      return
    }
    writeLastAuthor(author)
    setLabel('')
    setNote('')
    toast.success(`Saved revision "${rec.label}".`)
  }

  async function handleDelete(rev) {
    const ok = await dialog.confirm(
      `Delete revision "${rev.label}"? This cannot be undone.`,
      { title: 'Delete revision', confirmLabel: 'Delete', variant: 'danger' },
    )
    if (!ok) return
    deleteRevision(projectId, rev.id)
    setSelected(s => s.filter(id => id !== rev.id))
  }

  async function handleRestore(rev) {
    const ok = await dialog.confirm(
      `Restore "${rev.label}"? Current state will be saved as an auto-revision first, and undo history will be cleared.`,
      { title: 'Restore revision', confirmLabel: 'Restore', variant: 'danger' },
    )
    if (!ok) return
    // Auto-revision before restore (safety net).
    const live = useStore.getState()
    const auto = buildRevisionSnapshot(live, live.ratesByKey, {
      label: 'Auto-saved before restore',
      note:  `Snapshot before restoring "${rev.label}"`,
      isAuto: true,
      parentId: rev.id,
    })
    const autoRec = createRevision(projectId, auto)
    // Apply the target snapshot.
    loadProject(rev.snapshot)
    toast.action(`Restored "${rev.label}".`, {
      label: 'Undo',
      onClick: () => {
        if (autoRec) loadProject(autoRec.snapshot)
      },
      duration: 7000,
    })
  }

  function handleCompare() {
    if (selected.length !== 2) return
    const [idA, idB] = selected
    const ra = revisions.find(r => r.id === idA)
    const rb = revisions.find(r => r.id === idB)
    if (!ra || !rb) return
    // Older → newer regardless of click order.
    const [from, to] = (ra.createdAt <= rb.createdAt) ? [ra, rb] : [rb, ra]
    setDiffPair({ a: from, b: to })
  }

  if (!projectId) {
    // No active project — render nothing rather than confuse the user.
    return null
  }

  return (
    <>
      <Modal
        open={open}
        onClose={dismiss}
        title="Revisions"
        width={720}
      >
        <div className="rev-panel">
          <div className="rev-create">
            <div className="rev-create__title">Save current as revision</div>
            <div className="rev-create__row">
              <input
                className="rev-input"
                value={label}
                placeholder={suggestNextLabel(revisions)}
                onChange={e => setLabel(e.target.value)}
                onKeyDown={e => e.stopPropagation()}
                aria-label="Revision label"
              />
              <input
                className="rev-input rev-input--wide"
                value={author}
                placeholder="Author (optional)"
                onChange={e => setAuthor(e.target.value)}
                onKeyDown={e => e.stopPropagation()}
                aria-label="Author name"
              />
              <Button variant="primary" size="sm" onClick={handleCreate}>Save revision</Button>
            </div>
            <textarea
              className="rev-textarea"
              value={note}
              placeholder="Notes (optional) — describe what changed"
              onChange={e => setNote(e.target.value)}
              onKeyDown={e => e.stopPropagation()}
              rows={2}
              aria-label="Author note"
            />
          </div>

          <div className="rev-list-header">
            <div className="rev-list-header__left">
              <HistoryIcon size={14} strokeWidth={2} />
              <span>{visible.length} revision{visible.length === 1 ? '' : 's'}</span>
              {revisions.length >= REVISION_CAP * 0.8 && (
                <span className="rev-cap-warning">
                  {revisions.length} / {REVISION_CAP} cap
                </span>
              )}
            </div>
            <div className="rev-list-header__right">
              <label className="rev-toggle">
                <input
                  type="checkbox"
                  checked={showAuto}
                  onChange={e => setShowAuto(e.target.checked)}
                />
                Show auto-saves
              </label>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCompare}
                disabled={selected.length !== 2}
              >
                Compare 2
              </Button>
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="rev-empty">
              No revisions yet. Save one above to track changes.
            </div>
          ) : (
            <div className="rev-rows">
              {visible.map(rev => {
                const isSelected = selected.includes(rev.id)
                return (
                  <div
                    key={rev.id}
                    className={`rev-row${isSelected ? ' rev-row--selected' : ''}${rev.isAuto ? ' rev-row--auto' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="rev-row__check"
                      checked={isSelected}
                      onChange={() => toggleSelect(rev.id)}
                      aria-label={`Select ${rev.label}`}
                    />
                    <div className="rev-row__body">
                      <div className="rev-row__title">
                        <span className="rev-row__label">{rev.label}</span>
                        {rev.isAuto && <span className="rev-row__tag">auto</span>}
                        {rev.appVersion && (
                          <span className="rev-row__meta">v{rev.appVersion}</span>
                        )}
                      </div>
                      <div className="rev-row__meta-line">
                        {fmtDate(rev.createdAt)}
                        {rev.authorName && <> · {rev.authorName}</>}
                        {rev.validationSummary && (
                          <>
                            {' · '}
                            {rev.validationSummary.errors > 0 && (
                              <span className="rev-sev rev-sev--error">
                                {rev.validationSummary.errors} err
                              </span>
                            )}
                            {rev.validationSummary.warnings > 0 && (
                              <span className="rev-sev rev-sev--warn">
                                {rev.validationSummary.warnings} warn
                              </span>
                            )}
                            {rev.validationSummary.total === 0 && (
                              <span className="rev-sev rev-sev--ok">no issues</span>
                            )}
                          </>
                        )}
                      </div>
                      {rev.note && <div className="rev-row__note">{rev.note}</div>}
                    </div>
                    <div className="rev-row__actions">
                      <Button variant="secondary" size="sm" onClick={() => handleRestore(rev)}>
                        Restore
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => handleDelete(rev)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="rev-footer-note">
            Snapshots are computed with app v{APP_VERSION}. Re-opening an old
            revision applies the snapshot data, then runs current formulas.
          </div>
        </div>
      </Modal>

      {diffPair && (
        <RevisionDiffPanel
          revA={diffPair.a}
          revB={diffPair.b}
          onClose={() => setDiffPair(null)}
        />
      )}
    </>
  )
}
